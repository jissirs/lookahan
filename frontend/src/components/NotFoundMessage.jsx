import PageShell from './PageShell.jsx'

/**
 * หน้าแสดงเมื่อเปิดลิงก์ที่ไม่มีข้อมูลจริง (เช่น /stock/abc ที่ไม่มีวัตถุดิบ id นี้)
 *
 * @param {string} message    ข้อความ เช่น "ไม่พบวัตถุดิบนี้"
 * ใช้ปุ่มย้อนกลับใน Header ร่วมกับหน้าอื่น
 */
function NotFoundMessage({ message }) {
  return (
    <PageShell>
      <p className="page-empty">{message}</p>
    </PageShell>
  )
}

export default NotFoundMessage
