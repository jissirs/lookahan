/**
 * Context ของ "ข้อมูลคลัง" (วัตถุดิบ ประวัติ เมนู)
 * ตัวเก็บข้อมูลจริงอยู่ที่ InventoryProvider.jsx — ไฟล์นี้มีแค่ตัว context กับ hook
 * (แยกไฟล์เพื่อไม่ให้ไฟล์ที่ export คอมโพเนนต์ปนกับ hook ตามกฎ react-refresh)
 */
import { createContext, useContext } from 'react'

export const InventoryContext = createContext(null)

/** ใช้ในคอมโพเนนต์: const { ingredients, menus, adjustQuantity, ... } = useInventory() */
export function useInventory() {
  const ctx = useContext(InventoryContext)
  if (!ctx) throw new Error('useInventory must be used inside <InventoryProvider>')
  return ctx
}
