/**
 * หน้าแรก (Dashboard) — ทางลัดไปหน้าหลัก, Ai forecast, Low stock และสถิติวันนี้
 *
 * ข้อมูลมาจากฐานข้อมูล (ผ่าน api) ทั้งหมด:
 *   - การ์ด Low stock และกระดิ่งใน Header   ← useInventory() (stock จริง)
 *   - สถิติวันนี้ และ Ai forecast            ← useDashboard() (สถิติจากออเดอร์จริง; ผลพยากรณ์มาจาก AI และถูกวิเคราะห์อัตโนมัติเมื่อไม่มีหรือเก่าเกิน 6 ชม.)
 * ระหว่างรอข้อมูลของการ์ดสถิติ/forecast จะแสดง "—" ไว้ก่อน
 */
import { Link } from 'react-router-dom'
import Header from '../../components/Header.jsx'
import LiveDateTime from '../../components/LiveDateTime.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { useDashboard } from '../../hooks/useDashboard.js'
import { getStockStatus } from '../../utils/stockStatus.js'
import robot from '../../assets/robot.png'
import orderIcon from '../../assets/order-icon.png'
import clockIcon from '../../assets/clock-icon.png'
import awardIcon from '../../assets/award-icon.png'
import './HomePage.css'

// ---------- ค่าคงที่ของหน้า ----------

// ข้อความแทนค่าที่ยังโหลดไม่เสร็จ
const PLACEHOLDER = '—'

// การ์ดทางลัด 3 ใบด้านบน (เป็นเมนูนำทาง ไม่ใช่ข้อมูลจากฐานข้อมูล)
const SHORTCUTS = [
  { key: 'stock', title: 'Stock', heading: 'วัตถุดิบ', unit: 'รายการ', button: 'ดู Stock', to: '/stock' },
  { key: 'order', title: 'Order', heading: 'ออเดอร์วันนี้', unit: 'รายการ', button: 'ดู Order', to: '/order' },
  { key: 'menu', title: 'Menu', heading: 'เมนูทั้งหมด', unit: 'เมนู', button: 'ดู Menu', to: '/menu' },
]

// ---------- การแปลงสถานะ stock → สี/ข้อความของการ์ด Low stock ----------

// สถานะจาก utils → ชื่อคลาสสี (ok = เขียว, warn = เหลือง, danger = แดง) ที่ใช้ใน HomePage.css
const LEVEL_OF = { normal: 'ok', low: 'warn', critical: 'danger' }
const LEVEL_LABEL = { ok: 'ปกติ', warn: 'ใกล้หมด', danger: 'วิกฤต' }

// ลำดับความเร่งด่วน: ค่าน้อย = ต้องเติมก่อน (ใช้เรียงในการ์ด Low stock)
const URGENCY = { critical: 0, low: 1, normal: 2 }

// ---------- ส่วนย่อยของหน้า ----------

/** แถวทางลัด 3 การ์ด: Stock / Order / Menu */
function ShortcutCards() {
  return (
    <section className="home-shortcuts" aria-label="Shortcuts">
      {SHORTCUTS.map(({ key, title, heading, unit, button, to }) => (
        <article key={key} className={`home-shortcut home-shortcut--${key}`}>
          <h2 className="home-shortcut-title">{title}</h2>
          <p className="home-shortcut-heading">{heading}</p>
          <p className="home-shortcut-unit">{unit}</p>
          <Link className="home-shortcut-button" to={to}>
            {button}
          </Link>
        </article>
      ))}
    </section>
  )
}

/**
 * การ์ด Ai forecast
 * @param {{ orders: number, peakStart: string, peakEnd: string, bestSeller: string } | undefined} forecast
 *        ยังโหลดไม่เสร็จ = undefined → แสดง "—"
 */
function ForecastSection({ forecast }) {
  return (
    <section className="home-block" aria-labelledby="forecast-title">
      <h2 className="home-section-title" id="forecast-title">
        Ai forecast
      </h2>

      <div className="home-forecast">
        <div className="home-forecast-body">
          <p className="home-forecast-eyebrow">คาดการณ์ออเดอร์วันพรุ่งนี้</p>

          <div className="home-forecast-hero">
            <span className="home-forecast-number">{forecast?.orders ?? PLACEHOLDER}</span>
            <span className="home-forecast-unit">Order</span>
            <img className="home-forecast-hero-icon" src={orderIcon} alt="" />
          </div>

          <ul className="home-forecast-list">
            <li>
              <span className="home-chip">
                <img src={clockIcon} alt="" />
              </span>
              <span>
                ช่วงเวลา {forecast ? `${forecast.peakStart} - ${forecast.peakEnd}` : PLACEHOLDER} คาดว่าลูกค้าเยอะสุด
              </span>
            </li>
            <li>
              <span className="home-chip">
                <img src={awardIcon} alt="" />
              </span>
              <span>{forecast?.bestSeller ?? PLACEHOLDER} คาดว่าจะขายดีที่สุด</span>
            </li>
            {/* รายได้ที่ AI คาดว่าจะได้พรุ่งนี้ (ผลรุ่นเก่าที่ยังไม่มีค่านี้จะไม่แสดง) */}
            {forecast?.revenue != null && (
              <li>
                <span className="home-chip">
                  <img src={orderIcon} alt="" />
                </span>
                <span>รายได้พรุ่งนี้ประมาณ ฿{forecast.revenue.toLocaleString('en-US')}</span>
              </li>
            )}
          </ul>
        </div>

        {/* หุ่นยนต์วางมุมขวาล่างของการ์ด (ตำแหน่งกำหนดใน CSS) */}
        <img className="home-forecast-robot" src={robot} alt="" />
      </div>
    </section>
  )
}

/** การ์ด Low stock — 3 วัตถุดิบที่ต้องเติมเร่งด่วนที่สุดจาก stock จริง */
function LowStockCard() {
  const { ingredients } = useInventory()

  // ใส่สถานะให้แต่ละรายการ → เรียงตามความเร่งด่วน (Critical ก่อน Low ก่อน Normal)
  // ถ้าความเร่งด่วนเท่ากัน เรียงจากจำนวนน้อยไปมาก → เอา 3 อันแรก
  const lowest = ingredients
    .map((item) => ({ ...item, status: getStockStatus(item) }))
    .sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || a.quantity - b.quantity)
    .slice(0, 3)
    .map((item) => ({ ...item, level: LEVEL_OF[item.status] }))

  // ป้ายสรุปนับเฉพาะที่ต้องเติมจริง (ไม่นับสถานะปกติ)
  const needRestock = lowest.filter((item) => item.level !== 'ok').length

  return (
    <article className="home-card">
      <header className="home-card-head">
        <h2 className="home-card-title">Low stock</h2>
        <span className="home-card-badge">{needRestock} รายการต้องเติม</span>
      </header>

      <ul className="home-low-stock">
        {lowest.map((item) => (
          <li key={item.id} className="home-low-stock-row">
            <span className={`home-dot home-dot--${item.level}`} />
            <span className="home-low-stock-name">{item.name}</span>
            <span className="home-low-stock-qty">
              {item.quantity} {item.unit}
            </span>
            <span className={`home-status home-status--${item.level}`}>{LEVEL_LABEL[item.level]}</span>
          </li>
        ))}
      </ul>

      <Link className="home-card-link" to="/stock">
        จัดการ Stock <span aria-hidden="true">→</span>
      </Link>
    </article>
  )
}

/**
 * การ์ดสถิติวันนี้
 * @param {{ orders: number, revenue: number, bestSeller: string } | undefined} statistics
 *        ยังโหลดไม่เสร็จ = undefined → แสดง "—"
 */
function StatsCard({ statistics }) {
  // เตรียมแถวที่จะแสดง (จัดรูปแบบตัวเลข: 7000 → ฿7,000)
  const rows = [
    { label: 'Orders', value: statistics?.orders ?? PLACEHOLDER },
    { label: 'Revenue', value: statistics ? `฿${statistics.revenue.toLocaleString('en-US')}` : PLACEHOLDER },
    { label: 'Best Seller', value: statistics?.bestSeller ?? PLACEHOLDER },
  ]

  return (
    <article className="home-card">
      <header className="home-card-head">
        <h2 className="home-card-title">Today Statistics</h2>
      </header>

      <ul className="home-stats">
        {rows.map((item) => (
          <li key={item.label} className="home-stats-row">
            <span className="home-stats-label">{item.label}</span>
            <span className="home-stats-value">{item.value}</span>
          </li>
        ))}
      </ul>

      <Link className="home-card-link" to="/statistics">
        ดู Statistics <span aria-hidden="true">→</span>
      </Link>
    </article>
  )
}

// ---------- หน้า ----------

function HomePage() {
  // สถิติวันนี้ + forecast จากฐานข้อมูล (null ระหว่างโหลด)
  const dashboard = useDashboard()

  return (
    <div className="home-page">
      <Header />

      <main className="home-container">
        <div className="home-title-row">
          <h1 className="home-title">Dashboard</h1>
          <LiveDateTime />
        </div>

        <ShortcutCards />
        <ForecastSection forecast={dashboard?.forecast} />

        <section className="home-summary" aria-label="Summary">
          <LowStockCard />
          <StatsCard statistics={dashboard?.statistics} />
        </section>
      </main>
    </div>
  )
}

export default HomePage
