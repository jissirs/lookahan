import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../services/api.js'
import { useInventory } from '../../context/InventoryContext.js'
import BorderedTable from '../../components/BorderedTable.jsx'

const dateAt = (days) => new Date(Date.now() + (7 + days * 24) * 3600000).toISOString().slice(0, 10)

export default function PlanningSection() {
  const { ingredients, menus, orders } = useInventory()
  const [day, setDay] = useState(0)
  const [report, setReport] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const target = dateAt(day)
  useEffect(() => {
    let cancelled = false
    Promise.all([api.dashboard.purchasing(target), api.ai.accuracy()]).then(([plan, actual]) => {
      if (!cancelled) { setReport(plan); setAccuracy(actual); setError('') }
    }).catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [target, ingredients, menus, orders, attempt])
  return <>
    <section className="stats-section">
      <h2 className="stats-heading">แผนซื้อวัตถุดิบรายวัน</h2>
      <div className="planning-controls">
        <label>วางแผนสำหรับ <select className="chart-select" value={day} onChange={(e) => setDay(Number(e.target.value))}>
          <option value="0">วันนี้</option><option value="1">พรุ่งนี้</option>
        </select></label>
        <button type="button" className="btn-pill btn-pill--sm" onClick={() => setAttempt((n) => n + 1)}>คำนวณใหม่</button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {!report || report.date !== target ? <p>กำลังคำนวณ…</p> : <>
        <p>{report.date} · {report.source === 'ai' ? 'ผลพยากรณ์ AI ที่บันทึกไว้ก่อนเริ่มวัน' : `ค่าเฉลี่ยจากประวัติ ${report.sampleDays} วัน (ยังไม่มีผล AI สำหรับวันนี้)`}</p>
        <p>คาด {report.predictedOrders} ออเดอร์ · รับแล้ว {report.acceptedOrders} · เตรียมอีก {report.remainingOrders} · งบซื้อประมาณ ฿{report.estimatedCost.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
        {!report.hasHistory && <p>ยังไม่มีประวัติยอดขายเพียงพอ ระบบจึงยังไม่แนะนำจำนวนซื้อ</p>}
        <BorderedTable columns={['วัตถุดิบ', 'ต้องใช้', 'ใช้ได้ในวันนั้น', 'ควรซื้อ', 'ต้นทุนประมาณ']}>
          {report.ingredients.filter((row) => row.expectedDemand || row.excludedExpired).map((row) => <tr key={row.id}>
            <td><Link to={`/stock/${row.id}`}>{row.name}</Link></td>
            <td>{row.expectedDemand} {row.unit}</td>
            <td>{row.stock} {row.unit}{row.reservedForToday > 0 && <small> · กันไว้ใช้วันนี้ {row.reservedForToday} {row.unit}</small>}{row.excludedExpired > 0 && <small> · ไม่นับของหมดอายุ {row.excludedExpired}</small>}</td>
            <td>{row.suggested > 0 ? `${row.purchaseQuantity} ${row.purchaseUnit} (${row.suggested} ${row.unit})` : 'เพียงพอ'}{row.purchaseExcess > 0 && <small> · เกินความต้องการ {row.purchaseExcess} {row.unit} จากขนาดแพ็ก</small>}</td>
            <td>฿{row.estimatedCost.toFixed(2)}</td>
          </tr>)}
        </BorderedTable>
        <details><summary>จำนวนจานที่ใช้คำนวณตามสูตรอาหาร</summary>
          <p>ตัวเลือกอาหาร เช่น เพิ่มไข่/พิเศษ ใช้อัตราที่ลูกค้าเลือกจริงจาก {report.modifierSampleDishes || 0} จานที่มีข้อมูลตัวเลือก ต้นทุนและปริมาณยังเป็นการคาดการณ์</p>
          <BorderedTable columns={['เมนู', 'จานที่คาดว่าจะขายเพิ่ม']}>
            {report.menus.map((menu) => <tr key={menu.id}><td>{menu.name}</td><td>{menu.portions}</td></tr>)}
          </BorderedTable>
        </details>
        <p>ของสดซื้อเฉพาะส่วนที่ขาดตามสูตร ไม่บวกเผื่อ · แผนพรุ่งนี้หักที่คาดว่าจะใช้วันนี้ก่อน · ตัดของหมดอายุออก · จำนวนคาดการณ์เปลี่ยนได้ตามยอดขายจริง</p>
      </>}
    </section>
    <section className="stats-section">
      <h2 className="stats-heading">ผลพยากรณ์เทียบยอดจริง</h2>
      {!accuracy ? <p>กำลังโหลด…</p> : !accuracy.summary.count ? <p>ยังไม่มีวันที่พยากรณ์ล่วงหน้าและจบวันแล้ว ระบบจะวัดจากยอดจริงโดยไม่สร้างผลย้อนหลังขึ้นมา</p> : <>
        <p>เทียบแล้ว {accuracy.summary.count} วัน · คลาดเฉลี่ย {accuracy.summary.ordersMae ?? '—'} ออเดอร์/วัน · คลาดรวม WAPE {accuracy.summary.ordersWape ?? '—'}% · ค่าเฉลี่ยธรรมดา {accuracy.summary.baselineWape ?? '—'}%</p>
        <p>รวมวันที่ไม่มียอดขาย {accuracy.summary.zeroSalesDays} วัน · ค่าคลาดต่ำกว่าหมายถึงแม่นกว่า · ไม่นับวันที่ยังไม่สิ้นสุด</p>
        <BorderedTable columns={['วันที่', 'AI คาด', 'ยอดจริง', 'ค่าเฉลี่ยธรรมดา', 'คลาดเคลื่อน']}>
          {accuracy.days.map((row) => <tr key={row.date}><td>{row.date}</td><td>{row.forecastOrders}</td><td>{row.actualOrders}</td><td>{row.baselineOrders}</td><td>{row.forecastOrders - row.actualOrders} ออเดอร์</td></tr>)}
        </BorderedTable>
      </>}
    </section>
  </>
}
