/**
 * api — "สัญญา" ระหว่างหน้าจอกับหลังบ้าน (Backend ที่โฟลเดอร์ Backend/ ของโปรเจกต์)
 *
 * หน้าจอ/context เรียกข้อมูลผ่านไฟล์นี้เท่านั้น:   หน้าจอ → context → api.js ──HTTP──▶ Backend (Flask)
 * กฎธุรกิจทั้งหมด (ชื่อซ้ำ, stock ห้ามติดลบ, ตัด stock ตามสูตร ฯลฯ) อยู่ที่ Backend
 * ไฟล์นี้ทำแค่ 3 อย่าง: ส่งคำขอ, แนบ token ล็อกอิน, แปลง error ที่ได้กลับมาเป็น ApiError
 *
 * ===== สรุปทุกฟังก์ชัน ↔ เส้นทางของ Backend (ขึ้นต้น /api/v1) =====
 *   api.health()                          GET   /health
 *   api.auth.register(data)               POST  /auth/register
 *   api.auth.login(id, password)          POST  /auth/login
 *   api.auth.me(token) / logout(token)    GET   /auth/me      POST /auth/logout
 *   api.auth.requestOtp(email)            POST  /auth/otp
 *   api.auth.verifyOtp(email, otp)        POST  /auth/otp/verify
 *   api.auth.resetPassword(token, pw)     POST  /auth/password/reset
 *   api.inventory.getSnapshot()           GET   /snapshot     (วัตถุดิบ+ประวัติ+เมนู+ออเดอร์ ทีเดียว)
 *   api.inventory.listIngredients()       GET   /ingredients
 *   api.inventory.listMovements()         GET   /movements
 *   api.inventory.listMenus()             GET   /menus
 *   api.inventory.createIngredient(data)  POST  /ingredients
 *   api.inventory.updateIngredient(id,p)  PATCH /ingredients/:id
 *   api.inventory.adjustIngredient(...)   POST  /ingredients/:id/adjust
 *   api.inventory.createMenu(data)        POST  /menus
 *   api.inventory.updateMenu(id, patch)   PATCH /menus/:id
 *   api.orders.list()                     GET   /orders
 *   api.orders.create(data)               POST  /orders
 *   api.orders.advance(id) / cancel(id)   POST  /orders/:id/advance  /orders/:id/cancel
 *   api.notifications.list()              GET   /notifications               (กระดิ่ง: 30 อันล่าสุด + จำนวนที่ยังไม่อ่าน)
 *   api.notifications.markRead(id)        POST  /notifications/:id/read
 *   api.notifications.markAllRead()       POST  /notifications/read-all
 *   api.ai.createForecast()               POST  /ai/forecast  (ให้ Groq พยากรณ์พรุ่งนี้)
 *   api.ai.sendFeedback(key, helpful)     PUT   /ai/feedback/:key
 *   api.ai.listFeedback()                 GET   /ai/feedback
 *   api.ai.accuracy()                     GET   /ai/accuracy  (ผลพยากรณ์เทียบยอดจริง)
 *   api.closing.today() / create(data) / history()   GET /closing/today  POST /closing  GET /closing/history
 *   api.dashboard.getSummary()            GET   /dashboard/summary
 *
 * ที่อยู่ของ Backend:
 *   - ตอนพัฒนา: Vite ส่งต่อทุกคำขอที่ขึ้นต้นด้วย /api ไปที่ Backend ให้เอง (ดู vite.config.js) จึงไม่ต้องตั้งค่าอะไร
 *   - ตอน deploy หรืออยากชี้ที่อื่น: ตั้ง VITE_API_URL ในไฟล์ .env เช่น VITE_API_URL=https://api.example.com/api/v1
 *
 * ===== รายการ error code (ตรงกับ Backend/app/tools.py) =====
 *   auth      : INVALID_CREDENTIALS, EMAIL_TAKEN, UNAUTHORIZED, EMAIL_NOT_FOUND,
 *               INVALID_OTP, OTP_EXPIRED, TOO_MANY_ATTEMPTS, INVALID_RESET_TOKEN, WEAK_PASSWORD, VALIDATION,
 *               TOO_MANY_REQUESTS (ขอ OTP ถี่เกินไป), EMAIL_SEND_FAILED, EMAIL_NOT_CONFIGURED
 *   inventory : DUPLICATE_NAME, NOT_FOUND, INSUFFICIENT_STOCK, VALIDATION
 *   orders    : INSUFFICIENT_STOCK, NOT_FOUND, VALIDATION
 *   ai        : VALIDATION, AI_NOT_CONFIGURED, AI_ERROR
 *   ฝั่งหน้าจอเอง : NETWORK (ต่อ Backend ไม่ได้), SERVER_ERROR (Backend ตอบผิดรูปแบบ)
 */
import { createMutationQueue } from '../utils/mutationQueue.js'
import { ApiError } from './ApiError.js'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1'

// ---------- token ล็อกอิน ----------
// token เก็บไว้ในตัวแปรของไฟล์นี้ แล้วแนบไปกับทุกคำขอโดยอัตโนมัติ (ฟังก์ชันอื่นจึงไม่ต้องรับ token)
// ตอนเปิดแอปให้อ่านค่าที่ AuthProvider เคยบันทึกไว้ใน localStorage ('lookahan.auth') เพื่อให้รีเฟรชหน้าแล้วยังล็อกอินอยู่
function readStoredToken() {
  try {
    return JSON.parse(localStorage.getItem('lookahan.auth'))?.token ?? null
  } catch {
    return null
  }
}

let token = readStoredToken()

// AuthProvider ลงทะเบียนฟังก์ชันไว้ตรงนี้ เพื่อให้ออกจากระบบทันทีเมื่อ Backend บอกว่า token หมดอายุ
let onUnauthorized = null

// ---------- ตัวส่งคำขอ ----------

/**
 * ส่งคำขอไป Backend แล้วคืนข้อมูล JSON ที่ได้
 * @throws ApiError  ทุกกรณีที่ไม่สำเร็จ (Backend ตอบ error หรือต่อไม่ได้เลย)
 */
const serialize = createMutationQueue()
function request(method, path, body, tokenOverride) {
  const requestedToken = tokenOverride ?? token
  const shared = /^\/(ingredients|menus|orders|closing|purchases|suppliers|waste|staff)(\/|$)/.test(path)
  if ((method !== 'GET' && shared) || path === '/snapshot') {
    return serialize(() => {
      if (requestedToken !== token) throw new ApiError('SESSION_CHANGED', 'บัญชีเปลี่ยนแล้ว กรุณาทำรายการใหม่')
      return sendRequest(method, path, body, requestedToken)
    })
  }
  return sendRequest(method, path, body, tokenOverride)
}
async function sendRequest(method, path, body, tokenOverride) {
  const activeToken = tokenOverride ?? token

  let response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError('NETWORK', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่า Backend เปิดอยู่')
  }

  // Backend ตอบเป็น JSON เสมอ (ถ้าอ่านไม่ได้ ปล่อยเป็น null แล้วให้ด้านล่างตัดสินจากสถานะ)
  let data = null
  try {
    data = await response.json()
  } catch {
    // ไม่มีเนื้อหา หรือไม่ใช่ JSON
  }

  if (!response.ok) {
    // 502/503/504 โดยไม่มี error จาก Backend = ตัวกลาง (proxy) ต่อ Backend ไม่ได้ เช่น Backend ยังไม่เปิด
    if (!data?.error && [502, 503, 504].includes(response.status)) {
      throw new ApiError('NETWORK', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่า Backend เปิดอยู่')
    }

    const error = new ApiError(
      data?.error?.code ?? 'SERVER_ERROR',
      data?.error?.message ?? `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${response.status})`,
    )
    // token หมดอายุระหว่างใช้งาน → ออกจากระบบ (ยกเว้นคำขอของหน้าบัญชีเอง เช่นล็อกอินผิด)
    if (error.code === 'UNAUTHORIZED' && activeToken && activeToken === token && !path.startsWith('/auth/')) onUnauthorized?.()
    throw error
  }

  return data
}

// =====================================================================
//  AUTH — บัญชีผู้ใช้
// =====================================================================
const auth = {
  /**
   * สมัครสมาชิก
   * @returns {Promise<{ user }>}
   * @throws EMAIL_TAKEN, WEAK_PASSWORD, VALIDATION
   */
  register({ name, surname, email, password }) {
    return request('POST', '/auth/register', { name, surname, email, password })
  },

  /**
   * ล็อกอินด้วย "name หรือ email" + รหัสผ่าน
   * @returns {Promise<{ token: string, user }>}
   * @throws INVALID_CREDENTIALS
   */
  async login(identifier, password) {
    const result = await request('POST', '/auth/login', { identifier, password })
    token = result.token // จำไว้ใช้แนบกับคำขอถัดไป
    return result
  },

  /** ตรวจว่า token ยังใช้ได้ไหม (เรียกตอนเปิดแอป) แล้วคืนข้อมูลผู้ใช้ @throws UNAUTHORIZED */
  async me(tokenToCheck) {
    token = tokenToCheck
    return request('GET', '/auth/me')
  },

  /** ออกจากระบบ — ให้ Backend ลบ session (ไม่ว่าสำเร็จหรือไม่ ฝั่งนี้ลืม token ทันที) */
  async logout(tokenToEnd) {
    const activeToken = tokenToEnd ?? token
    token = null
    if (activeToken) await request('POST', '/auth/logout', {}, activeToken)
  },

  /**
   * ขอ OTP สำหรับรีเซ็ตรหัสผ่าน
   * Backend ส่ง OTP ทางอีเมลและไม่คืนมา — ถ้า Backend ยังไม่ได้ตั้งค่าอีเมล (โหมดทดลอง) จะคืน otp กลับมาให้ดูแทน
   * ขอซ้ำได้ทุก 60 วินาที (เร็วกว่านั้นได้ TOO_MANY_REQUESTS)
   * @returns {Promise<{ ok?: true, otp?: string }>}
   * @throws EMAIL_NOT_FOUND, TOO_MANY_REQUESTS, EMAIL_SEND_FAILED, EMAIL_NOT_CONFIGURED
   */
  requestOtp(email) {
    return request('POST', '/auth/otp', { email })
  },

  /**
   * ตรวจ OTP — ถูกต้องแล้วได้ resetToken ไปใช้ตั้งรหัสผ่านใหม่ในขั้นถัดไป
   * @returns {Promise<{ resetToken: string }>}
   * @throws INVALID_OTP, OTP_EXPIRED, TOO_MANY_ATTEMPTS
   */
  verifyOtp(email, otp) {
    return request('POST', '/auth/otp/verify', { email, otp })
  },

  /** ตั้งรหัสผ่านใหม่ด้วย resetToken (ใช้ได้ครั้งเดียว) @throws INVALID_RESET_TOKEN, WEAK_PASSWORD */
  resetPassword(resetToken, newPassword) {
    return request('POST', '/auth/password/reset', { resetToken, newPassword })
  },
}

// =====================================================================
//  INVENTORY — วัตถุดิบ ประวัติ stock และเมนู
// =====================================================================
const inventory = {
  /** ข้อมูลทั้งหมดที่หน้าจอต้องใช้ตอนเปิดแอป: { ingredients, movements, menus, orders } */
  getSnapshot() {
    return request('GET', '/snapshot')
  },

  /** อ่านทีละส่วน (ใช้เมื่ออยากรีเฟรชแค่บางอย่างโดยไม่โหลดทั้งหมด) */
  discardBatch(id, batchId) {
    return request('POST', `/ingredients/${encodeURIComponent(id)}/batches/${encodeURIComponent(batchId)}/discard`, {})
  },
  listIngredients() {
    return request('GET', '/ingredients')
  },
  listDeletedIngredients() {
    return request('GET', '/ingredients?deleted=true')
  },
  deleteIngredient(id) {
    return request('DELETE', `/ingredients/${encodeURIComponent(id)}`)
  },
  restoreIngredient(id) {
    return request('POST', `/ingredients/${encodeURIComponent(id)}/restore`, {})
  },

  listMovements() {
    return request('GET', '/movements')
  },

  listMenus() {
    return request('GET', '/menus')
  },

  /**
   * เพิ่ม (delta > 0) หรือลด (delta < 0) จำนวนวัตถุดิบ พร้อมบันทึกประวัติ
   * @returns {Promise<{ ingredient, movement }>}
   * @throws NOT_FOUND, INSUFFICIENT_STOCK (ลดแล้วติดลบ), VALIDATION
   */
  adjustIngredient(id, delta, label, options = {}) {
    return request('POST', `/ingredients/${encodeURIComponent(id)}/adjust`, { delta, label, ...options })
  },

  /** สร้างวัตถุดิบใหม่ (เริ่มที่ 0 ชิ้น) @throws DUPLICATE_NAME, VALIDATION */
  createIngredient(fields) {
    return request('POST', '/ingredients', fields)
  },

  /** แก้ชื่อ/ประเภท/หน่วย/ราคา (แก้จำนวนต้องใช้ adjustIngredient) @throws DUPLICATE_NAME, NOT_FOUND, VALIDATION */
  updateIngredient(id, patch) {
    return request('PATCH', `/ingredients/${encodeURIComponent(id)}`, patch)
  },

  /** สร้างเมนูใหม่ (ค่าเริ่มต้น: ยังไม่พร้อมขาย ไม่มีสูตร) @throws NOT_FOUND, VALIDATION */
  createMenu(data) {
    return request('POST', '/menus', data)
  },

  /** แก้เมนู (รวมสูตรอาหารทั้งก้อน) @throws NOT_FOUND, VALIDATION */
  updateMenu(id, patch) {
    return request('PATCH', `/menus/${encodeURIComponent(id)}`, patch)
  },
}

// =====================================================================
//  ORDERS — ออเดอร์จากลูกค้า
// =====================================================================
const orders = {
  /** รายการออเดอร์ทั้งหมด (ใหม่ → เก่า) */
  list() {
    return request('GET', '/orders')
  },

  /**
   * สร้างออเดอร์ใหม่ และ Backend จะ "ตัด stock ตามสูตรเมนู" ให้ทันที (สำเร็จทั้งหมดหรือไม่ก็ไม่ทำเลย)
   * @param {{ items: { menuId: string, qty: number }[], note?: string }} data
   * @returns {Promise<{ order, ingredients, movements }>}
   *          ingredients/movements คือที่ "เปลี่ยน" จากการตัด stock (ให้หน้าจออัปเดตตาม)
   * @throws VALIDATION, NOT_FOUND, INSUFFICIENT_STOCK
   */
  create(data) {
    return request('POST', '/orders', data)
  },
  pay(id, data) {
    return request('POST', `/orders/${encodeURIComponent(id)}/payments`, data)
  },

  /** เลื่อนออเดอร์ไปสถานะถัดไป: new → cooking → ready → done @throws NOT_FOUND, VALIDATION */
  advance(id) {
    return request('POST', `/orders/${encodeURIComponent(id)}/advance`, {})
  },

  /**
   * ยกเลิกออเดอร์ และคืน stock ที่เคยตัดไป (ยกเลิกได้เฉพาะออเดอร์ที่ยังไม่เสร็จสิ้น)
   * @returns {Promise<{ order, ingredients, movements }>}
   * @throws NOT_FOUND, VALIDATION
   */
  cancel(id, reason) {
    return request('POST', `/orders/${encodeURIComponent(id)}/cancel`, reason ? { reason } : {})
  },
}

// =====================================================================
//  NOTIFICATIONS — แจ้งเตือนในระบบ (กระดิ่ง)
//  Backend สร้างแจ้งเตือนเองเมื่อมีเหตุการณ์: วัตถุดิบใกล้หมด/วิกฤต, ออเดอร์ใหม่/พร้อมเสิร์ฟ/ยกเลิก, AI วิเคราะห์เสร็จ
//  "อ่านแล้ว" เก็บแยกรายผู้ใช้
// =====================================================================
const notifications = {
  /**
   * แจ้งเตือนล่าสุดของสาขา (ใหม่ → เก่า สูงสุด 30 อัน) + จำนวนที่ "ฉัน" ยังไม่ได้อ่าน (นับทั้งสาขา ไม่ใช่แค่ 30 อัน)
   * @returns {Promise<{ items: { id, kind, level, title, message, link, createdAt, read }[], unread: number }>}
   *   level = 'info' | 'warn' | 'danger'   link = หน้าที่จะไปเมื่อกด (เช่น "/stock/12") หรือค่าว่าง
   */
  list() {
    return request('GET', '/notifications')
  },

  /** กดอ่านอันเดียว (อ่านซ้ำได้ ไม่มีผลเสีย) @throws NOT_FOUND */
  markRead(id) {
    return request('POST', `/notifications/${encodeURIComponent(id)}/read`, {})
  },

  /** อ่านทั้งหมด → { marked: จำนวนที่เพิ่งถูกทำเครื่องหมาย } */
  markAllRead() {
    return request('POST', '/notifications/read-all', {})
  },
}

// =====================================================================
//  AI — ความเห็นของผู้ใช้ต่อคำแนะนำ
//  (ตัวคำแนะนำคำนวณฝั่งหน้าจอใน utils/aiInsights.js จากข้อมูลคลังและผลพยากรณ์)
// =====================================================================
const ai = {
  /**
   * ให้ AI (Groq) พยากรณ์ "พรุ่งนี้" จากประวัติออเดอร์จริง แล้วบันทึกผลไว้ที่ Backend
   * (หน้า Dashboard / Ai อ่านผลนี้ผ่าน dashboard.getSummary) — ใช้เวลาหลายวินาที
   * @returns {Promise<{ orders, peakStart, peakEnd, bestSeller, hourly, categories, advice: string[], source, generatedAt }>}
   * @throws AI_NOT_CONFIGURED (Backend ยังไม่มี GROQ_API_KEY), AI_ERROR (Groq ล้มเหลว), VALIDATION (ยังไม่มีออเดอร์)
   */
  createForecast() {
    return request('POST', '/ai/forecast', {})
  },

  /**
   * บันทึกว่าคำแนะนำข้อหนึ่ง "มีประโยชน์ไหม" (ให้ความเห็นซ้ำ = แทนที่ของเดิม)
   * @param {string} key  รหัสคำแนะนำ เช่น "restock-ing-shrimp"
   * @param {boolean} helpful
   * @returns {Promise<{ id: string, helpful: boolean }>}
   */
  sendFeedback(key, helpful) {
    return request('PUT', `/ai/feedback/${encodeURIComponent(key)}`, { helpful })
  },

  /** ความเห็นที่เคยให้ไว้ทั้งหมด: { [รหัสคำแนะนำ]: true | false } */
  listFeedback() {
    return request('GET', '/ai/feedback')
  },

  /**
   * ความแม่นของ AI: ผลพยากรณ์ย้อนหลัง 30 วันเทียบกับยอดจริง และเทียบกับสถิติธรรมดา (baseline)
   * @returns {Promise<{
   *   days: { date, forecastOrders, actualOrders, baselineOrders, forecastRevenue, actualRevenue, ordersErrorPct, revenueErrorPct }[],
   *   summary: { count, ordersMape, revenueMape, bias, baselineMape, aiBeatsBaseline: boolean | null },
   * }>}
   */
  accuracy() {
    return request('GET', '/ai/accuracy')
  },
}

// =====================================================================
//  CLOSING — ปิดร้าน: นับวัตถุดิบที่เหลือจริง + บันทึกของเสีย (วัดว่าของค้างคืนน้อยจริงไหม)
// =====================================================================
const closing = {
  /** วันนี้ปิดร้านหรือยัง → { date, closing: {...} | null, plannedLeftoverValue: number | null } */
  today() {
    return request('GET', '/closing/today')
  },

  /**
   * บันทึกการปิดร้านวันนี้ (วันละครั้ง) — Backend ปรับ stock ให้เท่าที่นับจริงและหักของเสียให้เอง
   * @param {{ note?: string, lines: { ingredientId: string, countedQty: number, wasteQty?: number }[] }} data
   *   countedQty = จำนวนที่เหลือจริงหลังทิ้งของเสียแล้ว, wasteQty = จำนวนที่ทิ้ง
   * @throws ALREADY_CLOSED (ปิดไปแล้ววันนี้), VALIDATION
   */
  create(data) {
    return request('POST', '/closing', data)
  },

  /** ผลปิดร้านย้อนหลัง 30 วัน → { days: [...], summary: { count, averageLeftoverValue, averageWasteValue, totalWasteValue } } */
  history() {
    return request('GET', '/closing/history')
  },
}

// =====================================================================
//  DASHBOARD — ข้อมูลที่การ์ดบนหน้าแรกแสดง (อ่านอย่างเดียว)
// =====================================================================
const dashboard = {
  /**
   * สถิติวันนี้ (คำนวณจากออเดอร์จริง) + ผลพยากรณ์ของ AI
   * @returns {Promise<{
   *   statistics: { orders: number, revenue: number, bestSeller: string },
   *   forecast: { orders: number, peakStart: string, peakEnd: string, bestSeller: string },
   * }>}
   */
  purchasing(date) {
    return request('GET', `/dashboard/purchasing${date ? `?date=${encodeURIComponent(date)}` : ''}`)
  },
  getSummary() {
    return request('GET', '/dashboard/summary')
  },
}

// =====================================================================
//  ส่งออก
// =====================================================================
export const api = {
  pos: {
    order: (id, action, fields) => request('POST', `/orders/${encodeURIComponent(id)}/${action}`, fields),
    purchases: () => request('GET', '/purchases'),
    supplier: fields => request('POST', '/suppliers', fields),
    purchase: fields => request('POST', '/purchases', fields),
    receive: (id, fields) => request('POST', `/purchases/${encodeURIComponent(id)}/receive`, fields),
    cancelPurchase: (id, fields) => request('POST', `/purchases/${encodeURIComponent(id)}/cancel`, fields),
    waste: fields => request('POST', '/waste', fields),
    reports: days => request('GET', `/reports/operations?days=${days}`),
    sessions: id => request('GET', `/staff/${encodeURIComponent(id)}/sessions`),
    revokeSession: (userId, id, fields) => request('POST', `/staff/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(id)}/revoke`, fields),
    transferOwner: fields => request('POST', '/staff/transfer-owner', fields),
  },
  restaurant: {
    staff: () => request('GET', '/staff'),
    approve: (id, approved) => request('PATCH', `/staff/${encodeURIComponent(id)}`, { approved }),
    cash: () => request('GET', '/cash/today'),
    closeCash: (data) => request('POST', '/cash/close', data),
    audit: () => request('GET', '/audit'),
  },
  /** ตรวจว่า Backend และฐานข้อมูลพร้อมไหม → { status: 'ok', database: 'ok' } (ไม่ต้องล็อกอิน) */
  health: () => request('GET', '/health'),
  auth,
  inventory,
  orders,
  notifications,
  ai,
  closing,
  dashboard,
  // AuthProvider เรียกเพื่อให้ออกจากระบบเมื่อ Backend บอกว่า token หมดอายุ
  setUnauthorizedHandler(handler) {
    onUnauthorized = handler
  },
}
