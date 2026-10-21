/**
 * Database — ฐานข้อมูลจำลองของระบบ (ทำงานในเบราว์เซอร์ บันทึกลง localStorage)
 *
 * จำลองพฤติกรรมของฐานข้อมูลจริงเท่าที่จำเป็น:
 *   - หลาย "ตาราง" (users, sessions, otps, ingredients, movements, menus)
 *   - ทุกคำสั่งเป็น async และ "เข้าคิวทีละคำสั่ง" จึงไม่มีสองคำสั่งแก้ข้อมูลชนกัน
 *     (เช่น กด + รัวๆ แล้วจำนวนไม่หาย)
 *   - transaction: หลายขั้นตอนสำเร็จพร้อมกันหรือไม่ก็ไม่เปลี่ยนอะไรเลย (rollback เมื่อเกิด error)
 *   - หน่วงเวลาเล็กน้อยได้ (latencyMs) ให้เห็นสถานะ "กำลังโหลด" เหมือนเรียกเครือข่ายจริง
 *   - ข้อมูลที่ส่งออกเป็น "สำเนา" เสมอ — แก้สำเนาแล้วฐานข้อมูลไม่เปลี่ยน ต้องเรียก update/transaction
 *
 * ไฟล์นี้ไม่รู้เรื่องกฎธุรกิจ (เช่น ชื่อห้ามซ้ำ, ลดต่ำกว่า 0 ไม่ได้) — กฎเหล่านั้นอยู่ที่ services/api.js
 *
 * ตัวอย่าง:
 *   const db = new Database({ storageKey: 'my.db', createSeed: async () => ({ items: [] }) })
 *   await db.insert('items', { id: 'a', name: 'x' })
 *   const rows = await db.select('items', (r) => r.name === 'x')
 */
import { ApiError } from './ApiError.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const clone = (value) => structuredClone(value)

export class Database {
  /**
   * @param {string} options.storageKey   ชื่อคีย์ใน localStorage
   * @param {() => Promise<object>} options.createSeed  สร้างข้อมูลเริ่มต้น { ชื่อตาราง: [แถว...] }
   * @param {number} [options.latencyMs=0]  เวลาหน่วงต่อคำสั่ง (มิลลิวินาที)
   */
  constructor({ storageKey, createSeed, latencyMs = 0 }) {
    this.storageKey = storageKey
    this.createSeed = createSeed
    this.latencyMs = latencyMs

    this.tables = null // ข้อมูลทุกตาราง (null = ยังไม่ได้โหลด)
    this.queue = Promise.resolve() // คิวคำสั่ง ให้ทำทีละอัน
  }

  // ---------- ภายใน ----------

  // โหลดจาก localStorage หรือสร้างจากข้อมูลเริ่มต้น (ทำครั้งเดียวตอนมีคำสั่งแรก)
  async init() {
    if (this.tables) return

    this.tables = this.load() ?? (await this.createSeed())
    this.persist()
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null // ข้อมูลเสียหาย → เริ่มใหม่จากข้อมูลตัวอย่าง
    }
  }

  persist() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.tables))
    } catch {
      // พื้นที่เต็ม/ถูกบล็อก: ข้อมูลยังอยู่ในหน่วยความจำ แต่หายเมื่อรีเฟรช
      console.warn(`[Database] บันทึกลง localStorage ไม่สำเร็จ (${this.storageKey})`)
    }
  }

  // เอางานเข้าคิว: รอคิวก่อนหน้า → รอ latency → ทำงาน
  // คิวไม่หยุดแม้งานก่อนหน้าล้มเหลว (กัน error ลูกโซ่)
  enqueue(work) {
    const result = this.queue.then(async () => {
      await this.init()
      if (this.latencyMs > 0) await sleep(this.latencyMs)
      return work()
    })
    this.queue = result.catch(() => {})
    return result
  }

  table(name) {
    const rows = this.tables[name]
    if (!rows) throw new ApiError('UNKNOWN_TABLE', `ไม่มีตาราง ${name}`)
    return rows
  }

  // ---------- คำสั่งอ่านข้อมูล ----------

  /** ดึงทุกแถวของตารางที่ผ่านเงื่อนไข (ไม่ใส่เงื่อนไข = ทุกแถว) — คืนสำเนา */
  select(table, predicate = () => true) {
    return this.enqueue(() => clone(this.table(table).filter(predicate)))
  }

  /** ดึงแถวเดียวจาก id — ไม่พบคืน null */
  get(table, id) {
    return this.enqueue(() => {
      const row = this.table(table).find((r) => r.id === id)
      return row ? clone(row) : null
    })
  }

  /** อ่านหลายตารางในคำสั่งเดียว: fn รับ (ชื่อตาราง) => แถวทั้งหมด และคืนค่าอะไรก็ได้ */
  read(fn) {
    return this.enqueue(() => clone(fn((name) => this.table(name))))
  }

  // ---------- คำสั่งเขียนข้อมูล ----------

  /** เพิ่มแถวใหม่ (ต้องมี id) — คืนสำเนาของแถวที่เพิ่ง */
  insert(table, row) {
    return this.transaction((draft) => {
      if (draft[table] === undefined) throw new ApiError('UNKNOWN_TABLE', `ไม่มีตาราง ${table}`)
      if (draft[table].some((r) => r.id === row.id)) throw new ApiError('DUPLICATE_ID', 'id ซ้ำ')
      draft[table].push(clone(row))
      return row
    })
  }

  /** แก้บางฟิลด์ของแถว — ไม่พบจะ error */
  update(table, id, patch) {
    return this.transaction((draft) => {
      const row = draft[table]?.find((r) => r.id === id)
      if (!row) throw new ApiError('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข')
      Object.assign(row, clone(patch))
      return row
    })
  }

  /** ลบแถว — ไม่พบถือว่าสำเร็จ (ลบซ้ำได้ ไม่เกิด error) */
  remove(table, id) {
    return this.transaction((draft) => {
      draft[table] = (draft[table] ?? []).filter((r) => r.id !== id)
      return true
    })
  }

  /**
   * ทำหลายขั้นตอนเป็นก้อนเดียว (atomic)
   * work(draft) แก้ draft (สำเนาของทุกตาราง) ได้อิสระ:
   *   - จบปกติ    → draft กลายเป็นข้อมูลจริงและบันทึก
   *   - โยน error → ทิ้ง draft ข้อมูลจริงไม่เปลี่ยนเลย (rollback)
   * work ต้องเป็นฟังก์ชันธรรมดา (ไม่ใช่ async) เพราะอยู่ในคิวและต้องจบทันที
   * คืนสำเนาของค่าที่ work คืน
   */
  transaction(work) {
    return this.enqueue(() => {
      const draft = clone(this.tables)
      const result = work(draft)
      this.tables = draft
      this.persist()
      return clone(result)
    })
  }

  /** ล้างข้อมูลทั้งหมดแล้วกลับไปใช้ข้อมูลตัวอย่าง (ใช้ตอนพัฒนา/ทดสอบ) */
  reset() {
    return this.enqueue(async () => {
      this.tables = await this.createSeed()
      this.persist()
      return true
    })
  }
}
