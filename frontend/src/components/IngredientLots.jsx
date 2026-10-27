import { useState } from 'react'
import { api } from '../services/api.js'
import { useInventory } from '../context/InventoryContext.js'
import BorderedTable from './BorderedTable.jsx'
import PurchaseFields from './PurchaseFields.jsx'
import PriceField from './PriceField.jsx'
import { confirmAction } from '../utils/dialogs.js'

// Embedded in the existing stock detail; keyed by ingredient/config after a saved update.
export default function IngredientLots({ item }) {
  const { reload, updateIngredient } = useInventory()
  const [unit, setUnit] = useState(item.purchaseUnit ?? item.unit)
  const [size, setSize] = useState(item.purchaseSize ?? 1)
  const [price, setPrice] = useState(item.purchasePrice ?? item.price)
  const [amount, setAmount] = useState('')
  const [expiry, setExpiry] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (work) => {
    if (busy) return
    setBusy(true); setError('')
    try { await work(); await reload() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <section className="box detail-box">
    <details>
      <summary>หน่วยซื้อและต้นทุน</summary>
      <form className="inventory-form" onSubmit={(e) => {
        e.preventDefault()
        run(() => updateIngredient(item.id, { purchaseUnit: unit, purchaseSize: size, purchasePrice: price }))
      }}>
        <PurchaseFields unit={item.unit} purchaseUnit={unit} purchaseSize={size} onChange={(u, n) => { setUnit(u); setSize(n) }} />
        <label>ราคาต่อ {unit} (บาท)</label>
        <PriceField value={price} onChange={setPrice} />
        <button className="btn-pill" disabled={busy}>บันทึกหน่วยซื้อและราคา</button>
      </form>
    </details>
    <h2 className="detail-section">รับสินค้าและล็อตวันหมดอายุ</h2>
    <p>ใช้ได้ {item.usableQuantity ?? item.quantity} {item.unit} จากคงเหลือทั้งหมด {item.quantity} {item.unit}</p>
    <form className="inventory-form" onSubmit={(e) => {
      e.preventDefault()
      run(async () => {
        await api.inventory.adjustIngredient(item.id, Number(amount), 'รับสินค้า', {
          inPurchaseUnits: true, expiresOn: expiry || null, batchLabel: label,
        })
        setAmount(''); setExpiry(''); setLabel('')
      })
    }}>
      <label>จำนวนที่รับ ({item.purchaseUnit ?? item.unit})
        <input className="field-input" type="number" min="0.001" step={item.unit === 'pcs' ? '1' : '0.001'} required value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label>วันหมดอายุ (ใช้ได้ถึงสิ้นวัน)
        <input className="field-input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </label>
      <label>เลขล็อต / หมายเหตุ
        <input className="field-input" maxLength="120" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <button className="btn-pill" disabled={busy}>รับสินค้า</button>
    </form>
    {error && <p role="alert" className="field-error">{error}</p>}
    <BorderedTable columns={['ล็อต', 'เหลือ', 'หมดอายุ', 'จัดการ']}>
      {(item.batches ?? []).map((batch) => <tr key={batch.id}>
        <td>{batch.label || `#${batch.id}`}</td><td>{batch.remaining} {item.unit}</td>
        <td>{batch.expiresOn ?? 'ไม่ทราบ'}{batch.expired ? ' · หมดอายุ ใช้ไม่ได้' : ''}</td>
        <td><button type="button" disabled={busy} onClick={async () => {
          if (await confirmAction({ title: 'ทิ้งสินค้าคงเหลือทั้งล็อตนี้?', text: `${batch.remaining} ${item.unit}`, confirmText: 'บันทึกของเสีย' })) {
            run(() => api.inventory.discardBatch(item.id, batch.id))
          }
        }}>บันทึกของเสีย</button></td>
      </tr>)}
      {!(item.batches ?? []).length && <tr><td colSpan="4">สต็อกเดิมยังไม่ระบุวันหมดอายุ</td></tr>}
    </BorderedTable>
    <p>ระบบตัดล็อตที่หมดอายุก่อน และคืนล็อตเดิมเมื่อยกเลิกออเดอร์ ของหมดอายุต้องบันทึกทิ้งก่อนนำออกจากคลัง</p>
  </section>
}
