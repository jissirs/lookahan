// จุดเริ่มต้นของแอป: นำ <App /> ไปแสดงใน <div id="root"> ของ index.html
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css' // สไตล์พื้นฐานทั้งแอป (รวมสไตล์แถบเลื่อน)
import './restaurant.css'
import App from './App.jsx'
import './responsive.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

// StrictMode: โหมดตรวจโค้ดตอนพัฒนา (จะรันบาง effect สองรอบ เป็นเรื่องปกติ ไม่เกิดตอน build จริง)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
