/**
 * กราฟเส้นชุดเดียว (ยอดที่เปลี่ยนไปตามเวลา) วาดด้วย SVG
 *
 * ข้อกำหนดการวาด (ตามคู่มือกราฟ):
 *   - เส้นหนา 2px ปลายมน, พื้นที่ใต้เส้นเป็นสีเดียวกันจางๆ (~10%) ไม่เป็นก้อนทึบ
 *   - จุดข้อมูลกว้าง ≥ 8px มีวงสีพื้นหลัง 2px รอบจุด (กันจุดกลืนกับเส้น)
 *   - ใส่ตัวเลขเฉพาะ "จุดสุดท้าย" (ไม่ใส่ทุกจุด) ส่วนจุดอื่นดูที่ tooltip และมุมมองตาราง
 *   - เมาส์ชี้ → เส้นแนวตั้งเล็งไปที่จุดที่ใกล้ที่สุด + tooltip (ผู้ใช้ไม่ต้องเล็งจุดเล็กๆ ให้ตรง)
 *   - แกนค่าเริ่มที่ 0 เสมอ ไม่ตัดแกนให้ความแปรผันดูใหญ่เกินจริง
 *   - ชุดข้อมูลเดียว จึงไม่มี legend (หัวข้อของการ์ดบอกอยู่แล้วว่ากราฟอะไร)
 *
 * @param {{ time: number, value: number, label: string, amount: number }[]} points  เรียงเก่า → ใหม่ (time = มิลลิวินาที)
 * @param {string} color  สีเส้น เช่น 'var(--chart-series-1)'
 * @param {string} unit   หน่วยต่อท้ายตัวเลข เช่น "pcs"
 * @param {string} ariaLabel
 */
import { useState } from 'react'
import { useElementWidth } from '../../hooks/useElementWidth.js'
import { formatNumber, niceTicks } from './chartUtils.js'
import ChartTooltip from './ChartTooltip.jsx'

const PLOT_HEIGHT = 220
const MARGIN = { top: 20, right: 68, bottom: 30, left: 52 }
const MAX_MARKERS = 12 // จุดเยอะกว่านี้จะวาดเฉพาะจุดสุดท้าย (กันรก)
const DAY = 24 * 60 * 60 * 1000

const pad = (n) => String(n).padStart(2, '0')
const formatDay = (time) => {
  const d = new Date(time)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}
const formatDateTime = (time) => {
  const d = new Date(time)
  return `${formatDay(time)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const startOfDay = (time) => {
  const d = new Date(time)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function LineChart({ points, color, unit = '', ariaLabel }) {
  const [wrapRef, width] = useElementWidth() // ref ใส่กรอบกราฟ + ความกว้างจริงของกรอบ
  const [hoverIndex, setHoverIndex] = useState(null)

  const height = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom

  if (width === 0 || points.length === 0) return <div ref={wrapRef} className="chart-wrap" style={{ height }} />

  // ----- มาตราส่วน -----
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)

  // แกนเวลา: เริ่มที่เที่ยงคืนของวันแรก จบที่เที่ยงคืนหลังวันสุดท้าย (ให้ทุกวันเป็นช่องเต็ม)
  const domainStart = startOfDay(points[0].time)
  const domainEnd = startOfDay(points.at(-1).time) + DAY
  const xOf = (time) => MARGIN.left + ((time - domainStart) / (domainEnd - domainStart)) * plotWidth

  // แกนค่า: 0 ถึงค่าสูงสุดที่ปัดเป็นเลขกลม
  const yTicks = niceTicks(Math.max(...points.map((p) => p.value)))
  const yMax = yTicks.at(-1)
  const yOf = (value) => MARGIN.top + PLOT_HEIGHT - (value / yMax) * PLOT_HEIGHT

  // ป้ายวันที่บนแกนเวลา: ทุกเที่ยงคืน (เว้นให้ห่างกันถ้ากว้างไม่พอ ~70px ต่อป้าย)
  const dayCount = Math.round((domainEnd - domainStart) / DAY)
  const labelEvery = Math.max(1, Math.ceil(dayCount / Math.max(2, Math.floor(plotWidth / 70))))
  const dayTicks = Array.from({ length: dayCount }, (_, i) => domainStart + i * DAY).filter((_, i) => i % labelEvery === 0)

  // ----- เส้น พื้นที่ใต้เส้น และจุด -----
  const coords = points.map((p) => ({ x: xOf(p.time), y: yOf(p.value) }))
  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x} ${c.y}`).join('')
  const baseline = MARGIN.top + PLOT_HEIGHT
  const areaPath = `${linePath}L${coords.at(-1).x} ${baseline}L${coords[0].x} ${baseline}Z`

  // ----- โต้ตอบ -----
  // เมาส์: หาจุดที่ "ใกล้แนวนอนที่สุด" กับตำแหน่งเมาส์ (ไม่ต้องชี้โดนจุดพอดี)
  const handlePointerMove = (event) => {
    const box = event.currentTarget.closest('.chart-wrap').getBoundingClientRect()
    const pointerX = event.clientX - box.left
    let nearest = 0
    coords.forEach((c, i) => {
      if (Math.abs(c.x - pointerX) < Math.abs(coords[nearest].x - pointerX)) nearest = i
    })
    setHoverIndex(nearest)
  }

  const hovered = hoverIndex === null ? null : points[hoverIndex]
  const hoveredCoord = hoverIndex === null ? null : coords[hoverIndex]
  const last = points.at(-1)
  const lastCoord = coords.at(-1)

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg width={width} height={height} role="group" aria-label={ariaLabel}>
        {/* เส้นตารางและตัวเลขบนแกนค่า */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={yOf(tick)} y2={yOf(tick)} />
            <text className="chart-axis-text" x={MARGIN.left - 8} y={yOf(tick)} textAnchor="end" dominantBaseline="central">
              {formatNumber(tick)}
            </text>
          </g>
        ))}

        <line className="chart-baseline" x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={baseline} y2={baseline} />

        {/* ป้ายวันที่บนแกนเวลา */}
        {dayTicks.map((time) => (
          <text key={time} className="chart-axis-text" x={xOf(time)} y={baseline + 20} textAnchor="start">
            {formatDay(time)}
          </text>
        ))}

        {/* พื้นที่ใต้เส้น (จางๆ) และตัวเส้น */}
        <path d={areaPath} style={{ fill: color }} className="chart-area" />
        <path d={linePath} style={{ stroke: color }} className="chart-line" />

        {/* เส้นแนวตั้งเล็งจุดที่กำลังชี้ */}
        {hoveredCoord && (
          <line className="chart-crosshair" x1={hoveredCoord.x} x2={hoveredCoord.x} y1={MARGIN.top} y2={baseline} />
        )}

        {/* จุดข้อมูล (มีวงสีพื้นหลังรอบจุดผ่าน CSS) — จุดที่ชี้อยู่ใหญ่ขึ้น */}
        {coords.map((c, i) => {
          const isLast = i === coords.length - 1
          if (points.length > MAX_MARKERS && !isLast && hoverIndex !== i) return null
          return <circle key={points[i].time} className="chart-dot" cx={c.x} cy={c.y} r={hoverIndex === i ? 6 : 4.5} style={{ fill: color }} />
        })}

        {/* ตัวเลขที่จุดสุดท้าย (ยอดล่าสุด) */}
        <text className="chart-total-text" x={lastCoord.x + 12} y={lastCoord.y} dominantBaseline="central">
          {formatNumber(last.value)}
        </text>

        {/* พื้นที่รับเมาส์ครอบทั้งกราฟ */}
        <rect
          className="chart-overlay"
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotWidth}
          height={PLOT_HEIGHT}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        />

        {/* วงรับโฟกัสคีย์บอร์ดของแต่ละจุด (ใหญ่ 24px) — กด Tab เลื่อนไปทีละจุดแล้วเห็น tooltip เหมือนเมาส์ */}
        {coords.map((c, i) => (
          <circle
            key={points[i].time}
            className="chart-hit-dot"
            cx={c.x}
            cy={c.y}
            r={12}
            tabIndex={0}
            aria-label={`${formatDateTime(points[i].time)}: ${formatNumber(points[i].value)} ${unit}`}
            onFocus={() => setHoverIndex(i)}
            onBlur={() => setHoverIndex(null)}
          />
        ))}
      </svg>

      {hovered && (
        <ChartTooltip
          x={hoveredCoord.x}
          y={hoveredCoord.y}
          containerWidth={width}
          title={formatDateTime(hovered.time)}
          rows={[
            { label: 'ยอดคงเหลือ', value: `${formatNumber(hovered.value)} ${unit}`, color },
            { label: hovered.label, value: `${hovered.amount > 0 ? '+' : '-'}${formatNumber(Math.abs(hovered.amount))} ${unit}` },
          ]}
        />
      )}
    </div>
  )
}

export default LineChart
