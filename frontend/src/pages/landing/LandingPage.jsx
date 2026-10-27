import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.js'
import logo from '../../assets/logo-mark.png'
import './landing.css'

const features = [
  { icon: 'stock', title: 'รู้ว่าของสดเหลือเท่าไร', text: 'ดูสต็อกที่ยังใช้ได้ รับของเป็นล็อต และใช้ล็อตใกล้หมดอายุก่อน พร้อมบันทึกของเสีย' },
  { icon: 'order', title: 'รับออเดอร์ได้ตรงจาน', text: 'ระบุโต๊ะหรือกลับบ้าน เลือกพิเศษ เพิ่มไข่ หรือไม่ใส่วัตถุดิบ พร้อมคำนวณราคาและตัดสต็อกตามสูตรที่ตั้งไว้' },
  { icon: 'cash', title: 'รับเงินแยกจากงานครัว', text: 'บันทึกเงินสดหรือโอน แบ่งยอดชำระ คำนวณเงินทอน และให้เจ้าของร้านคืนเงินพร้อมเก็บประวัติ' },
  { icon: 'chart', title: 'ปิดยอดจากเงินรับจริง', text: 'เทียบเงินสดที่ควรมีกับยอดนับจริงใน Statistics แยกยอดรับเงินออกจากยอดออเดอร์ พร้อมนับสต็อกปิดร้าน' },
  { icon: 'staff', title: 'เจ้าของและพนักงานช่วยกัน', text: 'เจ้าของร้านอนุมัติบัญชีพนักงานและกำหนดขอบเขตการทำงาน พนักงานรับออเดอร์และรับเงินได้ในร้านเดียวกัน' },
  { icon: 'spark', title: 'วางแผนของสดวันถัดไป', text: 'ใช้ประวัติยอดขายช่วยคาดการณ์จำนวนจาน แล้วคำนวณแผนซื้อจากสูตรและสต็อกที่ยังใช้ได้ พร้อมเทียบผลกับยอดจริง' },
]

function Icon({ name }) {
  const paths = {
    stock: <><path d="m4 7 8-4 8 4v10l-8 4-8-4Z" /><path d="m4 7 8 4 8-4M12 11v10M8 5l8 4" /></>,
    order: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 3h6v4H9zM9 12h6M9 16h4" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></>,
    chart: <><path d="M4 4v16h17M8 15v-4M13 15V7M18 15v-6" /></>,
    cash: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 12h1M17 12h1" /></>,
    staff: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5" /></>,
  }
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function Preview() {
  return <div className="landing-preview" aria-label="ตัวอย่างการคำนวณวัตถุดิบ ไม่ใช่ข้อมูลร้านจริง">
    <div className="landing-preview-top"><span className="landing-preview-brand">lookahhan<span> / kitchen overview</span></span><span className="landing-demo">ตัวอย่าง</span></div>
    <div className="landing-preview-body">
      <div className="landing-preview-heading"><div><span className="landing-caption">เตรียมครัวให้พร้อม</span><h2>พรุ่งนี้ ใช้อะไรบ้าง?</h2></div><span className="landing-leaf"><Icon name="spark" /></span></div>
      <div className="landing-plan"><span>ข้าวกะเพราหมู</span><strong>20 <small>จาน</small></strong></div>
      <div className="landing-preview-labels"><span>วัตถุดิบตามสูตร</span><span>แผนซื้อ</span></div>
      <div className="landing-ingredient"><span className="landing-ingredient-icon pork">◈</span><div><strong>เนื้อหมู</strong><small>ต้องใช้ 2 kg · ใช้ได้ 0.5 kg</small></div><span className="landing-buy">ซื้อ 1.5 kg</span></div>
      <div className="landing-ingredient"><span className="landing-ingredient-icon leaf">❧</span><div><strong>ใบกะเพรา</strong><small>ต้องใช้ 200 g · ใช้ได้ 200 g</small></div><span className="landing-enough">เพียงพอ ✓</span></div>
      <div className="landing-preview-note"><span>✓</span><div><strong>ซื้อเท่าที่ขาด เตรียมเท่าที่ใช้</strong><p>คำนวณจากจำนวนจาน × สูตรอาหาร − สต็อกที่ใช้ได้</p></div></div>
    </div>
    <div className="landing-preview-bottom"><span className="landing-status-dot" /> ข้อมูลตัวอย่างเพื่ออธิบายวิธีทำงาน</div>
  </div>
}

export default function LandingPage() {
  const { isAuthenticated } = useAuth()
  const primary = isAuthenticated ? '/' : '/login'
  return <div className="landing-page">
    <a className="landing-skip" href="#landing-main">ข้ามไปยังเนื้อหา</a>
    <header className="landing-header">
      <Link to={isAuthenticated ? '/welcome' : '/'} className="landing-brand" aria-label="Lookahhan หน้าแรก"><img src={logo} alt="" /><span>lookahhan<small>เพื่อนคู่ครัวของคุณ</small></span></Link>
      <nav aria-label="เมนูเว็บไซต์"><a href="#features">ระบบช่วยอะไรได้บ้าง</a><a href="#how-it-works">วิธีใช้งาน</a></nav>
      <Link className="landing-button landing-button-outline" to={primary}>{isAuthenticated ? 'ไป Dashboard' : 'เข้าสู่ระบบ'}<span aria-hidden="true">↗</span></Link>
    </header>
    <main id="landing-main">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow"><span /> สำหรับร้านอาหารตามสั่งหนึ่งร้าน</p>
          <h1 id="landing-title">ทุกจานจัดการได้<br />ทุกยอดเงิน<span>ตรวจสอบได้</span></h1>
          <p className="landing-intro">เชื่อมสูตรอาหาร สต็อกของสด และออเดอร์<br className="landing-desktop-break" /> ตั้งแต่รับลูกค้าหน้าร้านจนถึงรับเงินและปิดยอด<br className="landing-desktop-break" /> ให้เจ้าของร้านกับพนักงานทำงานร่วมกัน</p>
          <div className="landing-hero-actions"><Link className="landing-button landing-button-primary" to={primary}>{isAuthenticated ? 'กลับไปจัดการร้าน' : 'เข้าสู่ระบบร้าน'}<span aria-hidden="true">→</span></Link><a className="landing-text-link" href="#how-it-works">ดูขั้นตอนในแต่ละวัน <span aria-hidden="true">↓</span></a></div>
          <p className="landing-hero-footnote">มี AI ช่วยวางแผนซื้อของสดจากประวัติการขาย โดยเจ้าของร้านตรวจแผนก่อนซื้อ</p>
        </div>
        <div className="landing-hero-visual"><div className="landing-visual-orbit" aria-hidden="true" /><Preview /><div className="landing-visual-caption"><span>STOCK</span><i /> <span>ORDER</span><i /><span>PAYMENT</span></div></div>
      </section>
      <section className="landing-features" id="features" aria-labelledby="landing-features-title">
        <div className="landing-section-top"><p className="landing-eyebrow">ดูแลงานประจำวันของร้าน</p><h2 id="landing-features-title">รับออเดอร์ ดูแลของสด<br />และปิดยอดในระบบเดียว</h2></div>
        <div className="landing-feature-grid">{features.map((feature, index) => <article className="landing-feature" key={feature.icon}><div className="landing-feature-top"><span className="landing-feature-icon"><Icon name={feature.icon} /></span><span className="landing-feature-number">0{index + 1}</span></div><h3>{feature.title}</h3><p>{feature.text}</p></article>)}</div>
      </section>
      <section className="landing-workflow" id="how-it-works" aria-labelledby="landing-workflow-title">
        <div><p className="landing-eyebrow">ตั้งแต่เปิดร้านถึงปิดยอด</p><h2 id="landing-workflow-title">สี่ขั้นตอน<br />สำหรับร้านอาหารตามสั่ง</h2><p className="landing-workflow-intro">ใช้หน้า Stock, Menu, Order และ Statistics<br />เชื่อมงานหน้าร้านกับงานครัวในแต่ละวัน</p></div>
        <ol>{[
          ['เตรียมวัตถุดิบและเมนู', 'รับของเข้าสต็อก ตั้งสูตรต่อจาน และกำหนดราคาเพิ่มกับวัตถุดิบของแต่ละตัวเลือก'],
          ['รับออเดอร์และส่งต่อครัว', 'เลือกโต๊ะหรือกลับบ้าน ระบุตัวเลือกต่อจาน ระบบตัดสต็อกและติดตามสถานะอาหาร'],
          ['รับเงินและตรวจยอดชำระ', 'บันทึกเงินสดหรือโอน แบ่งชำระตามยอด และดูเงินทอน การโอนให้พนักงานตรวจยอดเข้าจริงก่อนบันทึก'],
          ['ปิดเงิน นับของ และวางแผนต่อ', 'เจ้าของร้านกระทบยอดเงินสดและนับสต็อกใน Statistics แล้วใช้ยอดขายกับของเหลือประกอบแผนซื้อวันถัดไป'],
        ].map(([title, text], index) => <li key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol>
      </section>
      <section className="landing-start" aria-labelledby="landing-start-title"><div><p className="landing-eyebrow">ทำงานร่วมกันในร้านเดียว</p><h2 id="landing-start-title">เจ้าของดูแลร้าน<br />พนักงานช่วยรับออเดอร์</h2><p>บัญชีพนักงานใหม่ต้องได้รับอนุมัติจากเจ้าของร้านก่อนเข้าใช้งาน</p></div><div className="landing-start-actions"><Link className="landing-button landing-button-primary" to={isAuthenticated ? '/' : '/register'}>{isAuthenticated ? 'เปิด Dashboard' : 'สมัครบัญชีพนักงาน'}<span aria-hidden="true">↗</span></Link>{!isAuthenticated && <p>มีบัญชีอยู่แล้ว? <Link to="/login">เข้าสู่ระบบร้าน</Link></p>}</div></section>
    </main>
    <footer className="landing-footer"><span>lookahhan<span> — เพื่อนคู่ร้านอาหารตามสั่ง</span></span><p>Stock · Menu · Order · Payment · Statistics · AI</p><a href="#landing-title">กลับด้านบน ↑</a></footer>
  </div>
}
