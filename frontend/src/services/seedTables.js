/**
 * สร้างข้อมูลเริ่มต้นของ "ทุกตาราง" ในฐานข้อมูลจำลอง
 * Database.js เรียกฟังก์ชันนี้ตอนยังไม่มีข้อมูลที่บันทึกไว้ (หรือหลังสั่ง reset)
 *
 * ตัวข้อมูลจริงอยู่ที่ data/mockData.js — ไฟล์นี้แค่ประกอบเป็นตารางและแฮชรหัสผ่าน
 */
import {
  MOCK_FORECAST,
  MOCK_INGREDIENTS,
  MOCK_MENUS,
  MOCK_MOVEMENTS,
  MOCK_ORDERS,
  MOCK_STATISTICS,
  MOCK_USERS,
} from '../data/mockData.js'
import { hashPassword, randomSalt } from './crypto.js'

export async function createSeedTables() {
  // แฮชรหัสผ่านของผู้ใช้ตัวอย่างก่อนเก็บ (ไม่เก็บรหัสผ่านเป็นข้อความเปล่า)
  const users = await Promise.all(
    MOCK_USERS.map(async ({ password, ...user }) => {
      const salt = randomSalt()
      return { ...user, salt, passwordHash: await hashPassword(password, salt) }
    }),
  )

  // structuredClone: แยกสำเนาออกจากข้อมูลต้นฉบับ เพื่อให้การแก้ฐานข้อมูลไม่ไปเปลี่ยนค่าใน mockData
  return {
    // --- บัญชีผู้ใช้ ---
    users,
    sessions: [], // { id: token, userId, createdAt }
    otps: [], // { id: email, otp, expiresAt, attempts, resetToken }

    // --- คลังวัตถุดิบ เมนู และออเดอร์ ---
    ingredients: structuredClone(MOCK_INGREDIENTS),
    movements: structuredClone(MOCK_MOVEMENTS),
    menus: structuredClone(MOCK_MENUS),
    orders: structuredClone(MOCK_ORDERS),

    // --- ความเห็นต่อคำแนะนำของ AI --- { id: รหัสคำแนะนำ, helpful: true | false, createdAt }
    feedback: [],

    // --- ข้อมูลหน้า Dashboard (แต่ละตารางมีแถวเดียว) ---
    statistics: [structuredClone(MOCK_STATISTICS)],
    forecast: [structuredClone(MOCK_FORECAST)],
  }
}
