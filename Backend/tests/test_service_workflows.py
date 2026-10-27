"""Acceptance cases for the single-shop service upgrade, using disposable SQLite only."""
from decimal import Decimal
import uuid
from test_restaurant import client, setup_dish, create, pay
from app import db
from app.models import Ingredient, Order, BatchAllocation, IngredientBatch, Menu, User, Session
from app.service_models import WasteRecord, PurchaseReceipt
from app.forecast import historical_modifier_rates, build_outlook


def action(client, order, path, **fields):
    revision = db.session.get(Order, int(order)).revision or 1
    return client.post('/api/v1/orders/' + order + '/' + path,
        json={'revision': revision, 'requestKey': str(uuid.uuid4()), **fields})


def test_edit_delta_stale_retry_and_atomic_shortage(client):
    ingredient, menu = setup_dish(client)
    order = create(client, menu).json['order']['id']
    payload = {'revision': 1, 'requestKey': 'edit-once-request', 'items': [{'menuId': menu, 'qty': 2, 'modifiers': ['Extra']}]}
    result = client.post('/api/v1/orders/' + order + '/edit', json=payload)
    assert result.status_code == 200, result.json
    assert result.json['order']['total'] == 140.5
    assert result.json['order']['ingredientCost'] == 45
    assert db.session.get(Ingredient, int(ingredient)).quantity == 700
    assert client.post('/api/v1/orders/' + order + '/edit', json=payload).json == result.json
    assert action(client, order, 'edit', revision=1, items=[{'menuId': menu, 'qty': 1}]).status_code == 409
    assert action(client, order, 'edit', items=[{'menuId': menu, 'qty': 99}]).status_code == 409
    assert db.session.get(Ingredient, int(ingredient)).quantity == 700
    assert action(client, order, 'edit', items=[{'menuId': menu, 'qty': 1}]).status_code == 200
    assert db.session.get(Ingredient, int(ingredient)).quantity == 900
    assert client.post('/api/v1/orders/' + order + '/cancel').status_code == 200
    assert db.session.get(Ingredient, int(ingredient)).quantity == 1000


def test_cooked_cancel_records_cost_without_restoring(client):
    ingredient, menu = setup_dish(client)
    order = create(client, menu).json['order']['id']
    assert client.post('/api/v1/orders/' + order + '/advance').status_code == 200
    result = client.post('/api/v1/orders/' + order + '/cancel', json={'reason': 'ลูกค้าเปลี่ยนใจ'})
    assert result.json['order']['cancellationMode'] == 'waste'
    assert db.session.get(Ingredient, int(ingredient)).quantity == 900
    assert WasteRecord.query.one().cost == Decimal('15')
    assert client.post('/api/v1/orders/' + order + '/cancel').status_code == 400
    assert WasteRecord.query.count() == 1


def test_split_merge_stock_and_cost_conservation(client):
    ingredient, menu = setup_dish(client)
    original = create(client, menu, items=[{'menuId': menu, 'qty': 3, 'modifiers': ['Extra']}]).json['order']
    split = action(client, original['id'], 'split', lines=[{'itemId': original['items'][0]['id'], 'qty': 1}])
    assert split.status_code == 200, split.json
    a, b = split.json['order'], split.json['child']
    assert a['total'] + b['total'] == original['total']
    assert a['ingredientCost'] + b['ingredientCost'] == original['ingredientCost']
    assert db.session.get(Ingredient, int(ingredient)).quantity == 550
    result = action(client, a['id'], 'merge', sourceId=b['id'], sourceRevision=b['revision'])
    assert result.status_code == 200, result.json
    assert result.json['source']['cancellationMode'] == 'merged'
    assert result.json['order']['ingredientCost'] == 67.5
    assert db.session.get(Ingredient, int(ingredient)).quantity == 550
    assert client.post('/api/v1/orders/' + a['id'] + '/cancel').status_code == 200
    assert db.session.get(Ingredient, int(ingredient)).quantity == 1000
    assert client.post('/api/v1/orders/' + b['id'] + '/cancel').status_code == 400


def test_split_cancel_child_and_edit_parent(client):
    ingredient, menu = setup_dish(client)
    order = create(client, menu, items=[{'menuId': menu, 'qty': 2}]).json['order']
    child = action(client, order['id'], 'split', lines=[{'itemId': order['items'][0]['id'], 'qty': 1}]).json['child']
    client.post('/api/v1/orders/' + child['id'] + '/cancel')
    assert action(client, order['id'], 'edit', items=[{'menuId': menu, 'qty': 2}]).status_code == 200
    assert db.session.get(Ingredient, int(ingredient)).quantity == 800


def test_discount_bounds_paid_restrictions_and_table_revision(client):
    _, menu = setup_dish(client)
    order = create(client, menu).json['order']['id']
    assert action(client, order, 'table', serviceType='dine_in', tableLabel='A1').json['order']['tableLabel'] == 'A1'
    assert action(client, order, 'discount', amount=10, reason='เจ้าของอนุมัติ').json['order']['total'] == 50.25
    assert pay(client, order, amount=40, tendered=40).status_code == 201
    assert action(client, order, 'discount', amount=30, reason='มากเกิน').status_code == 400
    assert action(client, order, 'edit', items=[{'menuId': menu, 'qty': 2}]).status_code == 400


def test_purchase_partial_actual_cost_idempotency_and_waste(client):
    ingredient = client.post('/api/v1/ingredients', json={'name': 'Fresh', 'category': 'Meat', 'unit': 'g', 'price': '.15'}).json['id']
    supplier = client.post('/api/v1/suppliers', json={'name': 'Local farm', 'requestKey': 'supplier-test-001'}).json['supplier']['id']
    purchase = client.post('/api/v1/purchases', json={'supplierId': supplier, 'requestKey': 'purchase-test-001', 'lines': [{'ingredientId': ingredient, 'quantity': 1000, 'unitCost': '.15'}]}).json['purchase']
    url = '/api/v1/purchases/' + purchase['id'] + '/receive'
    payload = {'requestKey': 'receipt-test-001', 'lines': [{'lineId': purchase['lines'][0]['id'], 'quantity': 600, 'unitCost': '.20'}]}
    first = client.post(url, json=payload)
    assert first.status_code == 200, first.json
    assert first.json['purchase']['status'] == 'open'
    assert client.post(url, json=payload).json == first.json
    assert PurchaseReceipt.query.count() == 1
    assert db.session.get(Ingredient, int(ingredient)).quantity == 600
    assert client.post(url, json={**payload, 'requestKey': 'receipt-test-002'}).status_code == 400
    second = client.post(url, json={'requestKey': 'receipt-test-003', 'lines': [{'lineId': purchase['lines'][0]['id'], 'quantity': 400, 'unitCost': '.30'}]})
    assert second.json['purchase']['status'] == 'completed'
    menu = client.post('/api/v1/menus', json={'name': 'Fresh dish', 'price': 80, 'available': True, 'recipe': [{'ingredientId': ingredient, 'qty': 700}]}).json['id']
    order = create(client, menu).json['order']
    assert order['ingredientCost'] == 150  # 600*.20 + 100*.30
    client.patch('/api/v1/ingredients/' + ingredient, json={'price': 99})
    assert db.session.get(Order, int(order['id'])).ingredient_cost == 150
    assert client.post('/api/v1/waste', json={'requestKey': 'waste-test-001', 'ingredientId': ingredient, 'quantity': 100, 'reason': 'spoilage'}).json['waste']['cost'] == 30
    report = client.get('/api/v1/reports/operations').json
    assert report['actualPurchases'] == 240 and report['knownGrossProfit'] == -70
    assert report['knownWasteCost'] == 30


def test_offline_price_validation_rolls_back_and_replay_keeps_old_price(client):
    ingredient, menu = setup_dish(client)
    assert create(client, menu, expectedTotal=10).status_code == 409
    assert db.session.get(Ingredient, int(ingredient)).quantity == 1000
    result = create(client, menu, expectedTotal='60.25')
    assert result.status_code == 201
    client.patch('/api/v1/menus/' + menu, json={'price': 90})
    assert create(client, menu, expectedTotal='60.25').json['order']['id'] == result.json['order']['id']
    assert create(client, menu, expectedTotal='60.25', requestKey='different-order-key').status_code == 409


def test_unknown_legacy_cost_not_invented(client):
    ingredient, menu = setup_dish(client)
    IngredientBatch.query.filter_by(ingredient_id=int(ingredient)).update({'unit_cost': None})
    db.session.commit()
    order = create(client, menu).json['order']
    assert order['ingredientCost'] is None
    report = client.get('/api/v1/reports/operations').json
    assert report['knownGrossProfit'] is None and report['unknownCostOrders'] == 1


def test_sessions_self_revoke_and_reauthenticated_owner_transfer(client):
    second = client.application.test_client()
    login = second.post('/api/v1/auth/login', json={'identifier': 'owner@example.test', 'password': 'TestFlow123!'})
    second.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + login.json['token']
    owner = User.query.filter_by(role='owner').one()
    rows = client.get(f'/api/v1/staff/{owner.id}/sessions').json
    other = next(x for x in rows if not x['current'])
    assert 'token' not in str(rows)
    assert client.post(f'/api/v1/staff/{owner.id}/sessions/{other["id"]}/revoke', json={'requestKey': 'revoke-session-001'}).status_code == 200
    assert second.get('/api/v1/snapshot').status_code == 401
    staff = second.post('/api/v1/auth/register', json={'name': 'Staff', 'surname': 'Shop', 'email': 'new@example.test', 'password': 'TestFlow123!'}).json['user']['id']
    client.patch('/api/v1/staff/' + staff, json={'approved': True})
    assert client.post('/api/v1/staff/transfer-owner', json={'requestKey': 'owner-transfer-001', 'userId': staff, 'password': 'wrong'}).status_code == 401
    result = client.post('/api/v1/staff/transfer-owner', json={'requestKey': 'owner-transfer-002', 'userId': staff, 'password': 'TestFlow123!'})
    assert result.status_code == 200, result.json
    assert Session.query.count() == 0
    assert db.session.get(User, int(staff)).role == 'owner'


def test_option_consumption_in_forecast_uses_observed_choice_rates(client):
    ingredient, menu_id = setup_dish(client)
    create(client, menu_id, items=[{'menuId': menu_id, 'qty': 1, 'modifiers': ['Extra']}, {'menuId': menu_id, 'qty': 1}])
    menus = Menu.query.all()
    rates = historical_modifier_rates(Order.query.all(), menus)
    assert rates[int(menu_id)][int(ingredient)] == 25
    rows, _ = build_outlook(menus, Ingredient.query.all(), 1, {}, {'Rice': 2}, 2, rates)
    assert rows[0]['expectedDemand'] == 250


def test_staff_cannot_approve_discounts_purchases_waste_or_ownership(client):
    _, menu = setup_dish(client)
    order = create(client, menu).json['order']['id']
    staff = client.application.test_client()
    account = staff.post('/api/v1/auth/register', json={'name': 'Staff', 'surname': 'Shop', 'email': 'staff2@example.test', 'password': 'TestFlow123!'}).json['user']['id']
    client.patch('/api/v1/staff/' + account, json={'approved': True})
    token = staff.post('/api/v1/auth/login', json={'identifier': 'staff2@example.test', 'password': 'TestFlow123!'}).json['token']
    staff.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + token
    for path in ['/orders/' + order + '/discount', '/purchases', '/suppliers', '/waste', '/staff/transfer-owner']:
        assert staff.post('/api/v1' + path, json={}).status_code == 403
    assert staff.get('/api/v1/reports/operations').status_code == 403
    assert staff.get('/api/v1/staff/1/sessions').status_code == 403
    assert staff.get('/api/v1/staff/' + account + '/sessions').status_code == 200


def test_invalid_inputs_do_not_change_stock_or_raise_server_error(client):
    ingredient, menu = setup_dish(client)
    order = create(client, menu).json['order']['id']
    assert action(client, order, 'table', serviceType='dine_in', tableLabel=None).status_code == 400
    assert action(client, order, 'edit', items=[{'menuId': menu, 'qty': 2}], note=None).status_code == 400
    assert db.session.get(Ingredient, int(ingredient)).quantity == 900
    assert client.post('/api/v1/suppliers', json={'name': None, 'requestKey': 'invalid-supplier-001'}).status_code == 400
    assert client.post('/api/v1/staff/transfer-owner', json={'password': None, 'requestKey': 'invalid-owner-001'}).status_code == 400


def test_closed_business_day_cannot_rewrite_bill(client):
    _, menu = setup_dish(client)
    order = create(client, menu).json['order']['id']
    assert client.post('/api/v1/cash/close', json={'opening': 0, 'counted': 0}).status_code == 201
    assert action(client, order, 'discount', amount=10, reason='ย้อนหลัง').status_code == 409
    assert action(client, order, 'edit', items=[{'menuId': menu, 'qty': 2}]).status_code == 409
