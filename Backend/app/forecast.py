"""งานฝั่ง "โค้ด" ของระบบพยากรณ์ AI — เตรียมข้อมูลให้ AI และตรวจคำตอบของ AI ก่อนใช้

ไฟล์นี้อยู่คู่กับ routes/ai.py (เส้นทาง + ตัวเรียก Groq) และ prompts.py (ข้อความสั่ง AI)

หน้าที่ของ AI ในระบบ (7 ข้อ) และใครรับผิดชอบส่วนไหน:
    1) พยากรณ์ออเดอร์รายชั่วโมงของพรุ่งนี้        AI คาดการณ์ → โค้ดรวมเลข/หาช่วงเยอะสุดเอง
    2) คาดเมนูขายดีที่สุด                         AI เลือก → โค้ดตรวจว่าเป็นเมนูที่เปิดขายจริง
    3) เช็กจำนวนรายการวัตถุดิบที่มี               โค้ดนับ (ปกติ/ใกล้หมด/วิกฤต) → AI เขียนสรุปสถานะ
    4) แจ้งเตือนวัตถุดิบใกล้หมด / ไม่พอทำเมนู      AI เลือกและเขียนข้อความ → โค้ดตรวจกับ stock จริงก่อนสร้างแจ้งเตือน
    5) พยากรณ์รายได้รายวัน (7 วัน)                AI คาดการณ์ → โค้ดตรวจความสมเหตุสมผลกับราคาเฉลี่ยต่อออเดอร์
    6) เขียนคำแนะนำภาษาไทย 3–4 ข้อ                AI เขียน
    7) คาดสัดส่วนประเภทเมนู                       AI คาดการณ์ → โค้ดปรับให้รวมเป็น 1

    8) เสนอ "เมนูพิเศษ" จากวัตถุดิบที่คาดว่าจะเหลือ   AI คิดเมนู → โค้ดตรวจวัตถุดิบ/ปริมาณ และกันราคาต่ำกว่าทุน

AI ถูกวัดผลและเรียนรู้จากผลจริง: โค้ดเก็บผลพยากรณ์ทุกวัน (forecast_history) แล้วเติมยอดจริงทีหลัง เพื่อ
    - แสดงความแม่นยำที่หน้า Ai (เทียบกับค่าสถิติธรรมดา ว่า AI ดีกว่าจริงไหม)
    - บอก AI ในครั้งต่อไปว่า "ครั้งก่อนพยากรณ์คลาดไปเท่าไร" ให้ปรับตัว
    และผลปิดร้านจริง (ของค้าง/ของเสีย) ก็ส่งให้ AI เช่นกัน

เป้าหมายด้านความสด (สำคัญ): ใช้วัตถุดิบให้หมดพอดีกับออเดอร์ สต็อกค้างคืนน้อยที่สุด
    โค้ดคำนวณ "แผนความสด" (build_outlook) จากผลพยากรณ์ × สูตรเมนู เทียบกับ stock จริง:
      - ตัวที่ "ไม่พอ" → ควรเติมเท่าที่ขาดพอดี (ไม่เติมเกิน)
      - ตัวที่ "เหลือค้างคืน" → ไม่ต้องเติม และแนะนำเมนูที่ควรโปรโมตเพื่อใช้ให้หมด
    ตัวเลขทั้งหมดคำนวณด้วยโค้ด (ตรวจสอบได้) ส่วน AI ใช้ข้อมูลนี้เขียนคำแนะนำ

ฟังก์ชันที่นี่ทำงานใน "คำขอที่ล็อกอินแล้ว" (ใช้ g.branch_id)
"""
import math
from datetime import datetime, time, timedelta

from flask import current_app, g
from sqlalchemy.orm import selectinload

from .models import MENU_CATEGORIES, ClosingCount, ForecastHistory, Ingredient, Menu, Order, now
from .tools import ApiError

HISTORY_DAYS = 30  # ให้ AI ดูประวัติย้อนหลังกี่วัน
OPEN_HOURS = ['%02d:00' % hour for hour in range(10, 22)]  # ร้านเปิด 10:00–22:00 → 12 ช่วง (ข้อความสั่ง AI อยู่ที่ prompts.py)
FORECAST_DAYS = 7  # พยากรณ์รายได้กี่วันข้างหน้า (เริ่มจากพรุ่งนี้)
WEEKDAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์']  # date.weekday(): 0 = จันทร์
STEP = {'pcs': 1, 'g': 10, 'ml': 10}  # ปุ่ม +/− ของวัตถุดิบเปลี่ยนทีละเท่านี้ (ตรงกับ frontend stockStatus.js)
MAX_ALERTS = 6  # AI แจ้งเตือนได้สูงสุดกี่เรื่องต่อการวิเคราะห์หนึ่งครั้ง
MAX_LIST = 8  # รายการ "เติมเท่าไร" / "ใช้ให้หมด" เก็บกี่อันแรก
MAX_SPECIALS = 3  # เมนูพิเศษที่ AI เสนอได้สูงสุดกี่เมนู
MIN_MARGIN = 1.3  # ราคาเมนูพิเศษต้องไม่ต่ำกว่า ต้นทุน × ค่านี้ (กำไรอย่างน้อย ~23%)


def local_today():
    """วันนี้ตามเวลาท้องถิ่น (ไทย = UTC+7)"""
    return (now() + timedelta(hours=current_app.config['TIMEZONE_OFFSET_HOURS'])).date()


def to_count(value):
    """แปลงเป็นจำนวนเต็มที่ไม่ติดลบ (AI อาจตอบเป็น 12.0 หรือ "12") — แปลงไม่ได้ให้เป็น 0"""
    try:
        return max(0, round(float(value)))
    except (TypeError, ValueError, OverflowError):
        return 0


def round_up(value, step):
    """ปัดขึ้นเป็นพหุคูณของ step เช่น round_up(23, 10) = 30"""
    return int(math.ceil(value / step) * step)


# =====================================================================
#  วัดความแม่นของ AI: เทียบผลพยากรณ์กับยอดจริง
# =====================================================================

def day_bounds(day):
    """เวลา UTC ที่เริ่มต้นและสิ้นสุดของ "วันท้องถิ่น" `day` (ไทย = UTC+7) ใช้ค้นออเดอร์ของวันนั้น"""
    offset = timedelta(hours=current_app.config['TIMEZONE_OFFSET_HOURS'])
    start = datetime.combine(day, time.min) - offset
    return start, start + timedelta(days=1)


def fill_actuals():
    """เติมยอดจริงให้ผลพยากรณ์ของวันที่ "ผ่านไปแล้ว" แต่ยังไม่มียอดจริง (วันละครั้ง ต่อให้ไม่มีใครเปิดหน้าเว็บก็เติมตอนเรียกครั้งถัดไป)
    ฟังก์ชันนี้แค่แก้ค่าในถาด — ฟังก์ชันที่เรียกเป็นคน commit"""
    # [R] READ: ผลพยากรณ์ของสาขานี้ที่วันที่ผ่านไปแล้วแต่ยังไม่มียอดจริง
    pending = ForecastHistory.query.filter(
        ForecastHistory.branch_id == g.branch_id,
        ForecastHistory.target_date < local_today(),
    ).all()
    for row in pending:
        start, end = day_bounds(row.target_date)
        # [R] READ: ออเดอร์จริงของวันนั้น (ไม่รวมที่ยกเลิก)
        if row.generated_at >= start:
            continue
        orders = Order.query.filter(
            Order.branch_id == g.branch_id, Order.created_at >= start, Order.created_at < end, Order.status != 'cancelled',
        ).all()
        # [U] UPDATE: เติมยอดจริงลงแถวเดิม
        row.actual_orders = len(orders)
        row.actual_revenue = sum(order.total for order in orders)
    return len(pending)


def percent_error(predicted, actual):
    """คลาดกี่ % ของยอดจริง (บวก = พยากรณ์สูงเกินจริง) — ยอดจริงเป็น 0 คำนวณไม่ได้ คืน None"""
    return round((predicted - actual) / actual * 100, 1) if actual else None


def accuracy_report(days=30):
    """รายงานความแม่นของ AI ย้อนหลัง `days` วัน (เฉพาะวันที่มียอดจริงแล้ว) พร้อมเทียบกับค่าสถิติธรรมดา (baseline)"""
    fill_actuals()
    since = local_today() - timedelta(days=days)
    # [R] READ: ผลพยากรณ์ที่มียอดจริงแล้ว ใหม่ → เก่า
    rows = ForecastHistory.query.filter(
        ForecastHistory.branch_id == g.branch_id, ForecastHistory.target_date >= since,
        ForecastHistory.actual_orders.isnot(None), ForecastHistory.target_date < local_today(),
    ).order_by(ForecastHistory.target_date.desc()).all()

    rows = [row for row in rows if row.generated_at < day_bounds(row.target_date)[0]]
    items = [{
        'date': row.target_date.isoformat(),
        'forecastOrders': row.orders, 'actualOrders': row.actual_orders, 'baselineOrders': row.baseline_orders,
        'forecastRevenue': row.revenue, 'actualRevenue': row.actual_revenue,
        'ordersErrorPct': percent_error(row.orders, row.actual_orders),
        'revenueErrorPct': percent_error(row.revenue, row.actual_revenue),
    } for row in rows]

    def average(values):
        values = [v for v in values if v is not None]
        return round(sum(values) / len(values), 1) if values else None

    orders_mape = average([abs(i['ordersErrorPct']) if i['ordersErrorPct'] is not None else None for i in items])
    baseline_errors = [percent_error(i['baselineOrders'], i['actualOrders']) for i in items]
    baseline_mape = average([abs(e) if e is not None else None for e in baseline_errors])
    usable = len([i for i in items if i['actualOrders'] > 0])
    absolute_errors = [abs(i['forecastOrders'] - i['actualOrders']) for i in items]
    actual_total = sum(i['actualOrders'] for i in items)
    baseline_absolute = sum(abs(i['baselineOrders'] - i['actualOrders']) for i in items)
    summary = {
        'ordersMae': average(absolute_errors),
        'ordersWape': round(sum(absolute_errors) / actual_total * 100, 1) if actual_total else None,
        'baselineWape': round(baseline_absolute / actual_total * 100, 1) if actual_total else None,
        'zeroSalesDays': sum(i['actualOrders'] == 0 for i in items),
        'count': len(items),
        'ordersMape': orders_mape,  # ค่าคลาดเฉลี่ย % (ยิ่งน้อยยิ่งแม่น)
        'revenueMape': average([abs(i['revenueErrorPct']) if i['revenueErrorPct'] is not None else None for i in items]),
        'bias': average([i['ordersErrorPct'] for i in items]),  # บวก = AI มักพยากรณ์สูงเกิน, ลบ = ต่ำเกิน
        'baselineMape': baseline_mape,
        # AI ชนะสถิติธรรมดาไหม — ตัดสินเมื่อมีวันที่ใช้เทียบได้ตั้งแต่ 3 วัน
        'aiBeatsBaseline': (orders_mape < baseline_mape) if usable >= 3 and orders_mape is not None and baseline_mape is not None else None,
    }
    return items, summary


def closing_results(limit=7):
    """ผลปิดร้านล่าสุดของสาขา (ของค้าง/ของเสียจริง) ให้ AI ดูว่าแผนความสดได้ผลแค่ไหน"""
    # [R] READ: การปิดร้านล่าสุด `limit` ครั้ง (ใหม่ → เก่า)
    rows = ClosingCount.query.filter_by(branch_id=g.branch_id).order_by(ClosingCount.business_date.desc()).limit(limit).all()
    return [{
        'date': row.business_date.isoformat(), 'leftoverValue': row.leftover_value, 'wasteValue': row.waste_value,
        'varianceValue': row.variance_value, 'plannedLeftoverValue': row.planned_leftover_value,
    } for row in rows]


# =====================================================================
#  แผนความสด: ผลพยากรณ์ × สูตรเมนู เทียบกับ stock → เติมเท่าไร / เหลือค้างเท่าไร
# =====================================================================

def expected_portions(menus, total_dishes, shares, dishes_by_menu):
    """จำนวนจานที่คาดว่าจะขายพรุ่งนี้ของแต่ละเมนู คืนเป็น {id เมนู: จำนวนจาน}

    ขั้นที่ 1: จานทั้งหมด × สัดส่วนของประเภท = งบจานของประเภทนั้น
    ขั้นที่ 2: แบ่งงบให้เมนูที่เปิดขายในประเภทนั้นตาม "ยอดขายในอดีต" (ไม่เคยขายเลยก็แบ่งเท่า ๆ กัน)
    """
    weights = {}
    for category, share in shares.items():
        in_category = [menu for menu in menus if menu.available and menu.recipe and menu.category == category]
        if not in_category:
            continue
        category_weights = {menu.id: dishes_by_menu.get(menu.name, 0) for menu in in_category}
        weight_total = sum(category_weights.values())
        for menu in in_category:
            part = category_weights[menu.id] / weight_total if weight_total else 1 / len(in_category)
            weights[menu.id] = max(0, share) * part
    # กระจายเฉพาะเมนูที่ทำได้ตามสูตร และใช้จำนวนเต็ม ไม่ซื้อเผื่อเพราะปัดเศษทุกเมนูขึ้น
    if not weights:
        weights = {menu.id: dishes_by_menu.get(menu.name, 0) for menu in menus if menu.available and menu.recipe}
        if not weights:
            return {}
    if not sum(weights.values()):
        weights = {key: 1 for key in weights}
    total = max(0, math.ceil(round(total_dishes, 6)))
    raw = {key: total * weight / sum(weights.values()) for key, weight in weights.items()}
    portions = {key: math.floor(value) for key, value in raw.items()}
    ranked = sorted(raw, key=lambda key: (-(raw[key] - portions[key]), key))
    for key in ranked[:total - sum(portions.values())]:
        portions[key] += 1
    return portions


def historical_modifier_rates(orders, menus):
    """Use observed choice rates with CURRENT option recipes; ignore untracked legacy plain dishes."""
    counts, choices = {}, {}
    for order in orders:
        for line in order.items:
            if getattr(line, 'recipe_snapshot', None) is None and not getattr(line, 'modifiers', None):
                continue
            counts[line.menu_id] = counts.get(line.menu_id, 0) + line.qty
            for option in line.modifiers or []:
                key = (line.menu_id, option['name'])
                choices[key] = choices.get(key, 0) + line.qty
    result = {}
    for menu in menus:
        if not counts.get(menu.id):
            continue
        deltas = {}
        for option in getattr(menu, 'modifiers', None) or []:
            ratio = choices.get((menu.id, option['name']), 0) / counts[menu.id]
            for entry in option['ingredients']:
                key = int(entry['ingredientId'])
                deltas[key] = deltas.get(key, 0) + ratio * entry['qty']
        result[menu.id] = deltas
    return result


def outlook_rows(menus, ingredients, total_orders, shares, dishes_by_menu, dishes_per_order, target_day=None, modifier_rates=None):
    """คำนวณทีละวัตถุดิบ: คาดว่าต้องใช้เท่าไรพรุ่งนี้ / มีอยู่เท่าไร / ขาด / เหลือค้าง
    รวมของสดที่ยังไม่มีเมนูใช้ เพื่อให้เห็นของค้างและไม่แนะนำซื้อเพิ่ม"""
    portions = expected_portions(menus, total_orders * dishes_per_order, shares, dishes_by_menu)

    demand = {}  # id วัตถุดิบ → ปริมาณที่คาดว่าจะใช้พรุ่งนี้
    menus_using = {}  # id วัตถุดิบ → [(ปริมาณต่อจาน, ชื่อเมนู)] ของเมนูที่เปิดขายและใช้ตัวนี้
    for menu in menus:
        if not menu.available:
            continue
        quantities = {line.ingredient_id: line.quantity for line in menu.recipe}
        for key, delta in (modifier_rates or {}).get(menu.id, {}).items():
            quantities[key] = max(0, quantities.get(key, 0) + delta)
        for key, quantity in quantities.items():
            demand[key] = demand.get(key, 0) + portions.get(menu.id, 0) * quantity
            menus_using.setdefault(key, []).append((quantity, menu.name))

    rows = []
    fresh_categories = current_app.config['FRESH_STOCK_CATEGORIES']
    for ingredient in ingredients:
        fresh = ingredient.category in fresh_categories
        if ingredient.id not in menus_using and not fresh:
            continue
        need = int(math.ceil(round(demand.get(ingredient.id, 0), 6)))  # round กันเลขทศนิยมคลาดเคลื่อน เช่น 30.000000000000004
        from .inventory_policy import available_quantity
        stock = available_quantity(ingredient, target_day or local_today() + timedelta(days=1)) if hasattr(ingredient, 'batches') else ingredient.quantity
        using = sorted(menus_using.get(ingredient.id, []), reverse=True)
        target = math.ceil(need * (1 + current_app.config['FRESH_STOCK_BUFFER_PERCENT'] / 100)) if fresh else need
        purchase_step = current_app.config['FRESH_STOCK_PURCHASE_STEP'] if fresh else STEP.get(ingredient.unit, 1)
        rows.append({
            'id': str(ingredient.id), 'name': ingredient.name, 'unit': ingredient.unit, 'price': float(ingredient.price),
            'stock': stock, 'expectedDemand': need, 'perishable': fresh,
            'targetStock': target, 'purchaseStep': purchase_step,
            'shortage': max(0, target - stock),  # ซื้อเฉพาะส่วนที่ขาดตาม config
            'leftover': max(0, stock - need),  # เหลือค้างคืนถ้าเป็นไปตามที่คาด
            'status': ingredient.status,
            'menus': [name for _, name in using[:3]],  # เมนูที่ควรโปรโมตเพื่อใช้ตัวนี้ให้หมด
        })
    return rows


def summarize_outlook(rows, dishes_per_order):
    """สรุปแผนความสดจากผลของ outlook_rows → dict ที่เก็บในผลพยากรณ์และส่งให้หน้าเว็บ"""
    # ควรเติม: ขาดเท่าไรเติมเท่านั้น (ปัดขึ้นให้ตรงกับขั้นของปุ่ม +/−) ไม่เติมเกิน เพื่อไม่ให้มีของค้างคืน
    restock = []
    for row in rows:
        if row['shortage'] > 0:
            suggested = round_up(row['shortage'], row['purchaseStep'])
            urgent = row['status'] != 'normal' or row['shortage'] > row['stock']
            restock.append({
                'id': row['id'], 'name': row['name'], 'unit': row['unit'], 'stock': row['stock'],
                'expectedDemand': row['expectedDemand'], 'targetStock': row['targetStock'], 'purchaseStep': row['purchaseStep'],
                'shortage': row['shortage'], 'suggested': suggested,
                'priority': 'high' if urgent else 'medium', 'menus': row['menus'],
            })
    restock.sort(key=lambda r: (r['priority'] != 'high', -r['shortage'] / (r['stock'] + 1)))

    # เหลือค้างคืน: เรียงตามมูลค่าที่เหลือมากสุดก่อน (ของแพงที่เหลือเสียดายที่สุด)
    use_up = []
    for row in rows:
        if row['leftover'] > 0:
            use_up.append({
                'id': row['id'], 'name': row['name'], 'unit': row['unit'], 'stock': row['stock'],
                'expectedDemand': row['expectedDemand'], 'leftover': row['leftover'],
                'leftoverValue': row['leftover'] * row['price'], 'menus': row['menus'],
            })
    use_up.sort(key=lambda r: (-r['leftoverValue'], -r['leftover']))

    stock_value = sum(row['stock'] * row['price'] for row in rows)
    leftover_value = sum(row['leftover'] * row['price'] for row in rows)
    return {
        'restock': restock[:MAX_LIST],
        'useUp': use_up[:MAX_LIST],
        'stockValue': stock_value,  # มูลค่า stock ทั้งหมด (บาท)
        'leftoverValue': leftover_value,  # มูลค่าที่คาดว่าจะเหลือค้างคืน (บาท) — ยิ่งน้อยยิ่งดี
        'leftoverPct': round(100 * leftover_value / stock_value) if stock_value else 0,
        'dishesPerOrder': dishes_per_order,
        'method': 'จานที่คาดว่าจะขาย = ออเดอร์ × จานต่อออเดอร์ × สัดส่วนประเภท แบ่งตามยอดขายในอดีต แล้วคูณสูตรเมนู',
    }


def build_outlook(menus, ingredients, total_orders, shares, dishes_by_menu, dishes_per_order, modifier_rates=None):
    rows = outlook_rows(menus, ingredients, total_orders, shares, dishes_by_menu, dishes_per_order, modifier_rates=modifier_rates)
    return rows, summarize_outlook(rows, dishes_per_order)


# =====================================================================
#  เตรียมข้อมูลให้ AI
# =====================================================================

def inventory_summary(ingredients):
    """[R→นับ] นับวัตถุดิบ: ทั้งหมดกี่รายการ แยกตามสถานะและหมวด (โค้ดนับเอง — ตัวเลขนับห้ามให้ AI นับ)"""
    summary = {'total': len(ingredients), 'normal': 0, 'low': 0, 'critical': 0, 'out_of_stock': 0, 'byCategory': {}}
    for ingredient in ingredients:
        summary[ingredient.status] += 1
        summary['byCategory'][ingredient.category] = summary['byCategory'].get(ingredient.category, 0) + 1
    return summary


def short_menus(menus):
    """เมนูที่เปิดขายแต่ "วัตถุดิบไม่พอทำ" ตอนนี้ คืนเป็น [(เมนู, [ (ชื่อวัตถุดิบ, ต้องใช้, มีอยู่) ])]"""
    result = []
    for menu in menus:
        if not menu.available or not menu.recipe:
            continue
        missing = [(line.ingredient.name, line.quantity, line.ingredient.usable_quantity)
                   for line in menu.recipe if line.ingredient.usable_quantity < line.quantity]
        if missing:
            result.append((menu, missing))
    return result


def collect_history():
    """สรุปข้อมูลร้านให้ AI วิเคราะห์ (ประวัติออเดอร์ + สถานะวัตถุดิบ) คืนเป็น dict ธรรมดา
    ส่งแค่ "ตัวเลขสรุป" ให้ AI ไม่ส่งข้อมูลส่วนตัวของลูกค้าหรือผู้ใช้"""
    offset = timedelta(hours=current_app.config['TIMEZONE_OFFSET_HOURS'])
    since = now() - timedelta(days=HISTORY_DAYS)
    # [R] READ: ออเดอร์ย้อนหลังของสาขานี้ที่ไม่ได้ยกเลิก (>= since = ใหม่กว่าวันที่กำหนด)
    orders = Order.query.options(selectinload(Order.items)).filter(
        Order.branch_id == g.branch_id, Order.created_at >= since, Order.status != 'cancelled',
    ).all()
    if len(orders) == 0:
        raise ApiError('VALIDATION', 'ยังไม่มีออเดอร์ให้ AI วิเคราะห์')

    # [R] READ: เมนูและวัตถุดิบทุกแถวของสาขา
    all_menus = Menu.query.options(selectinload(Menu.recipe)).filter_by(branch_id=g.branch_id).all()
    ingredients = Ingredient.query.filter_by(branch_id=g.branch_id, deleted_at=None).order_by(Ingredient.id).all()
    category_of = {menu.id: menu.category for menu in all_menus}

    orders_by_hour = {hour: 0 for hour in OPEN_HOURS}  # ออเดอร์ในแต่ละชั่วโมง (เวลาท้องถิ่น) รวมทุกวัน
    dishes_by_category = {}  # จำนวนจานแยกตามประเภทเมนู
    dishes_by_menu = {}  # จำนวนจานแยกตามเมนู
    by_date = {}  # วันที่ → {orders, revenue}
    total_dishes = 0
    total_revenue = 0
    for order in orders:
        local = order.created_at + offset
        hour = '%02d:00' % local.hour
        if hour in orders_by_hour:
            orders_by_hour[hour] += 1
        day = by_date.setdefault(local.date(), {'orders': 0, 'revenue': 0})
        day['orders'] += 1
        day['revenue'] += order.total
        total_revenue += order.total
        for item in order.items:
            total_dishes += item.qty
            dishes_by_menu[item.name] = dishes_by_menu.get(item.name, 0) + item.qty
            category = category_of.get(item.menu_id)
            if category:
                dishes_by_category[category] = dishes_by_category.get(category, 0) + item.qty

    # ค่าเฉลี่ยรายวัน และรายวันในสัปดาห์ (จันทร์..อาทิตย์) ให้ AI เห็นรูปแบบของวัน
    weekday_totals = {}
    for day, row in by_date.items():
        entry = weekday_totals.setdefault(day.weekday(), {'days': 0, 'orders': 0, 'revenue': 0})
        entry['days'] += 1
        entry['orders'] += row['orders']
        entry['revenue'] += row['revenue']
    weekday_averages = {
        WEEKDAYS[w]: {'daysObserved': e['days'], 'avgOrders': round(e['orders'] / e['days'], 1),
                      'avgRevenue': round(e['revenue'] / e['days'])}
        for w, e in sorted(weekday_totals.items())
    }
    recent_days = [{'date': day.isoformat(), 'weekday': WEEKDAYS[day.weekday()], **row}
                   for day, row in sorted(by_date.items())[-14:]]

    average_orders = round(len(orders) / len(by_date), 1)
    dishes_per_order = round(total_dishes / len(orders), 2) if total_dishes else 1

    # แผนความสด "ฐาน": ถ้าพรุ่งนี้ขายเท่าค่าเฉลี่ยต่อวัน จะเติมอะไร/เหลืออะไร (ให้ AI ใช้เขียนคำแนะนำ)
    category_total = sum(dishes_by_category.values())
    base_shares = {name: count / category_total for name, count in dishes_by_category.items()} if category_total else {}
    modifier_rates = historical_modifier_rates(orders, all_menus)
    base_rows, base = build_outlook(all_menus, ingredients, average_orders, base_shares, dishes_by_menu, dishes_per_order, modifier_rates)

    # สถานะวัตถุดิบ: เฉพาะตัวที่ใกล้หมด/วิกฤต + เมนูที่ทำไม่ได้ (ไม่ส่งทุกตัว ประหยัดและตรงประเด็น)
    low_ingredients = [
        {'name': i.name, 'unit': i.unit, 'quantity': i.usable_quantity, 'status': i.status}
        for i in ingredients if i.status != 'normal'
    ][:30]
    blocked = [
        {'name': menu.name, 'missing': [{'ingredient': n, 'need': need, 'have': have} for n, need, have in missing]}
        for menu, missing in short_menus(all_menus)
    ][:20]

    today = local_today()
    tomorrow = today + timedelta(days=1)

    # ค่าอ้างอิงจากสถิติธรรมดา: ค่าเฉลี่ยออเดอร์ของ "วันเดียวกันในสัปดาห์" (ถ้าเคยมีข้อมูลวันนั้น) ไม่งั้นใช้ค่าเฉลี่ยรวม
    # ไว้เทียบว่า AI ชนะสถิติธรรมดาจริงไหม — และเตือน AI ไม่ให้ห่างจากค่านี้โดยไม่มีเหตุผล
    baseline_orders = round(weekday_averages.get(WEEKDAYS[tomorrow.weekday()], {}).get('avgOrders', average_orders))

    # ความแม่นของพยากรณ์ครั้งก่อน ๆ (ให้ AI ปรับตัว: สูงเกินให้ลด ต่ำเกินให้เพิ่ม)
    accuracy_items, accuracy = accuracy_report(HISTORY_DAYS)

    # วัตถุดิบที่คาดว่าจะเหลือ (ให้ AI คิดเมนูพิเศษจากของเหล่านี้)
    leftover_ingredients = sorted(
        [{'name': r['name'], 'unit': r['unit'], 'stock': r['stock'], 'leftover': r['leftover'], 'price': r['price']}
         for r in base_rows if r['leftover'] > 0],
        key=lambda r: -r['leftover'] * r['price'])[:10]

    return {
        'today': today.isoformat(),
        'forecastDates': [{'date': (today + timedelta(days=i)).isoformat(), 'weekday': WEEKDAYS[(today + timedelta(days=i)).weekday()]}
                          for i in range(1, FORECAST_DAYS + 1)],
        'historyDays': HISTORY_DAYS,
        'daysWithOrders': len(by_date),
        'totalOrders': len(orders),
        'averageOrdersPerDay': average_orders,
        'averageOrderValue': round(total_revenue / len(orders)),  # รายได้เฉลี่ยต่อ 1 ออเดอร์ (บาท)
        'totalRevenue': total_revenue,
        'dishesPerOrder': dishes_per_order,
        'ordersByHour': orders_by_hour,
        'dishesByCategory': dishes_by_category,
        'dishesByMenu': dishes_by_menu,
        'modifierRates': modifier_rates,
        'recentDays': recent_days,
        'weekdayAverages': weekday_averages,
        'sellableMenus': [{'name': m.name, 'category': m.category, 'price': m.price} for m in all_menus if m.available],
        'categories': list(MENU_CATEGORIES),
        'hours': OPEN_HOURS,
        'baselineOrders': baseline_orders,
        'lastForecastResults': accuracy_items[:7],  # ครั้งก่อน ๆ: พยากรณ์ vs ยอดจริง
        'forecastAccuracy': accuracy,
        'closingResults': closing_results(),  # ผลปิดร้านจริง: ของค้าง/ของเสีย/ส่วนต่าง
        'leftoverIngredients': leftover_ingredients,
        'existingMenuNames': [menu.name for menu in all_menus],
        'inventory': inventory_summary(ingredients),
        'lowIngredients': low_ingredients,
        'menusMissingIngredients': blocked,
        'freshnessBaseline': {  # เป้าหมาย: ใช้วัตถุดิบให้หมดพอดี ของค้างคืนน้อยที่สุด
            'leftoverValue': base['leftoverValue'], 'leftoverPct': base['leftoverPct'],
            'useUp': [{k: r[k] for k in ('name', 'unit', 'stock', 'expectedDemand', 'leftover', 'menus')} for r in base['useUp']],
            'restock': [{k: r[k] for k in ('name', 'unit', 'stock', 'shortage')} for r in base['restock']],
        },
    }


# =====================================================================
#  ตรวจคำตอบของ AI (ห้ามเชื่อโดยไม่ตรวจ)
# =====================================================================

def clean_alerts(raw_alerts, menus, ingredients, rows):
    """ตรวจ "การแจ้งเตือน" ที่ AI เสนอ — ใช้เฉพาะเรื่องที่ตรงกับ stock จริงเท่านั้น

    วัตถุดิบ: ต้องมีจริง และ (ใกล้หมด/วิกฤต หรือ คาดว่าไม่พอใช้พรุ่งนี้)
    เมนู:     ต้องมีจริง เปิดขายอยู่ และ "ตอนนี้วัตถุดิบไม่พอทำ" จริง (โค้ดคำนวณส่วนที่ขาดเอง)
    ข้อความ: ใช้ที่ AI เขียน (ตัดความยาว) ส่วนระดับความสำคัญและรายละเอียดตัวเลข โค้ดเป็นคนกำหนด
    """
    by_name = {i.name.strip().lower(): i for i in ingredients}
    menu_by_name = {m.name.strip().lower(): m for m in menus}
    shortage = {row['name']: row['shortage'] for row in rows}
    missing_by_menu = {menu.id: missing for menu, missing in short_menus(menus)}

    alerts, seen = [], set()
    for raw in raw_alerts if isinstance(raw_alerts, list) else []:
        if not isinstance(raw, dict) or len(alerts) >= MAX_ALERTS:
            continue
        kind = raw.get('type')
        name = str(raw.get('name') or '').strip()
        message = str(raw.get('message') or '').strip()[:160]
        if (kind, name.lower()) in seen:
            continue

        if kind == 'ingredient' and name.lower() in by_name:
            ingredient = by_name[name.lower()]
            if ingredient.status == 'normal' and shortage.get(ingredient.name, 0) == 0:
                continue  # AI เตือนเรื่องที่ไม่จริง → ทิ้ง
            level = 'danger' if ingredient.status in ('critical', 'out_of_stock') else 'warn'
            status_text = {'out_of_stock': 'หมด', 'critical': 'วิกฤต'}.get(ingredient.status, 'ใกล้หมด/ไม่พอ')
            detail = 'เหลือ %s %s' % (ingredient.quantity, ingredient.unit)
            if shortage.get(ingredient.name):
                detail += ' (คาดว่าพรุ่งนี้ต้องใช้อีก %s)' % shortage[ingredient.name]
            alerts.append({
                'type': 'ingredient', 'name': ingredient.name, 'level': level, 'link': '/stock/%s' % ingredient.id,
                'message': message or 'วัตถุดิบนี้กำลังจะไม่พอ ควรเติม', 'detail': detail,
                'title': 'AI เตือน: %s %s' % (ingredient.name, status_text),
            })
        elif kind == 'menu' and name.lower() in menu_by_name:
            menu = menu_by_name[name.lower()]
            missing = missing_by_menu.get(menu.id)
            if not missing:
                continue
            detail = 'ขาด: ' + ', '.join('%s (ต้องใช้ %s มี %s)' % m for m in missing)
            alerts.append({
                'type': 'menu', 'name': menu.name, 'level': 'warn', 'link': '/menu/%s/recipe' % menu.id,
                'message': message or 'วัตถุดิบไม่พอทำเมนูนี้ ควรเติมหรือปิดขายชั่วคราว', 'detail': detail,
                'title': 'AI เตือน: วัตถุดิบไม่พอทำเมนู %s' % menu.name,
            })
        else:
            continue
        seen.add((kind, name.lower()))
    return alerts


def clean_specials(raw_specials, menus, ingredients, rows):
    """ตรวจ "เมนูพิเศษจากของที่เหลือ" ที่ AI เสนอ — ใช้เฉพาะเมนูที่ทำได้จริงจากของในร้าน

    กฎ: ชื่อไม่ซ้ำเมนูที่มี | ทุกวัตถุดิบต้องมีจริงและใช้ไม่เกินที่มีอยู่ | ต้องใช้ "ของที่คาดว่าจะเหลือ" อย่างน้อย 1 อย่าง
        (ไม่งั้นไม่ได้ช่วยลดของค้างคืน) | ราคาต้องไม่ต่ำกว่าต้นทุน × MIN_MARGIN (โค้ดคิดต้นทุนจากราคาวัตถุดิบเอง)
    """
    by_name = {i.name.strip().lower(): i for i in ingredients}
    taken = {m.name.strip().lower() for m in menus}
    leftover_names = {row['name'] for row in rows if row['leftover'] > 0}

    specials = []
    for raw in raw_specials if isinstance(raw_specials, list) else []:
        if not isinstance(raw, dict) or len(specials) >= MAX_SPECIALS:
            continue
        name = str(raw.get('name') or '').strip()[:60]
        if not name or name.lower() in taken:
            continue

        lines, used = [], set()
        for line in raw.get('ingredients') or []:
            ingredient = by_name.get(str((line or {}).get('name') or '').strip().lower()) if isinstance(line, dict) else None
            qty = to_count(line.get('qty')) if isinstance(line, dict) else 0
            if ingredient is None or qty < 1 or qty > ingredient.usable_quantity or ingredient.id in used:
                continue
            used.add(ingredient.id)
            lines.append({'ingredientId': str(ingredient.id), 'name': ingredient.name, 'unit': ingredient.unit, 'qty': qty})
        lines = lines[:6]
        if not lines or not any(line['name'] in leftover_names for line in lines):
            continue

        cost = sum(line['qty'] * float(by_name[line['name'].lower()].price) for line in lines)
        floor_price = math.ceil(cost * MIN_MARGIN)
        price = to_count(raw.get('price'))
        if price < floor_price:
            price = round_up(math.ceil(cost * 1.5), 5)  # ราคาที่ AI ตั้งต่ำเกินไป → ใช้ต้นทุน × 1.5 ปัดขึ้นเป็นพหุคูณของ 5
        category = raw.get('category') if raw.get('category') in MENU_CATEGORIES else MENU_CATEGORIES[-1]
        specials.append({
            'name': name, 'description': str(raw.get('description') or '').strip()[:200], 'category': category,
            'price': price, 'cost': cost, 'ingredients': lines,
            'uses': [line['name'] for line in lines if line['name'] in leftover_names],  # ของที่เหลือที่เมนูนี้ช่วยใช้
        })
        taken.add(name.lower())
    return specials


def clean_forecast(answer, history):
    """ตรวจและจัดรูปคำตอบของ AI ให้เป็นผลพยากรณ์ที่ใช้ได้จริง — ส่วนที่ AI ตอบมาผิดจะถูกแก้หรือโยน error

    กฎที่บังคับ (ตรงกับที่หน้าเว็บคาดหวัง):
      - hourly ครบทุกชั่วโมงเปิดร้าน เป็นจำนวนเต็ม ≥ 0          → จำนวนออเดอร์ทั้งหมด = ผลรวมของ hourly
      - ช่วงเยอะสุด = 2 ชั่วโมงติดกันที่รวมมากสุด                 → โค้ดคำนวณเอง ไม่ใช้ที่ AI บอก
      - categories ใช้เฉพาะประเภทที่มีจริง และ share รวมเป็น 1
      - bestSeller ต้องเป็นเมนูที่เปิดขายจริง
      - รายได้รายวัน: ต้องสมเหตุสมผลกับ (ออเดอร์ × ราคาเฉลี่ยต่อออเดอร์) ไม่งั้นโค้ดคำนวณแทน
      - alerts ต้องตรงกับ stock จริง
    """
    if not isinstance(answer, dict):
        raise ApiError('AI_ERROR', 'AI ตอบข้อมูลไม่ครบ')

    # JSON ถูกไวยากรณ์ไม่ได้แปลว่าชนิดข้อมูลถูก: ตรวจทุก list ก่อนวนอ่าน
    for field in ('hourly', 'categories', 'daily', 'alerts', 'specials', 'advice'):
        if answer.get(field) is not None and not isinstance(answer[field], list):
            raise ApiError('AI_ERROR', 'AI ตอบข้อมูลไม่ถูกต้อง (%s ต้องเป็นรายการ)' % field)
    for special in answer.get('specials') or []:
        if isinstance(special, dict) and special.get('ingredients') is not None and not isinstance(special['ingredients'], list):
            raise ApiError('AI_ERROR', 'AI ตอบข้อมูลไม่ถูกต้อง (ingredients ต้องเป็นรายการ)')

    # 1) รายชั่วโมง: เอาตามที่ AI ตอบ ชั่วโมงไหนไม่มีให้เป็น 0
    ai_hours = {}
    for row in answer.get('hourly') or []:
        if isinstance(row, dict):
            ai_hours[str(row.get('hour'))] = to_count(row.get('orders'))
    hourly = [{'hour': hour, 'orders': ai_hours.get(hour, 0)} for hour in OPEN_HOURS]

    total = sum(row['orders'] for row in hourly)
    if total == 0:
        raise ApiError('AI_ERROR', 'AI ตอบข้อมูลไม่ครบ (ไม่มีจำนวนออเดอร์รายชั่วโมง)')

    # 2) ช่วงเยอะสุด: ลองทุกคู่ชั่วโมงที่ติดกัน เอาคู่ที่รวมมากที่สุด
    best_index = 0
    for i in range(len(hourly) - 1):
        if hourly[i]['orders'] + hourly[i + 1]['orders'] > hourly[best_index]['orders'] + hourly[best_index + 1]['orders']:
            best_index = i
    peak_start = hourly[best_index]['hour']
    peak_end = '%02d:00' % (int(hourly[best_index + 1]['hour'][:2]) + 1)

    # 3) สัดส่วนประเภทเมนู: ทิ้งประเภทที่ไม่มีจริง แล้วปรับให้รวมเป็น 1
    shares = {}
    for row in answer.get('categories') or []:
        if isinstance(row, dict) and row.get('category') in MENU_CATEGORIES:
            try:
                share = float(row.get('share'))
                if math.isfinite(share):
                    shares[row['category']] = max(0.0, share)
            except (TypeError, ValueError):
                pass
    share_total = sum(shares.values())
    if share_total == 0:
        raise ApiError('AI_ERROR', 'AI ตอบข้อมูลไม่ครบ (ไม่มีสัดส่วนประเภทเมนู)')
    shares = {name: share / share_total for name, share in shares.items()}
    categories = [{'category': name, 'share': round(share, 4)} for name, share in shares.items()]

    # 4) เมนูขายดี: ต้องเป็นเมนูที่เปิดขายอยู่จริง ไม่งั้นใช้เมนูที่ขายได้มากสุดในประวัติแทน
    sellable = [menu['name'] for menu in history['sellableMenus']]
    best_seller = answer.get('bestSeller')
    if best_seller not in sellable:
        sold = history['dishesByMenu']
        best_seller = max(sellable, key=lambda name: sold.get(name, 0), default='-')

    # 5) รายได้รายวัน 7 วันข้างหน้า (วันที่ 1 = พรุ่งนี้ ใช้ออเดอร์เท่ากับผลรวมรายชั่วโมงเพื่อให้ตัวเลขตรงกัน)
    average_value = history['averageOrderValue']
    weekday_orders = {name: row['avgOrders'] for name, row in history['weekdayAverages'].items()}
    ai_days = {str(row.get('date')): row for row in answer.get('daily') or [] if isinstance(row, dict)}
    daily = []
    for index, info in enumerate(history['forecastDates']):
        row = ai_days.get(info['date'], {})
        orders_that_day = total if index == 0 else to_count(row.get('orders'))
        if orders_that_day == 0 and index > 0 and info['weekday'] in weekday_orders:
            orders_that_day = round(weekday_orders[info['weekday']])  # AI ไม่ตอบ แต่วันนี้ในอดีตมีออเดอร์ → ใช้ค่าเฉลี่ยของวันนั้น
        revenue = to_count(row.get('revenue'))
        if average_value > 0 and not (0.5 * orders_that_day * average_value <= revenue <= 2 * orders_that_day * average_value):
            revenue = round(orders_that_day * average_value)  # ตัวเลขของ AI ไม่สมเหตุสมผล → โค้ดคำนวณแทน
        daily.append({'date': info['date'], 'weekday': info['weekday'], 'orders': orders_that_day, 'revenue': revenue})

    # 6) แผนความสด + ตรวจการแจ้งเตือนของ AI (ดึงเมนู/วัตถุดิบล่าสุดมาเทียบ)
    # [R] READ: เมนูและวัตถุดิบทุกแถวของสาขา
    menus = Menu.query.options(selectinload(Menu.recipe)).filter_by(branch_id=g.branch_id).all()
    ingredients = Ingredient.query.filter_by(branch_id=g.branch_id, deleted_at=None).order_by(Ingredient.id).all()
    rows, outlook = build_outlook(menus, ingredients, total, shares, history['dishesByMenu'], history['dishesPerOrder'], history.get('modifierRates'))
    alerts = clean_alerts(answer.get('alerts'), menus, ingredients, rows)
    specials = clean_specials(answer.get('specials'), menus, ingredients, rows)

    inventory = dict(history['inventory'])
    inventory['check'] = str(answer.get('stockCheck') or '').strip()[:300]  # ข้อความสรุปสถานะวัตถุดิบที่ AI เขียน

    advice = [str(line).strip() for line in (answer.get('advice') or []) if str(line).strip()][:5]

    return {
        'orders': total, 'peakStart': peak_start, 'peakEnd': peak_end, 'bestSeller': best_seller,
        'hourly': hourly, 'categories': categories,
        'revenue': daily[0]['revenue'], 'avgOrderValue': average_value, 'daily': daily,
        'inventory': inventory, 'alerts': alerts, 'outlook': outlook, 'specials': specials,
        'advice': advice,
        'source': 'groq',  # บอกหน้าเว็บว่าผลนี้มาจาก AI จริง
        'generatedAt': now().isoformat(timespec='seconds') + 'Z',
    }
