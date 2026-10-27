import { useEffect, useState } from 'react'
import { api } from '../../services/api.js'
import { useInventory } from '../../context/InventoryContext.js'
import { useCommand } from '../../hooks/useCommand.js'

const reasons = { expired: 'หมดอายุ', cooking_error: 'ปรุงผิด', customer_return: 'ลูกค้าคืน', spoilage: 'เน่าเสีย', other: 'อื่น ๆ' }
function Receipt({ purchase, run, disabled }) {
  const [quantities, setQuantities] = useState({})
  const [costs, setCosts] = useState({})
  const [dates, setDates] = useState({})
  const [invoiceRef, setInvoice] = useState('')
  return <form onSubmit={async e => {
    e.preventDefault()
    const lines = purchase.lines.filter(x => Number(quantities[x.id]) > 0).map(x => ({ lineId: x.id, quantity: Number(quantities[x.id]), unitCost: costs[x.id] ?? x.unitCost, expiresOn: dates[x.id] || null }))
    if (await run(fields => api.pos.receive(purchase.id, fields), { lines, invoiceRef })) setQuantities({})
  }}><fieldset disabled={disabled} className="restaurant-panel"><legend>รับจริงใบสั่งซื้อ #{purchase.id} · {purchase.supplier.name}</legend>
    <label>เลขใบส่งของ<input className="field-input" maxLength={100} value={invoiceRef} onChange={e => setInvoice(e.target.value)} /></label>
    {purchase.lines.filter(x => x.received < x.quantity).map(x => <div className="restaurant-inline" key={x.id}>
      <span>{x.name} · ค้าง {x.quantity - x.received} {x.unit}</span>
      <label>รับจำนวน<input className="field-input" type="number" min="0" max={x.quantity - x.received} step="1" value={quantities[x.id] || ''} onChange={e => setQuantities({ ...quantities, [x.id]: e.target.value })} /></label>
      <label>ต้นทุนจริง ฿/{x.unit}<input className="field-input" type="number" min="0" step="0.000001" required value={costs[x.id] ?? x.unitCost} onChange={e => setCosts({ ...costs, [x.id]: e.target.value })} /></label>
      <label>หมดอายุ<input className="field-input" type="date" value={dates[x.id] || ''} onChange={e => setDates({ ...dates, [x.id]: e.target.value })} /></label>
    </div>)}
    <button type="submit">รับของตามจำนวนที่กรอก</button>{' '}
    <button type="button" onClick={() => { if (window.confirm('ปิดส่วนที่ยังไม่ได้รับ? ยอดที่รับแล้วจะคงเดิม')) run(fields => api.pos.cancelPurchase(purchase.id, fields)) }}>ยกเลิกยอดค้างรับ</button>
  </fieldset></form>
}
export default function PurchasingSection() {
  const { ingredients, reload } = useInventory()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const load = async () => { setData(await api.pos.purchases()); setLoadError('') }
  const action = useCommand(async () => { await load(); await reload() })
  const [supplier, setSupplier] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [lines, setLines] = useState([{ ingredientId: '', quantity: '', unitCost: '' }])
  const [waste, setWaste] = useState({ ingredientId: '', quantity: '', reason: 'spoilage', note: '' })
  useEffect(() => { let active = true; api.pos.purchases().then(x => { if (active) setData(x) }).catch(err => { if (active) setLoadError(err.message) }); return () => { active = false } }, [])
  const field = (index, key, value) => setLines(lines.map((x, i) => i === index ? { ...x, [key]: value } : x))
  const select = (value, onChange) => <select className="field-input" required value={value} onChange={e => onChange(e.target.value)}><option value="">เลือกวัตถุดิบ</option>{ingredients.map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select>
  return <div className="restaurant-panel">
    {loadError && <p role="alert">{loadError} <button onClick={() => load().catch(err => setLoadError(err.message))}>ลองโหลดใหม่</button></p>}
    {action.error && <p className="field-error" role="alert">{action.error}</p>}
    {action.uncertain && <button type="button" onClick={action.retry} disabled={action.busy}>ตรวจคำขอเดิมซ้ำ</button>}
    <fieldset disabled={action.busy || action.uncertain} className="restaurant-panel">
      <details><summary>ผู้ขาย</summary><form onSubmit={async e => { e.preventDefault(); if (await action.run(api.pos.supplier, { name, contact })) { setName(''); setContact('') } }}>
        <label>ชื่อผู้ขาย<input className="field-input" required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
        <label>ช่องทางติดต่อ<input className="field-input" maxLength={200} value={contact} onChange={e => setContact(e.target.value)} /></label><button>เพิ่มผู้ขาย</button>
      </form>{data?.suppliers.map(x => <p key={x.id}>{x.name} · {x.contact}</p>)}</details>
      <details><summary>สร้างใบสั่งซื้อวัตถุดิบ</summary><form onSubmit={async e => { e.preventDefault(); if (await action.run(api.pos.purchase, { supplierId: supplier, lines: lines.map(x => ({ ...x, quantity: Number(x.quantity) })) })) setLines([{ ingredientId: '', quantity: '', unitCost: '' }]) }}>
        <label>ผู้ขาย<select className="field-input" required value={supplier} onChange={e => setSupplier(e.target.value)}><option value="">เลือกผู้ขาย</option>{data?.suppliers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {lines.map((line, i) => <div className="restaurant-inline" key={i}>{select(line.ingredientId, value => field(i, 'ingredientId', value))}
          <label>จำนวนหน่วยฐาน<input className="field-input" type="number" min="1" step="1" required value={line.quantity} onChange={e => field(i, 'quantity', e.target.value)} /></label>
          <label>ต้นทุนต่อหน่วยฐาน (g/ml/pcs)<input className="field-input" type="number" min="0" step="0.000001" required value={line.unitCost} onChange={e => field(i, 'unitCost', e.target.value)} /></label>
          <button type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, n) => n !== i))}>ลบแถว</button></div>)}
        <button type="button" onClick={() => setLines([...lines, { ingredientId: '', quantity: '', unitCost: '' }])}>เพิ่มรายการ</button>{' '}<button>บันทึกใบสั่งซื้อ</button>
      </form></details>
      <details><summary>บันทึกของเสีย</summary><form onSubmit={async e => { e.preventDefault(); if (await action.run(api.pos.waste, { ...waste, quantity: Number(waste.quantity) })) setWaste({ ...waste, quantity: '', note: '' }) }}>
        {select(waste.ingredientId, ingredientId => setWaste({ ...waste, ingredientId }))}
        <label>จำนวนหน่วยฐาน<input className="field-input" type="number" min="1" step="1" required value={waste.quantity} onChange={e => setWaste({ ...waste, quantity: e.target.value })} /></label>
        <label>สาเหตุ<select className="field-input" value={waste.reason} onChange={e => setWaste({ ...waste, reason: e.target.value })}>{Object.entries(reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>รายละเอียด<input className="field-input" maxLength={200} value={waste.note} onChange={e => setWaste({ ...waste, note: e.target.value })} /></label><button>บันทึกและตัดสต๊อก</button>
      </form></details>
    </fieldset>
    {data?.purchases.filter(x => x.status === 'open').map(x => <Receipt key={x.id} purchase={x} run={action.run} disabled={action.busy || action.uncertain} />)}
    <details><summary>ประวัติซื้อและของเสียล่าสุด</summary>{data?.purchases.map(x => <div key={x.id}>#{x.id} · {x.supplier.name} · {x.status}{x.receipts.map(r => <p key={r.id}>{new Date(r.createdAt).toLocaleString('th-TH')} · {r.invoiceRef} · ฿{Number(r.total).toFixed(2)}</p>)}</div>)}{data?.waste.map(x => <p key={x.id}>{x.name} {x.quantity} {x.unit} · {reasons[x.reason] || x.reason} · {x.cost == null ? 'ไม่ทราบต้นทุนเดิม' : `฿${Number(x.cost).toFixed(2)}`}</p>)}</details>
  </div>
}
