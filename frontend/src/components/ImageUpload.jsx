import { useState } from 'react'

// จำกัดขนาด เพราะตอนนี้เก็บรูปเป็นข้อความ (data URL) ในฐานข้อมูลของ Backend
// TODO: เมื่อมี backend ให้อัปโหลดไฟล์ไปเก็บที่เซิร์ฟเวอร์แทน แล้วเก็บเฉพาะลิงก์รูป
const MAX_BYTES = 1024 * 1024 // 1MB
const ACCEPTED = ['image/jpeg', 'image/png']

/**
 * ช่องเพิ่มรูป (jpg / png) — กดที่กรอบแล้วเลือกไฟล์
 * @param {string} value   รูปปัจจุบัน (data URL) ว่าง = ยังไม่มีรูป
 * @param {(dataUrl: string) => void} onChange  เรียกเมื่อเลือกรูปใหม่ที่ผ่านการตรวจแล้ว
 */
function ImageUpload({ value, onChange }) {
  const [error, setError] = useState('')

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // ล้างค่า เพื่อให้เลือกไฟล์เดิมซ้ำได้
    if (!file) return

    // ตรวจชนิดและขนาดก่อนอ่านไฟล์
    if (!ACCEPTED.includes(file.type)) {
      setError('รองรับเฉพาะไฟล์ jpg และ png')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('ไฟล์ต้องมีขนาดไม่เกิน 1MB')
      return
    }

    setError('')
    // แปลงไฟล์เป็น data URL เพื่อใช้เป็น src ของ <img> ได้เลย
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result))
    reader.readAsDataURL(file)
  }

  return (
    <div>
      {/* input จริงโปร่งใสวางทับกรอบทั้งอัน จึงกดตรงไหนก็เลือกไฟล์ได้ (ดู .image-upload ใน ui.css) */}
      <label className="image-upload">
        {value ? (
          <img src={value} alt="รูปเมนู" />
        ) : (
          <span>
            เพิ่มรูป
            <br />
            jpg. png.
          </span>
        )}
        <input type="file" accept="image/png,image/jpeg" onChange={handleFile} />
      </label>

      {error && <p className="field-error">{error}</p>}
    </div>
  )
}

export default ImageUpload
