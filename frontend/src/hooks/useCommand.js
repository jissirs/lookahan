import { useRef, useState } from 'react'

// Retain the exact request after ambiguous network failures; never silently submit twice.
export function useCommand(after) {
  const pending = useRef(null)
  const guard = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const run = async (fn, fields = {}) => {
    if (guard.current) return false
    guard.current = true; setBusy(true); setError('')
    let committed = false
    if (!pending.current) pending.current = { fn, fields: { ...fields, requestKey: crypto.randomUUID() } }
    try {
      await pending.current.fn(pending.current.fields)
      committed = true
      pending.current = null; setUncertain(false)
      await after?.()
      return true
    } catch (err) {
      const unknown = !committed && ['NETWORK', 'SERVER_ERROR'].includes(err.code)
      if (!unknown) pending.current = null
      setUncertain(unknown)
      setError(committed ? 'บันทึกสำเร็จ แต่โหลดข้อมูลล่าสุดไม่ได้ กรุณารีเฟรชหน้า' : unknown ? 'ยังยืนยันผลไม่ได้ กรุณากดตรวจคำขอเดิมซ้ำ' : err.message)
      return false
    } finally { guard.current = false; setBusy(false) }
  }
  return { run, busy, error, uncertain, retry: () => run() }
}
