/**
 * หน้า Ai (/ai) — ผู้ช่วยวิเคราะห์ร้านในหน้าเดียว ตามลำดับที่ผู้ใช้ควรอ่าน:
 *   1) สรุปจาก AI              ประโยคสั้นๆ ของสิ่งที่ควรรู้พรุ่งนี้
 *   2) ตัวเลขสำคัญ 4 ใบ        ออเดอร์พรุ่งนี้ / ช่วงเยอะสุด / ช่วงเงียบสุด / ประเภทขายดี
 *   3) กราฟ                    ออเดอร์รายชั่วโมง, สัดส่วนประเภทเมนู, เมนูที่ใกล้ทำไม่ได้
 *   4) คำแนะนำ                 ควรเติมวัตถุดิบอะไร (กด "นำไปใช้" เติม stock ได้เลย แล้วให้ความเห็น)
 *   5) เมนูที่ขายไม่ได้ตอนนี้    พร้อมวัตถุดิบที่ขาด
 *
 * วงจรของคำแนะนำ (ตามเอกสาร requirement): AI แนะนำ → นำไปปรับใช้ → ให้ feedback
 *
 * ที่มาของข้อมูล: ผลพยากรณ์ (รายชั่วโมง, สัดส่วนประเภท, คำแนะนำ) มาจาก AI (Groq) ผ่าน Backend
 * AI วิเคราะห์ให้อัตโนมัติ (ดู hooks/useDashboard.js) เมื่อยังไม่มีผลหรือผลเก่ากว่า 6 ชั่วโมง — ปุ่ม "ให้ AI วิเคราะห์ใหม่" ไว้สั่งเองเมื่อต้องการ
 * ส่วน "ควรเติมวัตถุดิบอะไรเท่าไร" คำนวณด้วยโค้ดใน utils/aiInsights.js จากผลพยากรณ์ + stock และสูตรเมนูจริง (เลขต้องแม่น จึงไม่ให้ AI คิดเอง)
 * ถ้ายังไม่มีผล (เช่น ยังไม่มีออเดอร์) จะแสดงหน้าว่างพร้อมเหตุผลและปุ่มวิเคราะห์เอง
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BarChart from '../../components/charts/BarChart.jsx'
import ChartCard from '../../components/charts/ChartCard.jsx'
import PageShell from '../../components/PageShell.jsx'
import StatCard from '../../components/StatCard.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { useAiFeedback } from '../../hooks/useAiFeedback.js'
import { useDashboard } from '../../hooks/useDashboard.js'
import { refreshNotifications } from '../../hooks/useNotifications.js'
import { api } from '../../services/api.js'
import { askFeedback, notify } from '../../utils/dialogs.js'
import { STATUS_LABEL, getStockStatus } from '../../utils/stockStatus.js'
import {
  blockedMenus,
  buildRestockRecommendations,
  buildSummary,
  menuCapacity,
  peakAndLow,
} from '../../utils/aiInsights.js'
import robot from '../../assets/robot.png'
import './ai.css'

const CAPACITY_LIMIT = 8 // แสดงกี่เมนูในกราฟ "ทำได้อีกกี่จาน"

// ชุดข้อมูลของกราฟ (ตัวแปรสีกำหนดใน components/charts/charts.css) — ทุกกราฟในหน้านี้มีชุดเดียว จึงใช้สีเดียว
const ORDERS_SERIES = [{ key: 'orders', label: 'ออเดอร์ที่คาดว่าจะเข้า', color: 'var(--chart-series-1)' }]
const SHARE_SERIES = [{ key: 'share', label: 'สัดส่วน', color: 'var(--chart-series-1)' }]
const CAPACITY_SERIES = [{ key: 'portions', label: 'ทำได้อีก', color: 'var(--chart-series-1)' }]
const ACCURACY_SERIES = [{ key: 'error', label: 'ออเดอร์ที่คลาดจากยอดจริง', color: 'var(--chart-series-1)' }]
const REVENUE_SERIES = [{ key: 'revenue', label: 'รายได้ที่คาดว่าจะได้', color: 'var(--chart-series-1)' }]

// ป้ายระดับความสำคัญของคำแนะนำ
const PRIORITY_LABEL = { high: 'สำคัญมาก', medium: 'ปานกลาง' }

function AiPage() {
  const { ingredients, menus, adjustQuantity, addMenu } = useInventory()
  const dashboard = useDashboard() // null ระหว่างโหลด
  const { feedback, sendFeedback } = useAiFeedback()

  // ความแม่นของ AI (ผลพยากรณ์เทียบยอดจริง) และผลปิดร้านจริง — โหลดแยก ไม่รอผลพยากรณ์ (ล้มเหลวก็แค่ไม่แสดงส่วนนั้น)
  const [accuracy, setAccuracy] = useState(null)
  const [closingHistory, setClosingHistory] = useState(null)
  useEffect(() => {
    api.ai.accuracy().then(setAccuracy).catch(() => {})
    api.closing.history().then(setClosingHistory).catch(() => {})
  }, [])
  const [addedSpecials, setAddedSpecials] = useState([]) // ชื่อเมนูพิเศษที่กดสร้างเป็นเมนูร่างแล้ว

  // ผลที่เพิ่งสั่งให้ AI วิเคราะห์ในหน้านี้ (ใช้แทนค่าจาก dashboard ทันทีโดยไม่ต้องโหลดใหม่)
  const [refreshed, setRefreshed] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const forecast = refreshed ?? dashboard?.forecast ?? null

  // ----- ให้ AI วิเคราะห์ (คำนวณใหม่เมื่อ stock/เมนู/ผลพยากรณ์เปลี่ยน) -----
  const insights = useMemo(() => {
    if (!forecast) return null

    const recommendations = buildRestockRecommendations({ ingredients, menus, forecast })
    const blocked = blockedMenus(menus, ingredients)

    // เมนูที่เปิดขายและมีสูตร เรียงจากทำได้อีก "น้อยที่สุด" ก่อน — เมนูที่เสี่ยงทำไม่ได้อยู่บนสุด
    const capacity = menus
      .filter((menu) => menu.available)
      .map((menu) => ({ menu, capacity: menuCapacity(menu, ingredients) }))
      .filter((row) => row.capacity)
      .sort((a, b) => a.capacity.portions - b.capacity.portions)
      .slice(0, CAPACITY_LIMIT)

    return {
      ...peakAndLow(forecast.hourly),
      recommendations,
      blocked,
      capacity,
      summary: buildSummary({ forecast, recommendations, blocked }),
      topCategory: [...forecast.categories].sort((a, b) => b.share - a.share)[0],
    }
  }, [forecast, ingredients, menus])

  // ----- นำคำแนะนำไปใช้: เติม stock ตามที่แนะนำ แล้วถามความเห็น -----
  const handleApply = async (rec) => {
    const ok = await adjustQuantity(rec.ingredient.id, rec.suggested, 'AI suggestion')
    if (!ok) return // เติมไม่สำเร็จ (adjustQuantity แสดงข้อผิดพลาดให้แล้ว)

    // หลังเติมแล้วคำแนะนำนี้จะหายจากรายการ (stock พอแล้ว) จึงถามความเห็นตรงนี้เลย
    const helpful = await askFeedback({
      title: `เติม ${rec.ingredient.name} +${rec.suggested} ${rec.ingredient.unit} แล้ว`,
      text: 'คำแนะนำนี้มีประโยชน์ไหม?',
    })
    if (helpful !== null) sendFeedback(rec.key, helpful)
  }

  // ----- สร้างเมนูพิเศษที่ AI เสนอเป็น "เมนูร่าง" (ยังไม่เปิดขาย) ให้ผู้ใช้ตรวจแล้วเปิดเองที่หน้า Menu -----
  const handleAddSpecial = async (special) => {
    try {
      await addMenu({
        name: special.name,
        category: special.category,
        price: special.price,
        available: false,
        recipe: special.ingredients.map((line) => ({ ingredientId: line.ingredientId, qty: line.qty })),
      })
      setAddedSpecials((names) => [...names, special.name])
      notify({ title: `สร้างเมนูร่าง “${special.name}” แล้ว`, text: 'ไปเปิดขายได้ที่หน้า Menu' })
    } catch (err) {
      notify({ icon: 'error', title: 'สร้างเมนูไม่สำเร็จ', text: err.message })
    }
  }

  // ----- สั่งให้ AI วิเคราะห์ (ใช้เวลาหลายวินาที ระหว่างนั้นกดซ้ำไม่ได้) -----
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      setRefreshed(await api.ai.createForecast())
      refreshNotifications() // AI วิเคราะห์เสร็จ → Backend สร้างแจ้งเตือน
    } catch (err) {
      notify({ icon: 'error', title: 'AI วิเคราะห์ไม่สำเร็จ', text: err.message })
    } finally {
      setRefreshing(false)
    }
  }

  const analyzeButton = (
    <button
      className="btn-pill btn-pill--tan btn-pill--sm"
      type="button"
      onClick={handleRefresh}
      disabled={refreshing || dashboard?.analyzing}
    >
      {refreshing || dashboard?.analyzing ? 'AI กำลังวิเคราะห์…' : forecast ? 'ให้ AI วิเคราะห์ใหม่' : 'ให้ AI วิเคราะห์'}
    </button>
  )

  // ยังโหลดข้อมูลหน้าแรกไม่เสร็จ
  if (!dashboard) {
    return (
      <PageShell>
        <p className="page-empty">กำลังโหลดข้อมูล…</p>
      </PageShell>
    )
  }

  // ยังไม่เคยให้ AI วิเคราะห์ → หน้าว่างพร้อมปุ่มเริ่ม
  if (!insights) {
    return (
      <PageShell>
        <div className="ai-page">
          <div className="ai-title-row">
            <h1 className="page-title">Ai</h1>
            {analyzeButton}
          </div>
          {dashboard.analyzing ? (
            <p className="page-empty">AI กำลังวิเคราะห์ประวัติออเดอร์… (ใช้เวลาสักครู่)</p>
          ) : (
            <p className="page-empty">
              ยังไม่มีผลพยากรณ์
              {dashboard.analysisError ? ` — ${dashboard.analysisError}` : ' — กดปุ่มเพื่อให้ AI วิเคราะห์'}
              <br />
              (AI วิเคราะห์ให้อัตโนมัติเมื่อมีออเดอร์ในระบบอย่างน้อย 1 ใบ)
            </p>
          )}
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="ai-page">
        <div className="ai-title-row">
          <h1 className="page-title">Ai</h1>
          {analyzeButton}
          {forecast.generatedAt && <span className="ai-generated">วิเคราะห์เมื่อ {new Date(forecast.generatedAt).toLocaleString('th-TH')}</span>}
        </div>

        {/* ---------- 1) สรุปจาก AI ---------- */}
        <section className="ai-hero" aria-labelledby="ai-summary-title">
          <div className="ai-hero-body">
            <h2 className="ai-heading" id="ai-summary-title">
              สรุปจาก AI
            </h2>
            <ul className="ai-summary">
              {/* สรุปจากตัวเลข + คำแนะนำที่ AI เขียนเอง */}
              {[...insights.summary, ...(forecast.advice ?? [])].map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <img className="ai-hero-robot" src={robot} alt="" />
        </section>

        {/* ---------- 2) ตัวเลขสำคัญ ---------- */}
        <section className="ai-stats" aria-label="Forecast summary">
          <StatCard value={forecast.orders} label="ออเดอร์ที่คาดว่าจะเข้าพรุ่งนี้" />
          {forecast.revenue != null && <StatCard value={`฿${forecast.revenue.toLocaleString('en-US')}`} label="รายได้ที่คาดว่าจะได้พรุ่งนี้" />}
          <StatCard value={`${insights.peak.start}–${insights.peak.end}`} label="ช่วงลูกค้าเยอะสุด" />
          <StatCard value={insights.low.hour} label="ชั่วโมงที่เงียบสุด" />
          <StatCard value={insights.topCategory.category} label={`ประเภทขายดี (${Math.round(insights.topCategory.share * 100)}%)`} />
        </section>

        {/* ---------- 2.1) AI เตือน (ผ่านการตรวจกับ stock จริงแล้วที่ Backend) ---------- */}
        {forecast.alerts?.length > 0 && (
          <section className="ai-section" aria-labelledby="ai-alerts-title">
            <h2 className="ai-heading" id="ai-alerts-title">
              AI เตือน
            </h2>
            <p className="ai-note">วัตถุดิบใกล้หมดและเมนูที่วัตถุดิบไม่พอทำ ณ เวลาที่ AI วิเคราะห์ (เตือนที่กระดิ่งด้วย)</p>
            <ul className="ai-alerts">
              {forecast.alerts.map((alert) => (
                <li key={`${alert.type}-${alert.name}`} className={`ai-alert ai-alert--${alert.level}`}>
                  <span className="ai-alert-dot" aria-hidden="true" />
                  <div>
                    <p className="ai-alert-title">{alert.title}</p>
                    <p className="ai-alert-text">
                      {alert.message} <span className="ai-alert-detail">({alert.detail})</span>
                    </p>
                  </div>
                  <Link className="ai-link" to={alert.link}>
                    ดู
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------- 2.2) สถานะวัตถุดิบ: โค้ดนับจาก stock ตอนนี้ + AI สรุปเป็นประโยค ---------- */}
        <section className="ai-section" aria-labelledby="ai-inventory-title">
          <h2 className="ai-heading" id="ai-inventory-title">
            สถานะวัตถุดิบ
          </h2>
          <ul className="ai-inventory">
            <li>
              <strong>{ingredients.length}</strong> รายการทั้งหมด
            </li>
            {['normal', 'low', 'critical'].map((status) => (
              <li key={status} className={`ai-inventory-${status}`}>
                <strong>{ingredients.filter((i) => getStockStatus(i) === status).length}</strong> {STATUS_LABEL[status]}
              </li>
            ))}
          </ul>
          {forecast.inventory?.check && <p className="ai-note">AI สรุป: {forecast.inventory.check}</p>}
        </section>

        {/* ---------- 3) กราฟ ---------- */}
        <section className="ai-section" aria-labelledby="ai-charts-title">
          <h2 className="ai-heading" id="ai-charts-title">
            กราฟพยากรณ์
          </h2>

          <div className="ai-columns">
            <ChartCard
              title="ออเดอร์ที่คาดว่าจะเข้า รายชั่วโมง"
              subtitle={`ช่วงเยอะสุด ${insights.peak.start}–${insights.peak.end} • เงียบสุด ${insights.low.hour}`}
              table={{
                columns: ['ชั่วโมง', 'ออเดอร์ที่คาดว่าจะเข้า'],
                rows: forecast.hourly.map((h) => [h.hour, h.orders]),
              }}
            >
              <BarChart
                orientation="vertical"
                series={ORDERS_SERIES}
                unit="ออเดอร์"
                ariaLabel="กราฟแท่งแสดงจำนวนออเดอร์ที่คาดว่าจะเข้าในแต่ละชั่วโมงของพรุ่งนี้"
                data={forecast.hourly.map((h) => ({ id: h.hour, label: h.hour.slice(0, 2), title: h.hour, values: { orders: h.orders } }))}
              />
            </ChartCard>

            <ChartCard
              title="สัดส่วนประเภทเมนูที่คาดว่าจะขาย"
              subtitle="เปอร์เซ็นต์ของออเดอร์พรุ่งนี้"
              table={{
                columns: ['ประเภท', 'สัดส่วน (%)', 'ประมาณ (ออเดอร์)'],
                rows: forecast.categories.map((c) => [c.category, Math.round(c.share * 100), Math.round(c.share * forecast.orders)]),
              }}
            >
              <BarChart
                orientation="horizontal"
                series={SHARE_SERIES}
                unit="%"
                labelWidth={104}
                ariaLabel="กราฟแท่งแสดงสัดส่วนประเภทเมนูที่คาดว่าจะขายพรุ่งนี้"
                data={forecast.categories.map((c) => ({ id: c.category, label: c.category, values: { share: Math.round(c.share * 100) } }))}
              />
            </ChartCard>
          </div>

          {/* รายได้ที่คาดว่าจะได้ รายวัน 7 วันข้างหน้า (วันแรก = พรุ่งนี้) */}
          {forecast.daily && (
            <div className="ai-chart-block">
              <ChartCard
                title="รายได้ที่คาดว่าจะได้ รายวัน"
                subtitle={`7 วันข้างหน้า • รวมประมาณ ฿${forecast.daily.reduce((sum, d) => sum + d.revenue, 0).toLocaleString('en-US')} • เฉลี่ย ฿${forecast.avgOrderValue?.toLocaleString('en-US') ?? '—'} ต่อออเดอร์`}
                table={{
                  columns: ['วัน', 'วันที่', 'ออเดอร์ที่คาด', 'รายได้ที่คาด (บาท)'],
                  rows: forecast.daily.map((d) => [d.weekday, d.date, d.orders, d.revenue]),
                }}
              >
                <BarChart
                  orientation="vertical"
                  series={REVENUE_SERIES}
                  unit="บาท"
                  ariaLabel="กราฟแท่งแสดงรายได้ที่คาดว่าจะได้ในแต่ละวันของ 7 วันข้างหน้า"
                  data={forecast.daily.map((d) => ({ id: d.date, label: d.weekday.slice(0, 3), title: `${d.weekday} ${d.date}`, values: { revenue: d.revenue } }))}
                />
              </ChartCard>
            </div>
          )}

          {/* เมนูที่ใกล้ทำไม่ได้: ทำได้อีกกี่จานจาก stock ตอนนี้ (ตัวที่หมดก่อนคือคอขวด) */}
          <ChartCard
            title="เมนูที่เสี่ยงทำไม่ได้"
            subtitle={`${CAPACITY_LIMIT} เมนูที่ทำได้อีกน้อยที่สุดจาก stock ตอนนี้`}
            table={{
              columns: ['เมนู', 'ทำได้อีก (จาน)', 'วัตถุดิบที่หมดก่อน'],
              rows: insights.capacity.map((row) => [row.menu.name, row.capacity.portions, row.capacity.bottleneck?.name ?? '—']),
            }}
          >
            <BarChart
              orientation="horizontal"
              series={CAPACITY_SERIES}
              unit="จาน"
              labelWidth={150}
              ariaLabel="กราฟแท่งแสดงจำนวนจานที่ทำได้อีกของเมนูที่เสี่ยงทำไม่ได้"
              data={insights.capacity.map((row) => ({ id: row.menu.id, label: row.menu.name, values: { portions: row.capacity.portions } }))}
            />
          </ChartCard>
        </section>

        {/* ---------- 3.1) ความสดของวัตถุดิบ: ใช้ให้หมดพอดี ของค้างคืนน้อยที่สุด ---------- */}
        {forecast.outlook && (
          <section className="ai-section" aria-labelledby="ai-fresh-title">
            <h2 className="ai-heading" id="ai-fresh-title">
              ความสดของวัตถุดิบ
            </h2>
            <p className="ai-note">
              เป้าหมาย: ใช้วัตถุดิบประกอบออเดอร์ให้หมดพอดี ของค้างคืนน้อยที่สุด — เติมเท่าที่ขาดเท่านั้น ส่วนที่คาดว่าจะเหลือให้โปรโมตเมนูที่ใช้มันให้หมด
            </p>

            <div className={`ai-fresh-score ${forecast.outlook.leftoverPct <= 20 ? 'is-good' : forecast.outlook.leftoverPct <= 50 ? 'is-ok' : 'is-bad'}`}>
              <strong>฿{forecast.outlook.leftoverValue.toLocaleString('en-US')}</strong>
              <span>
                คาดว่าจะเหลือค้างคืน ({forecast.outlook.leftoverPct}% ของมูลค่า stock ที่เกี่ยวกับเมนู ฿{forecast.outlook.stockValue.toLocaleString('en-US')})
                — ยิ่งน้อยยิ่งสด
              </span>
            </div>

            {/* ผลจริงจากการปิดร้าน (หน้า Closing) — เทียบกับที่แผนคาดไว้ */}
            {closingHistory?.days.length > 0 && (
              <p className="ai-note">
                ผลจริงจากการปิดร้านล่าสุด ({closingHistory.days[0].date}): เหลือค้างคืน ฿{closingHistory.days[0].leftoverValue.toLocaleString('en-US')} • ของเสีย ฿
                {closingHistory.days[0].wasteValue.toLocaleString('en-US')} • เฉลี่ยย้อนหลัง {closingHistory.summary.count} วัน: ค้างคืน ฿
                {closingHistory.summary.averageLeftoverValue.toLocaleString('en-US')}/วัน — บันทึกที่หน้า{' '}
                <Link className="ai-link" to="/closing">
                  Closing
                </Link>
              </p>
            )}

            {forecast.outlook.useUp.length === 0 ? (
              <p className="page-empty">ไม่มีวัตถุดิบที่คาดว่าจะเหลือค้างคืน 🎉</p>
            ) : (
              <ul className="ai-recs">
                {forecast.outlook.useUp.map((row) => (
                  <li key={row.id} className="ai-rec ai-rec--medium">
                    <div className="ai-rec-main">
                      <div className="ai-rec-head">
                        <h3 className="ai-rec-title">
                          {row.name} คาดว่าเหลือค้าง {row.leftover.toLocaleString('en-US')} {row.unit}
                        </h3>
                        <span className="ai-priority ai-priority--medium">ค้างคืน ≈ ฿{row.leftoverValue.toLocaleString('en-US')}</span>
                      </div>
                      <p className="ai-rec-detail">
                        มีอยู่ {row.stock.toLocaleString('en-US')} {row.unit} แต่คาดว่าพรุ่งนี้ใช้ {row.expectedDemand.toLocaleString('en-US')} {row.unit} — ไม่ต้องเติม
                      </p>
                      <p className="ai-rec-detail">
                        ควรโปรโมตเมนู: <strong>{row.menus.join(', ')}</strong> เพื่อใช้ให้หมด •{' '}
                        <Link className="ai-link" to={`/stock/${row.id}`}>
                          ดูใน Stock
                        </Link>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ---------- 3.2) เมนูพิเศษจากของที่เหลือ (AI คิดเมนู โค้ดตรวจวัตถุดิบ/ปริมาณ/ราคาให้แล้ว) ---------- */}
        {forecast.specials?.length > 0 && (
          <section className="ai-section" aria-labelledby="ai-specials-title">
            <h2 className="ai-heading" id="ai-specials-title">
              เมนูพิเศษจากของที่เหลือ
            </h2>
            <p className="ai-note">AI เสนอเมนูที่ใช้วัตถุดิบที่คาดว่าจะเหลือค้างคืน ราคาตั้งให้ได้กำไร — กดสร้างเป็นเมนูร่าง แล้วไปเปิดขายที่หน้า Menu</p>
            <ul className="ai-recs">
              {forecast.specials.map((special) => (
                <li key={special.name} className="ai-rec ai-rec--medium">
                  <div className="ai-rec-main">
                    <div className="ai-rec-head">
                      <h3 className="ai-rec-title">{special.name}</h3>
                      <span className="ai-priority ai-priority--medium">
                        ราคา ฿{special.price.toLocaleString('en-US')} (ต้นทุน ฿{special.cost.toLocaleString('en-US')})
                      </span>
                    </div>
                    {special.description && <p className="ai-rec-detail">{special.description}</p>}
                    <p className="ai-rec-detail">
                      ใช้: {special.ingredients.map((line) => `${line.name} ${line.qty.toLocaleString('en-US')} ${line.unit}`).join(', ')} • ช่วยใช้ของที่เหลือ:{' '}
                      <strong>{special.uses.join(', ')}</strong>
                    </p>
                  </div>
                  <div className="ai-rec-actions">
                    <button
                      type="button"
                      className="btn-pill btn-pill--cream btn-pill--sm"
                      disabled={addedSpecials.includes(special.name) || menus.some((menu) => menu.name === special.name)}
                      onClick={() => handleAddSpecial(special)}
                    >
                      {addedSpecials.includes(special.name) ? 'สร้างแล้ว' : 'สร้างเป็นเมนูร่าง'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------- 3.3) ความแม่นของ AI: พยากรณ์ vs ยอดจริง ---------- */}
        {accuracy && (
          <section className="ai-section" aria-labelledby="ai-accuracy-title">
            <h2 className="ai-heading" id="ai-accuracy-title">
              ความแม่นของ AI
            </h2>
            {accuracy.summary.count === 0 ? (
              <p className="ai-note">ยังไม่มีข้อมูลเทียบ — ระบบเก็บผลพยากรณ์ทุกวัน แล้วเทียบกับยอดจริงเมื่อวันนั้นผ่านไป (พรุ่งนี้จะเริ่มมีให้ดู)</p>
            ) : (
              <>
                <p className="ai-note">
                  {accuracy.summary.count} วันที่เทียบได้ • ออเดอร์คลาดเฉลี่ย {accuracy.summary.ordersMape ?? '—'}%
                  {accuracy.summary.bias != null && ` • โน้มเอียง ${accuracy.summary.bias > 0 ? 'พยากรณ์สูงเกิน' : accuracy.summary.bias < 0 ? 'พยากรณ์ต่ำเกิน' : 'ไม่เอนเอียง'} (${accuracy.summary.bias}%)`}
                  {accuracy.summary.aiBeatsBaseline != null &&
                    (accuracy.summary.aiBeatsBaseline
                      ? ` • AI แม่นกว่าสถิติธรรมดา (คลาด ${accuracy.summary.baselineMape}%)`
                      : ` • สถิติธรรมดาแม่นกว่า AI (คลาด ${accuracy.summary.baselineMape}%) — AI จะปรับตัวจากผลเหล่านี้ในรอบถัดไป`)}
                </p>
                <ChartCard
                  title="ออเดอร์ที่ AI พยากรณ์คลาดจากยอดจริง"
                  subtitle="รายวัน — คลาดมากแปลว่าพยากรณ์ห่างจากยอดจริงมาก (ดูตัวเลขเต็มในตาราง)"
                  table={{
                    columns: ['วันที่', 'AI พยากรณ์', 'ยอดจริง', 'สถิติธรรมดา', 'คลาด (%)'],
                    rows: accuracy.days.map((d) => [d.date, d.forecastOrders, d.actualOrders, d.baselineOrders, d.ordersErrorPct ?? '—']),
                  }}
                >
                  <BarChart
                    orientation="vertical"
                    series={ACCURACY_SERIES}
                    unit="ออเดอร์"
                    ariaLabel="กราฟแท่งแสดงจำนวนออเดอร์ที่ AI พยากรณ์คลาดจากยอดจริงรายวัน"
                    data={[...accuracy.days].reverse().map((d) => ({
                      id: d.date,
                      label: d.date.slice(5),
                      title: d.date,
                      values: { error: Math.abs(d.forecastOrders - d.actualOrders) },
                    }))}
                  />
                </ChartCard>
              </>
            )}
          </section>
        )}

        {/* ---------- 4) คำแนะนำ ---------- */}
        <section className="ai-section" aria-labelledby="ai-recs-title">
          <h2 className="ai-heading" id="ai-recs-title">
            คำแนะนำจาก AI
          </h2>
          <p className="ai-note">
            {forecast.outlook
              ? 'เติมเท่าที่ "ขาดพอดี" เท่านั้น (ไม่เติมเผื่อ) เพื่อให้ใช้หมดภายในวันและของค้างคืนน้อยที่สุด — คำนวณจากออเดอร์ที่คาดว่าจะเข้าพรุ่งนี้ × สูตรเมนู เทียบกับ stock โดยแบ่งออเดอร์ให้แต่ละเมนูตามยอดขายในอดีต'
              : 'คำนวณจากออเดอร์ที่คาดว่าจะเข้าพรุ่งนี้ เทียบกับ stock และสูตรเมนู (สมมติว่าออเดอร์แบ่งตามสัดส่วนประเภทเมนู และแบ่งให้เมนูที่เปิดขายในประเภทเดียวกันเท่าๆ กัน)'}
          </p>

          {insights.recommendations.length === 0 ? (
            <p className="page-empty">ตอนนี้วัตถุดิบทุกตัวพอรับออเดอร์พรุ่งนี้ ไม่มีคำแนะนำเพิ่ม</p>
          ) : (
            <ul className="ai-recs">
              {insights.recommendations.map((rec) => (
                <li key={rec.key} className={`ai-rec ai-rec--${rec.priority}`}>
                  <div className="ai-rec-main">
                    <div className="ai-rec-head">
                      <h3 className="ai-rec-title">
                        เติม {rec.ingredient.name} อีก {rec.suggested.toLocaleString('en-US')} {rec.ingredient.unit}
                      </h3>
                      <span className={`ai-priority ai-priority--${rec.priority}`}>{PRIORITY_LABEL[rec.priority]}</span>
                    </div>

                    <p className="ai-rec-detail">
                      คาดว่าพรุ่งนี้ใช้ {rec.demand.toLocaleString('en-US')} {rec.ingredient.unit} แต่เหลือ{' '}
                      {rec.ingredient.quantity.toLocaleString('en-US')} {rec.ingredient.unit}
                    </p>
                    <p className="ai-rec-detail">
                      ใช้มากในเมนู: {rec.usedBy.join(', ')} •{' '}
                      <Link className="ai-link" to={`/stock/${rec.ingredient.id}`}>
                        ดูใน Stock
                      </Link>
                    </p>
                  </div>

                  <div className="ai-rec-actions">
                    <button type="button" className="btn-pill btn-pill--cream btn-pill--sm" onClick={() => handleApply(rec)}>
                      นำไปใช้ (เติม stock)
                    </button>

                    {/* ให้ความเห็นได้โดยไม่ต้องนำไปใช้ — กดซ้ำเพื่อเปลี่ยนความเห็น */}
                    <div className="ai-feedback" role="group" aria-label="คำแนะนำนี้มีประโยชน์ไหม">
                      <button type="button" aria-pressed={feedback[rec.key] === true} onClick={() => sendFeedback(rec.key, true)} aria-label="มีประโยชน์">
                        👍
                      </button>
                      <button type="button" aria-pressed={feedback[rec.key] === false} onClick={() => sendFeedback(rec.key, false)} aria-label="ยังไม่ใช่">
                        👎
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- 5) เมนูที่ขายไม่ได้ตอนนี้ ---------- */}
        <section className="ai-section" aria-labelledby="ai-blocked-title">
          <h2 className="ai-heading" id="ai-blocked-title">
            เมนูที่ขายไม่ได้ตอนนี้
          </h2>

          {insights.blocked.length === 0 ? (
            <p className="page-empty">ทุกเมนูที่เปิดขายมีวัตถุดิบพอ</p>
          ) : (
            <ul className="ai-blocked">
              {insights.blocked.map(({ menu, missing }) => (
                <li key={menu.id} className="ai-blocked-row">
                  <strong>{menu.name}</strong>
                  <span>
                    ขาด{' '}
                    {missing.map(({ ingredient, need }, index) => (
                      <span key={ingredient.id}>
                        {index > 0 && ', '}
                        <Link className="ai-link" to={`/stock/${ingredient.id}`}>
                          {ingredient.name}
                        </Link>{' '}
                        (ต้องใช้ {need} เหลือ {ingredient.quantity} {ingredient.unit})
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  )
}

export default AiPage
