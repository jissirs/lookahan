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
 * ⚠ โหมดจำลอง: ผลพยากรณ์มาจากข้อมูลจำลองในฐานข้อมูล และคำแนะนำคำนวณด้วยกฎใน utils/aiInsights.js
 *   ยังไม่ได้เรียกโมเดล AI จริง (หน้าจอแจ้งผู้ใช้ไว้ในป้าย "โหมดจำลอง")
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import BarChart from '../../components/charts/BarChart.jsx'
import ChartCard from '../../components/charts/ChartCard.jsx'
import PageShell from '../../components/PageShell.jsx'
import StatCard from '../../components/StatCard.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { useAiFeedback } from '../../hooks/useAiFeedback.js'
import { useDashboard } from '../../hooks/useDashboard.js'
import { askFeedback } from '../../utils/dialogs.js'
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

// ป้ายระดับความสำคัญของคำแนะนำ
const PRIORITY_LABEL = { high: 'สำคัญมาก', medium: 'ปานกลาง' }

function AiPage() {
  const { ingredients, menus, adjustQuantity } = useInventory()
  const dashboard = useDashboard() // null ระหว่างโหลด
  const { feedback, sendFeedback } = useAiFeedback()

  const forecast = dashboard?.forecast

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

  // ยังไม่ได้ผลพยากรณ์ → แสดงข้อความรอ
  if (!insights) {
    return (
      <PageShell>
        <p className="page-empty">กำลังให้ AI วิเคราะห์ข้อมูล…</p>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="ai-page">
        <div className="ai-title-row">
          <h1 className="page-title">Ai</h1>
          {/* บอกผู้ใช้ตรงๆ ว่ายังเป็นโหมดจำลอง */}
          <span className="ai-badge" title="ผลพยากรณ์เป็นข้อมูลจำลอง คำแนะนำคำนวณจากสูตรและ stock จริงในระบบ ยังไม่ได้เรียกโมเดล AI จริง">
            โหมดจำลอง
          </span>
        </div>

        {/* ---------- 1) สรุปจาก AI ---------- */}
        <section className="ai-hero" aria-labelledby="ai-summary-title">
          <div className="ai-hero-body">
            <h2 className="ai-heading" id="ai-summary-title">
              สรุปจาก AI
            </h2>
            <ul className="ai-summary">
              {insights.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <img className="ai-hero-robot" src={robot} alt="" />
        </section>

        {/* ---------- 2) ตัวเลขสำคัญ ---------- */}
        <section className="ai-stats" aria-label="Forecast summary">
          <StatCard value={forecast.orders} label="ออเดอร์ที่คาดว่าจะเข้าพรุ่งนี้" />
          <StatCard value={`${insights.peak.start}–${insights.peak.end}`} label="ช่วงลูกค้าเยอะสุด" />
          <StatCard value={insights.low.hour} label="ชั่วโมงที่เงียบสุด" />
          <StatCard value={insights.topCategory.category} label={`ประเภทขายดี (${Math.round(insights.topCategory.share * 100)}%)`} />
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

        {/* ---------- 4) คำแนะนำ ---------- */}
        <section className="ai-section" aria-labelledby="ai-recs-title">
          <h2 className="ai-heading" id="ai-recs-title">
            คำแนะนำจาก AI
          </h2>
          <p className="ai-note">
            คำนวณจากออเดอร์ที่คาดว่าจะเข้าพรุ่งนี้ เทียบกับ stock และสูตรเมนู (สมมติว่าออเดอร์แบ่งตามสัดส่วนประเภทเมนู และแบ่งให้เมนูที่เปิดขายในประเภทเดียวกันเท่าๆ กัน)
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
