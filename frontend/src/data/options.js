/**
 * ตัวเลือกคงที่ของระบบ — ใช้ใน dropdown ของฟอร์ม/ตัวกรองทุกหน้า
 * (Backend ตรวจค่าเหล่านี้อีกชั้นหนึ่งเสมอ)
 *
 * ข้อมูลจริงทั้งหมด (วัตถุดิบ เมนู ผู้ใช้ ฯลฯ) อยู่ในฐานข้อมูลของ Backend
 * ถ้าเพิ่ม/แก้ตัวเลือกที่นี่ ต้องแก้ Backend/app/models.py (INGREDIENT_CATEGORIES ฯลฯ) ให้ตรงกันด้วย
 */

// หมวดและหน่วยของวัตถุดิบ
export const INGREDIENT_CATEGORIES = ['Meat', 'Vegetable', 'Fruit', 'Other']
export const INGREDIENT_UNITS = ['pcs', 'g', 'ml']

// ประเภทของเมนู
export const MENU_CATEGORIES = ['อาหารจานเดียว', 'เส้น', 'เครื่องดื่ม', 'อื่นๆ']
