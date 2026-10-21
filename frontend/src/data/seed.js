/**
 * ตัวเลือกคงที่ของระบบ — ใช้ใน dropdown ของฟอร์ม/ตัวกรองทุกหน้า
 * และใช้ตรวจความถูกต้องของข้อมูลในชั้น API (services/api.js)
 *
 * ข้อมูลตัวอย่างทั้งหมด (วัตถุดิบ เมนู ผู้ใช้ ฯลฯ) ย้ายไปอยู่ที่ data/mockData.js แล้ว
 * ถ้าเพิ่ม/แก้ตัวเลือกที่นี่ ให้ตรวจ mockData.js ด้วยว่ายังใช้ค่าตรงกัน
 */

// หมวดและหน่วยของวัตถุดิบ
export const INGREDIENT_CATEGORIES = ['Meat', 'Vegetable', 'Fruit', 'Other']
export const INGREDIENT_UNITS = ['pcs', 'g', 'ml']

// ประเภทของเมนู
export const MENU_CATEGORIES = ['อาหารจานเดียว', 'เส้น', 'เครื่องดื่ม', 'อื่นๆ']
