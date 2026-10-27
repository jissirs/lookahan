from decimal import Decimal
import pytest
from app import create_app, db
from app.models import Ingredient, User
from app.restaurant_models import AuditEvent, Payment


@pytest.fixture
def client():
    app = create_app('testing')
    with app.app_context():
        db.create_all()
        client = app.test_client()
        client.post('/api/v1/auth/register', json={'name': 'Owner', 'surname': 'Shop', 'email': 'owner@example.test', 'password': 'TestFlow123!'})
        result = client.post('/api/v1/auth/login', json={'identifier': 'owner@example.test', 'password': 'TestFlow123!'})
        client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + result.json['token']
        yield client
        db.session.remove(); db.drop_all()


def setup_dish(client):
    ingredient = client.post('/api/v1/ingredients', json={'name': 'Pork', 'category': 'Meat', 'unit': 'g', 'price': '.15'}).json['id']
    client.post('/api/v1/ingredients/' + ingredient + '/adjust', json={'delta': 1000})
    result = client.post('/api/v1/menus', json={'name': 'Rice', 'price': '60.25', 'available': True,
        'recipe': [{'ingredientId': ingredient, 'qty': 100}],
        'modifiers': [{'name': 'Extra', 'price': 10, 'ingredients': [{'ingredientId': ingredient, 'qty': 50}]},
                      {'name': 'No pork', 'price': 0, 'ingredients': [{'ingredientId': ingredient, 'qty': -100}]}]})
    assert result.status_code == 201, result.json
    return ingredient, result.json['id']


def create(client, menu, **extra):
    body = {'items': [{'menuId': menu, 'qty': 1}], 'requestKey': 'order-request-0001', **extra}
    return client.post('/api/v1/orders', json=body)


def pay(client, order, **extra):
    return client.post('/api/v1/orders/' + order + '/payments', json={'requestKey': 'payment-request-0001', 'method': 'cash', 'amount': '60.25', 'tendered': '100', **extra})


def test_pending_staff_approval_and_revocation(client):
    other = client.application.test_client()
    response = other.post('/api/v1/auth/register', json={'name': 'Staff', 'surname': 'Shop', 'email': 'staff@example.test', 'password': 'TestFlow123!'})
    key = response.json['user']['id']
    assert response.json['user']['approved'] is False
    login = lambda: other.post('/api/v1/auth/login', json={'identifier': 'staff@example.test', 'password': 'TestFlow123!'})
    assert login().status_code == 403
    assert client.patch('/api/v1/staff/' + key, json={'approved': True}).status_code == 200
    other.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + login().json['token']
    assert other.get('/api/v1/snapshot').status_code == 200
    assert other.get('/api/v1/staff').status_code == 403
    assert other.post('/api/v1/ingredients', json={}).status_code == 403
    assert other.post('/api/v1/cash/close', json={}).status_code == 403
    assert client.patch('/api/v1/staff/' + key, json={'approved': False}).status_code == 200
    assert other.get('/api/v1/snapshot').status_code == 401
    assert client.patch('/api/v1/staff/1', json={'approved': False}).status_code == 400


def test_variations_stock_price_and_idempotent_replay(client):
    ingredient, menu = setup_dish(client)
    body = {'items': [{'menuId': menu, 'qty': 2, 'modifiers': ['Extra'], 'note': 'mild'}, {'menuId': menu, 'qty': 1, 'modifiers': ['No pork']}], 'serviceType': 'dine_in', 'tableLabel': 'A1'}
    result = create(client, menu, **body)
    assert result.status_code == 201, result.json
    order = result.json['order']
    assert order['total'] == 200.75 and order['balance'] == 200.75
    assert order['tableLabel'] == 'A1' and len(order['items']) == 2
    assert db.session.get(Ingredient, int(ingredient)).quantity == 700
    replay = create(client, menu, **body)
    assert replay.status_code == 200 and replay.json['order']['id'] == order['id']
    assert replay.json['movements'] == []
    assert db.session.get(Ingredient, int(ingredient)).quantity == 700
    assert create(client, menu).status_code == 409
    assert client.delete('/api/v1/ingredients/' + ingredient).status_code == 409


def test_payment_split_change_refund_and_cash_close(client):
    _, menu = setup_dish(client)
    order = create(client, menu).json['order']['id']
    response = pay(client, order, amount='20', tendered='100')
    assert response.status_code == 201, response.json
    assert response.json['paid'] == 20 and response.json['balance'] == 40.25
    assert response.json['payments'][0]['change'] == 80
    assert pay(client, order, amount='20', tendered='100').status_code == 200
    assert Payment.query.count() == 1
    assert pay(client, order).status_code == 409
    assert pay(client, order, requestKey='payment-request-0002', method='transfer', amount='40.25').json['balance'] == 0
    assert pay(client, order, requestKey='payment-request-0003', amount='1').status_code == 400
    assert client.post('/api/v1/orders/' + order + '/cancel').status_code == 400
    assert pay(client, order, requestKey='payment-request-0004', amount='21', refund=True, note='error').status_code == 400
    assert pay(client, order, requestKey='payment-request-0005', amount='10', refund=True, note='error').json['paid'] == 50.25
    cash = client.get('/api/v1/cash/today').json
    assert cash['cash'] == 10 and cash['transfer'] == 40.25 and cash['refunds'] == 10
    close = client.post('/api/v1/cash/close', json={'opening': 500, 'counted': 508})
    assert close.status_code == 201 and close.json['expected'] == 510 and close.json['variance'] == -2
    assert pay(client, order, requestKey='payment-request-0006', amount='10').status_code == 409
    assert client.post('/api/v1/cash/close', json={'counted': 0}).status_code == 409


def test_modifier_validation_and_rollback(client):
    ingredient, menu = setup_dish(client)
    for options in [['missing'], ['Extra', 'Extra'], ['No pork', 'No pork'], ['Extra', 'No pork'], {}]:
        result = create(client, menu, items=[{'menuId': menu, 'qty': 1, 'modifiers': options}])
        assert result.status_code == 400
    assert db.session.get(Ingredient, int(ingredient)).quantity == 1000
    assert create(client, menu, serviceType='dine_in').status_code == 400
    assert create(client, menu, items=[{'menuId': menu, 'qty': 50}, {'menuId': menu, 'qty': 50}]).status_code == 400


def test_rate_limit_is_server_side_and_audit_has_no_body(client):
    for _ in range(15):
        assert client.post('/api/v1/auth/login', json={'identifier': 'none', 'password': 'wrong'}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'identifier': 'none', 'password': 'wrong'}).status_code == 429
    setup_dish(client)
    entries = client.get('/api/v1/audit').json
    assert any(e['action'] == 'POST /api/v1/ingredients' for e in entries)
    assert all(set(e) == {'id', 'userId', 'action', 'requestId', 'createdAt'} for e in entries)
    assert client.get('/api/v1/health').headers['X-Request-ID']


def test_snapshot_query_count_does_not_grow_per_order(client):
    from sqlalchemy import event
    from app.models import Order
    setup_dish(client)
    def count():
        db.session.remove()
        queries = []
        def capture(*_):
            queries.append(1)
        event.listen(db.engine, 'before_cursor_execute', capture)
        try:
            assert client.get('/api/v1/snapshot').status_code == 200
        finally:
            event.remove(db.engine, 'before_cursor_execute', capture)
        return len(queries)
    db.session.add(Order(branch_id=1, number='0001', total=60, status='done'))
    db.session.commit()
    first = count()
    db.session.add_all([Order(branch_id=1, number=str(n).zfill(4), total=60, status='done') for n in range(2, 22)])
    db.session.commit()
    assert count() <= first + 1


def test_empty_production_shop_requires_private_owner_bootstrap():
    app = create_app('testing')
    app.config['IS_PRODUCTION'] = True
    with app.app_context():
        db.create_all()
        client = app.test_client()
        response = client.post('/api/v1/auth/register', json={'name': 'Public', 'surname': 'Visitor', 'email': 'public@example.test', 'password': 'TestFlow123!'})
        assert response.status_code == 403 and User.query.count() == 0
        result = app.test_cli_runner().invoke(args=['bootstrap-owner', '--email', 'owner@example.test', '--name', 'Owner'], input='TestFlow123!\nTestFlow123!\n')
        assert result.exit_code == 0, result.output
        assert User.query.one().approved and User.query.one().role == 'owner'
        db.session.remove(); db.drop_all()
