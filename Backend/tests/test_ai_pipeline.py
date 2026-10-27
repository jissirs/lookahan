from unittest.mock import patch

import pytest

from app import create_app, db
from app.models import MENU_CATEGORIES


@pytest.fixture
def client():
    app = create_app('testing')
    with app.app_context():
        db.create_all()
        client = app.test_client()
        response = client.post('/api/v1/auth/register', json={
            'name': 'Test', 'surname': 'User', 'email': 'ai@example.test', 'password': 'StrongPass123!',
        })
        assert response.status_code == 201
        response = client.post('/api/v1/auth/login', json={
            'identifier': 'ai@example.test', 'password': 'StrongPass123!',
        })
        client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + response.json['token']
        response = client.post('/api/v1/menus', json={
            'name': 'Old Menu', 'category': MENU_CATEGORIES[0], 'price': 50, 'available': True,
        })
        menu_id = response.json['id']
        response = client.post('/api/v1/orders', json={'items': [{'menuId': menu_id, 'qty': 1}]})
        assert response.status_code == 201
        client.patch('/api/v1/menus/' + menu_id, json={'available': False})
        yield client
        db.session.remove()
        db.drop_all()


def answer():
    return {
        'hourly': [{'hour': '12:00', 'orders': 10}],
        'categories': [{'category': MENU_CATEGORIES[0], 'share': 1}],
        'bestSeller': 'Nonexistent',
    }


@pytest.mark.parametrize('field', ['hourly', 'categories', 'daily', 'alerts', 'specials', 'advice'])
def test_invalid_ai_list_returns_ai_error_without_saving(client, field):
    with patch('app.routes.ai.ask_groq', return_value={**answer(), field: 1}):
        response = client.post('/api/v1/ai/forecast', json={})
    assert response.status_code == 502
    assert response.json['error']['code'] == 'AI_ERROR'
    assert client.get('/api/v1/dashboard/summary').json['forecast'] is None


def test_best_seller_fallback_only_uses_available_menus(client):
    client.post('/api/v1/menus', json={
        'name': 'Active Menu', 'category': MENU_CATEGORIES[0], 'price': 60, 'available': True,
    })
    with patch('app.routes.ai.ask_groq', return_value=answer()):
        response = client.post('/api/v1/ai/forecast', json={})
    assert response.status_code == 200
    assert response.json['bestSeller'] == 'Active Menu'
    assert client.get('/api/v1/dashboard/summary').json['forecast'] == response.json


def test_no_available_menu_does_not_recommend_closed_menu(client):
    with patch('app.routes.ai.ask_groq', return_value=answer()):
        response = client.post('/api/v1/ai/forecast', json={})
    assert response.status_code == 200
    assert response.json['bestSeller'] == '-'


def test_malformed_groq_envelope_returns_ai_error(client):
    client.application.config['GROQ_API_KEY'] = 'test-key'
    with patch('app.routes.ai.requests.post') as post:
        post.return_value.status_code = 200
        post.return_value.json.return_value = {'choices': None}
        response = client.post('/api/v1/ai/forecast', json={})
    assert response.status_code == 502
    assert response.json['error']['code'] == 'AI_ERROR'


def test_invalid_special_ingredients_returns_ai_error(client):
    invalid = {**answer(), 'specials': [{'name': 'Special', 'ingredients': 1}]}
    with patch('app.routes.ai.ask_groq', return_value=invalid):
        response = client.post('/api/v1/ai/forecast', json={})
    assert response.status_code == 502
    assert response.json['error']['code'] == 'AI_ERROR'


def test_existing_dashboard_uses_latest_fresh_stock_config(client):
    response = client.post('/api/v1/ingredients', json={'name': 'Chicken', 'category': 'Meat', 'unit': 'g', 'price': 1})
    key = response.json['id']
    client.post('/api/v1/menus', json={
        'name': 'Chicken Rice', 'category': MENU_CATEGORIES[0], 'price': 60, 'available': True,
        'recipe': [{'ingredientId': key, 'qty': 97}],
    })
    forecast_answer = {**answer(), 'hourly': [{'hour': '12:00', 'orders': 1}]}
    with patch('app.routes.ai.ask_groq', return_value=forecast_answer):
        response = client.post('/api/v1/ai/forecast', json={})
    assert response.status_code == 200
    assert response.json['outlook']['restock'][0]['suggested'] == 97
    client.application.config['FRESH_STOCK_BUFFER_PERCENT'] = 10
    response = client.get('/api/v1/dashboard/summary')
    assert response.json['forecast']['outlook']['restock'][0]['suggested'] == 107
    assert client.get('/api/v1/ingredients').json[0]['quantity'] == 0

