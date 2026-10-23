"""AI ของร้าน (ใช้ Groq) — เส้นทางของ API

    POST /ai/forecast         ให้ AI วิเคราะห์ร้าน "พรุ่งนี้และ 7 วันข้างหน้า" แล้วบันทึกผลไว้
                              (หน้า Dashboard / Statistics / Ai อ่านผลนี้ผ่าน GET /dashboard/summary)
    GET  /ai/accuracy         ความแม่นของ AI: ผลพยากรณ์ย้อนหลังเทียบกับยอดจริง + เทียบกับสถิติธรรมดา
    PUT  /ai/feedback/<key>   บอกว่าคำแนะนำข้อ <key> "มีประโยชน์" (true) หรือ "ไม่มีประโยชน์" (false)
    GET  /ai/feedback         ความเห็นที่เคยให้ไว้ทั้งหมด เช่น {"restock-ing-shrimp": true}

หน้าที่ของ AI 8 ข้อ และการแบ่งงานกับโค้ด อธิบายไว้ที่ต้นไฟล์ forecast.py — สรุปสั้น ๆ:
    AI   = คาดการณ์ + เลือกเรื่องที่ควรเตือน + เขียนข้อความเป็นภาษาคน
    โค้ด = เตรียมข้อมูล ทำเลขทั้งหมด และ "ตรวจคำตอบของ AI" ก่อนใช้เสมอ (ห้ามเชื่อโดยไม่ตรวจ)

ไฟล์นี้รวมตัวเรียก Groq (ask_groq) ไว้ด้วย — ข้อความสั่ง AI (system prompt) อยู่ที่ prompts.py
"""
import json
from datetime import timedelta

import requests
from flask import Blueprint, current_app, g, jsonify

from .. import db
from ..forecast import accuracy_report, clean_forecast, collect_history, local_today
from ..models import AiFeedback, Forecast, ForecastHistory, now
from ..prompts import FORECAST_SYSTEM_PROMPT
from ..tools import ApiError, is_blank, json_body
from .notifications import add_notification, add_notification_once

bp = Blueprint('ai', __name__)


# ---------------------------------------------------------------- เส้นทาง

@bp.post('/ai/forecast')
def create_forecast():
    history = collect_history()
    answer = ask_groq(FORECAST_SYSTEM_PROMPT, 'ข้อมูลร้านของฉัน (JSON):\n' + json.dumps(history, ensure_ascii=False))
    payload = clean_forecast(answer, history)

    # บันทึกทับผลเก่า (สาขาละ 1 แถว) — หน้า Dashboard จะเห็นผลใหม่ทันที
    # รูปแบบ "มีแล้วแก้ ไม่มีก็สร้าง" (เรียกว่า upsert = update + insert) ใช้บ่อยมาก
    # [R] READ: เคยมีผลพยากรณ์ของสาขานี้ไหม
    forecast = Forecast.query.filter_by(branch_id=g.branch_id).first()
    if forecast is None:
        # [C] CREATE: ยังไม่เคยมี → เพิ่มแถวใหม่
        forecast = Forecast(branch_id=g.branch_id, payload=payload)
        db.session.add(forecast)
    else:
        # [U] UPDATE: เคยมีแล้ว → แก้ค่าในแถวเดิม
        forecast.payload = payload
        forecast.generated_at = now()

    # เก็บผลพยากรณ์ของ "พรุ่งนี้" ไว้ในประวัติ เพื่อเทียบกับยอดจริงเมื่อวันนั้นผ่านไป (วัดความแม่นของ AI)
    # รูปแบบ upsert เหมือนด้านบน: วันนั้นเคยพยากรณ์แล้วทับของเดิม ไม่เคยก็สร้างใหม่
    tomorrow = local_today() + timedelta(days=1)
    # [R] READ: เคยเก็บผลพยากรณ์ของวันพรุ่งนี้ไว้แล้วไหม
    record = ForecastHistory.query.filter_by(branch_id=g.branch_id, target_date=tomorrow).first()
    if record is None:
        # [C] CREATE: ยังไม่เคย → เพิ่มแถวใหม่
        record = ForecastHistory(branch_id=g.branch_id, target_date=tomorrow)
        db.session.add(record)
    # [U] UPDATE: ใส่/ทับค่าพยากรณ์ (ยอดจริงเว้นว่างไว้ เติมทีหลังเมื่อวันผ่านไป)
    record.orders = payload['orders']
    record.revenue = payload['revenue']
    record.baseline_orders = history['baselineOrders']
    record.planned_leftover_value = payload['outlook']['leftoverValue']
    record.generated_at = now()

    # [C] แจ้งทุกคนในสาขาว่า AI วิเคราะห์เสร็จแล้ว (บันทึกพร้อมผลพยากรณ์ในครั้งเดียว)
    add_notification('ai_forecast', 'info', 'AI วิเคราะห์พรุ่งนี้เสร็จแล้ว',
                     'คาดว่าจะมี %s ออเดอร์ รายได้ประมาณ ฿%s ช่วงเยอะสุด %s–%s' % (
                         payload['orders'], payload['revenue'], payload['peakStart'], payload['peakEnd']), '/ai')

    # [C] การแจ้งเตือนที่ AI เสนอ (ผ่านการตรวจกับ stock จริงแล้วใน forecast.py) → สร้างเป็นแจ้งเตือนที่กระดิ่ง
    # ใช้ "ครั้งเดียวต่อ 24 ชั่วโมง" ต่อเรื่อง กันเรื่องเดิมเด้งซ้ำทุกครั้งที่ AI วิเคราะห์
    # (ใช้ประเภท stock_low/stock_critical ที่มีอยู่แล้ว — ข้อความขึ้นต้นด้วย "AI เตือน:" ให้ผู้ใช้แยกออก)
    for alert in payload['alerts']:
        kind = 'stock_critical' if alert['level'] == 'danger' else 'stock_low'
        add_notification_once(kind, alert['level'], alert['title'], '%s (%s)' % (alert['message'], alert['detail']), alert['link'])

    db.session.commit()
    return jsonify(payload)


@bp.get('/ai/accuracy')
def get_accuracy():
    items, summary = accuracy_report(30)
    db.session.commit()  # accuracy_report เติมยอดจริงให้วันที่ผ่านไปแล้ว (แก้ค่าในถาด) ต้อง commit
    return jsonify({'days': items, 'summary': summary})


@bp.put('/ai/feedback/<key>')
def send_feedback(key):
    helpful = json_body().get('helpful')
    if is_blank(key) or not isinstance(helpful, bool):
        raise ApiError('VALIDATION', 'ข้อมูลความเห็นไม่ถูกต้อง')

    # เคยให้ความเห็นข้อนี้แล้วไหม? ถ้าเคย → แก้ของเดิม ถ้าไม่เคย → สร้างใหม่ (upsert เหมือนผลพยากรณ์ด้านบน)
    # [R] READ: หาความเห็นเดิมของคำแนะนำข้อนี้
    feedback = AiFeedback.query.filter_by(branch_id=g.branch_id, key=key).first()
    if feedback is None:
        # [C] CREATE: ยังไม่เคยให้ความเห็น → เพิ่มแถวใหม่
        feedback = AiFeedback(branch_id=g.branch_id, key=key, helpful=helpful)
        db.session.add(feedback)
    else:
        # [U] UPDATE: เคยให้แล้ว → แก้ค่า helpful ในแถวเดิม
        feedback.helpful = helpful

    db.session.commit()
    return jsonify({'id': key, 'helpful': helpful})


@bp.get('/ai/feedback')
def list_feedback():
    result = {}
    # [R] READ: ความเห็นทุกแถวของสาขานี้
    for feedback in AiFeedback.query.filter_by(branch_id=g.branch_id).all():
        result[feedback.key] = feedback.helpful
    return jsonify(result)


# =====================================================================
#  ตัวเรียก Groq
#  ทำไมเรียกจาก Backend: API key เป็นความลับ ถ้าใส่ในโค้ดหน้าเว็บ ใครเปิดเบราว์เซอร์ก็ขโมยได้
#  key เก็บในไฟล์ .env ของ Backend (ตัวแปร GROQ_API_KEY) ซึ่งไม่ขึ้น git
# =====================================================================
GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'


def ask_groq(system_prompt, user_prompt):
    """ถาม Groq แล้วคืนคำตอบเป็น dict

    system_prompt = บอก AI ว่ามีบทบาทอะไร ต้องตอบรูปแบบไหน
    user_prompt   = ข้อมูลและคำถามจริง
    @raises AI_NOT_CONFIGURED (ยังไม่ได้ใส่ key), AI_ERROR (Groq ตอบผิดพลาด/ตอบรูปแบบไม่ถูก/ช้าเกินไป)
    """
    api_key = current_app.config['GROQ_API_KEY']
    if not api_key:
        raise ApiError('AI_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่า GROQ_API_KEY ในไฟล์ .env ของ Backend')

    try:
        response = requests.post(
            GROQ_URL,
            headers={'Authorization': 'Bearer ' + api_key},
            json={
                'model': current_app.config['GROQ_MODEL'],
                'temperature': 0.3,  # ต่ำ = ตอบนิ่ง ไม่มั่ว
                'response_format': {'type': 'json_object'},  # บังคับให้ตอบเป็น JSON
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt},
                ],
            },
            timeout=30,  # รอได้ไม่เกิน 30 วินาที
        )
    except requests.RequestException:
        raise ApiError('AI_ERROR', 'เชื่อมต่อ Groq ไม่ได้ หรือรอนานเกินไป')

    if response.status_code == 401:
        raise ApiError('AI_ERROR', 'Groq ปฏิเสธ API key (ตรวจ GROQ_API_KEY ในไฟล์ .env)')
    if response.status_code == 429:
        raise ApiError('AI_ERROR', 'เรียก Groq ถี่เกินกำหนด กรุณารอสักครู่แล้วลองใหม่')
    if response.status_code != 200:
        raise ApiError('AI_ERROR', 'Groq ตอบผิดพลาด (%s)' % response.status_code)

    try:
        return json.loads(response.json()['choices'][0]['message']['content'])
    except (KeyError, IndexError, ValueError):
        raise ApiError('AI_ERROR', 'Groq ตอบกลับในรูปแบบที่อ่านไม่ได้')
