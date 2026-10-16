/**
 * กล่อง tooltip ของกราฟ — วางทับกราฟตามตำแหน่งเมาส์/โฟกัส
 * (ข้อมูลทุกอย่างในกล่องนี้ดูได้จากปุ่ม "ตาราง" ด้วย tooltip จึงเป็นส่วนเสริม ไม่ใช่ช่องทางเดียว)
 *
 * @param {number} x  ตำแหน่งแนวนอน (px) เทียบกับกรอบกราฟ
 * @param {number} y  ตำแหน่งแนวตั้ง (px) เทียบกับกรอบกราฟ
 * @param {number} containerWidth  ความกว้างกรอบกราฟ — ใช้พลิกกล่องไปอีกฝั่งเมื่อชิดขอบขวา
 * @param {string} title  หัวข้อ เช่น "ผัก" หรือ "07/10 14:20"
 * @param {{ label: string, value: string, color?: string }[]} rows  แถวข้อมูล (ค่าเด่น ชื่อรอง)
 *        color = สีของเส้นสั้นหน้าชื่อ (ไว้บอกว่าเป็นชุดข้อมูลไหน)
 */
function ChartTooltip({ x, y, containerWidth, title, rows }) {
  // ใกล้ขอบขวามากกว่าครึ่ง → ให้กล่องอยู่ทางซ้ายของจุดชี้แทน
  const flip = x > containerWidth * 0.6

  return (
    <div
      className={`chart-tooltip${flip ? ' is-flipped' : ''}`}
      style={{ left: x, top: y }}
      role="status"
    >
      <p className="chart-tooltip-title">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="chart-tooltip-row">
          {/* เส้นสั้นสีของชุดข้อมูล (ไม่ใช้กล่องสี) */}
          {row.color && <span className="chart-tooltip-key" style={{ background: row.color }} />}
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </p>
      ))}
    </div>
  )
}

export default ChartTooltip
