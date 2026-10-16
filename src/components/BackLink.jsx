import { Link } from 'react-router-dom'

/**
 * ลิงก์ย้อนกลับแบบ "← ชื่อหน้า" (ใช้ในหน้ารายละเอียด/ฟอร์ม/สูตรอาหาร)
 *
 * @param {string} to      path ปลายทาง
 * @param {string} [label] ข้อความหลังลูกศร เช่น "Stock"
 */
function BackLink({ to, label = '' }) {
  return (
    <Link className="back-link" to={to}>
      <span aria-hidden="true">←</span> {label}
    </Link>
  )
}

export default BackLink
