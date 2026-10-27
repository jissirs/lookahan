from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest

from app import create_app, db
from app.forecast import day_bounds, local_today
from app.models import Ingredient, IngredientBatch, ForecastHistory, Order, BatchAllocation


@pytest.fixture
def client():
    app = create_app('testing')
    with app.app_context():
        db.create_all()
        client = app.test_client()
        client.post('/api/v1/auth/register', json={'name': 'Test', 'surname': 'User', 'email': 'inventory@example.test', 'password': 'StrongPass123!'})
        login = client.post('/api/v1/auth/login', json={'identifier': 'inventory@example.test', 'password': 'StrongPass123!'})
        client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + login.json['token']
        yield client
        db.session.remove()
        db.drop_all()


def ingredient(client, **patches):
    response = client.post('/api/v1/ingredients', json={
        'name': 'Pork', 'category': 'Meat', 'unit': 'g',
        'purchaseUnit': 'kg', 'purchaseSize': 1000, 'purchasePrice': 123.45, **patches})
    assert response.status_code == 201, response.json
    return response.json['id']


def receipt(client, key, amount, day):
    return client.post('/api/v1/ingredients/' + key + '/adjust', json={
        'delta': amount, 'inPurchaseUnits': True, 'expiresOn': day.isoformat()})


def menu(client, key):
    return client.post('/api/v1/menus', json={'name': 'Dish', 'category': 'อาหารจานเดียว',
        'price': 65.75, 'available': True, 'recipe': [{'ingredientId': key, 'qty': 100}]}).json['id']


def test_receipt_units_decimal_price_fefo_and_cancellation_restore_original_lot(client):
    key = ingredient(client)
    later = local_today() + timedelta(days=3)
    earlier = local_today() + timedelta(days=1)
    assert receipt(client, key, .2, later).json['ingredient']['quantity'] == 200
    response = receipt(client, key, .1, earlier)
    early_id = response.json['ingredient']['batches'][-1]['id']
    assert response.json['ingredient']['purchasePrice'] == 123.45
    assert db.session.get(Ingredient, int(key)).price == Decimal('0.123450')
    menu_id = menu(client, key)
    order = client.post('/api/v1/orders', json={'items': [{'menuId': menu_id, 'qty': 1}]})
    assert order.status_code == 201, order.json
    assert order.json['order']['total'] == 65.75
    assert db.session.get(IngredientBatch, int(early_id)).remaining == 0
    order_id = order.json['order']['id']
    allocations = BatchAllocation.query.filter_by(order_id=order_id).all()
    assert len(allocations) == 1 and allocations[0].batch_id == int(early_id)
    cancelled = client.post('/api/v1/orders/' + order_id + '/cancel')
    assert cancelled.status_code == 200
    assert db.session.get(IngredientBatch, int(early_id)).remaining == 100
    assert cancelled.json['ingredients'][0]['quantity'] == 300
    assert client.post('/api/v1/orders/' + order_id + '/cancel').status_code == 400
    assert db.session.get(Ingredient, int(key)).quantity == 300


def test_expired_stock_cannot_be_ordered_and_disposal_preserves_balance(client):
    key = ingredient(client)
    receipt(client, key, .1, local_today())
    batch = IngredientBatch.query.one()
    batch.expires_on = local_today() - timedelta(days=1)
    db.session.commit()
    menu_id = menu(client, key)
    response = client.post('/api/v1/orders', json={'items': [{'menuId': menu_id, 'qty': 1}]})
    assert response.status_code == 409
    assert Order.query.count() == 0
    snap = client.get('/api/v1/snapshot').json['ingredients'][0]
    assert snap['quantity'] == 100 and snap['usableQuantity'] == 0
    response = client.post(f'/api/v1/ingredients/{key}/batches/{batch.id}/discard')
    assert response.status_code == 200
    assert response.json['ingredient']['quantity'] == 0
    assert response.json['movement']['amount'] == -100


@pytest.mark.parametrize('changes', [
    {'purchasePrice': -1}, {'purchasePrice': 12.345}, {'purchasePrice': True},
    {'purchaseUnit': 'l'}, {'purchaseSize': 500}, {'purchaseSize': True},
])
def test_invalid_purchase_config_is_rejected_without_creating_stock(client, changes):
    response = client.post('/api/v1/ingredients', json={'name': 'Bad', 'category': 'Meat', 'unit': 'g',
        'purchaseUnit': 'kg', 'purchaseSize': 1000, 'purchasePrice': 123.45, **changes})
    assert response.status_code == 400
    assert Ingredient.query.count() == 0


def test_receipt_invalid_expiry_or_fraction_rolls_back_all_changes(client):
    key = ingredient(client)
    assert receipt(client, key, .1, local_today() - timedelta(days=1)).status_code == 400
    assert receipt(client, key, .0001, local_today()).status_code == 400
    assert db.session.get(Ingredient, int(key)).quantity == 0
    assert IngredientBatch.query.count() == 0


def test_legacy_stock_and_closing_keep_batch_totals_consistent(client):
    key = ingredient(client)
    item = db.session.get(Ingredient, int(key))
    item.quantity = 200  # Existing data without batches.
    db.session.commit()
    response = client.post('/api/v1/closing', json={'lines': [{'ingredientId': key, 'countedQty': 150, 'wasteQty': 25}]})
    assert response.status_code == 201, response.json
    db.session.refresh(item)
    assert item.quantity == 150
    assert sum(batch.remaining for batch in item.batches) == 150
    assert response.json['leftoverValue'] == 18.52  # HALF_EVEN currency rounding at persistence.


def test_purchasing_subtracts_accepted_orders_excludes_tomorrow_expiry_and_has_no_ai_call(client):
    key = ingredient(client)
    receipt(client, key, .1, local_today())
    menu_id = menu(client, key)
    order = client.post('/api/v1/orders', json={'items': [{'menuId': menu_id, 'qty': 1}]}).json['order']
    historical = db.session.get(Order, int(order['id']))
    historical.created_at = day_bounds(local_today() - timedelta(days=7))[0] + timedelta(hours=12)
    historical.status = 'done'
    db.session.add(ForecastHistory(branch_id=1, target_date=local_today(), orders=3, revenue=200,
        baseline_orders=2, generated_at=day_bounds(local_today())[0] - timedelta(hours=1)))
    db.session.commit()
    receipt(client, key, .1, local_today())
    with patch('app.routes.ai.ask_groq', side_effect=AssertionError('must not call AI')):
        plan = client.get('/api/v1/dashboard/purchasing').json
        assert plan['source'] == 'ai' and plan['remainingOrders'] == 3
        assert plan['ingredients'][0]['shortage'] == 200
        tomorrow = client.get('/api/v1/dashboard/purchasing?date=' + (local_today() + timedelta(days=1)).isoformat()).json
    assert tomorrow['source'] == 'baseline'
    assert tomorrow['ingredients'][0]['stock'] == 0
    assert tomorrow['ingredients'][0]['excludedExpired'] == 100


def test_accuracy_includes_zero_sales_and_recomputes_changed_actuals(client):
    yesterday = local_today() - timedelta(days=1)
    start, _ = day_bounds(yesterday)
    db.session.add(ForecastHistory(branch_id=1, target_date=yesterday, orders=5, revenue=100,
        baseline_orders=2, generated_at=start - timedelta(hours=1)))
    db.session.add(ForecastHistory(branch_id=1, target_date=local_today(), orders=5, revenue=100,
        baseline_orders=2, generated_at=start))
    db.session.commit()
    result = client.get('/api/v1/ai/accuracy').json
    assert result['summary']['count'] == 1
    assert result['summary']['zeroSalesDays'] == 1
    assert result['summary']['ordersMae'] == 5
    assert result['summary']['ordersWape'] is None
    key = ingredient(client)
    receipt(client, key, .1, local_today())
    menu_id = menu(client, key)
    order_id = client.post('/api/v1/orders', json={'items': [{'menuId': menu_id, 'qty': 1}]}).json['order']['id']
    db.session.get(Order, int(order_id)).created_at = start + timedelta(hours=12)
    db.session.commit()
    result = client.get('/api/v1/ai/accuracy').json
    assert result['days'][0]['actualOrders'] == 1
    assert result['summary']['ordersWape'] == 400


def test_tomorrow_purchasing_reserves_stock_needed_for_remaining_orders_today(client):
    key = ingredient(client)
    receipt(client, key, 1, local_today() + timedelta(days=3))
    menu(client, key)
    for day, count in [(local_today(), 6), (local_today() + timedelta(days=1), 8)]:
        db.session.add(ForecastHistory(branch_id=1, target_date=day, orders=count, revenue=100,
            baseline_orders=count, generated_at=day_bounds(local_today())[0] - timedelta(hours=1)))
    db.session.commit()
    plan = client.get('/api/v1/dashboard/purchasing?date=' + (local_today() + timedelta(days=1)).isoformat()).json
    row = plan['ingredients'][0]
    assert row['reservedForToday'] == 600
    assert row['stock'] == 400
    assert row['shortage'] == 400
    assert row['excludedExpired'] == 0


def test_full_pack_recommendation_shows_extra_and_does_not_round_small_cost_to_zero(client):
    key = ingredient(client, purchaseUnit='pack', purchaseSize=100, purchasePrice=.01)
    menu(client, key)
    db.session.add(ForecastHistory(branch_id=1, target_date=local_today(), orders=1, revenue=100,
        baseline_orders=1, generated_at=day_bounds(local_today())[0] - timedelta(hours=1)))
    db.session.commit()
    row = client.get('/api/v1/dashboard/purchasing').json['ingredients'][0]
    assert row['purchaseQuantity'] == 1
    assert row['estimatedCost'] == .01
