/**
 * หน้า Menu Management (/menu)
 *  - การ์ดสถิติ 3 ใบ: เมนูทั้งหมด / พร้อมขาย / วัตถุดิบไม่พอ (คำนวณจากสูตรเทียบ stock จริง)
 *  - ค้นหาตามชื่อ + กรองตามประเภท/สถานะ (ใช้พร้อมกันได้)
 *  - การ์ดเมนูแต่ละใบ มีปุ่ม "แก้ไข" และ "ดูสูตรอาหาร"
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import FilterDropdown from '../../components/FilterDropdown.jsx'
import PageShell from '../../components/PageShell.jsx'
import SearchBar from '../../components/SearchBar.jsx'
import StatCard from '../../components/StatCard.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { MENU_CATEGORIES } from '../../data/seed.js'
import { MENU_STATUS_LABEL, getMenuStatus } from '../../utils/menuStatus.js'
import './menu.css'

// ตัวเลือกของ dropdown ตัวกรอง: [{ value, label }]
const CATEGORY_OPTIONS = MENU_CATEGORIES.map((c) => ({ value: c, label: c }))
const STATUS_OPTIONS = Object.entries(MENU_STATUS_LABEL).map(([value, label]) => ({ value, label }))

function MenuPage() {
  const { menus, ingredients } = useInventory()

  // ค่าตัวกรอง — '' หมายถึง "ไม่กรอง"
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')

  // เตรียมข้อมูลที่หน้าจอต้องใช้ของแต่ละเมนู: สถานะ + ชื่อวัตถุดิบในสูตร (เช่น "Chicken, Rice")
  const items = useMemo(
    () =>
      menus.map((menu) => ({
        ...menu,
        status: getMenuStatus(menu, ingredients),
        ingredientNames: menu.recipe
          .map((line) => ingredients.find((i) => i.id === line.ingredientId)?.name)
          .filter(Boolean)
          .join(', '),
      })),
    [menus, ingredients],
  )

  // เมนูที่ผ่านทุกเงื่อนไขการค้นหา/กรอง (เงื่อนไขที่ว่างจะถูกข้าม)
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return items.filter(
      (m) =>
        (!keyword || m.name.toLowerCase().includes(keyword)) &&
        (!category || m.category === category) &&
        (!status || m.status === status),
    )
  }, [items, query, category, status])

  // ตัวเลขในการ์ดสถิตินับจากเมนูทั้งหมด (ไม่ขึ้นกับตัวกรอง)
  const readyCount = items.filter((m) => m.status === 'ready').length
  const shortCount = items.filter((m) => m.status === 'short').length

  return (
    <PageShell>
      <div className="menu-page">
        <h1 className="page-title menu-title">Menu Management</h1>

        <div className="menu-stats">
          <StatCard value={items.length} label="เมนูทั้งหมด" />
          <StatCard value={readyCount} label="พร้อมขาย" />
          <StatCard value={shortCount} label="วัตถุดิบไม่พอ" />
        </div>

        <div className="page-toolbar">
          <SearchBar value={query} onChange={setQuery} placeholder="Search Menu...." />
          <FilterDropdown label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} tone="tan" />
          <FilterDropdown label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} tone="cream" />
          <Link className="btn-pill btn-pill--tan menu-add" to="/menu/new">
            + เพิ่มเมนู
          </Link>
        </div>

        <div className="box menu-list">
          {visible.length === 0 ? (
            <p className="page-empty">ไม่พบเมนู</p>
          ) : (
            visible.map((menu) => (
              <article key={menu.id} className="menu-card">
                {/* ไม่มีรูป → แสดงตัวอักษรแรกของชื่อเมนูแทน */}
                <div className="menu-card-image">
                  {menu.image ? <img src={menu.image} alt={menu.name} /> : <span aria-hidden="true">{menu.name.slice(0, 1)}</span>}
                </div>

                <div className="menu-card-info">
                  <h2 className="menu-card-name">{menu.name}</h2>
                  <p className="menu-card-category">{menu.category}</p>
                  {menu.ingredientNames && <p className="menu-card-ingredients">{menu.ingredientNames}</p>}
                </div>

                <div className="menu-card-price">
                  <strong>{menu.price} ฿</strong>
                  {/* สีของป้ายเปลี่ยนตามสถานะ: ready เขียว / short ส้ม / unavailable เทา */}
                  <span className={`menu-chip menu-chip--${menu.status}`}>{MENU_STATUS_LABEL[menu.status]}</span>
                </div>

                <div className="menu-card-actions">
                  <Link className="btn-pill btn-pill--brown btn-pill--sm" to={`/menu/${menu.id}/edit`}>
                    แก้ไข
                  </Link>
                  <Link className="btn-pill btn-pill--gray btn-pill--sm" to={`/menu/${menu.id}/recipe`}>
                    ดูสูตรอาหาร
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </PageShell>
  )
}

export default MenuPage
