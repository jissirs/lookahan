/**
 * MockData — ข้อมูลจำลองที่ใส่ในฐานข้อมูลจำลอง (services/Database.js) ตอนเริ่มต้น
 *
 * เป็นข้อมูลร้านอาหารไทยขนาดเล็ก ใหญ่พอให้เห็นหน้าจอทุกแบบ:
 *   - วัตถุดิบ 4 หมวด หลายหน่วย และครบทั้งสามสถานะ (Normal / Low / Critical)
 *   - เมนู 4 ประเภท ทั้งที่พร้อมขาย, วัตถุดิบไม่พอ และปิดขาย
 *   - ประวัติ stock ของหลายวัตถุดิบ โดยยอดคงเหลือต่อเนื่องและลงท้ายตรงกับจำนวนปัจจุบันเสมอ
 *   - ออเดอร์ตัวอย่าง 12 รายการ ครบทุกสถานะ (รอรับ / กำลังทำ / พร้อมเสิร์ฟ / เสร็จสิ้น / ยกเลิก)
 *   - ผู้ใช้ตัวอย่าง, สถิติวันนี้ และผลพยากรณ์ของ AI (รายชั่วโมง + สัดส่วนประเภทเมนู)
 *
 * ข้อกำหนดที่ข้อมูลต้องรักษาไว้ (ไฟล์นี้ตรวจให้ตอนโหลดเมื่อเปิดโหมดพัฒนา ดูฟังก์ชัน checkMockData ท้ายไฟล์):
 *   1) id ไม่ซ้ำกันภายในตารางเดียวกัน
 *   2) ทุกบรรทัดในสูตรเมนู และทุกรายการในออเดอร์ อ้างวัตถุดิบ/เมนูที่มีอยู่จริง
 *   3) ประวัติ stock ไม่ทำให้ยอดติดลบ และยอดสุดท้ายเท่ากับ quantity ปัจจุบัน
 *
 * หมายเหตุ: ตัวเลือก (หมวด/หน่วย) อยู่ที่ data/seed.js — ไฟล์นี้เก็บเฉพาะ "ข้อมูล"
 */

// ====================================================================
//  1) ผู้ใช้
// ====================================================================

// รหัสผ่านเป็นข้อความเปล่าเฉพาะในไฟล์ตัวอย่างนี้ — ตอนสร้างฐานข้อมูลจะถูกแฮชก่อนเก็บ (services/seedTables.js)
// ล็อกอินได้ด้วย name หรือ email
export const MOCK_USERS = [
  { id: 'user-demo', name: 'Pooh', surname: 'Demo', email: 'demo@lookahhan.test', password: 'demo1234' },
  { id: 'user-somchai', name: 'Somchai', surname: 'Jaidee', email: 'somchai@lookahhan.test', password: 'demo1234' },
  { id: 'user-malee', name: 'Malee', surname: 'Rakdee', email: 'malee@lookahhan.test', password: 'demo1234' },
]

// ====================================================================
//  2) วัตถุดิบ
// ====================================================================
// สถานะไม่เก็บที่นี่ — คำนวณจาก quantity ใน utils/stockStatus.js (หน่วย pcs: Low ≤ 2, Critical ≤ 1 / g, ml: Low ≤ 200, Critical ≤ 100)

// ตัวช่วยเขียนให้สั้น: ing('Chicken', 'Meat', 'pcs', 10, 20) → { id: 'ing-chicken', ... }
// id สร้างจากชื่อ (ตัวพิมพ์เล็ก เว้นวรรคเป็น -) จึงเดาได้ง่ายตอนเขียนสูตรเมนู
const ing = (name, category, unit, quantity, price) => ({
  id: `ing-${name.toLowerCase().replace(/\s+/g, '-')}`,
  name,
  category,
  unit,
  quantity,
  price,
})

export const MOCK_INGREDIENTS = [
  // ----- เนื้อสัตว์ (Meat) -----
  ing('Chicken', 'Meat', 'pcs', 10, 20),
  ing('Pork', 'Meat', 'pcs', 2, 25), // Low
  ing('Beef', 'Meat', 'pcs', 3, 40),
  ing('Shrimp', 'Meat', 'pcs', 1, 35), // Critical
  ing('Squid', 'Meat', 'pcs', 6, 30),
  ing('Fish Fillet', 'Meat', 'pcs', 5, 30),
  ing('Minced Pork', 'Meat', 'pcs', 7, 15),
  ing('Sausage', 'Meat', 'pcs', 12, 8),

  // ----- ผัก (Vegetable) -----
  ing('Carrot', 'Vegetable', 'pcs', 1, 5), // Critical
  ing('Onion', 'Vegetable', 'pcs', 4, 5),
  ing('Coriander', 'Vegetable', 'pcs', 5, 3),
  ing('Holy Basil', 'Vegetable', 'pcs', 9, 3),
  ing('Garlic', 'Vegetable', 'pcs', 14, 2),
  ing('Chili', 'Vegetable', 'pcs', 20, 1),
  ing('Tomato', 'Vegetable', 'pcs', 8, 4),
  ing('Cabbage', 'Vegetable', 'pcs', 6, 10),
  ing('Morning Glory', 'Vegetable', 'pcs', 7, 8),
  ing('Bean Sprouts', 'Vegetable', 'pcs', 10, 5),
  ing('Spring Onion', 'Vegetable', 'pcs', 11, 3),
  ing('Papaya', 'Vegetable', 'pcs', 3, 15),
  ing('Lemongrass', 'Vegetable', 'pcs', 8, 3),

  // ----- ผลไม้ (Fruit) -----
  ing('Apple', 'Fruit', 'pcs', 6, 10),
  ing('Mango', 'Fruit', 'pcs', 4, 15),
  ing('Pineapple', 'Fruit', 'pcs', 3, 25),
  ing('Watermelon', 'Fruit', 'pcs', 2, 40), // Low
  ing('Orange', 'Fruit', 'pcs', 18, 8),
  ing('Lime', 'Fruit', 'pcs', 25, 2),

  // ----- อื่นๆ (Other) — ของแห้ง เครื่องปรุง เครื่องดื่ม -----
  ing('Rice', 'Other', 'g', 1500, 1),
  ing('Rice Noodles', 'Other', 'g', 900, 1),
  ing('Egg Noodles', 'Other', 'g', 120, 1), // Low
  ing('Eggs', 'Other', 'pcs', 30, 5),
  ing('Fish Sauce', 'Other', 'ml', 150, 1), // Low
  ing('Soy Sauce', 'Other', 'ml', 600, 1),
  ing('Oyster Sauce', 'Other', 'ml', 90, 1), // Critical
  ing('Sugar', 'Other', 'g', 450, 1),
  ing('Cooking Oil', 'Other', 'ml', 2500, 1),
  ing('Tea Leaves', 'Other', 'g', 350, 1),
  ing('Coffee Beans', 'Other', 'g', 800, 1),
  ing('Milk', 'Other', 'ml', 3000, 1),
]

// ====================================================================
//  3) ประวัติการเปลี่ยนจำนวน stock (movements)
// ====================================================================
// เขียนเป็น "รายการเคลื่อนไหว เรียงจากเก่า → ใหม่" ของแต่ละวัตถุดิบ: [วันเวลา, ข้อความ, จำนวน(+เพิ่ม/-ลด)]
// ไม่ต้องคำนวณยอดคงเหลือเอง — ฟังก์ชัน buildMovements ด้านล่างคำนวณให้
// โดยย้อนจาก quantity ปัจจุบัน จึงลงท้ายตรงกับ stock จริงเสมอ
const HISTORY = {
  'ing-chicken': [
    ['2026-10-06T18:40:00', 'Order #6767', -3],
    ['2026-10-07T09:05:00', 'Add', 10],
    ['2026-10-07T14:20:00', 'Order #0123', -1],
  ],
  'ing-pork': [
    ['2026-10-05T10:00:00', 'Add', 8],
    ['2026-10-06T12:30:00', 'Order #6740', -3],
    ['2026-10-06T19:10:00', 'Order #6771', -2],
    ['2026-10-07T13:15:00', 'Order #0119', -1],
  ],
  'ing-beef': [
    ['2026-10-04T09:30:00', 'Add', 6],
    ['2026-10-06T20:05:00', 'Order #6780', -2],
    ['2026-10-07T12:45:00', 'Order #0115', -1],
  ],
  'ing-shrimp': [
    ['2026-10-05T09:00:00', 'Add', 10],
    ['2026-10-06T13:20:00', 'Order #6752', -4],
    ['2026-10-07T11:40:00', 'Order #0108', -5],
  ],
  'ing-carrot': [
    ['2026-10-04T08:50:00', 'Add', 12],
    ['2026-10-06T11:00:00', 'Order #6733', -6],
    ['2026-10-07T10:30:00', 'Order #0102', -5],
  ],
  'ing-eggs': [
    ['2026-10-03T08:00:00', 'Add', 60],
    ['2026-10-05T12:00:00', 'Order #6701', -20],
    ['2026-10-07T15:00:00', 'Order #0130', -10],
  ],
  'ing-rice': [
    ['2026-10-02T08:00:00', 'Add', 5000],
    ['2026-10-05T18:00:00', 'Order #6710', -1800],
    ['2026-10-07T16:00:00', 'Order #0140', -1700],
  ],
  'ing-fish-sauce': [
    ['2026-10-03T09:00:00', 'Add', 500],
    ['2026-10-06T17:00:00', 'Order #6760', -250],
    ['2026-10-07T17:30:00', 'Order #0145', -100],
  ],
  'ing-oyster-sauce': [
    ['2026-10-03T09:10:00', 'Add', 400],
    ['2026-10-06T18:00:00', 'Order #6765', -190],
    ['2026-10-07T18:00:00', 'Order #0150', -120],
  ],
  'ing-milk': [
    ['2026-10-05T07:30:00', 'Add', 6000],
    ['2026-10-06T16:00:00', 'Order #6775', -1800],
    ['2026-10-07T14:00:00', 'Order #0122', -1200],
  ],
  'ing-egg-noodles': [
    ['2026-10-04T09:00:00', 'Add', 800],
    ['2026-10-06T15:00:00', 'Order #6745', -400],
    ['2026-10-07T12:00:00', 'Order #0111', -280],
  ],
  'ing-watermelon': [
    ['2026-10-06T08:30:00', 'Add', 6],
    ['2026-10-06T14:00:00', 'Order #6748', -2],
    ['2026-10-07T13:00:00', 'Order #0116', -2],
  ],
}

// ข้อความในประวัติ → ชนิดรายการ: "Add" = เติม, "Drop" = ลดด้วยมือ, ขึ้นต้น "Order" = ตัดตามออเดอร์
const movementType = (label) => (label.startsWith('Order') ? 'Order' : label)

/**
 * แปลง HISTORY เป็นแถวของตาราง movements พร้อมยอดคงเหลือ (balance) ที่คำนวณถูกต้อง
 *   ยอดตั้งต้น = จำนวนปัจจุบัน − ผลรวมของทุกรายการ
 *   แล้วไล่บวกทีละรายการ จากเก่าไปใหม่
 */
function buildMovements(ingredients, history) {
  let counter = 0
  const rows = []

  for (const [ingredientId, entries] of Object.entries(history)) {
    const ingredient = ingredients.find((i) => i.id === ingredientId)
    const totalChange = entries.reduce((sum, [, , amount]) => sum + amount, 0)

    let balance = ingredient.quantity - totalChange // ยอดก่อนรายการแรก
    for (const [date, label, amount] of entries) {
      balance += amount
      counter += 1
      rows.push({
        id: `mov-${counter}`,
        ingredientId,
        date,
        type: movementType(label),
        label,
        amount,
        balance,
      })
    }
  }

  return rows
}

export const MOCK_MOVEMENTS = buildMovements(MOCK_INGREDIENTS, HISTORY)

// ====================================================================
//  4) เมนู
// ====================================================================
// recipe = วัตถุดิบที่ใช้ต่อ 1 จาน เขียนเป็น [id ของวัตถุดิบ, ปริมาณ] (ปริมาณหน่วยเดียวกับวัตถุดิบนั้น)
// สถานะ "พร้อมขาย / วัตถุดิบไม่พอ" ไม่เก็บที่นี่ — คำนวณใน utils/menuStatus.js
// (ที่เขียน "// ไม่พอ" ไว้ คือเมนูที่จงใจให้วัตถุดิบไม่พอกับ stock ปัจจุบัน เพื่อให้เห็นสถานะนั้นในหน้าจอ)

// ตัวช่วยเขียนให้สั้น — ค่าเริ่มต้น: เปิดขาย, ไม่มีรูป/รายละเอียด/หมายเหตุ
const menu = (id, name, category, price, recipe, extra = {}) => ({
  id: `menu-${id}`,
  name,
  category,
  price,
  image: '',
  details: '',
  note: '',
  available: true,
  recipe: recipe.map(([ingredientId, qty]) => ({ ingredientId, qty })),
  ...extra,
})

// ชื่อประเภท (ต้องตรงกับ MENU_CATEGORIES ใน data/seed.js)
const ONE_DISH = 'อาหารจานเดียว'
const NOODLE = 'เส้น'
const DRINK = 'เครื่องดื่ม'
const OTHER = 'อื่นๆ'

export const MOCK_MENUS = [
  // ----- อาหารจานเดียว -----
  menu('khaomankai', 'ข้าวมันไก่', ONE_DISH, 60, [['ing-chicken', 1], ['ing-rice', 150], ['ing-coriander', 1]], {
    details: 'ข้าวมันไก่ต้ม เสิร์ฟพร้อมน้ำจิ้มและน้ำซุป',
  }),
  menu('krapao', 'ผัดกะเพราหมู', ONE_DISH, 55, [['ing-pork', 1], ['ing-holy-basil', 1], ['ing-garlic', 1], ['ing-chili', 2], ['ing-rice', 150]]),
  menu('krapao-chicken', 'ผัดกะเพราไก่', ONE_DISH, 55, [['ing-chicken', 1], ['ing-holy-basil', 1], ['ing-garlic', 1], ['ing-chili', 2], ['ing-rice', 150], ['ing-eggs', 1]], {
    details: 'เสิร์ฟพร้อมไข่ดาว',
  }),
  menu('fried-rice-pork', 'ข้าวผัดหมู', ONE_DISH, 50, [['ing-pork', 1], ['ing-rice', 200], ['ing-eggs', 1], ['ing-onion', 1], ['ing-spring-onion', 1]]),
  menu('fried-rice-shrimp', 'ข้าวผัดกุ้ง', ONE_DISH, 70, [['ing-shrimp', 2], ['ing-rice', 200], ['ing-eggs', 1], ['ing-onion', 1]]), // กุ้งไม่พอ
  menu('omelet-rice', 'ข้าวไข่เจียวหมูสับ', ONE_DISH, 45, [['ing-minced-pork', 1], ['ing-eggs', 2], ['ing-rice', 150]]),
  menu('garlic-pork', 'ข้าวหมูทอดกระเทียม', ONE_DISH, 55, [['ing-pork', 2], ['ing-garlic', 2], ['ing-rice', 150]]),
  menu('beef-curry-rice', 'ข้าวผัดพริกแกงเนื้อ', ONE_DISH, 75, [['ing-beef', 1], ['ing-chili', 3], ['ing-rice', 150]]),
  menu('beef-bowl', 'ข้าวหน้าเนื้อ', ONE_DISH, 85, [['ing-beef', 2], ['ing-onion', 1], ['ing-rice', 150], ['ing-soy-sauce', 30]]),
  menu('veggie-rice', 'ข้าวผัดผักรวม', ONE_DISH, 45, [['ing-carrot', 1], ['ing-cabbage', 1], ['ing-morning-glory', 1], ['ing-rice', 150], ['ing-oyster-sauce', 20]]),
  menu('garlic-fish', 'ข้าวปลาทอดกระเทียม', ONE_DISH, 65, [['ing-fish-fillet', 1], ['ing-garlic', 2], ['ing-rice', 150]], {
    available: false,
    note: 'ปิดขายชั่วคราว รอซัพพลายเออร์ส่งปลา',
  }),

  // ----- เส้น -----
  menu('sauce-noodle', 'ผัดซีอิ๊ว', NOODLE, 55, [['ing-pork', 1], ['ing-carrot', 2], ['ing-rice-noodles', 150], ['ing-soy-sauce', 30], ['ing-eggs', 1], ['ing-morning-glory', 1]], {
    note: 'ผักคะน้าเสริมได้เมื่อมีสต็อก',
  }), // แครอทไม่พอ
  menu('pad-thai', 'ผัดไทยกุ้งสด', NOODLE, 80, [['ing-shrimp', 3], ['ing-rice-noodles', 150], ['ing-eggs', 1], ['ing-bean-sprouts', 1], ['ing-sugar', 20], ['ing-fish-sauce', 20]]), // กุ้งไม่พอ
  menu('pork-noodle-soup', 'ก๋วยเตี๋ยวหมู', NOODLE, 50, [['ing-pork', 1], ['ing-rice-noodles', 120], ['ing-bean-sprouts', 1], ['ing-spring-onion', 1]]),
  menu('wonton-noodle', 'บะหมี่เกี๊ยว', NOODLE, 55, [['ing-egg-noodles', 100], ['ing-minced-pork', 1], ['ing-spring-onion', 1]]),
  menu('seafood-gravy-noodle', 'ราดหน้าทะเล', NOODLE, 75, [['ing-squid', 1], ['ing-shrimp', 1], ['ing-rice-noodles', 150], ['ing-cabbage', 1]]),
  menu('suki-dry', 'สุกี้แห้ง', NOODLE, 60, [['ing-chicken', 1], ['ing-egg-noodles', 150], ['ing-cabbage', 1], ['ing-eggs', 1]]), // เส้นไม่พอ

  // ----- เครื่องดื่ม -----
  menu('thai-tea', 'ชาเย็น', DRINK, 30, [['ing-tea-leaves', 15], ['ing-milk', 60], ['ing-sugar', 20]]),
  menu('iced-coffee', 'กาแฟเย็น', DRINK, 40, [['ing-coffee-beans', 18], ['ing-milk', 60], ['ing-sugar', 20]]),
  menu('fresh-milk', 'นมสด', DRINK, 25, [['ing-milk', 200], ['ing-sugar', 10]]),
  menu('lime-juice', 'น้ำมะนาว', DRINK, 30, [['ing-lime', 2], ['ing-sugar', 30]]),
  menu('orange-juice', 'น้ำส้มคั้น', DRINK, 35, [['ing-orange', 3]]),
  menu('watermelon-smoothie', 'น้ำแตงโมปั่น', DRINK, 35, [['ing-watermelon', 1], ['ing-sugar', 10]]),

  // ----- อื่นๆ -----
  menu('fruit-plate', 'ผลไม้รวม', OTHER, 40, [['ing-apple', 1], ['ing-mango', 1], ['ing-pineapple', 1]], { available: false }),
  menu('fried-egg', 'ไข่ดาว', OTHER, 10, [['ing-eggs', 1]]),
  menu('som-tam', 'ส้มตำไทย', OTHER, 50, [['ing-papaya', 1], ['ing-tomato', 1], ['ing-chili', 3], ['ing-lime', 1], ['ing-fish-sauce', 20]]),
  menu('fried-sausage', 'ไส้กรอกทอด', OTHER, 30, [['ing-sausage', 3], ['ing-cooking-oil', 30]]),
  menu('tom-yum-kung', 'ต้มยำกุ้ง', OTHER, 120, [['ing-shrimp', 2], ['ing-lemongrass', 1], ['ing-lime', 1], ['ing-chili', 2], ['ing-fish-sauce', 20]]), // กุ้งไม่พอ
]

// ====================================================================
//  5) ออเดอร์
// ====================================================================
// order = { id, number, createdAt, status, items, total, note, usage }
//   status : new (รอรับ) → cooking (กำลังทำ) → ready (พร้อมเสิร์ฟ) → done (เสร็จสิ้น)   หรือ cancelled (ยกเลิก)
//   items  : สำเนาชื่อ/ราคาเมนู ณ ตอนสั่ง (แก้ราคาเมนูทีหลังจะไม่กระทบออเดอร์เก่า)
//   usage  : วัตถุดิบที่ถูกตัด stock ไปตอนสร้างออเดอร์ — ใช้คืน stock เมื่อยกเลิก
//            ออเดอร์ตัวอย่างด้านล่างเป็น "ของเก่า" ที่ stock ถูกตัดไปแล้วในประวัติ จึงเป็น [] (ยกเลิกแล้วไม่คืนซ้ำ)
// เวลาของออเดอร์ตัวอย่างนับจาก "ตอนที่ฐานข้อมูลถูกสร้าง" ย้อนไปกี่นาที จึงเป็นของ "วันนี้" เสมอ

const MINUTE = 60 * 1000
const seededAt = Date.now()

// ตัวช่วยเขียนให้สั้น: mockOrder('0162', 4, 'new', [['menu-khaomankai', 1], ['menu-thai-tea', 1]])
function mockOrder(number, minutesAgo, status, lines, note = '') {
  const items = lines.map(([menuId, qty]) => {
    const found = MOCK_MENUS.find((m) => m.id === menuId)
    return { menuId, name: found.name, price: found.price, qty }
  })

  return {
    id: `order-${number}`,
    number,
    createdAt: new Date(seededAt - minutesAgo * MINUTE).toISOString(),
    status,
    items,
    total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
    note,
    usage: [],
  }
}

// เรียงจากใหม่ไปเก่า
export const MOCK_ORDERS = [
  mockOrder('0162', 4, 'new', [['menu-khaomankai', 1], ['menu-thai-tea', 1]]),
  mockOrder('0161', 9, 'new', [['menu-krapao-chicken', 2], ['menu-lime-juice', 1]], 'ไม่ใส่พริก 1 จาน'),
  mockOrder('0160', 15, 'cooking', [['menu-fried-rice-pork', 1], ['menu-fried-egg', 1]]),
  mockOrder('0159', 22, 'cooking', [['menu-wonton-noodle', 2]]),
  mockOrder('0158', 31, 'ready', [['menu-som-tam', 1], ['menu-fresh-milk', 2]]),
  mockOrder('0157', 44, 'ready', [['menu-omelet-rice', 1]]),
  mockOrder('0156', 58, 'done', [['menu-beef-bowl', 1], ['menu-orange-juice', 1]]),
  mockOrder('0155', 73, 'cancelled', [['menu-pad-thai', 2]], 'ลูกค้ายกเลิกเอง'),
  mockOrder('0154', 90, 'done', [['menu-garlic-pork', 2]]),
  mockOrder('0153', 118, 'done', [['menu-iced-coffee', 3], ['menu-fried-sausage', 1]]),
  mockOrder('0152', 150, 'done', [['menu-veggie-rice', 1], ['menu-lime-juice', 1]]),
  mockOrder('0151', 185, 'done', [['menu-khaomankai', 3]]),
]

// ====================================================================
//  6) ข้อมูลของหน้า Dashboard
// ====================================================================

// สถิติวันนี้ (การ์ด Today Statistics)
export const MOCK_STATISTICS = {
  id: 'today',
  orders: 125,
  revenue: 7000, // บาท
  bestSeller: 'กะเพราไก่',
}

// ผลพยากรณ์จาก AI (การ์ด Ai forecast และหน้า Ai) — ระบบจริงจะคำนวณใหม่ทุกวัน
// ข้อมูลตัวอย่างชุดนี้ต้องสอดคล้องกันเอง (ตรวจใน checkMockData):
//   - ผลรวมของ hourly = orders
//   - ผลรวมของ share ใน categories = 1
//   - peakStart–peakEnd คือช่วง 2 ชั่วโมงที่ hourly รวมมากที่สุด
export const MOCK_FORECAST = {
  id: 'tomorrow',
  orders: 142, // ออเดอร์ที่คาดว่าจะเข้าพรุ่งนี้
  peakStart: '12:00', // ช่วงที่ลูกค้าเยอะที่สุด
  peakEnd: '14:00',
  bestSeller: 'กะเพราไก่',

  // ออเดอร์ที่คาดว่าจะเข้าในแต่ละชั่วโมงของพรุ่งนี้ (ร้านเปิด 10:00–22:00)
  hourly: [
    { hour: '10:00', orders: 6 },
    { hour: '11:00', orders: 12 },
    { hour: '12:00', orders: 24 },
    { hour: '13:00', orders: 22 },
    { hour: '14:00', orders: 9 },
    { hour: '15:00', orders: 6 },
    { hour: '16:00', orders: 4 },
    { hour: '17:00', orders: 8 },
    { hour: '18:00', orders: 16 },
    { hour: '19:00', orders: 18 },
    { hour: '20:00', orders: 11 },
    { hour: '21:00', orders: 6 },
  ],

  // สัดส่วนออเดอร์ที่คาดว่าจะเป็นของเมนูแต่ละประเภท (ชื่อต้องตรงกับ MENU_CATEGORIES ใน data/seed.js)
  categories: [
    { category: 'อาหารจานเดียว', share: 0.48 },
    { category: 'เส้น', share: 0.22 },
    { category: 'เครื่องดื่ม', share: 0.2 },
    { category: 'อื่นๆ', share: 0.1 },
  ],
}

// ====================================================================
//  ตรวจความถูกต้องของข้อมูล (เฉพาะโหมดพัฒนา)
// ====================================================================

/**
 * ตรวจข้อกำหนด 3 ข้อด้านบน แล้วโยน error บอกจุดที่ผิดทันที
 * (กันไม่ให้แก้ไขข้อมูลตัวอย่างแล้วทำให้ฐานข้อมูลจำลองไม่สอดคล้องกันโดยไม่รู้ตัว)
 */
export function checkMockData() {
  const fail = (message) => {
    throw new Error(`[mockData] ${message}`)
  }

  // 1) id ต้องไม่ซ้ำ
  for (const [name, rows] of Object.entries({
    users: MOCK_USERS,
    ingredients: MOCK_INGREDIENTS,
    menus: MOCK_MENUS,
    movements: MOCK_MOVEMENTS,
    orders: MOCK_ORDERS,
  })) {
    const ids = rows.map((r) => r.id)
    const duplicate = ids.find((id, i) => ids.indexOf(id) !== i)
    if (duplicate) fail(`id ซ้ำในตาราง ${name}: ${duplicate}`)
  }

  // 2) สูตรเมนูต้องอ้างวัตถุดิบที่มีอยู่จริง และปริมาณเป็นจำนวนเต็มบวก
  const ingredientIds = new Set(MOCK_INGREDIENTS.map((i) => i.id))
  for (const m of MOCK_MENUS) {
    for (const line of m.recipe) {
      if (!ingredientIds.has(line.ingredientId)) fail(`เมนู "${m.name}" อ้างวัตถุดิบที่ไม่มี: ${line.ingredientId}`)
      if (!Number.isInteger(line.qty) || line.qty < 1) fail(`เมนู "${m.name}" มีปริมาณไม่ถูกต้อง (${line.ingredientId})`)
    }
  }

  // 2.1) รายการในออเดอร์ต้องอ้างเมนูที่มีอยู่จริง และยอดรวมต้องตรงกับผลรวมรายการ
  const menuIds = new Set(MOCK_MENUS.map((m) => m.id))
  for (const o of MOCK_ORDERS) {
    for (const item of o.items) {
      if (!menuIds.has(item.menuId)) fail(`ออเดอร์ #${o.number} อ้างเมนูที่ไม่มี: ${item.menuId}`)
    }
    const sum = o.items.reduce((total, item) => total + item.price * item.qty, 0)
    if (sum !== o.total) fail(`ออเดอร์ #${o.number} ยอดรวมไม่ตรง (${o.total} ≠ ${sum})`)
  }

  // 2.2) ผลพยากรณ์ต้องสอดคล้องกันเอง
  const hourlyTotal = MOCK_FORECAST.hourly.reduce((sum, h) => sum + h.orders, 0)
  if (hourlyTotal !== MOCK_FORECAST.orders) fail(`forecast: ผลรวมรายชั่วโมง (${hourlyTotal}) ไม่เท่ากับ orders (${MOCK_FORECAST.orders})`)

  const shareTotal = MOCK_FORECAST.categories.reduce((sum, c) => sum + c.share, 0)
  if (Math.abs(shareTotal - 1) > 1e-9) fail(`forecast: สัดส่วนประเภทเมนูรวมได้ ${shareTotal} ไม่ใช่ 1`)

  // 3) ประวัติ stock: ยอดตั้งต้นต้องไม่ติดลบ (ยอดสุดท้ายตรงกับ quantity อยู่แล้วจากวิธีคำนวณ)
  for (const [ingredientId, entries] of Object.entries(HISTORY)) {
    const ingredient = MOCK_INGREDIENTS.find((i) => i.id === ingredientId)
    if (!ingredient) fail(`ประวัติ stock อ้างวัตถุดิบที่ไม่มี: ${ingredientId}`)

    let balance = ingredient.quantity - entries.reduce((sum, [, , amount]) => sum + amount, 0)
    if (balance < 0) fail(`ยอดตั้งต้นของ ${ingredientId} ติดลบ (${balance})`)
    for (const [, , amount] of entries) {
      balance += amount
      if (balance < 0) fail(`ยอดของ ${ingredientId} ติดลบระหว่างประวัติ`)
    }
  }
}

if (import.meta.env?.DEV) checkMockData()
