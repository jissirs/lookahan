/**
 * ฟอร์มเมนู — ใช้ร่วมกัน 2 โหมด:
 *   /menu/new         → สร้างเมนูใหม่ แล้วพาไปหน้าสูตรอาหารต่อ (ให้ใส่วัตถุดิบ)
 *   /menu/:id/edit    → แก้ไขเมนูเดิม แล้วกลับหน้า Menu
 *
 * โครงสร้างไฟล์:
 *   MenuFormPage (ตัวนอก)  หาเมนูจาก URL และจัดการกรณี "ไม่พบเมนู"
 *   └ MenuForm (ตัวใน)    ฟอร์มจริง — แยกเพื่อให้กำหนดค่าเริ่มต้นของ state จากเมนูได้ตรงๆ
 */
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ImageUpload from '../../components/ImageUpload.jsx'
import NotFoundMessage from '../../components/NotFoundMessage.jsx'
import PageShell from '../../components/PageShell.jsx'
import PriceField from '../../components/PriceField.jsx'
import ToggleSwitch from '../../components/ToggleSwitch.jsx'
import ModifierEditor from './ModifierEditor.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { MENU_CATEGORIES } from '../../data/options.js'
import './menu.css'

// ค่าเริ่มต้นของเมนูใหม่ (ยังไม่พร้อมขาย จนกว่าจะใส่สูตรและเปิดสวิตช์)
const EMPTY_MENU = {
  name: '',
  category: MENU_CATEGORIES[0],
  price: 20,
  image: '',
  details: '',
  available: false,
  modifiers: [],
}

function MenuForm({ menu }) {
  const navigate = useNavigate()
  const { addMenu, updateMenu } = useInventory()

  // มี menu ส่งมา = โหมดแก้ไข / ไม่มี = โหมดสร้างใหม่
  const isEdit = Boolean(menu)

  const [form, setForm] = useState(() => (menu ? { ...EMPTY_MENU, ...menu } : EMPTY_MENU))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false) // กำลังรอ api

  // ตัวช่วยอัปเดตทีละช่อง: set('price')(25) แทนการเขียน setForm({...form, price: 25})
  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return // กันกดซ้ำระหว่างรอผลจาก api
    if (!e.currentTarget.reportValidity()) return

    const name = form.name.trim()
    if (!name) {
      setError('กรุณากรอกชื่อเมนู')
      return
    }

    // เลือกเฉพาะฟิลด์ที่ฟอร์มนี้แก้ได้ (ไม่แตะ recipe/note ที่แก้ในหน้าสูตรอาหาร)
    const data = {
      name,
      category: form.category,
      price: form.price,
      image: form.image,
      details: form.details,
      available: form.available,
      modifiers: form.modifiers.map(option => ({ ...option, price: Number(option.price), ingredients: option.ingredients.map(line => ({ ...line, qty: Number(line.qty) })) })),
    }

    setSubmitting(true)
    try {
      if (isEdit) {
        // updateMenu แจ้ง error ให้เอง และคืน null เมื่อไม่สำเร็จ — ไม่ต้องย้ายหน้าถ้าไม่สำเร็จ
        const ok = await updateMenu(menu.id, data)
        if (ok) navigate('/menu')
        else setSubmitting(false)
      } else {
        // เมนูใหม่: ไปเพิ่มวัตถุดิบในสูตรอาหารต่อ
        const newId = await addMenu(data)
        navigate(`/menu/${newId}/recipe`)
      }
    } catch (err) {
      // addMenu โยน error ต่อมา (api ปฏิเสธ) → แสดงใต้ช่องชื่อ
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <PageShell>
      {/* noValidate: ปิดข้อความตรวจของเบราว์เซอร์ ใช้ข้อความของเราเอง */}
      <form className="menu-form" onSubmit={handleSubmit} noValidate>
        <div className="menu-form-top">
          <h1 className="menu-form-title">{isEdit ? 'Edit' : 'Create'}</h1>
        </div>

        <div className="menu-form-grid">
          {/* คอลัมน์ซ้าย: รูป + รายละเอียด */}
          <div className="menu-form-left">
            <ImageUpload value={form.image} onChange={set('image')} />

            <div className="field">
              <label className="field-label" htmlFor="menu-details">
                รายละเอียดเมนู
              </label>
              <textarea
                id="menu-details"
                className="field-textarea"
                value={form.details}
                onChange={(e) => set('details')(e.target.value)}
              />
            </div>
          </div>

          {/* คอลัมน์ขวา: ชื่อ ประเภท ราคา สถานะการขาย */}
          <div className="menu-form-right">
            <div className="field">
              <label className="field-label" htmlFor="menu-name">
                ชื่อเมนู
              </label>
              <input
                id="menu-name"
                className="field-input"
                value={form.name}
                onChange={(e) => {
                  set('name')(e.target.value)
                  setError('') // เริ่มพิมพ์ใหม่ = ล้าง error เดิม
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'menu-name-error' : undefined}
              />
              {error && (
                <p className="field-error" id="menu-name-error">
                  {error}
                </p>
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="menu-category">
                ประเภทเมนู
              </label>
              <select
                id="menu-category"
                className="field-select"
                value={form.category}
                onChange={(e) => set('category')(e.target.value)}
              >
                {MENU_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <span className="field-label">ราคา</span>
              <PriceField value={form.price} onChange={set('price')} step={5} />
            </div>

            <div className="field">
              <span className="field-label">สถานะการขาย</span>
              <ToggleSwitch checked={form.available} onChange={set('available')} onLabel="พร้อมขาย" offLabel="ไม่พร้อมขาย" />
            </div>

            <ModifierEditor value={form.modifiers} onChange={set('modifiers')} />
            <div className="menu-form-buttons">
              <button type="submit" className="btn-pill btn-pill--cream" disabled={submitting}>
                {isEdit ? 'บันทึก' : 'บันทึกและเพิ่มสูตร'}
              </button>
              <Link className="btn-pill" to="/menu">
                ยกเลิก
              </Link>
            </div>
          </div>
        </div>
      </form>
    </PageShell>
  )
}

function MenuFormPage() {
  const { id } = useParams() // ไม่มี id = หน้าสร้างใหม่
  const { menus } = useInventory()
  const menu = id ? menus.find((m) => m.id === id) : null

  // มี id ใน URL แต่ไม่พบเมนู (เช่น พิมพ์ URL ผิด)
  if (id && !menu) {
    return <NotFoundMessage message="ไม่พบเมนูนี้" />
  }

  // key: บังคับให้ฟอร์มเริ่มใหม่เมื่อสลับระหว่างเมนู หรือระหว่างแก้ไข/สร้างใหม่
  return <MenuForm key={id ?? 'new'} menu={menu} />
}

export default MenuFormPage
