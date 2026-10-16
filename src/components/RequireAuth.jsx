import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'

/**
 * ครอบหน้าที่ "ต้องล็อกอินก่อนถึงเข้าได้"  ตัวอย่าง:
 *   <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
 *
 * ถ้ายังไม่ล็อกอิน จะพาไปหน้า Login พร้อมจำหน้าที่ตั้งใจจะเข้า (state.from)
 * ล็อกอินสำเร็จแล้วหน้า Login จะพากลับไปหน้านั้นเอง
 *
 * หมายเหตุ: ตอนนี้ยังไม่ได้ใช้ใน App.jsx เพราะ backend ยังไม่พร้อม (ล็อกอินจริงยังไม่ได้)
 */
function RequireAuth({ children }) {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return null // กำลังตรวจสถานะ — ยังไม่ตัดสินใจ

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}

export default RequireAuth
