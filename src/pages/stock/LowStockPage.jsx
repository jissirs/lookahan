/**
 * หน้า Low stock (/stock/low) — รวมวัตถุดิบที่สถานะ Low หรือ Critical
 * พร้อมจำนวนที่ "ควรมี" (Required ≈) และปุ่มเติม stock ได้ทันที
 * เมื่อเติมจนพ้นสถานะใกล้หมด รายการนั้นจะหายไปจากหน้านี้เอง (คำนวณจากข้อมูลจริงทุกครั้ง)
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import PageShell from '../../components/PageShell.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { askNumber } from '../../utils/dialogs.js'
import { estimateRequired, getStockStatus, stepFor } from '../../utils/stockStatus.js'
import './stock.css'

function LowStockPage() {
  const { ingredients, menus, adjustQuantity } = useInventory()

  // เฉพาะที่ไม่ปกติ เรียงจากเหลือน้อยสุดก่อน แล้วคำนวณ "จำนวนที่ควรมี" ให้แต่ละตัว
  const rows = useMemo(
    () =>
      ingredients
        .filter((item) => getStockStatus(item) !== 'normal')
        .sort((a, b) => a.quantity - b.quantity)
        .map((item) => ({ item, required: estimateRequired(item, menus) })),
    [ingredients, menus],
  )

  // กด [Add Stock] → ถามจำนวน (ค่าเริ่มต้น = ส่วนที่ขาดจากจำนวนที่ควรมี) แล้วเพิ่มเข้า stock
  const handleAdd = async (item, required) => {
    const amount = await askNumber({
      title: `เพิ่ม ${item.name}`,
      text: `คงเหลือ ${item.quantity} ${item.unit} • ต้องการประมาณ ${required} ${item.unit}`,
      value: Math.max(required - item.quantity, stepFor(item.unit)),
      unit: item.unit,
      confirmText: 'เพิ่ม',
    })
    if (amount) adjustQuantity(item.id, amount) // amount เป็น null เมื่อกดยกเลิก
  }

  return (
    <PageShell>
      <div className="low-stock">
        <h1 className="low-stock-title">
          {/* ไอคอนสามเหลี่ยมเตือน (วาดด้วย SVG ให้สีตามตัวอักษร) */}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.5L23 21.5H1L12 2.5z" />
            <path d="M12 9v5.5" />
            <circle cx="12" cy="17.8" r="1" />
          </svg>
          Low stock
        </h1>

        <div className="box low-stock-box">
          {rows.length === 0 ? (
            <p className="page-empty">ไม่มีวัตถุดิบใกล้หมด</p>
          ) : (
            <ul className="low-stock-list">
              {rows.map(({ item, required }) => (
                <li key={item.id} className="low-stock-row">
                  <Link className="low-stock-name" to={`/stock/${item.id}`}>
                    {item.name}
                  </Link>
                  <span className="low-stock-qty">
                    {item.quantity} {item.unit}
                  </span>
                  <span className="low-stock-required">
                    Required ≈ {required} {item.unit}
                  </span>
                  <button type="button" className="low-stock-add" onClick={() => handleAdd(item, required)}>
                    [Add Stock]
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PageShell>
  )
}

export default LowStockPage
