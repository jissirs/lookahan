# lookahhan

เว็บแอปจัดการ stock วัตถุดิบ เมนู และออเดอร์สำหรับร้านอาหาร (UI ภาษาไทย)

```
lookahan/
├─ frontend/   React 19 + Vite — หน้าเว็บทั้งหมด (ดึงข้อมูลจาก Backend)
└─ Backend/    Flask + SQLAlchemy — API ครบ ต่อกับหน้าเว็บแล้ว ใช้ SQLite หรือ MySQL ออนไลน์ (ไม่มีข้อมูลจำลอง ฐานข้อมูลเริ่มว่าง)
```

## เริ่มใช้งาน (หน้าบ้าน)

```bash
cd frontend
npm install
npm run dev      # เปิดที่ http://localhost:5173  (ต้องรัน Backend ไว้ก่อน)
```

รายละเอียดสถาปัตยกรรม เส้นทาง (routes) และรูปแบบ API อยู่ที่ [frontend/README.md](frontend/README.md)
วิธีติดตั้งและรัน Backend อยู่ที่ [Backend/README.md](Backend/README.md)
