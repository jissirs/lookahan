/**
 * หน้า Forget password — รีเซ็ตรหัสผ่านใน "หน้าเดียว 3 ขั้นตอน":
 *
 *   email ──[Send otp]──▶ otp ──[change password]──▶ reset ──[Reset password]──▶ หน้า Login
 *   กรอกอีเมล              กรอกรหัส OTP                ตั้งรหัสผ่านใหม่
 *
 * ตัวแปร step บอกว่าอยู่ขั้นไหน และกำหนดว่าจะแสดงช่องกรอกอะไร
 * แต่ละขั้นเรียก API จริง (ผ่าน useAuth):
 *   email → requestOtp   ขอ OTP
 *   otp   → verifyOtp    ตรวจ OTP ได้ resetToken กลับมา (เก็บไว้ใช้ในขั้นถัดไป)
 *   reset → resetPassword ตั้งรหัสผ่านใหม่ด้วย resetToken
 *
 * ถ้า API ปฏิเสธ (OTP ผิด, หมดอายุ ฯลฯ) จะแสดงกล่องแจ้งข้อความแล้วอยู่ขั้นเดิม
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PasswordStrengthMeter from '../../components/PasswordStrengthMeter.jsx'
import { useAuth } from '../../context/AuthContext.js'
import { notify } from '../../utils/dialogs.js'
import { getPasswordError } from '../../utils/passwordRules.js'
import './ForgetPasswordPage.css'

// ข้อความหัวข้อและปุ่มของแต่ละขั้น
const STEPS = {
  email: { title: 'forget password', button: 'Send otp' },
  otp: { title: 'forget password', button: 'change password' },
  reset: { title: 'Reset password', button: 'Reset password' },
}

function ForgetPasswordPage() {
  const navigate = useNavigate()
  const { requestOtp, verifyOtp, resetPassword } = useAuth()

  const [step, setStep] = useState('email') // 'email' | 'otp' | 'reset'
  const [submitting, setSubmitting] = useState(false) // กำลังรอ api (กันกดซ้ำ)

  // ค่าของแต่ละขั้น (เก็บแยกกัน เพราะผู้ใช้อาจกลับมาแก้ภายหลัง)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // โทเค็นที่ได้หลังตรวจ OTP ผ่าน — ใช้ยืนยันสิทธิ์ตอนตั้งรหัสผ่านใหม่
  const [resetToken, setResetToken] = useState('')

  // ทำงานของแต่ละขั้น: ถ้าไม่สำเร็จ โยน error ออกไปให้ handleSubmit แสดงข้อความ
  const runStep = async () => {
    if (step === 'email') {
      if (!email.trim()) throw new Error('Please enter your email')

      const { otp: mockOtp } = await requestOtp(email)
      setStep('otp')

      if (mockOtp) {
        // Backend โหมดทดลอง (ยังไม่ตั้งค่าอีเมล) ตอบ OTP กลับมาให้เห็นตรงนี้
        await notify({
          icon: 'info',
          title: 'Dev mode',
          text: `Your OTP is ${mockOtp} (email is not configured on the server, so it is shown here)`,
        })
      } else {
        // ระบบจริง: OTP ถูกส่งทางอีเมลแล้ว — บอกผู้ใช้ให้ไปเปิดอีเมล
        await notify({
          icon: 'success',
          title: 'OTP sent',
          text: `We sent a 6-digit OTP to ${email.trim()}. It expires in 5 minutes. If you don't see it, check your spam folder.`,
        })
      }
    } else if (step === 'otp') {
      if (!otp.trim()) throw new Error('Please enter the OTP')

      const { resetToken: token } = await verifyOtp(email, otp)
      setResetToken(token)
      setStep('reset')
    } else {
      // ขั้นตั้งรหัสผ่านใหม่: ตรวจกฎและการตรงกันก่อนส่ง
      const passwordError = getPasswordError(password)
      if (passwordError) throw new Error(passwordError)
      if (password !== confirmPassword) throw new Error('Passwords do not match')

      await resetPassword(resetToken, password)

      // สำเร็จ → กลับไปล็อกอิน (หน้า Login จะแสดงข้อความ "Password changed")
      navigate('/login', { replace: true, state: { passwordReset: true, username: email.trim() } })
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return

    setSubmitting(true)
    try {
      await runStep()
    } catch (err) {
      notify({ icon: 'error', title: 'Something went wrong', text: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const { title, button } = STEPS[step]

  return (
    <div className="fp-page">
      {/* ขั้น reset มีการ์ดสูงกว่าสองขั้นแรก จึงใช้คนละคลาสปรับขนาด */}
      <form
        className={`fp-card ${step === 'reset' ? 'fp-card--reset' : 'fp-card--simple'}`}
        onSubmit={handleSubmit}
        noValidate
      >
        <h1 className="fp-title">{title}</h1>

        {/* ขั้น 1: กรอกอีเมลเพื่อรับ OTP */}
        {step === 'email' && (
          <input
            className="fp-input fp-input--first"
            type="email"
            placeholder="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}

        {/* ขั้น 2: กรอกรหัส OTP ที่ได้รับ */}
        {step === 'otp' && (
          <input
            className="fp-input fp-input--first fp-input--otp"
            type="text"
            inputMode="numeric"
            placeholder="otp"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
        )}

        {/* ขั้น 3: ตั้งรหัสผ่านใหม่ (เส้นบอกความแข็งแรง + ข้อความใบ้อยู่ใต้ช่อง password) */}
        {step === 'reset' && (
          <>
            <input
              className="fp-input fp-input--first"
              type="password"
              placeholder="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordStrengthMeter className="fp-meter" password={password} />
            <input
              className="fp-input fp-input--second"
              type="password"
              placeholder="Confirm password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </>
        )}

        <button className="fp-button" type="submit" disabled={submitting}>
          {button}
        </button>
      </form>
    </div>
  )
}

export default ForgetPasswordPage
