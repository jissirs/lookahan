import pytest

from app import create_app, db
from app.models import Branch, Ingredient, IngredientBatch, Movement, Order, OrderUsage


@pytest.fixture
def client():
    app = create_app('testing')
    with app.app_context():
        db.create_all()
        client = app.test_client()
        client.post('/api/v1/auth/register', json={'name': 'Delete', 'surname': 'Tester', 'email': 'delete@example.test', 'password': 'TestFlow123!'})
        result = client.post('/api/v1/auth/login', json={'identifier': 'delete@example.test', 'password': 'TestFlow123!'})
        client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + result.json['token']
        yield client
        db.session.remove()
        db.drop_all()


def ingredient(client):
    result = client.post('/api/v1/ingredients', json={'name': 'Pork', 'category': 'Meat', 'unit': 'g', 'price': .15})
    assert result.status_code == 201
    key = result.json['id']
    client.post(f'/api/v1/ingredients/{key}/adjust', json={'delta': 1000})
    return key


def test_delete_hides_active_stock_preserves_quantities_lots_and_ledger_and_restores(client):
    key = ingredient(client)
    old_movements = client.get('/api/v1/movements').json
    response = client.delete('/api/v1/ingredients/' + key)
    assert response.status_code == 200
    assert response.json['deletedAt'] is not None
    assert client.get('/api/v1/snapshot').json['ingredients'] == []
    assert client.get('/api/v1/ingredients').json == []
    assert client.get('/api/v1/dashboard/purchasing').json['ingredients'] == []
    assert client.get('/api/v1/movements').json == old_movements
    assert db.session.get(Ingredient, int(key)).quantity == 1000
    assert IngredientBatch.query.one().remaining == 1000
    assert client.get('/api/v1/ingredients?deleted=true').json[0]['id'] == key
    assert client.delete('/api/v1/ingredients/' + key).status_code == 404
    result = client.post(f'/api/v1/ingredients/{key}/restore')
    assert result.status_code == 200 and result.json['deletedAt'] is None
    assert result.json['quantity'] == 1000
    assert client.get('/api/v1/ingredients?deleted=true').json == []
    assert client.get('/api/v1/snapshot').json['ingredients'][0]['id'] == key
    assert client.post(f'/api/v1/ingredients/{key}/restore').status_code == 200


def test_delete_rejects_recipe_and_active_orders_then_preserves_completed_order_history(client):
    key = ingredient(client)
    result = client.post('/api/v1/menus', json={'name': 'Pork Dish', 'price': 50, 'available': True,
        'recipe': [{'ingredientId': key, 'qty': 100}]})
    menu_id = result.json['id']
    result = client.delete('/api/v1/ingredients/' + key)
    assert result.status_code == 409 and 'Pork Dish' in result.json['error']['message']
    result = client.post('/api/v1/orders', json={'items': [{'menuId': menu_id, 'qty': 1}]})
    assert result.status_code == 201
    order_id = result.json['order']['id']
    client.patch('/api/v1/menus/' + menu_id, json={'recipe': []})
    result = client.delete('/api/v1/ingredients/' + key)
    assert result.status_code == 409 and '#0001' in result.json['error']['message']
    for _ in range(3):
        client.post(f'/api/v1/orders/{order_id}/advance')
    assert client.delete('/api/v1/ingredients/' + key).status_code == 200
    assert Order.query.count() == 1 and OrderUsage.query.one().ingredient_id == int(key)
    assert Movement.query.count() == 2
    assert db.session.get(Ingredient, int(key)).quantity == 900


def test_archived_ingredient_cannot_be_mutated_added_to_recipe_or_counted_until_restore(client):
    key = ingredient(client)
    batch_id = IngredientBatch.query.one().id
    client.delete('/api/v1/ingredients/' + key)
    assert client.patch('/api/v1/ingredients/' + key, json={'name': 'Other'}).status_code == 404
    assert client.post(f'/api/v1/ingredients/{key}/adjust', json={'delta': 1}).status_code == 404
    assert client.post(f'/api/v1/ingredients/{key}/batches/{batch_id}/discard').status_code == 404
    assert client.post('/api/v1/menus', json={'name': 'Bad', 'recipe': [{'ingredientId': key, 'qty': 1}]}).status_code == 404
    assert client.post('/api/v1/closing', json={'lines': [{'ingredientId': key, 'countedQty': 1000}]}).status_code == 404
    assert db.session.get(Ingredient, int(key)).quantity == 1000


def test_foreign_branch_delete_and_restore_are_forbidden(client):
    branch = Branch(name='Another store')
    db.session.add(branch); db.session.flush()
    foreign = Ingredient(branch_id=branch.id, name='Foreign', category='Meat', unit='g', quantity=0, price=0)
    db.session.add(foreign); db.session.commit()
    assert client.delete(f'/api/v1/ingredients/{foreign.id}').status_code == 404
    assert client.post(f'/api/v1/ingredients/{foreign.id}/restore').status_code == 404
    assert client.get('/api/v1/ingredients?deleted=true').json == []


def test_duplicate_archived_name_suggests_restore(client):
    key = ingredient(client)
    client.delete('/api/v1/ingredients/' + key)
    response = client.post('/api/v1/ingredients', json={'name': 'Pork', 'category': 'Meat', 'unit': 'g'})
    assert response.status_code == 409 and 'กู้คืน' in response.json['error']['message']
