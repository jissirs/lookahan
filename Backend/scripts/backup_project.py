import sys
import os
import json
import hashlib
import zipfile
import tempfile
from pathlib import Path
from datetime import datetime, date, time, timedelta, timezone
from decimal import Decimal

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'Backend'))
from app import create_app, db

stamp = datetime.now(timezone(timedelta(hours=7))).strftime('%Y%m%d-%H%M%S')
destination = ROOT.parent / 'lookahan-backups'
destination.mkdir(exist_ok=True)
target = destination / f'lookahan-{stamp}.zip'
excluded = {'node_modules', 'venv', '.venv', 'dist', '__pycache__', '.pytest_cache', '.db-backups'}

def encode(value):
    if isinstance(value, (datetime, date, time)):
        return {'type': type(value).__name__, 'value': value.isoformat()}
    if isinstance(value, Decimal):
        return {'type': 'decimal', 'value': str(value)}
    if isinstance(value, bytes):
        return {'type': 'bytes_hex', 'value': value.hex()}
    if isinstance(value, timedelta):
        return {'type': 'timedelta_seconds', 'value': value.total_seconds()}
    raise TypeError(type(value).__name__)

def quote(identifier):
    return '`' + identifier.replace('`', '``') + '`'

app = create_app()
with tempfile.TemporaryDirectory(prefix='lookahan-backup-') as temporary:
    work = Path(temporary)
    counts = {}
    snapshot = {'created_at': datetime.now(timezone.utc).isoformat(), 'tables': {}}
    with app.app_context():
        connection = db.engine.raw_connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
                cursor.execute('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
                cursor.execute('SELECT @@SESSION.sql_mode')
                sql_mode = cursor.fetchone()[0]
                cursor.execute('SHOW FULL TABLES')
                objects = cursor.fetchall()
                tables = [row[0] for row in objects if row[1] == 'BASE TABLE']
                views = [row[0] for row in objects if row[1] == 'VIEW']
                with (work / 'database.sql').open('w', encoding='utf-8', newline='\n') as sql:
                    sql.write('-- Lookahan consistent read-only snapshot; restore into a NEW EMPTY database.\n')
                    sql.write('SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n')
                    sql.write(cursor.mogrify('SET SESSION sql_mode=%s;\n', (sql_mode,)))
                    for name in tables:
                        cursor.execute('SHOW CREATE TABLE ' + quote(name))
                        ddl = cursor.fetchone()[1]
                        sql.write(ddl + ';\n')
                        cursor.execute('SELECT * FROM ' + quote(name))
                        columns = [item[0] for item in cursor.description]
                        rows = cursor.fetchall()
                        snapshot['tables'][name] = {'columns': columns, 'ddl': ddl, 'rows': rows}
                        counts[name] = len(rows)
                        insert = 'INSERT INTO ' + quote(name) + ' (' + ','.join(map(quote, columns)) + ') VALUES (' + ','.join(['%s'] * len(columns)) + ');\n'
                        for row in rows:
                            sql.write(cursor.mogrify(insert, row))
                    for name in views:
                        cursor.execute('SHOW CREATE VIEW ' + quote(name))
                        sql.write(cursor.fetchone()[1] + ';\n')
                    sql.write('SET FOREIGN_KEY_CHECKS=1;\n')
                connection.rollback()
        finally:
            connection.close()
    (work / 'database.json').write_text(json.dumps(snapshot, ensure_ascii=False, default=encode), encoding='utf-8')
    (work / 'RESTORE.txt').write_text('Lookahan local backup\n\nproject/ contains the complete working tree including .git, local .env and CA certificate.\nExcluded reproducible folders: node_modules, venv, .venv, dist, __pycache__, .pytest_cache.\nOld .db-backups excluded; database.sql and database.json contain the current database.\n\nRestore:\n1. Extract project/ to a new folder.\n2. Create a NEW EMPTY MySQL database and import database.sql using a MySQL client.\n3. Update Backend/.env DATABASE_URL to the restored database and DB_SSL_CA path as needed.\n4. Create Backend/venv and install Backend/requirements.txt.\n5. In frontend run npm ci, then npm run dev.\n6. In Backend run: python -m flask --app wsgi run --host 127.0.0.1 --port 5000\n\nThe backup includes private configuration and account/session data. Keep local.\nDatabase export used a consistent read-only transaction; no live data was changed.\n', encoding='utf-8')
    hashes = {}
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for directory, folders, files in os.walk(ROOT):
            folders[:] = [folder for folder in folders if folder not in excluded]
            for filename in files:
                path = Path(directory) / filename
                if path.suffix in {'.pyc', '.pyo'} or filename.endswith('.lock') and '.git' in path.parts:
                    continue
                relative = 'project/' + path.relative_to(ROOT).as_posix()
                data = path.read_bytes()
                hashes[relative] = hashlib.sha256(data).hexdigest()
                archive.writestr(relative, data)
        for path in work.iterdir():
            data = path.read_bytes()
            hashes[path.name] = hashlib.sha256(data).hexdigest()
            archive.writestr(path.name, data)
        manifest = {'created_at': snapshot['created_at'], 'database_rows': counts, 'file_sha256': hashes}
        archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for name, expected in hashes.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == expected, name
        restored = json.loads(archive.read('database.json'))
        assert {name: len(table['rows']) for name, table in restored['tables'].items()} == counts
        for required in ['project/Backend/.env', 'project/Backend/ca.pem', 'project/.git/HEAD', 'project/frontend/package.json']:
            assert required in archive.namelist(), required
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    target.with_suffix('.zip.sha256').write_text(digest + '  ' + target.name + '\n', encoding='ascii')
    print(json.dumps({'backup': str(target), 'bytes': target.stat().st_size, 'files': len(hashes), 'tables': len(counts), 'rows': sum(counts.values()), 'verified': True}))
