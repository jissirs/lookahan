import { useInventory } from '../../context/InventoryContext.js'

export default function ModifierEditor({ value = [], onChange }) {
  const { ingredients } = useInventory()
  const update = (index, patch) => onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row))
  return <fieldset className="restaurant-panel">
    <legend>ตัวเลือกต่อจาน</legend>
    <p>เช่น พิเศษ เพิ่มไข่ ไม่ใส่ผัก — ปริมาณบวกคือเพิ่ม ปริมาณลบคือหักจากสูตร หน่วยตามวัตถุดิบ</p>
    {value.map((option, index) => <div className="restaurant-panel" key={index}>
      <label>ชื่อตัวเลือก<input className="field-input" maxLength={60} value={option.name} onChange={e => update(index, { name: e.target.value })} /></label>
      <label>ราคาเพิ่ม (บาท)<input className="field-input" type="number" min="0" step="0.01" value={option.price} onChange={e => update(index, { price: e.target.value })} /></label>
      {option.ingredients.map((line, i) => <div className="restaurant-inline" key={i}>
        <select className="field-select" aria-label="วัตถุดิบตัวเลือก" value={line.ingredientId} onChange={e => update(index, { ingredients: option.ingredients.map((x, n) => n === i ? { ...x, ingredientId: e.target.value } : x) })}>
          <option value="">เลือกวัตถุดิบ</option>{ingredients.map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}
        </select>
        <input className="field-input" type="number" step="1" aria-label="ปริมาณเพิ่มหรือลดต่อจาน" value={line.qty} onChange={e => update(index, { ingredients: option.ingredients.map((x, n) => n === i ? { ...x, qty: e.target.value } : x) })} />
        <button type="button" onClick={() => update(index, { ingredients: option.ingredients.filter((_, n) => n !== i) })}>ลบส่วนผสม</button>
      </div>)}
      <div className="restaurant-inline"><button type="button" onClick={() => update(index, { ingredients: [...option.ingredients, { ingredientId: '', qty: 1 }] })}>+ ส่วนผสม</button>
      <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>ลบตัวเลือก</button></div>
    </div>)}
    <button type="button" onClick={() => onChange([...value, { name: '', price: 0, ingredients: [] }])} disabled={value.length >= 20}>+ ตัวเลือกอาหาร</button>
  </fieldset>
}
