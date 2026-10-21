/**
 * กฎเกี่ยวกับ "สถานะออเดอร์" — ใช้ร่วมกันทุกหน้าที่แสดงออเดอร์
 *
 * วงจรปกติ:  new (รอรับ) → cooking (กำลังทำ) → ready (พร้อมเสิร์ฟ) → done (เสร็จสิ้น)
 * ยกเลิกได้ทุกขั้นก่อนเสร็จสิ้น → cancelled (ระบบคืน stock ให้)
 * (ฝั่ง API ใน services/api.js บังคับลำดับนี้อีกชั้น — ที่นี่ใช้กำหนดข้อความและปุ่มบนหน้าจอ)
 */

// ชื่อสถานะที่แสดงบนหน้าจอ และข้อความปุ่ม "ไปขั้นถัดไป" ของแต่ละสถานะ (ไม่มี = ไม่มีปุ่ม)
export const ORDER_STATUS = {
  new: { label: 'รอรับ', nextLabel: 'รับออเดอร์' },
  cooking: { label: 'กำลังทำ', nextLabel: 'พร้อมเสิร์ฟ' },
  ready: { label: 'พร้อมเสิร์ฟ', nextLabel: 'เสร็จสิ้น' },
  done: { label: 'เสร็จสิ้น' },
  cancelled: { label: 'ยกเลิก' },
}

// ตัวเลือกของ dropdown ตัวกรองสถานะ: [{ value, label }]
export const ORDER_STATUS_OPTIONS = Object.entries(ORDER_STATUS).map(([value, { label }]) => ({ value, label }))

/** ออเดอร์ที่ "ยังดำเนินการอยู่" — ยังเลื่อนสถานะหรือยกเลิกได้ */
export const isOrderActive = (order) => order.status === 'new' || order.status === 'cooking' || order.status === 'ready'

/**
 * บอกว่าออเดอร์เกิดขึ้นมานานแค่ไหน เช่น "4 นาทีที่แล้ว", "2 ชม. ที่แล้ว", "07/10"
 * @param {string} iso  เวลาสร้างออเดอร์ (ISO)
 * @param {number} [now] เวลาปัจจุบัน (มิลลิวินาที) — กำหนดได้เพื่อทดสอบ
 */
export function timeAgo(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))

  if (minutes < 1) return 'เมื่อสักครู่'
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} ชม. ที่แล้ว`

  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
