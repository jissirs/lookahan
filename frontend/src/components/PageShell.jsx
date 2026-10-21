import Header from './Header.jsx'
import './ui.css'

/**
 * โครงหน้ามาตรฐานของหน้า Stock / Menu: Header ด้านบน + พื้นที่เนื้อหากว้างสูงสุด 1200px
 * ใช้ครอบเนื้อหาของทุกหน้า:  <PageShell> ...เนื้อหา... </PageShell>
 * สไตล์และสีกลางทั้งหมดอยู่ใน ui.css
 *
 * @param {boolean} [fit]  true = หน้าสูงพอดีจอ ไม่เลื่อนทั้งหน้า (ให้ตารางที่ใส่คลาส stock-table--fit เลื่อนข้อมูลในตัวเอง)
 */
function PageShell({ children, fit = false }) {
  return (
    <div className={`page${fit ? ' page--fit' : ''}`}>
      <Header />
      <main className="page-container">{children}</main>
    </div>
  )
}

export default PageShell
