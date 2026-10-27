import { useEffect, useState } from 'react'
import { api } from '../../services/api.js'
const baht = x => x == null ? 'ไม่ทราบ' : `฿${Number(x).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export default function OperationsReport() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    api.pos.reports(days).then(x => { if (active) setData(x) }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [days, attempt])
  return <section className="restaurant-panel"><h2>ต้นทุนและผลประกอบการ</h2>
    <label>ช่วงย้อนหลัง<select className="field-input" value={days} onChange={e => { setData(null); setError(''); setDays(Number(e.target.value)) }}>{[1, 7, 30, 90].map(x => <option key={x} value={x}>{x} วัน</option>)}</select></label>
    <button onClick={() => { setData(null); setError(''); setAttempt(x => x + 1) }}>รีเฟรช</button>
    {error && <p role="alert">{error}</p>}
    {data && <><p>ยอดขายหลังส่วนลด {baht(data.sales)} · ส่วนลด {baht(data.discounts)} · เงินรับสุทธิตามวันรับเงิน {baht(data.received)}</p>
      <p>ออเดอร์ที่มีต้นทุนครบ {data.knownCostOrders} · ต้นทุนเดิมไม่ครบ {data.unknownCostOrders}</p>
      <p>กำไรขั้นต้นเฉพาะออเดอร์ที่ต้นทุนครบ {baht(data.knownGrossProfit)} · ต้นทุนวัตถุดิบ {baht(data.knownIngredientCost)}</p>
      <p>ของเสียที่ทราบต้นทุน {baht(data.knownWasteCost)} · ไม่ทราบต้นทุน {data.unknownWasteRecords} รายการ · ซื้อจริงตามวันรับของ {baht(data.actualPurchases)}</p>
      <p>กำไรขั้นต้นยังไม่หักค่าแรง ค่าเช่า และค่าใช้จ่ายอื่น ข้อมูลเก่าที่ไม่มีต้นทุน ณ วันขายจะไม่ถูกประมาณให้เป็นกำไรจริง</p>
      <details><summary>ของเสียตามสาเหตุ</summary>{Object.entries(data.wasteByReason).map(([reason, x]) => <p key={reason}>{reason} · {x.records} รายการ · {baht(x.cost)} · ไม่ทราบต้นทุน {x.unknownCost}</p>)}</details>
      <details><summary>รายวัน</summary>{data.daily.map(x => <p key={x.date}>{x.date} · {x.orders} ออเดอร์ · ขาย {baht(x.sales)} · รับเงิน {baht(x.received)}</p>)}</details>
    </>}
  </section>
}
