import { useState } from 'react'
import './charts.css'

/**
 * การ์ดห่อกราฟทุกตัว: หัวข้อ + คำอธิบาย + คำอธิบายสี (legend) + ปุ่มสลับ กราฟ ⇄ ตาราง
 *
 * ปุ่ม "ตาราง" แสดงข้อมูลชุดเดียวกับกราฟเป็นตัวหนังสือ — ให้ผู้ที่อ่านสีไม่ออก/ใช้โปรแกรมอ่านหน้าจอ
 * หรืออยากเห็นตัวเลขจริงทุกค่า เข้าถึงข้อมูลได้เท่ากับคนที่เห็นกราฟ
 *
 * @param {string} title
 * @param {string} [subtitle]  คำอธิบายสั้นๆ ใต้หัวข้อ
 * @param {{ label: string, color: string, icon?: string }[]} [legend]
 *        คำอธิบายสี — แสดงเมื่อมี 2 ชุดข้อมูลขึ้นไป (ชุดเดียวไม่ต้องมี เพราะหัวข้อบอกอยู่แล้ว)
 *        icon = สัญลักษณ์หน้าชื่อ ใช้กับสถานะ เพื่อไม่ให้สีเป็นตัวบอกความหมายเพียงอย่างเดียว
 * @param {React.ReactNode} [actions]  ตัวเลือกประจำกราฟ เช่น dropdown เลือกวัตถุดิบ
 * @param {{ columns: string[], rows: (string|number)[][] }} table  ข้อมูลของมุมมองตาราง
 * @param {React.ReactNode} children  ตัวกราฟ
 */
function ChartCard({ title, subtitle, legend = [], actions, table, children }) {
  const [view, setView] = useState('chart') // 'chart' | 'table'

  return (
    <section className="chart-card" aria-label={title}>
      <header className="chart-card-head">
        <div>
          <h3 className="chart-card-title">{title}</h3>
          {subtitle && <p className="chart-card-subtitle">{subtitle}</p>}
        </div>

        <div className="chart-card-tools">
          {actions}
          <div className="chart-view-toggle" role="group" aria-label="มุมมอง">
            {[
              ['chart', 'กราฟ'],
              ['table', 'ตาราง'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="chart-view-button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* legend: ต้องมีเมื่อมี 2 ชุดข้อมูลขึ้นไป */}
      {legend.length >= 2 && (
        <ul className="chart-legend">
          {legend.map((item) => (
            <li key={item.label}>
              <span className="chart-legend-swatch" style={{ background: item.color }} />
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              {item.label}
            </li>
          ))}
        </ul>
      )}

      {view === 'chart' ? (
        children
      ) : (
        <div className="chart-table-wrap">
          <table className="chart-table">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.join('|')}>
                  {row.map((cell, index) => (
                    <td key={`${table.columns[index]}-${cell}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default ChartCard
