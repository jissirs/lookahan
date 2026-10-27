"""Windows/local production WSGI service; use Gunicorn in the Linux container."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

if __name__ == '__main__':
    log_path = Path(__file__).resolve().parents[1] / 'instance' / 'logs'
    log_path.mkdir(parents=True, exist_ok=True)
    with (log_path / 'startup.log').open('a', encoding='utf-8') as startup:
        startup.write('Starting local WSGI service\n')
    if sys.stderr is None:
        sys.stderr = (log_path / 'service.log').open('a', encoding='utf-8', buffering=1)
        sys.stdout = sys.stderr
    from waitress import serve
    from app import create_app
    application = create_app()
    from threading import Thread
    from frontend_server import create_frontend, DIST
    if (DIST / 'index.html').is_file():
        Thread(target=lambda: serve(create_frontend(), host='127.0.0.1', port=5173, threads=8,
            max_request_body_size=4 * 1024 * 1024), daemon=True, name='lookahan-frontend').start()
        application.logger.info('Serving compiled local frontend on 127.0.0.1:5173')
    application.logger.info('Starting Waitress on 127.0.0.1:5000')
    serve(application, host='127.0.0.1', port=5000, threads=8, max_request_body_size=4 * 1024 * 1024)
