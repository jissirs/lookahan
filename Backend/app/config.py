"""ค่าตั้งต้นของแอป — อ่านจากไฟล์ .env (ดูตัวอย่างที่ .env.example)

มี 2 ชุด:  Config = ใช้งานจริง/พัฒนา,  TestingConfig = ใช้ตอนเทสต์ (ฐานข้อมูลในหน่วยความจำ)
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

# ฐานข้อมูล: ใช้ DATABASE_URL ถ้ามี (เช่น MySQL ออนไลน์) ไม่งั้นใช้ SQLite เป็นไฟล์ในเครื่อง (เหมาะกับทดลอง)
DATABASE_URL = os.getenv('DATABASE_URL', '').strip()
if not DATABASE_URL:
    DATABASE_URL = 'sqlite:///' + (BASE_DIR / 'instance' / 'dev.db').as_posix()

# ตรวจรูปแบบ: ต้องเป็น  ชนิด://ผู้ใช้:รหัสผ่าน@โฮสต์:พอร์ต/ชื่อฐานข้อมูล  (ไม่ใช่ข้อความอื่น)
if '://' not in DATABASE_URL:
    raise ValueError('DATABASE_URL ในไฟล์ .env รูปแบบไม่ถูกต้อง — ตัวอย่าง: mysql+pymysql://user:password@host:3306/dbname')

# MySQL ต้องบอกให้ใช้ตัวอักษร utf8mb4 (รองรับภาษาไทยครบ) ไม่งั้นข้อความไทยอาจเพี้ยนหรือบันทึกไม่ได้
if DATABASE_URL.startswith('mysql') and 'charset=' not in DATABASE_URL:
    DATABASE_URL += ('&' if '?' in DATABASE_URL else '?') + 'charset=utf8mb4'

# ฐานข้อมูลออนไลน์ส่วนใหญ่บังคับ SSL: ใส่ path ของไฟล์ CA ใน DB_SSL_CA (เว้นว่างถ้าไม่ต้องใช้)
ENGINE_OPTIONS = {'pool_pre_ping': True}  # ตรวจการเชื่อมต่อก่อนใช้ทุกครั้ง กัน connection ที่ถูกปิดไปแล้ว
DB_SSL_CA = os.getenv('DB_SSL_CA', '').strip()
if DB_SSL_CA and not DATABASE_URL.startswith('sqlite'):
    ENGINE_OPTIONS['connect_args'] = {'ssl': {'ca': DB_SSL_CA}}


class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'change-me')
    SQLALCHEMY_DATABASE_URI = DATABASE_URL
    SQLALCHEMY_ENGINE_OPTIONS = ENGINE_OPTIONS
    CORS_ORIGINS = os.getenv('CORS_ORIGINS', 'http://localhost:5173').split(',')  # หน้าเว็บที่อนุญาต (คั่นด้วย ,)

    TIMEZONE_OFFSET_HOURS = 7  # เวลาท้องถิ่น (ไทย = UTC+7) ใช้หาว่า "วันนี้" เริ่มกี่โมง
    SESSION_LIFETIME_DAYS = 30  # token ล็อกอินหมดอายุกี่วัน
    OTP_LIFETIME_MINUTES = 5  # OTP หมดอายุกี่นาที
    OTP_MAX_ATTEMPTS = 5  # กรอก OTP ผิดได้กี่ครั้ง
    OTP_RESEND_SECONDS = 60  # ขอ OTP ใหม่ได้ทุกกี่วินาที (กันคนกดรัว ๆ ส่งอีเมลถล่มคนอื่น)

    # อีเมล (SMTP) สำหรับส่ง OTP — ใส่ในไฟล์ .env ห้ามเขียนในโค้ด (ดูวิธีตั้งค่าใน README ข้อ "ตั้งค่าอีเมล")
    # ถ้าไม่ใส่ SMTP_HOST = ยังไม่ส่งอีเมลจริง (โหมดทดลอง)
    # ต้องใส่ "ครบ" ทั้ง SMTP_HOST + SMTP_USER + SMTP_PASSWORD ถึงจะนับว่าพร้อมส่ง — ตั้งไว้ครึ่ง ๆ จะยังอยู่ในโหมดทดลอง
    # (ไม่งั้นระบบจะเลิกโชว์ OTP แล้วส่งอีเมลไม่ได้จริง ผู้ใช้ก็ติดค้าง)
    SMTP_HOST = os.getenv('SMTP_HOST', '').strip()  # เช่น smtp.gmail.com
    SMTP_PORT = int(os.getenv('SMTP_PORT', '').strip() or 587)  # 587 = STARTTLS, 465 = SSL
    SMTP_USER = os.getenv('SMTP_USER', '').strip()  # บัญชีอีเมลที่ใช้ส่ง
    SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '').replace(' ', '')  # Gmail ใช้ "รหัสผ่านแอป" (ตัดช่องว่างให้เอง)
    SMTP_FROM = os.getenv('SMTP_FROM', '').strip() or SMTP_USER  # ที่อยู่ผู้ส่งที่ผู้รับเห็น
    # วิธีเข้ารหัสการเชื่อมต่อ: ssl | starttls | none (none ใช้กับเซิร์ฟเวอร์ทดสอบในเครื่องเท่านั้น)
    SMTP_SECURITY = os.getenv('SMTP_SECURITY', '').strip().lower() or ('ssl' if SMTP_PORT == 465 else 'starttls')
    MAIL_ENABLED = bool(SMTP_HOST and (SMTP_SECURITY == 'none' or (SMTP_USER and SMTP_PASSWORD)))  # True = ส่งอีเมลจริง
    # ตั้งไว้แค่บางส่วน (มี SMTP_HOST แต่ขาด user/password) — ใช้เตือนตอนเริ่มระบบและใน test-email
    MAIL_INCOMPLETE = bool(SMTP_HOST) and not MAIL_ENABLED

    # AI (Groq): ใส่คีย์ในไฟล์ .env ห้ามเขียนในโค้ด
    GROQ_API_KEY = os.getenv('GROQ_API_KEY', '').strip()
    GROQ_MODEL = os.getenv('GROQ_MODEL', '').strip() or 'openai/gpt-oss-120b'

    # True = ตอบ OTP กลับไปในคำตอบ (โหมดทดลอง) — เปิดเฉพาะเมื่อ "ยังไม่ตั้งค่าอีเมล" และไม่ใช่ production
    # ตั้งค่าอีเมลแล้ว OTP จะถูกส่งทางอีเมลเท่านั้น ไม่ตอบกลับตรง ๆ อีกต่อไป
    IS_PRODUCTION = os.getenv('APP_ENV') == 'production'
    EXPOSE_OTP = not IS_PRODUCTION and not MAIL_ENABLED


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite://'  # ฐานข้อมูลในหน่วยความจำ หายเมื่อเทสต์จบ
    SQLALCHEMY_ENGINE_OPTIONS = {}
    SECRET_KEY = 'test'
    SMTP_HOST = ''  # เทสต์ห้ามส่งอีเมลจริง (แม้ไฟล์ .env ของเครื่องนี้จะตั้งค่า SMTP ไว้)
    MAIL_ENABLED = False
    MAIL_INCOMPLETE = False
    EXPOSE_OTP = True  # ตั้งตรง ๆ ไม่พึ่งค่าจาก .env เพื่อให้เทสต์ได้ผลเหมือนกันทุกเครื่อง
    GROQ_API_KEY = ''  # เทสต์ห้ามเรียก Groq จริง (เทสต์ที่ต้องใช้จะใส่คีย์ปลอมและจำลองคำตอบเอง)
