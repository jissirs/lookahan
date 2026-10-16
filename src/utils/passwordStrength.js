/**
 * ประเมินความแข็งแรงของรหัสผ่าน และบอกใบ้ว่าควรปรับอะไรต่อ
 * (ใช้ที่หน้า Register และ Forget password ผ่านคอมโพเนนต์ PasswordStrengthMeter)
 *
 * เกณฑ์ 4 ข้อ ผ่านข้อละ 1 คะแนน รวมสูงสุด 4:
 *   1) ยาวอย่างน้อย 8 ตัว   2) มีทั้งตัวพิมพ์เล็กและใหญ่
 *   3) มีตัวเลข             4) มีอักขระพิเศษ
 * เพิ่มหรือแก้เกณฑ์ได้ที่รายการ CHECKS ด้านล่างที่เดียว ทั้งคะแนนและข้อความใบ้จะตามไปเอง
 *
 * หมายเหตุ: "กฎขั้นต่ำที่ยอมรับได้" (ความยาว + ตัวอักษร + ตัวเลข) อยู่ที่ utils/passwordRules.js
 */

// เกณฑ์ทีละข้อ: passed = ผ่านหรือไม่, hint = ข้อความใบ้เมื่อยังไม่ผ่าน
// เรียงตามลำดับที่ควรแก้ก่อน — ข้อความใบ้จะแสดงข้อแรกที่ยังไม่ผ่าน
const CHECKS = [
  { passed: (p) => p.length >= 8, hint: 'Use at least 8 characters' },
  { passed: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p), hint: 'Mix upper and lower case letters' },
  { passed: (p) => /\d/.test(p), hint: 'Add a number' },
  { passed: (p) => /[^A-Za-z0-9]/.test(p), hint: 'Add a symbol such as ! ? # @' },
]

/** จำนวนเกณฑ์ทั้งหมด (ใช้วาดเส้นบอกความแข็งแรงกี่ช่วง) */
export const PASSWORD_MAX_SCORE = CHECKS.length

/**
 * คะแนนรหัสผ่าน 0–4 (จำนวนเกณฑ์ที่ผ่าน) — รหัสผ่านว่างได้ 0
 * @param {string} password
 */
export function getPasswordScore(password) {
  if (!password) return 0
  return CHECKS.filter((check) => check.passed(password)).length
}

/**
 * ระดับความแข็งแรง
 * @param {string} password
 * @returns {'' | 'weak' | 'medium' | 'strong'} ค่าว่างเมื่อยังไม่ได้พิมพ์
 */
export function getPasswordStrength(password) {
  if (!password) return ''

  const score = getPasswordScore(password)
  if (score >= PASSWORD_MAX_SCORE) return 'strong'
  if (score >= 2) return 'medium'
  return 'weak'
}

/**
 * ข้อความใบ้สำหรับสร้างรหัสผ่านที่ปลอดภัย
 *   - ยังไม่พิมพ์     → ทิปรวม
 *   - ยังไม่ครบเกณฑ์  → บอกข้อแรกที่ยังขาด (ทีละข้อ จะได้ไม่ท่วมผู้ใช้)
 *   - ครบทุกข้อ       → ข้อความชมเชย
 * @param {string} password
 */
export function getPasswordHint(password) {
  if (!password) return 'Tip: 8+ characters with upper & lower case, a number and a symbol'

  const missing = CHECKS.find((check) => !check.passed(password))
  return missing ? missing.hint : 'Great — this is a strong password'
}
