from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.forecast import clean_alerts, inventory_summary
from app.models import stock_status
from app.routes.notifications import notify_stock_change


@pytest.mark.parametrize('unit,scale', [('pcs', 1), ('g', 100), ('ml', 100)])
def test_stock_boundaries(unit, scale):
    cases = [
        (0, 'out_of_stock'), (1, 'critical'), (5 * scale, 'critical'),
        (5 * scale + 1, 'low'), (10 * scale, 'low'), (10 * scale + 1, 'normal'),
    ]
    for quantity, expected in cases:
        assert stock_status(quantity, unit) == expected


def test_ai_inventory_summary_counts_all_four_statuses():
    ingredients = [SimpleNamespace(status=stock_status(qty, 'pcs'), category='Other') for qty in (0, 5, 10, 11)]
    assert inventory_summary(ingredients) == {
        'total': 4, 'normal': 1, 'low': 1, 'critical': 1, 'out_of_stock': 1, 'byCategory': {'Other': 4},
    }


def test_stock_running_out_sends_a_danger_notification_once():
    ingredient = SimpleNamespace(id=1, name='Rice', quantity=0, usable_quantity=0, unit='pcs')
    with patch('app.routes.notifications.add_notification') as notify:
        notify_stock_change(ingredient, old_quantity=1)
        notify.assert_called_once()
        assert notify.call_args.args[:3] == ('stock_critical', 'danger', 'วัตถุดิบหมด: Rice')
        notify_stock_change(ingredient, old_quantity=0)
        assert notify.call_count == 1


def test_ai_alert_for_empty_ingredient_is_danger_and_says_out_of_stock():
    ingredient = SimpleNamespace(id=1, name='Rice', quantity=0, unit='pcs', status='out_of_stock')
    alerts = clean_alerts([{'type': 'ingredient', 'name': 'Rice'}], [], [ingredient], [])
    assert len(alerts) == 1
    assert alerts[0]['level'] == 'danger'
    assert alerts[0]['title'] == 'AI เตือน: Rice หมด'
