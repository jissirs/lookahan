"""Exploratory acceptance tests. Run explicitly: python -m pytest qa/workflow_audit.py -v.

Assertions describe expected user-facing behavior. Failures are findings, not production writes.
This module is intentionally separate from the existing regression suite.
"""
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest

from app import create_app, db
from app.forecast import day_bounds, local_today
from app.models import (Branch, User, Ingredient, IngredientBatch, Menu, Movement, Order,
                        PasswordReset, Session, ForecastHistory, now)
from app.tools import hash_password

PASSWORD = 'QaFlow123!'
EMAIL = 'audit@example.test'


@pytest.fixture
def client():
    app = create_app('testing')
    with app.app_context():
        db.create_all()
        client = app.test_client()
        assert client.post('/api/v1/auth/register', json={
            'name': 'Audit', 'surname': 'Tester', 'email': EMAIL, 'password': PASSWORD}).status_code == 201
        login = client.post('/api/v1/auth/login', json={'identifier': EMAIL, 'password': PASSWORD})
        client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + login.json['token']
        yield client
        db.session.remove()
        db.drop_all()


def stock(client, qty=1000, **overrides):
    result = client.post('/api/v1/ingredients', json={'name': 'Pork', 'category': 'Meat', 'unit': 'g',
        'purchaseUnit': 'kg', 'purchaseSize': 1000, 'purchasePrice': 123.45, **overrides})
    assert result.status_code == 201, result.json
    key = result.json['id']
    if qty:
        assert client.post(f'/api/v1/ingredients/{key}/adjust', json={'delta': qty}).status_code == 200
    return key


def dish(client, key, qty=100, price=65.75):
    result = client.post('/api/v1/menus', json={'name': 'QA Dish', 'category': 'อาหารจานเดียว', 'price': price,
        'available': True, 'recipe': [{'ingredientId': key, 'qty': qty}]})
    assert result.status_code == 201, result.json
    return result.json['id']


def order(client, menu, qty=1):
    return client.post('/api/v1/orders', json={'items': [{'menuId': menu, 'qty': qty}]})


def assert_ledger(key):
    item = db.session.get(Ingredient, int(key))
    assert sum(move.amount for move in Movement.query.filter_by(ingredient_id=key)) == item.quantity
    assert sum(batch.remaining for batch in item.batches) == item.quantity
    assert item.quantity >= 0


@pytest.mark.parametrize('path', ['/snapshot', '/ingredients', '/menus', '/orders', '/dashboard/summary',
                                  '/dashboard/purchasing', '/ai/accuracy', '/closing/today', '/notifications'])
def test_auth_required(client, path):
    client.environ_base.pop('HTTP_AUTHORIZATION')
    assert client.get('/api/v1' + path).status_code == 401


def test_login_wrong_then_valid_and_logout_invalidates_token(client):
    assert client.post('/api/v1/auth/login', json={'identifier': EMAIL, 'password': 'wrong'}).status_code == 401
    assert client.get('/api/v1/auth/me').status_code == 200
    assert client.post('/api/v1/auth/logout').status_code == 200
    assert client.get('/api/v1/snapshot').status_code == 401


def test_expired_session_returns_401(client):
    Session.query.one().expires_at = now() - timedelta(seconds=1)
    db.session.commit()
    assert client.get('/api/v1/snapshot').status_code == 401


def test_password_reset_complete_invalidates_old_sessions_and_cannot_replay(client):
    response = client.post('/api/v1/auth/otp', json={'email': EMAIL})
    assert response.status_code == 200
    otp = response.json['otp']
    assert client.post('/api/v1/auth/otp', json={'email': EMAIL}).status_code == 429
    assert client.post('/api/v1/auth/otp/verify', json={'email': EMAIL, 'otp': '000000' if otp != '000000' else '111111'}).status_code == 400
    token = client.post('/api/v1/auth/otp/verify', json={'email': EMAIL, 'otp': otp}).json['resetToken']
    fields = {'resetToken': token, 'newPassword': 'NewQaFlow456!'}
    assert client.post('/api/v1/auth/password/reset', json=fields).status_code == 200
    assert client.get('/api/v1/auth/me').status_code == 401
    assert client.post('/api/v1/auth/password/reset', json=fields).status_code == 400
    assert client.post('/api/v1/auth/login', json={'identifier': EMAIL, 'password': PASSWORD}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'identifier': EMAIL, 'password': 'NewQaFlow456!'}).status_code == 200


def test_expired_otp_cannot_verify(client):
    result = client.post('/api/v1/auth/otp', json={'email': EMAIL})
    PasswordReset.query.one().expires_at = now() - timedelta(seconds=1)
    db.session.commit()
    assert client.post('/api/v1/auth/otp/verify', json={'email': EMAIL, 'otp': result.json['otp']}).status_code == 400


def test_signup_duplicate_email_is_case_insensitive(client):
    assert client.post('/api/v1/auth/register', json={'name': 'Other', 'surname': 'Tester',
        'email': EMAIL.upper(), 'password': PASSWORD}).status_code == 409


def test_uninvited_signup_cannot_read_existing_store(client):
    key = stock(client)
    stranger = client.application.test_client()
    registered = stranger.post('/api/v1/auth/register', json={'name': 'Stranger', 'surname': 'Other',
        'email': 'stranger@example.test', 'password': PASSWORD})
    if registered.status_code in (401, 403):
        return
    logged_in = stranger.post('/api/v1/auth/login', json={'identifier': 'stranger@example.test', 'password': PASSWORD})
    if logged_in.status_code == 403:
        assert logged_in.json['error']['code'] == 'PENDING_APPROVAL'
        assert stranger.get('/api/v1/snapshot').status_code == 401
        return
    stranger.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + logged_in.json['token']
    assert all(row['id'] != key for row in stranger.get('/api/v1/snapshot').json['ingredients']), 'Uninvited signup can read the existing shop inventory'


def test_foreign_branch_ids_cannot_be_read_or_mutated(client):
    branch = Branch(name='Other shop')
    db.session.add(branch); db.session.flush()
    foreign = Ingredient(branch_id=branch.id, name='Foreign', category='Meat', unit='g', price=1, quantity=10)
    db.session.add(foreign); db.session.commit()
    assert client.patch(f'/api/v1/ingredients/{foreign.id}', json={'name': 'hijacked'}).status_code == 404
    assert client.post(f'/api/v1/ingredients/{foreign.id}/adjust', json={'delta': 1}).status_code == 404
    assert all(row['id'] != str(foreign.id) for row in client.get('/api/v1/snapshot').json['ingredients'])


def test_purchase_receive_decimal_units_and_bad_adjustment_rollback(client):
    key = stock(client, qty=0)
    response = client.post(f'/api/v1/ingredients/{key}/adjust', json={'delta': .125, 'inPurchaseUnits': True,
        'expiresOn': (local_today() + timedelta(days=1)).isoformat(), 'batchLabel': 'LOT-A'})
    assert response.json['ingredient']['quantity'] == 125
    assert response.json['ingredient']['purchasePrice'] == 123.45
    assert client.post(f'/api/v1/ingredients/{key}/adjust', json={'delta': -126}).status_code == 409
    assert client.post(f'/api/v1/ingredients/{key}/adjust', json={'delta': 0}).status_code == 400
    assert_ledger(key)


def test_duplicate_ingredient_name_rejected(client):
    stock(client)
    assert client.post('/api/v1/ingredients', json={'name': ' pork ', 'category': 'Other', 'unit': 'pcs'}).status_code == 409


def test_unit_change_cannot_corrupt_existing_recipe_and_history(client):
    key = stock(client)
    dish(client, key)
    assert client.patch(f'/api/v1/ingredients/{key}', json={'unit': 'pcs'}).status_code == 400
    assert db.session.get(Ingredient, int(key)).unit == 'g'


def test_recipe_duplicate_foreign_and_fractional_quantity_rejected(client):
    key = stock(client)
    menu = dish(client, key)
    for recipe in [[{'ingredientId': key, 'qty': .5}], [{'ingredientId': key, 'qty': 1}, {'ingredientId': key, 'qty': 1}]]:
        assert client.patch(f'/api/v1/menus/{menu}', json={'recipe': recipe}).status_code == 400
    assert client.patch(f'/api/v1/menus/{menu}', json={'recipe': [{'ingredientId': '9999', 'qty': 1}]}).status_code == 404
    assert db.session.get(Menu, int(menu)).recipe[0].quantity == 100


def test_order_full_lifecycle_and_exact_revenue(client):
    key = stock(client)
    menu = dish(client, key)
    response = order(client, menu, 2)
    assert response.status_code == 201
    created = response.json['order']
    assert created['total'] == 131.5
    assert db.session.get(Ingredient, int(key)).quantity == 800
    for expected in ['cooking', 'ready', 'done']:
        assert client.post(f"/api/v1/orders/{created['id']}/advance").json['status'] == expected
    assert client.post(f"/api/v1/orders/{created['id']}/advance").status_code == 400
    assert client.post(f"/api/v1/orders/{created['id']}/cancel").status_code == 400
    summary = client.get('/api/v1/dashboard/summary').json['statistics']
    assert summary == {'orders': 1, 'revenue': 131.5, 'bestSeller': 'QA Dish'}
    assert_ledger(key)


def test_cancel_before_cooking_restores_and_started_orders_become_waste_once(client):
    key = stock(client)
    menu = dish(client, key)
    for steps in range(3):
        created = order(client, menu).json['order']
        for _ in range(steps):
            client.post(f"/api/v1/orders/{created['id']}/advance")
        assert client.post(f"/api/v1/orders/{created['id']}/cancel").status_code == 200
        assert client.post(f"/api/v1/orders/{created['id']}/cancel").status_code == 400
        assert db.session.get(Ingredient, int(key)).quantity == 1000 - 100 * steps
    assert client.get('/api/v1/dashboard/summary').json['statistics']['revenue'] == 0
    assert_ledger(key)


def test_order_shortage_is_atomic_and_closed_menu_cannot_order(client):
    key = stock(client, qty=50)
    menu = dish(client, key)
    assert order(client, menu).status_code == 409
    assert Order.query.count() == 0
    assert db.session.get(Ingredient, int(key)).quantity == 50
    client.patch(f'/api/v1/menus/{menu}', json={'available': False})
    assert order(client, menu).status_code == 400
    assert_ledger(key)


def test_duplicate_order_lines_cannot_bypass_99_quantity_limit(client):
    key = stock(client, qty=20000)
    menu = dish(client, key)
    response = client.post('/api/v1/orders', json={'items': [{'menuId': menu, 'qty': 99}, {'menuId': menu, 'qty': 99}]})
    assert response.status_code == 400, f'Accepted {response.json.get("order", {}).get("items", [])}'


def test_consuming_last_usable_stock_notifies_even_when_expired_stock_remains(client):
    key = stock(client, qty=2000)
    item = db.session.get(Ingredient, int(key))
    item.batches[0].remaining = 1900
    item.batches[0].expires_on = local_today() - timedelta(days=1)
    item.batches.append(IngredientBatch(remaining=100, received_qty=100, label='Usable'))
    db.session.commit()
    menu = dish(client, key)
    assert order(client, menu).status_code == 201
    snapshot = client.get('/api/v1/snapshot').json['ingredients'][0]
    assert snapshot['usableQuantity'] == 0 and snapshot['quantity'] == 1900
    alerts = client.get('/api/v1/notifications').json['items']
    assert any('วัตถุดิบหมด' in alert['title'] for alert in alerts), 'No out-of-stock notification when all usable stock was consumed'


def test_discard_expired_batch_does_not_remove_other_lots(client):
    key = stock(client)
    item = db.session.get(Ingredient, int(key))
    old = item.batches[0]
    old.expires_on = local_today() - timedelta(days=1)
    db.session.commit()
    client.post(f'/api/v1/ingredients/{key}/adjust', json={'delta': 500, 'expiresOn': (local_today() + timedelta(days=1)).isoformat()})
    response = client.post(f'/api/v1/ingredients/{key}/batches/{old.id}/discard')
    assert response.json['ingredient']['quantity'] == 500
    assert response.json['ingredient']['usableQuantity'] == 500
    assert client.post(f'/api/v1/ingredients/{key}/batches/{old.id}/discard').status_code == 400
    assert_ledger(key)


def test_closing_once_reconciles_counts_waste_and_exact_money(client):
    key = stock(client)
    response = client.post('/api/v1/closing', json={'lines': [{'ingredientId': key, 'countedQty': 800, 'wasteQty': 100}]})
    assert response.status_code == 201
    assert response.json['leftoverValue'] == 98.76
    assert response.json['wasteValue'] == 12.34 or response.json['wasteValue'] == 12.35
    assert client.post('/api/v1/closing', json={'lines': [{'ingredientId': key, 'countedQty': 800}]}).status_code == 409
    assert client.get('/api/v1/closing/history').json['summary']['count'] == 1
    assert_ledger(key)


def test_failed_closing_does_not_partially_update_stock(client):
    key = stock(client)
    response = client.post('/api/v1/closing', json={'lines': [
        {'ingredientId': key, 'countedQty': 100, 'wasteQty': 0},
        {'ingredientId': key, 'countedQty': -1, 'wasteQty': 0}]})
    assert response.status_code == 400
    assert db.session.get(Ingredient, int(key)).quantity == 1000
    assert client.get('/api/v1/closing/today').json['closing'] is None
    assert_ledger(key)


def test_notification_read_is_idempotent(client):
    key = stock(client)
    created = order(client, dish(client, key)).json['order']
    result = client.get('/api/v1/notifications').json
    key = result['items'][0]['id']
    before = result['unread']
    assert client.post(f'/api/v1/notifications/{key}/read').status_code == 200
    assert client.post(f'/api/v1/notifications/{key}/read').status_code == 200
    assert client.get('/api/v1/notifications').json['unread'] == before - 1
    assert client.post('/api/v1/notifications/read-all').status_code == 200
    assert client.get('/api/v1/notifications').json['unread'] == 0


def test_ai_not_configured_has_explicit_error_without_saved_forecast(client):
    key = stock(client)
    order(client, dish(client, key))
    response = client.post('/api/v1/ai/forecast')
    assert response.status_code == 503
    assert response.json['error']['code'] == 'AI_NOT_CONFIGURED'
    assert client.get('/api/v1/dashboard/summary').json['forecast'] is None


def test_ai_pipeline_purchasing_accuracy_feedback_and_no_fabricated_actuals(client):
    key = stock(client)
    order(client, dish(client, key))
    answer = {'hourly': [{'hour': '12:00', 'orders': 12}], 'categories': [{'category': 'อาหารจานเดียว', 'share': 1}]}
    with patch('app.routes.ai.ask_groq', return_value=answer):
        forecast = client.post('/api/v1/ai/forecast')
    assert forecast.status_code == 200
    tomorrow = (local_today() + timedelta(days=1)).isoformat()
    plan = client.get('/api/v1/dashboard/purchasing?date=' + tomorrow).json
    assert plan['source'] == 'ai' and plan['predictedOrders'] == 12
    assert client.get('/api/v1/ai/accuracy').json['summary']['count'] == 0
    assert client.put('/api/v1/ai/feedback/restock-1', json={'helpful': True}).status_code == 200
    assert client.put('/api/v1/ai/feedback/restock-1', json={'helpful': False}).status_code == 200
    assert client.get('/api/v1/ai/feedback').json == {'restock-1': False}


@pytest.mark.parametrize('path, fields', [
    ('/auth/register', {'name': [], 'surname': 'QA', 'email': 'invalid@example.test', 'password': PASSWORD}),
    ('/auth/login', {'identifier': EMAIL, 'password': 123456789}),
    ('/ingredients', {'name': [], 'category': 'Meat', 'unit': 'g'}),
    ('/ingredients', {'name': 'Invalid category', 'category': [], 'unit': 'g'}),
])
def test_malformed_field_types_return_validation_not_500(client, path, fields):
    result = client.post('/api/v1' + path, json=fields)
    assert 400 <= result.status_code < 500, f'{path}: got {result.status_code}'


def test_price_upper_limit_roundtrip_cannot_make_its_own_edit_invalid(client):
    key = stock(client, qty=0, purchaseUnit='pack', purchaseSize=3, purchasePrice=999999999.99)
    current = client.get('/api/v1/ingredients').json[0]
    result = client.patch(f'/api/v1/ingredients/{key}', json={
        'purchaseUnit': current['purchaseUnit'], 'purchaseSize': current['purchaseSize'], 'purchasePrice': current['purchasePrice']})
    assert result.status_code == 200
