/**
 * กล่องโต้ตอบ (popup) ที่ใช้ซ้ำทั้งแอป — ห่อ SweetAlert2 ไว้ที่เดียว
 * หน้าอื่นเรียกใช้ผ่านฟังก์ชันเหล่านี้ ไม่ต้องรู้รายละเอียดของไลบรารี
 *
 * ทุกฟังก์ชันที่ "ถามผู้ใช้" จะคืนค่า null (หรือ false) เมื่อกดยกเลิก
 * จึงตรวจแค่ `if (!ผลลัพธ์) return` ก็ปลอดภัย
 */
import Swal from 'sweetalert2'
import 'sweetalert2/dist/sweetalert2.min.css'
import './dialogs.css'

// ตั้งค่าที่ทุกกล่องใช้ร่วมกัน (คลาส app-swal ใช้ปรับสีปุ่มใน dialogs.css)
const base = {
  customClass: { popup: 'app-swal' },
  showCancelButton: true,
  cancelButtonText: 'ยกเลิก',
  reverseButtons: true,
}

// กัน HTML injection: ชื่อวัตถุดิบมาจากผู้ใช้ และเราต้องใส่ลงใน html ของกล่อง
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * ถามจำนวน (เลขจำนวนเต็ม)
 * @param {number} [min=1]   ค่าต่ำสุดที่ยอมรับ
 * @param {number} [max]     ค่าสูงสุด (เช่น ลดได้ไม่เกินที่เหลืออยู่)
 * @returns {Promise<number | null>} ตัวเลขที่กรอก หรือ null ถ้ายกเลิก
 */
export async function askNumber({ title, text, min = 1, max, value = 1, confirmText = 'ตกลง', unit = '' }) {
  const result = await Swal.fire({
    ...base,
    title,
    text,
    input: 'number',
    inputValue: value,
    inputAttributes: { min, ...(max !== undefined ? { max } : {}), step: 1 },
    inputLabel: unit ? `หน่วย: ${unit}` : undefined,
    confirmButtonText: confirmText,
    // ตรวจค่าก่อนปิดกล่อง — คืนข้อความ = แสดง error และไม่ปิด
    inputValidator: (v) => {
      const n = Number(v)
      if (!v || !Number.isFinite(n)) return 'กรุณากรอกจำนวน'
      if (n < min) return `จำนวนต้องไม่น้อยกว่า ${min}`
      if (max !== undefined && n > max) return `จำนวนต้องไม่เกิน ${max}`
      return undefined
    },
  })
  return result.isConfirmed ? Number(result.value) : null
}

/**
 * ถามข้อความ (เช่น เปลี่ยนชื่อ)
 * @returns {Promise<string | null>} ข้อความที่ตัดช่องว่างหัวท้ายแล้ว หรือ null ถ้ายกเลิก
 */
export async function askText({ title, value = '', placeholder = '', confirmText = 'บันทึก' }) {
  const result = await Swal.fire({
    ...base,
    title,
    input: 'text',
    inputValue: value,
    inputPlaceholder: placeholder,
    confirmButtonText: confirmText,
    inputValidator: (v) => (v && v.trim() ? undefined : 'กรุณากรอกข้อมูล'),
  })
  return result.isConfirmed ? result.value.trim() : null
}

/** ถามยืนยันก่อนทำสิ่งที่ย้อนกลับไม่ได้ (เช่น ลบ) — คืน true เมื่อกดยืนยัน */
export async function confirmAction({ title, text, confirmText = 'ยืนยัน' }) {
  const result = await Swal.fire({
    ...base,
    icon: 'warning',
    title,
    text,
    confirmButtonText: confirmText,
  })
  return result.isConfirmed
}

/**
 * เลือกวัตถุดิบ + จำนวน สำหรับใส่ในสูตรอาหาร
 * กล่องนี้มี 3 ปุ่ม จึงคืนค่าได้ 3 แบบ:
 *   - { ingredientId, qty } : กด "เพิ่ม"
 *   - { createNew: true }   : กด "สร้างวัตถุดิบใหม่" (ผู้เรียกพาไปหน้าสร้าง)
 *   - null                  : กดยกเลิก
 */
export async function pickIngredient({ ingredients, title = 'เพิ่มวัตถุดิบ', allowCreate = true }) {
  const options = ingredients
    .map((i) => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)} (${escapeHtml(i.category)}, ${i.quantity} ${escapeHtml(i.unit)})</option>`)
    .join('')

  const result = await Swal.fire({
    ...base,
    title,
    html: `
      <label class="app-swal-label" for="swal-ingredient">วัตถุดิบ</label>
      <select id="swal-ingredient" class="swal2-select app-swal-field">${options}</select>
      <label class="app-swal-label" for="swal-qty">จำนวนที่ใช้ต่อ 1 จาน</label>
      <input id="swal-qty" class="swal2-input app-swal-field" type="number" min="1" step="1" value="1" />
    `,
    focusConfirm: false,
    confirmButtonText: 'เพิ่ม',
    showDenyButton: allowCreate,
    denyButtonText: 'สร้างวัตถุดิบใหม่',
    // อ่านค่าจากฟอร์มที่เราสร้างเอง (Swal ไม่รู้จัก select+input คู่กัน)
    preConfirm: () => {
      const ingredientId = document.getElementById('swal-ingredient').value
      const qty = Number(document.getElementById('swal-qty').value)
      if (!ingredientId) {
        Swal.showValidationMessage('กรุณาเลือกวัตถุดิบ')
        return false // false = ไม่ปิดกล่อง
      }
      if (!Number.isFinite(qty) || qty < 1) {
        Swal.showValidationMessage('จำนวนต้องไม่น้อยกว่า 1')
        return false
      }
      return { ingredientId, qty }
    },
  })

  if (result.isConfirmed) return result.value
  if (result.isDenied) return { createNew: true }
  return null
}

/**
 * ถามความเห็นต่อคำแนะนำของ AI หลังผู้ใช้นำไปใช้ — มี 3 ปุ่ม
 * @returns {Promise<true | false | null>}  true = มีประโยชน์, false = ยังไม่ใช่, null = ข้าม/ปิดกล่อง
 */
export async function askFeedback({ title, text }) {
  const result = await Swal.fire({
    customClass: { popup: 'app-swal' },
    icon: 'question',
    title,
    text,
    showDenyButton: true,
    showCancelButton: true,
    confirmButtonText: '👍 มีประโยชน์',
    denyButtonText: '👎 ยังไม่ใช่',
    cancelButtonText: 'ข้าม',
    reverseButtons: true,
  })

  if (result.isConfirmed) return true
  if (result.isDenied) return false
  return null
}

/** แจ้งข้อความสั้นๆ (ปุ่มเดียว) */
export function notify({ icon = 'success', title, text }) {
  return Swal.fire({ customClass: { popup: 'app-swal' }, icon, title, text, confirmButtonText: 'ตกลง' })
}
