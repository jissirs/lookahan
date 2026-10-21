import { useCallback, useRef, useState } from 'react'

/**
 * วัดความกว้างของ element และอัปเดตเมื่อขนาดเปลี่ยน (เช่น ย่อ/ขยายหน้าต่าง)
 * ใช้กับกราฟ SVG ให้วาดตามความกว้างจริงของการ์ด — ตัวหนังสือบนกราฟจึงไม่ถูกย่อจนเล็กบนมือถือ
 *
 * วิธีใช้: เอา ref ที่ได้ไปใส่ element ที่ต้องการวัด
 *   const [ref, width] = useElementWidth()
 *   return <div ref={ref}>...</div>
 *
 * @returns {[(node: HTMLElement | null) => void, number]}
 *          [ref สำหรับใส่ element, ความกว้างเป็นพิกเซล] — ความกว้างเป็น 0 จนกว่าจะวัดเสร็จ
 *
 * ใช้ "callback ref": React เรียกฟังก์ชันนี้ทันทีที่ element ถูกวางลง/ถอดออกจากหน้า
 * จึงวัดขนาดได้ตั้งแต่ครั้งแรกโดยไม่ต้องรอ ResizeObserver (ซึ่งอาจเรียกช้าหรือไม่เรียกเลยในแท็บที่ถูกซ่อน)
 */
export function useElementWidth() {
  const [width, setWidth] = useState(0)
  const observerRef = useRef(null)

  const ref = useCallback((node) => {
    // element เดิมถูกถอด/เปลี่ยน → เลิกสังเกตตัวเก่า
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return

    // วัดทันที แล้วติดตามต่อเมื่อขนาดเปลี่ยน
    setWidth(Math.floor(node.getBoundingClientRect().width))
    observerRef.current = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observerRef.current.observe(node)
  }, [])

  return [ref, width]
}
