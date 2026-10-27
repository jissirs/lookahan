/**
 * หน้า Create ingredient (/stock/new) — สร้างวัตถุดิบใหม่ (เริ่มที่ 0 ชิ้น เติมได้ที่หน้ารายละเอียด)
 *
 * หน้านี้ถูกเรียกได้จาก 2 ที่ และจะ "กลับไปที่เดิม" หลังบันทึก:
 *   - หน้า Stock   → บันทึกแล้วไปหน้ารายละเอียดของวัตถุดิบที่เพิ่งสร้าง
 *   - หน้าสูตรอาหาร → ส่ง state.returnTo มา บันทึกแล้วกลับไปสูตรอาหารต่อ
 */
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import PageShell from '../../components/PageShell.jsx'
import PurchaseFields from '../../components/PurchaseFields.jsx'
import PriceField from '../../components/PriceField.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { INGREDIENT_CATEGORIES, INGREDIENT_UNITS } from '../../data/options.js'
import './stock.css'

function CreateIngredientPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { addIngredient } = useInventory()

  const [name, setName] = useState('')
  const [category, setCategory] = useState(INGREDIENT_CATEGORIES[0])
  const [unit, setUnit] = useState(INGREDIENT_UNITS[0])
  const [purchaseUnit, setPurchaseUnit] = useState(INGREDIENT_UNITS[0])
  const [purchaseSize, setPurchaseSize] = useState(1)
  const [price, setPrice] = useState(20)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false) // กำลังรอ api

  // หน้าที่เรียกมา (เช่น สูตรอาหาร) — ไม่มีให้กลับหน้า Stock
  const returnTo = location.state?.returnTo

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return // กันกดซ้ำระหว่างรอผลจาก api
    if (!e.currentTarget.reportValidity()) return

    // ตรวจเบื้องต้นฝั่งหน้าจอ (ให้ตอบสนองทันที) — กฎจริง เช่น "ชื่อห้ามซ้ำ" ตรวจที่ api
    const trimmed = name.trim()
    if (!trimmed) {
      setError('กรุณากรอกชื่อวัตถุดิบ')
      return
    }

    setSubmitting(true)
    try {
      const newId = await addIngredient({ name: trimmed, category, unit, purchaseUnit, purchaseSize, purchasePrice: price })

      // replace: กดย้อนกลับแล้วไม่วนกลับมาฟอร์มนี้อีก
      navigate(returnTo ?? `/stock/${newId}`, { replace: true })
    } catch (err) {
      // api ปฏิเสธ (เช่น DUPLICATE_NAME) → แสดงข้อความใต้ช่องชื่อ
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <PageShell>
      <div className="create">
        {/* noValidate: ปิดข้อความตรวจของเบราว์เซอร์ ใช้ข้อความของเราเอง */}
        <form className="create-form" onSubmit={handleSubmit} noValidate>
          <h1 className="create-title">Create ingredient</h1>

          <div className="field">
            <label className="field-label" htmlFor="ing-name">
              ชื่อวัตถุดิบ
            </label>
            <input
              id="ing-name"
              className="field-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('') // เริ่มพิมพ์ใหม่ = ล้าง error เดิม
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'ing-name-error' : undefined}
              autoFocus
            />
            {error && (
              <p className="field-error" id="ing-name-error">
                {error}
              </p>
            )}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ing-category">
              ประเภทวัตถุดิบ
            </label>
            <select id="ing-category" className="field-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {INGREDIENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ing-unit">
              หน่วย
            </label>
            <select id="ing-unit" className="field-select" value={unit} onChange={(e) => { setUnit(e.target.value); setPurchaseUnit(e.target.value); setPurchaseSize(1) }}>
              {INGREDIENT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <PurchaseFields unit={unit} purchaseUnit={purchaseUnit} purchaseSize={purchaseSize} onChange={(u, n) => { setPurchaseUnit(u); setPurchaseSize(n) }} />
          <div className="field">
            <span className="field-label">ราคาต่อ {purchaseUnit} (บาท)</span>
            <PriceField value={price} onChange={setPrice} />
          </div>

          <button type="submit" className="btn-pill btn-pill--cream" disabled={submitting}>
            บันทึก
          </button>
        </form>
      </div>
    </PageShell>
  )
}

export default CreateIngredientPage
