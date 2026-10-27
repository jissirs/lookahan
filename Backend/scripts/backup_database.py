"""Consistent MySQL snapshot, verified ZIP, retained locally. Never logs credentials."""
import argparse
import hashlib
import json
import sys
import zipfile
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app, db


def backup(directory):
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    target = directory / ('lookahan-db-' + stamp + '.zip')
    if db.engine.dialect.name != 'mysql':
        raise RuntimeError('This snapshot command requires MySQL')
    connection = db.engine.raw_connection()
    counts, table_hashes, sql = {}, {}, ['-- Restore only into a NEW EMPTY database.\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n']
    quote = lambda name: '`' + name.replace('`', '``') + '`'
    try:
        with connection.cursor() as cursor:
            cursor.execute('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            cursor.execute('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
            cursor.execute('SELECT @@SESSION.sql_mode')
            sql.append(cursor.mogrify('SET SESSION sql_mode=%s;\n', (cursor.fetchone()[0],)))
            cursor.execute('SHOW FULL TABLES')
            objects = cursor.fetchall()
            for name, kind in objects:
                if kind != 'BASE TABLE':
                    continue
                cursor.execute('SHOW CREATE TABLE ' + quote(name))
                sql.append(cursor.fetchone()[1] + ';\n')
                cursor.execute('SELECT * FROM ' + quote(name))
                columns = [column[0] for column in cursor.description]
                rows = cursor.fetchall()
                counts[name] = len(rows)
                table_hashes[name] = rows_digest(rows)
                query = 'INSERT INTO ' + quote(name) + ' (' + ','.join(map(quote, columns)) + ') VALUES (' + ','.join(['%s'] * len(columns)) + ');\n'
                sql.extend(cursor.mogrify(query, row) for row in rows)
            for name, kind in objects:
                if kind == 'VIEW':
                    cursor.execute('SHOW CREATE VIEW ' + quote(name))
                    sql.append(cursor.fetchone()[1] + ';\n')
            sql.append('SET FOREIGN_KEY_CHECKS=1;\n')
        connection.rollback()
    finally:
        connection.close()
    data = ''.join(sql).encode('utf-8')
    manifest = {'createdAt': datetime.now(timezone.utc).isoformat(), 'tables': counts, 'tableSha256': table_hashes, 'sqlSha256': hashlib.sha256(data).hexdigest()}
    with zipfile.ZipFile(target, 'x', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('database.sql', data)
        archive.writestr('manifest.json', json.dumps(manifest, indent=2))
    verify(target)
    # Retain this command's own verified daily files for 30 days.
    for older in directory.glob('lookahan-db-*.zip'):
        if older != target and older.stat().st_mtime < time.time() - 30 * 86400:
            verify(older)
            older.unlink()
    return target


def rows_digest(rows):
    canonical = sorted(json.dumps(list(row), ensure_ascii=False, default=str, separators=(',', ':')) for row in rows)
    return hashlib.sha256('\n'.join(canonical).encode('utf-8')).hexdigest()


def verify(path):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('Corrupt archive')
        manifest = json.loads(archive.read('manifest.json'))
        if hashlib.sha256(archive.read('database.sql')).hexdigest() != manifest['sqlSha256']:
            raise RuntimeError('SQL checksum mismatch')
    return manifest


def restore_check(path):
    """Requires CREATE DATABASE permission. Creates and removes ONLY its own random test DB."""
    import uuid
    from sqlalchemy import create_engine, text
    from pymysql.constants import CLIENT
    manifest = verify(path)
    with zipfile.ZipFile(path) as archive:
        sql = archive.read('database.sql').decode('utf-8')
    name = 'lookahan_restore_' + uuid.uuid4().hex[:16]
    created = False
    try:
        with db.engine.begin() as connection:
            connection.execute(text('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4'))
            created = True
        from flask import current_app
        connection_args = dict(current_app.config['SQLALCHEMY_ENGINE_OPTIONS'].get('connect_args', {}))
        connection_args['client_flag'] = CLIENT.MULTI_STATEMENTS
        engine = create_engine(db.engine.url.set(database=name), connect_args=connection_args)
        try:
            raw = engine.raw_connection()
            try:
                with raw.cursor() as cursor:
                    cursor.execute(sql)
                    while cursor.nextset():
                        pass
                    for table, expected in manifest['tables'].items():
                        cursor.execute('SELECT COUNT(*) FROM `' + table.replace('`', '``') + '`')
                        if cursor.fetchone()[0] != expected:
                            raise RuntimeError('Restore row count mismatch')
                        if table in manifest.get('tableSha256', {}):
                            cursor.execute('SELECT * FROM `' + table.replace('`', '``') + '`')
                            if rows_digest(cursor.fetchall()) != manifest['tableSha256'][table]:
                                raise RuntimeError('Restored table content mismatch')
                raw.commit()
            finally:
                raw.close()
        finally:
            engine.dispose()
    finally:
        if created:
            assert name.startswith('lookahan_restore_') and len(name) == 33
            with db.engine.begin() as connection:
                connection.execute(text('DROP DATABASE `' + name + '`'))
    print('Restore check passed: all table row counts and available content hashes match')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', default=str(Path(__file__).resolve().parents[3] / 'lookahan-backups' / 'daily'))
    parser.add_argument('--verify')
    parser.add_argument('--restore-check')
    args = parser.parse_args()
    with create_app().app_context():
        if args.restore_check:
            restore_check(args.restore_check)
        elif args.verify:
            verify(args.verify); print('Archive and SQL checksum verified')
        else:
            print('Verified backup:', backup(args.directory))
