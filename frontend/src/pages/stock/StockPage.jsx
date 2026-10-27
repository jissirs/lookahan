/**
 * หน้า Stock (/stock) — ตารางวัตถุดิบทั้งหมด
 *  - ค้นหาตามชื่อ + กรองตาม Category / Status (ใช้พร้อมกันได้ ผลคือ "ต้องตรงทุกเงื่อนไข")
 *  - กดชื่อวัตถุดิบ → ไปหน้ารายละเอียด
 *  - ปุ่ม ⋮ ท้ายแถว → + / − ปรับจำนวนได้ทันที
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BorderedTable from '../../components/BorderedTable.jsx'
import FilterDropdown from '../../components/FilterDropdown.jsx'
import PageShell from '../../components/PageShell.jsx'
import RowActions from '../../components/RowActions.jsx'
import SearchBar from '../../components/SearchBar.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { useAuth } from '../../context/AuthContext.js'
import { INGREDIENT_CATEGORIES } from '../../data/options.js'
import { STATUS_LABEL, getStockStatus, stepFor } from '../../utils/stockStatus.js'
import { confirmAction } from '../../utils/dialogs.js'
import { api } from '../../services/api.js'
import PurchasingSection from './PurchasingSection.jsx'

// ตัวเลือกของ dropdown ตัวกรอง: [{ value, label }]
const CATEGORY_OPTIONS = INGREDIENT_CATEGORIES.map((c) => ({ value: c, label: c }))
const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))

function StockPage() {
  const { user } = useAuth()
  const { ingredients, adjustQuantity, deleteIngredient, restoreIngredient } = useInventory()
  const [showDeleted, setShowDeleted] = useState(false)
  const [purchasingOpen, setPurchasingOpen] = useState(false)
  const [deleted, setDeleted] = useState([])
  const [deletedError, setDeletedError] = useState('')
  const [loadingDeleted, setLoadingDeleted] = useState(false)
  const [deletedAttempt, setDeletedAttempt] = useState(0)

  useEffect(() => {
    if (!showDeleted) return undefined
    let cancelled = false
    api.inventory.listDeletedIngredients().then((items) => {
      if (!cancelled) { setDeleted(items); setDeletedError(''); setLoadingDeleted(false) }
    }).catch((err) => {
      if (!cancelled) { setDeletedError(err.message); setLoadingDeleted(false) }
    })
    return () => { cancelled = true }
  }, [showDeleted, deletedAttempt, ingredients])

  const handleDelete = async (item) => {
    const ok = await confirmAction({
      title: `ลบ ${item.name}?`,
      text: `คงเหลือ ${item.quantity} ${item.unit} — จะลบออกจากรายการใช้งาน โดยเก็บยอดและประวัติเดิมไว้ กู้คืนได้จาก “วัตถุดิบที่ลบแล้ว”`,
      confirmText: 'ลบวัตถุดิบ',
    })
    if (ok) return deleteIngredient(item.id)
  }

  const handleRestore = async (id) => {
    if (await restoreIngredient(id)) setDeleted((items) => items.filter((item) => item.id !== id))
  }

  // ค่าตัวกรอง — '' หมายถึง "ไม่กรอง"
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')

  // รายการที่ผ่านทุกเงื่อนไข (เงื่อนไขที่ว่างจะถูกข้าม)
  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return (showDeleted ? deleted : ingredients).filter(
      (item) =>
        (!keyword || item.name.toLowerCase().includes(keyword)) &&
        (!category || item.category === category) &&
        (!status || getStockStatus(item) === status),
    )
  }, [ingredients, deleted, showDeleted, query, category, status])

  return (
    <PageShell fit={!purchasingOpen}>
      {user?.role === 'owner' && <details onToggle={e => setPurchasingOpen(e.currentTarget.open)}><summary>จัดซื้อ รับของ และของเสีย</summary>{purchasingOpen && <PurchasingSection />}</details>}
      {/* แถบเครื่องมืออยู่บรรทัดเดียว (จอเล็กจะตัดบรรทัดเอง) — หัวข้อซ่อนไว้ให้เฉพาะโปรแกรมอ่านหน้าจอ */}
      <div className="page-toolbar page-toolbar--inline">
        <h1 className="sr-only">Stock</h1>
        <SearchBar value={query} onChange={setQuery} placeholder="Search ingredient...." />
        <FilterDropdown label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} tone="tan" />
        <FilterDropdown label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} tone="cream" />
        {user?.role === 'owner' && <Link className="btn-pill btn-pill--tan" to="/stock/new">
          + Add ingredient
        </Link>}
        <Link className="btn-pill" to="/stock/low">
          Low stock
        </Link>
        <label className="stock-deleted-toggle">
          <input type="checkbox" checked={showDeleted} onChange={(event) => {
            setShowDeleted(event.target.checked)
            setLoadingDeleted(event.target.checked)
            setDeletedError('')
          }} /> วัตถุดิบที่ลบแล้ว
        </label>
      </div>

      {deletedError && <p className="field-error" role="alert">{deletedError} <button type="button" onClick={() => { setLoadingDeleted(true); setDeletedAttempt((n) => n + 1) }}>ลองอีกครั้ง</button></p>}

      <BorderedTable className="stock-table--fit" columns={['ingredient', 'Category', 'Stock', 'Status', 'Action']}>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5} className="stock-table-empty">
              {loadingDeleted ? 'กำลังโหลด…' : showDeleted ? 'ไม่พบวัตถุดิบที่ลบแล้ว' : 'ไม่พบวัตถุดิบ'}
            </td>
          </tr>
        ) : (
          rows.map((item) => {
            // ปุ่ม +/− เปลี่ยนทีละกี่หน่วย (pcs = 1, g/ml = 10)
            const step = stepFor(item.unit)

            return (
              <tr key={item.id}>
                <td>
                  {showDeleted || user?.role !== 'owner' ? item.name : <Link to={`/stock/${item.id}`}>{item.name}</Link>}
                </td>
                <td>{item.category}</td>
                <td>
                  {item.quantity} {item.unit}
                </td>
                <td>
                  {showDeleted ? 'ลบแล้ว' : <StatusBadge status={getStockStatus(item)} />}
                </td>
                <td>
                  {/* keepOpen: กดซ้ำได้โดยกล่องไม่ปิด / ปุ่ม − ปิดเมื่อลดแล้วจะติดลบ */}
                  {user?.role === 'owner' && <RowActions
                    label={item.name}
                    align="left"
                    actions={showDeleted ? [{ key: 'restore', symbol: '↶', ariaLabel: `กู้คืน ${item.name}`, onClick: () => handleRestore(item.id) }] : [
                      {
                        key: 'add',
                        symbol: '+',
                        ariaLabel: `Increase ${item.name}`,
                        onClick: () => adjustQuantity(item.id, step),
                        keepOpen: true,
                      },
                      {
                        key: 'drop',
                        symbol: '−',
                        ariaLabel: `Decrease ${item.name}`,
                        onClick: () => adjustQuantity(item.id, -step),
                        disabled: item.quantity < step,
                        keepOpen: true,
                      },
                      {
                        key: 'delete',
                        symbol: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ display: 'block', margin: 'auto' }}>
                          <path d="m15.5 3.5 5 5a2 2 0 0 1 0 2.8l-8.7 8.7H6.2l-3.7-3.7a2 2 0 0 1 0-2.8L12.7 3.5a2 2 0 0 1 2.8 0Z" />
                          <path d="m8.5 7.7 7.8 7.8M12 20h9" />
                        </svg>,
                        ariaLabel: `ลบ ${item.name}`,
                        onClick: () => handleDelete(item),
                      },
                    ]}
                  />}
                </td>
              </tr>
            )
          })
        )}
      </BorderedTable>
    </PageShell>
  )
}

export default StockPage
