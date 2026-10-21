import { useCallback, useEffect, useState } from 'react'
import { api } from '../services/api.js'

/**
 * ความเห็นของผู้ใช้ต่อคำแนะนำของ AI ("มีประโยชน์ไหม") — โหลดจาก API และบันทึกกลับได้
 *
 * @returns {{
 *   feedback: Record<string, boolean>,                       รหัสคำแนะนำ → true (มีประโยชน์) | false (ไม่ใช่)
 *   sendFeedback: (key: string, helpful: boolean) => Promise<void>
 * }}
 */
export function useAiFeedback() {
  const [feedback, setFeedback] = useState({})

  // โหลดความเห็นที่เคยให้ไว้ตอนเปิดหน้า
  useEffect(() => {
    let cancelled = false // กัน setState หลังออกจากหน้าไปแล้ว (และกัน StrictMode รันสองรอบ)

    api.ai
      .listFeedback()
      .then((saved) => {
        if (!cancelled) setFeedback(saved)
      })
      .catch(() => {
        // โหลดไม่ได้ก็ใช้งานต่อได้ แค่ยังไม่เห็นความเห็นเดิม
      })

    return () => {
      cancelled = true
    }
  }, [])

  // บันทึกความเห็น: อัปเดตหน้าจอทันที (optimistic) แล้วส่งให้ api — ถ้าส่งไม่สำเร็จจะย้อนกลับค่าเดิม
  const sendFeedback = useCallback(async (key, helpful) => {
    let previous
    setFeedback((prev) => {
      previous = prev[key]
      return { ...prev, [key]: helpful }
    })

    try {
      await api.ai.sendFeedback(key, helpful)
    } catch {
      setFeedback((prev) => {
        const { [key]: _failed, ...rest } = prev // eslint-disable-line no-unused-vars
        return previous === undefined ? rest : { ...rest, [key]: previous }
      })
    }
  }, [])

  return { feedback, sendFeedback }
}
