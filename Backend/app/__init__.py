"""สร้างแอป Flask — ฟังก์ชัน create_app() ประกอบทุกส่วนเข้าด้วยกัน

    create_app('testing')   ใช้ตอนเทสต์ (ฐานข้อมูลในหน่วยความจำ)
    wsgi.py                 ใช้ตอนรันจริง
"""
from decimal import Decimal
from flask import Flask
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy

# ตัวช่วยที่ใช้ทั้งแอป (ต้องประกาศก่อนบรรทัด import ด้านล่าง เพราะไฟล์อื่นดึง db ไปใช้)
db = SQLAlchemy()  # ตัวคุยกับฐานข้อมูล
cors = CORS()  # อนุญาตให้หน้าเว็บ (คนละที่อยู่) เรียก API ได้

from .commands import register_commands  # noqa: E402
from .config import Config, TestingConfig  # noqa: E402
from .routes import register_routes  # noqa: E402
from .tools import check_login, register_error_handlers  # noqa: E402


def create_app(env=None):
    app = Flask(__name__)
    default_json = app.json.default
    app.json.default = lambda value: float(value) if isinstance(value, Decimal) else default_json(value)
    app.config.from_object(TestingConfig if env == 'testing' else Config)
    app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024
    if app.config.get('IS_PRODUCTION') and app.config['SECRET_KEY'] == 'change-me':
        raise RuntimeError('Production requires a unique SECRET_KEY')

    # เตือนตั้งแต่เริ่มระบบ ถ้าตั้งค่าอีเมลไม่ครบ (จะได้ไม่ไปรู้ตอนผู้ใช้ขอ OTP แล้วไม่ได้รับ)
    if app.config.get('MAIL_INCOMPLETE'):
        app.logger.warning('ตั้งค่าอีเมลไม่ครบ: มี SMTP_HOST แต่ขาด SMTP_USER หรือ SMTP_PASSWORD — ยังไม่ส่งอีเมลจริง (โหมดทดลอง)')

    # 1) ต่อตัวช่วยเข้ากับแอป
    db.init_app(app)
    cors.init_app(app, resources={r'/api/*': {'origins': app.config['CORS_ORIGINS']}})
    from .operations import setup_operations
    setup_operations(app)

    # 2) ก่อนทำทุกคำขอ ให้ตรวจก่อนว่าล็อกอินแล้วหรือยัง (ยกเว้นหน้าที่เปิดให้ทุกคน)
    app.before_request(check_login)

    # 3) เปิดเส้นทาง API, ตัวจัดการ error และคำสั่ง flask check-db / init-db / reset-db
    register_routes(app)
    register_error_handlers(app)
    register_commands(app)

    return app
