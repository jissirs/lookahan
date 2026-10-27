"""เติมข้อมูลตัวอย่างเฉพาะสาขาที่ว่าง; ค่าเริ่มต้นตรวจแล้ว rollback ต้องใช้ --apply จึงบันทึก"""
import argparse
import json
import random
import sys
from collections import Counter
from datetime import datetime, time, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import insert

from app import create_app, db
from app.models import Branch, Ingredient, Menu, MenuIngredient, Movement, Notification, Order, OrderItem, OrderUsage, User, now

INGREDIENTS = [
    ('pork', 'เนื้อหมู (ส่วนละ 100 กรัม)', 'Meat', 15, 15),
    ('chicken', 'เนื้อไก่ (ส่วนละ 100 กรัม)', 'Meat', 10, 4),
    ('shrimp', 'กุ้ง (ส่วนละ 80 กรัม)', 'Meat', 18, 8),
    ('kale', 'คะน้า (ส่วนละ 50 กรัม)', 'Vegetable', 3, 0),
    ('carrot', 'แครอท (ส่วนละ 30 กรัม)', 'Vegetable', 2, 20),
    ('basil', 'ใบกะเพรา (ส่วนละ 10 กรัม)', 'Vegetable', 1, 6),
    ('rice', 'ข้าวสวย (ส่วนละ 150 กรัม)', 'Other', 5, 60),
    ('egg', 'ไข่ไก่', 'Other', 5, 18),
    ('noodle', 'เส้นใหญ่ (ส่วนละ 150 กรัม)', 'Other', 6, 12),
    ('oil', 'น้ำมัน (ส่วนละ 10 มล.)', 'Other', 1, 50),
    ('sauce', 'ซอสปรุงรส (ส่วนละ 15 มล.)', 'Other', 2, 45),
    ('lime', 'มะนาว', 'Fruit', 3, 3),
    ('sugar', 'น้ำตาล (ส่วนละ 10 กรัม)', 'Other', 1, 20),
    ('water', 'น้ำดื่ม (ส่วนละ 350 มล.)', 'Other', 2, 25),
]
MENUS = [
    ('ข้าวกะเพราหมูไข่ดาว', 'อาหารจานเดียว', 70, {'pork': 1, 'basil': 1, 'rice': 1, 'egg': 1, 'oil': 1, 'sauce': 1}),
    ('ข้าวกะเพราไก่', 'อาหารจานเดียว', 60, {'chicken': 1, 'basil': 1, 'rice': 1, 'oil': 1, 'sauce': 1}),
    ('ข้าวผัดหมู', 'อาหารจานเดียว', 65, {'pork': 1, 'carrot': 1, 'rice': 1, 'egg': 1, 'oil': 1, 'sauce': 1}),
    ('ผัดซีอิ๊วไก่', 'เส้น', 65, {'chicken': 1, 'kale': 1, 'noodle': 1, 'egg': 1, 'oil': 1, 'sauce': 1}),
    ('ข้าวกุ้งผัดกระเทียม', 'อาหารจานเดียว', 80, {'shrimp': 1, 'rice': 1, 'oil': 1, 'sauce': 1}),
    ('ข้าวไข่เจียว', 'อาหารจานเดียว', 45, {'egg': 2, 'rice': 1, 'oil': 1, 'sauce': 1}),
    ('น้ำมะนาว', 'เครื่องดื่ม', 30, {'lime': 1, 'sugar': 1, 'water': 1}),
]


def seed(branch_id, user_id, apply=False):
    app = create_app()
    with app.app_context():
        try:
            user = db.session.get(User, user_id)
            if not db.session.get(Branch, branch_id) or not user or user.branch_id != branch_id:
                raise ValueError('ไม่พบผู้ใช้และสาขาที่ตรงกัน')
            if any(model.query.filter_by(branch_id=branch_id).first() for model in (Ingredient, Menu, Order)):
                raise ValueError('สาขามีข้อมูลแล้ว: ไม่เติมซ้ำและไม่เขียนทับข้อมูลเดิม')
            db.session.execute(insert(Ingredient), [dict(branch_id=branch_id, name=name, category=category, unit='pcs', price=price, quantity=0)
                                                   for _, name, category, price, _ in INGREDIENTS])
            by_name = {item.name: item for item in Ingredient.query.filter_by(branch_id=branch_id).all()}
            ingredients = {key: by_name[name] for key, name, _, _, _ in INGREDIENTS}
            db.session.execute(insert(Menu), [dict(branch_id=branch_id, name=name, category=category, price=price, available=True,
                details='ข้อมูลตัวอย่างสำหรับทดลองระบบ', note='ชั่งแบ่งวัตถุดิบเป็นส่วนตามชื่อ หน่วย pcs = 1 ส่วน')
                for name, category, price, _ in MENUS])
            by_name = {item.name: item for item in Menu.query.filter_by(branch_id=branch_id).all()}
            menus = [by_name[name] for name, _, _, _ in MENUS]
            db.session.execute(insert(MenuIngredient), [dict(menu_id=menus[index].id, ingredient_id=ingredients[key].id, quantity=qty)
                for index, (_, _, _, recipe) in enumerate(MENUS) for key, qty in recipe.items()])
            clock = now()
            offset = timedelta(hours=app.config['TIMEZONE_OFFSET_HOURS'])
            today = (clock + offset).date()
            rng = random.Random(20261025)
            order_rows, item_rows, usage_rows, movement_rows, notification_rows = [], [], [], [], []
            ledger = Counter()
            for ago in range(14, -1, -1):
                day = today - timedelta(days=ago)
                daily = []
                n = 6 if ago == 0 else 8 + day.day % 5 + (4 if day.weekday() >= 5 else 0)
                for i in range(n):
                    selected = Counter({rng.choices(range(6), weights=[4, 3, 2, 2, 1, 1])[0]: 1})
                    if rng.random() < .35:
                        selected[6] += 1
                    if rng.random() < .2:
                        selected[rng.randrange(6)] += 1
                    stamp = clock - timedelta(minutes=(n - i) * 12) if ago == 0 else datetime.combine(day, time(10 + i % 11, i * 7 % 60)) - offset
                    daily.append((stamp, selected))
                daily.sort(key=lambda entry: entry[0])
                needed = Counter()
                for _, selected in daily:
                    for index, qty in selected.items():
                        for key, amount in MENUS[index][3].items():
                            needed[key] += qty * amount
                for key, _, _, _, remaining in INGREDIENTS:
                    item = ingredients[key]
                    amount = needed[key] + (remaining if ago == 0 else 0) - item.quantity
                    if amount > 0:
                        item.quantity += amount
                        ledger[key] += amount
                        movement_rows.append(dict(ingredient_id=item.id, user_id=user_id, type='Add', label='ข้อมูลตัวอย่าง: รับเข้ารายวัน',
                            amount=amount, balance=item.quantity, created_at=daily[0][0] - timedelta(minutes=30)))
                for index, (stamp, selected) in enumerate(daily):
                    number = str(len(order_rows) + 1).zfill(4)
                    status = ['done', 'done', 'done', 'new', 'cooking', 'ready'][index] if ago == 0 else 'done'
                    total, usage = 0, Counter()
                    for menu_index, qty in selected.items():
                        menu = menus[menu_index]
                        total += menu.price * qty
                        item_rows.append(dict(order_number=number, menu_id=menu.id, name=menu.name, price=menu.price, qty=qty))
                        for key, amount in MENUS[menu_index][3].items():
                            usage[key] += qty * amount
                    for key, amount in usage.items():
                        item = ingredients[key]
                        item.quantity -= amount
                        ledger[key] -= amount
                        if item.quantity < 0:
                            raise ValueError('ยอดคงเหลือติดลบ')
                        usage_rows.append(dict(order_number=number, ingredient_id=item.id, quantity=amount))
                        movement_rows.append(dict(ingredient_id=item.id, user_id=user_id, type='Order', label='ข้อมูลตัวอย่าง: Order #' + number,
                            amount=-amount, balance=item.quantity, created_at=stamp))
                    order_rows.append(dict(branch_id=branch_id, number=number, status=status, total=total, created_by=user_id,
                                           created_at=stamp, note='ข้อมูลตัวอย่างสำหรับทดลองระบบ'))
            for key, _, _, _, remaining in INGREDIENTS:
                item = ingredients[key]
                if item.quantity != remaining or ledger[key] != remaining:
                    raise ValueError('ประวัติและคงเหลือไม่ตรงกัน')
                if item.status != 'normal':
                    serious = item.status in ('critical', 'out_of_stock')
                    notification_rows.append(dict(branch_id=branch_id, kind='stock_critical' if serious else 'stock_low',
                        level='danger' if serious else 'warn', title='ข้อมูลตัวอย่าง: ' + item.name,
                        message='คงเหลือ %s ส่วน · %s' % (remaining, item.status), link='/stock/%s' % item.id))
            db.session.execute(insert(Order), order_rows)
            order_ids = {row.number: row.id for row in Order.query.filter_by(branch_id=branch_id).all()}
            for rows in (item_rows, usage_rows):
                for row in rows:
                    row['order_id'] = order_ids[row.pop('order_number')]
            for model, rows in ((OrderItem, item_rows), (OrderUsage, usage_rows), (Movement, movement_rows), (Notification, notification_rows)):
                if rows:
                    db.session.execute(insert(model), rows)
            db.session.flush()
            result = dict(branchId=branch_id, ingredients=len(ingredients), menus=len(menus), orders=len(order_rows),
                          movements=len(movement_rows), todayOrders=6, historyDays=14, mode='saved' if apply else 'dry-run')
            if apply:
                db.session.commit()
            else:
                db.session.rollback()
            print(json.dumps(result, ensure_ascii=False))
        except Exception:
            db.session.rollback()
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--branch-id', type=int, required=True)
    parser.add_argument('--user-id', type=int, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    seed(args.branch_id, args.user_id, args.apply)
