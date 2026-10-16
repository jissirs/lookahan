import StepperPill from './StepperPill.jsx'

// ราคาเปลี่ยนทีละกี่บาทเมื่อกดปุ่ม + / −
const PRICE_STEP = 5

/**
 * ช่องแสดงราคา "20 ฿" พร้อมปุ่ม + / − สีส้มข้างๆ (ใช้ในฟอร์มวัตถุดิบ/เมนู และหน้ารายละเอียด)
 * ราคาลดต่ำกว่า 0 ไม่ได้ (ปุ่ม − จะจางเมื่อเหลือน้อยกว่าขั้นที่ลด)
 *
 * @param {number} value  ราคาปัจจุบัน
 * @param {(next: number) => void} onChange  เรียกพร้อมราคาใหม่ — ผู้เรียกเป็นคนเก็บค่า
 */
function PriceField({ value, onChange }) {
  return (
    <div className="price-row">
      <div className="price-box">{value} ฿</div>
      <StepperPill
        label="price"
        onIncrement={() => onChange(value + PRICE_STEP)}
        onDecrement={() => onChange(Math.max(0, value - PRICE_STEP))}
        decrementDisabled={value < PRICE_STEP}
      />
    </div>
  )
}

export default PriceField
