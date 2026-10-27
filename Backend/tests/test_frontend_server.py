from unittest.mock import patch, Mock
import requests
from scripts.frontend_server import create_frontend


def test_local_spa_routes_and_assets_are_safe(tmp_path, monkeypatch):
    (tmp_path / 'index.html').write_text('<html><div id="root"></div></html>', encoding='utf-8')
    monkeypatch.setattr('scripts.frontend_server.DIST', tmp_path)
    client = create_frontend().test_client()
    for path in ['/', '/order/new', '/statistics', '/stock']:
        response = client.get(path)
        assert response.status_code == 200 and b'<div id="root">' in response.data
        assert response.headers['Cache-Control'] == 'no-cache'
    assert client.get('/missing-image.png').status_code == 404
    assert client.get('/../../Backend/.env').status_code == 404


def test_proxy_keeps_auth_request_key_errors_and_does_not_follow_redirects():
    client = create_frontend('http://127.0.0.1:5001').test_client()
    upstream = Mock(status_code=409, content=b'{"error":{"code":"STALE_ORDER"}}', headers={'Content-Type': 'application/json', 'X-Request-ID': 'trace-1'})
    with patch('scripts.frontend_server.requests.request', return_value=upstream) as call:
        response = client.post('/api/v1/orders/1/edit', json={'requestKey': 'original-request'}, headers={'Authorization': 'Bearer qa-only'})
        assert response.status_code == 409 and response.json['error']['code'] == 'STALE_ORDER'
        assert call.call_args.kwargs['headers']['Authorization'] == 'Bearer qa-only'
        assert call.call_args.kwargs['allow_redirects'] is False
    with patch('scripts.frontend_server.requests.request', side_effect=requests.ConnectionError()):
        response = client.get('/api/v1/snapshot')
        assert response.status_code == 503 and response.json['error']['code'] == 'SERVER_ERROR'
