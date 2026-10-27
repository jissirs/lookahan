"""Readiness probes beyond happy paths. Disposable TestingConfig DB; failures are findings.

Run: python -m pytest qa/completeness_audit.py -q --tb=short
Do not include in green regression totals until each finding has been resolved.
"""
import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests'))
from test_restaurant import client, setup_dish, create
from app import db
from app.models import Ingredient, IngredientBatch, Order, BatchAllocation


def test_retrying_same_kitchen_action_does_not_skip_a_stage(client):
    _, menu = setup_dish(client)
    order = create(client, menu).json['order']
    url = '/api/v1/orders/' + order['id'] + '/advance'
    body = {'requestKey': 'retry-kitchen-action', 'revision': order['revision']}
    first = client.post(url, json=body)
    assert first.status_code == 200 and first.json['status'] == 'cooking'
    second = client.post(url, json=body)
    actual = db.session.get(Order, int(order['id'])).status
    assert actual == 'cooking', f'One kitchen action sent twice moved new -> {actual}; second HTTP {second.status_code}'


def test_cash_close_does_not_accept_new_orders_that_cannot_be_paid(client):
    ingredient, menu = setup_dish(client)
    assert client.post('/api/v1/cash/close', json={'opening': 0, 'counted': 0}).status_code == 201
    result = create(client, menu)
    assert result.status_code == 409, f'After cash close, new order HTTP {result.status_code}; stock now {db.session.get(Ingredient, int(ingredient)).quantity}'


def test_cancel_cannot_rewrite_sales_of_a_closed_business_day(client):
    _, menu = setup_dish(client)
    order = create(client, menu).json['order']
    assert client.post('/api/v1/cash/close', json={'opening': 0, 'counted': 0}).status_code == 201
    before = client.get('/api/v1/reports/operations?days=1').json['sales']
    result = client.post('/api/v1/orders/' + order['id'] + '/cancel', json={'reason': 'audit cancellation after close'})
    after = client.get('/api/v1/reports/operations?days=1').json['sales']
    assert result.status_code == 409 and after == before, f'Closed-day cancellation HTTP {result.status_code}; sales changed {before} -> {after}'


def test_unit_change_checks_ingredients_used_only_by_modifiers(client):
    egg = client.post('/api/v1/ingredients', json={'name': 'Egg option', 'category': 'Other', 'unit': 'pcs', 'price': 5}).json['id']
    menu = client.post('/api/v1/menus', json={'name': 'Option-only dish', 'price': 50, 'available': True,
        'recipe': [], 'modifiers': [{'name': 'Add egg', 'price': 10, 'ingredients': [{'ingredientId': egg, 'qty': 1}]}]})
    assert menu.status_code == 201
    result = client.patch('/api/v1/ingredients/' + egg, json={'unit': 'g'})
    assert result.status_code == 400, f'Ingredient referenced by option changed pcs -> g; HTTP {result.status_code}'


@pytest.mark.parametrize('operation', ['cancel', 'edit'])
def test_returning_legacy_stock_does_not_invent_known_cost(client, operation):
    ingredient, menu = setup_dish(client)
    order = create(client, menu).json['order']
    # Reproduce a pre-batch order: recorded ingredient usage, no lot allocations/cost.
    BatchAllocation.query.filter_by(order_id=int(order['id'])).delete()
    db.session.get(Order, int(order['id'])).ingredient_cost = None
    db.session.commit()
    if operation == 'cancel':
        result = client.post('/api/v1/orders/' + order['id'] + '/cancel')
    else:
        result = client.post('/api/v1/orders/' + order['id'] + '/edit', json={'requestKey': 'edit-legacy-order', 'revision': 1,
            'items': [{'menuId': menu, 'qty': 1, 'modifiers': ['No pork']}]})
    assert result.status_code == 200, result.json
    returned = IngredientBatch.query.filter_by(ingredient_id=int(ingredient)).order_by(IngredientBatch.id.desc()).first()
    assert returned.unit_cost is None, f'{operation} assigned current price {returned.unit_cost} to an unknown historical cost'
