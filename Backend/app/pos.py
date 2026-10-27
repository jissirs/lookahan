"""Atomic order editing, table moves, item splits and bill merges."""
import json
from decimal import Decimal
from datetime import timedelta
from flask import Blueprint, current_app, g, jsonify
from . import db
from .models import Branch, Order, OrderItem, OrderUsage, Ingredient, BatchAllocation
from .restaurant import fingerprint, order_lines, owner, request_key
from .restaurant_models import CashClose
from .service_models import PosCommand
from .inventory_policy import money, receive
from .tools import ApiError, find_mine, is_whole_number, json_body, to_id
from .routes.orders import change_stock, load_menus, next_order_number, read_wanted_items

bp = Blueprint('pos', __name__)


def text_field(body, key, default='', limit=500):
    value = body.get(key, default)
    if not isinstance(value, str) or len(value) > limit:
        raise ApiError('VALIDATION', 'ข้อความ ' + key + ' ไม่ถูกต้องหรือยาวเกินกำหนด')
    return value.strip()


def command(action, work):
    body = json_body()
    key = request_key(body)
    Branch.query.filter_by(id=g.branch_id).with_for_update().first()
    digest = fingerprint({'action': action, 'body': {k: v for k, v in body.items() if k not in ('password', 'newPassword')}})
    previous = PosCommand.query.filter_by(branch_id=g.branch_id, request_key=key).with_for_update().first()
    if previous:
        if previous.digest != digest:
            raise ApiError('CONFLICT', 'รหัสคำขอนี้ถูกใช้กับรายการอื่นแล้ว', 409)
        return jsonify(previous.result)
    result = json.loads(current_app.json.dumps(work(body)))
    db.session.add(PosCommand(branch_id=g.branch_id, request_key=key, digest=digest, result=result))
    db.session.commit()
    return jsonify(result)


def revision(order, body):
    if not is_whole_number(body.get('revision')) or body['revision'] != (order.revision or 1):
        raise ApiError('STALE_ORDER', 'ออเดอร์เปลี่ยนจากอีกเครื่องแล้ว กรุณาโหลดข้อมูลใหม่', 409)


def mutable(order, before_cooking=False):
    if order.status not in (('new',) if before_cooking else ('new', 'cooking', 'ready')):
        raise ApiError('VALIDATION', 'รายการนี้ทำได้เฉพาะออเดอร์ที่ยังไม่จบ' + (' และยังไม่เริ่มทำ' if before_cooking else ''))
    day = (order.created_at + timedelta(hours=current_app.config['TIMEZONE_OFFSET_HOURS'])).date()
    if CashClose.query.filter_by(branch_id=g.branch_id, business_date=day).first():
        raise ApiError('ALREADY_CLOSED', 'ปิดเงินของวันออเดอร์นี้แล้ว ไม่สามารถแก้ยอดย้อนหลัง')


def unpaid(order):
    if any(p.amount != 0 for p in order.payments) or order.discount:
        raise ApiError('VALIDATION', 'รายการนี้ต้องยังไม่มีประวัติรับเงิน/คืนเงินหรือส่วนลด ใช้แบ่งชำระแทนได้')


def ingredient_order_cost(order, ingredient_id):
    expected = sum(x.quantity for x in order.usage if x.ingredient_id == ingredient_id)
    rows = BatchAllocation.query.join(BatchAllocation.batch).filter(
        BatchAllocation.order_id == order.id, BatchAllocation.batch.has(ingredient_id=ingredient_id)).all()
    if sum(x.quantity for x in rows) != expected or any(x.unit_cost is None for x in rows):
        return None
    return sum((x.quantity * x.unit_cost for x in rows), Decimal(0))


def order_cost(order):
    values = [ingredient_order_cost(order, x.ingredient_id) for x in order.usage]
    return None if any(x is None for x in values) else sum(values, Decimal(0))


def return_partial(item, order, quantity):
    rows = BatchAllocation.query.join(BatchAllocation.batch).filter(
        BatchAllocation.order_id == order.id, BatchAllocation.batch.has(ingredient_id=item.id)).order_by(BatchAllocation.id.desc()).all()
    for row in rows:
        restored = min(quantity, row.quantity)
        row.batch.remaining += restored
        row.quantity -= restored
        quantity -= restored
        if not row.quantity:
            db.session.delete(row)
        if not quantity:
            break
    if quantity:  # Legacy order with quantities but no batch allocation history.
        receive(item, quantity, label='คืนจากออเดอร์เดิม / ไม่ทราบล็อต')


@bp.post('/orders/<order_id>/edit')
def edit_order(order_id):
    def work(body):
        order = find_mine(Order, order_id, 'order')
        revision(order, body); mutable(order, True); unpaid(order)
        menus = load_menus(read_wanted_items(body.get('items')))
        lines, needed = order_lines(body['items'], menus)
        if 'expectedTotal' in body and money(body['expectedTotal']) != sum((x['price'] * x['qty'] for x in lines), Decimal(0)):
            raise ApiError('PRICE_CHANGED', 'ราคาเปลี่ยนแล้ว กรุณาตรวจราคาและยืนยันอีกครั้ง', 409)
        previous = {x.ingredient_id: x for x in order.usage}
        for key in sorted(set(previous) | set(needed)):
            item = Ingredient.query.filter_by(id=key, branch_id=g.branch_id).with_for_update().first()
            wanted = needed.get(key, 0)
            if not item or (wanted and item.deleted_at):
                raise ApiError('NOT_FOUND', 'วัตถุดิบไม่มีอยู่แล้ว')
            original = previous[key].quantity if key in previous else 0
            delta = original - wanted
            if delta > 0:
                return_partial(item, order, delta)
                change_stock(item, delta, 'Add', 'แก้ออเดอร์ #' + order.number, batch_restored=True)
            elif delta < 0:
                change_stock(item, delta, 'Order', 'แก้ออเดอร์ #' + order.number, order=order)
            if key in previous:
                if wanted:
                    previous[key].quantity = wanted
                else:
                    order.usage.remove(previous[key])
            elif wanted:
                order.usage.append(OrderUsage(ingredient_id=key, quantity=wanted))
        order.items = [OrderItem(**line) for line in lines]
        order.gross_total = order.total = sum((x['price'] * x['qty'] for x in lines), Decimal(0))
        order.note = text_field(body, 'note', order.note)
        service, table = body.get('serviceType', order.service_type), text_field(body, 'tableLabel', order.table_label, 30)
        if service not in ('dine_in', 'takeaway') or len(table) > 30 or (service == 'dine_in' and not table):
            raise ApiError('VALIDATION', 'กรุณาระบุโต๊ะให้ถูกต้อง')
        order.service_type, order.table_label = service, table if service == 'dine_in' else ''
        order.revision = (order.revision or 1) + 1
        db.session.flush()
        order.ingredient_cost = order_cost(order)
        return {'order': order.to_json()}
    return command('edit/' + str(order_id), work)


@bp.post('/orders/<order_id>/table')
def move_table(order_id):
    def work(body):
        order = find_mine(Order, order_id, 'order'); revision(order, body); mutable(order)
        service, table = body.get('serviceType'), text_field(body, 'tableLabel', limit=30)
        if service not in ('dine_in', 'takeaway') or len(table) > 30 or (service == 'dine_in' and not table):
            raise ApiError('VALIDATION', 'กรุณาระบุโต๊ะ/กลับบ้านให้ถูกต้อง')
        order.service_type, order.table_label = service, table if service == 'dine_in' else ''
        order.revision = (order.revision or 1) + 1
        return {'order': order.to_json()}
    return command('table/' + str(order_id), work)


@bp.post('/orders/<order_id>/discount')
def discount(order_id):
    owner()
    def work(body):
        order = find_mine(Order, order_id, 'order'); revision(order, body); mutable(order)
        amount = money(body.get('amount'))
        reason = body.get('reason')
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 200:
            raise ApiError('VALIDATION', 'กรุณาระบุเหตุผลปรับส่วนลด')
        gross = order.gross_total if order.gross_total is not None else order.total + (order.discount or 0)
        net = sum((p.amount for p in order.payments), Decimal(0))
        if amount > gross or gross - amount < net:
            raise ApiError('VALIDATION', 'ส่วนลดมากกว่ายอดขาย หรือทำให้ยอดต่ำกว่าเงินที่รับแล้ว')
        order.gross_total, order.discount, order.total = gross, amount, gross - amount
        order.discount_reason = reason.strip()
        order.revision = (order.revision or 1) + 1
        return {'order': order.to_json()}
    return command('discount/' + str(order_id), work)


def clone_item(item, quantity):
    return OrderItem(menu_id=item.menu_id, name=item.name, price=item.price, qty=quantity,
        modifiers=item.modifiers, note=item.note, recipe_snapshot=item.recipe_snapshot)


@bp.post('/orders/<order_id>/split')
def split_bill(order_id):
    def work(body):
        order = find_mine(Order, order_id, 'order'); revision(order, body); mutable(order, True); unpaid(order)
        selected = body.get('lines')
        if not isinstance(selected, list) or not selected:
            raise ApiError('VALIDATION', 'เลือกอาหารที่ต้องการแยกบิล')
        by_id = {x.id: x for x in order.items}
        wanted, needed = {}, {}
        for entry in selected:
            if not isinstance(entry, dict):
                raise ApiError('VALIDATION', 'รายการแยกบิลไม่ถูกต้อง')
            key, qty = to_id(entry.get('itemId')), entry.get('qty')
            item = by_id.get(key)
            if not item or key in wanted or not is_whole_number(qty) or not 1 <= qty <= item.qty:
                raise ApiError('VALIDATION', 'จำนวนแยกบิลไม่ถูกต้อง')
            if item.recipe_snapshot is None:
                raise ApiError('VALIDATION', 'ออเดอร์เก่าไม่มีสูตร ณ ตอนสั่ง ใช้แบ่งชำระตามจำนวนเงินแทน')
            wanted[key] = qty
            for ingredient_id, amount in item.recipe_snapshot.items():
                key2 = int(ingredient_id)
                needed[key2] = needed.get(key2, 0) + amount * qty
        if sum(wanted.values()) >= sum(x.qty for x in order.items):
            raise ApiError('VALIDATION', 'ต้องเหลืออาหารในบิลเดิมอย่างน้อยหนึ่งจาน')
        child = Order(branch_id=g.branch_id, number=next_order_number(), created_by=g.user.id, status='new',
            total=0, service_type=order.service_type, table_label=order.table_label, split_from=order.id, note=order.note)
        db.session.add(child); db.session.flush()
        for key, qty in wanted.items():
            item = by_id[key]
            child.items.append(clone_item(item, qty))
            item.qty -= qty
            if not item.qty:
                order.items.remove(item)
        for key, qty in sorted(needed.items()):
            use = next((x for x in order.usage if x.ingredient_id == key), None)
            if not use or use.quantity < qty:
                raise ApiError('VALIDATION', 'ข้อมูลใช้วัตถุดิบไม่ครบ ไม่สามารถแยกบิล')
            use.quantity -= qty
            if not use.quantity:
                order.usage.remove(use)
            child.usage.append(OrderUsage(ingredient_id=key, quantity=qty))
            left = qty
            rows = BatchAllocation.query.join(BatchAllocation.batch).filter(BatchAllocation.order_id == order.id,
                BatchAllocation.batch.has(ingredient_id=key)).order_by(BatchAllocation.id).all()
            for allocation in rows:
                moved = min(left, allocation.quantity)
                child_allocation = BatchAllocation(order_id=child.id, batch_id=allocation.batch_id, quantity=moved, unit_cost=allocation.unit_cost)
                if moved:
                    db.session.add(child_allocation)
                    allocation.quantity -= moved; left -= moved
                    if not allocation.quantity:
                        db.session.delete(allocation)
                if not left:
                    break
            if left:
                raise ApiError('VALIDATION', 'ข้อมูลล็อตไม่ครบ ไม่สามารถแยกบิลนี้')
        for bill in (order, child):
            bill.total = bill.gross_total = sum((x.price * x.qty for x in bill.items), Decimal(0))
        order.revision = (order.revision or 1) + 1
        db.session.flush()
        order.ingredient_cost, child.ingredient_cost = order_cost(order), order_cost(child)
        return {'order': order.to_json(), 'child': child.to_json()}
    return command('split/' + str(order_id), work)


@bp.post('/orders/<order_id>/merge')
def merge_bill(order_id):
    def work(body):
        target = find_mine(Order, order_id, 'order'); revision(target, body); mutable(target); unpaid(target)
        source = find_mine(Order, body.get('sourceId'), 'order'); mutable(source); unpaid(source)
        if target.id == source.id or target.status != source.status:
            raise ApiError('VALIDATION', 'ต้องเป็นคนละออเดอร์และอยู่ขั้นตอนเดียวกัน')
        if body.get('sourceRevision') != (source.revision or 1):
            raise ApiError('STALE_ORDER', 'บิลต้นทางเปลี่ยนแล้ว กรุณาโหลดใหม่', 409)
        totals = {}
        for item in target.items + source.items:
            totals[item.menu_id] = totals.get(item.menu_id, 0) + item.qty
        if any(qty > 99 for qty in totals.values()):
            raise ApiError('VALIDATION', 'รวมแล้วเกิน 99 จานต่อเมนู')
        target.items.extend(clone_item(x, x.qty) for x in source.items)
        for use in list(source.usage):
            existing = next((x for x in target.usage if x.ingredient_id == use.ingredient_id), None)
            if existing:
                existing.quantity += use.quantity
            else:
                target.usage.append(OrderUsage(ingredient_id=use.ingredient_id, quantity=use.quantity))
            source.usage.remove(use)
        for row in BatchAllocation.query.filter_by(order_id=source.id).all():
            row.order_id = target.id
        target.total = target.gross_total = sum((x.price * x.qty for x in target.items), Decimal(0))
        target.revision = (target.revision or 1) + 1
        source.status, source.cancellation_mode, source.transferred_to = 'cancelled', 'merged', target.id
        source.revision = (source.revision or 1) + 1
        db.session.flush()
        target.ingredient_cost = order_cost(target)
        return {'order': target.to_json(), 'source': source.to_json()}
    return command('merge/' + str(order_id), work)
