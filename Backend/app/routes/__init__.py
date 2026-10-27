"""รวมทุกกลุ่มของ API (Blueprint) — ทุกเส้นทางขึ้นต้นด้วย /api/v1

ไฟล์ในโฟลเดอร์นี้ 1 ไฟล์ = 1 กลุ่มงาน:
    auth.py     สมัคร / ล็อกอิน / ลืมรหัสผ่าน
    notifications.py   ระบบแจ้งเตือน (กระดิ่ง) + ฟังก์ชันสร้างแจ้งเตือนที่ไฟล์อื่นเรียกใช้
    stock.py    วัตถุดิบ + ประวัติ stock + เมนูและสูตร
    orders.py   ออเดอร์ (ตัด/คืน stock) + ตัวเลขสรุปหน้าแรก
    ai.py       ให้ AI พยากรณ์พรุ่งนี้ + ความแม่นย้อนหลัง + ความเห็นต่อคำแนะนำ
    closing.py  ปิดร้าน: นับของจริง + ของเสีย (วัดว่าของค้างคืนน้อยจริงไหม)
และตรวจระบบ (health) อยู่ในไฟล์นี้เลย
"""
from flask import Blueprint, jsonify
from sqlalchemy import text

from .. import db
from . import ai, auth, closing, notifications, orders, stock, planning
from .. import restaurant
from .. import pos, purchasing, staff_sessions, service_reports

API_PREFIX = '/api/v1'

health_bp = Blueprint('health', __name__)


@health_bp.get('/health')
def health():
    """GET /api/v1/health — ถามว่า "ระบบและฐานข้อมูลพร้อมใช้งานไหม" (ไม่ต้องล็อกอิน)"""
    try:
        # [R] READ: ถามฐานข้อมูลด้วยคำถามที่ง่ายที่สุด (SELECT 1) — ตอบได้แปลว่าเชื่อมต่อได้ ไม่ได้แตะตารางใดเลย
        db.session.execute(text('SELECT 1'))
    except Exception:
        return jsonify({'status': 'error', 'database': 'down'}), 503
    return jsonify({'status': 'ok', 'database': 'ok'})


def register_routes(app):
    for module in (auth, stock, orders, notifications, ai, closing, planning, restaurant, pos, purchasing, staff_sessions, service_reports):
        app.register_blueprint(module.bp, url_prefix=API_PREFIX)
    app.register_blueprint(health_bp, url_prefix=API_PREFIX)
