"""Units, exact costs, and expiry-aware stock. All mutations share the ingredient lock."""
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from flask import current_app

from . import db
from .models import IngredientBatch, BatchAllocation, now
from .tools import ApiError


def business_date():
    return (now() + timedelta(hours=current_app.config['TIMEZONE_OFFSET_HOURS'])).date()


def money(value, places=2):
    try:
        if isinstance(value, bool):
            raise ValueError()
        number = Decimal(str(value))
        if not number.is_finite() or number < 0 or number > Decimal('999999999.99'):
            raise ValueError()
        if number != number.quantize(Decimal(1).scaleb(-places)):
            raise ValueError()
        return number
    except (InvalidOperation, ValueError, TypeError):
        raise ApiError('VALIDATION', 'ราคาต้องไม่ติดลบและมีทศนิยมไม่เกิน %s ตำแหน่ง' % places)


def purchase_fields(item, body):
    unit = body.get('purchaseUnit', item.purchase_unit or item.unit)
    size = body.get('purchaseSize', item.purchase_size or 1)
    if unit not in (item.unit, 'kg' if item.unit == 'g' else 'l' if item.unit == 'ml' else 'pack', 'pack'):
        raise ApiError('VALIDATION', 'หน่วยซื้อไม่สัมพันธ์กับหน่วยในสูตร')
    if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= 10000:
        raise ApiError('VALIDATION', 'ขนาดต่อหน่วยซื้อต้องเป็นจำนวนเต็ม 1–10,000')
    if (unit == item.unit and size != 1) or (unit in ('kg', 'l') and size != 1000):
        raise ApiError('VALIDATION', 'kg/l เท่ากับ 1000 หน่วย และหน่วยเดิมเท่ากับ 1')
    item.purchase_unit, item.purchase_size = unit, size
    if 'purchasePrice' in body:
        item.price = (money(body['purchasePrice']) / size).quantize(Decimal('.000001'))


def expiry_date(raw):
    if not raw:
        return None
    try:
        value = date.fromisoformat(raw)
    except (TypeError, ValueError):
        raise ApiError('VALIDATION', 'วันหมดอายุไม่ถูกต้อง')
    if value < business_date():
        raise ApiError('VALIDATION', 'ไม่สามารถรับของที่หมดอายุแล้ว')
    return value


def available_quantity(item, day=None):
    day = day or business_date()
    expired = sum(b.remaining for b in item.batches if b.expires_on and b.expires_on < day)
    return max(0, item.quantity - expired)


def ensure_legacy_batch(item):
    # Existing stock has no invented expiry; reconcile it into an explicit unknown batch.
    missing = item.quantity - sum(b.remaining for b in item.batches)
    if missing > 0:
        item.batches.append(IngredientBatch(remaining=missing, received_qty=missing, label='สต็อกเดิม / ไม่ทราบวันหมดอายุ'))


def receive(item, amount, expires=None, label='', unit_cost=None):
    ensure_legacy_batch(item)
    batch = IngredientBatch(remaining=amount, received_qty=amount, expires_on=expires, label=label[:120],
                            unit_cost=item.price if unit_cost is None else unit_cost)
    item.batches.append(batch)
    return batch


def consume(item, amount, order=None, allow_expired=False):
    ensure_legacy_batch(item)
    day = business_date()
    batches = sorted(item.batches, key=lambda b: (b.expires_on or date.max, b.id or 0))
    eligible = [b for b in batches if allow_expired or not b.expires_on or b.expires_on >= day]
    if sum(b.remaining for b in eligible) < amount:
        raise ApiError('INSUFFICIENT_STOCK', 'วัตถุดิบที่ยังไม่หมดอายุไม่พอ: ' + item.name)
    cost = Decimal(0)
    unknown_cost = False
    for batch in eligible:
        used = min(amount, batch.remaining)
        if used:
            unit_cost = batch.unit_cost
            if unit_cost is None:
                unknown_cost = True
            else:
                cost += used * Decimal(str(unit_cost))
            batch.remaining -= used
            if order is not None:
                db.session.flush()
                db.session.add(BatchAllocation(order_id=order.id, batch_id=batch.id, quantity=used, unit_cost=unit_cost))
            amount -= used
        if not amount:
            break
    return None if unknown_cost else cost


def restore(item, order):
    allocations = BatchAllocation.query.join(IngredientBatch).filter(
        BatchAllocation.order_id == order.id, IngredientBatch.ingredient_id == item.id).all()
    if not allocations:  # Orders created before batches were introduced.
        return False
    for allocation in allocations:
        allocation.batch.remaining += allocation.quantity
    return True
