"""Daily procurement from saved predictions or a labelled historical baseline; never calls AI."""
from collections import Counter
from datetime import date, timedelta, datetime, time

from flask import Blueprint, g, jsonify, request
from sqlalchemy.orm import selectinload

from ..forecast import day_bounds, expected_portions, local_today, outlook_rows, round_up, historical_modifier_rates
from ..inventory_policy import available_quantity
from ..models import ForecastHistory, Ingredient, Menu, Order
from ..tools import ApiError

bp = Blueprint('planning', __name__)


@bp.get('/dashboard/purchasing')
def purchasing():
    today = local_today()
    try:
        target = date.fromisoformat(request.args.get('date', today.isoformat()))
    except ValueError:
        raise ApiError('VALIDATION', 'วันที่ไม่ถูกต้อง')
    if target not in (today, today + timedelta(days=1)):
        raise ApiError('VALIDATION', 'เลือกได้เฉพาะวันนี้หรือพรุ่งนี้')
    start, _ = day_bounds(today - timedelta(days=30))
    end, _ = day_bounds(today)
    history = Order.query.options(selectinload(Order.items)).filter(
        Order.branch_id == g.branch_id, Order.created_at >= start, Order.created_at < end,
        Order.status != 'cancelled').all()
    menus = Menu.query.options(selectinload(Menu.recipe)).filter_by(branch_id=g.branch_id).all()
    ingredients = Ingredient.query.filter_by(branch_id=g.branch_id, deleted_at=None).all()
    offset = end - datetime.combine(today, time.min)
    daily, dishes, categories = Counter(), Counter(), Counter()
    by_id = {menu.id: menu for menu in menus}
    for order in history:
        daily[(order.created_at - offset).date()] += 1
        for line in order.items:
            # Current name by ID survives menu renames.
            menu = by_id.get(line.menu_id)
            if menu:
                dishes[menu.name] += line.qty
                categories[menu.category] += line.qty
    observed = min(daily, default=today)
    calendar = [observed + timedelta(days=i) for i in range((today - observed).days)]
    matching = [day for day in calendar if day.weekday() == target.weekday()]
    sample = matching or calendar
    baseline = round(sum(daily[day] for day in sample) / len(sample)) if sample else 0
    saved = ForecastHistory.query.filter_by(branch_id=g.branch_id, target_date=target).first()
    # Only a prediction recorded before the target day counts as an AI prediction.
    target_start, _ = day_bounds(target)
    valid_saved = saved is not None and saved.generated_at < target_start
    predicted = saved.orders if valid_saved else baseline
    completed = 0
    if target == today:
        begin, finish = day_bounds(today)
        completed = Order.query.filter(Order.branch_id == g.branch_id, Order.created_at >= begin,
                                       Order.created_at < finish, Order.status != 'cancelled').count()
    remaining = max(0, predicted - completed)
    shares = {key: value / sum(categories.values()) for key, value in categories.items()} if categories else {}
    per_order = sum(dishes.values()) / len(history) if history else 1
    portions = expected_portions(menus, remaining * per_order, shares, dishes)
    rates = historical_modifier_rates(history, menus)
    rows = outlook_rows(menus, ingredients, remaining, shares, dishes, per_order, target_day=target, modifier_rates=rates)
    reserved = {}
    if target > today:
        today_sample = [day for day in calendar if day.weekday() == today.weekday()] or calendar
        today_baseline = round(sum(daily[day] for day in today_sample) / len(today_sample)) if today_sample else 0
        today_saved = ForecastHistory.query.filter_by(branch_id=g.branch_id, target_date=today).first()
        today_start, today_end = day_bounds(today)
        today_prediction = today_saved.orders if today_saved and today_saved.generated_at < today_start else today_baseline
        accepted = Order.query.filter(Order.branch_id == g.branch_id, Order.created_at >= today_start,
                                      Order.created_at < today_end, Order.status != 'cancelled').count()
        today_rows = outlook_rows(menus, ingredients, max(0, today_prediction - accepted),
                                 shares, dishes, per_order, target_day=today, modifier_rates=rates)
        reserved = {row['id']: row['expectedDemand'] for row in today_rows}
    by_ingredient = {str(item.id): item for item in ingredients}
    for row in rows:
        item = by_ingredient[row['id']]
        available = available_quantity(item, target)
        # Consume lots expiring today first. Only the remaining demand reduces tomorrow's stock.
        expiring_today = available_quantity(item, today) - available
        reserved_for_today = max(0, reserved.get(row['id'], 0) - expiring_today)
        row['stock'] = max(0, available - reserved_for_today)
        row['shortage'] = max(0, row['targetStock'] - row['stock'])
        amount = round_up(row['shortage'], row['purchaseStep'])
        if item.purchase_unit == 'pack':
            amount = round_up(amount, item.purchase_size)
        row.update(purchaseExcess=max(0, amount - row['shortage']), purchaseUnit=item.purchase_unit or item.unit, purchaseSize=item.purchase_size,
                   purchaseQuantity=round(amount / item.purchase_size, 6), suggested=amount,
                   estimatedCost=round(amount * float(item.price), 2),
                   excludedExpired=item.quantity - available, reservedForToday=reserved_for_today)
    return jsonify(date=target.isoformat(), source='ai' if valid_saved else 'baseline',
                   sampleDays=len(sample), predictedOrders=predicted, acceptedOrders=completed,
                   remainingOrders=remaining, hasHistory=bool(history),
                   modifierSampleDishes=sum(line.qty for order in history for line in order.items if line.recipe_snapshot is not None or line.modifiers),
                   ingredients=rows, estimatedCost=round(sum(row['estimatedCost'] for row in rows), 2),
                   menus=[{'id': str(menu.id), 'name': menu.name, 'portions': portions.get(menu.id, 0)}
                          for menu in menus if menu.id in portions])
