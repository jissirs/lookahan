"""คลัง: วัตถุดิบ + ประวัติ stock + เมนูและสูตร (อยู่ไฟล์เดียวกันเพราะเมนูผูกกับวัตถุดิบ)

  วัตถุดิบ
    GET   /snapshot                    ข้อมูลทั้งหมดที่หน้าเว็บต้องใช้ตอนเปิดแอป (วัตถุดิบ ประวัติ เมนู ออเดอร์)
    GET   /ingredients                 รายการวัตถุดิบ
    GET   /movements                   ประวัติ stock
    POST  /ingredients                 สร้างวัตถุดิบใหม่ (เริ่มที่ 0)
    PATCH /ingredients/<id>            แก้ชื่อ/หมวด/หน่วย/ราคา
    POST  /ingredients/<id>/adjust     เพิ่มหรือลดจำนวน (บันทึกประวัติให้ด้วย)
    สำคัญ: จำนวนคงเหลือ "แก้ตรง ๆ ไม่ได้" ต้องผ่าน adjust เสมอ เพื่อให้ทุกการเปลี่ยนมีประวัติ

  เมนู
    GET   /menus                       รายการเมนู
    POST  /menus                       สร้างเมนู (เริ่มต้นยังไม่เปิดขาย ไม่มีสูตร)
    PATCH /menus/<id>                  แก้เมนู รวมถึงสูตรทั้งก้อน
    สูตร (recipe) ส่งมาเป็นรายการ [{"ingredientId": "3", "qty": 2}, ...] = เมนู 1 จานใช้วัตถุดิบ id 3 จำนวน 2 หน่วย
"""
from flask import Blueprint, g, jsonify

from .. import db
from ..models import (
    INGREDIENT_CATEGORIES, INGREDIENT_UNITS, MENU_CATEGORIES, Ingredient, Menu, MenuIngredient, Movement, Order,
)
from ..tools import ApiError, find_mine, is_blank, is_whole_number, json_body
from .notifications import notify_stock_change

bp = Blueprint('stock', __name__)


# =====================================================================
#  วัตถุดิบ
# =====================================================================
def check_ingredient_fields(fields):
    """ตรวจข้อมูลวัตถุดิบ (ใช้ทั้งตอนสร้างและแก้) — fields มีเฉพาะช่องที่ส่งมา"""
    if 'name' in fields and is_blank(fields['name']):
        raise ApiError('VALIDATION', 'กรุณากรอกชื่อวัตถุดิบ')
    if 'category' in fields and fields['category'] not in INGREDIENT_CATEGORIES:
        raise ApiError('VALIDATION', 'ประเภทวัตถุดิบไม่ถูกต้อง')
    if 'unit' in fields and fields['unit'] not in INGREDIENT_UNITS:
        raise ApiError('VALIDATION', 'หน่วยไม่ถูกต้อง')
    if 'price' in fields and (not is_whole_number(fields['price']) or fields['price'] < 0):
        raise ApiError('VALIDATION', 'ราคาต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป')


def check_name_not_taken(name, except_id=None):
    """ชื่อวัตถุดิบห้ามซ้ำกันในสาขาเดียวกัน (ไม่สนตัวพิมพ์เล็ก/ใหญ่)"""
    # [R] READ: ค้นตาราง ingredients หาแถวที่ชื่อซ้ำในสาขานี้ (ตรงนี้แค่ "สร้างคำค้น" ยังไม่ได้ดึงข้อมูล)
    same_name = Ingredient.query.filter(
        Ingredient.branch_id == g.branch_id,
        db.func.lower(Ingredient.name) == name.strip().lower(),
    )
    if except_id is not None:
        same_name = same_name.filter(Ingredient.id != except_id)  # ไม่นับตัวเอง (ตอนแก้ไข)
    if same_name.first() is not None:  # .first() = ลงมือค้นจริง: เจอแถวแปลว่าชื่อซ้ำ
        raise ApiError('DUPLICATE_NAME', 'มีวัตถุดิบชื่อนี้อยู่แล้ว')


def my_ingredients():
    # [R] READ: วัตถุดิบ "ทุกแถว" ของสาขานี้ เรียงตาม id
    return Ingredient.query.filter_by(branch_id=g.branch_id).order_by(Ingredient.id).all()


def my_movements():
    # [R] READ: ประวัติ stock ทุกแถวของสาขานี้ เรียงจากเก่าไปใหม่ (.join = เชื่อมตาราง movements กับ ingredients เพื่อกรองตามสาขา)
    return (
        Movement.query.join(Ingredient)
        .filter(Ingredient.branch_id == g.branch_id)
        .order_by(Movement.created_at, Movement.id)
        .all()
    )


def my_menus():
    # [R] READ: เมนู "ทุกแถว" ของสาขานี้
    return Menu.query.filter_by(branch_id=g.branch_id).order_by(Menu.id).all()


def my_orders():
    # [R] READ: ออเดอร์ทุกแถวของสาขานี้ เรียงใหม่ → เก่า (.desc() = มากไปน้อย)
    return Order.query.filter_by(branch_id=g.branch_id).order_by(Order.number.desc()).all()


@bp.get('/snapshot')
def snapshot():
    return jsonify({
        'ingredients': [item.to_json() for item in my_ingredients()],
        'movements': [move.to_json() for move in my_movements()],
        'menus': [menu.to_json() for menu in my_menus()],
        'orders': [order.to_json() for order in my_orders()],
    })


@bp.get('/ingredients')
def list_ingredients():
    return jsonify([item.to_json() for item in my_ingredients()])


@bp.get('/movements')
def list_movements():
    return jsonify([move.to_json() for move in my_movements()])


@bp.post('/ingredients')
def create_ingredient():
    body = json_body()
    fields = {
        'name': body.get('name'),
        'category': body.get('category'),
        'unit': body.get('unit'),
        'price': body.get('price', 0),
    }
    check_ingredient_fields(fields)
    check_name_not_taken(fields['name'])

    # [C] CREATE (INSERT): สร้างแถววัตถุดิบใหม่ในตาราง ingredients (เริ่มที่ quantity=0)
    item = Ingredient(
        branch_id=g.branch_id, name=fields['name'].strip(), category=fields['category'],
        unit=fields['unit'], price=fields['price'], quantity=0,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_json()), 201


@bp.patch('/ingredients/<ingredient_id>')
def update_ingredient(ingredient_id):
    # [R] READ: ดึงแถววัตถุดิบที่จะแก้ (find_mine = หาตาม id เฉพาะของสาขาตัวเอง ไม่เจอจะแจ้ง NOT_FOUND)
    item = find_mine(Ingredient, ingredient_id, 'ingredient')
    body = json_body()

    # เอาเฉพาะช่องที่อนุญาตให้แก้ (จำนวนคงเหลือไม่อยู่ในนี้)
    fields = {}
    for key in ('name', 'category', 'unit', 'price'):
        if key in body:
            fields[key] = body[key]

    check_ingredient_fields(fields)
    if 'name' in fields:
        check_name_not_taken(fields['name'], except_id=item.id)
        fields['name'] = fields['name'].strip()

    # [U] UPDATE: แก้ค่าในแถวเดิมทีละช่อง (setattr(item, 'price', 25) ก็คือ item.price = 25) แล้ว commit
    for key, value in fields.items():
        setattr(item, key, value)
    db.session.commit()
    return jsonify(item.to_json())


@bp.post('/ingredients/<ingredient_id>/adjust')
def adjust_ingredient(ingredient_id):
    body = json_body()
    delta = body.get('delta')  # + เพิ่ม, - ลด
    if not is_whole_number(delta) or delta == 0:
        raise ApiError('VALIDATION', 'จำนวนต้องเป็นจำนวนเต็มและไม่เป็น 0')

    # [R] READ: ดึงแถววัตถุดิบที่จะเพิ่ม/ลด stock
    item = find_mine(Ingredient, ingredient_id, 'ingredient')

    new_quantity = item.quantity + delta
    if new_quantity < 0:
        message = '%s เหลือไม่พอ (เหลือ %s %s)' % (item.name, item.quantity, item.unit)
        raise ApiError('INSUFFICIENT_STOCK', message)

    # สามอย่างต่อไปนี้ commit ครั้งเดียวกัน: สำเร็จทั้งหมด หรือไม่ก็ไม่เปลี่ยนอะไรเลย
    # [U] UPDATE: แก้จำนวนคงเหลือในแถววัตถุดิบเดิม
    old_quantity = item.quantity
    item.quantity = new_quantity
    notify_stock_change(item, old_quantity)  # [C] ถ้าลดจนข้ามเกณฑ์ใกล้หมด/วิกฤต → สร้างแจ้งเตือน
    move_type = 'Add' if delta > 0 else 'Drop'
    movement = Movement(
        ingredient_id=item.id, user_id=g.user.id, type=move_type,
        label=body.get('label') or move_type, amount=delta, balance=new_quantity,
    )
    # [C] CREATE: เพิ่มแถวประวัติใหม่ในตาราง movements (ประวัติมีแต่เพิ่ม ไม่แก้ ไม่ลบ)
    db.session.add(movement)
    db.session.commit()
    return jsonify({'ingredient': item.to_json(), 'movement': movement.to_json()})


# =====================================================================
#  เมนูและสูตร
# =====================================================================
# ช่องที่ยอมให้ส่งมาสร้าง/แก้
EDITABLE_FIELDS = ('name', 'category', 'price', 'image', 'details', 'note', 'available', 'recipe')


def check_menu_fields(fields):
    """ตรวจข้อมูลเมนู — fields มีเฉพาะช่องที่ส่งมา"""
    if 'name' in fields and is_blank(fields['name']):
        raise ApiError('VALIDATION', 'กรุณากรอกชื่อเมนู')
    if 'category' in fields and fields['category'] not in MENU_CATEGORIES:
        raise ApiError('VALIDATION', 'ประเภทเมนูไม่ถูกต้อง')
    if 'price' in fields and (not is_whole_number(fields['price']) or fields['price'] < 0):
        raise ApiError('VALIDATION', 'ราคาต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป')
    if 'available' in fields and not isinstance(fields['available'], bool):
        raise ApiError('VALIDATION', 'available ต้องเป็น true หรือ false')


def read_recipe(lines):
    """ตรวจสูตรที่ส่งมา แล้วคืนเป็น {id วัตถุดิบ: ปริมาณ}
    กฎ: วัตถุดิบต้องมีอยู่จริงในสาขานี้, ปริมาณเป็นจำนวนเต็มตั้งแต่ 1, ห้ามมีวัตถุดิบซ้ำในสูตร"""
    if not isinstance(lines, list):
        raise ApiError('VALIDATION', 'สูตรอาหารต้องเป็นรายการ')

    recipe = {}
    for line in lines:
        ingredient = find_mine(Ingredient, line.get('ingredientId'), 'ingredient')
        if not is_whole_number(line.get('qty')) or line['qty'] < 1:
            raise ApiError('VALIDATION', 'ปริมาณในสูตรต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')
        if ingredient.id in recipe:
            raise ApiError('VALIDATION', 'มีวัตถุดิบซ้ำในสูตร')
        recipe[ingredient.id] = line['qty']
    return recipe


def save_recipe(menu, recipe):
    """เขียนสูตรลงเมนู: แทนที่ทั้งรายการด้วยสูตรใหม่ (บรรทัดเก่าที่หายไปจะถูกลบเอง)"""
    # [C]+[D] ผ่าน relationship: บรรทัดสูตรใหม่ = INSERT ลงตาราง menu_ingredients, บรรทัดเก่าที่ไม่อยู่ในรายการใหม่ = DELETE
    # (SQLAlchemy ทำให้เองตอน commit เพราะตั้ง cascade='all, delete-orphan' ไว้ใน models.py)
    menu.recipe = [MenuIngredient(ingredient_id=ingredient_id, quantity=quantity)
                   for ingredient_id, quantity in recipe.items()]


@bp.get('/menus')
def list_menus():
    # [R] READ: เมนูทุกแถวของสาขานี้
    menus = Menu.query.filter_by(branch_id=g.branch_id).order_by(Menu.id).all()
    return jsonify([menu.to_json() for menu in menus])


@bp.post('/menus')
def create_menu():
    body = json_body()

    # เอาเฉพาะช่องที่อนุญาต; ถ้าไม่ส่งหมวด/ราคามา ใช้ค่าเริ่มต้น
    fields = {'category': MENU_CATEGORIES[0], 'price': 0}
    for key in EDITABLE_FIELDS:
        if key in body:
            fields[key] = body[key]

    if is_blank(fields.get('name')):
        raise ApiError('VALIDATION', 'กรุณากรอกชื่อเมนู')
    check_menu_fields(fields)
    recipe = read_recipe(fields.pop('recipe', []))

    # [C] CREATE: สร้างแถวเมนูใหม่ในตาราง menus พร้อมสูตร (แถวลูกในตาราง menu_ingredients) — add ครั้งเดียว บันทึกทั้งสองตาราง
    menu = Menu(branch_id=g.branch_id, **fields)
    menu.name = menu.name.strip()
    save_recipe(menu, recipe)
    db.session.add(menu)
    db.session.commit()
    return jsonify(menu.to_json()), 201


@bp.patch('/menus/<menu_id>')
def update_menu(menu_id):
    # [R] READ: ดึงแถวเมนูที่จะแก้
    menu = find_mine(Menu, menu_id, 'menu')
    body = json_body()

    fields = {}
    for key in EDITABLE_FIELDS:
        if key in body:
            fields[key] = body[key]

    check_menu_fields(fields)
    if 'recipe' in fields:
        save_recipe(menu, read_recipe(fields.pop('recipe')))
    if 'name' in fields:
        fields['name'] = fields['name'].strip()

    # [U] UPDATE: แก้ค่าในแถวเมนูเดิมทีละช่อง แล้ว commit (สูตรถูกแก้ไปแล้วด้านบนด้วย save_recipe)
    for key, value in fields.items():
        setattr(menu, key, value)
    db.session.commit()
    return jsonify(menu.to_json())
