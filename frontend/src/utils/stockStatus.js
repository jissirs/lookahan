/**
 * กฎเกี่ยวกับ "สถานะ stock" ของวัตถุดิบ
 * ทุกหน้าที่แสดงสถานะ (Normal / Low / Critical) ต้องใช้ฟังก์ชันในไฟล์นี้
 * เพื่อให้เกณฑ์ตรงกันทั้งแอป — ถ้าจะเปลี่ยนเกณฑ์ ให้แก้ที่นี่ที่เดียว
 */

// ---------- เกณฑ์สถานะ ----------
// จำนวนคงเหลือ "ต่ำกว่าหรือเท่ากับ" ค่านี้ ถือว่า Critical / Low (คิดจากหน่วย pcs)
export const CRITICAL_AT = 1
export const LOW_AT = 2

// หน่วยอื่น (g, ml) ตัวเลขจะใหญ่กว่า pcs มาก จึงคูณเกณฑ์ด้วยตัวคูณนี้
// เช่น หน่วย g: Low เมื่อ ≤ 200 และ Critical เมื่อ ≤ 100 (ข้าว 1500 g จึงยังปกติ)
const UNIT_SCALE = { pcs: 1, g: 100, ml: 100 }
const scaleOf = (unit) => UNIT_SCALE[unit] ?? 1

// ชื่อสถานะที่แสดงบนหน้าจอ
export const STATUS_LABEL = {
  normal: 'Normal',
  low: 'Low',
  critical: 'Critical',
}

/**
 * คำนวณสถานะจากจำนวนคงเหลือ
 * @param {{ quantity: number, unit: string }} item วัตถุดิบ
 * @returns {'normal' | 'low' | 'critical'}
 */
export function getStockStatus(item) {
  const scale = scaleOf(item.unit)
  if (item.quantity <= CRITICAL_AT * scale) return 'critical'
  if (item.quantity <= LOW_AT * scale) return 'low'
  return 'normal'
}

/** จำนวนที่ปุ่ม + / − ของ "จำนวนวัตถุดิบ" เปลี่ยนต่อการกด 1 ครั้ง (g/ml เปลี่ยนทีละ 10) */
export function stepFor(unit) {
  return unit === 'pcs' ? 1 : 10
}

/**
 * ประมาณจำนวนที่ "ควรมี" ของวัตถุดิบ (ใช้แสดง Required ≈ ในหน้า Low stock)
 * ตอนนี้เป็นตัวแทนชั่วคราว: นับปริมาณที่ทุกเมนูใช้ แล้วคูณ 3 (สมมติขายเมนูละ 3 จาน)
 * TODO: เปลี่ยนเป็นค่าจาก AI forecast เมื่อมี backend
 */
export function estimateRequired(item, menus) {
  // รวมปริมาณวัตถุดิบนี้ที่ทุกเมนูใช้ต่อ 1 จาน
  const usagePerPortion = menus.reduce((sum, menu) => {
    const line = menu.recipe.find((r) => r.ingredientId === item.id)
    return sum + (line ? line.qty : 0)
  }, 0)

  // อย่างน้อยต้องสูงกว่าเกณฑ์ Low เพื่อให้ไม่ตกสถานะซ้ำทันทีหลังเติม
  const minimum = (LOW_AT + 1) * scaleOf(item.unit)
  return Math.max(minimum, usagePerPortion * 3)
}
