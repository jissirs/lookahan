import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageShell from '../../components/PageShell.jsx'
import SearchBar from '../../components/SearchBar.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { getMenuStatus } from '../../utils/menuStatus.js'
import { useAuth } from '../../context/AuthContext.js'
import { readPending, savePending, clearPending } from '../../utils/pendingRequest.js'
import './order.css'
import { queueOrder } from '../../utils/offlineStore.js'

export default function OrderComposer() {
  const navigate = useNavigate()
  const { menus, ingredients, orders, createOrder, editOrder } = useInventory()
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const original = orders.find(x => x.id === editId)
  const { user } = useAuth()
  const pendingKey = `lookahan.pending-order.${user.id}.${editId || 'new'}`
  const [saved] = useState(() => readPending(pendingKey))
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState(saved?.cart || (original?.items || []).map(item => {
    const menu = menus.find(x => x.id === item.menuId)
    const chosen = (item.modifiers || []).map(x => x.name)
    const price = menu ? Number(menu.price) + (menu.modifiers || []).filter(x => chosen.includes(x.name)).reduce((sum, x) => sum + Number(x.price), 0) : item.price
    return { ...item, modifiers: chosen, price }
  }))
  const [editing, setEditing] = useState(null)
  const [qty, setQty] = useState(1)
  const [options, setOptions] = useState([])
  const [lineNote, setLineNote] = useState('')
  const [note, setNote] = useState(saved?.request?.note || original?.note || '')
  const [serviceType, setServiceType] = useState(saved?.request?.serviceType || original?.serviceType || 'takeaway')
  const [tableLabel, setTableLabel] = useState(saved?.request?.tableLabel || original?.tableLabel || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const requestRef = useRef(saved?.request || null)
  const [uncertain, setUncertain] = useState(Boolean(saved))
  const open = menu => { setEditing(menu); setQty(1); setOptions([]); setLineNote(''); setError('') }
  const unitPrice = menu => Number(menu.price) + (menu.modifiers || []).filter(x => options.includes(x.name)).reduce((sum, x) => sum + Number(x.price), 0)
  const add = () => {
    if (!Number.isInteger(qty) || qty < 1 || qty + cart.filter(x => x.menuId === editing.id).reduce((sum, x) => sum + x.qty, 0) > 99) {
      setError('จำนวนรวมต่อเมนูต้องอยู่ระหว่าง 1–99 จาน'); return
    }
    setCart([...cart, { menuId: editing.id, name: editing.name, qty, modifiers: options, note: lineNote, price: unitPrice(editing) }])
    setEditing(null); setError('')
  }
  const total = cart.reduce((sum, x) => sum + x.qty * x.price, 0)
  const submit = async e => {
    e.preventDefault()
    if (busyRef.current || !cart.length) return
    if (serviceType === 'dine_in' && !tableLabel.trim()) { setError('กรุณาระบุโต๊ะ'); return }
    busyRef.current = true; setBusy(true); setError('')
    const payload = { items: cart.map(({ menuId, qty, modifiers, note }) => ({ menuId, qty, modifiers, note })), note, serviceType, tableLabel, expectedTotal: total.toFixed(2) }
    if (!requestRef.current) requestRef.current = { ...payload, requestKey: crypto.randomUUID() }
    savePending(pendingKey, { request: requestRef.current, cart })
    try {
      if (editId) {
        if (!original) throw new Error('ไม่พบออเดอร์')
        await editOrder(editId, { ...requestRef.current, revision: original.revision })
      } else await createOrder(requestRef.current)
      clearPending(pendingKey)
      navigate('/order', { replace: true })
    } catch (err) {
      const unknown = err.code === 'NETWORK' || err.code === 'SERVER_ERROR'
      setUncertain(unknown)
      if (!unknown) { requestRef.current = null; clearPending(pendingKey) }
      setError(unknown ? 'ยังยืนยันผลไม่ได้ กดส่งซ้ำเพื่อตรวจรายการเดิม ระบบจะไม่สร้างซ้ำ' : err.message)
    } finally { busyRef.current = false; setBusy(false) }
  }
  return <PageShell><form className="order-create" onSubmit={submit}>
    <h1 className="page-title">{editId ? `แก้ออเดอร์ #${original?.number || editId}` : 'สร้างออเดอร์'}</h1>
    {editId && <p>แก้ได้ก่อนเริ่มทำและก่อนมีประวัติรับเงิน ระบบคำนวณราคาเมนูปัจจุบันและปรับสต๊อกเฉพาะส่วนต่าง</p>}
    {uncertain && <p role="status">มีคำขอที่ยังไม่ยืนยันผล กรุณาส่งคำขอเดิมซ้ำก่อนสร้างรายการใหม่</p>}
    {!editId && <button type="button" disabled={busy || !cart.length} onClick={async () => {
      if (serviceType === 'dine_in' && !tableLabel.trim()) { setError('กรุณาระบุโต๊ะ'); return }
      try {
        const request = requestRef.current || { items: cart.map(({ menuId, qty, modifiers, note }) => ({ menuId, qty, modifiers, note })), note, serviceType, tableLabel, expectedTotal: total.toFixed(2), requestKey: crypto.randomUUID() }
        await queueOrder(user.id, request, cart); clearPending(pendingKey); navigate('/order', { replace: true })
      } catch { setError('บันทึกในเครื่องไม่ได้ กรุณาตรวจพื้นที่เก็บข้อมูลของเบราว์เซอร์') }
    }}>เก็บร่างในเครื่อง / รอเชื่อมต่อ</button>}
    <fieldset disabled={busy || uncertain} className="restaurant-panel">
      <div className="restaurant-inline">
        <label>ประเภท<select className="field-select" value={serviceType} onChange={e => setServiceType(e.target.value)}><option value="takeaway">กลับบ้าน</option><option value="dine_in">ทานที่ร้าน</option></select></label>
        {serviceType === 'dine_in' && <label>โต๊ะ<input className="field-input" maxLength={30} value={tableLabel} onChange={e => setTableLabel(e.target.value)} /></label>}
      </div>
      <SearchBar value={query} onChange={setQuery} placeholder="ค้นหาเมนู" />
      <ul className="order-menu-list">
        {menus.filter(m => m.name.toLowerCase().includes(query.toLowerCase())).map(menu => {
          const status = getMenuStatus(menu, ingredients)
          return <li className="order-menu-row" key={menu.id}><strong>{menu.name}</strong><span>฿{menu.price}</span><button type="button" onClick={() => open(menu)} disabled={!menu.available}>{menu.available ? 'เลือก / ปรับจาน' : 'ปิดขาย'}</button>
          {menu.available && status === 'short' && <small>สูตรปกติวัตถุดิบไม่พอ — ตรวจตัวเลือกก่อนสั่ง</small>}</li>
        })}
      </ul>
      {editing && <section className="restaurant-panel" aria-label="ปรับจาน">
        <h2>{editing.name}</h2>
        <label>จำนวนจาน<input className="field-input" type="number" min="1" max="99" step="1" value={qty} onChange={e => setQty(Number(e.target.value))} /></label>
        {(editing.modifiers || []).map(option => <label className="restaurant-check" key={option.name}><input type="checkbox" checked={options.includes(option.name)} onChange={e => setOptions(e.target.checked ? [...options, option.name] : options.filter(x => x !== option.name))} />{option.name} (+฿{option.price})</label>)}
        <label>หมายเหตุต่อจาน<input className="field-input" maxLength={200} value={lineNote} onChange={e => setLineNote(e.target.value)} placeholder="เช่น เผ็ดน้อย" /></label>
        <p>฿{(unitPrice(editing) * qty).toFixed(2)}</p>
        <div className="restaurant-inline"><button type="button" onClick={add}>เพิ่มรายการนี้</button><button type="button" onClick={() => setEditing(null)}>ยกเลิก</button></div>
      </section>}
      <section className="restaurant-panel"><h2>รายการที่เลือก</h2>
        {cart.length === 0 && <p>ยังไม่มีรายการ</p>}
        {cart.map((x, index) => <div key={index} className="restaurant-inline"><span>{x.name} × {x.qty} {x.modifiers.join(', ')} {x.note} — ฿{(x.price * x.qty).toFixed(2)}</span><button type="button" onClick={() => setCart(cart.filter((_, i) => i !== index))}>นำออก</button></div>)}
        <label>หมายเหตุทั้งออเดอร์<input className="field-input" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
      </section>
    </fieldset>
    <p className="order-summary-total">รวม <strong>฿{total.toFixed(2)}</strong></p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="btn-pill btn-pill--cream" type="submit" disabled={busy || !cart.length || (editId && !original)}>{busy ? 'กำลังบันทึก…' : uncertain ? 'ส่งคำขอเดิมซ้ำเพื่อตรวจผล' : editId ? 'บันทึกการแก้ไข' : 'สร้างออเดอร์'}</button>
  </form></PageShell>
}
