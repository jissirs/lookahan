// จุดเริ่มต้นของแอป: นำ <App /> ไปแสดงใน <div id="root"> ของ index.html
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css' // สไตล์พื้นฐานทั้งแอป (รวมสไตล์แถบเลื่อน)
import App from './App.jsx'

// StrictMode: โหมดตรวจโค้ดตอนพัฒนา (จะรันบาง effect สองรอบ เป็นเรื่องปกติ ไม่เกิดตอน build จริง)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
