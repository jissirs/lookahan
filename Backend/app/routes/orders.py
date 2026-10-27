"""ออเดอร์ (ตัด/คืน stock) และตัวเลขสรุปหน้าแรก (สถิติวันนี้ + ผลพยากรณ์ของ AI)

    GET  /orders                  รายการออเดอร์ (ใหม่ → เก่า)
    POST /orders                  สร้างออเดอร์ + ตัด stock
    POST /orders/<id>/advance     เลื่อนสถานะ: new → cooking → ready → done
    POST /orders/<id>/cancel      ยกเลิก + คืน stock
    GET  /dashboard/summary       สถิติของ "วันนี้" (คำนวณจากออเดอร์จริง) + ผลพยากรณ์ของ AI (null ถ้ายังไม่เคยวิเคราะห์)

หัวใจของออเดอร์คือ "ทำทุกอย่างสำเร็จพร้อมกัน หรือไม่ก็ไม่ทำเลย":
เราแก้ข้อมูลหลายอย่างในหน่วยความจำ แล้ว commit ครั้งเดียวตอนท้าย
ถ้ามีอะไรผิดกลางทาง จะโยน ApiError และระบบยกเลิกทุกอย่างให้ (rollback) stock จึงไม่เพี้ยน
"""
from datetime import timedelta

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy.orm import selectinload

from .. import db
from ..forecast import build_outlook, historical_modifier_rates
from ..inventory_policy import consume, receive, restore
from ..models import Branch, Forecast, Ingredient, Menu, Movement, Order, OrderItem, OrderUsage, now
from ..tools import ApiError, find_mine, is_whole_number, json_body, to_id
from .notifications import add_notification, notify_stock_change

bp = Blueprint('orders', __name__)

# สถานะถัดไปที่เดินหน้าได้ (ข้ามขั้นหรือถอยหลังไม่ได้)
NEXT_STATUS = {'new': 'cooking', 'cooking': 'ready', 'ready': 'done'}


# ---------------------------------------------------------------- ฟังก์ชันย่อยของ "สร้างออเดอร์"

def read_wanted_items(items):
    """ขั้นที่ 1: อ่านรายการที่สั่ง แล้วคืนเป็น {id เมนู: จำนวน} (เมนูซ้ำรวมกัน, จำนวน 0 ข้ามไป)"""
    if not isinstance(items, list):
        raise ApiError('VALIDATION', 'กรุณาเลือกเมนูอย่างน้อย 1 รายการ')

    wanted = {}
    for item in items:
        if not isinstance(item, dict):
            raise ApiError('VALIDATION', 'รายการเมนูไม่ถูกต้อง')
        qty = item.get('qty')
        if not is_whole_number(qty) or qty < 0 or qty > 99:
            raise ApiError('VALIDATION', 'จำนวนต้องเป็นจำนวนเต็ม 1 ถึง 99')
        if qty > 0:
            menu_id = to_id(item.get('menuId'), 'menu')
            wanted[menu_id] = wanted.get(menu_id, 0) + qty
            if wanted[menu_id] > 99:
                raise ApiError('VALIDATION', 'จำนวนรวมต่อเมนูต้องไม่เกิน 99')

    if len(wanted) == 0:
        raise ApiError('VALIDATION', 'กรุณาเลือกเมนูอย่างน้อย 1 รายการ')
    return wanted


def load_menus(wanted):
    """ขั้นที่ 2: หาเมนูที่สั่ง — ต้องมีอยู่จริงและเปิดขายอยู่ คืนเป็น {id เมนู: เมนู}"""
    menus = {}
    for menu_id in wanted:
        menu = find_mine(Menu, menu_id, 'menu')
        if not menu.available:
            raise ApiError('VALIDATION', 'เมนู "%s" ปิดขายอยู่' % menu.name)
        menus[menu_id] = menu
    return menus


def sum_ingredients_needed(wanted, menus):
    """ขั้นที่ 3: รวมวัตถุดิบที่ต้องใช้ทั้งออเดอร์ คืนเป็น {id วัตถุดิบ: จำนวนรวม}
    (เมนูต่างกันอาจใช้วัตถุดิบตัวเดียวกัน จึงต้องบวกรวมก่อนค่อยตรวจว่าพอไหม)"""
    needed = {}
    for menu_id, qty in wanted.items():
        for line in menus[menu_id].recipe:
            needed[line.ingredient_id] = needed.get(line.ingredient_id, 0) + line.quantity * qty
    return needed


def load_ingredients_and_check_enough(needed):
    """ขั้นที่ 4: หาวัตถุดิบและตรวจว่าพอทุกตัว — ไม่พอตัวไหนก็แจ้งทั้งหมดในข้อความเดียว
    (with_for_update = ล็อกแถวไว้ กันสองออเดอร์ตัด stock ตัวเดียวกันพร้อมกัน)"""
    ingredients = {}
    lacking = []
    for ingredient_id, quantity in sorted(needed.items()):
        # [R] READ: ดึงแถววัตถุดิบมาดูจำนวนคงเหลือ (with_for_update = SELECT ... FOR UPDATE ล็อกแถวไว้จนกว่าจะ commit)
        ingredient = Ingredient.query.filter_by(id=ingredient_id, branch_id=g.branch_id, deleted_at=None).with_for_update().first()
        ingredients[ingredient_id] = ingredient
        if ingredient is None or ingredient.usable_quantity < quantity:
            have = ingredient.usable_quantity if ingredient else 0
            name = ingredient.name if ingredient else str(ingredient_id)
            lacking.append('%s (ต้องใช้ %s เหลือ %s)' % (name, quantity, have))

    if lacking:
        raise ApiError('INSUFFICIENT_STOCK', 'วัตถุดิบไม่พอ: ' + ', '.join(lacking))
    return ingredients


def next_order_number():
    """เลขออเดอร์ถัดไปของสาขา เช่น "0163" (เอาเลขมากสุดที่มี + 1)"""
    highest = 0
    # [R] READ: ออเดอร์ทุกแถวของสาขานี้ (เอามาหาเลขมากสุด)
    for order in Order.query.filter_by(branch_id=g.branch_id).all():
        highest = max(highest, int(order.number))
    return str(highest + 1).zfill(4)


def change_stock(ingredient, amount, move_type, label, order=None, batch_restored=False):
    """เปลี่ยน stock ของวัตถุดิบ (+ เพิ่ม, - ลด) พร้อมจดประวัติ คืนประวัติที่สร้าง"""
    # [U] UPDATE: แก้จำนวนคงเหลือในแถววัตถุดิบเดิม (ยังไม่บันทึกจริง — ฟังก์ชันที่เรียกเป็นคน commit)
    old_usable = ingredient.usable_quantity
    cost = None
    if amount < 0:
        cost = consume(ingredient, -amount, order=order, allow_expired=move_type != 'Order')
    elif not batch_restored:
        receive(ingredient, amount, label=label)
    old_quantity = ingredient.quantity
    ingredient.quantity += amount
    notify_stock_change(ingredient, old_usable)
    # [C] CREATE: เพิ่มแถวประวัติใหม่ในตาราง movements (วางลงถาด session รอ commit)
    movement = Movement(
        ingredient_id=ingredient.id, user_id=g.user.id, type=move_type,
        label=label, amount=amount, balance=ingredient.quantity, cost=cost,
    )
    db.session.add(movement)
    return movement


def stock_result(order, ingredients, movements):
    """คำตอบที่หน้าเว็บต้องการ: ออเดอร์ + วัตถุดิบที่เปลี่ยน + ประวัติใหม่ (ให้หน้าเว็บอัปเดตตาม)"""
    return {
        'order': order.to_json(),
        'ingredients': [item.to_json() for item in ingredients],
        'movements': [move.to_json() for move in movements],
    }


# ---------------------------------------------------------------- เส้นทาง

@bp.get('/orders')
def list_orders():
    # [R] READ: ออเดอร์ทุกแถวของสาขานี้ เรียงเลขออเดอร์ใหม่ → เก่า
    orders = Order.query.options(selectinload(Order.items), selectinload(Order.usage)).filter_by(branch_id=g.branch_id).order_by(Order.number.desc()).all()
    return jsonify([order.to_json() for order in orders])


@bp.post('/orders')
def create_order():
    body = json_body()

    # ตรวจก่อน ยังไม่แก้อะไรทั้งนั้น: ถ้าผิดกฎจะหยุดตรงนี้ stock ยังไม่ถูกแตะ
    # Lock a branch while allocating a number; concurrent clients cannot choose the same number.
    Branch.query.filter_by(id=g.branch_id).with_for_update().first()
    from ..restaurant import fingerprint, order_lines, request_key
    key = request_key(body) if 'requestKey' in body else None
    digest = fingerprint(body)
    if key:
        previous = Order.query.filter_by(branch_id=g.branch_id, request_key=key).with_for_update().first()
        if previous:
            if previous.request_hash != digest:
                raise ApiError('CONFLICT', 'รหัสคำขอถูกใช้กับรายการอื่นแล้ว', 409)
            return jsonify(stock_result(previous, [], []))
    wanted = read_wanted_items(body.get('items'))
    menus = load_menus(wanted)
    lines, needed = order_lines(body['items'], menus)
    ingredients = load_ingredients_and_check_enough(needed)
    service = body.get('serviceType', 'takeaway')
    raw_table = body.get('tableLabel', '')
    if not isinstance(raw_table, str):
        raise ApiError('VALIDATION', 'ชื่อโต๊ะไม่ถูกต้อง')
    table = raw_table.strip()
    if service not in ('dine_in', 'takeaway') or len(table) > 30 or (service == 'dine_in' and not table):
        raise ApiError('VALIDATION', 'กรุณาระบุประเภทออเดอร์และโต๊ะให้ถูกต้อง')

    # สร้างออเดอร์ — total=0 ต้องใส่เอง เพราะเราบวกราคาเพิ่มก่อนบันทึก (ค่าเริ่มต้นของคอลัมน์มีผลตอนบันทึกเท่านั้น)
    # [C] CREATE: สร้างออเดอร์ใหม่ (ตาราง orders) พร้อมรายการเมนู (order_items) และวัตถุดิบที่ตัด (order_usage)
    # ทุกอย่างวางลงถาด session ก่อน แล้ว commit ครั้งเดียวท้ายสุด — ผิดกลางทางก็ไม่มีอะไรถูกบันทึก
    order = Order(branch_id=g.branch_id, number=next_order_number(), created_by=g.user.id,
                  status='new', total=0, note=str(body.get('note') or '').strip(),
                  request_key=key, request_hash=digest, service_type=service, table_label=table if service == 'dine_in' else '')
    for line in lines:
        order.items.append(OrderItem(**line))
        order.total += line['price'] * line['qty']
    if 'expectedTotal' in body:
        from ..inventory_policy import money
        if money(body['expectedTotal']) != order.total:
            raise ApiError('PRICE_CHANGED', 'ราคาเปลี่ยนแล้ว กรุณาตรวจราคาและยืนยันออเดอร์ใหม่', 409)

    # ตัด stock + จดประวัติ + จำไว้ว่าตัดอะไรไป (เอาไว้คืนตอนยกเลิก)
    db.session.add(order)
    db.session.flush()
    movements = []
    for ingredient_id, quantity in sorted(needed.items()):
        ingredient = ingredients[ingredient_id]
        movements.append(change_stock(ingredient, -quantity, 'Order', 'Order #' + order.number, order=order))
        order.usage.append(OrderUsage(ingredient_id=ingredient.id, quantity=quantity))
    order.gross_total = order.total
    order.ingredient_cost = None if any(m.cost is None for m in movements) else sum((m.cost for m in movements), 0)

    # [C] แจ้งเตือน "มีออเดอร์ใหม่" ให้ทุกคนในสาขา (บันทึกพร้อมออเดอร์ในครั้งเดียว)
    add_notification('order_new', 'info', 'มีออเดอร์ใหม่ #' + order.number,
                     'ยอดรวม ฿%s (%s รายการ)' % (order.total, len(order.items)), '/order')

    db.session.add(order)
    db.session.commit()  # บันทึกทุกอย่างพร้อมกัน
    return jsonify(stock_result(order, ingredients.values(), movements)), 201


@bp.post('/orders/<order_id>/advance')
def advance_order(order_id):
    Branch.query.filter_by(id=g.branch_id).with_for_update().first()
    # [R] READ: ดึงแถวออเดอร์ที่จะเลื่อนสถานะ
    order = Order.query.filter_by(id=order_id, branch_id=g.branch_id).with_for_update().first()
    if order is None:
        raise ApiError('NOT_FOUND', 'ไม่พบออเดอร์')

    next_status = NEXT_STATUS.get(order.status)
    if next_status is None:  # done หรือ cancelled แล้ว ไปต่อไม่ได้
        raise ApiError('VALIDATION', 'ออเดอร์นี้เปลี่ยนสถานะต่อไม่ได้แล้ว')

    # [U] UPDATE: แก้ช่อง status ของแถวออเดอร์เดิม แล้ว commit
    order.status = next_status
    order.revision = (order.revision or 1) + 1
    if next_status == 'ready':  # [C] ออเดอร์พร้อมเสิร์ฟ → แจ้งทุกคนในสาขา
        add_notification('order_ready', 'info', 'ออเดอร์ #%s พร้อมเสิร์ฟ' % order.number, '', '/order')
    db.session.commit()
    return jsonify(order.to_json())


@bp.post('/orders/<order_id>/cancel')
def cancel_order(order_id):
    Branch.query.filter_by(id=g.branch_id).with_for_update().first()
    # [R] READ: ดึงแถวออเดอร์ที่จะยกเลิก
    order = Order.query.filter_by(id=order_id, branch_id=g.branch_id).with_for_update().first()
    if order is None:
        raise ApiError('NOT_FOUND', 'ไม่พบออเดอร์')
    if order.status in ('done', 'cancelled'):
        raise ApiError('VALIDATION', 'ออเดอร์ที่เสร็จสิ้นหรือยกเลิกแล้วยกเลิกซ้ำไม่ได้')
    if sum((p.amount for p in order.payments), 0) > 0:
        raise ApiError('VALIDATION', 'กรุณาให้เจ้าของร้านคืนเงินก่อนยกเลิกออเดอร์')

    body = json_body() if request.is_json else {}
    reason = body.get('reason', 'ยกเลิกออเดอร์')
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 200:
        raise ApiError('VALIDATION', 'กรุณาระบุเหตุผลยกเลิกไม่เกิน 200 ตัวอักษร')
    restore_stock = order.status == 'new'
    # After cooking begins, stock is already consumed; cancellation records waste instead.
    ingredients = []
    movements = []
    for use in sorted(order.usage, key=lambda row: row.ingredient_id):
        # [R] READ: ดึงแถววัตถุดิบจาก id ตรง ๆ (db.session.get เร็วกว่า query เมื่อรู้ id)
        ingredient = Ingredient.query.filter_by(id=use.ingredient_id, branch_id=g.branch_id).with_for_update().first()
        ingredients.append(ingredient)
        if restore_stock:
            movements.append(change_stock(ingredient, use.quantity, 'Add', 'Cancel #' + order.number, batch_restored=restore(ingredient, order)))
        else:
            from ..service_models import WasteRecord
            from ..pos import ingredient_order_cost
            db.session.add(WasteRecord(branch_id=g.branch_id, user_id=g.user.id, ingredient_id=ingredient.id,
                order_id=order.id, quantity=use.quantity, cost=ingredient_order_cost(order, ingredient.id),
                reason='cooking_cancel', note=reason))

    # [U] UPDATE: ยกเลิก = "เปลี่ยนสถานะ" ไม่ได้ลบแถว (ประวัติออเดอร์ต้องอยู่ครบ) — ทั้งการคืน stock ด้านบนและบรรทัดนี้ commit พร้อมกัน
    order.status = 'cancelled'
    order.cancellation_mode = 'restocked' if restore_stock else 'waste'
    order.cancellation_reason = reason.strip()
    order.revision = (order.revision or 1) + 1
    # [C] แจ้งว่าออเดอร์ถูกยกเลิก (ใช้ระดับเหลือง เพราะเป็นเรื่องที่ควรสังเกต)
    add_notification('order_cancelled', 'warn', 'ออเดอร์ #%s ถูกยกเลิก' % order.number,
                     'คืน stock ให้แล้ว' if restore_stock else 'เริ่มทำแล้ว บันทึกเป็นของเสีย ไม่คืนสต๊อก', '/order')
    db.session.commit()
    return jsonify(stock_result(order, ingredients, movements))


# =====================================================================
#  สรุปหน้าแรก (dashboard)
# =====================================================================
def today_range():
    """ช่วงเวลาของ "วันนี้" ตามเวลาท้องถิ่น (ปรับด้วย TIMEZONE_OFFSET_HOURS) แต่คืนเป็นเวลา UTC เพื่อเทียบกับฐานข้อมูล"""
    offset = timedelta(hours=current_app.config['TIMEZONE_OFFSET_HOURS'])
    local_now = now() + offset
    start_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_local - offset, start_local - offset + timedelta(days=1)


@bp.get('/dashboard/summary')
def summary():
    start, end = today_range()
    # [R] READ: ออเดอร์ของ "วันนี้" ที่ไม่ได้ยกเลิก (เงื่อนไข filter หลายข้อ = AND)
    todays_orders = Order.query.options(selectinload(Order.items)).filter(
        Order.branch_id == g.branch_id,
        Order.created_at >= start,
        Order.created_at < end,
        Order.status != 'cancelled',  # ออเดอร์ที่ยกเลิกไม่นับ
    ).all()

    # รายได้รวม + นับว่าเมนูไหนขายได้จำนวนมากสุด
    revenue = 0
    sold_by_menu = {}
    for order in todays_orders:
        revenue += order.total
        for item in order.items:
            sold_by_menu[item.name] = sold_by_menu.get(item.name, 0) + item.qty

    best_seller = '-'
    if sold_by_menu:
        best_seller = max(sold_by_menu, key=sold_by_menu.get)

    # [R] READ: ผลพยากรณ์ล่าสุดของสาขา (ตาราง forecasts มีสาขาละ 1 แถว ไม่มีก็ได้ None)
    forecast = Forecast.query.filter_by(branch_id=g.branch_id).first()
    payload = dict(forecast.payload) if forecast else None
    if payload:
        # ใช้ config และ stock ปัจจุบันทันที โดยไม่ต้องเรียก AI ซ้ำหรือเขียนทับประวัติ
        past = Order.query.options(selectinload(Order.items)).filter(Order.branch_id == g.branch_id,
                                  Order.created_at >= now() - timedelta(days=30),
                                  Order.status != 'cancelled').all()
        dishes = {}
        for order in past:
            for item in order.items:
                dishes[item.name] = dishes.get(item.name, 0) + item.qty
        dishes_per_order = sum(dishes.values()) / len(past) if past else 1
        shares = {row['category']: row['share'] for row in payload.get('categories', [])}
        current_menus = Menu.query.options(selectinload(Menu.recipe)).filter_by(branch_id=g.branch_id).all()
        _, payload['outlook'] = build_outlook(
            current_menus,
            Ingredient.query.filter_by(branch_id=g.branch_id, deleted_at=None).order_by(Ingredient.id).all(),
            payload['orders'], shares, dishes, dishes_per_order, modifier_rates=historical_modifier_rates(past, current_menus))
    return jsonify({
        'statistics': {'orders': len(todays_orders), 'revenue': revenue, 'bestSeller': best_seller},
        'forecast': payload,
    })
