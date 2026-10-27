"""ตารางทั้งหมดของฐานข้อมูล (1 คลาส = 1 ตาราง) อยู่ในไฟล์นี้ไฟล์เดียว

อ่านไฟล์นี้แล้วจะรู้ว่าระบบเก็บข้อมูลอะไรบ้าง:
    Branch         สาขา/ร้าน
    User           ผู้ใช้ (ล็อกอินได้)
    Session        "บัตรผ่าน" ที่ได้หลังล็อกอิน (token)
    PasswordReset  รหัส OTP สำหรับลืมรหัสผ่าน
    Ingredient     วัตถุดิบ + จำนวนคงเหลือ
    Movement       ประวัติการเพิ่ม/ลด stock
    Menu           เมนูอาหาร        MenuIngredient = สูตรของเมนู (ใช้วัตถุดิบอะไรเท่าไร)
    Order          ออเดอร์          OrderItem = เมนูที่สั่ง,  OrderUsage = วัตถุดิบที่ถูกตัด stock
    Notification   การแจ้งเตือน (กระดิ่ง)   NotificationRead = บันทึกว่าใครอ่านอันไหนแล้ว
    AiFeedback     ความเห็นต่อคำแนะนำของ AI
    Forecast       ผลพยากรณ์ของ AI (ชุดล่าสุด)
    ForecastHistory  ผลพยากรณ์ "ของแต่ละวัน" เก็บไว้เทียบกับยอดจริง (วัดความแม่นของ AI)
    ClosingCount   การปิดร้านแต่ละวัน (นับของจริง + ของเสีย)     ClosingLine = รายการวัตถุดิบที่นับ

ทุกคลาสมีเมธอด to_json() ไว้แปลงเป็นข้อมูลที่ส่งให้หน้าเว็บ
(ข้อตกลง: ชื่อคีย์เป็น camelCase, id เป็นข้อความ, เวลาเป็นรูปแบบ ISO ลงท้ายด้วย Z)

=====================================================================
 คู่มือ CRUD — 4 อย่างที่ทำกับฐานข้อมูลได้ (อ่านก่อนเปิดไฟล์ใน routes/)
=====================================================================
ฐานข้อมูลคือ "ตารางหลายตาราง" (เหมือน Excel) — คลาสแต่ละตัวในไฟล์นี้ = 1 ตาราง, ออบเจกต์ 1 ตัว = 1 แถว
การทำงานกับแถวมีแค่ 4 แบบ เรียกรวมว่า CRUD  (ในโค้ดจะมีป้ายกำกับ [C] [R] [U] [D] ให้เห็นทุกจุด)

  ป้าย  ชื่อเต็ม            ทำอะไร                SQL ที่อยู่เบื้องหลัง     โค้ด Python ที่ใช้ในโปรเจกต์นี้
  ----  ------------------  --------------------  ------------------------  ------------------------------------------
  [C]   Create (สร้าง)       เพิ่มแถวใหม่          INSERT INTO ...           x = Ingredient(name='ไก่', ...)
                                                                            db.session.add(x)
                                                                            db.session.commit()
  [R]   Read (อ่าน)          ดึงแถวที่ต้องการ      SELECT ... WHERE ...      Ingredient.query.filter_by(id=1).first()   (แถวเดียว)
                                                                            Ingredient.query.filter_by(...).all()      (หลายแถว)
  [U]   Update (แก้ไข)       แก้ค่าในแถวเดิม       UPDATE ... SET ...        x.price = 25
                                                                            db.session.commit()
  [D]   Delete (ลบ)          ลบแถวทิ้ง             DELETE FROM ...           db.session.delete(x)
                                                                            db.session.commit()

คำที่ต้องรู้ (ช่วยให้อ่านโค้ดเข้าใจ):
  db.session   "ถาดพักงาน" — เราแก้ข้อมูลในถาดนี้ก่อน ยังไม่ถึงฐานข้อมูลจริง
  .add(x)      วางแถวใหม่ลงถาด (เตรียม INSERT)
  .commit()    กด "บันทึกจริง" — ส่งทุกอย่างในถาดลงฐานข้อมูลพร้อมกัน (สำเร็จทั้งหมดหรือไม่ก็ไม่สำเร็จเลย)
  .rollback()  กด "ยกเลิก" — ทิ้งทุกอย่างในถาดที่ยังไม่ได้ commit (ระบบเรียกให้เองเมื่อเกิด error ดู tools.py)
  .filter_by(ช่อง=ค่า)   เงื่อนไข "เอาเฉพาะแถวที่ช่องนี้เท่ากับค่านี้" (WHERE)
  .first()     เอาแถวแรกที่เจอ (ไม่เจอได้ None)      .all()  เอาทุกแถวที่เจอเป็น list
  .order_by()  เรียงลำดับ (ORDER BY)                  db.session.get(ตาราง, id)  ดึงแถวจาก id ตรง ๆ
  แก้ค่าแล้ว commit = UPDATE: SQLAlchemy จำได้เองว่าแถวไหนถูกแก้ เราไม่ต้องเขียน UPDATE

ตารางที่เชื่อมกัน (relationship): เช่น Menu.recipe คือรายการ MenuIngredient ของเมนูนั้น
  เพิ่ม/เอาออกจาก list นี้ = สร้าง/ลบแถวในตารางลูกให้อัตโนมัติ (cascade) และลบเมนู → สูตรของเมนูนั้นหายตาม

หมายเหตุ: วัตถุดิบลบออกจากรายการใช้งานแบบกู้คืนได้ (deleted_at) ไม่ลบแถวจริง ส่วนเมนูและออเดอร์ไม่มี API ลบ — ประวัติเดิมยังอ้างถึงได้
ออเดอร์ที่ "ยกเลิก" จึงเปลี่ยนสถานะ (UPDATE) ไม่ใช่ลบแถว ส่วน [D] ใช้กับข้อมูลชั่วคราว เช่น session (token) และ OTP
"""
from datetime import datetime, timezone
from sqlalchemy.dialects.mysql import MEDIUMTEXT

from . import db

# ตัวเลือกที่อนุญาต (ต้องตรงกับ frontend/src/data/options.js)
INGREDIENT_CATEGORIES = ('Meat', 'Vegetable', 'Fruit', 'Other')
INGREDIENT_UNITS = ('pcs', 'g', 'ml')
MENU_CATEGORIES = ('อาหารจานเดียว', 'เส้น', 'เครื่องดื่ม', 'อื่นๆ')
MOVEMENT_TYPES = ('Add', 'Drop', 'Order')
ORDER_STATUSES = ('new', 'cooking', 'ready', 'done', 'cancelled')
NOTIFICATION_KINDS = ('stock_low', 'stock_critical', 'order_new', 'order_ready', 'order_cancelled', 'ai_forecast')
NOTIFICATION_LEVELS = ('info', 'warn', 'danger')  # น้ำเงิน / เหลือง / แดง


# เกณฑ์สถานะ stock (ต้องตรงกับ frontend/src/utils/stockStatus.js) — ใช้ทั้งแจ้งเตือนและ AI
CRITICAL_AT = 5  # 1–5 pcs = วิกฤต (0 แยกเป็นของหมด)
LOW_AT = 10  # 6–10 pcs = ใกล้หมด; มากกว่า 10 = ปกติ
UNIT_SCALE = {'pcs': 1, 'g': 100, 'ml': 100}  # g และ ml ตัวเลขใหญ่กว่า pcs จึงคูณเกณฑ์ด้วยค่านี้
STATUS_RANK = {'normal': 0, 'low': 1, 'critical': 2, 'out_of_stock': 3}  # ยิ่งมากยิ่งแย่


def stock_status(quantity, unit):
    """คืนสถานะ 4 ระดับ: ของหมด = 0, วิกฤต <= 5×scale, ใกล้หมด <= 10×scale, ปกติสูงกว่านั้น"""
    if quantity <= 0:
        return 'out_of_stock'
    scale = UNIT_SCALE.get(unit, 1)
    if quantity <= CRITICAL_AT * scale:
        return 'critical'
    if quantity <= LOW_AT * scale:
        return 'low'
    return 'normal'


def now():
    """เวลาตอนนี้ (UTC)"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_iso(time):
    """แปลงเวลาเป็นข้อความ เช่น 2026-10-21T09:30:00Z"""
    if time is None:
        return None
    return time.isoformat(timespec='seconds') + 'Z'


def only(column, allowed):
    """สร้างกฎของฐานข้อมูลว่า "ช่องนี้ต้องเป็นหนึ่งในค่าที่อนุญาตเท่านั้น" """
    choices = ', '.join("'" + value + "'" for value in allowed)
    return column + ' IN (' + choices + ')'


# ---------------------------------------------------------------- บัญชีผู้ใช้

class Branch(db.Model):
    """สาขา — วัตถุดิบ เมนู ออเดอร์ทุกอย่างผูกกับสาขา จึงรองรับร้านหลายสาขา"""
    # แผนที่ CRUD ของตาราง branches — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] routes/auth.py  register — สร้างสาขาใหม่เมื่อยังไม่มีสาขาเลย
    #   [R] routes/auth.py  register — ดึงสาขาแรกให้ผู้สมัครใหม่เข้าร่วม
    #   [U] — ยังไม่มี
    #   [D] — ยังไม่มี
    __tablename__ = 'branches'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False)


class User(db.Model):
    # แผนที่ CRUD ของตาราง users — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /auth/register
    #   [R] login (หาผู้ใช้จากชื่อ/อีเมล), เช็กอีเมลซ้ำตอนสมัคร, ขอ OTP, และ check_login (user ของบัตรผ่าน)
    #   [U] POST /auth/password/reset — เปลี่ยน password_hash
    #   [D] — ยังไม่มี
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    name = db.Column(db.String(80), nullable=False)
    surname = db.Column(db.String(80), nullable=False)
    email = db.Column(db.String(190), unique=True, nullable=False)  # unique = ซ้ำกันไม่ได้
    password_hash = db.Column(db.String(255), nullable=False)  # เก็บเฉพาะค่าที่ "ตีป่น" แล้ว ไม่เก็บรหัสจริง
    role = db.Column(db.String(12), default='staff', nullable=False)
    approved = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False)

    branch = db.relationship('Branch')  # user.branch = สาขาของผู้ใช้

    def to_json(self):
        return {'id': str(self.id), 'name': self.name, 'surname': self.surname, 'email': self.email,
                'role': self.role, 'approved': self.approved}


class Session(db.Model):
    """บัตรผ่านหนึ่งใบ = การล็อกอินหนึ่งครั้ง (เก็บค่าตีป่นของ token ไม่เก็บ token จริง)"""
    # แผนที่ CRUD ของตาราง sessions — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /auth/login — ออกบัตรผ่านใหม่
    #   [R] tools.py check_login — ตรวจบัตรผ่านทุกคำขอ
    #   [U] — ไม่มี (บัตรผ่านไม่เคยถูกแก้ มีแต่ออกใหม่/ลบ)
    #   [D] POST /auth/logout, ตอนรีเซ็ตรหัสผ่าน (เตะทุกอุปกรณ์), และ check_login เมื่อบัตรหมดอายุ
    __tablename__ = 'sessions'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    token_hash = db.Column(db.String(64), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=now, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    device_name = db.Column(db.String(160))
    last_seen_at = db.Column(db.DateTime)

    user = db.relationship('User')


class PasswordReset(db.Model):
    """OTP ลืมรหัสผ่าน — ผู้ใช้หนึ่งคนมีได้ทีละอัน (ขอใหม่ = ทับของเดิม)"""
    # แผนที่ CRUD ของตาราง password_resets — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /auth/otp — สร้าง OTP ใหม่
    #   [R] POST /auth/otp/verify และ /auth/password/reset
    #   [U] POST /auth/otp/verify — เพิ่ม attempts เมื่อกรอกผิด / ใส่ reset_token_hash เมื่อกรอกถูก
    #   [D] POST /auth/otp (ลบ OTP เก่าก่อนสร้างใหม่) และ /auth/password/reset (ใช้แล้วทิ้ง)
    __tablename__ = 'password_resets'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), unique=True, nullable=False)
    otp_hash = db.Column(db.String(64), nullable=False)
    attempts = db.Column(db.Integer, default=0, nullable=False)  # กรอกผิดไปแล้วกี่ครั้ง
    reset_token_hash = db.Column(db.String(64), unique=True)  # ได้มาหลังกรอก OTP ถูก
    expires_at = db.Column(db.DateTime, nullable=False)

    user = db.relationship('User')


# ---------------------------------------------------------------- วัตถุดิบและเมนู

class Ingredient(db.Model):
    # แผนที่ CRUD ของตาราง ingredients — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /ingredients (เริ่มที่ quantity = 0)
    #   [R] GET /snapshot, GET /ingredients, และตอนสร้าง/ยกเลิกออเดอร์ (ตรวจและคืน stock)
    #   [U] PATCH /ingredients/<id> (ชื่อ/หมวด/หน่วย/ราคา), POST .../adjust และออเดอร์ (จำนวนคงเหลือ)
    #   [D] — ยังไม่มี (ตั้งใจ เพราะประวัติและสูตรเมนูอ้างถึงวัตถุดิบ)
    __tablename__ = 'ingredients'
    # กฎที่ฝังไว้ในตาราง: ถึงโค้ดจะพลาด ฐานข้อมูลก็ยังไม่ยอมรับข้อมูลผิด
    __table_args__ = (
        db.UniqueConstraint('branch_id', 'name', name='uq_ingredient_branch_name'),  # ชื่อซ้ำได้เฉพาะต่างสาขา
        db.CheckConstraint('quantity >= 0', name='ck_ingredient_quantity_nonneg'),  # stock ห้ามติดลบ
        db.CheckConstraint('price >= 0', name='ck_ingredient_price_nonneg'),
        db.CheckConstraint(only('category', INGREDIENT_CATEGORIES), name='ck_ingredient_category'),
        db.CheckConstraint(only('unit', INGREDIENT_UNITS), name='ck_ingredient_unit'),
    )

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(20), nullable=False)
    unit = db.Column(db.String(10), nullable=False)
    quantity = db.Column(db.Integer, default=0, nullable=False)  # จำนวนคงเหลือ
    price = db.Column(db.Numeric(18, 6), default=0, nullable=False)  # ราคาต่อหน่วย (บาท)

    purchase_unit = db.Column(db.String(10), nullable=True)
    purchase_size = db.Column(db.Integer, nullable=False, default=1, server_default='1')
    deleted_at = db.Column(db.DateTime, nullable=True)
    batches = db.relationship('IngredientBatch', lazy='selectin', cascade='all, delete-orphan')

    @property
    def usable_quantity(self):
        from .inventory_policy import available_quantity
        return available_quantity(self)

    @property
    def status(self):
        """สถานะ stock ตอนนี้: normal / low / critical / out_of_stock"""
        return stock_status(self.usable_quantity, self.unit)

    def to_json(self):
        return {
            'id': str(self.id), 'name': self.name, 'category': self.category,
            'unit': self.unit, 'quantity': self.quantity, 'price': self.price,
            'deletedAt': to_iso(self.deleted_at),
            'usableQuantity': self.usable_quantity,
            'purchaseUnit': self.purchase_unit or self.unit, 'purchaseSize': self.purchase_size,
            'purchasePrice': round(self.price * self.purchase_size, 2),
            'batches': [batch.to_json() for batch in self.batches if batch.remaining > 0],
        }


class Movement(db.Model):
    """ประวัติ stock — มีแต่เพิ่มแถวใหม่ ไม่แก้ ไม่ลบ"""
    # แผนที่ CRUD ของตาราง movements — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /ingredients/<id>/adjust, สร้างออเดอร์ (ตัด stock), ยกเลิกออเดอร์ (คืน stock)
    #   [R] GET /movements, GET /snapshot
    #   [U] — ไม่มี (ประวัติห้ามแก้)
    #   [D] — ไม่มี (ประวัติห้ามลบ)
    __tablename__ = 'movements'
    __table_args__ = (db.CheckConstraint(only('type', MOVEMENT_TYPES), name='ck_movement_type'),)

    id = db.Column(db.Integer, primary_key=True)
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    type = db.Column(db.String(10), nullable=False)  # Add (เพิ่ม) | Drop (ลด) | Order (ถูกตัดตามออเดอร์)
    label = db.Column(db.String(120), nullable=False)  # ข้อความที่แสดง เช่น "Order #0163"
    amount = db.Column(db.Integer, nullable=False)  # + เพิ่ม, - ลด
    balance = db.Column(db.Integer, nullable=False)  # ยอดคงเหลือหลังเปลี่ยน
    cost = db.Column(db.Numeric(18, 6))
    created_at = db.Column(db.DateTime, default=now, nullable=False, index=True)

    def to_json(self):
        return {
            'id': str(self.id), 'ingredientId': str(self.ingredient_id), 'date': to_iso(self.created_at),
            'type': self.type, 'label': self.label, 'amount': self.amount, 'balance': self.balance,
        }


class Menu(db.Model):
    # แผนที่ CRUD ของตาราง menus — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /menus (เริ่มต้นยังไม่เปิดขาย)
    #   [R] GET /menus, GET /snapshot, ตอนสร้างออเดอร์ และตอนรวมประวัติให้ AI
    #   [U] PATCH /menus/<id> (ชื่อ/ราคา/เปิดขาย/สูตร ฯลฯ)
    #   [D] — ยังไม่มี (ตั้งใจ เพราะออเดอร์เก่าอ้างถึงเมนู)
    __tablename__ = 'menus'
    __table_args__ = (
        db.CheckConstraint('price >= 0', name='ck_menu_price_nonneg'),
        db.CheckConstraint(only('category', MENU_CATEGORIES), name='ck_menu_category'),
    )

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(30), nullable=False)
    price = db.Column(db.Numeric(18, 6), default=0, nullable=False)
    image = db.Column(db.Text().with_variant(MEDIUMTEXT(), 'mysql'), default='', nullable=False)
    details = db.Column(db.Text, default='', nullable=False)
    note = db.Column(db.Text, default='', nullable=False)
    available = db.Column(db.Boolean, default=False, nullable=False)  # เปิดขายอยู่ไหม
    modifiers = db.Column(db.JSON, default=list, nullable=False)

    # recipe = สูตรอาหาร (หลายบรรทัด) — ลบเมนูแล้วสูตรหายตามอัตโนมัติ
    recipe = db.relationship('MenuIngredient', cascade='all, delete-orphan', order_by='MenuIngredient.id')

    def to_json(self):
        return {
            'id': str(self.id), 'name': self.name, 'category': self.category, 'price': self.price,
            'image': self.image, 'details': self.details, 'note': self.note, 'available': self.available,
            'modifiers': self.modifiers or [],
            'recipe': [{'ingredientId': str(line.ingredient_id), 'qty': line.quantity} for line in self.recipe],
        }


class MenuIngredient(db.Model):
    """หนึ่งบรรทัดของสูตร: เมนู 1 จานใช้วัตถุดิบนี้เท่าไร"""
    # แผนที่ CRUD ของตาราง menu_ingredients — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /menus และ PATCH /menus/<id> — เขียนบรรทัดสูตรผ่าน save_recipe
    #   [R] อ่านผ่าน menu.recipe (ตอนแสดงเมนู / ตัด stock ตอนสร้างออเดอร์)
    #   [U] — ไม่มี (แก้สูตรคือ "แทนที่ทั้งรายการ")
    #   [D] PATCH /menus/<id> — บรรทัดสูตรที่ไม่อยู่ในสูตรใหม่ถูกลบเอง (cascade)
    __tablename__ = 'menu_ingredients'
    __table_args__ = (db.CheckConstraint('quantity >= 1', name='ck_recipe_quantity_positive'),)

    id = db.Column(db.Integer, primary_key=True)
    menu_id = db.Column(db.Integer, db.ForeignKey('menus.id', ondelete='CASCADE'), nullable=False, index=True)
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)

    ingredient = db.relationship('Ingredient')


# ---------------------------------------------------------------- ออเดอร์

class Order(db.Model):
    # แผนที่ CRUD ของตาราง orders — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /orders (ตัด stock ในคราวเดียวกัน)
    #   [R] GET /orders, GET /snapshot, GET /dashboard/summary (นับของวันนี้), ประวัติที่ส่งให้ AI
    #   [U] POST /orders/<id>/advance และ /cancel — แก้ช่อง status
    #   [D] — ไม่มี (ยกเลิก = เปลี่ยนสถานะ ไม่ใช่ลบแถว)
    __tablename__ = 'orders'
    __table_args__ = (
        db.UniqueConstraint('branch_id', 'number', name='uq_order_branch_number'),
        db.UniqueConstraint('branch_id', 'request_key', name='uq_order_branch_request'),
        db.CheckConstraint(only('status', ORDER_STATUSES), name='ck_order_status'),
    )

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False, index=True)
    number = db.Column(db.String(10), nullable=False)  # เลขออเดอร์ เช่น "0163"
    status = db.Column(db.String(12), default='new', nullable=False)  # new → cooking → ready → done (หรือ cancelled)
    note = db.Column(db.Text, default='', nullable=False)
    total = db.Column(db.Numeric(18, 2), default=0, nullable=False)  # ราคารวม
    gross_total = db.Column(db.Numeric(18, 2))
    ingredient_cost = db.Column(db.Numeric(18, 6))
    discount = db.Column(db.Numeric(18, 2), default=0)
    discount_reason = db.Column(db.String(200), default='')
    revision = db.Column(db.Integer, default=1)
    cancellation_mode = db.Column(db.String(20), default='')
    cancellation_reason = db.Column(db.String(200), default='')
    transferred_to = db.Column(db.Integer)
    split_from = db.Column(db.Integer)
    request_key = db.Column(db.String(80), index=True)
    request_hash = db.Column(db.String(64))
    service_type = db.Column(db.String(12), default='takeaway', nullable=False)
    table_label = db.Column(db.String(30), default='', nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=now, nullable=False, index=True)

    items = db.relationship('OrderItem', cascade='all, delete-orphan', order_by='OrderItem.id')
    usage = db.relationship('OrderUsage', cascade='all, delete-orphan', order_by='OrderUsage.id')
    payments = db.relationship('Payment', order_by='Payment.id', lazy='selectin')

    def to_json(self):
        return {
            'id': str(self.id), 'number': self.number, 'createdAt': to_iso(self.created_at),
            'status': self.status, 'total': self.total, 'note': self.note,
            'grossTotal': self.gross_total if self.gross_total is not None else self.total,
            'ingredientCost': self.ingredient_cost, 'discount': self.discount or 0,
            'discountReason': self.discount_reason or '', 'revision': self.revision or 1,
            'cancellationMode': self.cancellation_mode or '', 'cancellationReason': self.cancellation_reason or '',
            'transferredTo': str(self.transferred_to) if self.transferred_to else None,
            'splitFrom': str(self.split_from) if self.split_from else None,
            'serviceType': self.service_type, 'tableLabel': self.table_label,
            'paid': sum((p.amount for p in self.payments), 0),
            'balance': max(0, self.total - sum((p.amount for p in self.payments), 0)) if self.status != 'cancelled' else 0,
            'payments': [p.to_json() for p in self.payments],
            'items': [item.to_json() for item in self.items],
            'usage': [{'ingredientId': str(use.ingredient_id), 'qty': use.quantity} for use in self.usage],
        }


class OrderItem(db.Model):
    """เมนูที่ลูกค้าสั่ง — เก็บชื่อและราคา "ณ ตอนสั่ง" ไว้ แก้ราคาเมนูทีหลังก็ไม่กระทบออเดอร์เก่า"""
    # แผนที่ CRUD ของตาราง order_items — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /orders — สร้างพร้อมออเดอร์ (เก็บชื่อและราคา ณ ตอนสั่ง)
    #   [R] อ่านผ่าน order.items (dashboard, ประวัติให้ AI, ส่งให้หน้าเว็บ)
    #   [U] — ไม่มี
    #   [D] — ไม่มี (หายตามออเดอร์ถ้าออเดอร์ถูกลบ — cascade)
    __tablename__ = 'order_items'
    __table_args__ = (db.CheckConstraint('qty >= 1', name='ck_item_qty_positive'),)

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id', ondelete='CASCADE'), nullable=False, index=True)
    menu_id = db.Column(db.Integer, db.ForeignKey('menus.id', ondelete='SET NULL'))
    name = db.Column(db.String(120), nullable=False)
    price = db.Column(db.Numeric(18, 6), nullable=False)
    qty = db.Column(db.Integer, nullable=False)
    modifiers = db.Column(db.JSON, default=list, nullable=False)
    note = db.Column(db.String(200), default='', nullable=False)
    recipe_snapshot = db.Column(db.JSON)

    def to_json(self):
        menu_id = str(self.menu_id) if self.menu_id else None
        return {'id': str(self.id), 'menuId': menu_id, 'name': self.name, 'price': self.price, 'qty': self.qty,
                'modifiers': self.modifiers or [], 'note': self.note}


class OrderUsage(db.Model):
    """วัตถุดิบที่ถูกตัด stock ตอนสร้างออเดอร์ — ถ้ายกเลิกออเดอร์ จะคืนตามรายการนี้"""
    # แผนที่ CRUD ของตาราง order_usage — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /orders — จดว่าตัดวัตถุดิบอะไรไปเท่าไร
    #   [R] POST /orders/<id>/cancel — อ่านเพื่อรู้ว่าต้องคืน stock เท่าไร
    #   [U] — ไม่มี
    #   [D] — ไม่มี (หายตามออเดอร์ถ้าออเดอร์ถูกลบ — cascade)
    __tablename__ = 'order_usage'

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id', ondelete='CASCADE'), nullable=False, index=True)
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)


# ---------------------------------------------------------------- แจ้งเตือน

class Notification(db.Model):
    """การแจ้งเตือนของสาขา — ทุกคนในสาขาเห็นเหมือนกัน (ใครอ่านแล้วดูที่ NotificationRead)"""
    # แผนที่ CRUD ของตาราง notifications — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] routes/notifications.py add_notification — เรียกจาก stock (ใกล้หมด/วิกฤต), orders (ใหม่/พร้อมเสิร์ฟ/ยกเลิก), ai (วิเคราะห์เสร็จ)
    #   [R] GET /notifications — รายการล่าสุด + นับที่ยังไม่อ่าน, และ POST .../read
    #   [U] — ไม่มี (แจ้งเตือนไม่ถูกแก้ ส่วน "อ่านแล้ว" เก็บแยกในตาราง notification_reads)
    #   [D] GET /notifications — ลบอันที่เก่ากว่า 30 วันทิ้งอัตโนมัติ
    __tablename__ = 'notifications'
    __table_args__ = (
        db.CheckConstraint(only('kind', NOTIFICATION_KINDS), name='ck_notification_kind'),
        db.CheckConstraint(only('level', NOTIFICATION_LEVELS), name='ck_notification_level'),
    )

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False, index=True)
    kind = db.Column(db.String(20), nullable=False)  # ประเภท เช่น stock_low, order_new
    level = db.Column(db.String(10), default='info', nullable=False)  # ความสำคัญ → สีของจุดที่กระดิ่ง
    title = db.Column(db.String(160), nullable=False)  # หัวข้อ เช่น "วัตถุดิบใกล้หมด: ไก่"
    message = db.Column(db.Text, default='', nullable=False)  # รายละเอียด
    link = db.Column(db.String(190), default='', nullable=False)  # หน้าที่จะพาไปเมื่อกด เช่น /stock/12
    created_at = db.Column(db.DateTime, default=now, nullable=False, index=True)

    def to_json(self, read=False):
        return {
            'id': str(self.id), 'kind': self.kind, 'level': self.level, 'title': self.title,
            'message': self.message, 'link': self.link, 'createdAt': to_iso(self.created_at), 'read': read,
        }


class NotificationRead(db.Model):
    """บันทึกว่า "ผู้ใช้คนนี้ อ่านแจ้งเตือนอันนี้แล้ว" (1 แถว = 1 คน อ่าน 1 อัน)"""
    # แผนที่ CRUD ของตาราง notification_reads — ใครทำอะไรกับตารางนี้บ้าง
    #   [C] POST /notifications/<id>/read และ /notifications/read-all
    #   [R] GET /notifications — เอาไปแยกว่าอันไหนอ่านแล้ว / นับที่ยังไม่อ่าน
    #   [U] — ไม่มี
    #   [D] ลบตามแจ้งเตือนที่เก่ากว่า 30 วัน
    __tablename__ = 'notification_reads'
    __table_args__ = (db.UniqueConstraint('notification_id', 'user_id', name='uq_notification_read'),)

    id = db.Column(db.Integer, primary_key=True)
    notification_id = db.Column(db.Integer, db.ForeignKey('notifications.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)


# ---------------------------------------------------------------- AI

class AiFeedback(db.Model):
    """ผู้ใช้กดว่าคำแนะนำข้อหนึ่ง "มีประโยชน์ไหม" (ให้ซ้ำ = ทับของเดิม)"""
    # แผนที่ CRUD ของตาราง ai_feedback — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] PUT /ai/feedback/<key> — เมื่อยังไม่เคยให้ความเห็นข้อนี้
    #   [R] GET /ai/feedback, และเช็กว่าเคยให้ความเห็นแล้วไหมก่อนบันทึก
    #   [U] PUT /ai/feedback/<key> — เมื่อเคยให้แล้ว แก้ค่า helpful ของแถวเดิม
    #   [D] — ไม่มี
    __tablename__ = 'ai_feedback'
    __table_args__ = (db.UniqueConstraint('branch_id', 'key', name='uq_feedback_branch_key'),)

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False)
    key = db.Column(db.String(190), nullable=False)  # รหัสคำแนะนำ เช่น "restock-ing-shrimp"
    helpful = db.Column(db.Boolean, nullable=False)
    updated_at = db.Column(db.DateTime, default=now, onupdate=now, nullable=False)


class Forecast(db.Model):
    """ผลพยากรณ์ของ AI (สาขาละ 1 แถว) เก็บเป็น JSON ตรงกับที่หน้า Ai/Dashboard ใช้"""
    # แผนที่ CRUD ของตาราง forecasts — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /ai/forecast — เมื่อสาขายังไม่เคยมีผลพยากรณ์
    #   [R] GET /dashboard/summary — แสดงผลล่าสุด, และเช็กว่ามีแล้วไหมก่อนบันทึก
    #   [U] POST /ai/forecast — เมื่อมีแล้ว ทับค่าในแถวเดิม
    #   [D] — ไม่มี
    __tablename__ = 'forecasts'

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), unique=True, nullable=False)
    payload = db.Column(db.JSON, nullable=False)
    generated_at = db.Column(db.DateTime, default=now, nullable=False)


# ---------------------------------------------------------------- วัดผล AI และปิดร้าน

class ForecastHistory(db.Model):
    """ผลพยากรณ์ "ของวันหนึ่ง ๆ" เก็บไว้เทียบกับยอดจริงทีหลัง — สาขาละ 1 แถวต่อวัน (วิเคราะห์ซ้ำวันเดียวกันทับของเดิม)"""
    # แผนที่ CRUD ของตาราง forecast_history — ใครทำอะไรกับตารางนี้บ้าง (ดูคู่มือ CRUD บนสุดของไฟล์)
    #   [C] POST /ai/forecast — เก็บผลพยากรณ์ของ "พรุ่งนี้" (ยังไม่มียอดจริง)
    #   [R] GET /ai/accuracy และตอนเตรียมข้อมูลให้ AI (บอก AI ว่าครั้งก่อนพยากรณ์คลาดเท่าไร)
    #   [U] POST /ai/forecast — วิเคราะห์ซ้ำวันเดียวกันทับค่าพยากรณ์ / เมื่อวันผ่านไปแล้ว โค้ดเติมยอดจริง (actual_*) ให้เอง
    #   [D] — ไม่มี
    __tablename__ = 'forecast_history'
    __table_args__ = (db.UniqueConstraint('branch_id', 'target_date', name='uq_forecast_history_day'),)

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False, index=True)
    target_date = db.Column(db.Date, nullable=False, index=True)  # วันที่ถูกพยากรณ์ (เวลาท้องถิ่น)
    orders = db.Column(db.Integer, nullable=False)  # ออเดอร์ที่ AI คาด
    revenue = db.Column(db.Numeric(18, 2), nullable=False)  # รายได้ที่ AI คาด (บาท)
    baseline_orders = db.Column(db.Integer, default=0, nullable=False)  # ค่าอ้างอิงจากสถิติธรรมดา (ค่าเฉลี่ยของวันนั้นในสัปดาห์) ไว้เทียบว่า AI ดีกว่าไหม
    planned_leftover_value = db.Column(db.Numeric(18, 2), default=0, nullable=False)  # มูลค่าของค้างคืนที่แผนความสดคาดไว้ (บาท)
    actual_orders = db.Column(db.Integer)  # ยอดจริง — ว่างจนกว่าวันนั้นจะผ่านไป
    actual_revenue = db.Column(db.Numeric(18, 2))
    generated_at = db.Column(db.DateTime, default=now, nullable=False)


class ClosingCount(db.Model):
    """การปิดร้านของวันหนึ่ง: นับวัตถุดิบที่เหลือจริง + บันทึกของเสีย — ใช้วัดว่า "ของค้างคืนน้อยที่สุด" ได้จริงไหม"""
    # แผนที่ CRUD ของตาราง closing_counts — ใครทำอะไรกับตารางนี้บ้าง
    #   [C] POST /closing — บันทึกการปิดร้านวันนี้ (วันละครั้ง)
    #   [R] GET /closing/today, GET /closing/history และตอนเตรียมข้อมูลให้ AI (ผลปิดร้านล่าสุด)
    #   [U] — ไม่มี (ปิดร้านแล้วไม่แก้ เพื่อให้ตัวเลขเชื่อถือได้)
    #   [D] — ไม่มี
    __tablename__ = 'closing_counts'
    __table_args__ = (db.UniqueConstraint('branch_id', 'business_date', name='uq_closing_day'),)

    id = db.Column(db.Integer, primary_key=True)
    branch_id = db.Column(db.Integer, db.ForeignKey('branches.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    business_date = db.Column(db.Date, nullable=False, index=True)  # วันที่ปิดร้าน (เวลาท้องถิ่น)
    note = db.Column(db.Text, default='', nullable=False)
    leftover_value = db.Column(db.Numeric(18, 2), default=0, nullable=False)  # มูลค่าของที่เหลือจริงหลังปิดร้าน (บาท) — ยิ่งน้อยยิ่งสด
    waste_value = db.Column(db.Numeric(18, 2), default=0, nullable=False)  # มูลค่าของเสียที่ทิ้ง (บาท)
    variance_value = db.Column(db.Numeric(18, 2), default=0, nullable=False)  # ส่วนต่างระหว่างที่ระบบคิดกับที่นับจริง (บาท) ติดลบ = ของหายโดยไม่ทราบสาเหตุ
    planned_leftover_value = db.Column(db.Numeric(18, 2))  # มูลค่าของค้างที่แผนความสดคาดไว้สำหรับวันนี้ (ถ้ามี)
    created_at = db.Column(db.DateTime, default=now, nullable=False)

    lines = db.relationship('ClosingLine', cascade='all, delete-orphan', order_by='ClosingLine.id')

    def to_json(self, with_lines=False):
        data = {
            'id': str(self.id), 'date': self.business_date.isoformat(), 'note': self.note,
            'leftoverValue': self.leftover_value, 'wasteValue': self.waste_value, 'varianceValue': self.variance_value,
            'plannedLeftoverValue': self.planned_leftover_value, 'createdAt': to_iso(self.created_at),
            'lineCount': len(self.lines),
        }
        if with_lines:
            data['lines'] = [line.to_json() for line in self.lines]
        return data


class ClosingLine(db.Model):
    """วัตถุดิบ 1 รายการที่นับตอนปิดร้าน"""
    # แผนที่ CRUD ของตาราง closing_lines — ใครทำอะไรกับตารางนี้บ้าง
    #   [C] POST /closing — สร้างพร้อมการปิดร้าน (เก็บจำนวนในระบบ/ที่นับจริง/ของเสีย/ราคา ณ ตอนนั้น)
    #   [R] อ่านผ่าน closing.lines
    #   [U] — ไม่มี     [D] — ไม่มี (หายตามการปิดร้านถ้าการปิดร้านถูกลบ — cascade)
    __tablename__ = 'closing_lines'
    __table_args__ = (
        db.CheckConstraint('system_qty >= 0 AND counted_qty >= 0 AND waste_qty >= 0', name='ck_closing_line_nonneg'),
    )

    id = db.Column(db.Integer, primary_key=True)
    closing_id = db.Column(db.Integer, db.ForeignKey('closing_counts.id', ondelete='CASCADE'), nullable=False, index=True)
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id'), nullable=False)
    system_qty = db.Column(db.Integer, nullable=False)  # จำนวนที่ระบบคิดว่ามีก่อนปิดร้าน
    counted_qty = db.Column(db.Integer, nullable=False)  # จำนวนที่นับได้จริง (หลังหักของเสีย = ของที่เหลือ)
    waste_qty = db.Column(db.Integer, default=0, nullable=False)  # จำนวนที่ทิ้ง
    price = db.Column(db.Numeric(18, 6), default=0, nullable=False)  # ราคาต่อหน่วย ณ ตอนปิดร้าน (บาท)

    ingredient = db.relationship('Ingredient')

    def to_json(self):
        return {
            'ingredientId': str(self.ingredient_id), 'name': self.ingredient.name, 'unit': self.ingredient.unit,
            'systemQty': self.system_qty, 'countedQty': self.counted_qty, 'wasteQty': self.waste_qty, 'price': self.price,
        }


class IngredientBatch(db.Model):
    __tablename__ = 'ingredient_batches'
    __table_args__ = (db.CheckConstraint('remaining >= 0 AND received_qty >= 0', name='ck_batch_nonneg'),)
    id = db.Column(db.Integer, primary_key=True)
    ingredient_id = db.Column(db.Integer, db.ForeignKey('ingredients.id'), nullable=False, index=True)
    remaining = db.Column(db.Integer, nullable=False)
    received_qty = db.Column(db.Integer, nullable=False)
    expires_on = db.Column(db.Date)
    label = db.Column(db.String(120), nullable=False, default='')
    received_at = db.Column(db.DateTime, nullable=False, default=now)
    unit_cost = db.Column(db.Numeric(18, 6))

    def to_json(self):
        from .inventory_policy import business_date
        return {'id': str(self.id), 'remaining': self.remaining,
                'expiresOn': self.expires_on.isoformat() if self.expires_on else None,
                'expired': bool(self.expires_on and self.expires_on < business_date()),
                'label': self.label, 'receivedAt': to_iso(self.received_at)}


class BatchAllocation(db.Model):
    __tablename__ = 'batch_allocations'
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('orders.id'), nullable=False, index=True)
    batch_id = db.Column(db.Integer, db.ForeignKey('ingredient_batches.id'), nullable=False, index=True)
    quantity = db.Column(db.Integer, nullable=False)
    unit_cost = db.Column(db.Numeric(18, 6))
    batch = db.relationship('IngredientBatch')
