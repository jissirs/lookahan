/**
 * เก็บสถานะการล็อกอินของทั้งแอป และเป็นทางผ่านของ "การทำงานเกี่ยวกับบัญชี" ทั้งหมด
 * (ล็อกอิน สมัครสมาชิก ลืมรหัสผ่าน) ไปยังชั้น API (services/api.js)
 *
 * การจำการล็อกอิน:
 *   - เก็บ { token, user } ไว้ใน localStorage จึงรีเซ็ตหน้าแล้วไม่หลุด
 *   - ตอนเปิดแอป ถ้ามี token เก่า จะถามเซิร์ฟเวอร์ (api.auth.me) ว่ายังใช้ได้ไหม
 *     ระหว่างรอ isLoading = true — ถ้าใช้ไม่ได้แล้ว (เช่น หมดอายุ/เปลี่ยนรหัส) จะล้างและถือว่าไม่ได้ล็อกอิน
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api.js'
import { AuthContext } from './AuthContext.js'
import { clearSnapshot } from '../utils/offlineStore.js'

const STORAGE_KEY = 'lookahan.auth'

// อ่านค่าที่เคยบันทึกไว้ — ถ้าพังหรือไม่มี ถือว่ายังไม่ล็อกอิน
function readStoredAuth() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  // auth = { token, user } | null
  const [auth, setAuth] = useState(readStoredAuth)

  // มี token เก่า = ต้องรอตรวจกับเซิร์ฟเวอร์ก่อนจึงจะรู้ว่าล็อกอินอยู่จริงไหม
  const [isLoading, setIsLoading] = useState(() => Boolean(readStoredAuth()?.token))

  // Backend บอกว่า token หมดอายุระหว่างใช้งาน → ออกจากระบบทันที (RequireAuth จะพากลับหน้า Login เอง)
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      localStorage.removeItem(STORAGE_KEY)
      setAuth(null)
    })
    return () => api.setUnauthorizedHandler(null)
  }, [])

  // ตรวจ token เก่าตอนเปิดแอป (ทำครั้งเดียว)
  useEffect(() => {
    const stored = readStoredAuth()
    if (!stored?.token) return undefined

    let cancelled = false
    api.auth
      .me(stored.token)
      .then((user) => {
        if (!cancelled) setAuth({ token: stored.token, user }) // อัปเดตข้อมูลผู้ใช้ให้เป็นปัจจุบัน
      })
      .catch((err) => {
        if (cancelled || err.code !== 'UNAUTHORIZED') return
        // token ใช้ไม่ได้แล้ว → เคลียร์ให้เป็นสถานะไม่ได้ล็อกอิน
        localStorage.removeItem(STORAGE_KEY)
        if (!cancelled) setAuth(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // ล็อกอิน: ถ้า api โยน error จะส่งต่อให้หน้า Login จัดการเอง (เช่น INVALID_CREDENTIALS)
  const login = useCallback(async (identifier, password) => {
    const { token, user } = await api.auth.login(identifier, password)
    const next = { token, user }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setAuth(next)
  }, [])

  const logout = useCallback(() => {
    // แจ้งเซิร์ฟเวอร์ให้ลบ session แต่ไม่รอผล — ฝั่งหน้าจอออกจากระบบทันที
    api.auth.logout(auth?.token).catch(() => {})
    localStorage.removeItem(STORAGE_KEY)
    if (auth?.user?.id) clearSnapshot(auth.user.id).catch(() => {})
    setAuth(null)
  }, [auth])

  // ฟังก์ชันด้านล่างไม่เปลี่ยนสถานะล็อกอิน แค่ส่งต่อไปยัง api (ให้หน้าจอเรียกผ่าน useAuth ที่เดียว)
  const register = useCallback((data) => api.auth.register(data), [])
  const requestOtp = useCallback((email) => api.auth.requestOtp(email), [])
  const verifyOtp = useCallback((email, otp) => api.auth.verifyOtp(email, otp), [])
  const resetPassword = useCallback((resetToken, password) => api.auth.resetPassword(resetToken, password), [])

  // useMemo กัน component ลูกทั้งหมด render ใหม่โดยไม่จำเป็น
  const value = useMemo(
    () => ({
      user: auth?.user ?? null,
      token: auth?.token ?? null,
      isAuthenticated: Boolean(auth?.token),
      isLoading,
      login,
      logout,
      register,
      requestOtp,
      verifyOtp,
      resetPassword,
    }),
    [auth, isLoading, login, logout, register, requestOtp, verifyOtp, resetPassword],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
