import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // ตอนพัฒนา: คำขอที่ขึ้นต้นด้วย /api ถูกส่งต่อไปที่ Backend (Flask) — จึงไม่ติด CORS และไม่ต้องตั้งที่อยู่ใน api.js
    // เปลี่ยนที่อยู่ Backend ได้ด้วย VITE_BACKEND_URL ในไฟล์ .env (ค่าเริ่มต้น http://127.0.0.1:5000)
    proxy: {
      '/api': process.env.VITE_BACKEND_URL || 'http://127.0.0.1:5000',
    },
  },
})
