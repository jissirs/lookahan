"""ปิดร้าน (นับของจริง + ของเสีย) — เส้นทางของ API

    GET  /closing/today     วันนี้ปิดร้านไปแล้วหรือยัง (ถ้าแล้วส่งผลมาด้วย) + ของค้างที่แผนความสดคาดไว้
    POST /closing           บันทึกการปิดร้านวันนี้ (วันละครั้ง ปิดแล้วแก้ไม่ได้)
    GET  /closing/history   ผลปิดร้านย้อนหลัง 30 วัน + ค่าเฉลี่ย (ไว้ดูว่าของค้าง/ของเสียลดลงไหม)

ทำไมต้องมี: เป้าหมายของร้านคือ "ใช้วัตถุดิบให้หมดพอดี" — แต่จะรู้ว่าทำได้จริงไหมต้องวัด
    ปิดร้านทุกคืน → นับของที่เหลือจริง + จดของที่ทิ้ง → ได้ "มูลค่าของค้างคืน" และ "ของเสีย" เป็นตัวเลขจริง
    ตัวเลขนี้ถูกส่งให้ AI ตอนวิเคราะห์ ให้ AI เรียนรู้ว่าแผนครั้งก่อนได้ผลแค่ไหน

ข้อมูลที่ส่งมาตอน POST:
    {"note": "...", "lines": [{"ingredientId": "3", "countedQty": 8, "wasteQty": 2}]}
        countedQty = จำนวนที่เหลือจริงหลังทิ้งของเสียแล้ว    wasteQty = จำนวนที่ทิ้ง
    วัตถุดิบที่ไม่อยู่ใน lines = ไม่ได้นับ ไม่แตะ stock
"""
from datetime import timedelta

from flask import Blueprint, g, jsonify

from .. import db
from ..forecast import local_today
from ..models import Branch, ClosingCount, ClosingLine, ForecastHistory, Ingredient
from ..tools import ApiError, find_mine, is_whole_number, json_body
from .notifications import add_notification
from .orders import change_stock

bp = Blueprint('closing', __name__)

MAX_LINES = 200  # วัตถุดิบที่นับได้ในการปิดร้านครั้งเดียว (กันส่งมาเยอะผิดปกติ)


# ---------------------------------------------------------------- เส้นทาง

@bp.get('/closing/today')
def get_today():
    today = local_today()
    # [R] READ: วันนี้ปิดร้านไปแล้วไหม
    closing = ClosingCount.query.filter_by(branch_id=g.branch_id, business_date=today).first()
    return jsonify({
        'date': today.isoformat(),
        'closing': closing.to_json(with_lines=True) if closing else None,
        'plannedLeftoverValue': planned_leftover_for(today),
    })


@bp.post('/closing')
def create_closing():
    body = json_body()
    Branch.query.filter_by(id=g.branch_id).with_for_update().first()
    today = local_today()

    # [R] READ: วันนี้ปิดร้านไปแล้วหรือยัง — ปิดซ้ำไม่ได้ (UNIQUE ในฐานข้อมูลช่วยกันอีกชั้น)
    if ClosingCount.query.filter_by(branch_id=g.branch_id, business_date=today).first():
        raise ApiError('ALREADY_CLOSED', 'Today has already been closed')

    entries = read_lines(body.get('lines'))
    note = str(body.get('note') or '').strip()[:500]

    # [C] CREATE: สร้างหัวการปิดร้าน (ตัวเลขมูลค่าใส่ทีหลังหลังคำนวณทุกบรรทัด)
    closing = ClosingCount(
        branch_id=g.branch_id, user_id=g.user.id, business_date=today, note=note,
        planned_leftover_value=planned_leftover_for(today),
    )
    db.session.add(closing)

    leftover = waste = variance = 0
    for ingredient, counted, waste_qty in entries:
        system_qty = ingredient.quantity
        # [C] CREATE: บันทึกบรรทัดที่นับ (เก็บราคา ณ ตอนนั้น ราคาเปลี่ยนทีหลังตัวเลขเก่าไม่เพี้ยน)
        closing.lines.append(ClosingLine(
            ingredient_id=ingredient.id, system_qty=system_qty, counted_qty=counted,
            waste_qty=waste_qty, price=ingredient.price,
        ))

        # ของเสีย: หัก stock ออก (บันทึกเป็นประวัติ "Drop")
        if waste_qty:
            movement = change_stock(ingredient, -waste_qty, 'Drop', 'ของเสีย (ปิดร้าน)')
            from ..service_models import WasteRecord
            db.session.add(WasteRecord(branch_id=g.branch_id, user_id=g.user.id, ingredient_id=ingredient.id,
                quantity=waste_qty, cost=movement.cost, reason='closing', note=note[:200]))
        # ส่วนต่าง: ระบบคิดว่าเหลือ (system - waste) แต่นับได้จริง counted → ปรับ stock ให้เท่าของจริง
        gap = counted - ingredient.quantity
        if gap:
            change_stock(ingredient, gap, 'Add' if gap > 0 else 'Drop', 'ปรับตามที่นับจริง (ปิดร้าน)')

        leftover += counted * ingredient.price
        waste += waste_qty * ingredient.price
        variance += gap * ingredient.price

    # [U] UPDATE: ใส่มูลค่ารวมที่คำนวณได้ลงหัวการปิดร้าน
    closing.leftover_value, closing.waste_value, closing.variance_value = leftover, waste, variance

    # [C] แจ้งทุกคนในสาขาว่าปิดร้านแล้ว พร้อมสรุปสั้น ๆ (kind 'ai_forecast' คือชนิดข้อมูลสรุปทั่วไปที่ฐานข้อมูลรองรับ)
    add_notification(
        'ai_forecast', 'info', 'ปิดร้านวันนี้แล้ว',
        'ของเหลือ ' + str(leftover) + ' บาท · ของเสีย ' + str(waste) + ' บาท', '/closing',
    )
    db.session.commit()
    return jsonify(closing.to_json(with_lines=True)), 201


@bp.get('/closing/history')
def get_history():
    since = local_today() - timedelta(days=30)
    # [R] READ: ปิดร้านย้อนหลัง 30 วัน ใหม่ → เก่า
    rows = ClosingCount.query.filter(
        ClosingCount.branch_id == g.branch_id, ClosingCount.business_date >= since,
    ).order_by(ClosingCount.business_date.desc()).all()

    def average(values):
        return round(sum(values) / len(values)) if values else None

    return jsonify({
        'days': [row.to_json() for row in rows],
        'summary': {
            'count': len(rows),
            'averageLeftoverValue': average([row.leftover_value for row in rows]),
            'averageWasteValue': average([row.waste_value for row in rows]),
            'totalWasteValue': sum(row.waste_value for row in rows),
        },
    })


# ---------------------------------------------------------------- ตัวช่วย

def planned_leftover_for(day):
    """มูลค่าของค้างที่แผนความสดของ AI คาดไว้สำหรับวัน `day` (ไม่เคยพยากรณ์วันนั้น = None)"""
    # [R] READ: ผลพยากรณ์ที่เก็บไว้ของวันนั้น
    record = ForecastHistory.query.filter_by(branch_id=g.branch_id, target_date=day).first()
    return record.planned_leftover_value if record else None


def read_lines(raw_lines):
    """ตรวจรายการที่นับ แล้วคืน [(วัตถุดิบ, จำนวนที่เหลือจริง, จำนวนที่ทิ้ง), ...]"""
    if not isinstance(raw_lines, list) or not raw_lines:
        raise ApiError('VALIDATION', 'Add at least one ingredient to count')
    if len(raw_lines) > MAX_LINES:
        raise ApiError('VALIDATION', 'Too many ingredients')

    entries, seen = [], set()
    for raw in raw_lines:
        if not isinstance(raw, dict):
            raise ApiError('VALIDATION', 'Each line must be an object')
        # [R] READ: หาวัตถุดิบ (เฉพาะของสาขาตัวเอง)
        ingredient = Ingredient.query.filter_by(id=raw.get('ingredientId'), branch_id=g.branch_id, deleted_at=None).with_for_update().first()
        if ingredient is None:
            raise ApiError('NOT_FOUND', 'ไม่พบวัตถุดิบ')
        if ingredient.id in seen:
            raise ApiError('VALIDATION', 'Duplicate ingredient: ' + ingredient.name)
        seen.add(ingredient.id)

        counted, waste_qty = raw.get('countedQty'), raw.get('wasteQty', 0)
        if not is_whole_number(counted) or counted < 0:
            raise ApiError('VALIDATION', 'Counted quantity must be a whole number (0 or more): ' + ingredient.name)
        if not is_whole_number(waste_qty) or waste_qty < 0:
            raise ApiError('VALIDATION', 'Waste must be a whole number (0 or more): ' + ingredient.name)
        if waste_qty > ingredient.quantity:
            raise ApiError('VALIDATION', 'Waste is more than the stock: ' + ingredient.name)
        entries.append((ingredient, counted, waste_qty))
    return entries
