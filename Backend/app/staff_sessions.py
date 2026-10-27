from flask import Blueprint, g, jsonify
from . import db
from .models import Branch, User, Session, to_iso
from .restaurant import owner
from .pos import command
from .tools import ApiError, find_mine, json_body, password_matches, to_id

bp = Blueprint('staff_sessions', __name__)


@bp.get('/staff/<user_id>/sessions')
def list_sessions(user_id):
    if to_id(user_id) != g.user.id:
        owner()
    user = find_mine(User, user_id, 'staff')
    rows = Session.query.filter_by(user_id=user.id).order_by(Session.id.desc()).all()
    return jsonify([{'id': str(x.id), 'device': x.device_name or 'อุปกรณ์เดิม / ไม่ทราบชื่อ',
        'createdAt': to_iso(x.created_at), 'lastSeenAt': to_iso(x.last_seen_at), 'expiresAt': to_iso(x.expires_at),
        'current': x.token_hash == g.token_hash} for x in rows])


@bp.post('/staff/<user_id>/sessions/<session_id>/revoke')
def revoke_session(user_id, session_id):
    if to_id(user_id) != g.user.id:
        owner()
    def work(_body):
        user = find_mine(User, user_id, 'staff')
        session = Session.query.filter_by(id=to_id(session_id), user_id=user.id).first()
        if session:
            db.session.delete(session)
        return {'ok': True}
    return command('session/revoke/' + str(user_id) + '/' + str(session_id), work)


@bp.post('/staff/transfer-owner')
def transfer_owner():
    owner()
    def work(body):
        if not isinstance(body.get('password'), str) or not password_matches(g.user.password_hash, body['password']):
            raise ApiError('INVALID_CREDENTIALS', 'รหัสผ่านเจ้าของร้านไม่ถูกต้อง')
        target = find_mine(User, body.get('userId'), 'staff')
        if not target.approved or target.id == g.user.id:
            raise ApiError('VALIDATION', 'เลือกพนักงานที่อนุมัติแล้วและเป็นคนละบัญชี')
        target.role, g.user.role = 'owner', 'staff'
        Session.query.filter(Session.user_id.in_([target.id, g.user.id])).delete(synchronize_session=False)
        return {'ok': True, 'ownerId': str(target.id), 'signInAgain': True}
    return command('staff/transfer-owner', work)
