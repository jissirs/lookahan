/**
 * กล่องสีส้มมีปุ่มกลมสีแดง + และ − ใช้ปรับตัวเลข (เช่น ราคา)
 * คอมโพเนนต์นี้ไม่เก็บค่าเอง — ผู้ใช้ส่งฟังก์ชันเพิ่ม/ลดเข้ามา
 *
 * @param {boolean} [decrementDisabled]  true = ปิดปุ่ม − (เช่น ค่าลงต่ำสุดแล้ว)
 * @param {string} [label]  ชื่อสิ่งที่ปรับ ใช้เป็นข้อความสำหรับโปรแกรมอ่านหน้าจอ
 */
function StepperPill({ onIncrement, onDecrement, decrementDisabled = false, label = '' }) {
  return (
    <div className="stepper" role="group" aria-label={label || undefined}>
      <button type="button" className="stepper-btn" onClick={onIncrement} aria-label={`Increase ${label}`.trim()}>
        +
      </button>
      <button
        type="button"
        className="stepper-btn"
        onClick={onDecrement}
        disabled={decrementDisabled}
        aria-label={`Decrease ${label}`.trim()}
      >
        −
      </button>
    </div>
  )
}

export default StepperPill
