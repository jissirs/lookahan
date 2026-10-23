/**
 * ฟังก์ชันคำนวณ "ข้อมูลเชิงลึกของ AI" สำหรับหน้า Ai
 * ทุกฟังก์ชันเป็นฟังก์ชันล้วน (รับข้อมูล → คืนผลลัพธ์ ไม่แก้ข้อมูลเดิม) จึงทดสอบและอ่านง่าย
 *
 * แบ่งงาน: ผลพยากรณ์ (จำนวนออเดอร์รายชั่วโมง สัดส่วนประเภทเมนู) มาจาก AI (Groq) ผ่าน Backend
 *   ส่วนคำแนะนำ "ควรเติมวัตถุดิบอะไรเท่าไร" คำนวณที่นี่ด้วยโค้ด จากผลพยากรณ์นั้นเทียบกับ stock และสูตรเมนูจริง
 *   (ตัวเลขต้องแม่นและตรวจสอบได้ จึงไม่ให้ AI คิดเอง)
 *
 * สมมติฐานของการประเมินความต้องการวัตถุดิบ (ใส่ไว้ตรงนี้ให้เห็นชัด เพราะเป็นตัวแปรสำคัญ):
 *   - ออเดอร์พรุ่งนี้แบ่งตาม "สัดส่วนประเภทเมนู" ในผลพยากรณ์
 *   - ภายในประเภทเดียวกัน แบ่งให้ "เมนูที่เปิดขาย" เท่าๆ กัน
 *   - ออเดอร์ 1 รายการ = เมนู 1 จาน
 */
import { getMenuStatus } from './menuStatus.js'
import { getStockStatus, stepFor } from './stockStatus.js'

const pad = (n) => String(n).padStart(2, '0')

// "13:00" → "14:00" (บวกหนึ่งชั่วโมง ใช้หาเวลาสิ้นสุดของช่วง)
const addHour = (label) => `${pad(Number(label.slice(0, 2)) + 1)}:00`

// ปัดขึ้นให้เป็นพหุคูณของ step เช่น roundUp(23, 10) → 30
const roundUp = (value, step) => Math.ceil(value / step) * step

/**
 * ช่วงเวลาที่ลูกค้า "เยอะสุด" (ช่วงต่อเนื่อง 2 ชั่วโมงที่รวมออเดอร์มากสุด) และชั่วโมงที่ "น้อยสุด"
 * @param {{ hour: string, orders: number }[]} hourly  เรียงตามเวลา
 * @returns {{ peak: { start: string, end: string, orders: number }, low: { hour: string, orders: number } }}
 */
export function peakAndLow(hourly) {
  let peak = { start: hourly[0].hour, end: addHour(hourly[0].hour), orders: hourly[0].orders }
  for (let i = 0; i < hourly.length - 1; i++) {
    const orders = hourly[i].orders + hourly[i + 1].orders
    if (orders > peak.orders) peak = { start: hourly[i].hour, end: addHour(hourly[i + 1].hour), orders }
  }

  const low = hourly.reduce((min, h) => (h.orders < min.orders ? h : min))
  return { peak, low: { hour: low.hour, orders: low.orders } }
}

/**
 * เมนูหนึ่งทำได้อีกกี่จานจาก stock ที่เหลือ — ตัวที่ "หมดก่อน" คือคอขวด
 * @returns {{ portions: number, bottleneck: object | null } | null}  เมนูที่ไม่มีสูตรคืน null (คำนวณไม่ได้)
 */
export function menuCapacity(menu, ingredients) {
  if (menu.recipe.length === 0) return null

  let portions = Infinity
  let bottleneck = null
  for (const line of menu.recipe) {
    const ingredient = ingredients.find((i) => i.id === line.ingredientId)
    const possible = ingredient ? Math.floor(ingredient.quantity / line.qty) : 0
    if (possible < portions) {
      portions = possible
      bottleneck = ingredient ?? null
    }
  }

  return { portions, bottleneck }
}

/**
 * จำนวนจานที่คาดว่าจะขายพรุ่งนี้ของแต่ละเมนู (เฉพาะเมนูที่เปิดขาย) ตามสมมติฐานด้านบน
 * @returns {Map<string, number>}  menuId → จำนวนจาน (อาจเป็นทศนิยม)
 */
export function expectedPortions(menus, forecast) {
  const portions = new Map()

  for (const { category, share } of forecast.categories) {
    const sellable = menus.filter((m) => m.available && m.category === category)
    if (sellable.length === 0) continue

    const each = (forecast.orders * share) / sellable.length
    for (const menu of sellable) portions.set(menu.id, each)
  }

  return portions
}

/**
 * วัตถุดิบที่คาดว่าต้องใช้พรุ่งนี้ = ผลรวมของ (จานที่คาดว่าจะขาย × ปริมาณในสูตร) ของทุกเมนู
 * @returns {Map<string, { total: number, menus: Map<string, number> }>}
 *          ingredientId → ปริมาณรวม และปริมาณที่แต่ละเมนู (menuId) ใช้
 */
export function expectedDemand(menus, forecast) {
  const portions = expectedPortions(menus, forecast)
  const demand = new Map()

  for (const menu of menus) {
    const count = portions.get(menu.id) ?? 0
    for (const line of menu.recipe) {
      const entry = demand.get(line.ingredientId) ?? { total: 0, menus: new Map() }
      entry.total += count * line.qty
      entry.menus.set(menu.id, count * line.qty)
      demand.set(line.ingredientId, entry)
    }
  }

  return demand
}

/**
 * คำแนะนำให้เติมวัตถุดิบ: ตัวที่ "คาดว่าไม่พอใช้พรุ่งนี้" เรียงจากเร่งด่วนที่สุด
 *   หลักการ: เติม "เท่าที่ขาดพอดี" ไม่เติมเผื่อ เพื่อให้วัตถุดิบถูกใช้หมดในวันนั้น ของค้างคืนน้อยที่สุด
 *   suggested = ปริมาณที่ควรเติม (ปัดขึ้นเป็นพหุคูณของขั้นปุ่ม +/− ของหน่วยนั้น)
 *   priority  = 'high' ถ้าสถานะ stock ตอนนี้ Low/Critical หรือขาดมากกว่าที่มีอยู่ ไม่งั้น 'medium'
 * @param {number} [limit=6]  แสดงกี่รายการ
 * @returns {{ key: string, ingredient: object, demand: number, shortage: number, suggested: number,
 *             priority: 'high' | 'medium', usedBy: string[] }[]}
 */
export function buildRestockRecommendations({ ingredients, menus, forecast }, limit = 6) {
  // ผลพยากรณ์รุ่นใหม่มี "แผนความสด" ที่ Backend คำนวณไว้แล้ว (เติมเท่าที่ขาดพอดี ของไม่ค้างคืน)
  // ใช้ตัวเลขนั้นตรง ๆ เพื่อให้ตรงกับส่วน "ความสดของวัตถุดิบ" ในหน้า Ai — ไม่คำนวณซ้ำให้ตัวเลขสองชุดขัดกัน
  if (forecast.outlook) {
    return forecast.outlook.restock
      .map((row) => {
        const ingredient = ingredients.find((i) => i.id === row.id)
        if (!ingredient) return null // วัตถุดิบถูกลบไปแล้ว
        return {
          key: `restock-${row.id}`,
          ingredient,
          demand: row.expectedDemand,
          shortage: row.shortage,
          suggested: row.suggested,
          priority: row.priority,
          usedBy: row.menus,
        }
      })
      .filter(Boolean)
      .slice(0, limit)
  }

  // ผลพยากรณ์รุ่นเก่า (ไม่มีแผนความสด): คำนวณเองที่หน้าเว็บตามสมมติฐานด้านบน
  const demand = expectedDemand(menus, forecast)

  return ingredients
    .map((ingredient) => {
      const entry = demand.get(ingredient.id)
      const needed = entry ? Math.ceil(entry.total) : 0
      const shortage = needed - ingredient.quantity
      if (shortage <= 0) return null // พอใช้ ไม่ต้องแนะนำ

      // เมนูที่ใช้วัตถุดิบนี้มากที่สุด 3 อันดับ (ไว้บอกเหตุผล)
      const usedBy = [...entry.menus]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([menuId]) => menus.find((m) => m.id === menuId).name)

      const status = getStockStatus(ingredient)
      return {
        key: `restock-${ingredient.id}`,
        ingredient,
        demand: needed,
        shortage,
        suggested: roundUp(shortage, stepFor(ingredient.unit)),
        priority: status !== 'normal' || shortage > ingredient.quantity ? 'high' : 'medium',
        usedBy,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.priority === b.priority ? b.shortage / (b.ingredient.quantity + 1) - a.shortage / (a.ingredient.quantity + 1) : a.priority === 'high' ? -1 : 1))
    .slice(0, limit)
}

/**
 * เมนูที่ "ขายไม่ได้ตอนนี้เพราะวัตถุดิบไม่พอ" พร้อมวัตถุดิบที่ขาด
 * @returns {{ menu: object, missing: { ingredient: object, need: number }[] }[]}
 */
export function blockedMenus(menus, ingredients) {
  return menus
    .filter((menu) => getMenuStatus(menu, ingredients) === 'short')
    .map((menu) => ({
      menu,
      missing: menu.recipe
        .map((line) => ({ ingredient: ingredients.find((i) => i.id === line.ingredientId), need: line.qty }))
        .filter(({ ingredient, need }) => ingredient && ingredient.quantity < need),
    }))
}

/**
 * ข้อความสรุปจาก AI (ประโยคสั้นๆ ไว้อ่านเร็ว) — ประกอบจากตัวเลขจริงข้างต้น
 * @returns {string[]}
 */
export function buildSummary({ forecast, recommendations, blocked }) {
  const { peak, low } = peakAndLow(forecast.hourly)
  const topCategory = [...forecast.categories].sort((a, b) => b.share - a.share)[0]

  const lines = [
    `พรุ่งนี้คาดว่ามี ${forecast.orders} ออเดอร์ ลูกค้าเยอะสุดช่วง ${peak.start}–${peak.end} (${peak.orders} ออเดอร์) และเงียบสุดช่วง ${low.hour}`,
    `ประเภทที่คาดว่าขายดีที่สุดคือ ${topCategory.category} (${Math.round(topCategory.share * 100)}%) เมนูขายดีที่สุดคือ ${forecast.bestSeller}`,
  ]

  lines.push(
    recommendations.length > 0
      ? `มี ${recommendations.length} วัตถุดิบที่คาดว่าไม่พอรับออเดอร์พรุ่งนี้ — เร่งด่วนที่สุดคือ ${recommendations[0].ingredient.name}`
      : 'วัตถุดิบทุกตัวคาดว่าพอรับออเดอร์พรุ่งนี้',
  )

  if (blocked.length > 0) lines.push(`ตอนนี้มี ${blocked.length} เมนูที่ขายไม่ได้เพราะวัตถุดิบขาด`)

  return lines
}
