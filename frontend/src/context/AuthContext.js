/**
 * Context ของ "การล็อกอิน" (ผู้ใช้ปัจจุบัน, token, login/logout)
 * ตัวเก็บข้อมูลจริงอยู่ที่ AuthProvider.jsx — ไฟล์นี้มีแค่ตัว context กับ hook
 */
import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

/** ใช้ในคอมโพเนนต์: const { user, isAuthenticated, login, logout } = useAuth() */
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
