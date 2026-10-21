import { useEffect, useState } from 'react'
import './LiveDateTime.css'

// รูปแบบการแสดงผลภาษาไทย เช่น "วันศุกร์ที่ 16 ตุลาคม 2569" และ "10:33:12"
const DATE_FORMAT = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }

/** แสดงวันที่และเวลาปัจจุบัน อัปเดตทุกวินาที (ใช้เวลาของเครื่องผู้ใช้) */
function LiveDateTime() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer) // หยุดจับเวลาเมื่อออกจากหน้า กันค้างในหน่วยความจำ
  }, [])

  return (
    <p className="live-datetime">
      <span className="live-datetime-date">{now.toLocaleDateString('th-TH', DATE_FORMAT)}</span>
      <time className="live-datetime-time" dateTime={now.toISOString()}>
        {now.toLocaleTimeString('th-TH', TIME_FORMAT)} น.
      </time>
    </p>
  )
}

export default LiveDateTime
