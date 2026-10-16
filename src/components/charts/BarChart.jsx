/**
 * กราฟแท่ง (ซ้อนได้) วาดด้วย SVG — ใช้ได้ทั้งแนวนอนและแนวตั้ง
 *   แนวนอน  เหมาะกับหมวดที่ชื่อยาว/มีหลายแท่ง (เช่น stock ตามหมวด)
 *   แนวตั้ง  เหมาะกับแกนเวลา (เช่น จำนวนครั้งต่อวัน)
 *
 * ข้อกำหนดการวาด (ตามคู่มือกราฟ):
 *   - แท่งหนาไม่เกิน 24px ปลายข้อมูลมนรัศมี 4px ด้านฐานเหลี่ยม โตจากเส้นฐานเดียว
 *   - ช่วงสีที่ซ้อนกันคั่นด้วยช่องว่าง 2px (ไม่วาดขอบ)
 *   - เส้นตาราง/แกน เป็นเส้นบางเรียบ ไม่เด่นกว่าข้อมูล
 *   - ตัวเลขรวมวางที่ปลายแท่ง (เฉพาะรวม ไม่ใส่ตัวเลขทุกช่วง) ส่วนค่าอื่นดูได้ที่ tooltip และมุมมองตาราง
 *   - เมาส์/คีย์บอร์ดโฟกัสที่แท่ง → tooltip แสดงทุกชุดข้อมูลของแท่งนั้น
 *
 * @param {{ id: string, label: string, title?: string, values: Record<string, number> }[]} data  1 รายการ = 1 แท่ง
 *        label = ชื่อสั้นบนแกน, title = ชื่อเต็มใน tooltip/โปรแกรมอ่านหน้าจอ (ไม่ใส่ = ใช้ label)
 * @param {{ key: string, label: string, color: string }[]} series  ชุดข้อมูลที่ซ้อนกัน เรียงจากฐานไปปลาย
 *        color = ค่าสีหรือ CSS variable เช่น 'var(--chart-series-1)'
 * @param {'horizontal' | 'vertical'} [orientation]
 * @param {string} ariaLabel  คำอธิบายกราฟสำหรับโปรแกรมอ่านหน้าจอ
 * @param {string} [unit]  หน่วยต่อท้ายตัวเลขใน tooltip เช่น "รายการ"
 * @param {number} [labelWidth]  ความกว้าง (px) ที่เผื่อให้ชื่อแท่งแนวนอนด้านซ้าย — ชื่อยาว (เช่น ชื่อเมนูภาษาไทย) ให้เพิ่มค่านี้
 */
import { useState } from 'react'
import { useElementWidth } from '../../hooks/useElementWidth.js'
import { barPath, formatNumber, niceTicks } from './chartUtils.js'
import ChartTooltip from './ChartTooltip.jsx'

const GAP = 2 // ช่องว่างระหว่างช่วงสีที่ซ้อนกัน (px)
const MAX_THICKNESS = 24 // ความหนาแท่งสูงสุด (px)
const ROW_HEIGHT = 44 // ความสูงต่อแท่ง (แนวนอน)
const COLUMN_PLOT_HEIGHT = 200 // ความสูงพื้นที่กราฟ (แนวตั้ง)

function BarChart({ data, series, orientation = 'horizontal', ariaLabel, unit = '', labelWidth = 92 }) {
  const [wrapRef, width] = useElementWidth() // ref ใส่กรอบกราฟ + ความกว้างจริงของกรอบ
  const [hover, setHover] = useState(null) // { index, x, y } ของแท่งที่ชี้อยู่

  const horizontal = orientation === 'horizontal'

  // ขอบรอบพื้นที่กราฟ เผื่อที่ให้ชื่อหมวด ตัวเลขแกน และตัวเลขรวมที่ปลายแท่ง
  const margin = horizontal
    ? { top: 8, right: 40, bottom: 28, left: labelWidth }
    : { top: 22, right: 12, bottom: 30, left: 40 }

  // ----- มาตราส่วน -----
  const totals = data.map((d) => series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0))
  const ticks = niceTicks(Math.max(...totals, 0))
  const domainMax = ticks.at(-1)

  const plotWidth = Math.max(0, width - margin.left - margin.right)
  const plotHeight = horizontal ? data.length * ROW_HEIGHT : COLUMN_PLOT_HEIGHT
  const height = margin.top + plotHeight + margin.bottom

  // band = พื้นที่ของ 1 แท่งตามแกนรอง, thickness = ความหนาแท่งจริง (เหลือที่ว่างรอบแท่ง)
  const band = (horizontal ? plotHeight : plotWidth) / data.length
  const thickness = Math.min(MAX_THICKNESS, band * 0.5)

  // ค่า → ความยาวบนแกนหลัก (px)
  const lengthOf = (value) => (value / domainMax) * (horizontal ? plotWidth : plotHeight)

  // ----- tooltip -----
  const showTooltip = (index, x, y) => setHover({ index, x, y })

  // เมาส์: ใช้ตำแหน่งของเมาส์เทียบกับกรอบกราฟ
  const handlePointerMove = (event, index) => {
    const box = event.currentTarget.closest('.chart-wrap').getBoundingClientRect()
    showTooltip(index, event.clientX - box.left, event.clientY - box.top)
  }

  const hovered = hover ? data[hover.index] : null

  if (width === 0) return <div ref={wrapRef} className="chart-wrap" style={{ height }} />

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg width={width} height={height} role="group" aria-label={ariaLabel}>
        {/* ----- เส้นตารางและตัวเลขบนแกนค่า ----- */}
        {ticks.map((tick) => {
          const offset = lengthOf(tick)
          return horizontal ? (
            <g key={tick}>
              <line className="chart-grid" x1={margin.left + offset} x2={margin.left + offset} y1={margin.top} y2={margin.top + plotHeight} />
              <text className="chart-axis-text" x={margin.left + offset} y={margin.top + plotHeight + 18} textAnchor="middle">
                {formatNumber(tick)}
              </text>
            </g>
          ) : (
            <g key={tick}>
              <line className="chart-grid" x1={margin.left} x2={margin.left + plotWidth} y1={margin.top + plotHeight - offset} y2={margin.top + plotHeight - offset} />
              <text className="chart-axis-text" x={margin.left - 8} y={margin.top + plotHeight - offset} textAnchor="end" dominantBaseline="central">
                {formatNumber(tick)}
              </text>
            </g>
          )
        })}

        {/* เส้นฐาน (baseline) ที่แท่งโตออกมา */}
        {horizontal ? (
          <line className="chart-baseline" x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotHeight} />
        ) : (
          <line className="chart-baseline" x1={margin.left} x2={margin.left + plotWidth} y1={margin.top + plotHeight} y2={margin.top + plotHeight} />
        )}

        {/* ----- แท่งทีละแท่ง ----- */}
        {data.map((datum, index) => {
          // จุดกึ่งกลางของแท่งนี้บนแกนรอง
          const center = (horizontal ? margin.top : margin.left) + band * (index + 0.5)
          const start = center - thickness / 2

          // เฉพาะช่วงที่มีค่า > 0 (ช่วงว่างไม่ต้องวาด) — ช่วงสุดท้ายคือปลายแท่งที่ต้องมนมุม
          const visible = series.filter((s) => (datum.values[s.key] ?? 0) > 0)

          let offset = 0 // ระยะที่ซ้อนมาแล้วจากฐาน (px)
          const segments = visible.map((s, i) => {
            const isLast = i === visible.length - 1
            const len = lengthOf(datum.values[s.key])
            const drawn = Math.max(0, len - (isLast ? 0 : GAP)) // ช่วงที่ไม่ใช่ปลายเว้นช่องว่างไว้ท้ายช่วง

            const path = horizontal
              ? barPath({ x: margin.left + offset, y: start, width: drawn, height: thickness, horizontal, rounded: isLast })
              : barPath({
                  x: start,
                  y: margin.top + plotHeight - offset - len + (isLast ? 0 : GAP),
                  width: thickness,
                  height: drawn,
                  horizontal,
                  rounded: isLast,
                })

            offset += len
            return <path key={s.key} d={path} style={{ fill: s.color }} />
          })

          const total = totals[index]
          const tip = lengthOf(total) // ระยะถึงปลายแท่ง

          return (
            // กลุ่มนี้รับเหตุการณ์ทั้งหมดของแท่ง: ทั้งพื้นที่ว่างรอบแท่ง (ให้เป้าชี้ใหญ่กว่าแท่งจริง) และตัวแท่ง
            <g
              key={datum.id}
              tabIndex={0}
              role="img"
              aria-label={`${datum.title ?? datum.label}: ${series.map((s) => `${s.label} ${datum.values[s.key] ?? 0}`).join(', ')}`}
              onPointerMove={(event) => handlePointerMove(event, index)}
              onPointerLeave={() => setHover(null)}
              onFocus={() =>
                horizontal
                  ? showTooltip(index, margin.left + tip, center)
                  : showTooltip(index, center, margin.top + plotHeight - tip)
              }
              onBlur={() => setHover(null)}
            >
              {/* พื้นที่รับเมาส์ของแท่ง (โปร่งใส) และแถบสีอ่อนบอกว่ากำลังชี้แท่งนี้ */}
              <rect
                className={`chart-band${hover?.index === index ? ' is-active' : ''}`}
                x={horizontal ? 0 : margin.left + band * index}
                y={horizontal ? margin.top + band * index : margin.top}
                width={horizontal ? width : band}
                height={horizontal ? band : plotHeight}
              />

              {segments}

              {/* ตัวเลขรวมที่ปลายแท่ง */}
              {total > 0 &&
                (horizontal ? (
                  <text className="chart-total-text" x={margin.left + tip + 8} y={center} dominantBaseline="central">
                    {formatNumber(total)}
                  </text>
                ) : (
                  <text className="chart-total-text" x={center} y={margin.top + plotHeight - tip - 6} textAnchor="middle">
                    {formatNumber(total)}
                  </text>
                ))}

              {/* ชื่อแท่ง: แนวนอนอยู่ซ้าย แนวตั้งอยู่ใต้แกน */}
              {horizontal ? (
                <text className="chart-category-text" x={margin.left - 10} y={center} textAnchor="end" dominantBaseline="central">
                  {datum.label}
                </text>
              ) : (
                <text className="chart-axis-text" x={center} y={margin.top + plotHeight + 20} textAnchor="middle">
                  {datum.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {hovered && (
        <ChartTooltip
          x={hover.x}
          y={hover.y}
          containerWidth={width}
          title={hovered.title ?? hovered.label}
          rows={[
            ...series.map((s) => ({
              label: s.label,
              value: `${formatNumber(hovered.values[s.key] ?? 0)}${unit ? ` ${unit}` : ''}`,
              color: s.color,
            })),
            // มีหลายชุดข้อมูล → แสดงยอดรวมด้วย
            ...(series.length > 1
              ? [{ label: 'รวม', value: `${formatNumber(totals[hover.index])}${unit ? ` ${unit}` : ''}` }]
              : []),
          ]}
        />
      )}
    </div>
  )
}

export default BarChart
