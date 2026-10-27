/**
 * หน้ารายละเอียดวัตถุดิบ (/stock/:id)
 *  - ส่วนบน: ชื่อ (เปลี่ยนชื่อได้), จำนวนคงเหลือ + สถานะ, ราคา, ปุ่ม Add / Drop
 *  - ส่วนล่าง: Stock History (ประวัติการเพิ่ม/ลด ใหม่สุดอยู่บนสุด)
 *
 * ปุ่มย้อนกลับใน Header ใช้หน้าต้นทาง เช่น มาจากสูตรอาหารจะกลับไปสูตรอาหาร
 * (หน้าต้นทางส่งมาทาง location.state.from = { to, label })
 */
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import BorderedTable from '../../components/BorderedTable.jsx'
import NotFoundMessage from '../../components/NotFoundMessage.jsx'
import PageShell from '../../components/PageShell.jsx'
import IngredientLots from '../../components/IngredientLots.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { askNumber, askText } from '../../utils/dialogs.js'
import { getStockStatus } from '../../utils/stockStatus.js'
import './stock.css'

// "2026-10-07T14:20:00" → "07/10"
const formatDate = (iso) => {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

// 10 → "+10 pcs", -3 → "-3 pcs"
const formatAmount = (amount, unit) => `${amount > 0 ? '+' : amount < 0 ? '-' : ''}${Math.abs(amount)} ${unit}`

function IngredientDetailPage() {
  const { id } = useParams()
  const { ingredients, movements, adjustQuantity, updateIngredient } = useInventory()

  const item = ingredients.find((i) => i.id === id)

  // ประวัติของวัตถุดิบนี้ เรียงใหม่ → เก่า
  const history = useMemo(
    () => movements.filter((m) => m.ingredientId === id).sort((a, b) => b.date.localeCompare(a.date)),
    [movements, id],
  )

  // ไม่มีวัตถุดิบ id นี้ (เช่น พิมพ์ URL ผิด)
  if (!item) {
    return <NotFoundMessage message="ไม่พบวัตถุดิบนี้" />
  }

  const status = getStockStatus(item)

  // เปลี่ยนชื่อ — ถ้าซ้ำกับวัตถุดิบอื่น api จะปฏิเสธและแสดงกล่องแจ้งเตือนให้เอง
  const handleRename = async () => {
    const name = await askText({ title: 'เปลี่ยนชื่อวัตถุดิบ', value: item.name })
    if (name) updateIngredient(item.id, { name })
  }

  // Add: ถามจำนวนที่จะเติม
  const handleAdd = async () => {
    const amount = await askNumber({
      title: `เพิ่ม ${item.name}`,
      text: `คงเหลือ ${item.quantity} ${item.unit}`,
      unit: item.unit,
      confirmText: 'เพิ่ม',
    })
    if (amount) adjustQuantity(item.id, amount)
  }

  // Drop: ถามจำนวนที่จะลด — จำกัดไม่ให้เกินที่เหลืออยู่ (max) จึงไม่มีทางติดลบ
  const handleDrop = async () => {
    if (item.quantity === 0) return
    const amount = await askNumber({
      title: `ลด ${item.name}`,
      text: `คงเหลือ ${item.quantity} ${item.unit}`,
      max: item.quantity,
      unit: item.unit,
      confirmText: 'ลด',
    })
    if (amount) adjustQuantity(item.id, -amount)
  }

  return (
    <PageShell>
      <div className="detail">
        {/* ---------- ส่วนบน: ข้อมูลปัจจุบัน ---------- */}
        <section className="box detail-box">
          <header className="detail-head">
            <h1 className="detail-name">{item.name}</h1>
            <button type="button" className="btn-pill btn-pill--sm" onClick={handleRename}>
              Rename
            </button>
          </header>

          <div className="detail-body">
            <h2 className="detail-section">Current Stock</h2>

            <div className="detail-current">
              <div className="detail-stock">
                <strong className="detail-qty">
                  {item.quantity} {item.unit}
                </strong>
                <StatusBadge status={status} />
              </div>

              <div className="detail-price">
                <span className="detail-price-label">ราคา</span>
                <strong>฿{item.purchasePrice ?? item.price} / {item.purchaseUnit ?? item.unit}</strong>
              </div>
            </div>

            <div className="detail-actions">
              <button type="button" className="btn-pill btn-pill--lg" onClick={handleAdd}>
                Add
              </button>
              <button type="button" className="btn-pill btn-pill--lg" onClick={handleDrop} disabled={item.quantity === 0}>
                Drop
              </button>
            </div>
          </div>
        </section>

        <IngredientLots key={`${item.id}-${item.purchaseUnit}-${item.purchaseSize}-${item.purchasePrice}`} item={item} />
        {/* ---------- ส่วนล่าง: ประวัติ ---------- */}
        <section className="box detail-box detail-history">
          <h2 className="detail-section">Stock History</h2>
          <BorderedTable columns={['Date', 'Type', 'Amount', 'Balance']} className="history-table">
            {history.length === 0 ? (
              <tr>
                <td colSpan={4} className="stock-table-empty">
                  ยังไม่มีประวัติการเคลื่อนไหว
                </td>
              </tr>
            ) : (
              history.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.date)}</td>
                  <td>{m.label}</td>
                  <td>{formatAmount(m.amount, item.unit)}</td>
                  <td>
                    {m.balance} {item.unit}
                  </td>
                </tr>
              ))
            )}
          </BorderedTable>
        </section>
      </div>
    </PageShell>
  )
}

export default IngredientDetailPage
