/**
 * error มาตรฐานของชั้น API
 * - code    : รหัสสั้นๆ ให้โค้ดแยกประเภทได้ เช่น 'INVALID_CREDENTIALS', 'DUPLICATE_NAME'
 * - message : ข้อความที่แสดงให้ผู้ใช้ได้เลย
 *
 * ตัวอย่างการใช้ในหน้าจอ:
 *   try { await register(...) }
 *   catch (err) { if (err.code === 'EMAIL_TAKEN') ... }
 *
 * เมื่อต่อ backend จริง ให้แปลง error จาก HTTP (เช่น 409, 401) เป็น ApiError ด้วย code ชุดเดียวกันนี้
 * หน้าจอจะได้ไม่ต้องแก้
 */
export class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}
