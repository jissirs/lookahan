export default function PurchaseFields({ unit, purchaseUnit, purchaseSize, onChange }) {
  const options = [unit, ...(unit === 'g' ? ['kg'] : unit === 'ml' ? ['l'] : []), 'pack']
  return <div className="purchase-fields">
    <label>หน่วยซื้อ
      <select className="field-select" value={purchaseUnit} onChange={(e) => {
        const next = e.target.value
        onChange(next, next === 'kg' || next === 'l' ? 1000 : 1)
      }}>
        {options.map((option) => <option key={option} value={option}>{option === 'pack' ? 'แพ็ก' : option}</option>)}
      </select>
    </label>
    {purchaseUnit === 'pack' && <label>ปริมาณต่อแพ็ก ({unit})
      <input className="field-input" type="number" min="1" max="10000" step="1" required value={purchaseSize}
        onChange={(e) => onChange(purchaseUnit, e.target.value === '' ? '' : Number(e.target.value))} />
    </label>}
    <p>1 {purchaseUnit} = {purchaseSize} {unit} · สูตรอาหารและยอดคงเหลือใช้หน่วย {unit}</p>
  </div>
}
