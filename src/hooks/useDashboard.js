import { useEffect, useState } from 'react'
import { api } from '../services/api.js'

/**
 * โหลดข้อมูลของการ์ดบนหน้าแรก (สถิติวันนี้ + ผลพยากรณ์ของ AI) จาก API
 *
 * @returns {{ statistics, forecast } | null}  ระหว่างโหลดคืน null — หน้าจอควรแสดงค่าว่าง (เช่น "—") ไว้ก่อน
 * ถ้าโหลดไม่สำเร็จจะคงเป็น null (การ์ดบนหน้าแรกไม่สำคัญพอจะบล็อกทั้งหน้า)
 */
export function useDashboard() {
  const [dashboard, setDashboard] = useState(null)

  useEffect(() => {
    let cancelled = false // กัน setState หลังออกจากหน้าไปแล้ว (และกัน StrictMode รันสองรอบ)

    api.dashboard
      .getSummary()
      .then((summary) => {
        if (!cancelled) setDashboard(summary)
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
