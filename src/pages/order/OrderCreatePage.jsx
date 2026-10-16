/**
 * หน้าสร้างออเดอร์ (/order/new)
 *  - เลือกเมนูและจำนวน (เมนูที่ปิดขายหรือวัตถุดิบไม่พอจะเลือกไม่ได้)
 *  - กด "สร้างออเดอร์" → api ตัด stock ตามสูตรของทุกเมนูที่เลือก (รวมวัตถุดิบที่ซ้ำกันก่อน)
 *    ถ้าวัตถุดิบรวมไม่พอ api จะปฏิเสธทั้งออเดอร์ และข้อความบอกว่าตัวไหนขาดเท่าไร จะแสดงใต้ปุ่ม
 *
 * state ของหน้า: quantities = { [menuId]: จำนวนที่เลือก } เก็บเฉพาะเมนูที่เลือก (จำนวน > 0)
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BackLink from '../../components/BackLink.jsx'
import PageShell from '../../components/PageShell.jsx'
import SearchBar from '../../components/SearchBar.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { MENU_STATUS_LABEL, getMenuStatus } from '../../utils/menuStatus.js'
import { notify } from '../../utils/dialogs.js'
import './order.css'

const MAX_QTY = 99 // ต่อเมนู (ตรงกับกฎของ api)

function OrderCreatePage() {
  const navigate = useNavigate()
  const { menus, ingredients, createOrder } = useInventory()

  const [query, setQuery] = useState('')
  const [quantities, setQuantities] = useState({}) // { menuId: จำนวน }
  const [note, setNote] = useState('')
  const [error, setError] = useState('') // ข้อความจาก api เมื่อสร้างไม่สำเร็จ
  const [submitting, setSubmitting] = useState(false) // กำลังรอ api (กันกดซ้ำ)

  // เมนูที่แสดง: ใส่สถานะให้แต่ละเมนู แล้วกรองด้วยคำค้นหา
  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return menus
      .map((menu) => ({ menu, status: getMenuStatus(menu, ingredients) }))
      .filter(({ menu }) => !keyword || menu.name.toLowerCase().includes(keyword))
  }, [menus, ingredients, query])

  // เปลี่ยนจำนวนของเมนู (จำกัด 0–MAX_QTY) — จำนวน 0 = เอาออกจากรายการที่เลือก
  const changeQty = (menuId, delta) => {
    setError('') // แก้รายการแล้ว ข้อความ error เดิมไม่เกี่ยวแล้ว
    setQuantities((prev) => {
      const next = Math.min(MAX_QTY, Math.max(0, (prev[menuId] ?? 0) + delta))
      const { [menuId]: _removed, ...rest } = prev // eslint-disable-line no-unused-vars
      return next > 0 ? { ...rest, [menuId]: next } : rest
    })
  }

  // สรุปที่เลือก: จำนวนจานทั้งหมด และราคารวม
  const selected = menus.filter((m) => quantities[m.id] > 0)
  const totalQty = selected.reduce((sum, m) => sum + quantities[m.id], 0)
  const totalPrice = selected.reduce((sum, m) => sum + m.price * quantities[m.id], 0)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting || selected.length === 0) return

    setSubmitting(true)
    setError('')
    try {
      const number = await createOrder({
        items: selected.map((m) => ({ menuId: m.id, qty: quantities[m.id] })),
        note,
      })

      await notify({ icon: 'success', title: `สร้างออเดอร์ #${number} แล้ว`, text: 'ตัด stock ตามสูตรเมนูเรียบร้อย' })
      navigate('/order', { replace: true })
    } catch (err) {
      // เช่น INSUFFICIENT_STOCK → แสดงใต้ปุ่มให้ผู้ใช้ลดจำนวนหรือเปลี่ยนเมนู
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <PageShell>
      <form className="order-create" onSubmit={handleSubmit} noValidate>
        <div className="order-create-top">
          <BackLink to="/order" label="Order" />
          <h1 className="page-title">Create order</h1>
        </div>

        <div className="page-toolbar">
          <SearchBar value={query} onChange={setQuery} placeholder="Search menu...." />
        </div>

        {/* ---------- รายการเมนูให้เลือก ---------- */}
        <ul className="box order-menu-list">
          {rows.length === 0 && <li className="page-empty">ไม่พบเมนู</li>}

          {rows.map(({ menu, status }) => {
            const qty = quantities[menu.id] ?? 0
            const orderable = status === 'ready' // เลือกได้เฉพาะเมนูที่พร้อมขาย

            return (
              <li key={menu.id} className={`order-menu-row${orderable ? '' : ' is-disabled'}`}>
                <div className="order-menu-info">
                  <strong>{menu.name}</strong>
                  <span>{menu.category}</span>
                </div>

                <span className="order-menu-price">฿{menu.price}</span>

                {orderable ? (
                  <div className="qty-control" role="group" aria-label={`จำนวน ${menu.name}`}>
                    <button type="button" onClick={() => changeQty(menu.id, -1)} disabled={qty === 0} aria-label={`ลด ${menu.name}`}>
                      −
                    </button>
                    <output aria-live="polite">{qty}</output>
                    <button type="button" onClick={() => changeQty(menu.id, 1)} disabled={qty >= MAX_QTY} aria-label={`เพิ่ม ${menu.name}`}>
                      +
                    </button>
                  </div>
                ) : (
                  // เลือกไม่ได้: บอกเหตุผล (ปิดขาย / วัตถุดิบไม่พอ)
                  <span className={`menu-chip menu-chip--${status}`}>{MENU_STATUS_LABEL[status]}</span>
                )}
              </li>
            )
          })}
        </ul>

        {/* ---------- สรุปและส่ง ---------- */}
        <section className="box order-summary" aria-label="สรุปออเดอร์">
          <div className="order-summary-lines">
            {selected.length === 0 ? (
              <p className="order-summary-empty">ยังไม่ได้เลือกเมนู</p>
            ) : (
              <ul>
                {selected.map((m) => (
                  <li key={m.id}>
                    {m.name} × {quantities[m.id]}
                    <span>฿{(m.price * quantities[m.id]).toLocaleString('en-US')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="order-summary-side">
            <label className="field-label" htmlFor="order-note">
              หมายเหตุ(ถ้ามี)
            </label>
            <input id="order-note" className="field-input" value={note} onChange={(e) => setNote(e.target.value)} />

            <p className="order-summary-total">
              รวม {totalQty} จาน <strong>฿{totalPrice.toLocaleString('en-US')}</strong>
            </p>

            <button type="submit" className="btn-pill btn-pill--cream" disabled={submitting || selected.length === 0}>
              {submitting ? 'กำลังสร้าง…' : 'สร้างออเดอร์'}
            </button>

            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
      </form>
    </PageShell>
  )
}

export default OrderCreatePage
