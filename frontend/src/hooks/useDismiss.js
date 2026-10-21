import { useEffect, useRef } from 'react'

/**
 * ปิดเมนู/dropdown เมื่อผู้ใช้ "กดที่อื่นนอกกล่อง" หรือ "กด Esc"
 * ใช้กับทุกกล่องที่เปิด-ปิดได้ (เมนูใน Header, ตัวกรอง, ปุ่ม ⋮ ในตาราง)
 *
 * @param {boolean} isOpen     กล่องเปิดอยู่หรือไม่ (ปิดอยู่ = ไม่ต้องฟังเหตุการณ์)
 * @param {React.RefObject} ref  ref ของกล่องที่ครอบทั้งปุ่มและเมนู — คลิกในนี้ไม่ถือว่า "ข้างนอก"
 * @param {() => void} onDismiss  ฟังก์ชันที่ใช้ปิดกล่อง
 */
export function useDismiss(isOpen, ref, onDismiss) {
  // เก็บฟังก์ชันล่าสุดไว้ใน ref จะได้ไม่ต้องสมัคร/ยกเลิกการฟังใหม่ทุกครั้งที่ render
  const latest = useRef(onDismiss)
  useEffect(() => {
    latest.current = onDismiss
  })

  useEffect(() => {
    if (!isOpen) return undefined

    const handlePointerDown = (e) => {
      if (!ref.current?.contains(e.target)) latest.current()
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') latest.current()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, ref])
}
