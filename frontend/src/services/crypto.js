/**
 * เครื่องมือเข้ารหัสสำหรับฐานข้อมูลจำลอง
 *
 * ⚠ ใช้กับ "ฐานข้อมูลจำลองในเบราว์เซอร์" เท่านั้น — ข้อมูลทุกอย่างอยู่ในเครื่องผู้ใช้เอง
 *   ระบบจริงต้องแฮชรหัสผ่านที่ฝั่งเซิร์ฟเวอร์ (เช่น bcrypt/argon2) ไม่ใช่ที่นี่
 *   ที่แฮชไว้ตั้งแต่ตอนนี้เพื่อไม่ให้รหัสผ่านเป็นข้อความเปล่าในข้อมูลที่เก็บ
 */

// สุ่มข้อความฐานสิบหกยาว `bytes` ไบต์ (ใช้ได้แม้ไม่ใช่ https)
function randomHex(bytes) {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** เกลือสุ่มต่อผู้ใช้ 1 คน — ทำให้รหัสผ่านเหมือนกันแต่แฮชไม่เหมือนกัน */
export const randomSalt = () => randomHex(16)

/** โทเค็นสำหรับ session / รีเซ็ตรหัสผ่าน */
export const randomToken = () => randomHex(24)

/** รหัส OTP 6 หลัก เช่น "048213" */
export function randomOtp() {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  return String(array[0] % 1_000_000).padStart(6, '0')
}

/**
 * แฮชรหัสผ่านด้วย SHA-256 + salt
 * crypto.subtle ใช้ได้เฉพาะ https หรือ localhost — ถ้าไม่มี (เช่น เปิดผ่าน IP ในเครือข่ายด้วย http)
 * จะตกไปใช้แฮชแบบง่ายแทน เพื่อให้แอปไม่พัง (ไม่ปลอดภัย แต่นี่คือฐานข้อมูลจำลอง)
 */
export async function hashPassword(password, salt) {
  const text = `${salt}:${password}`

  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }

  // ทางสำรอง: djb2 (ไม่ใช่การเข้ารหัสจริง)
  let hash = 5381
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0
  return `fallback-${(hash >>> 0).toString(16)}`
}
