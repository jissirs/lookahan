/**
 * ส่วนบันทึกปิดร้านใน Statistics — นับวัตถุดิบที่เหลือจริง + จดของเสีย
 *
 * ทำไมต้องมี: เป้าหมายของร้านคือ "ใช้วัตถุดิบให้หมดพอดี ของค้างคืนน้อยที่สุด" แต่จะรู้ว่าทำได้จริงไหมต้องวัด
 *   ปิดร้านแล้วได้ "มูลค่าของค้างคืน" และ "ของเสีย" เป็นตัวเลขจริง — AI ใช้ตัวเลขนี้ปรับคำแนะนำของวันถัดไป
 *
 * วิธีใช้ (ในหน้านี้):
 *   1) ช่อง "เหลือจริง" ใส่จำนวนที่นับได้หลังทิ้งของเสียแล้ว (ค่าเริ่มต้น = ตัวเลขที่ระบบคิด)
 *   2) ช่อง "ทิ้ง" ใส่จำนวนของเสีย (ถ้าไม่มีปล่อย 0)
 *   3) กด "ปิดร้านวันนี้" — Backend ปรับ stock ให้เท่าที่นับจริง (วันละครั้ง แก้ไม่ได้)
 *
 * ถ้าวันนี้ปิดร้านไปแล้ว จะแสดงสรุปของการปิดร้านแทนฟอร์ม พร้อมประวัติย้อนหลัง
 */
import { useCallback, useEffect, useState } from 'react'
import StatCard from '../../components/StatCard.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { api } from '../../services/api.js'
import { notify } from '../../utils/dialogs.js'
import './closing.css'

const baht = (value) => `฿${(value ?? 0).toLocaleString('en-US')}`

// แปลงข้อความในช่องกรอกเป็นจำนวนเต็ม (ช่องว่าง = 0, ไม่ใช่จำนวนเต็ม = NaN)
const toWhole = (text) => (text === '' ? 0 : Number(text))

function ClosingSection() {
  const { ingredients, reload } = useInventory()

  // today = ผลจาก GET /closing/today, history = ผลจาก GET /closing/history (null = ยังโหลดไม่เสร็จ)
  const [today, setToday] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')

  // จำนวนที่ผู้ใช้กรอก: { [ingredientId]: { counted: '8', waste: '2' } } — ไม่กรอก = ใช้ค่าเริ่มต้น
  const [inputs, setInputs] = useState({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [todayResult, historyResult] = await Promise.all([api.closing.today(), api.closing.history()])
      setError('')
      setToday(todayResult)
      setHistory(historyResult)
    } catch (err) {
      setError(err.message || 'โหลดข้อมูลไม่สำเร็จ')
    }
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([api.closing.today(), api.closing.history()]).then(([todayResult, historyResult]) => {
      if (active) { setToday(todayResult); setHistory(historyResult) }
    }).catch(err => { if (active) setError(err.message || 'โหลดข้อมูลไม่สำเร็จ') })
    return () => { active = false }
  }, [])

  const setField = (id, field, value) =>
    setInputs((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }))

  // ค่าที่ใช้จริงของแต่ละแถว: ช่อง "เหลือจริง" ว่าง = ใช้จำนวนที่ระบบคิด, ช่อง "ทิ้ง" ว่าง = 0
  const rowValues = (item) => {
    const input = inputs[item.id] ?? {}
    return {
      counted: input.counted === undefined || input.counted === '' ? item.quantity : toWhole(input.counted),
      waste: toWhole(input.waste ?? ''),
    }
  }

  const rows = ingredients.map((item) => ({ item, ...rowValues(item) }))
  const problem = rows.find(({ counted, waste, item }) => !Number.isInteger(counted) || !Number.isInteger(waste) || counted < 0 || waste < 0 || waste > item.quantity)

  // สรุปมูลค่าสดๆ ขณะกรอก (ตัวเลขจริงที่บันทึกคำนวณที่ Backend อีกครั้ง)
  const preview = problem
    ? null
    : {
        leftover: rows.reduce((sum, r) => sum + r.counted * r.item.price, 0),
        waste: rows.reduce((sum, r) => sum + r.waste * r.item.price, 0),
      }

  const handleSubmit = async () => {
    setSaving(true)
    try {
      await api.closing.create({
        note,
        lines: rows.map(({ item, counted, waste }) => ({ ingredientId: item.id, countedQty: counted, wasteQty: waste })),
      })
      await reload() // Backend ปรับ stock ตามที่นับจริงแล้ว → โหลดคลังใหม่
      await load()
      notify({ title: 'ปิดร้านวันนี้เรียบร้อย' })
    } catch (err) {
      notify({ icon: 'error', title: 'ปิดร้านไม่สำเร็จ', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  if (error) {
    return <p className="page-empty" role="alert">{error}</p>
  }
  if (!today || !history) {
    return <p className="page-empty" role="status">กำลังโหลดข้อมูลปิดร้าน…</p>
  }

  const closed = today.closing

  return (
      <div className="closing-page">
        <p className="closing-note">
          ปิดร้านทุกคืน: นับวัตถุดิบที่เหลือจริงและจดของเสีย เพื่อวัดว่า “ของค้างคืนน้อยที่สุด” ได้จริงไหม — AI ใช้ตัวเลขนี้ปรับคำแนะนำของวันถัดไป
        </p>

        {closed ? (
          /* ----- ปิดร้านวันนี้แล้ว: แสดงสรุป ----- */
          <section className="closing-section" aria-labelledby="closing-done-title">
            <h2 className="closing-heading" id="closing-done-title">
              ปิดร้านวันนี้แล้ว ({closed.date})
            </h2>
            <div className="closing-stats">
              <StatCard value={baht(closed.leftoverValue)} label="มูลค่าของที่เหลือค้างคืน" />
              <StatCard value={baht(closed.wasteValue)} label="มูลค่าของเสีย" />
              <StatCard value={baht(closed.varianceValue)} label="ส่วนต่างจากที่ระบบคิด (ติดลบ = ของหาย)" />
              {closed.plannedLeftoverValue != null && (
                <StatCard value={baht(closed.plannedLeftoverValue)} label="ของค้างที่แผนความสดคาดไว้" />
              )}
            </div>
            <table className="closing-table">
              <thead>
                <tr>
                  <th>วัตถุดิบ</th>
                  <th>ระบบคิด</th>
                  <th>ทิ้ง</th>
                  <th>เหลือจริง</th>
                </tr>
              </thead>
              <tbody>
                {closed.lines.map((line) => (
                  <tr key={line.ingredientId}>
                    <td>{line.name}</td>
                    <td>{line.systemQty.toLocaleString('en-US')} {line.unit}</td>
                    <td>{line.wasteQty.toLocaleString('en-US')}</td>
                    <td>{line.countedQty.toLocaleString('en-US')} {line.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {closed.note && <p className="closing-note">หมายเหตุ: {closed.note}</p>}
          </section>
        ) : (
          /* ----- ยังไม่ปิดร้าน: ฟอร์มนับของ ----- */
          <section className="closing-section" aria-labelledby="closing-form-title">
            <h2 className="closing-heading" id="closing-form-title">
              นับของวันนี้ ({today.date})
            </h2>
            {ingredients.length === 0 ? (
              <p className="page-empty">ยังไม่มีวัตถุดิบในระบบ</p>
            ) : (
              <>
                <table className="closing-table">
                  <thead>
                    <tr>
                      <th>วัตถุดิบ</th>
                      <th>ระบบคิดว่ามี</th>
                      <th>ทิ้ง (ของเสีย)</th>
                      <th>เหลือจริง (หลังทิ้ง)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ item, counted, waste }) => {
                      const bad = !Number.isInteger(counted) || !Number.isInteger(waste) || counted < 0 || waste < 0 || waste > item.quantity
                      return (
                        <tr key={item.id} className={bad ? 'is-bad' : ''}>
                          <td>{item.name}</td>
                          <td>
                            {item.quantity.toLocaleString('en-US')} {item.unit}
                          </td>
                          <td>
                            <input
                              className="closing-input"
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              aria-label={`ทิ้ง ${item.name}`}
                              value={inputs[item.id]?.waste ?? ''}
                              placeholder="0"
                              onChange={(e) => setField(item.id, 'waste', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              className="closing-input"
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              aria-label={`เหลือจริง ${item.name}`}
                              value={inputs[item.id]?.counted ?? ''}
                              placeholder={String(item.quantity)}
                              onChange={(e) => setField(item.id, 'counted', e.target.value)}
                            />{' '}
                            {item.unit}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                <label className="closing-note-field">
                  หมายเหตุ (ไม่บังคับ)
                  <input type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>

                <div className="closing-actions">
                  {preview && (
                    <span className="closing-preview">
                      ของเหลือ {baht(preview.leftover)} • ของเสีย {baht(preview.waste)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-pill btn-pill--tan btn-pill--sm"
                    onClick={handleSubmit}
                    disabled={saving || Boolean(problem)}
                    title={problem ? 'มีช่องที่ตัวเลขไม่ถูกต้อง (ต้องเป็นจำนวนเต็ม และทิ้งต้องไม่เกินที่มี)' : undefined}
                  >
                    {saving ? 'กำลังบันทึก…' : 'ปิดร้านวันนี้'}
                  </button>
                </div>
                <p className="closing-note">ปิดร้านแล้วแก้ไขไม่ได้ และระบบจะปรับ stock ให้เท่ากับที่นับจริง</p>
              </>
            )}
          </section>
        )}

        {/* ----- ประวัติ: ของค้าง/ของเสียลดลงไหม ----- */}
        <section className="closing-section" aria-labelledby="closing-history-title">
          <h2 className="closing-heading" id="closing-history-title">
            ย้อนหลัง 30 วัน
          </h2>
          {history.days.length === 0 ? (
            <p className="page-empty">ยังไม่มีประวัติการปิดร้าน</p>
          ) : (
            <>
              <div className="closing-stats">
                <StatCard value={baht(history.summary.averageLeftoverValue)} label="ของค้างคืนเฉลี่ยต่อวัน" />
                <StatCard value={baht(history.summary.averageWasteValue)} label="ของเสียเฉลี่ยต่อวัน" />
                <StatCard value={baht(history.summary.totalWasteValue)} label="ของเสียรวม" />
              </div>
              <table className="closing-table">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ของค้างคืน</th>
                    <th>ของเสีย</th>
                    <th>ส่วนต่าง</th>
                    <th>แผนคาดไว้</th>
                  </tr>
                </thead>
                <tbody>
                  {history.days.map((day) => (
                    <tr key={day.id}>
                      <td>{day.date}</td>
                      <td>{baht(day.leftoverValue)}</td>
                      <td>{baht(day.wasteValue)}</td>
                      <td>{baht(day.varianceValue)}</td>
                      <td>{day.plannedLeftoverValue == null ? '—' : baht(day.plannedLeftoverValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
  )
}

export default ClosingSection
