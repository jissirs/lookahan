import { useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss.js'
import './FilterDropdown.css'

/**
 * ปุ่มตัวกรองแบบ dropdown (Category / Status) ตามดีไซน์
 *
 * @param {string} label    ข้อความบนปุ่มตอนยังไม่ได้เลือก เช่น "Category"
 * @param {{ value: string, label: string }[]} options  ตัวเลือก
 * @param {string} value    ค่าที่เลือกอยู่ — '' หมายถึง "ไม่กรอง" (All)
 * @param {(value: string) => void} onChange
 * @param {'tan' | 'cream'} tone  สีปุ่ม: น้ำตาลอ่อน / ครีม
 */
function FilterDropdown({ label, options, value, onChange, tone = 'tan' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // กดที่อื่นหรือกด Esc → ปิดรายการ
  useDismiss(open, rootRef, () => setOpen(false))

  const selected = options.find((o) => o.value === value)

  // เลือกแล้วปิดรายการทันที
  const choose = (next) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div className={`filter-dropdown filter-dropdown--${tone}`} ref={rootRef}>
      <button
        type="button"
        className="filter-dropdown-button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {/* เลือกแล้วแสดงชื่อที่เลือก ไม่งั้นแสดงชื่อตัวกรอง */}
        <span>{selected ? selected.label : label}</span>
        <span className="filter-dropdown-arrow" aria-hidden="true">▼</span>
      </button>

      {open && (
        <ul className="filter-dropdown-list" role="listbox" aria-label={label}>
          {/* ตัวเลือกแรกเสมอ: All = ล้างตัวกรอง */}
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              className="filter-dropdown-option"
              onClick={() => choose('')}
            >
              All
            </button>
          </li>

          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={value === o.value}
                className="filter-dropdown-option"
                onClick={() => choose(o.value)}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default FilterDropdown
