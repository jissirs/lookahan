import { Link } from 'react-router-dom'
import PageShell from './PageShell.jsx'

/**
 * หน้าแสดงเมื่อเปิดลิงก์ที่ไม่มีข้อมูลจริง (เช่น /stock/abc ที่ไม่มีวัตถุดิบ id นี้)
 *
 * @param {string} message    ข้อความ เช่น "ไม่พบวัตถุดิบนี้"
 * @param {string} backTo     path ของลิงก์กลับ
 * @param {string} backLabel  ชื่อหน้าที่จะกลับไป เช่น "Stock"
 */
function NotFoundMessage({ message, backTo, backLabel }) {
  return (
    <PageShell>
      <p className="page-empty">{message}</p>
      <p className="page-empty">
        <Link to={backTo}>← กลับไปหน้า {backLabel}</Link>
      </p>
    </PageShell>
  )
}

export default NotFoundMessage
