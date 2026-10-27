"""Read-only comparison of original columns against the additive migration's backup."""
import json
import sys
from pathlib import Path
from sqlalchemy import MetaData, Table, select
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app, db

if __name__ == '__main__':
    saved = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    checked = {}
    with create_app().app_context(), db.engine.connect() as connection:
        for name in ('orders', 'order_items', 'batch_allocations', 'ingredient_batches', 'movements'):
            if not saved.get(name):
                continue
            old = saved[name]
            table = Table(name, MetaData(), autoload_with=connection)
            rows = [dict(r) for r in connection.execute(select(*(table.c[c] for c in old[0]))).mappings()]
            normalized = json.loads(json.dumps(rows, default=str))
            assert sorted(old, key=lambda x: x['id']) == sorted(normalized, key=lambda x: x['id']), name
            checked[name] = len(rows)
    print(json.dumps({'preservedOriginalRows': checked}))
