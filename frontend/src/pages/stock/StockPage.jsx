/**
 * หน้า Stock (/stock) — ตารางวัตถุดิบทั้งหมด
 *  - ค้นหาตามชื่อ + กรองตาม Category / Status (ใช้พร้อมกันได้ ผลคือ "ต้องตรงทุกเงื่อนไข")
 *  - กดชื่อวัตถุดิบ → ไปหน้ารายละเอียด
 *  - ปุ่ม ⋮ ท้ายแถว → + / − ปรับจำนวนได้ทันที
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BorderedTable from '../../components/BorderedTable.jsx'
import FilterDropdown from '../../components/FilterDropdown.jsx'
import PageShell from '../../components/PageShell.jsx'
import RowActions from '../../components/RowActions.jsx'
import SearchBar from '../../components/SearchBar.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { INGREDIENT_CATEGORIES } from '../../data/seed.js'
import { STATUS_LABEL, getStockStatus, stepFor } from '../../utils/stockStatus.js'

// ตัวเลือกของ dropdown ตัวกรอง: [{ value, label }]
const CATEGORY_OPTIONS = INGREDIENT_CATEGORIES.map((c) => ({ value: c, label: c }))
const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))

function StockPage() {
  const { ingredients, adjustQuantity } = useInventory()

  // ค่าตัวกรอง — '' หมายถึง "ไม่กรอง"
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')

  // รายการที่ผ่านทุกเงื่อนไข (เงื่อนไขที่ว่างจะถูกข้าม)
  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return ingredients.filter(
      (item) =>
        (!keyword || item.name.toLowerCase().includes(keyword)) &&
        (!category || item.category === category) &&
        (!status || getStockStatus(item) === status),
    )
  }, [ingredients, query, category, status])

  return (
    <PageShell fit>
      {/* แถบเครื่องมืออยู่บรรทัดเดียว (จอเล็กจะตัดบรรทัดเอง) — หัวข้อซ่อนไว้ให้เฉพาะโปรแกรมอ่านหน้าจอ */}
      <div className="page-toolbar page-toolbar--inline">
        <h1 className="sr-only">Stock</h1>
        <SearchBar value={query} onChange={setQuery} placeholder="Search ingredient...." />
        <FilterDropdown label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} tone="tan" />
        <FilterDropdown label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} tone="cream" />
        <Link className="btn-pill btn-pill--tan" to="/stock/new">
          + Add ingredient
        </Link>
        <Link className="btn-pill" to="/stock/low">
          Low stock
        </Link>
      </div>

      <BorderedTable className="stock-table--fit" columns={['ingredient', 'Category', 'Stock', 'Status', 'Action']}>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5} className="stock-table-empty">
              ไม่พบวัตถุดิบ
            </td>
          </tr>
        ) : (
          rows.map((item) => {
            // ปุ่ม +/− เปลี่ยนทีละกี่หน่วย (pcs = 1, g/ml = 10)
            const step = stepFor(item.unit)

            return (
              <tr key={item.id}>
                <td>
                  <Link to={`/stock/${item.id}`}>{item.name}</Link>
                </td>
                <td>{item.category}</td>
                <td>
                  {item.quantity} {item.unit}
                </td>
                <td>
                  <StatusBadge status={getStockStatus(item)} />
                </td>
                <td>
                  {/* keepOpen: กดซ้ำได้โดยกล่องไม่ปิด / ปุ่ม − ปิดเมื่อลดแล้วจะติดลบ */}
                  <RowActions
                    label={item.name}
                    actions={[
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
                    ]}
                  />
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
