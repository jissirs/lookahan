"""Disposable browser QA server. Always uses TestingConfig and an in-memory DB.

No SMTP, live database, or external model requests. Only for local flow testing.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app, db
from app.routes import ai

app = create_app('testing')
assert app.config['SQLALCHEMY_DATABASE_URI'] == 'sqlite://'
assert not app.config['MAIL_ENABLED'] and not app.config['GROQ_API_KEY']


def model_fixture(*_args):
    return {
        'hourly': [{'hour': '12:00', 'orders': 12}],
        'categories': [{'category': 'อาหารจานเดียว', 'share': 1}],
        'bestSeller': 'QA ข้าวหมู',
        'advice': ['QA: ใช้คำตอบโมเดลจำลองเพื่อตรวจ flow เท่านั้น'],
    }


ai.ask_groq = model_fixture
with app.app_context():
    db.create_all()
    client = app.test_client()
    response = client.post('/api/v1/auth/register', json={
        'name': 'QA', 'surname': 'Tester', 'email': 'qa@example.test', 'password': 'QaFlow123!',
    })
    assert response.status_code == 201
    login = client.post('/api/v1/auth/login', json={'identifier': 'qa@example.test', 'password': 'QaFlow123!'})
    client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + login.json['token']
    pork = client.post('/api/v1/ingredients', json={'name': 'QA หมู', 'category': 'Meat', 'unit': 'g', 'price': '.15'}).json['id']
    egg = client.post('/api/v1/ingredients', json={'name': 'QA ไข่', 'category': 'Other', 'unit': 'pcs', 'price': 5}).json['id']
    client.post('/api/v1/ingredients/' + pork + '/adjust', json={'delta': 2000})
    client.post('/api/v1/ingredients/' + egg + '/adjust', json={'delta': 20})
    client.post('/api/v1/menus', json={'name': 'QA ข้าวหมู', 'price': 60, 'available': True,
        'recipe': [{'ingredientId': pork, 'qty': 100}], 'modifiers': [
            {'name': 'เพิ่มไข่', 'price': 10, 'ingredients': [{'ingredientId': egg, 'qty': 1}]},
            {'name': 'พิเศษ', 'price': 15, 'ingredients': [{'ingredientId': pork, 'qty': 50}]}]})

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5001, threaded=False, use_reloader=False)
