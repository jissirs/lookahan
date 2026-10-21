/**
 * ฟังก์ชันช่วยวาดกราฟ (ใช้ร่วมกันทั้ง BarChart และ LineChart)
 */

/**
 * ค่าบนแกนที่ "กลมๆ" เช่น 0 / 2 / 4 / 6  หรือ 0 / 1,000 / 2,000
 * ใช้เป็นเส้นตารางและตัวเลขบนแกน — เส้นสุดท้ายคือค่าสูงสุดของแกน (ไม่ต่ำกว่า max)
 *
 * @param {number} max     ค่าสูงสุดของข้อมูล
 * @param {number} [target=4]  จำนวนช่วงที่ต้องการโดยประมาณ
 * @returns {number[]} เช่น nice(7) → [0, 2, 4, 6, 8]
 */
export function niceTicks(max, target = 4) {
  if (!(max > 0)) return [0, 1]

  // หาขนาดช่วง (step) ที่เป็นเลขกลม: 1, 2, 2.5, 5 หรือ 10 เท่าของกำลังสิบ
  const rough = max / target
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)

  const ticks = []
  for (let value = 0; value < max + step; value += step) {
    ticks.push(Math.round(value * 1e6) / 1e6) // ปัดเศษทศนิยมที่เกิดจากการบวกทีละช่วง
    if (value >= max) break
  }
  return ticks
}

/** ตัวเลขคั่นหลักพัน เช่น 1500 → "1,500" */
export const formatNumber = (value) => value.toLocaleString('en-US')

/**
 * เส้นขอบของแท่งกราฟ 1 ช่วง โดย "ปลายข้อมูล" มนมุมรัศมี 4px ส่วนด้านฐาน (baseline) เหลี่ยม
 *  - แนวนอน : แท่งโตจากซ้ายไปขวา ปลายคือด้านขวา
 *  - แนวตั้ง : แท่งโตจากล่างขึ้นบน ปลายคือด้านบน
 * ช่วงที่ไม่ใช่ปลายสุดของแท่งซ้อน (rounded = false) จะเป็นสี่เหลี่ยมธรรมดา
 */
export function barPath({ x, y, width, height, horizontal, rounded }) {
  const r = Math.min(4, width, height / 2)

  if (!rounded || r <= 0) {
    return `M${x} ${y}h${width}v${height}h${-width}Z`
  }

  if (horizontal) {
    return (
      `M${x} ${y}H${x + width - r}A${r} ${r} 0 0 1 ${x + width} ${y + r}` +
      `V${y + height - r}A${r} ${r} 0 0 1 ${x + width - r} ${y + height}H${x}Z`
    )
  }

  return (
    `M${x} ${y + height}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}` +
    `H${x + width - r}A${r} ${r} 0 0 1 ${x + width} ${y + r}V${y + height}Z`
  )
}
