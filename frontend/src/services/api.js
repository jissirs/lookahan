/**
 * api — "สัญญา" ระหว่างหน้าจอกับหลังบ้าน
 *
 * หน้าจอ/context เรียกข้อมูลผ่านไฟล์นี้เท่านั้น (ไม่แตะฐานข้อมูลโดยตรง)
 *   หน้าจอ → context (AuthProvider / InventoryProvider) → api.js → Database.js
 *
 * ตอนนี้ทุกฟังก์ชันทำงานกับฐานข้อมูลจำลอง (Database.js) และ "บังคับกฎธุรกิจที่นี่" เหมือนหลังบ้านจริง:
 * ตรวจข้อมูล, ชื่อห้ามซ้ำ, ลด stock ต่ำกว่า 0 ไม่ได้ ฯลฯ — ผิดกฎจะโยน ApiError (มี code + message)
 *
 * ===== วิธีต่อ backend จริง (เช่น Flask) =====
 * แก้เฉพาะเนื้อในฟังก์ชันของไฟล์นี้ให้เรียก fetch แทน โดยคงชื่อฟังก์ชัน พารามิเตอร์ และค่าที่คืนไว้เหมือนเดิม
 * และแปลง error ของเซิร์ฟเวอร์เป็น ApiError ด้วย code ชุดเดียวกับด้านล่าง หน้าจอจะไม่ต้องแก้
 * ตารางเทียบกับ REST ที่แนะนำอยู่ใน README.md หัวข้อ "ต่อ API จริง"
 *
 * ===== รายการ error code =====
 *   auth      : INVALID_CREDENTIALS, EMAIL_TAKEN, UNAUTHORIZED, EMAIL_NOT_FOUND,
 *               INVALID_OTP, OTP_EXPIRED, TOO_MANY_ATTEMPTS, INVALID_RESET_TOKEN, WEAK_PASSWORD, VALIDATION
 *   inventory : DUPLICATE_NAME, NOT_FOUND, INSUFFICIENT_STOCK, VALIDATION
 *   orders    : INSUFFICIENT_STOCK, NOT_FOUND, VALIDATION
 *   ai        : VALIDATION
 *   dashboard : (ไม่มี — อ่านอย่างเดียว)
 */
import { INGREDIENT_CATEGORIES, INGREDIENT_UNITS, MENU_CATEGORIES } from '../data/seed.js'
import { getPasswordError } from '../utils/passwordRules.js'
import { ApiError } from './ApiError.js'
import { hashPassword, randomOtp, randomSalt, randomToken } from './crypto.js'
import { Database } from './Database.js'
import { createSeedTables } from './seedTables.js'

// หน่วงเวลาจำลองเครือข่าย (มิลลิวินาที) ปรับได้ด้วยไฟล์ .env: VITE_MOCK_LATENCY=0
const LATENCY_MS = Number(import.meta.env.VITE_MOCK_LATENCY ?? 60)

const OTP_LIFETIME_MS = 5 * 60 * 1000 // OTP หมดอายุใน 5 นาที
const OTP_MAX_ATTEMPTS = 5 // กรอกผิดได้ไม่เกินกี่ครั้ง

// storageKey มีเลขเวอร์ชัน: เปลี่ยนเลขเมื่อโครงสร้าง/ข้อมูลตัวอย่างเปลี่ยนแบบที่ข้อมูลเก่าใช้ต่อไม่ได้
// ฐานข้อมูลจะเริ่มใหม่จากข้อมูลตัวอย่าง (data/mockData.js) แทนการอ่านข้อมูลเก่าที่ไม่ตรงกัน
//   v2 = เพิ่มข้อมูลตัวอย่างชุดใหญ่ + ตาราง statistics / forecast
//   v3 = เพิ่มตาราง orders
//   v4 = เพิ่มตาราง feedback + forecast รายชั่วโมง/สัดส่วนประเภทเมนู
const STORAGE_KEY = 'lookahan.db.v4'
const db = new Database({
  storageKey: STORAGE_KEY,
  createSeed: createSeedTables,
  latencyMs: LATENCY_MS,
})

// ล้างฐานข้อมูลรุ่นเก่าที่ไม่ใช้แล้วออกจาก localStorage (กันพื้นที่เต็ม)
for (const legacy of ['lookahan.inventory.v1', 'lookahan.db.v1', 'lookahan.db.v2', 'lookahan.db.v3']) {
  try {
    localStorage.removeItem(legacy)
  } catch {
    // ไม่มีสิทธิ์เข้าถึง localStorage — ข้ามไป
  }
}

// ---------- ตัวช่วยทั่วไป ----------

const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const normalize = (text) => String(text ?? '').trim().toLowerCase()
const isBlank = (text) => !String(text ?? '').trim()
const isNonNegativeInt = (n) => Number.isInteger(n) && n >= 0

// ตัดฟิลด์ลับ (รหัสผ่านที่แฮช, salt) ออกก่อนส่งให้หน้าจอ
const toPublicUser = ({ passwordHash, salt, ...user }) => user // eslint-disable-line no-unused-vars

const validation = (message) => new ApiError('VALIDATION', message)

// =====================================================================
//  AUTH — บัญชีผู้ใช้
// =====================================================================
const auth = {
  /**
   * สมัครสมาชิก
   * @returns {Promise<{ user }>}
   * @throws EMAIL_TAKEN (อีเมลซ้ำ), WEAK_PASSWORD, VALIDATION
   */
  async register({ name, surname, email, password }) {
    if (isBlank(name) || isBlank(surname) || isBlank(email)) throw validation('Please fill in all fields')

    const passwordError = getPasswordError(password)
    if (passwordError) throw new ApiError('WEAK_PASSWORD', passwordError)

    // แฮชก่อนเข้า transaction เพราะ transaction ต้องเป็นฟังก์ชันที่จบทันที (ไม่ async)
    const salt = randomSalt()
    const passwordHash = await hashPassword(password, salt)

    const user = await db.transaction((draft) => {
      if (draft.users.some((u) => normalize(u.email) === normalize(email))) {
        throw new ApiError('EMAIL_TAKEN', 'This email is already registered')
      }
      const row = {
        id: uid('user'),
        name: name.trim(),
        surname: surname.trim(),
        email: email.trim(),
        salt,
        passwordHash,
        createdAt: new Date().toISOString(),
      }
      draft.users.push(row)
      return row
    })

    return { user: toPublicUser(user) }
  },

  /**
   * ล็อกอินด้วย "name หรือ email" + รหัสผ่าน
   * @returns {Promise<{ token: string, user }>}
   * @throws INVALID_CREDENTIALS (ข้อความเดียวกันไม่ว่าผิดที่ชื่อหรือรหัส — ไม่บอกใบ้ผู้โจมตี)
   */
  async login(identifier, password) {
    const key = normalize(identifier)
    const candidates = await db.select('users', (u) => normalize(u.name) === key || normalize(u.email) === key)

    // ชื่ออาจซ้ำกันได้ จึงลองทุกคนที่ตรง แล้วเอาคนที่รหัสผ่านถูก
    for (const user of candidates) {
      if ((await hashPassword(password, user.salt)) === user.passwordHash) {
        const token = randomToken()
        await db.insert('sessions', { id: token, userId: user.id, createdAt: new Date().toISOString() })
        return { token, user: toPublicUser(user) }
      }
    }

    throw new ApiError('INVALID_CREDENTIALS', 'Incorrect name/email or password')
  },

  /**
   * ตรวจว่า token ยังใช้ได้ไหม (เรียกตอนเปิดแอป) แล้วคืนข้อมูลผู้ใช้
   * @throws UNAUTHORIZED
   */
  async me(token) {
    const session = token ? await db.get('sessions', token) : null
    const user = session ? await db.get('users', session.userId) : null
    if (!user) throw new ApiError('UNAUTHORIZED', 'Session expired')
    return toPublicUser(user)
  },

  /** ออกจากระบบ — ลบ session (ไม่เจอก็ไม่เป็นไร) */
  async logout(token) {
    if (token) await db.remove('sessions', token)
  },

  /**
   * ขอ OTP สำหรับรีเซ็ตรหัสผ่าน
   * ระบบจริงจะส่ง OTP ทางอีเมลและ "ไม่คืนค่า otp" — ที่คืนกลับมาด้วยเพราะเป็นโหมดจำลอง (ไม่มีอีเมลจริงให้อ่าน)
   * @returns {Promise<{ otp: string }>}
   * @throws EMAIL_NOT_FOUND
   */
  async requestOtp(email) {
    const key = normalize(email)
    if (!key) throw validation('Please enter your email')

    const otp = randomOtp()
    await db.transaction((draft) => {
      if (!draft.users.some((u) => normalize(u.email) === key)) {
        throw new ApiError('EMAIL_NOT_FOUND', 'No account found with this email')
      }
      // ขอใหม่ = แทนที่ OTP เดิม (id ของแถว = อีเมล จึงมีได้ทีละ 1 รหัสต่ออีเมล)
      draft.otps = draft.otps.filter((o) => o.id !== key)
      draft.otps.push({ id: key, otp, expiresAt: Date.now() + OTP_LIFETIME_MS, attempts: 0, resetToken: null })
    })

    return { otp }
  },

  /**
   * ตรวจ OTP — ถูกต้องแล้วได้ resetToken ไปใช้ตั้งรหัสผ่านใหม่ในขั้นถัดไป
   * @returns {Promise<{ resetToken: string }>}
   * @throws INVALID_OTP, OTP_EXPIRED, TOO_MANY_ATTEMPTS
   */
  async verifyOtp(email, otp) {
    const key = normalize(email)

    // ใช้ผลลัพธ์แทนการ throw ใน transaction: ถ้า throw จะ rollback ทำให้ "จำนวนครั้งที่ผิด" ไม่ถูกนับ
    const outcome = await db.transaction((draft) => {
      const entry = draft.otps.find((o) => o.id === key)
      if (!entry || Date.now() > entry.expiresAt) return { error: 'OTP_EXPIRED' }
      if (entry.attempts >= OTP_MAX_ATTEMPTS) return { error: 'TOO_MANY_ATTEMPTS' }

      if (entry.otp !== String(otp).trim()) {
        entry.attempts += 1
        return { error: 'INVALID_OTP' }
      }

      entry.resetToken = randomToken()
      return { resetToken: entry.resetToken }
    })

    const messages = {
      OTP_EXPIRED: 'OTP expired, please request a new one',
      TOO_MANY_ATTEMPTS: 'Too many attempts, please request a new OTP',
      INVALID_OTP: 'Incorrect OTP',
    }
    if (outcome.error) throw new ApiError(outcome.error, messages[outcome.error])
    return { resetToken: outcome.resetToken }
  },

  /**
   * ตั้งรหัสผ่านใหม่ด้วย resetToken ที่ได้จาก verifyOtp (ใช้ได้ครั้งเดียว)
   * เปลี่ยนแล้วทุกอุปกรณ์ที่ล็อกอินค้างอยู่จะถูกเตะออก
   * @throws INVALID_RESET_TOKEN, WEAK_PASSWORD
   */
  async resetPassword(resetToken, newPassword) {
    const passwordError = getPasswordError(newPassword)
    if (passwordError) throw new ApiError('WEAK_PASSWORD', passwordError)

    const salt = randomSalt()
    const passwordHash = await hashPassword(newPassword, salt)

    await db.transaction((draft) => {
      const entry = draft.otps.find((o) => o.resetToken && o.resetToken === resetToken)
      if (!entry || Date.now() > entry.expiresAt) {
        throw new ApiError('INVALID_RESET_TOKEN', 'Reset link expired, please start again')
      }

      const user = draft.users.find((u) => normalize(u.email) === entry.id)
      if (!user) throw new ApiError('INVALID_RESET_TOKEN', 'Reset link expired, please start again')

      user.salt = salt
      user.passwordHash = passwordHash
      draft.otps = draft.otps.filter((o) => o.id !== entry.id) // ใช้แล้วทิ้ง
      draft.sessions = draft.sessions.filter((s) => s.userId !== user.id)
    })

    return { ok: true }
  },
}

// =====================================================================
//  INVENTORY — วัตถุดิบ ประวัติ stock และเมนู
// =====================================================================

// ตรวจข้อมูลวัตถุดิบ (ใช้ทั้งตอนสร้างและแก้) — patch คือเฉพาะฟิลด์ที่ส่งมา
function validateIngredientFields(fields) {
  if ('name' in fields && isBlank(fields.name)) throw validation('กรุณากรอกชื่อวัตถุดิบ')
  if ('category' in fields && !INGREDIENT_CATEGORIES.includes(fields.category)) throw validation('ประเภทวัตถุดิบไม่ถูกต้อง')
  if ('unit' in fields && !INGREDIENT_UNITS.includes(fields.unit)) throw validation('หน่วยไม่ถูกต้อง')
  if ('price' in fields && !isNonNegativeInt(fields.price)) throw validation('ราคาต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป')
}

// ชื่อวัตถุดิบห้ามซ้ำ (ไม่สนตัวพิมพ์เล็ก/ใหญ่) — exceptId ใช้ตอนแก้ไข เพื่อไม่นับตัวเอง
function assertIngredientNameFree(draft, name, exceptId = null) {
  const key = normalize(name)
  if (draft.ingredients.some((i) => i.id !== exceptId && normalize(i.name) === key)) {
    throw new ApiError('DUPLICATE_NAME', 'มีวัตถุดิบชื่อนี้อยู่แล้ว')
  }
}

// ตรวจข้อมูลเมนู
function validateMenuFields(fields, draft) {
  if ('name' in fields && isBlank(fields.name)) throw validation('กรุณากรอกชื่อเมนู')
  if ('category' in fields && !MENU_CATEGORIES.includes(fields.category)) throw validation('ประเภทเมนูไม่ถูกต้อง')
  if ('price' in fields && !isNonNegativeInt(fields.price)) throw validation('ราคาต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป')

  // สูตรอาหาร: ทุกบรรทัดต้องอ้างวัตถุดิบที่มีจริง และปริมาณเป็นจำนวนเต็มบวก
  if ('recipe' in fields) {
    for (const line of fields.recipe) {
      if (!draft.ingredients.some((i) => i.id === line.ingredientId)) throw new ApiError('NOT_FOUND', 'ไม่พบวัตถุดิบในสูตร')
      if (!Number.isInteger(line.qty) || line.qty < 1) throw validation('ปริมาณในสูตรต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')
    }
  }
}

// ฟิลด์ที่ยอมให้แก้ได้ (ฟิลด์อื่น เช่น quantity แก้ตรงๆ ไม่ได้ — ต้องผ่าน adjust เพื่อให้มีประวัติ)
const INGREDIENT_EDITABLE = ['name', 'category', 'unit', 'price']
const MENU_EDITABLE = ['name', 'category', 'price', 'image', 'details', 'note', 'available', 'recipe']

// เลือกเฉพาะฟิลด์ที่อนุญาตจาก patch
const pick = (source, keys) => Object.fromEntries(keys.filter((k) => k in source).map((k) => [k, source[k]]))

const inventory = {
  /** ข้อมูลทั้งหมดที่หน้าจอต้องใช้ตอนเปิดแอป: { ingredients, movements, menus, orders } */
  async getSnapshot() {
    return db.read((table) => ({
      ingredients: table('ingredients'),
      movements: table('movements'),
      menus: table('menus'),
      // ใหม่ → เก่า (เลขออเดอร์มากสุดก่อน)
      orders: [...table('orders')].sort((a, b) => b.number.localeCompare(a.number)),
    }))
  },

  /**
   * เพิ่ม (delta > 0) หรือลด (delta < 0) จำนวนวัตถุดิบ พร้อมบันทึกประวัติ
   * ทั้งสองอย่างสำเร็จพร้อมกัน หรือไม่ก็ไม่เปลี่ยนอะไรเลย (transaction)
   * @returns {Promise<{ ingredient, movement }>}
   * @throws NOT_FOUND, INSUFFICIENT_STOCK (ลดแล้วติดลบ), VALIDATION
   */
  async adjustIngredient(id, delta, label) {
    if (!Number.isInteger(delta) || delta === 0) throw validation('จำนวนต้องเป็นจำนวนเต็มและไม่เป็น 0')

    return db.transaction((draft) => {
      const ingredient = draft.ingredients.find((i) => i.id === id)
      if (!ingredient) throw new ApiError('NOT_FOUND', 'ไม่พบวัตถุดิบ')

      const next = ingredient.quantity + delta
      if (next < 0) throw new ApiError('INSUFFICIENT_STOCK', `${ingredient.name} เหลือไม่พอ (เหลือ ${ingredient.quantity} ${ingredient.unit})`)

      ingredient.quantity = next

      const type = delta > 0 ? 'Add' : 'Drop'
      const movement = {
        id: uid('mov'),
        ingredientId: id,
        date: new Date().toISOString(),
        type,
        label: label || type,
        amount: delta,
        balance: next, // ยอดคงเหลือหลังเปลี่ยน
      }
      draft.movements.push(movement)

      return { ingredient, movement }
    })
  },

  /** สร้างวัตถุดิบใหม่ (เริ่มที่ 0 ชิ้น) @throws DUPLICATE_NAME, VALIDATION */
  async createIngredient({ name, category, unit, price = 0 }) {
    const fields = { name, category, unit, price }
    validateIngredientFields(fields)

    return db.transaction((draft) => {
      assertIngredientNameFree(draft, name)
      const row = { id: uid('ing'), ...fields, name: name.trim(), quantity: 0 }
      draft.ingredients.push(row)
      return row
    })
  },

  /** แก้ชื่อ/ประเภท/หน่วย/ราคา (แก้จำนวนต้องใช้ adjustIngredient) @throws DUPLICATE_NAME, NOT_FOUND, VALIDATION */
  async updateIngredient(id, patch) {
    const fields = pick(patch, INGREDIENT_EDITABLE)
    validateIngredientFields(fields)

    return db.transaction((draft) => {
      const ingredient = draft.ingredients.find((i) => i.id === id)
      if (!ingredient) throw new ApiError('NOT_FOUND', 'ไม่พบวัตถุดิบ')

      if ('name' in fields) {
        assertIngredientNameFree(draft, fields.name, id)
        fields.name = fields.name.trim()
      }
      Object.assign(ingredient, fields)
      return ingredient
    })
  },

  /** สร้างเมนูใหม่ (ค่าเริ่มต้น: ยังไม่พร้อมขาย ไม่มีสูตร) @throws NOT_FOUND, VALIDATION */
  async createMenu(data) {
    // ชื่อบังคับ ส่วนประเภท/ราคามีค่าเริ่มต้นให้
    const fields = { category: MENU_CATEGORIES[0], price: 0, ...pick(data, MENU_EDITABLE) }
    if (isBlank(fields.name)) throw validation('กรุณากรอกชื่อเมนู')
    return db.transaction((draft) => {
      validateMenuFields(fields, draft)
      const row = {
        image: '',
        details: '',
        note: '',
        available: false,
        recipe: [],
        ...fields,
        id: uid('menu'),
        name: fields.name.trim(),
      }
      draft.menus.push(row)
      return row
    })
  },

  /** แก้เมนู (รวมสูตรอาหารทั้งก้อน) @throws NOT_FOUND, VALIDATION */
  async updateMenu(id, patch) {
    const fields = pick(patch, MENU_EDITABLE)
    return db.transaction((draft) => {
      const menu = draft.menus.find((m) => m.id === id)
      if (!menu) throw new ApiError('NOT_FOUND', 'ไม่พบเมนู')

      validateMenuFields(fields, draft)
      if ('name' in fields) fields.name = fields.name.trim()
      Object.assign(menu, fields)
      return menu
    })
  },
}

// =====================================================================
//  ORDERS — ออเดอร์จากลูกค้า
// =====================================================================

// ลำดับสถานะที่เดินหน้าได้ (ข้ามขั้นหรือถอยหลังไม่ได้)
const NEXT_ORDER_STATUS = { new: 'cooking', cooking: 'ready', ready: 'done' }

// เลขออเดอร์ถัดไป เช่น "0163" (บวกจากเลขมากสุดที่มี)
function nextOrderNumber(orders) {
  const highest = orders.reduce((max, o) => Math.max(max, Number(o.number)), 0)
  return String(highest + 1).padStart(4, '0')
}

const orders = {
  /**
   * สร้างออเดอร์ใหม่ และ "ตัด stock ตามสูตรเมนู" ทันที (ทั้งหมดอยู่ใน transaction เดียว)
   *   1) ตรวจว่าเมนูมีอยู่และเปิดขาย
   *   2) รวมวัตถุดิบที่ต้องใช้ทั้งออเดอร์ (เมนูต่างกันอาจใช้วัตถุดิบตัวเดียวกัน)
   *   3) ถ้าวัตถุดิบตัวไหนไม่พอ → ปฏิเสธทั้งออเดอร์ ไม่ตัด stock เลย
   *   4) ตัด stock พร้อมบันทึกประวัติ (ชนิด Order, ข้อความ "Order #xxxx")
   * @param {{ items: { menuId: string, qty: number }[], note?: string }} data
   * @returns {Promise<{ order, ingredients, movements }>}
   *          ingredients/movements คือที่ "เปลี่ยน" จากการตัด stock (ให้หน้าจออัปเดตตาม)
   * @throws VALIDATION, NOT_FOUND, INSUFFICIENT_STOCK
   */
  async create({ items, note = '' }) {
    // รวมรายการที่เลือกเมนูซ้ำ และตัดรายการที่จำนวน 0
    const wanted = new Map()
    for (const { menuId, qty } of items) {
      if (!Number.isInteger(qty) || qty < 0 || qty > 99) throw validation('จำนวนต้องเป็นจำนวนเต็ม 1 ถึง 99')
      if (qty > 0) wanted.set(menuId, (wanted.get(menuId) ?? 0) + qty)
    }
    if (wanted.size === 0) throw validation('กรุณาเลือกเมนูอย่างน้อย 1 รายการ')

    return db.transaction((draft) => {
      // 1) ตรวจเมนู
      const lines = [...wanted].map(([menuId, qty]) => {
        const menu = draft.menus.find((m) => m.id === menuId)
        if (!menu) throw new ApiError('NOT_FOUND', 'ไม่พบเมนูที่เลือก')
        if (!menu.available) throw validation(`เมนู "${menu.name}" ปิดขายอยู่`)
        return { menu, qty }
      })

      // 2) รวมวัตถุดิบที่ต้องใช้: ingredientId → จำนวนรวม
      const needed = new Map()
      for (const { menu, qty } of lines) {
        for (const line of menu.recipe) {
          needed.set(line.ingredientId, (needed.get(line.ingredientId) ?? 0) + line.qty * qty)
        }
      }

      // 3) ตรวจว่าพอทุกตัว — รวบรวมที่ไม่พอทั้งหมดเพื่อบอกในข้อความเดียว
      const lacking = []
      for (const [ingredientId, qty] of needed) {
        const ingredient = draft.ingredients.find((i) => i.id === ingredientId)
        if (!ingredient || ingredient.quantity < qty) {
          const name = ingredient?.name ?? ingredientId
          lacking.push(`${name} (ต้องใช้ ${qty} เหลือ ${ingredient?.quantity ?? 0} ${ingredient?.unit ?? ''})`.trim())
        }
      }
      if (lacking.length > 0) throw new ApiError('INSUFFICIENT_STOCK', `วัตถุดิบไม่พอ: ${lacking.join(', ')}`)

      // 4) ตัด stock + บันทึกประวัติ
      const number = nextOrderNumber(draft.orders)
      const now = new Date().toISOString()
      const changedIngredients = []
      const newMovements = []

      for (const [ingredientId, qty] of needed) {
        const ingredient = draft.ingredients.find((i) => i.id === ingredientId)
        ingredient.quantity -= qty

        const movement = {
          id: uid('mov'),
          ingredientId,
          date: now,
          type: 'Order',
          label: `Order #${number}`,
          amount: -qty,
          balance: ingredient.quantity,
        }
        draft.movements.push(movement)
        changedIngredients.push(ingredient)
        newMovements.push(movement)
      }

      // 5) สร้างออเดอร์ (เก็บสำเนาชื่อ/ราคาเมนู และรายการที่ตัด stock ไว้ใช้คืนตอนยกเลิก)
      const orderItems = lines.map(({ menu, qty }) => ({ menuId: menu.id, name: menu.name, price: menu.price, qty }))
      const order = {
        id: uid('order'),
        number,
        createdAt: now,
        status: 'new',
        items: orderItems,
        total: orderItems.reduce((sum, item) => sum + item.price * item.qty, 0),
        note: String(note).trim(),
        usage: [...needed].map(([ingredientId, qty]) => ({ ingredientId, qty })),
      }
      draft.orders.push(order)

      return { order, ingredients: changedIngredients, movements: newMovements }
    })
  },

  /**
   * เลื่อนออเดอร์ไปสถานะถัดไป: new → cooking → ready → done
   * @returns {Promise<order>}
   * @throws NOT_FOUND, VALIDATION (อยู่สถานะสุดท้ายแล้ว หรือถูกยกเลิก)
   */
  async advance(id) {
    return db.transaction((draft) => {
      const order = draft.orders.find((o) => o.id === id)
      if (!order) throw new ApiError('NOT_FOUND', 'ไม่พบออเดอร์')

      const next = NEXT_ORDER_STATUS[order.status]
      if (!next) throw validation('ออเดอร์นี้เปลี่ยนสถานะต่อไม่ได้แล้ว')

      order.status = next
      return order
    })
  },

  /**
   * ยกเลิกออเดอร์ และ "คืน stock" ตามที่ตัดไปตอนสร้าง (บันทึกประวัติชนิด Add, "Cancel #xxxx")
   * ยกเลิกได้เฉพาะออเดอร์ที่ยังไม่เสร็จสิ้น
   * @returns {Promise<{ order, ingredients, movements }>}
   * @throws NOT_FOUND, VALIDATION
   */
  async cancel(id) {
    return db.transaction((draft) => {
      const order = draft.orders.find((o) => o.id === id)
      if (!order) throw new ApiError('NOT_FOUND', 'ไม่พบออเดอร์')
      if (order.status === 'done' || order.status === 'cancelled') {
        throw validation('ออเดอร์ที่เสร็จสิ้นหรือยกเลิกแล้วยกเลิกซ้ำไม่ได้')
      }

      const now = new Date().toISOString()
      const changedIngredients = []
      const newMovements = []

      for (const { ingredientId, qty } of order.usage) {
        const ingredient = draft.ingredients.find((i) => i.id === ingredientId)
        if (!ingredient) continue // วัตถุดิบถูกลบไปแล้ว ข้าม

        ingredient.quantity += qty
        const movement = {
          id: uid('mov'),
          ingredientId,
          date: now,
          type: 'Add',
          label: `Cancel #${order.number}`,
          amount: qty,
          balance: ingredient.quantity,
        }
        draft.movements.push(movement)
        changedIngredients.push(ingredient)
        newMovements.push(movement)
      }

      order.status = 'cancelled'
      return { order, ingredients: changedIngredients, movements: newMovements }
    })
  },
}

// =====================================================================
//  AI — ความเห็นของผู้ใช้ต่อคำแนะนำ
//  (ตัวคำแนะนำคำนวณฝั่งหน้าจอใน utils/aiInsights.js จากข้อมูลคลังและผลพยากรณ์)
// =====================================================================
const ai = {
  /**
   * บันทึกว่าคำแนะนำข้อหนึ่ง "มีประโยชน์ไหม" (ให้ความเห็นซ้ำ = แทนที่ของเดิม)
   * @param {string} key  รหัสคำแนะนำ เช่น "restock-ing-shrimp"
   * @param {boolean} helpful
   * @returns {Promise<{ id: string, helpful: boolean }>}
   */
  async sendFeedback(key, helpful) {
    if (isBlank(key) || typeof helpful !== 'boolean') throw validation('ข้อมูลความเห็นไม่ถูกต้อง')

    return db.transaction((draft) => {
      draft.feedback = draft.feedback.filter((f) => f.id !== key)
      const row = { id: key, helpful, createdAt: new Date().toISOString() }
      draft.feedback.push(row)
      return row
    })
  },

  /** ความเห็นที่เคยให้ไว้ทั้งหมด: { [รหัสคำแนะนำ]: true | false } */
  async listFeedback() {
    const rows = await db.select('feedback')
    return Object.fromEntries(rows.map((row) => [row.id, row.helpful]))
  },
}

// =====================================================================
//  DASHBOARD — ข้อมูลที่การ์ดบนหน้าแรกแสดง (อ่านอย่างเดียว)
// =====================================================================
const dashboard = {
  /**
   * สถิติวันนี้ + ผลพยากรณ์ของ AI
   * @returns {Promise<{
   *   statistics: { orders: number, revenue: number, bestSeller: string },
   *   forecast: { orders: number, peakStart: string, peakEnd: string, bestSeller: string },
   * }>}
   * ตอนนี้เป็นข้อมูลตัวอย่างในฐานข้อมูลจำลอง — ระบบจริงจะคำนวณจากออเดอร์และผลของ AI
   */
  async getSummary() {
    return db.read((table) => ({
      statistics: table('statistics')[0],
      forecast: table('forecast')[0],
    }))
  },
}

// =====================================================================
//  ส่งออก
// =====================================================================
export const api = {
  auth,
  inventory,
  orders,
  ai,
  dashboard,
  // true = กำลังใช้ฐานข้อมูลจำลอง (หน้าจอใช้ตัดสินใจแสดง OTP ให้ดูตอนพัฒนา)
  isMock: true,
  // เครื่องมือตอนพัฒนา: เปิด console แล้วพิมพ์ await window.__resetDb() เพื่อล้างข้อมูลกลับเป็นตัวอย่าง
  resetDatabase: () => db.reset(),
}

if (import.meta.env.DEV) {
  window.__resetDb = async () => {
    await api.resetDatabase()
    localStorage.removeItem('lookahan.auth')
    location.reload()
  }
}
