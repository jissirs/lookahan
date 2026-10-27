"""Purchase receipts, waste and retriable POS commands; existing records stay intact."""
from . import db
from .models import now, to_iso


class PosCommand(db.Model):
    __tablename__ = 'pos_commands'
    __table_args__ = (db.UniqueConstraint('branch_id', 'request_key', name='uq_pos_command'),)
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    request_key = db.Column(db.String(80), nullable=False)
    digest = db.Column(db.String(64), nullable=False)
    result = db.Column(db.JSON, nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False)


class Supplier(db.Model):
    __tablename__ = 'suppliers'
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    contact = db.Column(db.String(200), default='', nullable=False)
    def to_json(self):
        return {'id': str(self.id), 'name': self.name, 'contact': self.contact}


class Purchase(db.Model):
    __tablename__ = 'purchases'
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    supplier_id = db.Column(db.Integer, db.ForeignKey('suppliers.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(12), default='open', nullable=False)
    note = db.Column(db.String(500), default='', nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False)
    supplier = db.relationship('Supplier')
    lines = db.relationship('PurchaseLine', lazy='selectin', cascade='all, delete-orphan', order_by='PurchaseLine.id')
    receipts = db.relationship('PurchaseReceipt', lazy='selectin', order_by='PurchaseReceipt.id')
    def to_json(self):
        return {'id': str(self.id), 'supplier': self.supplier.to_json(), 'status': self.status,
                'note': self.note, 'createdAt': to_iso(self.created_at), 'lines': [x.to_json() for x in self.lines],
                'receipts': [x.to_json() for x in self.receipts]}


class PurchaseLine(db.Model):
    __tablename__ = 'purchase_lines'
    id = db.Column(db.Integer, primary_key=True)
    purchase_id = db.Column(db.Integer, db.ForeignKey('purchases.id'), nullable=False)
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id'), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    unit = db.Column(db.String(10), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    received = db.Column(db.Integer, default=0, nullable=False)
    unit_cost = db.Column(db.Numeric(18, 6), nullable=False)
    def to_json(self):
        return {'id': str(self.id), 'ingredientId': str(self.ingredient_id), 'name': self.name,
                'unit': self.unit, 'quantity': self.quantity, 'received': self.received, 'unitCost': self.unit_cost}


class PurchaseReceipt(db.Model):
    __tablename__ = 'purchase_receipts'
    id = db.Column(db.Integer, primary_key=True)
    purchase_id = db.Column(db.Integer, db.ForeignKey('purchases.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    invoice_ref = db.Column(db.String(100), default='', nullable=False)
    details = db.Column(db.JSON, nullable=False)
    total = db.Column(db.Numeric(18, 2), nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False)
    def to_json(self):
        return {'id': str(self.id), 'invoiceRef': self.invoice_ref, 'details': self.details,
                'total': self.total, 'createdAt': to_iso(self.created_at)}


class WasteRecord(db.Model):
    __tablename__ = 'waste_records'
    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id'), nullable=False)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id'))
    quantity = db.Column(db.Integer, nullable=False)
    cost = db.Column(db.Numeric(18, 6))
    reason = db.Column(db.String(30), nullable=False)
    note = db.Column(db.String(200), default='', nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False)
    ingredient = db.relationship('Ingredient')
    def to_json(self):
        return {'id': str(self.id), 'ingredientId': str(self.ingredient_id), 'name': self.ingredient.name,
                'unit': self.ingredient.unit, 'quantity': self.quantity, 'cost': self.cost,
                'reason': self.reason, 'note': self.note, 'orderId': str(self.order_id) if self.order_id else None,
                'createdAt': to_iso(self.created_at)}
