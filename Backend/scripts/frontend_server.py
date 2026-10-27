"""Local compiled frontend and same-origin API proxy. No internet hosting required."""
from pathlib import Path
import requests
from flask import Flask, Response, request, send_from_directory
from werkzeug.exceptions import NotFound

DIST = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'


def create_frontend(api_origin='http://127.0.0.1:5000'):
    app = Flask('lookahan_frontend', static_folder=None)
    app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024

    @app.route('/api/<path:path>', methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'])
    def proxy(path):
        headers = {k: v for k, v in request.headers if k.lower() in ('authorization', 'content-type', 'user-agent', 'x-request-id')}
        try:
            upstream = requests.request(request.method, api_origin + '/api/' + path,
                params=request.args, data=request.get_data(), headers=headers, timeout=(3, 60), allow_redirects=False)
        except requests.RequestException:
            return {'error': {'code': 'SERVER_ERROR', 'message': 'เชื่อมต่อระบบร้านไม่ได้ กรุณาตรวจคำขอเดิมซ้ำเมื่อระบบพร้อม'}}, 503
        return Response(upstream.content, status=upstream.status_code,
            headers={k: v for k, v in upstream.headers.items() if k.lower() not in ('content-length', 'transfer-encoding', 'connection', 'content-encoding')})

    @app.get('/')
    @app.get('/<path:path>')
    def frontend(path=''):
        if path and (DIST / path).is_file():
            return send_from_directory(DIST, path)
        if '.' in path.rsplit('/', 1)[-1]:
            raise NotFound()
        return send_from_directory(DIST, 'index.html')

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        if request.path in ('/sw.js', '/') or response.mimetype == 'text/html':
            response.headers['Cache-Control'] = 'no-cache'
        return response
    return app
