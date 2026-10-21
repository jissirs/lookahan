# lookahhan

เว็บแอปจัดการ stock วัตถุดิบและเมนูสำหรับร้านอาหาร — React 19 + Vite

```bash
npm install
npm run dev      # เปิดที่ http://localhost:5173
npm run build    # สร้างไฟล์สำหรับใช้งานจริง
npm run lint
```

## โครงสร้างข้อมูล: 3 ชั้น

```
หน้าจอ (pages/, components/)
   │  เรียกผ่าน hook: useAuth(), useInventory()
   ▼
context/   AuthProvider, InventoryProvider   เก็บ state ฝั่งหน้าจอ + ส่งต่อให้ api
   │
   ▼
services/api.js       "สัญญา" ของ API: ฟังก์ชัน async + กฎธุรกิจ + ApiError(code, message)
   │
   ▼
services/Database.js  ฐานข้อมูลจำลอง (บันทึกใน localStorage ของเบราว์เซอร์)
```

หลักสำคัญ: **หน้าจอไม่แตะฐานข้อมูลตรงๆ** — ทุกอย่างผ่าน `api.js`

### ฐานข้อมูลจำลอง ([src/services/Database.js](src/services/Database.js))
- ตาราง: `users`, `sessions`, `otps`, `ingredients`, `movements`, `menus`, `orders`, `feedback`, `statistics`, `forecast`
- ทุกคำสั่งเป็น async และเข้าคิวทีละคำสั่ง (กดรัวๆ แล้วข้อมูลไม่ชนกัน)
- `transaction()` ทำหลายขั้นตอนเป็นก้อนเดียว ผิดพลาดแล้ว rollback ทั้งหมด
- หน่วงเวลาจำลองเครือข่าย ปรับได้ที่ไฟล์ `.env`: `VITE_MOCK_LATENCY=0` (ค่าเริ่มต้น 60 ms)
- **MockData** (ข้อมูลเริ่มต้น) อยู่ที่ [src/data/mockData.js](src/data/mockData.js): วัตถุดิบ 39 รายการ (ครบสถานะ Normal/Low/Critical), เมนู 28 รายการ (พร้อมขาย/วัตถุดิบไม่พอ/ปิดขาย),
  ประวัติ stock, ออเดอร์ 12 รายการ (ครบทุกสถานะ), ผู้ใช้ตัวอย่าง 3 คน (ล็อกอินได้ด้วย name หรือ email — ดูรหัสผ่านในไฟล์),
  สถิติวันนี้ และผลพยากรณ์ AI (รายชั่วโมง + สัดส่วนประเภทเมนู)
  ในโหมดพัฒนาไฟล์นี้ตรวจตัวเองตอนโหลด (id ไม่ซ้ำ, สูตรอ้างวัตถุดิบที่มีจริง, ยอดประวัติ stock ต่อเนื่อง) ถ้าแก้ข้อมูลผิดจะ error บอกจุดที่ผิดทันที
- ตัวเลือกคงที่ (หมวด/หน่วย/ประเภทเมนู) อยู่ที่ [src/data/seed.js](src/data/seed.js)
- เปลี่ยนข้อมูลใน mockData.js แล้วต้องเพิ่มเลขเวอร์ชันของ `storageKey` ใน `api.js` (ตอนนี้ `v4`) หรือล้างข้อมูลด้วย `window.__resetDb()` ไม่งั้นเบราว์เซอร์จะยังใช้ข้อมูลเก่าที่เคยบันทึกไว้
- ล้างข้อมูลกลับเป็นตัวอย่าง: เปิด console แล้วพิมพ์ `await window.__resetDb()` (เฉพาะโหมดพัฒนา)
- รหัสผ่านถูกแฮช (SHA-256 + salt) ก่อนเก็บ — แต่เป็นเพียงของจำลอง ระบบจริงต้องแฮชที่เซิร์ฟเวอร์

### ชั้น API ([src/services/api.js](src/services/api.js))
ตรวจข้อมูลและบังคับกฎเหมือนหลังบ้านจริง ถ้าผิดกฎจะโยน `ApiError` ที่มี `code` และ `message`

| กลุ่ม | ฟังก์ชัน | ทำอะไร | error code ที่เป็นไปได้ |
|---|---|---|---|
| auth | `register({name, surname, email, password})` | สมัครสมาชิก | `EMAIL_TAKEN`, `WEAK_PASSWORD`, `VALIDATION` |
| auth | `login(identifier, password)` | ล็อกอินด้วย name หรือ email → `{token, user}` | `INVALID_CREDENTIALS` |
| auth | `me(token)` / `logout(token)` | ตรวจ/ยกเลิก session | `UNAUTHORIZED` |
| auth | `requestOtp(email)` | ขอ OTP (โหมดจำลองคืน otp กลับมาให้ดู) | `EMAIL_NOT_FOUND` |
| auth | `verifyOtp(email, otp)` | ตรวจ OTP → `{resetToken}` | `INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS` |
| auth | `resetPassword(resetToken, password)` | ตั้งรหัสผ่านใหม่ | `INVALID_RESET_TOKEN`, `WEAK_PASSWORD` |
| inventory | `getSnapshot()` | ข้อมูลทั้งหมดตอนเปิดแอป | — |
| inventory | `adjustIngredient(id, delta, label?)` | เพิ่ม/ลด stock + บันทึกประวัติ | `INSUFFICIENT_STOCK`, `NOT_FOUND` |
| inventory | `createIngredient(data)` / `updateIngredient(id, patch)` | สร้าง/แก้วัตถุดิบ | `DUPLICATE_NAME`, `VALIDATION`, `NOT_FOUND` |
| inventory | `createMenu(data)` / `updateMenu(id, patch)` | สร้าง/แก้เมนู (รวมสูตร) | `VALIDATION`, `NOT_FOUND` |
| orders | `create({items, note})` | สร้างออเดอร์ **และตัด stock ตามสูตรเมนู** ใน transaction เดียว (วัตถุดิบรวมไม่พอ = ปฏิเสธทั้งออเดอร์) | `INSUFFICIENT_STOCK`, `NOT_FOUND`, `VALIDATION` |
| orders | `advance(id)` | เลื่อนสถานะ รอรับ → กำลังทำ → พร้อมเสิร์ฟ → เสร็จสิ้น | `NOT_FOUND`, `VALIDATION` |
| orders | `cancel(id)` | ยกเลิกออเดอร์ **และคืน stock** ที่เคยตัด | `NOT_FOUND`, `VALIDATION` |
| ai | `sendFeedback(key, helpful)` / `listFeedback()` | บันทึก/อ่านความเห็น "คำแนะนำนี้มีประโยชน์ไหม" | `VALIDATION` |
| dashboard | `getSummary()` | สถิติวันนี้ + ผลพยากรณ์ AI (รวมรายชั่วโมงและสัดส่วนประเภทเมนู) | — |

## ต่อ API จริง (เช่น Flask)

แก้เฉพาะ **เนื้อในฟังก์ชันของ `src/services/api.js`** ให้เรียก `fetch` แทน — คงชื่อฟังก์ชัน พารามิเตอร์ และค่าที่คืนไว้เหมือนเดิม
และแปลง error ของเซิร์ฟเวอร์เป็น `ApiError` ด้วย `code` ชุดเดียวกับตารางด้านบน หน้าจอทั้งหมดจะใช้ต่อได้โดยไม่ต้องแก้

เส้นทาง REST ที่แนะนำ:

| ฟังก์ชัน | REST |
|---|---|
| `auth.register` | `POST /auth/register` |
| `auth.login` | `POST /auth/login` |
| `auth.me` / `auth.logout` | `GET /auth/me` / `POST /auth/logout` (แนบ `Authorization: Bearer <token>`) |
| `auth.requestOtp` | `POST /auth/otp` (ระบบจริง **ไม่คืน** otp — ส่งทางอีเมล) |
| `auth.verifyOtp` | `POST /auth/otp/verify` |
| `auth.resetPassword` | `POST /auth/password/reset` |
| `inventory.getSnapshot` | `GET /ingredients` + `GET /movements` + `GET /menus` + `GET /orders` |
| `inventory.adjustIngredient` | `POST /ingredients/:id/adjust` body `{delta, label}` → `{ingredient, movement}` |
| `inventory.createIngredient` / `updateIngredient` | `POST /ingredients` / `PATCH /ingredients/:id` |
| `inventory.createMenu` / `updateMenu` | `POST /menus` / `PATCH /menus/:id` |
| `orders.create` | `POST /orders` body `{items:[{menuId, qty}], note}` → `{order, ingredients, movements}` |
| `orders.advance` / `orders.cancel` | `POST /orders/:id/advance` / `POST /orders/:id/cancel` |
| `ai.sendFeedback` / `ai.listFeedback` | `PUT /ai/feedback/:key` / `GET /ai/feedback` |
| `dashboard.getSummary` | `GET /dashboard/summary` |

สิ่งที่หลังบ้านจริงต้องทำเองและห้ามเชื่อฝั่งเบราว์เซอร์: แฮชรหัสผ่าน, ออก/ตรวจ token, ส่ง OTP ทางอีเมล, จำกัดจำนวนครั้งที่กรอก OTP/รหัสผิด
และถ้ายกเลิกโหมดจำลอง ให้ตั้ง `isMock: false` ใน `api.js` เพื่อไม่ให้หน้า Forget password แสดง OTP

## หน้าและ route

| Route | หน้า |
|---|---|
| `/` , `/home` | Dashboard |
| `/login` `/register` `/forgetpassword` | บัญชีผู้ใช้ |
| `/stock` `/stock/low` `/stock/new` `/stock/:id` | วัตถุดิบ |
| `/menu` `/menu/new` `/menu/:id/edit` `/menu/:id/recipe` | เมนู |
| `/order` `/order/new` | ออเดอร์: รายการ/ค้นหา/กรอง/เลื่อนสถานะ/ยกเลิก และสร้างออเดอร์ (ตัด stock ตามสูตร) |
| `/statistics` | สถิติ: การ์ดสรุป, **กราฟ** (สถานะ stock ตามหมวด, เติมเข้า-ใช้ออกต่อวัน, สถานะเมนู, ยอดคงเหลือตามเวลา), วัตถุดิบที่ใช้บ่อย, วันนี้ vs forecast |
| `/ai` | Ai: สรุปจาก AI, พยากรณ์รายชั่วโมง/ประเภทเมนู, เมนูเสี่ยงทำไม่ได้, คำแนะนำเติมวัตถุดิบ (นำไปใช้ + ให้ความเห็น) |

### กราฟ
กราฟทั้งหมดวาดด้วย SVG เอง (ไม่มี dependency) อยู่ที่ [src/components/charts/](src/components/charts/):
`BarChart` (แท่งซ้อน แนวนอน/แนวตั้ง), `LineChart`, `ChartCard` (หัวข้อ + legend + ปุ่มสลับ กราฟ⇄ตาราง), `ChartTooltip`
ทุกกราฟมี tooltip ที่ใช้ได้ทั้งเมาส์และคีย์บอร์ด และมุมมองตารางที่แสดงข้อมูลชุดเดียวกัน สีกำหนดเป็นตัวแปรที่ [charts.css](src/components/charts/charts.css)

### หน้า Ai ยังเป็นโหมดจำลอง
ผลพยากรณ์มาจากข้อมูลจำลองในฐานข้อมูล และคำแนะนำคำนวณด้วยกฎใน [aiInsights.js](src/utils/aiInsights.js) (ออเดอร์พรุ่งนี้แบ่งตามสัดส่วนประเภทเมนู × สูตรเมนู เทียบกับ stock)
ยังไม่ได้เรียกโมเดล AI จริง เมื่อต่อ AI (เช่น Groq ผ่านหลังบ้าน — **ห้ามใส่ API key ในโค้ดหน้าเว็บ**) ให้เปลี่ยนที่มาของผลพยากรณ์ใน `api.dashboard.getSummary` ฟังก์ชันคำนวณคำแนะนำใช้ต่อได้

> หน้า Home ยังไม่บังคับล็อกอิน (ดู TODO ใน `src/App.jsx` — เมื่อพร้อมให้ครอบด้วย `<RequireAuth>`)
