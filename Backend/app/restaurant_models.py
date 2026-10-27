"""Single restaurant: payment ledger, cash reconciliation and operational audit."""
from . import db
from .models import now, to_iso


class Payment(db.Model):
    __tablename__ = 'payments'
    __table_args__ = (db.UniqueConstraint('branch_id', 'request_key', name='uq_payment_request'),)
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    request_key = db.Column(db.String(80), nullable=False)
    request_hash = db.Column(db.String(64), nullable=False)
    amount = db.Column(db.Numeric(18, 2), nullable=False)  # Negative = refund
    method = db.Column(db.String(12), nullable=False)
    tendered = db.Column(db.Numeric(18, 2), nullable=False)
    note = db.Column(db.String(200), default='', nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False, index=True)

    def to_json(self):
        return {'id': str(self.id), 'amount': self.amount, 'method': self.method,
                'tendered': self.tendered, 'change': max(0, self.tendered - max(0, self.amount)),
                'note': self.note, 'createdAt': to_iso(self.created_at)}


class CashClose(db.Model):
    __tablename__ = 'cash_closes'
    __table_args__ = (db.UniqueConstraint('branch_id', 'business_date', name='uq_cash_close_day'),)
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    business_date = db.Column(db.Date, nullable=False)
    opening = db.Column(db.Numeric(18, 2), nullable=False)
    expected = db.Column(db.Numeric(18, 2), nullable=False)
    counted = db.Column(db.Numeric(18, 2), nullable=False)
    note = db.Column(db.String(500), default='', nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False)

    def to_json(self):
        return {'date': self.business_date.isoformat(), 'opening': self.opening, 'expected': self.expected,
                'counted': self.counted, 'variance': self.counted - self.expected, 'note': self.note}


class AuditEvent(db.Model):
    __tablename__ = 'audit_events'
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, nullable=False, index=True)
    user_id = db.Column(db.Integer, nullable=False)
    action = db.Column(db.String(180), nullable=False)
    request_id = db.Column(db.String(32), nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False)


class RateWindow(db.Model):
    __tablename__ = 'rate_windows'
    key = db.Column(db.String(64), primary_key=True)
    started_at = db.Column(db.DateTime, default=now, nullable=False)
    attempts = db.Column(db.Integer, default=0, nullable=False)
