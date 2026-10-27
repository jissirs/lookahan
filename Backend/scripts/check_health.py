"""Health probe with persisted incident/recovery records. Does not log credentials."""
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

directory = Path(__file__).resolve().parents[1] / 'instance' / 'logs'
directory.mkdir(parents=True, exist_ok=True)
state_path = directory / 'health-state.json'
try:
    with urllib.request.urlopen('http://127.0.0.1:5000/api/v1/health', timeout=10) as response:
        healthy = response.status == 200 and json.load(response).get('database') == 'ok'
except Exception:
    healthy = False
backend_healthy = healthy
try:
    with urllib.request.urlopen('http://127.0.0.1:5173/', timeout=10) as response:
        frontend_healthy = response.status == 200 and b'<div id="root">' in response.read()
except Exception:
    frontend_healthy = False
healthy = backend_healthy and frontend_healthy
try:
    previous = json.loads(state_path.read_text(encoding='utf-8'))
except (OSError, ValueError):
    previous = {}
state = {'healthy': healthy, 'backend': backend_healthy, 'frontend': frontend_healthy, 'checkedAt': datetime.now(timezone.utc).isoformat()}
if previous.get('healthy') != healthy:
    with (directory / 'incidents.jsonl').open('a', encoding='utf-8') as log:
        log.write(json.dumps({**state, 'event': 'recovered' if healthy else 'service_unavailable'}) + '\n')
temporary = state_path.with_suffix('.tmp')
temporary.write_text(json.dumps(state), encoding='utf-8')
temporary.replace(state_path)
print('healthy' if healthy else 'service_unavailable')
sys.exit(0 if healthy else 1)
