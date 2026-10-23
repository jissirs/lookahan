"""บัญชีผู้ใช้ — สมัคร, ล็อกอิน, ออกจากระบบ, ลืมรหัสผ่าน (ใช้ OTP)

    POST /auth/register        สมัครสมาชิก
    POST /auth/login           ล็อกอิน → ได้ token
    GET  /auth/me              ถามว่า "ฉันคือใคร" (ใช้ token)
    POST /auth/logout          ออกจากระบบ
    POST /auth/otp             ขอ OTP (ลืมรหัสผ่านขั้นที่ 1)
    POST /auth/otp/verify      ตรวจ OTP → ได้ resetToken (ขั้นที่ 2)
    POST /auth/password/reset  ตั้งรหัสใหม่ด้วย resetToken (ขั้นที่ 3)
"""
from datetime import timedelta
from html import escape

from flask import Blueprint, current_app, g, jsonify

from .. import db
from ..models import Branch, PasswordReset, Session, User, now
from ..tools import (
    ApiError, get_password_error, hash_password, hash_text, is_blank, json_body, make_otp, make_token, password_matches,
    send_email,
)

bp = Blueprint('auth', __name__)


def clean(text):
    """ทำให้ข้อความเทียบกันง่าย: ตัดช่องว่างหัวท้าย + ตัวพิมพ์เล็ก (ให้ "A@x.co" กับ "a@x.co" เป็นคนเดียวกัน)"""
    return str(text or '').strip().lower()


def otp_email_body(user, otp):
    """เนื้อหาอีเมล OTP — คืน (ข้อความธรรมดา, ข้อความแบบ HTML)"""
    minutes = current_app.config['OTP_LIFETIME_MINUTES']
    text = (
        'สวัสดีคุณ %s,\n\n'
        'รหัส OTP สำหรับรีเซ็ตรหัสผ่านของคุณคือ: %s\n'
        'รหัสนี้หมดอายุใน %s นาที และใช้ได้ครั้งเดียว\n\n'
        'ถ้าคุณไม่ได้เป็นคนขอ ให้เพิกเฉยอีเมลนี้ได้เลย (รหัสผ่านของคุณจะไม่ถูกเปลี่ยน)\n'
        'ห้ามบอกรหัสนี้กับใคร ทีมงานจะไม่ขอรหัสนี้จากคุณ'
    ) % (user.name, otp, minutes)
    html = (
        '<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto">'
        '<p>สวัสดีคุณ %s,</p>'
        '<p>รหัส OTP สำหรับรีเซ็ตรหัสผ่านของคุณคือ</p>'
        '<p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f4f4f4;'
        'padding:12px;text-align:center;border-radius:8px">%s</p>'
        '<p>รหัสนี้หมดอายุใน <b>%s นาที</b> และใช้ได้ครั้งเดียว</p>'
        '<p style="color:#666;font-size:13px">ถ้าคุณไม่ได้เป็นคนขอ ให้เพิกเฉยอีเมลนี้ได้เลย '
        '(รหัสผ่านของคุณจะไม่ถูกเปลี่ยน) ห้ามบอกรหัสนี้กับใคร</p></div>'
    ) % (escape(user.name), otp, minutes)
    return text, html


def find_user_by_email(email):
    # [R] READ: ค้นตาราง users หาผู้ใช้ 1 คนจากอีเมล (db.func.lower = ไม่สนตัวพิมพ์เล็ก/ใหญ่) ไม่เจอได้ None
    return User.query.filter(db.func.lower(User.email) == clean(email)).first()


@bp.post('/auth/register')
def register():
    body = json_body()

    # ขั้นที่ 1: ตรวจข้อมูล
    if is_blank(body.get('name')) or is_blank(body.get('surname')) or is_blank(body.get('email')):
        raise ApiError('VALIDATION', 'Please fill in all fields')

    password_error = get_password_error(body.get('password'))
    if password_error:
        raise ApiError('WEAK_PASSWORD', password_error)

    if find_user_by_email(body['email']):
        raise ApiError('EMAIL_TAKEN', 'This email is already registered')

    # ขั้นที่ 2: ผู้สมัครใหม่เข้าสาขาแรกที่มี (ถ้ายังไม่มีสาขาเลยก็สร้างให้)
    # [R] READ: ดึงสาขาที่ id น้อยที่สุดจากตาราง branches (ถ้ายังไม่มีแถวเลยจะได้ None)
    branch = Branch.query.order_by(Branch.id).first()
    if branch is None:
        branch = Branch(name=body['name'].strip() + ' shop')

    # ขั้นที่ 3: บันทึก (เก็บรหัสผ่านแบบตีป่นเท่านั้น)
    user = User(
        branch=branch,
        name=body['name'].strip(),
        surname=body['surname'].strip(),
        email=body['email'].strip(),
        password_hash=hash_password(body['password']),
    )
    # [C] CREATE (INSERT): เพิ่มผู้ใช้ใหม่ 1 แถวในตาราง users (ถ้าสาขาเป็นของใหม่ จะถูกบันทึกลงตาราง branches ให้ด้วย)
    db.session.add(user)
    db.session.commit()  # commit = บันทึกจริงลงฐานข้อมูล
    return jsonify({'user': user.to_json()}), 201


@bp.post('/auth/login')
def login():
    body = json_body()
    identifier = clean(body.get('identifier'))  # พิมพ์ได้ทั้งชื่อหรืออีเมล

    # หาผู้ใช้ที่ชื่อหรืออีเมลตรงกัน (ชื่ออาจซ้ำกันได้ จึงได้หลายคน)
    candidates = []
    if identifier:
        # [R] READ: ค้นตาราง users หา "ทุกคน" ที่ชื่อหรืออีเมลตรง (.all() = ได้เป็น list)
        candidates = User.query.filter(
            db.or_(db.func.lower(User.name) == identifier, db.func.lower(User.email) == identifier)
        ).all()

    # ลองทีละคน คนไหนรหัสผ่านถูกก็ล็อกอินให้
    for user in candidates:
        if password_matches(user.password_hash, body.get('password') or ''):
            token = make_token()
            expires = now() + timedelta(days=current_app.config['SESSION_LIFETIME_DAYS'])
            # [C] CREATE: เพิ่มแถวในตาราง sessions = "ออกบัตรผ่าน" ให้ผู้ใช้ (เก็บเฉพาะค่าตีป่นของ token)
            db.session.add(Session(user_id=user.id, token_hash=hash_text(token), expires_at=expires))
            db.session.commit()
            return jsonify({'token': token, 'user': user.to_json()})

    # ข้อความเดียวกันไม่ว่าผิดที่ชื่อหรือรหัส จะได้ไม่บอกใบ้คนร้าย
    raise ApiError('INVALID_CREDENTIALS', 'Incorrect name/email or password')


@bp.get('/auth/me')
def me():
    return jsonify(g.user.to_json())


@bp.post('/auth/logout')
def logout():
    # [D] DELETE: ลบแถว session ของบัตรผ่านใบนี้ทิ้ง → token นี้ใช้ล็อกอินอีกไม่ได้
    Session.query.filter_by(token_hash=g.token_hash).delete()
    db.session.commit()
    return jsonify({'ok': True})


@bp.post('/auth/otp')
def request_otp():
    email = json_body().get('email')
    if is_blank(email):
        raise ApiError('VALIDATION', 'Please enter your email')

    user = find_user_by_email(email)
    if user is None:
        raise ApiError('EMAIL_NOT_FOUND', 'No account found with this email')

    config = current_app.config
    lifetime = timedelta(minutes=config['OTP_LIFETIME_MINUTES'])

    # ขั้นที่ 1: กันคนกดขอ OTP รัว ๆ (ไม่งั้นเราจะส่งอีเมลถล่มเจ้าของอีเมลนั้น)
    # [R] READ: ดู OTP เดิมของผู้ใช้คนนี้ — OTP ถูกสร้างเมื่อ (เวลาหมดอายุ - อายุของ OTP) ถ้าเพิ่งสร้างไม่นานให้รอก่อน
    old = PasswordReset.query.filter_by(user_id=user.id).first()
    if old is not None:
        seconds_since_asked = (now() - (old.expires_at - lifetime)).total_seconds()
        if seconds_since_asked < config['OTP_RESEND_SECONDS']:
            wait = int(config['OTP_RESEND_SECONDS'] - seconds_since_asked) + 1
            raise ApiError('TOO_MANY_REQUESTS', 'Please wait %s seconds before requesting a new OTP' % wait)

    # ขั้นที่ 2: ถ้าเป็นระบบจริง (production) แต่ยังไม่ตั้งค่าอีเมล ต้องไม่ทำต่อ (ไม่มีทางส่ง OTP ให้ผู้ใช้ได้)
    if not config['MAIL_ENABLED'] and not config['EXPOSE_OTP']:
        raise ApiError('EMAIL_NOT_CONFIGURED', 'Email is not configured on the server')

    # ขั้นที่ 3: สร้าง OTP ใหม่ แทนที่ของเก่า (ผู้ใช้หนึ่งคนมีได้ทีละรหัส)
    otp = make_otp()
    # [D] DELETE: ลบ OTP เก่าของผู้ใช้คนนี้ (ถ้ามี)  แล้ว  [C] CREATE: เพิ่ม OTP ใหม่ = "แทนที่ของเดิม"
    PasswordReset.query.filter_by(user_id=user.id).delete()
    db.session.add(PasswordReset(user_id=user.id, otp_hash=hash_text(otp), expires_at=now() + lifetime))
    db.session.commit()

    # ขั้นที่ 4: ส่ง OTP ทางอีเมล (ถ้าตั้งค่าอีเมลไว้)
    if config['MAIL_ENABLED']:
        try:
            text, html = otp_email_body(user, otp)
            send_email(user.email, 'รหัส OTP สำหรับรีเซ็ตรหัสผ่าน (lookahan)', text, html)
        except ApiError:
            # ส่งไม่สำเร็จ → ลบ OTP ที่เพิ่งสร้าง เพื่อให้ผู้ใช้กดขอใหม่ได้ทันที (ไม่ต้องรอ OTP_RESEND_SECONDS)
            # [D] DELETE: ลบแถว OTP ที่ผู้ใช้ไม่เคยได้รับ
            PasswordReset.query.filter_by(user_id=user.id).delete()
            db.session.commit()
            raise
        return jsonify({'ok': True})  # ส่งอีเมลแล้ว — ห้ามตอบ OTP กลับไปตรง ๆ เด็ดขาด

    # โหมดทดลอง (ยังไม่ตั้งค่าอีเมล และไม่ใช่ production): ตอบ OTP กลับให้เห็นบนหน้าจอ
    return jsonify({'otp': otp})


@bp.post('/auth/otp/verify')
def verify_otp():
    body = json_body()
    user = find_user_by_email(body.get('email'))
    reset = None
    if user is not None:
        # [R] READ: ดึงแถว OTP ของผู้ใช้คนนี้จากตาราง password_resets
        reset = PasswordReset.query.filter_by(user_id=user.id).first()

    if reset is None or reset.expires_at < now():
        raise ApiError('OTP_EXPIRED', 'OTP expired, please request a new one')
    if reset.attempts >= current_app.config['OTP_MAX_ATTEMPTS']:
        raise ApiError('TOO_MANY_ATTEMPTS', 'Too many attempts, please request a new OTP')

    if reset.otp_hash != hash_text(str(body.get('otp') or '').strip()):
        # [U] UPDATE: แก้ค่า attempts ของแถวเดิม (+1) — แค่แก้ค่าแล้ว commit ไม่ต้องเขียน UPDATE เอง
        reset.attempts += 1
        db.session.commit()  # จำไว้ว่าผิดไปกี่ครั้ง (ต้อง commit ก่อนแจ้ง error ไม่งั้นจะถูกยกเลิก)
        raise ApiError('INVALID_OTP', 'Incorrect OTP')

    # OTP ถูก → ให้ resetToken ไปใช้ตั้งรหัสผ่านใหม่
    token = make_token()
    # [U] UPDATE: ใส่ค่าตีป่นของ resetToken ลงในแถว OTP เดิม
    reset.reset_token_hash = hash_text(token)
    db.session.commit()
    return jsonify({'resetToken': token})


@bp.post('/auth/password/reset')
def reset_password():
    body = json_body()

    password_error = get_password_error(body.get('newPassword'))
    if password_error:
        raise ApiError('WEAK_PASSWORD', password_error)

    reset = None
    if body.get('resetToken'):
        # [R] READ: หาแถว OTP ที่ resetToken ตรงกัน
        reset = PasswordReset.query.filter_by(reset_token_hash=hash_text(str(body['resetToken']))).first()
    if reset is None or reset.expires_at < now():
        raise ApiError('INVALID_RESET_TOKEN', 'Reset link expired, please start again')

    # [U] UPDATE: เปลี่ยนรหัสผ่าน (ตีป่นแล้ว) ในแถวของผู้ใช้คนนี้ (reset.user = แถวใน users ที่ผูกอยู่)
    reset.user.password_hash = hash_password(body['newPassword'])
    # [D] DELETE: ลบทุก session ของผู้ใช้ = เตะทุกอุปกรณ์ที่ล็อกอินค้างออก
    Session.query.filter_by(user_id=reset.user_id).delete()  # เตะทุกอุปกรณ์ที่ล็อกอินค้างออก
    db.session.delete(reset)  # ใช้แล้วทิ้ง ใช้ซ้ำไม่ได้
    db.session.commit()
    return jsonify({'ok': True})
