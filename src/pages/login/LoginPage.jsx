import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Swal from 'sweetalert2'
import 'sweetalert2/dist/sweetalert2.min.css'
import clipboard from '../../assets/clipboard.png'
import box from '../../assets/box.png'
import food from '../../assets/food.png'
import { useAuth } from '../../context/AuthContext.js'
import './LoginPage.css'

// รหัสผิดครบจำนวนนี้แล้วพาไปหน้าลืมรหัสผ่าน
const MAX_ATTEMPTS = 3

// แสดงกล่องแจ้งเตือน (สีปุ่มกำหนดใน LoginPage.css ผ่านคลาส login-swal)
const showAlert = (options, { isError = false } = {}) =>
  Swal.fire({
    ...options,
    customClass: { popup: isError ? 'login-swal login-swal--error' : 'login-swal' },
  })

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isAuthenticated, isLoading } = useAuth()

  // เติม username อัตโนมัติถ้าถูกส่งมาจากหน้าอื่น
  const [username, setUsername] = useState(location.state?.username ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false) // กำลังรอผลล็อกอิน (กันกดซ้ำ)
  const [failures, setFailures] = useState(0) // จำนวนครั้งที่รหัสผิดในหน้านี้

  // ล็อกอินอยู่แล้ว ไม่ต้องแสดงหน้านี้ ส่งไปหน้าแรก
  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate('/', { replace: true })
  }, [isLoading, isAuthenticated, navigate])

  // มาจากหน้าอื่นที่ทำสำเร็จ (สมัครสมาชิก / รีเซ็ตรหัสผ่าน) → แจ้งผู้ใช้
  useEffect(() => {
    if (location.state?.registered) {
      showAlert({
        icon: 'success',
        title: 'Account created',
        text: 'You can now sign in with your email and password.',
      })
    }
    if (location.state?.passwordReset) {
      showAlert({
        icon: 'success',
        title: 'Password changed',
        text: 'You can now sign in with your new password.',
      })
    }
  }, [location.state])

  const handleSubmit = async (e) => {
    e.preventDefault()

    // 1) ต้องกรอกครบทั้งสองช่อง
    if (!username.trim() || !password) {
      showAlert({ icon: 'warning', title: 'Please fill in all fields' })
      return
    }

    setSubmitting(true)
    try {
      // 2) ล็อกอินสำเร็จ → กลับไปหน้าที่ตั้งใจจะเข้า หรือหน้าแรก
      await login(username.trim(), password)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      // 3) ล้มเหลว — แยกว่าเป็น "รหัสผิด" หรือ "ข้อผิดพลาดอื่น" (เช่น เซิร์ฟเวอร์ล่ม)
      const isWrongPassword = err.code === 'INVALID_CREDENTIALS'
      const attempts = failures + 1
      setFailures(attempts)

      // 4) รหัสผิดครบ 3 ครั้ง → พาไปหน้าลืมรหัสผ่าน (ไม่แสดงกล่อง error ซ้ำ)
      if (isWrongPassword && attempts >= MAX_ATTEMPTS) {
        navigate('/forgetpassword')
        return
      }

      showAlert(
        {
          icon: 'error',
          title: isWrongPassword ? 'Sign in failed' : 'Something went wrong',
          text: isWrongPassword ? `${err.message} (attempt ${attempts}/${MAX_ATTEMPTS})` : err.message,
        },
        { isError: true },
      )
    } finally {
      setSubmitting(false) // ไม่ว่าสำเร็จหรือไม่ ให้ปลดล็อกปุ่ม
    }
  }

  return (
    <div className="login-page">
      <div className="login-stage">
        {/* ภาพตกแต่งตามดีไซน์ (ตำแหน่งกำหนดใน CSS) */}
        <div className="login-ring" aria-hidden="true" />
        <img className="login-deco login-clipboard" src={clipboard} alt="" />
        <img className="login-deco login-box" src={box} alt="" />
        <img className="login-deco login-food" src={food} alt="" />

        {/* noValidate: ปิดข้อความตรวจของเบราว์เซอร์ ใช้ข้อความของเราเอง */}
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <h1 className="login-title">Login</h1>

          <input
            className="login-input login-input-name"
            type="text"
            placeholder="name"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />

          {/* ช่องรหัสผ่านมีปุ่มสลับ แสดง/ซ่อน อยู่ด้านขวา */}
          <div className="login-password-wrap">
            <input
              className="login-input login-input-password"
              type={showPassword ? 'text' : 'password'}
              placeholder="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>

          <Link className="login-link login-forget" to="/forgetpassword">
            forget password?
          </Link>
          <button className="login-button" type="submit" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Login'}
          </button>
          <Link className="login-link login-register" to="/register">
            register
          </Link>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
