/**
 * หน้า Register — ฟอร์มสมัครสมาชิก พร้อมตรวจข้อมูลแบบทันที (validation)
 *
 * แนวคิดการแสดง error:
 *   - ตรวจกฎทั้งหมดใหม่ทุกครั้งที่พิมพ์ (ฟังก์ชัน validate)
 *   - แต่ "แสดง" error เฉพาะช่องที่ผู้ใช้เคยแตะแล้ว (touched) หรือหลังกดปุ่ม Register
 *     เพื่อไม่ให้ขึ้นสีแดงตั้งแต่เปิดหน้า
 *   - ข้อผิดพลาดที่รู้ได้จากเซิร์ฟเวอร์เท่านั้น (เช่น อีเมลถูกใช้แล้ว) เก็บแยกใน serverErrors
 *     แล้วแสดงที่ช่องเดียวกัน — ล้างทิ้งเมื่อผู้ใช้แก้ช่องนั้น
 *
 * สมัครสำเร็จ → ไปหน้า Login พร้อมเติมอีเมลให้ (ล็อกอินด้วย name หรือ email ก็ได้)
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PasswordStrengthMeter from '../../components/PasswordStrengthMeter.jsx'
import { useAuth } from '../../context/AuthContext.js'
import { notify } from '../../utils/dialogs.js'
import { getPasswordError } from '../../utils/passwordRules.js'
import './RegisterPage.css'

// ลำดับช่องในฟอร์ม (ชื่อต้องตรงกับ name ของ <input> และคีย์ใน form/errors)
// ใช้หาช่องแรกที่ผิดเพื่อโฟกัสให้
const FIELDS = ['name', 'surname', 'email', 'password', 'confirmPassword']

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY_FORM = { name: '', surname: '', email: '', password: '', confirmPassword: '' }

/**
 * ตรวจข้อมูลทั้งฟอร์ม
 * @returns {Record<string, string>} คีย์ = ชื่อช่องที่ผิด, ค่า = ข้อความ error (ช่องที่ผ่านจะไม่มีคีย์)
 */
function validate(form) {
  const errors = {}

  if (!form.name.trim()) errors.name = 'Please enter your name'
  if (!form.surname.trim()) errors.surname = 'Please enter your surname'

  if (!form.email.trim()) errors.email = 'Please enter your email'
  else if (!EMAIL_PATTERN.test(form.email.trim())) errors.email = 'Invalid email format'

  // รหัสผ่าน: กฎอยู่ใน utils/passwordRules.js (ใช้ร่วมกับหน้า Forget password และ api)
  const passwordError = getPasswordError(form.password)
  if (passwordError) errors.password = passwordError

  if (!form.confirmPassword) errors.confirmPassword = 'Please confirm your password'
  else if (form.confirmPassword !== form.password) errors.confirmPassword = 'Passwords do not match'

  return errors
}

function RegisterPage() {
  const navigate = useNavigate()
  const { register } = useAuth()

  const [form, setForm] = useState(EMPTY_FORM)
  const [touched, setTouched] = useState({}) // ช่องที่ผู้ใช้เคยแตะ เช่น { name: true }
  const [serverErrors, setServerErrors] = useState({}) // error จากเซิร์ฟเวอร์ เช่น { email: '...' }
  const [submitting, setSubmitting] = useState(false) // กำลังรอ api (กันกดซ้ำ)
  const formRef = useRef(null)

  // คำนวณใหม่ทุก render (ถูกมาก ไม่ต้อง useMemo) — error จากเซิร์ฟเวอร์ทับ error ฝั่งหน้าจอ
  const errors = { ...validate(form), ...serverErrors }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))

    // แก้ช่องที่เซิร์ฟเวอร์ปฏิเสธ = ล้าง error นั้น (ให้ลองส่งใหม่ได้)
    if (serverErrors[name]) setServerErrors((prev) => ({ ...prev, [name]: undefined }))
  }

  // ออกจากช่อง = ถือว่า "แตะแล้ว" จึงเริ่มแสดง error ของช่องนั้นได้
  const handleBlur = (e) => {
    const { name } = e.target
    setTouched((prev) => ({ ...prev, [name]: true }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return

    // กดส่ง = ถือว่าแตะทุกช่อง เพื่อแสดง error ทั้งหมดพร้อมกัน
    setTouched(Object.fromEntries(FIELDS.map((f) => [f, true])))

    // มี error → โฟกัสช่องแรกที่ผิดแล้วหยุด
    const firstInvalid = FIELDS.find((f) => errors[f])
    if (firstInvalid) {
      formRef.current?.elements[firstInvalid]?.focus()
      return
    }

    setSubmitting(true)
    try {
      const result = await register({
        name: form.name,
        surname: form.surname,
        email: form.email,
        password: form.password,
      })

      await notify({ icon: 'success', title: 'สร้างบัญชีแล้ว', text: result.user.approved ? 'เข้าใช้งานได้เลย' : 'รอเจ้าของร้านอนุมัติบัญชี ก่อนเข้าสู่ระบบ' })
      navigate('/login', { replace: true, state: { username: form.email.trim(), registered: true } })
    } catch (err) {
      if (err.code === 'EMAIL_TAKEN') {
        // อีเมลซ้ำ → แสดงที่ช่องอีเมลและโฟกัสให้แก้
        setServerErrors({ email: err.message })
        formRef.current?.elements.email?.focus()
      } else {
        notify({ icon: 'error', title: 'Registration failed', text: err.message })
      }
      setSubmitting(false)
    }
  }

  // error ของช่องนี้ "ควรแสดงตอนนี้หรือไม่" (แตะแล้ว และมีข้อผิดพลาด)
  const showsError = (name) => Boolean(touched[name] && errors[name])

  // props ที่ทุกช่องใช้ร่วมกัน: ค่า, ตัวจัดการ, และ aria ที่ชี้ไปยังข้อความ error
  const fieldProps = (name, placeholder) => ({
    name,
    placeholder,
    value: form[name],
    onChange: handleChange,
    onBlur: handleBlur,
    'aria-invalid': showsError(name) ? true : undefined,
    'aria-describedby': showsError(name) ? `${name}-error` : undefined,
  })

  // ข้อความ error ใต้ช่อง (ไม่แสดงถ้าไม่ต้องแสดง)
  const renderError = (name) =>
    showsError(name) ? (
      <p className={`register-error register-error-${name}`} id={`${name}-error`}>
        {errors[name]}
      </p>
    ) : null

  return (
    <div className="register-page">
      {/* noValidate: ปิดข้อความตรวจของเบราว์เซอร์ ใช้ validate() ของเราเอง */}
      <form className="register-form" ref={formRef} onSubmit={handleSubmit} noValidate>
        <h1 className="register-title">Register</h1>

        <div className="register-fields">
          <input
            className="register-input register-name"
            type="text"
            autoComplete="given-name"
            {...fieldProps('name', 'name')}
          />
          {renderError('name')}

          <input
            className="register-input register-surname"
            type="text"
            autoComplete="family-name"
            {...fieldProps('surname', 'surname')}
          />
          {renderError('surname')}

          <input
            className="register-input register-email"
            type="email"
            autoComplete="email"
            {...fieldProps('email', 'email')}
          />
          {renderError('email')}

          <div className="register-password-wrap">
            <input
              className="register-input register-password"
              type="password"
              autoComplete="new-password"
              {...fieldProps('password', 'password')}
            />
          </div>

          {/* เส้นบอกความแข็งแรง + ข้อความใบ้ใต้ช่อง — ถ้าช่องนี้มี error จะแสดง error แทนข้อความใบ้ (บรรทัดเดียวกัน) */}
          <PasswordStrengthMeter
            className="register-meter"
            password={form.password}
            error={showsError('password') ? errors.password : ''}
            hintId="password-error"
          />

          <input
            className="register-input register-confirm"
            type="password"
            autoComplete="new-password"
            {...fieldProps('confirmPassword', 'confirm password')}
          />
          {renderError('confirmPassword')}
        </div>

        <button className="register-button" type="submit" disabled={submitting}>
          {submitting ? 'Registering…' : 'Register'}
        </button>
      </form>
    </div>
  )
}

export default RegisterPage
