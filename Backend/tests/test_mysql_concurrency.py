"""Opt-in real MySQL tests. MYSQL_TEST_URL must point to an EMPTY lookahan_test_* database."""
import os
from concurrent.futures import ThreadPoolExecutor
import pytest
from sqlalchemy import inspect
from sqlalchemy.engine import make_url
from app import create_app, db
from app.config import TestingConfig


@pytest.fixture
def mysql_app(monkeypatch):
    url = os.getenv('MYSQL_TEST_URL')
    if not url:
        pytest.skip('MYSQL_TEST_URL is not configured; no live shop data used')
    parsed = make_url(url)
    assert parsed.get_backend_name() == 'mysql' and parsed.database.startswith('lookahan_test_')
    monkeypatch.setattr(TestingConfig, 'SQLALCHEMY_DATABASE_URI', url)
    options = {'isolation_level': 'READ COMMITTED', 'pool_pre_ping': True}
    if os.getenv('MYSQL_TEST_SSL_CA'):
        options['connect_args'] = {'ssl': {'ca': os.environ['MYSQL_TEST_SSL_CA']}}
    monkeypatch.setattr(TestingConfig, 'SQLALCHEMY_ENGINE_OPTIONS', options)
    app = create_app('testing')
    with app.app_context():
        assert inspect(db.engine).get_table_names() == [], 'Refusing to modify a nonempty database'
        db.create_all()
    try:
        yield app
    finally:
        with app.app_context():
            db.session.remove(); db.drop_all()


def prepare(app):
    client = app.test_client()
    assert client.post('/api/v1/auth/register', json={'name': 'Owner', 'surname': 'Test', 'email': 'owner@test.example', 'password': 'TestFlow123!'}).status_code == 201
    token = client.post('/api/v1/auth/login', json={'identifier': 'owner@test.example', 'password': 'TestFlow123!'}).json['token']
    client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + token
    ingredient = client.post('/api/v1/ingredients', json={'name': 'Pork', 'category': 'Meat', 'unit': 'g'}).json['id']
    client.post('/api/v1/ingredients/' + ingredient + '/adjust', json={'delta': 100})
    menu = client.post('/api/v1/menus', json={'name': 'Dish', 'price': 50, 'available': True, 'recipe': [{'ingredientId': ingredient, 'qty': 100}]}).json['id']
    return client, token, menu


def test_two_devices_cannot_consume_the_last_plate_twice(mysql_app):
    client, token, menu = prepare(mysql_app)
    def send(key):
        worker = mysql_app.test_client()
        return worker.post('/api/v1/orders', headers={'Authorization': 'Bearer ' + token}, json={'requestKey': key, 'items': [{'menuId': menu, 'qty': 1}]}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(send, ['concurrent-order-one', 'concurrent-order-two']))
    assert sorted(statuses) == [201, 409]
    snapshot = client.get('/api/v1/snapshot').json
    assert len(snapshot['orders']) == 1 and snapshot['ingredients'][0]['quantity'] == 0


def test_concurrent_retries_and_payments_are_once_only(mysql_app):
    client, token, menu = prepare(mysql_app)
    def order(_):
        worker = mysql_app.test_client()
        return worker.post('/api/v1/orders', headers={'Authorization': 'Bearer ' + token}, json={'requestKey': 'same-order-request', 'items': [{'menuId': menu, 'qty': 1}]}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(order, range(2))) == [200, 201]
    order_id = client.get('/api/v1/orders').json[0]['id']
    def pay(_):
        worker = mysql_app.test_client()
        return worker.post('/api/v1/orders/' + order_id + '/payments', headers={'Authorization': 'Bearer ' + token}, json={'requestKey': 'same-payment-request', 'method': 'cash', 'amount': 50}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(pay, range(2))) == [200, 201]
    result = client.get('/api/v1/orders').json[0]
    assert result['paid'] == 50 and len(result['payments']) == 1


def test_concurrent_edits_reject_stale_revision(mysql_app):
    client, token, menu = prepare(mysql_app)
    client.post('/api/v1/ingredients/1/adjust', json={'delta': 900})
    order = client.post('/api/v1/orders', json={'requestKey': 'original-order', 'items': [{'menuId': menu, 'qty': 1}]}).json['order']
    def edit(qty):
        worker = mysql_app.test_client()
        return worker.post('/api/v1/orders/' + order['id'] + '/edit', headers={'Authorization': 'Bearer ' + token}, json={
            'requestKey': 'concurrent-edit-' + str(qty), 'revision': 1, 'items': [{'menuId': menu, 'qty': qty}]}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(edit, [2, 3])) == [200, 409]
    snapshot = client.get('/api/v1/snapshot').json
    accepted = snapshot['orders'][0]['items'][0]['qty']
    assert snapshot['ingredients'][0]['quantity'] == 1000 - accepted * 100


def test_concurrent_purchase_receipt_retries_add_stock_once(mysql_app):
    client, token, _menu = prepare(mysql_app)
    supplier = client.post('/api/v1/suppliers', json={'requestKey': 'supplier-once', 'name': 'Farm'}).json['supplier']['id']
    purchase = client.post('/api/v1/purchases', json={'requestKey': 'purchase-once', 'supplierId': supplier,
        'lines': [{'ingredientId': '1', 'quantity': 100, 'unitCost': '.15'}]}).json['purchase']
    def receipt(_):
        worker = mysql_app.test_client()
        return worker.post('/api/v1/purchases/' + purchase['id'] + '/receive', headers={'Authorization': 'Bearer ' + token}, json={
            'requestKey': 'same-receipt-request', 'lines': [{'lineId': purchase['lines'][0]['id'], 'quantity': 100, 'unitCost': '.2'}]}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(receipt, range(2))) == [200, 200]
    assert client.get('/api/v1/snapshot').json['ingredients'][0]['quantity'] == 200
    assert len(client.get('/api/v1/purchases').json['purchases'][0]['receipts']) == 1
