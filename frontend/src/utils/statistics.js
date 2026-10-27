/**
 * ฟังก์ชันคำนวณสถิติสำหรับหน้า Statistics
 * ทุกฟังก์ชันเป็น "ฟังก์ชันล้วน" (รับข้อมูล → คืนผลลัพธ์ ไม่แก้ข้อมูลเดิม) จึงทดสอบและอ่านง่าย
 * ข้อมูลที่รับเข้ามามีรูปแบบตามที่อธิบายไว้ใน context/InventoryProvider.jsx
 */
import { INGREDIENT_CATEGORIES } from '../data/options.js'
import { getMenuStatus } from './menuStatus.js'
import { getStockStatus } from './stockStatus.js'

// วันที่แบบท้องถิ่น "2026-10-07" (ใช้จัดกลุ่มรายวัน — ไม่ใช้ slice ของ ISO เพราะ ISO เป็นเวลา UTC ทำให้ข้ามวันได้)
const dayKey = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * สรุป stock แยกตามหมวดวัตถุดิบ (เนื้อ / ผัก / ผลไม้ / อื่นๆ)
 * @returns {{ category: string, total: number, normal: number, low: number, critical: number, out_of_stock: number }[]}
 *          เรียงตามหมวดใน INGREDIENT_CATEGORIES (หมวดที่ไม่มีวัตถุดิบก็ยังแสดง total = 0)
 */
export function summarizeByCategory(ingredients) {
  return INGREDIENT_CATEGORIES.map((category) => {
    const summary = { category, total: 0, normal: 0, low: 0, critical: 0, out_of_stock: 0 }

    for (const item of ingredients) {
      if (item.category !== category) continue
      summary.total += 1
      summary[getStockStatus(item)] += 1 // นับแยกทั้ง 4 สถานะ
    }

    return summary
  })
}

/**
 * วัตถุดิบที่ถูกใช้ในสูตรของ "จำนวนเมนูมากที่สุด" (ใช้บอกว่าตัวไหนสำคัญต่อการขาย)
 * @param {number} [limit=5] เอากี่อันดับ
 * @returns {{ ingredient: object, menuCount: number }[]} เรียงจากมากไปน้อย (เท่ากันเรียงตามชื่อ)
 */
export function topUsedIngredients(ingredients, menus, limit = 5) {
  return ingredients
    .map((ingredient) => ({
      ingredient,
      menuCount: menus.filter((menu) => menu.recipe.some((line) => line.ingredientId === ingredient.id)).length,
    }))
    .filter((row) => row.menuCount > 0) // ตัดตัวที่ไม่มีเมนูไหนใช้
    .sort((a, b) => b.menuCount - a.menuCount || a.ingredient.name.localeCompare(b.ingredient.name))
    .slice(0, limit)
}

/**
 * การเคลื่อนไหว stock ล่าสุดของทุกวัตถุดิบ (ใหม่สุดก่อน) พร้อมชื่อและหน่วยของวัตถุดิบ
 * รายการที่หาวัตถุดิบไม่เจอ (เช่น ถูกลบไปแล้ว) จะถูกข้าม
 * @returns {{ id: string, date: string, name: string, unit: string, label: string, amount: number }[]}
 */
export function latestMovements(movements, ingredients, limit = 6) {
  return [...movements]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((movement) => {
      const ingredient = ingredients.find((i) => i.id === movement.ingredientId)
      return ingredient
        ? { id: movement.id, date: movement.date, name: ingredient.name, unit: ingredient.unit, label: movement.label, amount: movement.amount }
        : null
    })
    .filter(Boolean)
    .slice(0, limit)
}

/**
 * เปลี่ยนแปลงกี่เปอร์เซ็นต์จาก from ไป to (ปัดทศนิยม 1 ตำแหน่ง)
 * เช่น percentChange(125, 142) → 13.6   |  from เป็น 0 คืน null (คำนวณไม่ได้)
 */
export function percentChange(from, to) {
  if (!from) return null
  return Math.round(((to - from) / from) * 1000) / 10
}

// ====================================================================
//  ข้อมูลสำหรับกราฟ
// ====================================================================

/**
 * จำนวนครั้งที่ "เติมเข้า" และ "ใช้ออก" ต่อวัน (ใช้วาดกราฟแท่งซ้อน)
 *   เติมเข้า = รายการชนิด Add   |   ใช้ออก = ชนิดอื่นทั้งหมด (Order / Drop)
 * วันที่ไม่มีรายการก็ยังอยู่ในผล (เป็น 0) เพื่อให้แกนเวลาต่อเนื่อง และเอาไม่เกิน 14 วันล่าสุด
 * @returns {{ key: string, label: string, values: { add: number, out: number } }[]}  เรียงจากเก่าไปใหม่
 */
export function movementsPerDay(movements, maxDays = 14) {
  if (movements.length === 0) return []

  // นับต่อวัน
  const counts = new Map()
  for (const m of movements) {
    const key = dayKey(m.date)
    const entry = counts.get(key) ?? { add: 0, out: 0 }
    entry[m.type === 'Add' ? 'add' : 'out'] += 1
    counts.set(key, entry)
  }

  // ไล่ทุกวันตั้งแต่วันแรกถึงวันสุดท้าย (รวมวันที่ไม่มีรายการ)
  const keys = [...counts.keys()].sort()
  const days = []
  const cursor = new Date(`${keys[0]}T00:00:00`)
  const last = new Date(`${keys.at(-1)}T00:00:00`)
  while (cursor <= last) {
    const key = dayKey(cursor)
    days.push({
      key,
      label: `${key.slice(8, 10)}/${key.slice(5, 7)}`, // "07/10"
      values: counts.get(key) ?? { add: 0, out: 0 },
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return days.slice(-maxDays)
}

/**
 * ยอดคงเหลือของวัตถุดิบ 1 ตัวหลังการเคลื่อนไหวแต่ละครั้ง เรียงเก่า → ใหม่ (ใช้วาดกราฟเส้น)
 * @returns {{ time: number, value: number, label: string, amount: number }[]}  time = มิลลิวินาที
 */
export function balanceHistory(movements, ingredientId) {
  return movements
    .filter((m) => m.ingredientId === ingredientId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => ({ time: new Date(m.date).getTime(), value: m.balance, label: m.label, amount: m.amount }))
}

/**
 * วัตถุดิบที่มีประวัติการเคลื่อนไหวอย่างน้อย 1 รายการ (ใช้เป็นตัวเลือกของกราฟเส้น)
 * เรียงตามจำนวนรายการมากไปน้อย (เท่ากันเรียงตามชื่อ)
 */
export function ingredientsWithHistory(movements, ingredients) {
  return ingredients
    .map((ingredient) => ({
      ingredient,
      count: movements.filter((m) => m.ingredientId === ingredient.id).length,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.ingredient.name.localeCompare(b.ingredient.name))
    .map((row) => row.ingredient)
}

/**
 * นับเมนูตามสถานะ (พร้อมขาย / วัตถุดิบไม่พอ / ปิดขาย)
 * @returns {{ ready: number, short: number, unavailable: number }}
 */
export function menuStatusCounts(menus, ingredients) {
  const counts = { ready: 0, short: 0, unavailable: 0 }
  for (const menu of menus) counts[getMenuStatus(menu, ingredients)] += 1
  return counts
}
