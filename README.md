# lookahhan

เว็บแอปจัดการ stock วัตถุดิบ เมนู และออเดอร์สำหรับร้านอาหาร (UI ภาษาไทย)

```
lookahan/
├─ frontend/   React 19 + Vite — หน้าเว็บทั้งหมด (ใช้ฐานข้อมูลจำลองอยู่ ยังไม่ต่อ Backend)
└─ Backend/    Flask — ออกแบบโครงสร้างไว้แล้ว ยังไม่มีโค้ด
```

## เริ่มใช้งาน (หน้าบ้าน)

```bash
cd frontend
npm install
npm run dev      # เปิดที่ http://localhost:5173
```

รายละเอียดสถาปัตยกรรม เส้นทาง (routes) และรูปแบบ API อยู่ที่ [frontend/README.md](frontend/README.md)
โครงสร้าง Backend ที่ออกแบบไว้อยู่ที่ [Backend/README.md](Backend/README.md)
