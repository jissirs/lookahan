"""Idempotent additive upgrade; backs up affected rows before changing the live schema.

Run from Backend: venv/Scripts/python scripts/upgrade_inventory.py --apply
Without --apply it only prints the planned schema changes.
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import MetaData, Table, inspect, select, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app, db


def upgrade(apply=False):
    inspector = inspect(db.engine)
    changes = []
    for table in db.metadata.sorted_tables:
        if table.name not in inspector.get_table_names():
            changes.append('CREATE ' + table.name)
            continue
        existing = {column['name']: column for column in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name not in existing:
                changes.append('ALTER TABLE %s ADD COLUMN %s %s%s' % (
                    table.name, column.name, column.type.compile(db.engine.dialect),
                    ' NOT NULL DEFAULT 1' if column.name == 'purchase_size' else ' NULL'))
            elif table.name == 'menus' and column.name == 'image' and db.engine.dialect.name == 'mysql' and str(existing[column.name]['type']).upper() != 'MEDIUMTEXT':
                changes.append('ALTER TABLE menus MODIFY COLUMN image MEDIUMTEXT NOT NULL')
            elif column.type.__class__.__name__ == 'Numeric' and (getattr(existing[column.name]['type'], 'precision', None), getattr(existing[column.name]['type'], 'scale', None)) != (column.type.precision, column.type.scale):
                if db.engine.dialect.name != 'mysql':
                    raise RuntimeError('Existing non-MySQL schemas require an explicit table migration')
                changes.append('ALTER TABLE %s MODIFY COLUMN %s %s %s' % (
                    table.name, column.name, column.type.compile(db.engine.dialect),
                    'NULL' if column.nullable else 'NOT NULL'))
    if 'orders' in inspector.get_table_names():
        indexes = {item['name'] for item in inspector.get_indexes('orders')}
        indexes.update(item['name'] for item in inspector.get_unique_constraints('orders'))
        if 'uq_order_branch_request' not in indexes:
            changes.append('CREATE UNIQUE INDEX uq_order_branch_request ON orders (branch_id, request_key)')
    print('\n'.join(changes) or 'Schema already current')
    if not apply or not changes:
        return
    directory = Path(__file__).resolve().parents[1] / '.db-backups'
    directory.mkdir(exist_ok=True)
    tables = sorted({line.split()[2] for line in changes if line.startswith('ALTER TABLE')})
    backup = {}
    with db.engine.connect() as connection:
        for name in tables:
            table = Table(name, MetaData(), autoload_with=connection)
            backup[name] = [dict(row) for row in connection.execute(select(table)).mappings()]
    path = directory / ('inventory-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.json')
    path.write_text(json.dumps(backup, ensure_ascii=False, default=str), encoding='utf-8')
    print('Backup written:', path)
    with db.engine.begin() as connection:
        for sql in changes:
            if sql.startswith('ALTER'):
                connection.execute(text(sql))
    db.create_all()
    with db.engine.begin() as connection:
        for sql in changes:
            if sql.startswith('CREATE UNIQUE INDEX'):
                connection.execute(text(sql))
    # Backfill only newly added fields; historical orders remain explicitly unpaid.
    defaults = {
        'users': {'role': "'staff'", 'approved': '1'},
        'menus': {'modifiers': "'[]'"},
        'orders': {'service_type': "'takeaway'", 'table_label': "''"},
        'order_items': {'modifiers': "'[]'", 'note': "''"},
    }
    with db.engine.begin() as connection:
        for table, columns in defaults.items():
            for column, value in columns.items():
                connection.execute(text(f'UPDATE {table} SET {column}={value} WHERE {column} IS NULL'))
        connection.execute(text("UPDATE users SET role='owner', approved=1 WHERE id=(SELECT first_id FROM (SELECT MIN(id) AS first_id FROM users) AS original_owner) AND NOT EXISTS (SELECT owner_id FROM (SELECT id AS owner_id FROM users WHERE role='owner') AS owners)"))
    if db.engine.dialect.name == 'mysql':
        with db.engine.begin() as connection:
            for table, columns in defaults.items():
                for column in columns:
                    definition = db.metadata.tables[table].columns[column]
                    connection.execute(text(f'ALTER TABLE {table} MODIFY COLUMN {column} {definition.type.compile(db.engine.dialect)} NOT NULL'))
    print('Upgrade complete; existing quantities, orders and recipes preserved')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with create_app().app_context():
        upgrade(args.apply)
