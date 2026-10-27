/**
 * หน้าสูตรอาหาร (/menu/:id/recipe) — กำหนดว่า "เมนูนี้ 1 จานใช้วัตถุดิบอะไรบ้าง อย่างละเท่าไร"
 * ข้อมูลสูตรนี้คือสิ่งที่ใช้คำนวณสถานะ "วัตถุดิบไม่พอ" ของเมนู (ดู utils/menuStatus.js)
 *
 * โครงสร้างไฟล์:
 *   RecipePage (ตัวนอก)  หาเมนูจาก URL และจัดการกรณี "ไม่พบเมนู"
 *   └ Recipe (ตัวใน)     หน้าจริง
 */
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import BorderedTable from '../../components/BorderedTable.jsx'
import NotFoundMessage from '../../components/NotFoundMessage.jsx'
import PageShell from '../../components/PageShell.jsx'
import RowActions from '../../components/RowActions.jsx'
import { useInventory } from '../../context/InventoryContext.js'
import { askNumber, confirmAction, pickIngredient } from '../../utils/dialogs.js'
import './menu.css'

function Recipe({ menu }) {
  const navigate = useNavigate()
  const [savingRecipe, setSavingRecipe] = useState(false)
  const recipeBusy = useRef(false)
  const editRecipe = async (work) => {
    if (recipeBusy.current) return
    recipeBusy.current = true
    setSavingRecipe(true)
    try { await work() } finally { recipeBusy.current = false; setSavingRecipe(false) }
  }
  const { ingredients, updateMenu } = useInventory()

  // หมายเหตุเก็บแยกใน state เพราะพิมพ์ทีละตัว — จะบันทึกลง store ตอนออกจากช่อง (onBlur)
  const [note, setNote] = useState(menu.note ?? '')

  const recipePath = `/menu/${menu.id}/recipe`

  // แต่ละบรรทัดในสูตร + ข้อมูลวัตถุดิบเต็มๆ (ชื่อ/หมวด/หน่วย)
  // filter ทิ้งบรรทัดที่หาวัตถุดิบไม่เจอ (กันหน้าพังถ้าข้อมูลไม่ตรงกัน)
  const lines = menu.recipe
    .map((line) => ({ ...line, ingredient: ingredients.find((i) => i.id === line.ingredientId) }))
    .filter((line) => line.ingredient)

  // บันทึกสูตรทั้งก้อนกลับเข้าเมนู
  const saveRecipe = (recipe) => updateMenu(menu.id, { recipe })

  // เพิ่มวัตถุดิบเข้าสูตร: เลือกจากที่ "ยังไม่อยู่ในสูตร" เท่านั้น (กันซ้ำ)
  const handleAdd = async () => {
    const usedIds = new Set(menu.recipe.map((r) => r.ingredientId))
    const available = ingredients.filter((i) => !usedIds.has(i.id))

    const picked = await pickIngredient({ ingredients: available })
    if (!picked) return // กดยกเลิก

    // กด "สร้างวัตถุดิบใหม่" → ไปหน้าสร้าง และให้กลับมาที่สูตรนี้หลังบันทึก
    if (picked.createNew) {
      navigate('/stock/new', { state: { returnTo: recipePath } })
      return
    }

    return saveRecipe([...menu.recipe, { ingredientId: picked.ingredientId, qty: picked.qty }])
  }

  // แก้ปริมาณที่ใช้ต่อ 1 จาน
  const handleEdit = async (line) => {
    const qty = await askNumber({
      title: `จำนวน ${line.ingredient.name} ต่อ 1 จาน`,
      value: line.qty,
      unit: line.ingredient.unit,
      confirmText: 'บันทึก',
    })
    if (qty) return saveRecipe(menu.recipe.map((r) => (r.ingredientId === line.ingredientId ? { ...r, qty } : r)))
  }

  // ลบออกจากสูตร (ถามยืนยันก่อน — ลบแล้วสถานะ "วัตถุดิบไม่พอ" ของเมนูอาจเปลี่ยน)
  const handleRemove = async (line) => {
    const ok = await confirmAction({
      title: `ลบ ${line.ingredient.name} ออกจากสูตร?`,
      confirmText: 'ลบ',
    })
    if (ok) return saveRecipe(menu.recipe.filter((r) => r.ingredientId !== line.ingredientId))
  }

  return (
    <PageShell>
      <div className="recipe">
        <div className="recipe-top">
          <h1 className="page-title">{menu.name}</h1>
        </div>

        <div className="recipe-head">
          <div className="recipe-note">
            <label className="field-label" htmlFor="recipe-note">
              หมายเหตุ(ถ้ามี)
            </label>
            <textarea
              id="recipe-note"
              className="field-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              // บันทึกเฉพาะเมื่อข้อความเปลี่ยนจากที่เก็บไว้ (กันเขียนซ้ำโดยไม่จำเป็น)
              onBlur={() => note !== (menu.note ?? '') && updateMenu(menu.id, { note })}
            />
          </div>

          <div className="recipe-add">
            {/* เตือนเมื่อสูตรยังว่าง (เมนูใหม่ที่เพิ่งสร้างจะเห็นข้อความนี้) */}
            {lines.length === 0 && <p className="recipe-hint">ต้องเพิ่มวัตถุดิบ</p>}
            <button type="button" className="btn-pill btn-pill--tan btn-pill--sm" disabled={savingRecipe} onClick={() => editRecipe(handleAdd)}>
              + เพิ่มวัตถุดิบ
            </button>
          </div>
        </div>

        <h2 className="recipe-heading">สูตรอาหาร</h2>
        <BorderedTable columns={['ลำดับ', 'วัตถุดิบ', 'Category', 'ปริมาณ', 'Action']}>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={5} className="stock-table-empty">
                ยังไม่มีวัตถุดิบในสูตรนี้
              </td>
            </tr>
          ) : (
            lines.map((line, index) => (
              <tr key={line.ingredientId}>
                <td>{index + 1}</td>
                <td>
                  {/* กดชื่อไปดูวัตถุดิบ โดยบอกให้ปุ่มกลับพามาที่สูตรนี้ (ดู IngredientDetailPage) */}
                  <Link to={`/stock/${line.ingredient.id}`} state={{ from: { to: recipePath, label: 'Create Menu' } }}>
                    {line.ingredient.name}
                  </Link>
                </td>
                <td>{line.ingredient.category}</td>
                <td>
                  {line.qty} {line.ingredient.unit}
                </td>
                <td>
                  <RowActions
                    label={line.ingredient.name}
                    actions={[
                      { key: 'edit', symbol: '✎', ariaLabel: `Edit ${line.ingredient.name}`, disabled: savingRecipe, onClick: () => editRecipe(() => handleEdit(line)) },
                      { key: 'remove', symbol: '−', ariaLabel: `Remove ${line.ingredient.name}`, disabled: savingRecipe, onClick: () => editRecipe(() => handleRemove(line)) },
                    ]}
                  />
                </td>
              </tr>
            ))
          )}
        </BorderedTable>
      </div>
    </PageShell>
  )
}

function RecipePage() {
  const { id } = useParams()
  const { menus } = useInventory()
  const menu = menus.find((m) => m.id === id)

  // ไม่พบเมนู (เช่น พิมพ์ URL ผิด)
  if (!menu) {
    return <NotFoundMessage message="ไม่พบเมนูนี้" />
  }

  // key: ให้หน้าเริ่มใหม่ (รวมถึงช่องหมายเหตุ) เมื่อสลับไปดูเมนูอื่น
  return <Recipe key={menu.id} menu={menu} />
}

export default RecipePage
