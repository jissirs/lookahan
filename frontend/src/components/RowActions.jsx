import { useRef, useState } from 'react'
import { useDismiss } from '../hooks/useDismiss.js'
import './StockTable.css'

/**
 * ปุ่ม ⋮ ท้ายแถวตาราง — กดแล้วเปิดกล่องสีส้มที่มีปุ่มกลมสีแดง (เช่น + − หรือ ✎ −)
 *
 * @param {string} label  ชื่อแถว ใช้เป็นข้อความสำหรับโปรแกรมอ่านหน้าจอ
 * @param {{ key: string, symbol: string, ariaLabel: string, onClick: () => void,
 *           disabled?: boolean, keepOpen?: boolean }[]} actions  ปุ่มในกล่อง
 *   - keepOpen = true  : กดแล้วกล่องยังเปิดอยู่ (เหมาะกับ +/− ที่กดซ้ำๆ)
 *   - ไม่ใส่          : กดแล้วกล่องปิดเอง (เหมาะกับ ✎ − ที่เปิด popup ต่อ)
 */
function RowActions({ label, actions, align = 'auto' }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const rootRef = useRef(null)

  // กดที่อื่นหรือกด Esc → ปิดกล่อง
  useDismiss(open, rootRef, () => setOpen(false))

  const handleAction = async (action) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    if (!action.keepOpen) setOpen(false)
    try { await action.onClick() } finally { pendingRef.current = false; setPending(false) }
  }

  return (
    <div className={`row-actions${align === 'left' ? ' row-actions--left' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="stock-table-kebab"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Actions for ${label}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span aria-hidden="true">⋮</span>
      </button>

      {open && (
        <div className="stock-table-pill" role="group" aria-label={`Actions for ${label}`}>
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="stock-table-round"
              onClick={() => handleAction(action)}
              disabled={pending || action.disabled}
              aria-label={action.ariaLabel}
              title={action.ariaLabel}
            >
              {action.symbol}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default RowActions
