import { useRef, useState } from 'react'
import { useInventory } from '../../context/InventoryContext.js'
import { useAuth } from '../../context/AuthContext.js'
import { readPending, savePending, clearPending } from '../../utils/pendingRequest.js'

export default function OrderPayment({ order }) {
  const { recordPayment } = useInventory()
  const { user } = useAuth()
  const pendingKey = `lookahan.pending-payment.${user.id}.${order.id}`
  const [saved] = useState(() => readPending(pendingKey))
  const [opened, setOpened] = useState(Boolean(saved))
  const [method, setMethod] = useState(saved?.method || 'cash')
  const [amount, setAmount] = useState(saved?.amount || '')
  const [tendered, setTendered] = useState(saved?.tendered || '')
  const [refund, setRefund] = useState(saved?.refund || false)
  const [note, setNote] = useState(saved?.note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(Boolean(saved))
  const pending = useRef(saved)
  const working = useRef(false)
  const pay = async e => {
    e.preventDefault()
    if (working.current) return
    working.current = true; setBusy(true); setError('')
    if (!pending.current) pending.current = { requestKey: crypto.randomUUID(), method, amount, tendered: tendered || amount, refund, note }
    savePending(pendingKey, pending.current)
    try {
      await recordPayment(order.id, pending.current)
      clearPending(pendingKey)
      pending.current = null; setUncertain(false); setAmount(''); setTendered('')
      setOpened(false)
    } catch (err) {
      const unknown = err.code === 'NETWORK' || err.code === 'SERVER_ERROR'
      setUncertain(unknown)
      if (!unknown) { pending.current = null; clearPending(pendingKey) }
      setError(unknown ? 'ยังยืนยันผลไม่ได้ กดบันทึกซ้ำเพื่อตรวจรายการเดิม' : err.message)
    } finally { working.current = false; setBusy(false) }
  }
  const balance = Number(order.balance || 0)
  return <section className="order-payment">
    <p>รับสุทธิ ฿{Number(order.paid || 0).toFixed(2)} · {order.status === 'cancelled' ? 'ยกเลิก' : balance > 0 ? `ค้างชำระ ฿${balance.toFixed(2)}` : 'ชำระครบแล้ว'}</p>
    <button type="button" onClick={() => setOpened(!opened)}>{opened ? 'ซ่อนการชำระเงิน' : 'รับเงิน / ประวัติ / แบ่งชำระ'}</button>
    {opened && <>
      <ul>{(order.payments || []).map(p => <li key={p.id}>{p.amount < 0 ? 'คืนเงิน' : 'รับเงิน'} {p.method === 'cash' ? 'สด' : 'โอน'} ฿{Math.abs(p.amount).toFixed(2)} · ทอน ฿{Number(p.change).toFixed(2)} {p.note}</li>)}</ul>
      {(uncertain || balance > 0 || (user?.role === 'owner' && order.paid > 0)) && <form onSubmit={pay}>
        <fieldset className="restaurant-panel" disabled={busy || uncertain}>
          {user?.role === 'owner' && order.paid > 0 && <label className="restaurant-check"><input type="checkbox" checked={refund} onChange={e => setRefund(e.target.checked)} />คืนเงิน</label>}
          <div className="restaurant-inline">
            <label>ช่องทาง<select className="field-select" value={method} onChange={e => setMethod(e.target.value)}><option value="cash">เงินสด</option><option value="transfer">โอน (ตรวจยอดเข้าจริงก่อน)</option></select></label>
            <label>ยอด{refund ? 'คืน' : 'รับ'} (แบ่งชำระได้)<input className="field-input" type="number" min="0.01" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
            {method === 'cash' && !refund && <label>เงินที่ลูกค้าให้<input className="field-input" type="number" min={amount || '0.01'} step="0.01" value={tendered} onChange={e => setTendered(e.target.value)} placeholder="เท่ากับยอดรับ หากเว้นว่าง" /></label>}
          </div>
          {method === 'cash' && !refund && <p>เงินทอน ฿{Math.max(0, Number(tendered || amount) - Number(amount)).toFixed(2)}</p>}
          <label>หมายเหตุ / ผู้แบ่งชำระ<input className="field-input" maxLength={200} required={refund} value={note} onChange={e => setNote(e.target.value)} /></label>
        </fieldset>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || (!refund && balance <= 0 && !uncertain)}>{busy ? 'กำลังบันทึก…' : uncertain ? 'ตรวจผลคำขอเดิม' : refund ? 'บันทึกคืนเงิน' : 'บันทึกรับเงิน'}</button>
      </form>}
    </>}
  </section>
}
