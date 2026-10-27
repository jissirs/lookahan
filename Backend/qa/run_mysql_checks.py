"""Allocate an isolated test database, run concurrency tests, then remove only that DB."""
import os
import subprocess
import sys
import uuid
from pathlib import Path
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app, db

if __name__ == '__main__':
    with create_app().app_context():
        assert db.engine.dialect.name == 'mysql'
        name = 'lookahan_test_' + uuid.uuid4().hex[:16]
        created = False
        try:
            with db.engine.begin() as connection:
                connection.execute(text('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4'))
                created = True
            environment = dict(os.environ)
            environment['MYSQL_TEST_URL'] = db.engine.url.set(database=name).render_as_string(hide_password=False)
            environment['MYSQL_TEST_SSL_CA'] = os.getenv('DB_SSL_CA', '')
            result = subprocess.run([sys.executable, '-m', 'pytest', 'tests/test_mysql_concurrency.py', '-q', '--tb=short'],
                cwd=Path(__file__).resolve().parents[1], env=environment)
            code = result.returncode
        finally:
            if created:
                assert name.startswith('lookahan_test_') and len(name) == 30
                with db.engine.begin() as connection:
                    connection.execute(text('DROP DATABASE `' + name + '`'))
        sys.exit(code)
