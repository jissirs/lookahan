from types import SimpleNamespace as Row

import pytest

from app import create_app
from app.forecast import build_outlook, expected_portions


@pytest.fixture
def app():
    return create_app('testing')


def menu(key=1, qty=97):
    return Row(id=key, name=str(key), category='Meals', available=True,
               recipe=[Row(ingredient_id=1, quantity=qty)])


def ingredient(key=1, qty=300, category='Meat'):
    return Row(id=key, name=str(key), category=category, quantity=qty, unit='g', price=1, status='normal')


def test_default_config_buys_exact_shortage(app):
    with app.app_context():
        rows, summary = build_outlook([menu()], [ingredient()], 10, {'Meals': 1}, {}, 1)
    assert rows[0]['expectedDemand'] == 970
    assert summary['restock'][0]['suggested'] == 670
    assert summary['restock'][0]['purchaseStep'] == 1


def test_buffer_and_purchase_step_are_configurable(app):
    app.config.update(FRESH_STOCK_BUFFER_PERCENT=10, FRESH_STOCK_PURCHASE_STEP=10)
    with app.app_context():
        _, summary = build_outlook([menu()], [ingredient(qty=0)], 1, {'Meals': 1}, {}, 1)
    assert summary['restock'][0]['targetStock'] == 107
    assert summary['restock'][0]['suggested'] == 110


def test_fresh_categories_are_configurable(app):
    app.config['FRESH_STOCK_CATEGORIES'] = ('Other',)
    with app.app_context():
        _, summary = build_outlook([menu()], [ingredient(qty=0, category='Other')], 1, {'Meals': 1}, {}, 1)
    assert summary['restock'][0]['suggested'] == 97


def test_no_purchase_when_stock_is_sufficient_and_unused_fresh_is_visible(app):
    with app.app_context():
        rows, summary = build_outlook([menu()], [ingredient(qty=1000), ingredient(key=2, qty=30)], 10, {'Meals': 1}, {}, 1)
    assert summary['restock'] == []
    assert sum(row['leftover'] for row in rows) == 60


def test_integer_menu_allocation_preserves_predicted_dish_count():
    menus = [menu(1), menu(2), menu(3)]
    portions = expected_portions(menus, 4, {'Meals': 1}, {})
    assert portions == {1: 2, 2: 1, 3: 1}


def test_category_without_available_recipe_does_not_lose_predicted_dishes():
    portions = expected_portions([menu()], 10, {'Meals': .5, 'Missing': .5}, {})
    assert portions == {1: 10}


def test_missing_category_mix_falls_back_to_available_recipes():
    assert expected_portions([menu()], 10, {'Missing': 1}, {}) == {1: 10}
