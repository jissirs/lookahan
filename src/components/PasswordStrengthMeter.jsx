import {
  PASSWORD_MAX_SCORE,
  getPasswordHint,
  getPasswordScore,
  getPasswordStrength,
} from '../utils/passwordStrength.js'
import './PasswordStrengthMeter.css'

/**
 * เส้นบอกความแข็งแรงของรหัสผ่าน (4 ช่วง) + ข้อความใบ้ — วางไว้ใต้ช่องรหัสผ่าน
 * ใช้ร่วมกันทั้งหน้า Register และ Forget password
 *
 * ส่วนประกอบ:
 *   - เส้น 4 ช่วง   ยิ่งผ่านเกณฑ์มากยิ่งเต็ม สีตามระดับ: weak = แดง, medium = เหลือง, strong = เขียว
 *   - ข้อความใบ้    บอกสิ่งที่ควรเพิ่มต่อไป (ทีละข้อ) หรือชมเมื่อครบ
 *   - ชื่อระดับ     weak / medium / strong เป็นตัวหนังสืออยู่มุมขวา — สีไม่ใช่ตัวบอกความหมายเพียงอย่างเดียว
 *
 * @param {string} password  รหัสผ่านที่ผู้ใช้พิมพ์อยู่
 * @param {string} [error]   ข้อผิดพลาดของช่องนี้ — ถ้ามีจะแสดงแทนข้อความใบ้ในบรรทัดเดียวกัน (ไม่ซ้อนสองบรรทัด)
 * @param {string} [hintId]  id ของข้อความ (ให้ช่องกรอกอ้างด้วย aria-describedby)
 * @param {string} [className]  คลาสสำหรับให้หน้าที่เรียกใช้กำหนดตำแหน่ง
 */
function PasswordStrengthMeter({ password, error = '', hintId, className = '' }) {
  const score = getPasswordScore(password)
  const strength = getPasswordStrength(password)
  // เริ่มพิมพ์แล้วอย่างน้อยต้องเห็น 1 ช่วง (ไม่งั้นรหัสสั้นมากจะเห็นเส้นว่างทั้งที่ป้ายบอก weak)
  const filled = strength ? Math.max(score, 1) : 0

  return (
    <div className={`pw-meter ${className}`.trim()}>
      <div
        className="pw-meter-bar"
        role="img"
        aria-label={strength ? `Password strength: ${strength}` : 'Password strength: not set'}
      >
        {Array.from({ length: PASSWORD_MAX_SCORE }, (_, i) => (
          <span key={i} className={`pw-meter-seg${i < filled ? ` is-on pw-meter-seg--${strength}` : ''}`} />
        ))}
      </div>

      <p className={`pw-meter-hint${error ? ' is-error' : ''}`} id={hintId} aria-live="polite">
        <span>{error || getPasswordHint(password)}</span>
        {strength && <strong className="pw-meter-label">{strength}</strong>}
      </p>
    </div>
  )
}

export default PasswordStrengthMeter
