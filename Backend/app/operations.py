"""Shared database throttling, atomic audit, request tracing, safe response headers."""
import logging
import time
import uuid
from datetime import timedelta
from logging.handlers import RotatingFileHandler
from pathlib import Path

from flask import g, has_request_context, request
from sqlalchemy import event
from sqlalchemy.orm import Session as OrmSession

from . import db
from .models import now
from .restaurant_models import AuditEvent, RateWindow
from .tools import ApiError, hash_text


@event.listens_for(OrmSession, 'before_commit')
def audit_commit(session):
    if not has_request_context() or not getattr(g, 'user', None) or getattr(g, 'audited', False):
        return
    if request.method in ('GET', 'OPTIONS'):
        return
    session.add(AuditEvent(branch_id=g.branch_id, user_id=g.user.id,
        action=(request.method + ' ' + request.path)[:180], request_id=getattr(g, 'request_id', uuid.uuid4().hex)))
    g.audited = True


def setup_operations(app):
    if not app.testing:
        path = Path(app.instance_path) / 'logs'
        path.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(path / 'app.log', maxBytes=2_000_000, backupCount=5, encoding='utf-8')
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
        app.logger.addHandler(handler)
        app.logger.setLevel(logging.INFO)

    @app.before_request
    def trace_and_throttle():
        g.request_id = uuid.uuid4().hex
        g.request_started = time.monotonic()
        if request.method != 'POST' or not (request.path.startswith('/api/v1/auth/') or request.path == '/api/v1/staff/transfer-owner'):
            return
        body = request.get_json(silent=True)
        identifier = str((body if isinstance(body, dict) else {}).get('identifier', (body if isinstance(body, dict) else {}).get('email', '')))[:190].lower()
        # IP bucket plus independent account bucket. Never trust arbitrary forwarding headers.
        for bucket, limit in [('ip:' + (request.remote_addr or 'unknown'), 60), ('account:' + identifier, 15)]:
            key = hash_text(request.path + ':' + bucket)
            dialect = db.engine.dialect.name
            if dialect == 'mysql':
                from sqlalchemy.dialects.mysql import insert
                stmt = insert(RateWindow).values(key=key, started_at=now(), attempts=0)
                db.session.execute(stmt.on_duplicate_key_update(key=stmt.inserted.key))
            elif dialect == 'sqlite':
                from sqlalchemy.dialects.sqlite import insert
                db.session.execute(insert(RateWindow).values(key=key, started_at=now(), attempts=0).on_conflict_do_nothing())
            else:
                raise RuntimeError('Unsupported rate-limit database')
            window = RateWindow.query.filter_by(key=key).with_for_update().first()
            if window.started_at < now() - timedelta(minutes=5):
                window.started_at, window.attempts = now(), 0
            window.attempts += 1
            blocked = window.attempts > limit
            db.session.commit()  # Count failed attempts too, across workers.
            if blocked:
                raise ApiError('TOO_MANY_REQUESTS', 'ทำรายการถี่เกินไป กรุณารอ 5 นาที')

    @app.after_request
    def headers(response):
        response.headers['X-Request-ID'] = getattr(g, 'request_id', '')
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'same-origin'
        if app.config.get('IS_PRODUCTION'):
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        if not app.testing:
            app.logger.info('request=%s method=%s path=%s status=%s ms=%.0f', getattr(g, 'request_id', ''),
                request.method, request.path, response.status_code, (time.monotonic() - getattr(g, 'request_started', time.monotonic())) * 1000)
        return response
