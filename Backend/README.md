# lookahan Backend — โครงสร้าง (Flask)

> สถานะ: **ออกแบบโครงสร้างเท่านั้น ยังไม่มีโค้ด** (โฟลเดอร์ว่างมี `.gitkeep`)
> ข้อกำหนดระบบยังเป็นร่างและอาจเปลี่ยน (ตัวเลือก MySQL / Google sign-in / Groq ยังไม่ยืนยัน) จึงออกแบบให้เปลี่ยนส่วนเหล่านี้ได้โดยแตะไฟล์น้อยที่สุด

## 1. หลักการ

เลียนแบบสถาปัตยกรรมฝั่งหน้าบ้านที่มีอยู่แล้ว (`pages → context → services/api.js → Database.js`) โดยให้ Backend แทนที่สองชั้นล่าง และ **เปลี่ยนเฉพาะตัวฟังก์ชันใน `src/services/api.js`** (ชื่อ, อาร์กิวเมนต์, รูปแบบข้อมูลที่คืน, รหัส error คงเดิม):

```
Frontend api.js ──HTTP/JSON──▶ api (routes) ──▶ services (กฎธุรกิจ) ──▶ repositories (SQL) ──▶ MySQL
                                   │                   │
                                schemas (ตรวจ/แปลงข้อมูล)   ส่ง ApiError(code, message) กลับเป็น JSON
```

| ชั้น | หน้าที่ | ห้ามทำ |
|---|---|---|
| `api/` | รับ request, ตรวจสิทธิ์, เรียก schema + service, ตอบ JSON | มีกฎธุรกิจหรือ SQL |
| `schemas/` | ตรวจและแปลง input/output (ชนิด, ช่วงค่า, ฟิลด์ที่ต้องมี) | เข้าถึง DB |
| `services/` | กฎธุรกิจ (ห้ามสต็อกติดลบ, ชื่อซ้ำ, ตัดสต็อกตามสูตร, กฎรหัสผ่าน) และ transaction | รู้จัก Flask `request` |
| `repositories/` | คำสั่ง DB ล้วน ๆ (query/insert/update) | มีกฎธุรกิจ |
| `models/` | นิยามตาราง (SQLAlchemy) | มี logic นอกจากความสัมพันธ์ |

## 2. โครงสร้างโฟลเดอร์

```
Backend/
├─ app/
│  ├─ __init__.py          create_app() — app factory, ลงทะเบียน blueprint/extension/error handler
│  ├─ config.py            Config ตาม environment (Dev / Test / Prod) อ่านจาก .env
│  ├─ extensions.py        db, migrate, cors, jwt (สร้างที่เดียว ใช้ทั้งแอป)
│  ├─ errors.py            ApiError(code, message, status) + handler แปลงเป็น JSON
│  ├─ api/                 Blueprint ต่อหนึ่งกลุ่มงาน
│  │   ├─ auth.py          /auth/*
│  │   ├─ ingredients.py   /ingredients/*
│  │   ├─ movements.py     /movements
│  │   ├─ menus.py         /menus/*
│  │   ├─ orders.py        /orders/*
│  │   ├─ ai.py            /ai/*
│  │   ├─ dashboard.py     /dashboard/summary
│  │   └─ health.py        /health
│  ├─ services/            auth_service, inventory_service, menu_service, order_service,
│  │                       ai_service (เรียก Groq ที่นี่เท่านั้น), dashboard_service, mail_service (ส่ง OTP)
│  ├─ repositories/        user_repo, ingredient_repo, movement_repo, menu_repo, order_repo,
│  │                       otp_repo, ai_repo
│  ├─ models/              user, branch, ingredient, movement, menu, menu_ingredient,
│  │                       order, order_item, password_reset, ai_feedback, forecast
│  ├─ schemas/             รูปแบบ request/response ต่อ resource (marshmallow หรือ pydantic)
│  └─ utils/               security.py (hash/JWT), auth_required decorator, pagination, time
├─ migrations/             Alembic (flask-migrate) — แก้ตารางผ่านไฟล์ migration เท่านั้น
├─ scripts/                seed_demo.py (ย้ายข้อมูลจาก src/data/mockData.js), create_admin.py
├─ tests/                  api/ (ยิง endpoint ผ่าน test client), services/ (กฎธุรกิจ)
├─ instance/               ไฟล์เฉพาะเครื่อง (ไม่เข้า git)
├─ .env.example            ตัวอย่างตัวแปร: DATABASE_URL, JWT_SECRET, GROQ_API_KEY, MAIL_*, CORS_ORIGINS
├─ requirements.txt        flask, flask-sqlalchemy, flask-migrate, flask-cors, flask-jwt-extended, pymysql, marshmallow, requests/groq, pytest
└─ wsgi.py                 จุดเริ่มรัน (`flask run` / gunicorn)
```

## 3. Endpoint (ตรงกับ `src/services/api.js` และตาราง REST ใน README หลัก)

Prefix `/api/v1` — ทุก endpoint ยกเว้น `/auth/register|login|otp*|password/reset` และ `/health` ต้องแนบ `Authorization: Bearer <token>`

| Frontend | Endpoint | หมายเหตุ |
|---|---|---|
| `auth.register` | `POST /auth/register` | อีเมลซ้ำ → error code เดิมที่หน้า Register ใช้ |
| `auth.login` | `POST /auth/login` | คืน `{token, user}` |
| `auth.me` / `auth.logout` | `GET /auth/me` / `POST /auth/logout` | |
| `auth.requestOtp` | `POST /auth/otp` | ส่งทางอีเมล **ไม่คืน OTP** |
| `auth.verifyOtp` | `POST /auth/otp/verify` | คืน `resetToken` |
| `auth.resetPassword` | `POST /auth/password/reset` | |
| `inventory.getSnapshot` | `GET /ingredients`, `/movements`, `/menus`, `/orders` | รวมเป็นหนึ่งครั้งด้วย `GET /snapshot` ได้ถ้าจำเป็น |
| `inventory.adjustIngredient` | `POST /ingredients/:id/adjust` | `{delta,label}` → `{ingredient, movement}` |
| `inventory.createIngredient` / `updateIngredient` | `POST /ingredients` / `PATCH /ingredients/:id` | |
| `inventory.createMenu` / `updateMenu` | `POST /menus` / `PATCH /menus/:id` | สูตรอาหารส่งมาพร้อมเมนู |
| `orders.create` | `POST /orders` | ตัดสต็อกตามสูตรใน transaction เดียว (ไม่พอ → rollback ทั้งหมด) |
| `orders.advance` / `orders.cancel` | `POST /orders/:id/advance` / `/cancel` | ยกเลิกแล้วคืนสต็อก |
| `ai.sendFeedback` / `ai.listFeedback` | `PUT /ai/feedback/:key` / `GET /ai/feedback` | |
| (ใหม่) `ai.recommendations` | `GET /ai/recommendations` | เรียก Groq ฝั่ง Backend เท่านั้น (เก็บคีย์ใน env) แทนกฎใน `utils/aiInsights.js` |
| `dashboard.getSummary` | `GET /dashboard/summary` | |

รูปแบบ error ทั้งระบบ: `{ "error": { "code": "STOCK_NEGATIVE", "message": "..." } }` พร้อม HTTP status ที่เหมาะสม — `code` ต้องตรงกับ `ApiError` ที่หน้าบ้านใช้อยู่

## 4. ตารางฐานข้อมูล (ร่าง)

| ตาราง | คอลัมน์หลัก | หมายเหตุ |
|---|---|---|
| `users` | id, name, surname, email (unique), password_hash, branch_id, created_at | รหัสผ่านใช้ bcrypt/argon2 (ของหน้าบ้านเป็นแค่ mock) |
| `branches` | id, name | รองรับร้านหลายสาขา: ข้อมูลสต็อก/เมนู/ออเดอร์ผูก `branch_id` |
| `password_resets` | id, user_id, otp_hash, expires_at, attempts, reset_token, used_at | OTP หมดอายุสั้น จำกัดจำนวนครั้งที่ลอง |
| `ingredients` | id, branch_id, name, category(meat/veg/fruit/…), unit, quantity, min_quantity, price | unique(branch_id, name); quantity ≥ 0 (CHECK) |
| `movements` | id, ingredient_id, delta, quantity_after, label, order_id?, user_id, created_at | ประวัติเพิ่ม/ลดสต็อก (ไม่แก้ ไม่ลบ) |
| `menus` | id, branch_id, name, category, price, available, image_url | |
| `menu_ingredients` | menu_id, ingredient_id, quantity | สูตรอาหาร (fixed recipe) ที่ AI ใช้ประมาณการ |
| `orders` | id, branch_id, status, note, total, created_by, created_at | status: pending → … → done / cancelled |
| `order_items` | order_id, menu_id, qty, unit_price | เก็บราคา ณ ตอนสั่ง |
| `ai_feedback` | key, user_id, helpful, updated_at | |
| `forecasts` | id, branch_id, kind(peak_time/category), payload(JSON), generated_at | ผลพยากรณ์จาก AI (cache) |

## 5. ประเด็นที่ต้องตัดสินใจก่อนเขียนโค้ด

1. **Auth**: ใช้อีเมล+รหัสผ่านตามหน้าบ้านปัจจุบัน หรือ Google sign-in ตามร่างข้อกำหนด (แนะนำ: ทำอีเมลก่อน, เพิ่ม Google ภายหลังด้วยตาราง `oauth_accounts`)
2. **หลายสาขา**: ทำ `branch_id` ตั้งแต่แรก (แนะนำ) หรือค่อยเพิ่มทีหลัง
3. **ORM**: SQLAlchemy (แนะนำ, คู่กับ Alembic) หรือ SQL ตรง
4. **AI**: คำนวณพยากรณ์ด้วยสถิติจาก `movements/orders` ก่อน แล้วให้ Groq สรุป/แนะนำเป็นข้อความ (ลดค่าใช้จ่ายและความเสี่ยงตัวเลขผิด)
5. **สร้าง/ไล่ลำดับงาน**: config+errors → auth → ingredients+movements → menus → orders → dashboard → ai → seed จาก mockData

## 6. ลำดับการลงมือ (เมื่อพร้อมเขียนโค้ด)

1. app factory, config, errors, `/health`
2. models + migration แรก + `scripts/seed_demo.py`
3. auth (register/login/me/OTP) + test
4. ingredients/movements → menus → orders (transaction + test ตัด/คืนสต็อก)
5. dashboard, ai
6. หน้าบ้าน: เปลี่ยนตัวฟังก์ชันใน `src/services/api.js` เป็น `fetch` และตั้ง `isMock: false`
