import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.js'

/**
 * ครอบหน้าที่ "ต้องล็อกอินก่อนถึงเข้าได้"  ตัวอย่าง:
 *   <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
 *
 * ถ้ายังไม่ล็อกอิน จะพาไปหน้า Login พร้อมจำหน้าที่ตั้งใจจะเข้า (state.from)
 * ล็อกอินสำเร็จแล้วหน้า Login จะพากลับไปหน้านั้นเอง
 */
function RequireAuth({ children }) {
  const { isAuthenticated, isLoading, user } = useAuth()
  const location = useLocation()

  if (isLoading) return null // กำลังตรวจสถานะ — ยังไม่ตัดสินใจ

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  const management = /^\/(stock\/(new|\d+)|menu\/new|menu\/[^/]+\/(edit|recipe))$/.test(location.pathname)
  if (management && user?.role !== 'owner') return <Navigate to="/order" replace />
  return children
}

export default RequireAuth
