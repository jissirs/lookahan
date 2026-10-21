/**
 * กฎของรหัสผ่านที่ "ยอมรับได้" — ใช้ทั้งหน้าจอ (Register / Forget password)
 * และชั้น API (services/api.js) เพื่อให้กฎตรงกันที่เดียว
 *
 * @param {string} password
 * @returns {string} ข้อความ error หรือสตริงว่างถ้าผ่าน
 */
export function getPasswordError(password) {
  if (!password) return 'Please enter a password'
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain letters and numbers'
  return ''
}
