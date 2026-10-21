/**
 * แถบด้านบนที่ใช้ทุกหน้า (ติดบนสุดตลอดตอนเลื่อนหน้า) มี 3 ส่วน:
 *   1) โลโก้        → กดเปิดเมนูนำทาง (Navbar)
 *   2) กระดิ่ง       → กดเปิดรายการแจ้งเตือน พร้อมป้ายตัวเลขสีแดง
 *   3) ชื่อผู้ใช้    → กดเปิดเมนู Sign out
 *
 * เมนูทั้ง 3 เปิดได้ "ทีละอัน" ควบคุมด้วย state เดียว (openMenu)
 */
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'
import { useInventory } from '../context/InventoryContext.js'
import { useDismiss } from '../hooks/useDismiss.js'
import { buildStockNotifications } from '../utils/stockStatus.js'
import logo from '../assets/logo.png'
import bell from '../assets/bell.png'
import './Header.css'

// รายการในเมนูนำทาง (หน้า Order / Statistics / Ai ยังไม่ได้สร้าง จึงเด้งกลับหน้าแรกไปก่อน)
const NAV_ITEMS = [
  { label: 'Stock', to: '/stock' },
  { label: 'Menu', to: '/menu' },
  { label: 'Order', to: '/order' },
  { label: 'Statistics', to: '/statistics' },
  { label: 'Ai', to: '/ai' },
]

function Header() {
  // เมนูที่เปิดอยู่ตอนนี้: 'nav' | 'bell' | 'user' | null (ไม่มีอะไรเปิด)
  const [openMenu, setOpenMenu] = useState(null)
  const rootRef = useRef(null)

  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { ingredients } = useInventory()

  // แจ้งเตือนสร้างจากวัตถุดิบที่ Low / Critical ใน stock จริง
  const notifications = buildStockNotifications(ingredients)

  // ล็อกอินแล้วแสดงชื่อ ยังไม่ล็อกอินแสดง Guest
  const displayName = user?.name || user?.username || 'Guest'

  // กดที่อื่นหรือกด Esc → ปิดทุกเมนู
  useDismiss(openMenu !== null, rootRef, () => setOpenMenu(null))

  // กดปุ่มเดิมซ้ำ = ปิด, กดปุ่มอื่น = สลับไปเปิดอันนั้นแทน
  const toggle = (name) => setOpenMenu((prev) => (prev === name ? null : name))

  const handleSignOut = () => {
    setOpenMenu(null)
    logout()
    navigate('/login', { replace: true }) // replace: กดย้อนกลับแล้วไม่วนกลับมาหน้าเดิม
  }

  return (
    <header className="app-header" ref={rootRef}>
      {/* ---------- 1) โลโก้ + เมนูนำทาง ---------- */}
      <div className="app-header-logo-wrap">
        <button
          type="button"
          className="app-header-logo-btn"
          onClick={() => toggle('nav')}
          aria-label="Menu"
          aria-haspopup="true"
          aria-expanded={openMenu === 'nav'}
        >
          <img className="app-header-logo" src={logo} alt="lookahhan" />
        </button>

        {openMenu === 'nav' && (
          <nav className="app-header-nav" aria-label="Main">
            {NAV_ITEMS.map((item) => (
              <Link key={item.to} className="app-header-nav-item" to={item.to} onClick={() => setOpenMenu(null)}>
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {/* ---------- 2) กระดิ่งแจ้งเตือน ---------- */}
      <div className="app-header-bell-wrap">
        <button
          type="button"
          className="app-header-bell"
          onClick={() => toggle('bell')}
          aria-label={`Notifications (${notifications.length})`}
          aria-haspopup="true"
          aria-expanded={openMenu === 'bell'}
        >
          <img src={bell} alt="" />
          {/* ป้ายตัวเลขแสดงเฉพาะเมื่อมีแจ้งเตือน */}
          {notifications.length > 0 && <span className="app-header-badge">{notifications.length}</span>}
        </button>

        {openMenu === 'bell' && (
          <div className="app-header-panel app-header-panel--bell" role="dialog" aria-label="Notifications">
            <p className="app-header-panel-title">Notifications</p>

            {notifications.length === 0 ? (
              <p className="app-header-empty">No notifications</p>
            ) : (
              <ul className="app-header-notifications">
                {notifications.map((n) => (
                  <li key={n.id} className="app-header-notification">
                    {/* จุดสีบอกระดับ: danger = แดง, warn = เหลือง, info = น้ำเงิน */}
                    <span className={`app-header-dot app-header-dot--${n.level || 'info'}`} />
                    {n.to ? (
                      // แจ้งเตือนที่มีปลายทาง → กดแล้วไปหน้านั้นและปิดแผง
                      <Link className="app-header-notification-link" to={n.to} onClick={() => setOpenMenu(null)}>
                        {n.text}
                      </Link>
                    ) : (
                      n.text
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ---------- 3) ชื่อผู้ใช้ + Sign out ---------- */}
      <div className="app-header-user-wrap">
        <button
          type="button"
          className="app-header-user"
          onClick={() => toggle('user')}
          aria-haspopup="menu"
          aria-expanded={openMenu === 'user'}
        >
          <span className="app-header-user-name">{displayName}</span>
          <span className="app-header-caret" aria-hidden="true">▾</span>
        </button>

        {openMenu === 'user' && (
          <div className="app-header-panel app-header-panel--user" role="menu">
            <button type="button" className="app-header-menu-item" role="menuitem" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

export default Header
