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

from flask import Blueprint, current_app, g, jsonify

from .. import db
from ..models import Forecast, Ingredient, Menu, Movement, Order, OrderItem, OrderUsage, now
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
        qty = item.get('qty')
        if not is_whole_number(qty) or qty < 0 or qty > 99:
            raise ApiError('VALIDATION', 'จำนวนต้องเป็นจำนวนเต็ม 1 ถึง 99')
        if qty > 0:
            menu_id = to_id(item.get('menuId'), 'menu')
            wanted[menu_id] = wanted.get(menu_id, 0) + qty

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
    for ingredient_id, quantity in needed.items():
        # [R] READ: ดึงแถววัตถุดิบมาดูจำนวนคงเหลือ (with_for_update = SELECT ... FOR UPDATE ล็อกแถวไว้จนกว่าจะ commit)
        ingredient = Ingredient.query.filter_by(id=ingredient_id, branch_id=g.branch_id).with_for_update().first()
        ingredients[ingredient_id] = ingredient
        if ingredient is None or ingredient.quantity < quantity:
            have = ingredient.quantity if ingredient else 0
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


def change_stock(ingredient, amount, move_type, label):
    """เปลี่ยน stock ของวัตถุดิบ (+ เพิ่ม, - ลด) พร้อมจดประวัติ คืนประวัติที่สร้าง"""
    # [U] UPDATE: แก้จำนวนคงเหลือในแถววัตถุดิบเดิม (ยังไม่บันทึกจริง — ฟังก์ชันที่เรียกเป็นคน commit)
    old_quantity = ingredient.quantity
    ingredient.quantity += amount
    notify_stock_change(ingredient, old_quantity)  # [C] ถ้า stock แย่ลงจนข้ามเกณฑ์ → สร้างแจ้งเตือน
    # [C] CREATE: เพิ่มแถวประวัติใหม่ในตาราง movements (วางลงถาด session รอ commit)
    movement = Movement(
        ingredient_id=ingredient.id, user_id=g.user.id, type=move_type,
        label=label, amount=amount, balance=ingredient.quantity,
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
    orders = Order.query.filter_by(branch_id=g.branch_id).order_by(Order.number.desc()).all()
    return jsonify([order.to_json() for order in orders])


@bp.post('/orders')
def create_order():
    body = json_body()

    # ตรวจก่อน ยังไม่แก้อะไรทั้งนั้น: ถ้าผิดกฎจะหยุดตรงนี้ stock ยังไม่ถูกแตะ
    wanted = read_wanted_items(body.get('items'))
    menus = load_menus(wanted)
    needed = sum_ingredients_needed(wanted, menus)
    ingredients = load_ingredients_and_check_enough(needed)

    # สร้างออเดอร์ — total=0 ต้องใส่เอง เพราะเราบวกราคาเพิ่มก่อนบันทึก (ค่าเริ่มต้นของคอลัมน์มีผลตอนบันทึกเท่านั้น)
    # [C] CREATE: สร้างออเดอร์ใหม่ (ตาราง orders) พร้อมรายการเมนู (order_items) และวัตถุดิบที่ตัด (order_usage)
    # ทุกอย่างวางลงถาด session ก่อน แล้ว commit ครั้งเดียวท้ายสุด — ผิดกลางทางก็ไม่มีอะไรถูกบันทึก
    order = Order(branch_id=g.branch_id, number=next_order_number(), created_by=g.user.id,
                  status='new', total=0, note=str(body.get('note') or '').strip())
    for menu_id, qty in wanted.items():
        menu = menus[menu_id]
        order.items.append(OrderItem(menu_id=menu.id, name=menu.name, price=menu.price, qty=qty))
        order.total += menu.price * qty

    # ตัด stock + จดประวัติ + จำไว้ว่าตัดอะไรไป (เอาไว้คืนตอนยกเลิก)
    movements = []
    for ingredient_id, quantity in needed.items():
        ingredient = ingredients[ingredient_id]
        movements.append(change_stock(ingredient, -quantity, 'Order', 'Order #' + order.number))
        order.usage.append(OrderUsage(ingredient_id=ingredient.id, quantity=quantity))

    # [C] แจ้งเตือน "มีออเดอร์ใหม่" ให้ทุกคนในสาขา (บันทึกพร้อมออเดอร์ในครั้งเดียว)
    add_notification('order_new', 'info', 'มีออเดอร์ใหม่ #' + order.number,
                     'ยอดรวม ฿%s (%s รายการ)' % (order.total, len(order.items)), '/order')

    db.session.add(order)
    db.session.commit()  # บันทึกทุกอย่างพร้อมกัน
    return jsonify(stock_result(order, ingredients.values(), movements)), 201


@bp.post('/orders/<order_id>/advance')
def advance_order(order_id):
    # [R] READ: ดึงแถวออเดอร์ที่จะเลื่อนสถานะ
    order = find_mine(Order, order_id, 'order')

    next_status = NEXT_STATUS.get(order.status)
    if next_status is None:  # done หรือ cancelled แล้ว ไปต่อไม่ได้
        raise ApiError('VALIDATION', 'ออเดอร์นี้เปลี่ยนสถานะต่อไม่ได้แล้ว')

    # [U] UPDATE: แก้ช่อง status ของแถวออเดอร์เดิม แล้ว commit
    order.status = next_status
    if next_status == 'ready':  # [C] ออเดอร์พร้อมเสิร์ฟ → แจ้งทุกคนในสาขา
        add_notification('order_ready', 'info', 'ออเดอร์ #%s พร้อมเสิร์ฟ' % order.number, '', '/order')
    db.session.commit()
    return jsonify(order.to_json())


@bp.post('/orders/<order_id>/cancel')
def cancel_order(order_id):
    # [R] READ: ดึงแถวออเดอร์ที่จะยกเลิก
    order = find_mine(Order, order_id, 'order')
    if order.status in ('done', 'cancelled'):
        raise ApiError('VALIDATION', 'ออเดอร์ที่เสร็จสิ้นหรือยกเลิกแล้วยกเลิกซ้ำไม่ได้')

    # คืน stock ตามที่ตัดไปตอนสร้างออเดอร์
    ingredients = []
    movements = []
    for use in order.usage:
        # [R] READ: ดึงแถววัตถุดิบจาก id ตรง ๆ (db.session.get เร็วกว่า query เมื่อรู้ id)
        ingredient = db.session.get(Ingredient, use.ingredient_id)
        ingredients.append(ingredient)
        movements.append(change_stock(ingredient, use.quantity, 'Add', 'Cancel #' + order.number))

    # [U] UPDATE: ยกเลิก = "เปลี่ยนสถานะ" ไม่ได้ลบแถว (ประวัติออเดอร์ต้องอยู่ครบ) — ทั้งการคืน stock ด้านบนและบรรทัดนี้ commit พร้อมกัน
    order.status = 'cancelled'
    # [C] แจ้งว่าออเดอร์ถูกยกเลิก (ใช้ระดับเหลือง เพราะเป็นเรื่องที่ควรสังเกต)
    add_notification('order_cancelled', 'warn', 'ออเดอร์ #%s ถูกยกเลิก' % order.number, 'คืน stock ให้แล้ว', '/order')
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
    todays_orders = Order.query.filter(
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
    return jsonify({
        'statistics': {'orders': len(todays_orders), 'revenue': revenue, 'bestSeller': best_seller},
        'forecast': forecast.payload if forecast else None,
    })
