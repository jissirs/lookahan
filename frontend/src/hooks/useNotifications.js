import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api.js'

const POLL_SECONDS = 30 // ถาม Backend ว่ามีแจ้งเตือนใหม่ไหมทุกกี่วินาที (เฉพาะตอนแท็บเปิดอยู่)
const REFRESH_EVENT = 'lookahan:notifications-refresh' // ชื่อ "สัญญาณ" ที่ใช้สั่งให้โหลดแจ้งเตือนใหม่ทันที

/**
 * สั่งให้กระดิ่งโหลดแจ้งเตือนใหม่ "ตอนนี้เลย" (ไม่ต้องรอรอบ 30 วินาที)
 * เรียกหลังทำอะไรที่ Backend อาจสร้างแจ้งเตือน เช่น เพิ่ม/ลด stock, สร้างออเดอร์, ให้ AI วิเคราะห์
 * (ใช้ event ของเบราว์เซอร์เป็นตัวส่งสัญญาณ จึงเรียกจากไฟล์ไหนก็ได้ ไม่ต้องส่งค่าผ่านหลายชั้น)
 */
export function refreshNotifications() {
  window.dispatchEvent(new Event(REFRESH_EVENT))
}

/**
 * บอกเวลาแบบอ่านง่าย เช่น "เมื่อสักครู่", "5 นาทีที่แล้ว", "3 ชั่วโมงที่แล้ว", "2 วันที่แล้ว"
 * @param {string} iso เวลาแบบ ISO ที่ Backend ส่งมา (ลงท้ายด้วย Z)
 */
export function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'เมื่อสักครู่'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} นาทีที่แล้ว`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ชั่วโมงที่แล้ว`
  return `${Math.floor(seconds / 86400)} วันที่แล้ว`
}

/**
 * แจ้งเตือนของระบบ (กระดิ่งที่ Header) — โหลดจาก Backend และอัปเดตเองอัตโนมัติ
 *
 * @returns {{
 *   items: { id, kind, level, title, message, link, createdAt, read }[],   30 อันล่าสุด ใหม่ → เก่า
 *   unread: number,                      จำนวนที่ "ฉัน" ยังไม่ได้อ่าน (ตัวเลขบนกระดิ่ง)
 *   markRead: (id) => void,              กดอ่านอันเดียว
 *   markAllRead: () => void,             อ่านทั้งหมด
 * }}
 *
 * โหลดใหม่เมื่อ: เปิดหน้า / ทุก POLL_SECONDS วินาที / กลับมาที่แท็บนี้ / มีคนเรียก refreshNotifications()
 * ถ้าโหลดไม่สำเร็จ (เช่น เน็ตหลุด) ก็เงียบไว้ แล้วลองใหม่ในรอบหน้า — กระดิ่งไม่สำคัญพอจะรบกวนผู้ใช้ด้วยกล่อง error
 */
export function useNotifications() {
  const [data, setData] = useState({ items: [], unread: 0 })

  const load = useCallback(() => {
    api.notifications
      .list()
      .then(setData)
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()

    const timer = setInterval(() => {
      if (!document.hidden) load() // แท็บถูกซ่อนอยู่ไม่ต้องถาม ประหยัดแรง Backend
    }, POLL_SECONDS * 1000)
    const onVisible = () => {
      if (!document.hidden) load() // กลับมาที่แท็บนี้ → ถามทันที
    }

    window.addEventListener(REFRESH_EVENT, load)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener(REFRESH_EVENT, load)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // กดอ่านอันเดียว: ทำให้หน้าจอเปลี่ยนทันที (optimistic) แล้วค่อยบอก Backend — ถ้าบอกไม่สำเร็จ โหลดค่าจริงกลับมา
  const markRead = useCallback(
    (id) => {
      setData((prev) => {
        const target = prev.items.find((n) => n.id === id)
        if (!target || target.read) return prev
        return {
          items: prev.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
          unread: Math.max(0, prev.unread - 1),
        }
      })
      api.notifications.markRead(id).catch(load)
    },
    [load],
  )

  const markAllRead = useCallback(() => {
    setData((prev) => ({ items: prev.items.map((n) => ({ ...n, read: true })), unread: 0 }))
    api.notifications.markAllRead().catch(load)
  }, [load])

  return { items: data.items, unread: data.unread, markRead, markAllRead }
}
