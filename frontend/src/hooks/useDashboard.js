import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { refreshNotifications } from './useNotifications.js'

const STALE_HOURS = 6 // ผลพยากรณ์เก่ากว่านี้ถือว่า "ไม่สดแล้ว" → ให้ AI วิเคราะห์ใหม่เอง
const RETRY_MINUTES = 10 // วิเคราะห์ไม่สำเร็จ (เช่น ยังไม่มีออเดอร์) จะไม่ลองซ้ำถี่กว่านี้ กันเรียก AI รัว ๆ
const ATTEMPT_KEY = 'lookahan.forecastAttempt' // เวลาที่ลองวิเคราะห์ล่าสุด (เก็บแค่ในแท็บนี้)

// ผลพยากรณ์ต้องวิเคราะห์ใหม่ไหม: ยังไม่เคยมี หรือเก่ากว่า STALE_HOURS
function isStale(forecast) {
  if (!forecast?.generatedAt) return true
  if (!forecast.daily) return true // ผลรุ่นเก่าที่ยังไม่มีรายได้รายวัน/แผนความสด → วิเคราะห์ใหม่ให้ได้ข้อมูลครบ
  return Date.now() - new Date(forecast.generatedAt).getTime() > STALE_HOURS * 3600 * 1000
}

// เพิ่งลองวิเคราะห์ไปเมื่อกี้ไหม (กันลองซ้ำทุกครั้งที่เปิดหน้า)
function attemptedRecently() {
  try {
    return Date.now() - Number(sessionStorage.getItem(ATTEMPT_KEY)) < RETRY_MINUTES * 60 * 1000
  } catch {
    return false // เข้าถึง sessionStorage ไม่ได้ — ถือว่ายังไม่เคยลอง
  }
}

function markAttempt() {
  try {
    sessionStorage.setItem(ATTEMPT_KEY, String(Date.now()))
  } catch {
    // ข้ามไป
  }
}

/**
 * โหลดข้อมูลของหน้าแรก/สถิติ/Ai (สถิติวันนี้ + ผลพยากรณ์ของ AI) จาก API
 * และ "ให้ AI วิเคราะห์อัตโนมัติ" เมื่อยังไม่มีผลพยากรณ์ หรือผลเก่ากว่า STALE_HOURS ชั่วโมง
 * (ทำเบื้องหลัง ไม่บล็อกหน้าจอ — พอ AI ตอบเสร็จ ข้อมูลในหน้าจะอัปเดตเอง)
 *
 * @returns {{ statistics, forecast, analyzing: boolean, analysisError: string } | null}
 *   null = ยังโหลดไม่เสร็จ (หน้าจอควรแสดง "—" ไว้ก่อน)
 *   forecast = null ถ้ายังไม่มีผลพยากรณ์   analyzing = AI กำลังวิเคราะห์อยู่   analysisError = เหตุผลที่วิเคราะห์ไม่สำเร็จ
 *
 * ถ้าโหลดสรุปไม่สำเร็จจะคงเป็น null (การ์ดบนหน้าแรกไม่สำคัญพอจะบล็อกทั้งหน้า)
 */
export function useDashboard() {
  const [dashboard, setDashboard] = useState(null)

  useEffect(() => {
    let cancelled = false // กัน setState หลังออกจากหน้าไปแล้ว (และกัน StrictMode รันสองรอบ)

    api.dashboard
      .getSummary()
      .then((summary) => {
        if (cancelled) return
        setDashboard({ ...summary, analyzing: false, analysisError: '' })

        // ผลพยากรณ์ยังสดอยู่ หรือเพิ่งลองไปไม่นาน → ไม่ต้องเรียก AI
        if (!isStale(summary.forecast) || attemptedRecently()) return

        markAttempt()
        setDashboard((current) => ({ ...current, analyzing: true }))
        api.ai
          .createForecast()
          .then((forecast) => {
            if (!cancelled) setDashboard((current) => ({ ...current, forecast, analyzing: false }))
            refreshNotifications() // วิเคราะห์อัตโนมัติเสร็จ → Backend สร้างแจ้งเตือน
          })
          .catch((err) => {
            // เช่น ยังไม่มีออเดอร์ / ยังไม่ได้ตั้ง GROQ_API_KEY — ไม่รบกวนผู้ใช้ด้วยกล่องแจ้งเตือน แค่เก็บเหตุผลไว้ให้หน้า Ai แสดง
            if (!cancelled) setDashboard((current) => ({ ...current, analyzing: false, analysisError: err.message }))
          })
      })
      .catch(() => {
        // ปล่อยเป็น null — หน้าจอแสดง "—" แทน
      })

    return () => {
      cancelled = true
    }
  }, [])

  return dashboard
}
