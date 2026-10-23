"""ระบบแจ้งเตือนในระบบ (กระดิ่งบนหน้าเว็บ)

หลักการ: เมื่อมี "เหตุการณ์สำคัญ" เกิดขึ้น ระบบจดไว้ 1 แถวในตาราง notifications ให้ทุกคนในสาขาเห็น
หน้าเว็บถามรายการนี้ทุก 30 วินาที (และทันทีหลังกดทำอะไรบางอย่าง) แล้วแสดงที่กระดิ่ง พร้อมตัวเลขที่ "ยังไม่ได้อ่าน"

เหตุการณ์ที่สร้างแจ้งเตือน (โค้ดที่สร้างอยู่ในไฟล์นั้น ๆ แต่เรียกใช้ฟังก์ชันในไฟล์นี้):
    วัตถุดิบ "ใกล้หมด" หรือ "วิกฤต"   routes/stock.py (เพิ่ม/ลด stock) และ routes/orders.py (สร้างออเดอร์ตัด stock)
    มีออเดอร์ใหม่ / พร้อมเสิร์ฟ / ถูกยกเลิก   routes/orders.py
    AI วิเคราะห์พรุ่งนี้เสร็จ          routes/ai.py

API ในไฟล์นี้:
    GET  /notifications           รายการล่าสุด 30 อัน + จำนวนที่ยังไม่ได้อ่านของ "ฉัน"
    POST /notifications/<id>/read อ่านอันเดียว
    POST /notifications/read-all  อ่านทั้งหมด

"อ่านแล้ว" เก็บแยกรายผู้ใช้ (ตาราง notification_reads) — คนหนึ่งกดอ่านแล้ว อีกคนในสาขาเดียวกันยังเห็นเป็นยังไม่อ่าน
"""
from datetime import timedelta

from flask import Blueprint, g, jsonify

from .. import db
from ..models import STATUS_RANK, Notification, NotificationRead, now, stock_status
from ..tools import find_mine

bp = Blueprint('notifications', __name__)

LIST_LIMIT = 30  # ส่งให้หน้าเว็บกี่อันล่าสุด
KEEP_DAYS = 30  # เก็บแจ้งเตือนไว้กี่วัน (เก่ากว่านี้ลบทิ้งตอนเปิดรายการ)

# ---------------------------------------------------------------- ฟังก์ชันสร้างแจ้งเตือน (ไฟล์อื่นเรียกใช้)

def add_notification(kind, level, title, message='', link=''):
    """สร้างแจ้งเตือน 1 อันให้สาขาของผู้ใช้ปัจจุบัน

    kind = ประเภท, level = ความสำคัญ ('info' น้ำเงิน | 'warn' เหลือง | 'danger' แดง)
    link = หน้าที่จะพาไปเมื่อกดที่แจ้งเตือน เช่น '/stock/12'
    หมายเหตุ: ฟังก์ชันนี้แค่ "วางลงถาด" ไม่ได้ commit — ฟังก์ชันที่เรียกจะ commit พร้อมงานของตัวเอง
    ถ้างานหลักล้มเหลว แจ้งเตือนก็ไม่ถูกสร้างตามไปด้วย (ไม่มีแจ้งเตือนเรื่องที่ไม่ได้เกิดขึ้นจริง)
    """
    # [C] CREATE: เพิ่มแถวใหม่ในตาราง notifications
    db.session.add(Notification(
        branch_id=g.branch_id, kind=kind, level=level, title=title, message=message, link=link,
    ))


def add_notification_once(kind, level, title, message='', link='', hours=24):
    """เหมือน add_notification แต่ "ไม่สร้างซ้ำ" ถ้าสาขานี้มีแจ้งเตือนหัวข้อเดียวกันภายใน `hours` ชั่วโมงที่ผ่านมา
    (ใช้กับแจ้งเตือนที่ AI สร้างตอนวิเคราะห์ซ้ำ ๆ เพื่อไม่ให้เรื่องเดิมเด้งซ้ำทุกครั้ง) คืน True ถ้าสร้างใหม่"""
    since = now() - timedelta(hours=hours)
    # [R] READ: มีแจ้งเตือนหัวข้อเดียวกันของสาขานี้ในช่วงเวลานี้แล้วไหม
    exists = Notification.query.filter(
        Notification.branch_id == g.branch_id, Notification.title == title, Notification.created_at >= since,
    ).first()
    if exists is not None:
        return False
    add_notification(kind, level, title, message, link)
    return True


def notify_stock_change(ingredient, old_quantity):
    """เรียกหลังเปลี่ยนจำนวนวัตถุดิบ: ถ้าสถานะ "แย่ลง" (ปกติ→ใกล้หมด, ใกล้หมด→วิกฤต) ให้สร้างแจ้งเตือน
    (แจ้งเฉพาะตอนข้ามเกณฑ์ ไม่แจ้งซ้ำทุกครั้งที่ลดของที่ใกล้หมดอยู่แล้ว)"""
    before = stock_status(old_quantity, ingredient.unit)
    after = stock_status(ingredient.quantity, ingredient.unit)
    if STATUS_RANK[after] <= STATUS_RANK[before]:
        return

    detail = '%s เหลือ %s %s' % (ingredient.name, ingredient.quantity, ingredient.unit)
    link = '/stock/%s' % ingredient.id
    if after == 'critical':
        add_notification('stock_critical', 'danger', 'วัตถุดิบวิกฤต: ' + ingredient.name, detail + ' — ควรเติมด่วน', link)
    else:
        add_notification('stock_low', 'warn', 'วัตถุดิบใกล้หมด: ' + ingredient.name, detail, link)


# ---------------------------------------------------------------- เส้นทาง

def my_read_ids():
    """คำค้นหา id ของแจ้งเตือนที่ "ฉัน" อ่านแล้ว (ใช้เป็นตัวกรองซ้อนในคำค้นอื่น)"""
    # [R] READ: เลือกเฉพาะคอลัมน์ notification_id ของแถวที่เป็นของผู้ใช้คนนี้
    return db.session.query(NotificationRead.notification_id).filter(NotificationRead.user_id == g.user.id)


def delete_old_notifications():
    """ลบแจ้งเตือนเก่ากว่า KEEP_DAYS วัน (ของสาขานี้) พร้อมบันทึก "อ่านแล้ว" ของมัน"""
    cutoff = now() - timedelta(days=KEEP_DAYS)
    old_ids = db.session.query(Notification.id).filter(Notification.branch_id == g.branch_id, Notification.created_at < cutoff)
    # [D] DELETE: ลบแถวลูก (notification_reads) ก่อน แล้วค่อยลบแถวแม่ (notifications)
    NotificationRead.query.filter(NotificationRead.notification_id.in_(old_ids)).delete(synchronize_session=False)
    Notification.query.filter(Notification.branch_id == g.branch_id, Notification.created_at < cutoff).delete(synchronize_session=False)
    db.session.commit()


@bp.get('/notifications')
def list_notifications():
    delete_old_notifications()

    # [R] READ: แจ้งเตือนล่าสุดของสาขานี้ (ใหม่ → เก่า) เอาแค่ LIST_LIMIT อัน
    items = (
        Notification.query.filter_by(branch_id=g.branch_id)
        .order_by(Notification.id.desc())
        .limit(LIST_LIMIT)
        .all()
    )

    # [R] READ: ในรายการนี้ อันไหนที่ฉันอ่านแล้ว
    read_ids = {row[0] for row in my_read_ids().filter(NotificationRead.notification_id.in_([n.id for n in items]))}

    # [R] READ: นับแจ้งเตือน "ทั้งสาขา" ที่ฉันยังไม่อ่าน (รวมที่เก่ากว่า 30 อันด้วย — ตัวเลขบนกระดิ่งจึงไม่ตกหล่น)
    unread = Notification.query.filter(
        Notification.branch_id == g.branch_id, ~Notification.id.in_(my_read_ids())
    ).count()

    return jsonify({
        'items': [item.to_json(read=item.id in read_ids) for item in items],
        'unread': unread,
    })


@bp.post('/notifications/<notification_id>/read')
def read_notification(notification_id):
    # [R] READ: ดึงแจ้งเตือนที่จะกดอ่าน (ต้องเป็นของสาขาตัวเอง)
    item = find_mine(Notification, notification_id, 'notification')

    # [R] READ: เคยกดอ่านไปแล้วไหม (กันบันทึกซ้ำ)
    already = NotificationRead.query.filter_by(notification_id=item.id, user_id=g.user.id).first()
    if already is None:
        # [C] CREATE: จด "ผู้ใช้คนนี้อ่านอันนี้แล้ว" 1 แถว
        db.session.add(NotificationRead(notification_id=item.id, user_id=g.user.id))
        db.session.commit()
    return jsonify(item.to_json(read=True))


@bp.post('/notifications/read-all')
def read_all_notifications():
    # [R] READ: แจ้งเตือนของสาขานี้ที่ฉันยังไม่อ่านทั้งหมด
    unread = Notification.query.filter(
        Notification.branch_id == g.branch_id, ~Notification.id.in_(my_read_ids())
    ).all()

    # [C] CREATE: จดว่าอ่านแล้วทีละอัน แล้ว commit ครั้งเดียว
    for item in unread:
        db.session.add(NotificationRead(notification_id=item.id, user_id=g.user.id))
    db.session.commit()
    return jsonify({'marked': len(unread)})
