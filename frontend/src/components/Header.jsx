/**
 * แถบด้านบนที่ใช้ทุกหน้า (ติดบนสุดตลอดตอนเลื่อนหน้า) มี 3 ส่วน:
 *   1) โลโก้        → กดเปิดเมนูนำทาง (Navbar)
 *   2) กระดิ่ง       → รายการแจ้งเตือนจาก Backend (วัตถุดิบใกล้หมด, ออเดอร์ใหม่ ฯลฯ) ป้ายแดง = จำนวนที่ยังไม่อ่าน
 *                      กดที่แจ้งเตือน = ทำเครื่องหมายอ่านแล้ว + ไปหน้าที่เกี่ยวข้อง (ดู hooks/useNotifications.js)
 *   3) ชื่อผู้ใช้    → กดเปิดเมนู Sign out
 *
 * เมนูทั้ง 3 เปิดได้ "ทีละอัน" ควบคุมด้วย state เดียว (openMenu)
 */
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'
import { useBackNavigation } from '../context/BackNavigationContext.js'
import { useDismiss } from '../hooks/useDismiss.js'
import { timeAgo, useNotifications } from '../hooks/useNotifications.js'
import logo from '../assets/logo-mark.png'
import bell from '../assets/bell.png'
import './Header.css'
import SessionManager from './SessionManager.jsx'

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
  const backNavigation = useBackNavigation()
  const { items: notifications, unread, markRead, markAllRead } = useNotifications()
  const badgeText = unread > 99 ? '99+' : String(unread)

  // ล็อกอินแล้วแสดงชื่อ ยังไม่ล็อกอินแสดง Guest
  const displayName = user?.name || user?.username || 'Guest'

  // กดที่อื่นหรือกด Esc → ปิดทุกเมนู
  useDismiss(openMenu !== null, rootRef, () => setOpenMenu(null))

  // กดปุ่มเดิมซ้ำ = ปิด, กดปุ่มอื่น = สลับไปเปิดอันนั้นแทน
  const toggle = (name) => setOpenMenu((prev) => (prev === name ? null : name))

  // กดที่แจ้งเตือน: ทำเครื่องหมายอ่านแล้ว → ปิดแผง → ไปหน้าที่เกี่ยวข้อง (ถ้ามี)
  const handleOpenNotification = (n) => {
    markRead(n.id)
    setOpenMenu(null)
    if (n.link) navigate(n.link)
  }

  const handleSignOut = () => {
    setOpenMenu(null)
    logout()
    navigate('/login', { replace: true }) // replace: กดย้อนกลับแล้วไม่วนกลับมาหน้าเดิม
  }

  return (
    <header className="app-header" ref={rootRef}>
      {backNavigation && (
        <button
          type="button"
          className="app-header-back"
          disabled={!backNavigation.canGoBack}
          onClick={() => {
            setOpenMenu(null)
            backNavigation.goBack()
          }}
          aria-label="ย้อนกลับ"
        >
          <span aria-hidden="true">←</span> ย้อนกลับ
        </button>
      )}
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
          <img className="app-header-logo" src={logo} alt="" width="56" height="56" />
          <span className="app-header-wordmark">lookahhan<small>SMART · FRESH · FOOD</small></span>
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
          aria-label={`Notifications (${unread} unread)`}
          aria-haspopup="true"
          aria-expanded={openMenu === 'bell'}
        >
          <img src={bell} alt="" />
          {/* ป้ายตัวเลขแสดงเฉพาะเมื่อมีแจ้งเตือนที่ยังไม่อ่าน */}
          {unread > 0 && <span className="app-header-badge">{badgeText}</span>}
        </button>

        {openMenu === 'bell' && (
          <div className="app-header-panel app-header-panel--bell" role="dialog" aria-label="Notifications">
            <div className="app-header-panel-head">
              <p className="app-header-panel-title">Notifications</p>
              <button type="button" className="app-header-readall" onClick={markAllRead} disabled={unread === 0}>
                Mark all as read
              </button>
            </div>

            {notifications.length === 0 ? (
              <p className="app-header-empty">No notifications</p>
            ) : (
              <ul className="app-header-notifications">
                {notifications.map((n) => (
                  <li key={n.id} className={`app-header-notification${n.read ? '' : ' is-unread'}`}>
                    <button type="button" className="app-header-notification-btn" onClick={() => handleOpenNotification(n)}>
                      {/* จุดสีบอกระดับ: danger = แดง, warn = เหลือง, info = น้ำเงิน */}
                      <span className={`app-header-dot app-header-dot--${n.level || 'info'}`} />
                      <span className="app-header-notification-body">
                        <span className="app-header-notification-title">{n.title}</span>
                        {n.message && <span className="app-header-notification-text">{n.message}</span>}
                        <span className="app-header-notification-time">{timeAgo(n.createdAt)}</span>
                      </span>
                    </button>
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
            <details><summary>อุปกรณ์ที่เข้าสู่ระบบ</summary><SessionManager userId={user.id} /></details>
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
