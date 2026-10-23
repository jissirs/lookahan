"""คำสั่งจัดการฐานข้อมูลที่รันจากเทอร์มินัล (ไม่มีข้อมูลตัวอย่าง — ฐานข้อมูลเริ่มต้นว่างเปล่า)

    flask --app wsgi check-db    ทดสอบการเชื่อมต่อฐานข้อมูล (อ่านอย่างเดียว ไม่แก้อะไร) — ทำก่อน init-db เสมอ
    flask --app wsgi init-db     สร้างตารางที่ยังไม่มี (ปลอดภัย: ไม่แตะข้อมูลที่มีอยู่)
    flask --app wsgi reset-db    ลบทุกตารางแล้วสร้างใหม่ = ข้อมูลหายหมด (ห้ามใช้บน production)

หลังสร้างตารางแล้ว ให้สมัครผู้ใช้คนแรกผ่านหน้า Register — ผู้สมัครคนแรกจะได้สาขาของตัวเอง
จากนั้นเพิ่มวัตถุดิบ เมนู และออเดอร์ผ่านหน้าเว็บตามปกติ
"""
import click
from flask import current_app
from sqlalchemy import text

from . import db
from .tools import ApiError, send_email


# ข้อความอธิบายสาเหตุที่พบบ่อยของการเชื่อมต่อ MySQL ไม่สำเร็จ (ดูจากข้อความ error ของไดรเวอร์)
CONNECTION_HINTS = [
    ('Access denied', 'ชื่อผู้ใช้หรือรหัสผ่านผิด (ถ้ารหัสผ่านมีอักขระพิเศษ เช่น @ / # ต้องแปลงเป็นรหัส URL: @ → %40, / → %2F, # → %23)'),
    ('Unknown database', 'ยังไม่มีฐานข้อมูลชื่อนี้ในเซิร์ฟเวอร์ — สร้างฐานข้อมูลเปล่าชื่อตามใน DATABASE_URL ก่อน'),
    ("Can't connect", 'ต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจโฮสต์/พอร์ต และอนุญาต IP ของเครื่องนี้ใน firewall ของผู้ให้บริการ'),
    ('timed out', 'เชื่อมต่อช้าเกินไป — ตรวจโฮสต์/พอร์ต อินเทอร์เน็ต และ firewall ของผู้ให้บริการ'),
    ('SSL', 'ปัญหา SSL — ผู้ให้บริการส่วนใหญ่บังคับ SSL: ตั้ง DB_SSL_CA เป็น path ของไฟล์ CA certificate ที่เขาให้ (ไฟล์ .pem)'),
    ('certificate', 'ปัญหา SSL — ตรวจว่า DB_SSL_CA ชี้ไฟล์ CA certificate ที่ถูกต้อง'),
]


# ข้อความอธิบายสาเหตุที่พบบ่อยของการส่งอีเมลไม่สำเร็จ (ดูจากชื่อ/ข้อความ error ของ smtplib)
MAIL_HINTS = [
    ('SMTPAuthenticationError', 'รหัสผ่านหรือบัญชีผิด — Gmail ต้องใช้ "รหัสผ่านแอป" (App Password 16 ตัว) ไม่ใช่รหัสผ่านปกติ และต้องเปิดการยืนยัน 2 ขั้นตอนก่อน'),
    ('SMTPSenderRefused', 'ผู้ส่งไม่ได้รับอนุญาต — SMTP_FROM ต้องตรงกับบัญชี SMTP_USER (Gmail ไม่ให้ปลอมผู้ส่ง)'),
    ('SMTPRecipientsRefused', 'ที่อยู่อีเมลผู้รับไม่ถูกต้องหรือถูกปฏิเสธ'),
    ('timed out', 'เชื่อมต่อช้าเกินไป — ตรวจ SMTP_HOST/SMTP_PORT อินเทอร์เน็ต และ firewall (บางเครือข่ายบล็อกพอร์ต 587/465)'),
    ('ConnectionRefused', 'ต่อเซิร์ฟเวอร์อีเมลไม่ได้ — ตรวจ SMTP_HOST และ SMTP_PORT'),
    ('gaierror', 'หา SMTP_HOST ไม่เจอ — ตรวจการสะกดชื่อโฮสต์'),
    ('wrong version number', 'ปัญหาการเข้ารหัส — พอร์ต 465 ใช้ SMTP_SECURITY=ssl ส่วนพอร์ต 587 ใช้ starttls'),
    ('SSL', 'ปัญหาการเข้ารหัส — พอร์ต 465 ใช้ SMTP_SECURITY=ssl ส่วนพอร์ต 587 ใช้ starttls'),
]


def register_commands(app):
    @app.cli.command('check-db')
    def check_db():
        """ทดสอบการเชื่อมต่อฐานข้อมูล (อ่านอย่างเดียว)"""
        # แสดงเฉพาะชนิดและโฮสต์ ไม่แสดงรหัสผ่าน
        url = db.engine.url
        click.echo('กำลังเชื่อมต่อ: %s @ %s' % (url.drivername, url.host or 'ไฟล์ในเครื่อง'))
        try:
            # [R] READ: ถามเวอร์ชันฐานข้อมูลด้วย SQL ตรง ๆ (text(...) = เขียน SQL เอง) เพื่อทดสอบว่าเชื่อมต่อได้ ไม่แก้ข้อมูลใด ๆ
            version = db.session.execute(text('SELECT VERSION()' if url.get_backend_name() == 'mysql' else 'SELECT sqlite_version()')).scalar()
        except Exception as error:
            message = str(error)
            hint = next((hint for word, hint in CONNECTION_HINTS if word.lower() in message.lower()), None)
            click.echo('เชื่อมต่อไม่สำเร็จ: ' + message.splitlines()[0][:200])
            if hint:
                click.echo('คำแนะนำ: ' + hint)
            raise SystemExit(1)

        click.echo('เชื่อมต่อสำเร็จ — เวอร์ชันฐานข้อมูล: %s' % version)
        if url.get_backend_name() == 'mysql':
            charset = db.session.execute(text('SELECT @@character_set_database')).scalar()
            click.echo('ชุดตัวอักษรของฐานข้อมูล: %s %s' % (charset, '(ok)' if charset.startswith('utf8') else '(ควรเป็น utf8mb4 เพื่อรองรับภาษาไทย)'))
            click.echo('หมายเหตุ: ระบบใช้กฎ CHECK ในตาราง ต้องใช้ MySQL 8.0.16 ขึ้นไป (หรือ MariaDB 10.2.1 ขึ้นไป)')

    @app.cli.command('test-email')
    @click.argument('to')
    def test_email(to):
        """ส่งอีเมลทดสอบไปที่ TO เพื่อเช็กว่าตั้งค่า SMTP ถูกไหม  เช่น: flask --app wsgi test-email me@gmail.com"""
        config = current_app.config
        if not config['MAIL_ENABLED']:
            if config['MAIL_INCOMPLETE']:
                missing = [name for name in ('SMTP_USER', 'SMTP_PASSWORD') if not config[name]]
                raise click.ClickException('ตั้งค่าอีเมลไม่ครบ ยังขาด: %s — เพิ่มในไฟล์ .env แล้วลองใหม่ (ดู README ข้อ "ตั้งค่าอีเมล")' % ', '.join(missing))
            raise click.ClickException('ยังไม่ได้ตั้งค่า SMTP_HOST ในไฟล์ .env — ดู README ข้อ "ตั้งค่าอีเมล"')
        # แสดงเฉพาะโฮสต์/พอร์ต/ผู้ส่ง ไม่แสดงรหัสผ่าน
        click.echo('กำลังส่งอีเมลทดสอบ: %s:%s (%s) ผู้ส่ง %s → %s' % (
            config['SMTP_HOST'], config['SMTP_PORT'], config['SMTP_SECURITY'], config['SMTP_FROM'], to))
        try:
            send_email(to, 'ทดสอบอีเมลจาก lookahan', 'ถ้าคุณอ่านข้อความนี้ได้ แปลว่าการตั้งค่าอีเมลของ Backend ถูกต้องแล้ว')
        except ApiError as error:
            cause = error.__cause__  # ปัญหาจริงจากเซิร์ฟเวอร์อีเมล (send_email เก็บไว้ให้)
            detail = type(cause).__name__ + ': ' + str(cause)
            click.echo('ส่งไม่สำเร็จ: ' + detail[:200])
            hint = next((hint for word, hint in MAIL_HINTS if word.lower() in detail.lower()), None)
            if hint:
                click.echo('คำแนะนำ: ' + hint)
            raise SystemExit(1)
        click.echo('ส่งสำเร็จ — ตรวจกล่องจดหมายของ %s (ถ้าไม่เห็นให้ดูโฟลเดอร์สแปม)' % to)

    @app.cli.command('init-db')
    def init_db():
        """สร้างตารางที่ยังไม่มี"""
        # create_all = CREATE TABLE: สร้างตารางตามคลาสใน models.py (เฉพาะที่ยังไม่มี) — เป็นการสร้าง "โครงตาราง" ไม่ใช่สร้างแถวข้อมูล
        db.create_all()
        click.echo('สร้างตารางเรียบร้อย')

    @app.cli.command('reset-db')
    @click.confirmation_option(prompt='ข้อมูลทั้งหมดจะหาย แน่ใจนะ?')
    def reset_db():
        """ลบทุกตารางแล้วสร้างใหม่ (ข้อมูลหายหมด)"""
        if current_app.config['IS_PRODUCTION']:
            raise click.ClickException('ห้ามใช้ reset-db บน production (จะลบข้อมูลจริงทั้งหมด)')
        # drop_all = DROP TABLE: ลบ "ทุกตาราง" รวมข้อมูลทุกแถวทิ้ง (อันตราย!) แล้ว create_all สร้างโครงใหม่ว่าง ๆ
        db.drop_all()
        db.create_all()
        click.echo('ล้างข้อมูลและสร้างตารางใหม่เรียบร้อย')
