"""Validated recipe modifiers and immutable payment accounting for one restaurant."""
import hashlib
import json
from decimal import Decimal

from flask import Blueprint, g, jsonify
from . import db
from .forecast import day_bounds, local_today
from .inventory_policy import money
from .models import Branch, Ingredient, Order, Session, User
from .restaurant_models import AuditEvent, CashClose, Payment
from .tools import ApiError, find_mine, is_whole_number, json_body, to_id

bp = Blueprint('restaurant', __name__)


def owner():
    if g.user.role != 'owner':
        raise ApiError('FORBIDDEN', 'เฉพาะเจ้าของร้านเท่านั้น')


def fingerprint(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def request_key(body):
    key = body.get('requestKey')
    if not isinstance(key, str) or not 8 <= len(key) <= 80:
        raise ApiError('VALIDATION', 'ต้องมีรหัสคำขอ 8–80 ตัวอักษร')
    return key


def read_modifiers(raw):
    if not isinstance(raw, list) or len(raw) > 20:
        raise ApiError('VALIDATION', 'ตัวเลือกอาหารต้องเป็นรายการไม่เกิน 20 ตัวเลือก')
    result, names = [], set()
    for entry in raw:
        if not isinstance(entry, dict) or not isinstance(entry.get('name'), str) or not 1 <= len(entry['name'].strip()) <= 60:
            raise ApiError('VALIDATION', 'กรุณาระบุชื่อตัวเลือก')
        name = entry['name'].strip()
        if name in names:
            raise ApiError('VALIDATION', 'ชื่อตัวเลือกซ้ำ')
        names.add(name)
        adjustments = entry.get('ingredients', [])
        if not isinstance(adjustments, list) or len(adjustments) > 50:
            raise ApiError('VALIDATION', 'ส่วนผสมตัวเลือกไม่ถูกต้อง')
        lines, seen = [], set()
        for line in adjustments:
            if not isinstance(line, dict) or not is_whole_number(line.get('qty')) or not -100000 <= line['qty'] <= 100000 or line['qty'] == 0:
                raise ApiError('VALIDATION', 'ปริมาณตัวเลือกต้องเป็นจำนวนเต็มบวกหรือลบที่ไม่เป็นศูนย์')
            key = to_id(line.get('ingredientId'))
            item = Ingredient.query.filter_by(id=key, branch_id=g.branch_id, deleted_at=None).first()
            if not item or key in seen:
                raise ApiError('VALIDATION', 'วัตถุดิบตัวเลือกไม่มีอยู่ หรือซ้ำกัน')
            seen.add(key)
            lines.append({'ingredientId': str(key), 'qty': line['qty']})
        result.append({'name': name, 'price': float(money(entry.get('price', 0))), 'ingredients': lines})
    return result


def order_lines(raw, menus):
    """Keep variations as separate lines; never trust client prices or ingredient deltas."""
    lines, needed = [], {}
    for entry in raw:
        if not entry['qty']:
            continue
        menu = menus[to_id(entry['menuId'])]
        chosen = entry.get('modifiers', [])
        if not isinstance(chosen, list) or any(not isinstance(x, str) for x in chosen) or len(set(chosen)) != len(chosen):
            raise ApiError('VALIDATION', 'ตัวเลือกอาหารไม่ถูกต้อง')
        catalog = {x['name']: x for x in (menu.modifiers or [])}
        if any(name not in catalog for name in chosen):
            raise ApiError('VALIDATION', 'ตัวเลือกอาหารไม่มีอยู่ กรุณาโหลดเมนูใหม่')
        selected = [catalog[name] for name in chosen]
        per_plate = {r.ingredient_id: r.quantity for r in menu.recipe}
        directions = {}
        price = Decimal(str(menu.price))
        for option in selected:
            price += Decimal(str(option['price']))
            for adjustment in option['ingredients']:
                key = int(adjustment['ingredientId'])
                direction = 1 if adjustment['qty'] > 0 else -1
                if key in directions and directions[key] != direction:
                    raise ApiError('VALIDATION', 'ตัวเลือกเพิ่มและไม่ใส่วัตถุดิบเดียวกันขัดแย้งกัน')
                directions[key] = direction
                per_plate[key] = per_plate.get(key, 0) + adjustment['qty']
        if any(qty < 0 for qty in per_plate.values()):
            raise ApiError('VALIDATION', 'ตัวเลือกหักวัตถุดิบมากกว่าสูตร กรุณาแก้สูตรหรือตัวเลือก')
        note = entry.get('note', '')
        if not isinstance(note, str) or len(note) > 200:
            raise ApiError('VALIDATION', 'หมายเหตุต่อจานยาวเกินไป')
        for key, qty in per_plate.items():
            if qty:
                needed[key] = needed.get(key, 0) + qty * entry['qty']
        lines.append({'menu_id': menu.id, 'name': menu.name, 'price': price, 'qty': entry['qty'],
                      'modifiers': [dict(x) for x in selected], 'note': note,
                      'recipe_snapshot': {str(key): qty for key, qty in per_plate.items() if qty}})
    return lines, needed


@bp.get('/staff')
def staff():
    owner()
    return jsonify([u.to_json() for u in User.query.filter_by(branch_id=g.branch_id).order_by(User.id)])


@bp.patch('/staff/<user_id>')
def approve_staff(user_id):
    owner()
    Branch.query.filter_by(id=g.branch_id).with_for_update().first()
    user = find_mine(User, user_id, 'staff')
    body = json_body()
    if user.role == 'owner':
        raise ApiError('VALIDATION', 'ไม่สามารถเปลี่ยนสถานะเจ้าของร้านได้')
    if not isinstance(body.get('approved'), bool):
        raise ApiError('VALIDATION', 'approved ต้องเป็น true หรือ false')
    user.approved = body['approved']
    if not user.approved:
        Session.query.filter_by(user_id=user.id).delete()
    db.session.commit()
    return jsonify(user.to_json())


@bp.post('/orders/<order_id>/payments')
def payment(order_id):
    body = json_body()
    key = request_key(body)
    Branch.query.filter_by(id=g.branch_id).with_for_update().first()
    order = find_mine(Order, order_id, 'order')
    digest = fingerprint({'orderId': str(order.id), 'body': body})
    previous = Payment.query.filter_by(branch_id=g.branch_id, request_key=key).with_for_update().first()
    if previous:
        if previous.request_hash != digest:
            raise ApiError('CONFLICT', 'รหัสคำขอนี้ใช้กับรายการอื่นแล้ว', 409)
        return jsonify(order.to_json())
    if CashClose.query.filter_by(branch_id=g.branch_id, business_date=local_today()).first():
        raise ApiError('ALREADY_CLOSED', 'ปิดเงินวันนี้แล้ว ไม่สามารถรับหรือคืนเงินเพิ่มได้')
    method = body.get('method')
    if method not in ('cash', 'transfer'):
        raise ApiError('VALIDATION', 'เลือกเงินสดหรือโอน')
    amount = money(body.get('amount'))
    if amount <= 0:
        raise ApiError('VALIDATION', 'จำนวนเงินต้องมากกว่าศูนย์')
    net = sum((p.amount for p in order.payments), Decimal(0))
    refund = body.get('refund', False)
    if not isinstance(refund, bool):
        raise ApiError('VALIDATION', 'refund ต้องเป็น true หรือ false')
    if refund:
        owner()
        available = sum((p.amount for p in order.payments if p.method == method), Decimal(0))
        if amount > available or not body.get('note', '').strip():
            raise ApiError('VALIDATION', 'คืนเงินเกินยอดรับช่องทางนี้ หรือไม่มีเหตุผลคืนเงิน')
        amount = -amount
        tendered = Decimal(0)
    else:
        if order.status == 'cancelled' or amount > order.total - net:
            raise ApiError('VALIDATION', 'รับเงินเกินยอดค้าง หรือออเดอร์ถูกยกเลิก')
        tendered = money(body.get('tendered', amount)) if method == 'cash' else amount
        if tendered < amount:
            raise ApiError('VALIDATION', 'เงินที่ลูกค้าให้ไม่พอ')
    db.session.add(Payment(branch_id=g.branch_id, order_id=order.id, user_id=g.user.id, request_key=key,
        request_hash=digest, amount=amount, method=method, tendered=tendered, note=body.get('note', '')[:200]))
    order.revision = (order.revision or 1) + 1
    db.session.commit()
    db.session.expire(order, ['payments'])
    return jsonify(order.to_json()), 201


def cash_summary():
    start, end = day_bounds(local_today())
    entries = Payment.query.filter(Payment.branch_id == g.branch_id, Payment.created_at >= start, Payment.created_at < end).all()
    cash = sum((p.amount for p in entries if p.method == 'cash'), Decimal(0))
    transfer = sum((p.amount for p in entries if p.method == 'transfer'), Decimal(0))
    orders = Order.query.filter(Order.branch_id == g.branch_id, Order.status != 'cancelled').all()
    outstanding = sum((max(Decimal(0), o.total - sum((p.amount for p in o.payments), Decimal(0))) for o in orders), Decimal(0))
    close = CashClose.query.filter_by(branch_id=g.branch_id, business_date=local_today()).first()
    return {'date': local_today().isoformat(), 'cash': cash, 'transfer': transfer, 'netReceived': cash + transfer,
            'refunds': -sum((p.amount for p in entries if p.amount < 0), Decimal(0)),
            'outstandingAllDates': outstanding, 'closing': close.to_json() if close else None}


@bp.get('/cash/today')
def cash_today():
    owner()
    return jsonify(cash_summary())


@bp.post('/cash/close')
def close_cash():
    owner()
    body = json_body()
    Branch.query.filter_by(id=g.branch_id).with_for_update().first()
    summary = cash_summary()
    if summary['closing']:
        raise ApiError('ALREADY_CLOSED', 'ปิดเงินวันนี้แล้ว')
    opening, counted = money(body.get('opening', 0)), money(body.get('counted'))
    close = CashClose(branch_id=g.branch_id, user_id=g.user.id, business_date=local_today(),
        opening=opening, expected=opening + summary['cash'], counted=counted, note=body.get('note', '')[:500])
    db.session.add(close)
    db.session.commit()
    return jsonify(close.to_json()), 201


@bp.get('/audit')
def audit():
    owner()
    entries = AuditEvent.query.filter_by(branch_id=g.branch_id).order_by(AuditEvent.id.desc()).limit(100)
    return jsonify([{'id': e.id, 'userId': e.user_id, 'action': e.action, 'requestId': e.request_id,
                     'createdAt': e.created_at.isoformat() + 'Z'} for e in entries])
