import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../services/api.js'
import { useInventory } from '../../context/InventoryContext.js'
import { useAuth } from '../../context/AuthContext.js'
import PrintOrder from './PrintOrder.jsx'

export default function OrderTools({ order }) {
  const { reload, orders } = useInventory()
  const { user } = useAuth()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [table, setTable] = useState(order.tableLabel || '')
  const [service, setService] = useState(order.serviceType)
  const [discount, setDiscount] = useState(order.discount || 0)
  const [reason, setReason] = useState('')
  const [source, setSource] = useState('')
  const [split, setSplit] = useState({})
  const [print, setPrint] = useState(null)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef(null)
  const working = useRef(false)
  const send = async (action, fields) => {
    if (working.current) return
    working.current = true; setBusy(true); setError('')
    if (!pending.current) pending.current = { action, fields: { ...fields, revision: order.revision, requestKey: crypto.randomUUID() } }
    try {
      const command = pending.current
      await api.pos.order(order.id, command.action, command.fields)
      pending.current = null; setUncertain(false); setSplit({})
      await reload()
    } catch (err) {
      const unknown = ['NETWORK', 'SERVER_ERROR'].includes(err.code)
      setUncertain(unknown && Boolean(pending.current))
      if (!unknown) pending.current = null
      setError(err.message)
      if (err.code === 'STALE_ORDER') await reload().catch(() => {})
    } finally { working.current = false; setBusy(false) }
  }
  const active = ['new', 'cooking', 'ready'].includes(order.status)
  const pristine = !order.payments.length && !order.discount
  const candidates = orders.filter(x => x.id !== order.id && x.status === order.status && !x.payments.length && !x.discount)
  return <div className="order-payment">
    <div className="restaurant-inline"><button onClick={() => setPrint('kitchen')}>ใบสั่งครัว</button><button onClick={() => setPrint('receipt')}>ใบเสร็จ / พิมพ์</button>
      {order.status === 'new' && pristine && <Link className="btn-pill btn-pill--sm" to={`/order/new?edit=${order.id}`}>แก้รายการอาหาร</Link>}
    </div>
    {order.cancellationMode && <p>{order.cancellationMode === 'waste' ? 'เริ่มทำแล้ว บันทึกของเสีย ไม่คืนสต๊อก' : order.cancellationMode === 'merged' ? `รวมไปบิล #${order.transferredTo}` : 'ยกเลิกก่อนทำ คืนสต๊อกแล้ว'} {order.cancellationReason}</p>}
    {active && <details><summary>โต๊ะ ส่วนลด รวม/แยกบิล</summary>
      <fieldset className="restaurant-panel" disabled={busy || uncertain}>
        <form onSubmit={e => { e.preventDefault(); send('table', { serviceType: service, tableLabel: table }) }}><div className="restaurant-inline">
          <label>ประเภท<select className="field-select" value={service} onChange={e => setService(e.target.value)}><option value="dine_in">ทานที่ร้าน</option><option value="takeaway">กลับบ้าน</option></select></label>
          {service === 'dine_in' && <label>โต๊ะ<input className="field-input" maxLength={30} required value={table} onChange={e => setTable(e.target.value)} /></label>}
          <button>บันทึกโต๊ะ</button></div></form>
        {user?.role === 'owner' && <form onSubmit={e => { e.preventDefault(); send('discount', { amount: discount, reason }) }}><div className="restaurant-inline">
          <label>ส่วนลด (บาท)<input className="field-input" type="number" min="0" step="0.01" required value={discount} onChange={e => setDiscount(e.target.value)} /></label>
          <label>เหตุผลส่วนลด<input className="field-input" required maxLength={200} value={reason} onChange={e => setReason(e.target.value)} /></label><button>บันทึกส่วนลด</button></div></form>}
        {pristine && <form onSubmit={e => { e.preventDefault(); const from = candidates.find(x => x.id === source); if (from) send('merge', { sourceId: source, sourceRevision: from.revision }) }}><div className="restaurant-inline">
          <label>รวมบิลเข้าบิลนี้<select className="field-select" required value={source} onChange={e => setSource(e.target.value)}><option value="">เลือกบิลที่อยู่ขั้นตอนเดียวกัน</option>{candidates.map(x => <option key={x.id} value={x.id}>#{x.number} {x.tableLabel} ฿{x.total}</option>)}</select></label><button>รวมบิล</button></div></form>}
        {pristine && order.status === 'new' && <form onSubmit={e => { e.preventDefault(); send('split', { lines: Object.entries(split).filter(([, qty]) => Number(qty) > 0).map(([itemId, qty]) => ({ itemId, qty: Number(qty) })) }) }}>
          <p>แยกตามรายการ: ระบุจำนวนจานที่จะย้ายไปบิลย่อย ต้องเหลืออย่างน้อย 1 จานในบิลเดิม</p>
          {order.items.map(x => <label key={x.id}>{x.name} ({x.qty} จาน)<input className="field-input" type="number" min="0" max={x.qty} step="1" value={split[x.id] || ''} onChange={e => setSplit({ ...split, [x.id]: e.target.value })} /></label>)}<button>แยกเป็นบิลย่อย</button>
        </form>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
      {uncertain && <button disabled={busy} onClick={() => send()}>ตรวจผลคำขอเดิมอีกครั้ง</button>}
    </details>}
    {print && <PrintOrder order={order} kind={print} onClose={() => setPrint(null)} />}
  </div>
}
