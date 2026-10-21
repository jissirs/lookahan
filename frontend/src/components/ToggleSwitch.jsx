/**
 * สวิตช์เปิด/ปิด พร้อมข้อความข้างๆ ที่เปลี่ยนตามสถานะ
 * (ใช้ role="switch" + aria-checked ให้โปรแกรมอ่านหน้าจออ่านออกเสียงถูกต้อง)
 *
 * @param {boolean} checked
 * @param {(next: boolean) => void} onChange
 * @param {string} onLabel   ข้อความตอนเปิด เช่น "พร้อมขาย"
 * @param {string} offLabel  ข้อความตอนปิด เช่น "ไม่พร้อมขาย"
 */
function ToggleSwitch({ checked, onChange, onLabel, offLabel }) {
  return (
    <button type="button" className="toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="toggle-track" />
      <span>{checked ? onLabel : offLabel}</span>
    </button>
  )
}

export default ToggleSwitch
