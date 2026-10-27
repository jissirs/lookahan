import { useState } from 'react'
import StepperPill from './StepperPill.jsx'

/**
 * ช่องกรอกราคา พร้อมปุ่ม + / − (รองรับทศนิยมสองตำแหน่ง)
 * ราคาลดต่ำกว่า 0 ไม่ได้ (ปุ่ม − จะจางเมื่อเหลือน้อยกว่าขั้นที่ลด)
 *
 * @param {number} value  ราคาปัจจุบัน
 * @param {(next: number) => void} onChange  เรียกพร้อมราคาใหม่ — ผู้เรียกเป็นคนเก็บค่า
 */
function PriceField({ value, onChange, commitOnBlur = false, step = 1 }) {
  const [draft, setDraft] = useState(null)
  const changeBy = (delta) => {
    const entered = Number(draft ?? value)
    const base = Number.isFinite(entered) && entered >= 0 ? entered : value
    setDraft(null)
    onChange(Math.max(0, Math.round((base + delta) * 100) / 100))
  }

  return (
    <div className="price-row">
      <div className="price-box">
        <input
          className="price-input"
          type="number"
          inputMode="decimal"
          aria-label="ราคา (บาท)"
          min="0"
          max="999999999.99"
          step="0.01"
          required
          value={draft ?? value}
          onChange={(event) => {
            const text = event.target.value
            setDraft(text)
            const next = Number(text)
            if (!commitOnBlur && text !== '' && Number.isFinite(next) && next >= 0) onChange(next)
          }}
          onBlur={(event) => {
            // คลิก +/− ให้ปุ่มใช้ค่าที่พิมพ์แล้วบันทึกครั้งเดียว
            if (event.currentTarget.closest('.price-row').contains(event.relatedTarget)) return
            if (!event.currentTarget.reportValidity()) return
            const next = Number(event.currentTarget.value)
            if (commitOnBlur && next !== value) onChange(next)
            setDraft(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
        <span aria-hidden="true">฿</span>
      </div>
      <StepperPill
        label="price"
        onIncrement={() => changeBy(step)}
        onDecrement={() => changeBy(-step)}
        decrementDisabled={Number(draft ?? value) <= 0}
      />
    </div>
  )
}

export default PriceField
