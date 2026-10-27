/**
 * สถานะของเมนู (ใช้แสดงป้ายและกรองในหน้า Menu Management)
 *  - unavailable : เจ้าของร้านปิดขายเอง (สวิตช์ "สถานะการขาย")
 *  - short       : เปิดขายอยู่ แต่วัตถุดิบในสูตรบางตัวไม่พอทำ 1 จาน
 *  - ready       : เปิดขายและวัตถุดิบพอ
 *
 * @param {{ available: boolean, recipe: { ingredientId: string, qty: number }[] }} menu
 * @param {{ id: string, quantity: number }[]} ingredients วัตถุดิบทั้งหมดใน stock
 * @returns {'unavailable' | 'short' | 'ready'}
 */
export function getMenuStatus(menu, ingredients) {
  // ปิดขายเอง → ไม่ต้องดู stock
  if (!menu.available) return 'unavailable'

  // ทุกบรรทัดในสูตรต้องมีวัตถุดิบ "อยู่จริง" และเหลือพอต่อ 1 จาน
  // (เมนูที่ไม่มีสูตรเลย every() จะได้ true → ถือว่าพร้อมขาย เช่น เครื่องดื่ม)
  const hasEnough = menu.recipe.every((line) => {
    const ingredient = ingredients.find((i) => i.id === line.ingredientId)
    return ingredient && (ingredient.usableQuantity ?? ingredient.quantity) >= line.qty
  })

  return hasEnough ? 'ready' : 'short'
}

// ชื่อสถานะที่แสดงบนหน้าจอ
export const MENU_STATUS_LABEL = {
  ready: 'พร้อมขาย',
  short: 'วัตถุดิบไม่พอ',
  unavailable: 'ไม่พร้อมขาย',
}
