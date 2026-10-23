# lookahhan

เว็บแอปจัดการ stock วัตถุดิบและเมนูสำหรับร้านอาหาร — React 19 + Vite

**ต้องเปิด Backend (Flask) ก่อน** แล้วจึงเปิดหน้าเว็บ — ดูวิธีติดตั้งและรัน Backend ที่ [../Backend/README.md](../Backend/README.md)
(ข้อมูลทั้งหมดอยู่ในฐานข้อมูลของ Backend ไม่มีข้อมูลจำลองในหน้าเว็บแล้ว)

```bash
npm install
npm run dev      # เปิดที่ http://localhost:5173  (ส่งต่อคำขอ /api ไปที่ Backend http://127.0.0.1:5000 ให้เอง)
npm run build    # สร้างไฟล์สำหรับใช้งานจริง
npm run lint
```

ฐานข้อมูลเริ่มต้นว่างเปล่า (ไม่มีข้อมูลจำลอง) — สมัครผู้ใช้คนแรกที่หน้า Register แล้วเพิ่มวัตถุดิบ เมนู และออเดอร์ผ่านหน้าเว็บ

## โครงสร้างข้อมูล: 3 ชั้น

```
หน้าจอ (pages/, components/)
   │  เรียกผ่าน hook: useAuth(), useInventory()
   ▼
context/   AuthProvider, InventoryProvider   เก็บ state ฝั่งหน้าจอ + ส่งต่อให้ api
   │
   ▼
services/api.js       "สัญญา" ของ API: ฟังก์ชัน async ส่งคำขอ HTTP ไป Backend + แปลง error เป็น ApiError(code, message)
   │  HTTP (JSON)
   ▼
Backend (Flask)       กฎธุรกิจทั้งหมด + ฐานข้อมูล
```

หลักสำคัญ: **หน้าจอไม่เรียก Backend ตรงๆ** — ทุกอย่างผ่าน `api.js` และกฎธุรกิจ (ชื่อซ้ำ, stock ห้ามติดลบ, ตัด stock ตามสูตร ฯลฯ) อยู่ที่ Backend

- **Token ล็อกอิน**: `api.js` จำ token ไว้แล้วแนบ `Authorization: Bearer <token>` ให้ทุกคำขอ (AuthProvider เก็บ `{token, user}` ใน localStorage ชื่อ `lookahan.auth` จึงรีเฟรชหน้าแล้วไม่หลุด) ถ้า Backend ตอบว่า token หมดอายุ จะออกจากระบบอัตโนมัติ
- **ต้องล็อกอินก่อนใช้งาน**: ทุกหน้ายกเว้น Login / Register / Forget password ครอบด้วย `RequireAuth` และข้อมูลคลังจะโหลดจาก Backend หลังล็อกอินแล้วเท่านั้น (`App.jsx`)
- **ที่อยู่ Backend**: ตอนพัฒนา Vite ส่งต่อ `/api` ไปที่ `http://127.0.0.1:5000` (เปลี่ยนด้วย `VITE_BACKEND_URL`) ตอน deploy ตั้ง `VITE_API_URL` เป็น URL เต็มของ API — ดู [.env.example](.env.example)
- ตัวเลือกคงที่ (หมวด/หน่วย/ประเภทเมนู) อยู่ที่ [src/data/options.js](src/data/options.js) ต้องตรงกับ `Backend/app/models.py`
- ต่อ Backend ไม่ได้ (เช่นยังไม่เปิด) หน้าจอจะแจ้ง "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่า Backend เปิดอยู่"

### ชั้น API ([src/services/api.js](src/services/api.js))
ส่งคำขอไป Backend ถ้า Backend ปฏิเสธจะโยน `ApiError` ที่มี `code` และ `message` (ชุดเดียวกับ `Backend/app/tools.py`)

| กลุ่ม | ฟังก์ชัน | ทำอะไร | error code ที่เป็นไปได้ |
|---|---|---|---|
| auth | `register({name, surname, email, password})` | สมัครสมาชิก | `EMAIL_TAKEN`, `WEAK_PASSWORD`, `VALIDATION` |
| auth | `login(identifier, password)` | ล็อกอินด้วย name หรือ email → `{token, user}` | `INVALID_CREDENTIALS` |
| auth | `me(token)` / `logout(token)` | ตรวจ/ยกเลิก session | `UNAUTHORIZED` |
| auth | `requestOtp(email)` | ขอ OTP (Backend ส่งทางอีเมล; ถ้ายังไม่ตั้งค่าอีเมลจะคืน otp กลับมาให้ดู) | `EMAIL_NOT_FOUND` |
| auth | `verifyOtp(email, otp)` | ตรวจ OTP → `{resetToken}` | `INVALID_OTP`, `OTP_EXPIRED`, `TOO_MANY_ATTEMPTS` |
| auth | `resetPassword(resetToken, password)` | ตั้งรหัสผ่านใหม่ | `INVALID_RESET_TOKEN`, `WEAK_PASSWORD` |
| inventory | `getSnapshot()` | ข้อมูลทั้งหมดตอนเปิดแอป | — |
| inventory | `adjustIngredient(id, delta, label?)` | เพิ่ม/ลด stock + บันทึกประวัติ | `INSUFFICIENT_STOCK`, `NOT_FOUND` |
| inventory | `createIngredient(data)` / `updateIngredient(id, patch)` | สร้าง/แก้วัตถุดิบ | `DUPLICATE_NAME`, `VALIDATION`, `NOT_FOUND` |
| inventory | `createMenu(data)` / `updateMenu(id, patch)` | สร้าง/แก้เมนู (รวมสูตร) | `VALIDATION`, `NOT_FOUND` |
| orders | `create({items, note})` | สร้างออเดอร์ **และตัด stock ตามสูตรเมนู** ใน transaction เดียว (วัตถุดิบรวมไม่พอ = ปฏิเสธทั้งออเดอร์) | `INSUFFICIENT_STOCK`, `NOT_FOUND`, `VALIDATION` |
| orders | `advance(id)` | เลื่อนสถานะ รอรับ → กำลังทำ → พร้อมเสิร์ฟ → เสร็จสิ้น | `NOT_FOUND`, `VALIDATION` |
| orders | `cancel(id)` | ยกเลิกออเดอร์ **และคืน stock** ที่เคยตัด | `NOT_FOUND`, `VALIDATION` |
| notifications | `list()` | แจ้งเตือนของกระดิ่ง (30 อันล่าสุด + จำนวนที่ยังไม่อ่าน) | — |
| notifications | `markRead(id)` / `markAllRead()` | ทำเครื่องหมายอ่านแล้ว | `NOT_FOUND` |
| ai | `sendFeedback(key, helpful)` / `listFeedback()` | บันทึก/อ่านความเห็น "คำแนะนำนี้มีประโยชน์ไหม" | `VALIDATION` |
| dashboard | `getSummary()` | สถิติวันนี้ + ผลพยากรณ์ AI (รวมรายชั่วโมงและสัดส่วนประเภทเมนู) | — |

## เส้นทาง REST ที่ api.js เรียก (Backend ที่ `/api/v1`)

| ฟังก์ชัน | REST |
|---|---|
| `auth.register` | `POST /auth/register` |
| `auth.login` | `POST /auth/login` |
| `auth.me` / `auth.logout` | `GET /auth/me` / `POST /auth/logout` |
| `auth.requestOtp` | `POST /auth/otp` (ระบบจริง **ไม่คืน** otp — ส่งทางอีเมล) |
| `auth.verifyOtp` | `POST /auth/otp/verify` |
| `auth.resetPassword` | `POST /auth/password/reset` |
| `inventory.getSnapshot` | `GET /snapshot` |
| `inventory.adjustIngredient` | `POST /ingredients/:id/adjust` body `{delta, label}` → `{ingredient, movement}` |
| `inventory.createIngredient` / `updateIngredient` | `POST /ingredients` / `PATCH /ingredients/:id` |
| `inventory.createMenu` / `updateMenu` | `POST /menus` / `PATCH /menus/:id` |
| `orders.create` | `POST /orders` body `{items:[{menuId, qty}], note}` → `{order, ingredients, movements}` |
| `orders.advance` / `orders.cancel` | `POST /orders/:id/advance` / `POST /orders/:id/cancel` |
| `notifications.list` / `markRead` / `markAllRead` | `GET /notifications` / `POST /notifications/:id/read` / `POST /notifications/read-all` |
| `ai.sendFeedback` / `ai.listFeedback` | `PUT /ai/feedback/:key` / `GET /ai/feedback` |
| `dashboard.getSummary` | `GET /dashboard/summary` |

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

### หน้า Ai

ผลวิเคราะห์มาจาก AI (Groq) ผ่าน Backend (ต้องมีออเดอร์ในระบบอย่างน้อย 1 ใบ และ Backend ต้องมี `GROQ_API_KEY`) วิเคราะห์ให้อัตโนมัติเมื่อเปิดหน้า Home/Statistics/Ai ถ้ายังไม่มีผลหรือผลเก่ากว่า 6 ชั่วโมง ([useDashboard.js](src/hooks/useDashboard.js)) และมีปุ่ม "ให้ AI วิเคราะห์ใหม่"

หน้านี้แสดง (เรียงตามลำดับ): สรุปจาก AI → ตัวเลขสำคัญ (ออเดอร์/**รายได้**พรุ่งนี้ ฯลฯ) → **AI เตือน** (วัตถุดิบใกล้หมด/เมนูที่วัตถุดิบไม่พอทำ) → **สถานะวัตถุดิบ** (จำนวนรายการ ปกติ/ใกล้หมด/วิกฤต นับสดจาก stock ตอนนี้ + ประโยคสรุปของ AI) → กราฟ (ออเดอร์รายชั่วโมง, สัดส่วนประเภท, **รายได้รายวัน 7 วัน**, เมนูที่เสี่ยงทำไม่ได้) → **ความสดของวัตถุดิบ** (มูลค่าที่คาดว่าจะเหลือค้างคืน + เมนูที่ควรโปรโมตเพื่อใช้ให้หมด) → คำแนะนำให้เติม (เติมเท่าที่ขาดพอดี) → เมนูที่ขายไม่ได้ตอนนี้

เป้าหมายคือ **ใช้วัตถุดิบให้หมดพอดี ของค้างคืนน้อยที่สุด** ตัวเลขการเติมและของค้างมาจากแผนความสดที่ Backend คำนวณ (`forecast.outlook`) — [aiInsights.js](src/utils/aiInsights.js) ใช้ตัวเลขนั้นตรง ๆ (ถ้าเป็นผลรุ่นเก่าที่ยังไม่มี จะคำนวณเองแบบเดิม) **ห้ามใส่ API key ในโค้ดหน้าเว็บ** การเรียก AI ทำที่ Backend เท่านั้น
หน้า Home แสดงรายได้พรุ่งนี้ และหน้า Statistics เทียบรายได้วันนี้กับพรุ่งนี้

## กระดิ่งแจ้งเตือน

กระดิ่งที่ Header แสดงแจ้งเตือนจริงจาก Backend (วัตถุดิบใกล้หมด/วิกฤต, ออเดอร์ใหม่/พร้อมเสิร์ฟ/ยกเลิก, AI วิเคราะห์เสร็จ) — โค้ดอยู่ที่ [useNotifications.js](src/hooks/useNotifications.js) และ [Header.jsx](src/components/Header.jsx)
- ป้ายแดง = จำนวนที่ **ยังไม่อ่าน** (เกิน 99 แสดง `99+`) กดที่แจ้งเตือน = ทำเครื่องหมายอ่านแล้ว + ไปหน้าที่เกี่ยวข้อง และมีปุ่ม "Mark all as read"
- โหลดใหม่เองทุก 30 วินาที (เฉพาะตอนแท็บเปิดอยู่), ตอนกลับมาที่แท็บ และ **ทันทีหลังทำงานที่อาจสร้างแจ้งเตือน** (เพิ่ม/ลด stock, สร้าง/เลื่อน/ยกเลิกออเดอร์, ให้ AI วิเคราะห์) ผ่านฟังก์ชัน `refreshNotifications()`
- สถานะ "อ่านแล้ว" เก็บที่ Backend แยกรายผู้ใช้ จึงรีเฟรชหน้าหรือเปลี่ยนเครื่องแล้วยังอยู่
- โหลดแจ้งเตือนไม่สำเร็จ (เช่น Backend ยังไม่ได้อัปเดต/เน็ตหลุด) กระดิ่งจะว่างเงียบ ๆ ไม่รบกวนผู้ใช้
