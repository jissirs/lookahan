"""เครื่องมือเล็ก ๆ ที่ทุกไฟล์ใช้ร่วมกัน — แบ่งเป็น 3 ส่วนในไฟล์เดียว:

    1) ข้อผิดพลาดของ API   ApiError(code, message) + ตัวแปลงเป็น JSON ให้หน้าเว็บ
    2) ตัวช่วยอ่านคำขอ     อ่าน JSON, แปลง id, ตรวจชนิดข้อมูล, หาข้อมูลของสาขาตัวเอง, กฎรหัสผ่าน
    3) ความปลอดภัย         ตีป่นรหัสผ่าน/token, สร้าง OTP และ check_login (ตรวจว่าล็อกอินแล้วหรือยัง)
    4) ส่งอีเมล            send_email — ส่งอีเมลผ่าน SMTP (ใช้ส่ง OTP ลืมรหัสผ่าน)

ใช้ใน routes/ แบบนี้:   from ..tools import ApiError, json_body, find_mine
"""
import hashlib
import re
import secrets
import smtplib
from email.message import EmailMessage

from flask import current_app, g, jsonify, request
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from . import db
from .models import Session, now


# =====================================================================
#  1) ข้อผิดพลาดของ API
#  ทุก error ตอบเป็น JSON:  { "error": { "code": "INSUFFICIENT_STOCK", "message": "..." } }
#  (ตรงกับ ApiError ที่หน้าเว็บใช้อยู่ ที่ frontend/src/services/ApiError.js)
#  ในโค้ดแค่ `raise ApiError('รหัส', 'ข้อความ')` — ตัวแปลงด้านล่างจะตอบ response ให้เอง
# =====================================================================
# รหัส error → HTTP status (รหัสที่ไม่อยู่ในรายการใช้ 400)
STATUS_BY_CODE = {
    'VALIDATION': 400,
    'WEAK_PASSWORD': 400,
    'INVALID_OTP': 400,
    'OTP_EXPIRED': 400,
    'INVALID_RESET_TOKEN': 400,
    'INVALID_CREDENTIALS': 401,
    'UNAUTHORIZED': 401,
    'NOT_FOUND': 404,
    'EMAIL_NOT_FOUND': 404,
    'EMAIL_TAKEN': 409,
    'DUPLICATE_NAME': 409,
    'ALREADY_CLOSED': 409,
    'INSUFFICIENT_STOCK': 409,
    'TOO_MANY_ATTEMPTS': 429,
    'AI_NOT_CONFIGURED': 503,
    'AI_ERROR': 502,
    'TOO_MANY_REQUESTS': 429,
    'EMAIL_SEND_FAILED': 502,
    'EMAIL_NOT_CONFIGURED': 503,
}


class ApiError(Exception):
    def __init__(self, code, message, status=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status or STATUS_BY_CODE.get(code, 400)


def error_response(code, message, status):
    return jsonify({'error': {'code': code, 'message': message}}), status


def register_error_handlers(app):
    @app.errorhandler(ApiError)
    def handle_api_error(err):
        # rollback = ทิ้งทุกอย่างที่แก้ไว้ในถาด session แต่ยังไม่ได้ commit (กันข้อมูลครึ่ง ๆ กลาง ๆ)
        # จึงปลอดภัยที่จะ raise ApiError กลางทาง: ที่แก้ไว้ก่อนหน้านี้จะไม่ถูกบันทึก
        db.session.rollback()
        return error_response(err.code, err.message, err.status)

    @app.errorhandler(Exception)
    def handle_other_errors(err):
        db.session.rollback()
        if isinstance(err, HTTPException):  # เช่น 404 หาเส้นทางไม่เจอ, 405 ใช้วิธีผิด → ตอบเป็น JSON รูปเดียวกัน
            code = 'NOT_FOUND' if err.code == 404 else 'HTTP_ERROR'
            return error_response(code, err.description, err.code)
        app.logger.exception('Unhandled error')  # บั๊กที่ไม่คาดคิด: จดไว้ดูในเทอร์มินัล แต่ไม่โชว์รายละเอียดให้ผู้ใช้
        return error_response('SERVER_ERROR', 'Something went wrong', 500)


# =====================================================================
#  2) ตัวช่วยอ่านคำขอ
# =====================================================================
def json_body():
    """อ่านข้อมูล JSON ที่หน้าเว็บส่งมา (ต้องเป็น object เช่น {"name": "ไก่"})"""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError('VALIDATION', 'Request body must be a JSON object')
    return data


def to_id(value, what='item'):
    """แปลง id ที่ส่งมาเป็นข้อความ ("12") ให้เป็นตัวเลข 12 — ถ้าแปลงไม่ได้ แปลว่าไม่มีของชิ้นนี้"""
    try:
        if isinstance(value, bool):
            raise ValueError()
        return int(value)
    except (TypeError, ValueError):
        raise ApiError('NOT_FOUND', what + ' not found')


def find_mine(model, raw_id, what='item'):
    """หาแถวตาม id แต่ "เฉพาะของสาขาตัวเอง" — ไม่เจอก็แจ้ง NOT_FOUND
    (กันไม่ให้สาขาหนึ่งแอบแก้ข้อมูลของอีกสาขา)"""
    # [R] READ: ดึง 1 แถวจากตารางใดก็ได้ (model) ที่ id ตรง และเป็นของสาขาตัวเองเท่านั้น
    row = model.query.filter_by(id=to_id(raw_id, what), branch_id=g.branch_id).first()
    if row is None:
        raise ApiError('NOT_FOUND', what + ' not found')
    return row


def is_blank(value):
    """ว่างเปล่าไหม (None, "" หรือมีแต่ช่องว่าง)"""
    if value is None:
        return True
    return str(value).strip() == ''


def is_whole_number(value):
    """เป็นจำนวนเต็มจริง ๆ ไหม (True/False ใน Python นับเป็นตัวเลข จึงต้องกันออก)"""
    return isinstance(value, int) and not isinstance(value, bool)


def get_password_error(password):
    """กฎรหัสผ่านที่ยอมรับได้ (ต้องตรงกับ frontend/src/utils/passwordRules.js)
    คืนข้อความ error หรือ '' ถ้าผ่าน"""
    if not password:
        return 'Please enter a password'
    if len(password) < 8:
        return 'Password must be at least 8 characters'
    if not re.search(r'[A-Za-z]', password) or not re.search(r'\d', password):
        return 'Password must contain letters and numbers'
    return ''


# =====================================================================
#  3) ความปลอดภัย
#  คำศัพท์:
#      hash   = "ตีป่น" ข้อความให้กลับเป็นของเดิมไม่ได้ ใช้เก็บรหัสผ่าน/token แทนตัวจริง
#               ต่อให้ฐานข้อมูลรั่ว คนร้ายก็เอาไปใช้ล็อกอินไม่ได้
#      token  = ข้อความสุ่มยาว ๆ ที่ให้ผู้ใช้ถือหลังล็อกอิน แนบมากับทุกคำขอเพื่อบอกว่า "ฉันคือคนนี้"
# =====================================================================
def hash_password(password):
    return generate_password_hash(password)


def password_matches(password_hash, password):
    return check_password_hash(password_hash, password)


def make_token():
    """สร้าง token สุ่ม"""
    return secrets.token_urlsafe(32)


def make_otp():
    """สร้าง OTP 6 หลัก เช่น "048213" """
    return str(secrets.randbelow(1000000)).zfill(6)


def hash_text(text):
    """ตีป่นข้อความด้วย SHA-256 (ใช้กับ token และ OTP)"""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


# เส้นทางที่ "ไม่ต้องล็อกอิน" (ที่เหลือทั้งหมดต้องล็อกอิน)
PUBLIC_PATHS = (
    '/api/v1/health',
    '/api/v1/auth/register',
    '/api/v1/auth/login',
    '/api/v1/auth/otp',
    '/api/v1/auth/otp/verify',
    '/api/v1/auth/password/reset',
)


def check_login():
    """ทำงาน "ก่อนทุกคำขอ" (ผูกไว้ใน create_app) — ตรวจว่าผู้ใช้ล็อกอินแล้วหรือยัง

    ขั้นตอน: อ่าน token จากหัว "Authorization: Bearer ..." → หาในตาราง sessions → เช็กว่ายังไม่หมดอายุ
    ผ่านแล้วจะจดไว้ใน g ให้ route ใช้ได้เลย:  g.user (ผู้ใช้)  g.branch_id (สาขาของเขา)  g.token_hash
    ไม่ผ่านจะโยน ApiError UNAUTHORIZED
    """
    # ปล่อยผ่าน: คำขอ OPTIONS (เบราว์เซอร์ถามเรื่อง CORS), เส้นทางที่ไม่มีอยู่ (ให้ตอบ 404 ตามปกติ), เส้นทางสาธารณะ
    if request.method == 'OPTIONS' or request.endpoint is None or request.path in PUBLIC_PATHS:
        return

    header = request.headers.get('Authorization', '')
    token = header[7:].strip() if header.lower().startswith('bearer ') else ''

    session = None
    if token:
        # [R] READ: หาแถวบัตรผ่าน (sessions) ที่ตรงกับ token (เทียบด้วยค่าตีป่น ไม่ใช่ token จริง)
        session = Session.query.filter_by(token_hash=hash_text(token)).first()

    if session is None or session.expires_at < now():
        if session is not None:  # หมดอายุแล้ว ลบทิ้ง
            # [D] DELETE: ลบแถวบัตรผ่านที่หมดอายุออกจากตาราง sessions
            db.session.delete(session)
            db.session.commit()
        raise ApiError('UNAUTHORIZED', 'Session expired')

    g.user = session.user
    g.branch_id = session.user.branch_id  # ข้อมูลทุกอย่างถูกจำกัดอยู่ในสาขาของผู้ใช้
    g.token_hash = session.token_hash


# =====================================================================
#  4) ส่งอีเมล (SMTP)
#  SMTP คือ "ที่ทำการไปรษณีย์ของอีเมล" — เราล็อกอินเข้าไปแล้วฝากจดหมายให้เขาส่งต่อ
#  ค่าที่ต้องใช้ (SMTP_HOST, SMTP_USER, SMTP_PASSWORD ...) ตั้งในไฟล์ .env
# =====================================================================
def send_email(to, subject, text, html=None):
    """ส่งอีเมล 1 ฉบับถึง `to`

    text = เนื้อหาแบบข้อความธรรมดา (ทุกโปรแกรมอีเมลอ่านได้)   html = เนื้อหาแบบสวย ๆ (ไม่ใส่ก็ได้)
    ถ้าส่งไม่สำเร็จ (รหัสผ่านผิด, เน็ตหลุด ฯลฯ) จะ raise ApiError('EMAIL_SEND_FAILED')
    รายละเอียดจริงของปัญหาจดไว้ใน log ของเซิร์ฟเวอร์ (ไม่โชว์ให้ผู้ใช้ เพราะอาจมีข้อมูลภายใน)
    """
    config = current_app.config
    if not config['MAIL_ENABLED']:
        raise ApiError('EMAIL_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าอีเมล (SMTP) ในไฟล์ .env ของ Backend')

    # ประกอบจดหมาย: หัวเรื่อง ผู้ส่ง ผู้รับ เนื้อหา
    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = config['SMTP_FROM']
    message['To'] = to
    message.set_content(text)
    if html:
        message.add_alternative(html, subtype='html')

    try:
        # ต่อเข้าเซิร์ฟเวอร์อีเมล (รอไม่เกิน 10 วินาที) — เข้ารหัสแบบ ssl (พอร์ต 465) หรือ starttls (พอร์ต 587)
        if config['SMTP_SECURITY'] == 'ssl':
            server = smtplib.SMTP_SSL(config['SMTP_HOST'], config['SMTP_PORT'], timeout=10)
        else:
            server = smtplib.SMTP(config['SMTP_HOST'], config['SMTP_PORT'], timeout=10)
        with server:
            if config['SMTP_SECURITY'] == 'starttls':
                server.starttls()
            if config['SMTP_USER']:
                server.login(config['SMTP_USER'], config['SMTP_PASSWORD'])
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as error:
        current_app.logger.error('ส่งอีเมลไม่สำเร็จ: %s: %s', type(error).__name__, error)
        raise ApiError('EMAIL_SEND_FAILED', 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่ภายหลัง') from error
