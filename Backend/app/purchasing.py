"""Supplier orders, partial receipts and classified waste within existing stock workflow."""
from decimal import Decimal
from flask import Blueprint, g, jsonify
from . import db
from .models import Ingredient, Movement, now
from .restaurant import owner
from .pos import command, text_field
from .service_models import Supplier, Purchase, PurchaseLine, PurchaseReceipt, WasteRecord
from .inventory_policy import expiry_date, money, receive
from .tools import ApiError, find_mine, is_whole_number, to_id
from .routes.orders import change_stock
from .routes.notifications import notify_stock_change

bp = Blueprint('purchasing', __name__)
WASTE_REASONS = ('expired', 'cooking_error', 'customer_return', 'spoilage', 'other')


@bp.get('/purchases')
def list_purchases():
    owner()
    return jsonify(suppliers=[x.to_json() for x in Supplier.query.filter_by(branch_id=g.branch_id).order_by(Supplier.id)],
        purchases=[x.to_json() for x in Purchase.query.filter_by(branch_id=g.branch_id).order_by(Purchase.id.desc()).limit(100)],
        waste=[x.to_json() for x in WasteRecord.query.filter_by(branch_id=g.branch_id).order_by(WasteRecord.id.desc()).limit(100)])


@bp.post('/suppliers')
def create_supplier():
    owner()
    def work(body):
        name, contact = text_field(body, 'name', limit=100), text_field(body, 'contact', limit=200)
        if not name or len(name) > 100 or not isinstance(contact, str) or len(contact) > 200:
            raise ApiError('VALIDATION', 'ชื่อผู้ขายหรือช่องทางติดต่อไม่ถูกต้อง')
        if Supplier.query.filter_by(branch_id=g.branch_id, name=name).first():
            raise ApiError('DUPLICATE_NAME', 'มีผู้ขายชื่อนี้แล้ว')
        item = Supplier(branch_id=g.branch_id, name=name, contact=contact)
        db.session.add(item); db.session.flush()
        return {'supplier': item.to_json()}
    return command('supplier/create', work)


@bp.post('/purchases')
def create_purchase():
    owner()
    def work(body):
        supplier = find_mine(Supplier, body.get('supplierId'), 'supplier')
        entries = body.get('lines')
        if not isinstance(entries, list) or not 1 <= len(entries) <= 200:
            raise ApiError('VALIDATION', 'ระบุรายการสั่งซื้อ 1–200 รายการ')
        purchase = Purchase(branch_id=g.branch_id, user_id=g.user.id, supplier_id=supplier.id, note=text_field(body, 'note'))
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise ApiError('VALIDATION', 'รายการสั่งซื้อไม่ถูกต้อง')
            item = find_mine(Ingredient, entry.get('ingredientId'), 'ingredient')
            qty = entry.get('quantity')
            if item.deleted_at or item.id in seen or not is_whole_number(qty) or not 1 <= qty <= 100000000:
                raise ApiError('VALIDATION', 'วัตถุดิบซ้ำ ถูกลบ หรือจำนวนไม่ถูกต้อง')
            seen.add(item.id)
            purchase.lines.append(PurchaseLine(ingredient_id=item.id, name=item.name, unit=item.unit,
                quantity=qty, unit_cost=money(entry.get('unitCost'), 6)))
        db.session.add(purchase); db.session.flush()
        return {'purchase': purchase.to_json()}
    return command('purchase/create', work)


@bp.post('/purchases/<purchase_id>/receive')
def receive_purchase(purchase_id):
    owner()
    def work(body):
        purchase = find_mine(Purchase, purchase_id, 'purchase')
        if purchase.status != 'open':
            raise ApiError('VALIDATION', 'ใบสั่งซื้อนี้ปิดแล้ว')
        entries = body.get('lines')
        if not isinstance(entries, list) or not 1 <= len(entries) <= 200:
            raise ApiError('VALIDATION', 'เลือกรายการที่รับจริง')
        by_id = {x.id: x for x in purchase.lines}
        seen, details, total = set(), [], Decimal(0)
        for entry in entries:
            if not isinstance(entry, dict):
                raise ApiError('VALIDATION', 'รายการรับไม่ถูกต้อง')
            key, qty = to_id(entry.get('lineId')), entry.get('quantity')
            line = by_id.get(key)
            if not line or key in seen or not is_whole_number(qty) or not 1 <= qty <= line.quantity - line.received:
                raise ApiError('VALIDATION', 'รับของเกินค้างรับ หรือระบุรายการไม่ถูกต้อง')
            seen.add(key)
            item = Ingredient.query.filter_by(id=line.ingredient_id, branch_id=g.branch_id, deleted_at=None).with_for_update().first()
            if not item:
                raise ApiError('VALIDATION', 'วัตถุดิบถูกลบแล้ว')
            cost = money(entry.get('unitCost', str(line.unit_cost)), 6)
            expires = expiry_date(entry.get('expiresOn'))
            before = item.usable_quantity
            batch = receive(item, qty, expires, 'รับใบสั่งซื้อ #' + str(purchase.id), unit_cost=cost)
            item.quantity += qty
            notify_stock_change(item, before)
            db.session.add(Movement(ingredient_id=item.id, user_id=g.user.id, type='Add',
                label='รับใบสั่งซื้อ #' + str(purchase.id), amount=qty, balance=item.quantity, cost=qty * cost))
            line.received += qty
            details.append({'ingredientId': str(item.id), 'name': item.name, 'quantity': qty,
                'unit': item.unit, 'unitCost': str(cost), 'expiresOn': expires.isoformat() if expires else None})
            total += qty * cost
        ref = body.get('invoiceRef', '')
        if not isinstance(ref, str) or len(ref) > 100:
            raise ApiError('VALIDATION', 'เลขใบส่งของไม่ถูกต้อง')
        purchase.receipts.append(PurchaseReceipt(user_id=g.user.id, invoice_ref=ref, details=details, total=total.quantize(Decimal('.01'))))
        if all(x.received == x.quantity for x in purchase.lines):
            purchase.status = 'completed'
        db.session.flush()
        return {'purchase': purchase.to_json()}
    return command('purchase/receive/' + str(purchase_id), work)


@bp.post('/purchases/<purchase_id>/cancel')
def cancel_purchase(purchase_id):
    owner()
    def work(_body):
        purchase = find_mine(Purchase, purchase_id, 'purchase')
        if purchase.status != 'open':
            raise ApiError('VALIDATION', 'ใบสั่งซื้อปิดแล้ว')
        purchase.status = 'cancelled'
        return {'purchase': purchase.to_json()}
    return command('purchase/cancel/' + str(purchase_id), work)


@bp.post('/waste')
def waste():
    owner()
    def work(body):
        item = Ingredient.query.filter_by(id=to_id(body.get('ingredientId')), branch_id=g.branch_id, deleted_at=None).with_for_update().first()
        qty, reason = body.get('quantity'), body.get('reason')
        if not item or not is_whole_number(qty) or not 1 <= qty <= item.quantity or reason not in WASTE_REASONS:
            raise ApiError('VALIDATION', 'จำนวนวัตถุดิบหรือสาเหตุของเสียไม่ถูกต้อง')
        note = text_field(body, 'note', limit=200)
        movement = change_stock(item, -qty, 'Drop', 'ของเสีย: ' + reason)
        record = WasteRecord(branch_id=g.branch_id, user_id=g.user.id, ingredient_id=item.id,
            quantity=qty, cost=movement.cost, reason=reason, note=note)
        db.session.add(record); db.session.flush()
        return {'waste': record.to_json()}
    return command('waste/create', work)
