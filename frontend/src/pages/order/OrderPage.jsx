/**
 * หน้า Order (/order) — รายการออเดอร์ของร้าน
 *  - การ์ดสถิติ: ออเดอร์ทั้งหมด / รอรับ / กำลังทำ / ยอดขายรวม (ไม่นับที่ยกเลิก)
 *  - ค้นหาตามเลขออเดอร์หรือชื่อเมนู + กรองตามสถานะ (ใช้พร้อมกันได้)
 *  - แต่ละออเดอร์มีปุ่ม "ไปขั้นถัดไป" (รอรับ → กำลังทำ → พร้อมเสิร์ฟ → เสร็จสิ้น) และ "ยกเลิก"
 *  - ปุ่ม "+ สร้างออเดอร์" ไปหน้า /order/new
 *
 * การสร้างออเดอร์ตัด stock ตามสูตรเมนู และการยกเลิกคืน stock ให้ — ทำที่ชั้น API (services/api.js)
 * หน้านี้แค่เรียกใช้ผ่าน useInventory() แล้วแสดงผล
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import FilterDropdown from '../../components/FilterDropdown.jsx'
import PageShell from '../../components/PageShell.jsx'
import SearchBar from '../../components/SearchBar.jsx'
import StatCard from '../../components/StatCard.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { confirmAction } from '../../utils/dialogs.js'
import { ORDER_STATUS, ORDER_STATUS_OPTIONS, isOrderActive, timeAgo } from '../../utils/orderStatus.js'
import './order.css'

const pad = (n) => String(n).padStart(2, '0')

// "2026-10-16T10:32:00" → "10:32"
const formatClock = (iso) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function OrderPage() {
  const { orders, advanceOrder, cancelOrder } = useInventory()

  // ค่าตัวกรอง — '' หมายถึง "ไม่กรอง"
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')

  // ออเดอร์ที่ผ่านทุกเงื่อนไข (เงื่อนไขที่ว่างจะถูกข้าม)
  const visible = useMemo(() => {
    // ค้นหาด้วยเลขออเดอร์ได้ทั้ง "0162" และ "#0162"
    const keyword = query.trim().toLowerCase().replace(/^#/, '')

    return orders.filter(
      (order) =>
        (!status || order.status === status) &&
        (!keyword ||
          order.number.includes(keyword) ||
          order.items.some((item) => item.name.toLowerCase().includes(keyword))),
    )
  }, [orders, query, status])

  // ตัวเลขในการ์ดสถิตินับจากออเดอร์ทั้งหมด (ไม่ขึ้นกับตัวกรอง)
  const waiting = orders.filter((o) => o.status === 'new').length
  const cooking = orders.filter((o) => o.status === 'cooking').length
  const sales = orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + o.total, 0)

  // ยกเลิก: ถามยืนยันก่อน เพราะระบบจะคืน stock และออเดอร์ย้อนกลับไม่ได้
  const handleCancel = async (order) => {
    const ok = await confirmAction({
      title: `ยกเลิกออเดอร์ #${order.number}?`,
      text: 'วัตถุดิบที่ตัดไปแล้วจะถูกคืนเข้า stock',
      confirmText: 'ยกเลิกออเดอร์',
    })
    if (ok) cancelOrder(order.id)
  }

  return (
    <PageShell>
      <div className="order-page">
        <div className="order-title-row">
          <h1 className="page-title">Order</h1>
          <Link className="btn-pill btn-pill--tan" to="/order/new">
            + สร้างออเดอร์
          </Link>
        </div>

        <div className="order-stats">
          <StatCard value={orders.length} label="ออเดอร์ทั้งหมด" />
          <StatCard value={waiting} label="รอรับ" />
          <StatCard value={cooking} label="กำลังทำ" />
          <StatCard value={`฿${sales.toLocaleString('en-US')}`} label="ยอดขายรวม" />
        </div>

        <div className="page-toolbar">
          <SearchBar value={query} onChange={setQuery} placeholder="Search order...." />
          <FilterDropdown label="Status" options={ORDER_STATUS_OPTIONS} value={status} onChange={setStatus} tone="cream" />
        </div>

        <div className="box order-list">
          {visible.length === 0 ? (
            <p className="page-empty">ไม่พบออเดอร์</p>
          ) : (
            visible.map((order) => {
              const info = ORDER_STATUS[order.status]

              return (
                <article key={order.id} className="order-card">
                  <div className="order-card-head">
                    <h2 className="order-card-number">#{order.number}</h2>
                    <p className="order-card-time">
                      {formatClock(order.createdAt)} · {timeAgo(order.createdAt)}
                    </p>
                  </div>

                  <div className="order-card-items">
                    <ul>
                      {order.items.map((item) => (
                        <li key={item.menuId}>
                          {item.name} <span className="order-card-qty">× {item.qty}</span>
                        </li>
                      ))}
                    </ul>
                    {order.note && <p className="order-card-note">หมายเหตุ: {order.note}</p>}
                  </div>

                  <div className="order-card-side">
                    <strong className="order-card-total">฿{order.total.toLocaleString('en-US')}</strong>
                    <span className={`order-chip order-chip--${order.status}`}>{info.label}</span>
                  </div>

                  {/* ปุ่มมีเฉพาะออเดอร์ที่ยังดำเนินการอยู่ (เสร็จสิ้น/ยกเลิกแล้วไม่มีปุ่ม) */}
                  {isOrderActive(order) && (
                    <div className="order-card-actions">
                      <button type="button" className="btn-pill btn-pill--cream btn-pill--sm" onClick={() => advanceOrder(order.id)}>
                        {info.nextLabel}
                      </button>
                      <button type="button" className="btn-pill btn-pill--gray btn-pill--sm" onClick={() => handleCancel(order)}>
                        ยกเลิก
                      </button>
                    </div>
                  )}
                </article>
              )
            })
          )}
        </div>
      </div>
    </PageShell>
  )
}

export default OrderPage
