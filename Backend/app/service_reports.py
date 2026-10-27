from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from flask import Blueprint, current_app, g, jsonify, request
from .forecast import day_bounds, local_today
from .models import Order
from .restaurant_models import Payment
from .service_models import Purchase, PurchaseReceipt, WasteRecord
from .restaurant import owner
from .tools import ApiError

bp = Blueprint('service_reports', __name__)


@bp.get('/reports/operations')
def operations():
    owner()
    try:
        days = int(request.args.get('days', 30))
        if not 1 <= days <= 90:
            raise ValueError()
    except ValueError:
        raise ApiError('VALIDATION', 'เลือกช่วงรายงาน 1–90 วัน')
    start, _ = day_bounds(local_today() - timedelta(days=days - 1))
    _, end = day_bounds(local_today())
    orders = Order.query.filter(Order.branch_id == g.branch_id, Order.created_at >= start, Order.created_at < end, Order.status != 'cancelled').all()
    payments = Payment.query.filter(Payment.branch_id == g.branch_id, Payment.created_at >= start, Payment.created_at < end).all()
    waste = WasteRecord.query.filter(WasteRecord.branch_id == g.branch_id, WasteRecord.created_at >= start, WasteRecord.created_at < end).all()
    receipts = PurchaseReceipt.query.join(Purchase).filter(Purchase.branch_id == g.branch_id,
        PurchaseReceipt.created_at >= start, PurchaseReceipt.created_at < end).all()
    known = [x for x in orders if x.ingredient_cost is not None]
    known_sales = sum((x.total for x in known), Decimal(0))
    cost = sum((x.ingredient_cost for x in known), Decimal(0))
    waste_cost = sum((x.cost for x in waste if x.cost is not None), Decimal(0))
    groups = defaultdict(lambda: {'records': 0, 'cost': Decimal(0), 'unknownCost': 0})
    for row in waste:
        group = groups[row.reason]
        group['records'] += 1
        if row.cost is None:
            group['unknownCost'] += 1
        else:
            group['cost'] += row.cost
    offset = timedelta(hours=current_app.config['TIMEZONE_OFFSET_HOURS'])
    daily = defaultdict(lambda: {'sales': Decimal(0), 'received': Decimal(0), 'knownIngredientCost': Decimal(0), 'orders': 0})
    for row in orders:
        item = daily[(row.created_at + offset).date().isoformat()]
        item['sales'] += row.total; item['orders'] += 1
        item['knownIngredientCost'] += row.ingredient_cost or Decimal(0)
    for row in payments:
        daily[(row.created_at + offset).date().isoformat()]['received'] += row.amount
    return jsonify(days=days, sales=sum((x.total for x in orders), Decimal(0)),
        discounts=sum((x.discount or 0 for x in orders), Decimal(0)),
        received=sum((x.amount for x in payments), Decimal(0)),
        knownCostOrders=len(known), unknownCostOrders=len(orders) - len(known),
        knownIngredientCost=cost, knownSales=known_sales,
        knownGrossProfit=known_sales - cost if known else None,
        knownWasteCost=waste_cost, unknownWasteRecords=sum(x.cost is None for x in waste),
        knownProfitAfterWaste=known_sales - cost - waste_cost if known else None,
        actualPurchases=sum((x.total for x in receipts), Decimal(0)), wasteByReason=dict(groups),
        daily=[{'date': key, **value} for key, value in sorted(daily.items())])
