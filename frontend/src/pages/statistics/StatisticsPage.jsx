/**
 * หน้า Statistics (/statistics) — ภาพรวมของร้านในหน้าเดียว แบ่งเป็น 4 ส่วน:
 *   1) การ์ดสรุป 4 ใบ          วัตถุดิบทั้งหมด / ต้องเติม / เมนูพร้อมขาย / ออเดอร์วันนี้
 *   2) กราฟ                    สถานะ stock ตามหมวด, เติมเข้า-ใช้ออกต่อวัน, สถานะเมนู, ยอดคงเหลือตามเวลา
 *   3) วัตถุดิบที่ใช้บ่อย + วันนี้เทียบพรุ่งนี้ (Ai forecast)
 *   4) การเคลื่อนไหว stock ล่าสุด
 *
 * ข้อมูลมาจากฐานข้อมูลทั้งหมด (stock/เมนู/ประวัติจาก useInventory, สถิติและ forecast จาก useDashboard)
 * การคำนวณอยู่ที่ utils/statistics.js ตัวกราฟอยู่ที่ components/charts/ — หน้านี้ทำหน้าที่ประกอบและจัดวาง
 *
 * ทุกกราฟมีปุ่ม "ตาราง" แสดงข้อมูลชุดเดียวกันเป็นตัวหนังสือ (ดู ChartCard)
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import PlanningSection from './PlanningSection.jsx'
import ClosingSection from './ClosingSection.jsx'
import RestaurantSection from './RestaurantSection.jsx'
import { useAuth } from '../../context/AuthContext.js'
import BorderedTable from '../../components/BorderedTable.jsx'
import BarChart from '../../components/charts/BarChart.jsx'
import ChartCard from '../../components/charts/ChartCard.jsx'
import LineChart from '../../components/charts/LineChart.jsx'
import PageShell from '../../components/PageShell.jsx'
import StatCard from '../../components/StatCard.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { useDashboard } from '../../hooks/useDashboard.js'
import { getMenuStatus } from '../../utils/menuStatus.js'
import { getStockStatus } from '../../utils/stockStatus.js'
import {
  balanceHistory,
  ingredientsWithHistory,
  latestMovements,
  menuStatusCounts,
  movementsPerDay,
  percentChange,
  summarizeByCategory,
  topUsedIngredients,
} from '../../utils/statistics.js'
import './statistics.css'

// ข้อความแทนค่าที่ยังโหลดไม่เสร็จ
const PLACEHOLDER = '—'

// ชื่อหมวดภาษาไทย (แสดงในมุมมองตาราง)
const CATEGORY_THAI = { Meat: 'เนื้อสัตว์', Vegetable: 'ผัก', Fruit: 'ผลไม้', Other: 'อื่นๆ' }

// ---------- ชุดข้อมูลและสีของแต่ละกราฟ (ตัวแปรสีกำหนดใน components/charts/charts.css) ----------

// สถานะ stock: ใช้สีสถานะ + สัญลักษณ์หน้าชื่อ เพื่อไม่ให้สีบอกความหมายอย่างเดียว
const STOCK_SERIES = [
  { key: 'normal', label: 'Normal', color: 'var(--chart-good)', icon: '✓' },
  { key: 'low', label: 'Low', color: 'var(--chart-warning)', icon: '▲' },
  { key: 'critical', label: 'Critical', color: 'var(--chart-critical)', icon: '✕' },
  { key: 'out_of_stock', label: 'Out of stock', color: 'var(--chart-out-of-stock)', icon: '∅' },
]

// เติมเข้า / ใช้ออก: เป็น "ชุดข้อมูลที่แยกกัน" จึงใช้สีแยกชุด (ไม่ใช่สีสถานะ)
const FLOW_SERIES = [
  { key: 'add', label: 'เติมเข้า', color: 'var(--chart-series-1)' },
  { key: 'out', label: 'ใช้ออก', color: 'var(--chart-series-2)' },
]

// สถานะเมนู: พร้อมขาย = ดี, วัตถุดิบไม่พอ = เตือน, ปิดขาย = กลางๆ (สีเทา ไม่เด่น)
const MENU_SERIES = [
  { key: 'ready', label: 'พร้อมขาย', color: 'var(--chart-good)', icon: '✓' },
  { key: 'short', label: 'วัตถุดิบไม่พอ', color: 'var(--chart-serious)', icon: '▲' },
  { key: 'unavailable', label: 'ปิดขาย', color: 'var(--chart-neutral)', icon: '–' },
]

// ---------- ตัวช่วยจัดรูปแบบ ----------

const pad = (n) => String(n).padStart(2, '0')

// "2026-10-07T18:00:00" → "07/10"
const formatDate = (iso) => {
  const d = new Date(iso)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

// → "07/10 18:00"
const formatDateTime = (time) => {
  const d = new Date(time)
  return `${formatDate(time)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 10 → "+10 pcs", -3 → "-3 pcs"
const formatAmount = (amount, unit) => `${amount > 0 ? '+' : '-'}${Math.abs(amount)} ${unit}`

function StatisticsPage() {
  const { user } = useAuth()
  const location = useLocation()
  useEffect(() => {
    if (location.hash === '#closing') document.getElementById('closing')?.scrollIntoView({ block: 'start' })
  }, [location.hash])
  const { ingredients, menus, movements } = useInventory()
  const dashboard = useDashboard() // null ระหว่างโหลด

  // วัตถุดิบที่เลือกดูในกราฟเส้น ('' = ยังไม่เลือก ใช้ตัวแรกในรายการ)
  const [pickedId, setPickedId] = useState('')

  // ----- คำนวณสถิติ (คำนวณใหม่เมื่อข้อมูลเปลี่ยนเท่านั้น) -----
  const categories = useMemo(() => summarizeByCategory(ingredients), [ingredients])
  const perDay = useMemo(() => movementsPerDay(movements), [movements])
  const menuCounts = useMemo(() => menuStatusCounts(menus, ingredients), [menus, ingredients])
  const topUsed = useMemo(() => topUsedIngredients(ingredients, menus), [ingredients, menus])
  const recent = useMemo(() => latestMovements(movements, ingredients), [movements, ingredients])

  // ตัวเลือกของกราฟเส้น: วัตถุดิบที่มีประวัติ — ถ้าตัวที่เลือกไว้ไม่อยู่ในรายการแล้ว ใช้ตัวแรกแทน
  const historyOptions = useMemo(() => ingredientsWithHistory(movements, ingredients), [movements, ingredients])
  const selected = historyOptions.find((i) => i.id === pickedId) ?? historyOptions[0]
  const balancePoints = useMemo(
    () => (selected ? balanceHistory(movements, selected.id) : []),
    [movements, selected],
  )

  const needRestock = ingredients.filter((i) => getStockStatus(i) !== 'normal').length
  const readyMenus = menus.filter((m) => getMenuStatus(m, ingredients) === 'ready').length

  // แถบความยาวของ "วัตถุดิบที่ใช้บ่อย" เทียบกับอันดับ 1 (อันดับ 1 = เต็มแถบ 100%)
  const maxMenuCount = topUsed[0]?.menuCount ?? 1

  // ผลพยากรณ์ของ AI (null = ยังไม่เคยสั่งให้ AI วิเคราะห์ ที่หน้า Ai)
  const forecast = dashboard?.forecast ?? null

  // ออเดอร์พรุ่งนี้เทียบวันนี้ เช่น +13.6% (ยังโหลดไม่เสร็จ หรือยังไม่มีผลพยากรณ์ = null)
  const growth = dashboard && forecast ? percentChange(dashboard.statistics.orders, forecast.orders) : null
  const revenueGrowth = dashboard && forecast?.revenue != null ? percentChange(dashboard.statistics.revenue, forecast.revenue) : null

  return (
    <PageShell>
      <div className="stats-page">
        <h1 className="page-title">Statistics</h1>
        <p><Link className="ai-link" to="/statistics#closing">บันทึกปิดร้านและของเหลือ →</Link></p>

        {/* ---------- 1) การ์ดสรุป ---------- */}
        <section className="stats-summary" aria-label="Summary">
          <StatCard value={ingredients.length} label="วัตถุดิบทั้งหมด" />
          <StatCard value={needRestock} label="ต้องเติม (Low / Critical)" />
          <StatCard value={readyMenus} label={`เมนูพร้อมขาย (จาก ${menus.length})`} />
          <StatCard value={dashboard?.statistics.orders ?? PLACEHOLDER} label="ออเดอร์วันนี้" />
        </section>

        {/* ---------- 2) กราฟ ---------- */}
        <section className="stats-section" aria-labelledby="stats-charts-title">
          <h2 className="stats-heading" id="stats-charts-title">
            กราฟ
          </h2>

          {/* สถานะ stock ตามหมวด: แท่งซ้อนแนวนอน หมวดละ 1 แท่ง */}
          <ChartCard
            title="สถานะ stock ตามหมวด"
            subtitle="จำนวนวัตถุดิบในแต่ละหมวด แยกตามสถานะ"
            legend={STOCK_SERIES}
            table={{
              columns: ['หมวด', 'Normal', 'Low', 'Critical', 'Out of stock', 'รวม'],
              rows: categories.map((c) => [`${c.category} (${CATEGORY_THAI[c.category]})`, c.normal, c.low, c.critical, c.out_of_stock, c.total]),
            }}
          >
            <BarChart
              orientation="horizontal"
              series={STOCK_SERIES}
              unit="รายการ"
              ariaLabel="กราฟแท่งแสดงจำนวนวัตถุดิบตามหมวดและสถานะ"
              data={categories.map((c) => ({ id: c.category, label: c.category, values: c }))}
            />
          </ChartCard>

          <div className="stats-columns">
            {/* เติมเข้า/ใช้ออกต่อวัน: แท่งซ้อนแนวตั้ง แกนนอนคือวัน */}
            <ChartCard
              title="เติมเข้า / ใช้ออก ต่อวัน"
              subtitle="จำนวนครั้งที่เพิ่มและลด stock"
              legend={FLOW_SERIES}
              table={{
                columns: ['วันที่', 'เติมเข้า', 'ใช้ออก'],
                rows: perDay.map((d) => [d.label, d.values.add, d.values.out]),
              }}
            >
              <BarChart
                orientation="vertical"
                series={FLOW_SERIES}
                unit="ครั้ง"
                ariaLabel="กราฟแท่งแสดงจำนวนครั้งที่เติมเข้าและใช้ออกในแต่ละวัน"
                data={perDay.map((d) => ({ id: d.key, label: d.label, values: d.values }))}
              />
            </ChartCard>

            {/* สถานะเมนู: แท่งซ้อนแท่งเดียว แสดงสัดส่วนของเมนูทั้งหมด */}
            <ChartCard
              title="สถานะเมนู"
              subtitle={`เมนูทั้งหมด ${menus.length} รายการ`}
              legend={MENU_SERIES}
              table={{
                columns: ['สถานะ', 'จำนวนเมนู'],
                rows: MENU_SERIES.map((s) => [s.label, menuCounts[s.key]]),
              }}
            >
              <BarChart
                orientation="horizontal"
                series={MENU_SERIES}
                unit="เมนู"
                ariaLabel="กราฟแท่งแสดงจำนวนเมนูตามสถานะ"
                data={[{ id: 'menus', label: 'เมนู', values: menuCounts }]}
              />
            </ChartCard>
          </div>

          {/* ยอดคงเหลือตามเวลา: กราฟเส้น เลือกวัตถุดิบได้ */}
          <ChartCard
            title="ยอดคงเหลือตามเวลา"
            subtitle={selected ? `${selected.name} (${selected.unit}) หลังการเพิ่ม/ลดแต่ละครั้ง` : 'ยังไม่มีประวัติการเคลื่อนไหว'}
            actions={
              <select
                className="chart-select"
                value={selected?.id ?? ''}
                onChange={(e) => setPickedId(e.target.value)}
                aria-label="เลือกวัตถุดิบ"
              >
                {historyOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            }
            table={{
              columns: ['วันเวลา', 'รายการ', 'เปลี่ยน', 'คงเหลือ'],
              rows: balancePoints.map((p) => [
                formatDateTime(p.time),
                p.label,
                formatAmount(p.amount, selected.unit),
                `${p.value} ${selected.unit}`,
              ]),
            }}
          >
            <LineChart
              points={balancePoints}
              color="var(--chart-series-1)"
              unit={selected?.unit ?? ''}
              ariaLabel={`กราฟเส้นแสดงยอดคงเหลือของ ${selected?.name ?? 'วัตถุดิบ'} ตามเวลา`}
            />
          </ChartCard>
        </section>

        {/* ---------- 3) วัตถุดิบที่ใช้บ่อย + วันนี้ vs พรุ่งนี้ ---------- */}
        <div className="stats-columns">
          <section className="stats-section" aria-labelledby="stats-top-title">
            <h2 className="stats-heading" id="stats-top-title">
              วัตถุดิบที่ใช้ในเมนูมากที่สุด
            </h2>

            <ol className="stats-top">
              {topUsed.map(({ ingredient, menuCount }, index) => (
                <li key={ingredient.id} className="stats-top-row">
                  <span className="stats-top-rank">{index + 1}</span>
                  <Link className="stats-top-name" to={`/stock/${ingredient.id}`}>
                    {ingredient.name}
                  </Link>
                  <span className="stats-top-track" aria-hidden="true">
                    <span className="stats-top-fill" style={{ '--share': `${(menuCount / maxMenuCount) * 100}%` }} />
                  </span>
                  <span className="stats-top-count">{menuCount} เมนู</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="stats-section" aria-labelledby="stats-forecast-title">
            <h2 className="stats-heading" id="stats-forecast-title">
              วันนี้ เทียบกับ พรุ่งนี้ (Ai forecast)
            </h2>

            <dl className="stats-compare">
              <div className="stats-compare-row">
                <dt>ออเดอร์</dt>
                <dd>
                  {dashboard?.statistics.orders ?? PLACEHOLDER} → <strong>{forecast?.orders ?? PLACEHOLDER}</strong>
                  {growth !== null && (
                    <span className={`stats-growth ${growth >= 0 ? 'is-up' : 'is-down'}`}>
                      {growth >= 0 ? '▲' : '▼'} {Math.abs(growth)}%
                    </span>
                  )}
                </dd>
              </div>
              <div className="stats-compare-row">
                <dt>{forecast?.revenue != null ? 'รายได้' : 'รายได้วันนี้'}</dt>
                <dd>
                  {dashboard ? `฿${dashboard.statistics.revenue.toLocaleString('en-US')}` : PLACEHOLDER}
                  {forecast?.revenue != null && (
                    <>
                      {' '}
                      → <strong>฿{forecast.revenue.toLocaleString('en-US')}</strong>
                      {revenueGrowth !== null && (
                        <span className={`stats-growth ${revenueGrowth >= 0 ? 'is-up' : 'is-down'}`}>
                          {revenueGrowth >= 0 ? '▲' : '▼'} {Math.abs(revenueGrowth)}%
                        </span>
                      )}
                    </>
                  )}
                </dd>
              </div>
              <div className="stats-compare-row">
                <dt>ช่วงลูกค้าเยอะสุด</dt>
                <dd>{forecast ? `${forecast.peakStart} - ${forecast.peakEnd}` : PLACEHOLDER}</dd>
              </div>
              <div className="stats-compare-row">
                <dt>ขายดีที่สุด</dt>
                <dd>{forecast?.bestSeller ?? PLACEHOLDER}</dd>
              </div>
            </dl>
          </section>
        </div>

        {/* ---------- 4) การเคลื่อนไหวล่าสุด ---------- */}
        <section className="stats-section" aria-labelledby="stats-recent-title">
          <h2 className="stats-heading" id="stats-recent-title">
            การเคลื่อนไหว stock ล่าสุด
          </h2>

          <BorderedTable columns={['Date', 'ingredient', 'Type', 'Amount']}>
            {recent.length === 0 ? (
              <tr>
                <td colSpan={4} className="stock-table-empty">
                  ยังไม่มีประวัติการเคลื่อนไหว
                </td>
              </tr>
            ) : (
              recent.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.date)}</td>
                  <td>{m.name}</td>
                  <td>{m.label}</td>
                  <td>{formatAmount(m.amount, m.unit)}</td>
                </tr>
              ))
            )}
          </BorderedTable>
        </section>
        <PlanningSection />
        <RestaurantSection />
        {user?.role === 'owner' && <details id="closing" className="stats-closing" open={location.hash === '#closing'}>
          <summary>บันทึกปิดร้านและของเหลือ</summary>
          <ClosingSection />
        </details>}
      </div>
    </PageShell>
  )
}

export default StatisticsPage
