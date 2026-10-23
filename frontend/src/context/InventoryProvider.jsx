/**
 * ตัวกลางระหว่างหน้าจอกับ API ของ "ข้อมูลคลัง": วัตถุดิบ (ingredients), ประวัติ (movements), เมนู (menus), ออเดอร์ (orders)
 *
 * หลักการ:
 *   1) ตอนเปิดแอปดึงข้อมูลทั้งหมดจาก api ครั้งเดียว — ระหว่างรอแสดง "กำลังโหลด" แทนหน้าจริง
 *      (หน้าจริงจึงมีข้อมูลพร้อมเสมอ ไม่ต้องจัดการสถานะโหลดทีละหน้า)
 *   2) เมื่อมีการแก้ไข: เรียก api → ได้ข้อมูลล่าสุดกลับมา → อัปเดต state ในเครื่องให้ตรงกัน
 *   3) กฎธุรกิจ (ชื่อซ้ำ, ลดต่ำกว่า 0 ไม่ได้ ฯลฯ) อยู่ที่ api — ที่นี่แค่รับผลหรือ error มาแสดง
 *
 * ชนิดของ action มี 2 แบบ:
 *   - แก้ไขทันที (adjustQuantity, updateIngredient, updateMenu, advanceOrder, cancelOrder)
 *       จัดการ error เอง: แสดงกล่องแจ้งเตือนแล้วคืน null (สำเร็จคืน true)
 *   - สร้างใหม่จากฟอร์ม (addIngredient, addMenu, createOrder)
 *       "โยน error ต่อ" ให้ฟอร์มจัดการเอง เพื่อแสดงข้อความที่ช่องกรอกได้ (เช่น ชื่อซ้ำ, วัตถุดิบไม่พอ)
 *
 * รูปแบบข้อมูลดูที่ Backend/app/models.py (เมธอด to_json ของแต่ละตาราง)
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api.js'
import { refreshNotifications } from '../hooks/useNotifications.js'
import { notify } from '../utils/dialogs.js'
import { InventoryContext } from './InventoryContext.js'

// แทนที่รายการที่ id ตรงกันด้วยตัวใหม่ (ไม่เจอก็ไม่ทำอะไร)
const replaceById = (list, updated) => list.map((item) => (item.id === updated.id ? updated : item))

// ออเดอร์ที่สร้าง/ยกเลิกจะตัดหรือคืน stock หลายตัวพร้อมกัน — รวมผลที่ api ส่งกลับ (วัตถุดิบที่เปลี่ยน + ประวัติใหม่) เข้า state
function applyStockChanges(state, changedIngredients, newMovements) {
  return {
    ...state,
    ingredients: changedIngredients.reduce(replaceById, state.ingredients),
    movements: [...state.movements, ...newMovements],
  }
}

export function InventoryProvider({ children }) {
  // data = { ingredients, movements, menus, orders } | null (null = ยังโหลดไม่เสร็จ)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')

  // ---------- โหลดข้อมูลตอนเปิดแอป ----------
  // attempt เพิ่มขึ้นเมื่อกด "ลองอีกครั้ง" เพื่อให้ effect ด้านล่างโหลดใหม่
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false // กัน setState หลังออกจากหน้าไปแล้ว (และกัน StrictMode รันสองรอบ)

    api.inventory
      .getSnapshot()
      .then((snapshot) => {
        if (!cancelled) setData(snapshot)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'โหลดข้อมูลไม่สำเร็จ')
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = () => {
    setLoadError('')
    setAttempt((n) => n + 1)
  }

  /** โหลดข้อมูลคลังใหม่จาก Backend (ใช้หลังปิดร้าน ที่ Backend ปรับ stock หลายตัวพร้อมกัน) — ไม่ล้างหน้าจอระหว่างโหลด */
  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  // ---------- action แบบแก้ไขทันที (จัดการ error เอง) ----------

  // ห่อการทำงาน: สำเร็จคืน true / ล้มเหลวแสดงกล่องแจ้งเตือนแล้วคืน null
  const guard = useCallback(async (work) => {
    try {
      await work()
      refreshNotifications() // งานสำเร็จ — Backend อาจสร้างแจ้งเตือนใหม่ (เช่น วัตถุดิบใกล้หมด) ให้กระดิ่งโหลดทันที
      return true
    } catch (err) {
      notify({ icon: 'error', title: 'ทำรายการไม่สำเร็จ', text: err.message })
      return null
    }
  }, [])

  /**
   * เพิ่ม (delta > 0) หรือลด (delta < 0) จำนวนวัตถุดิบ และบันทึกประวัติ
   * @param {string} [label] ข้อความในประวัติ เช่น "Order #0123" (ไม่ใส่ = Add/Drop)
   */
  const adjustQuantity = useCallback(
    (id, delta, label) =>
      guard(async () => {
        const { ingredient, movement } = await api.inventory.adjustIngredient(id, delta, label)
        setData((prev) => ({
          ...prev,
          ingredients: replaceById(prev.ingredients, ingredient),
          movements: [...prev.movements, movement],
        }))
      }),
    [guard],
  )

  /** แก้ข้อมูลวัตถุดิบบางฟิลด์ เช่น { name } หรือ { price } (จำนวนต้องแก้ผ่าน adjustQuantity) */
  const updateIngredient = useCallback(
    (id, patch) =>
      guard(async () => {
        const ingredient = await api.inventory.updateIngredient(id, patch)
        setData((prev) => ({ ...prev, ingredients: replaceById(prev.ingredients, ingredient) }))
      }),
    [guard],
  )

  /** แก้ข้อมูลเมนูบางฟิลด์ (รวมถึง recipe ทั้งก้อน) */
  const updateMenu = useCallback(
    (id, patch) =>
      guard(async () => {
        const menu = await api.inventory.updateMenu(id, patch)
        setData((prev) => ({ ...prev, menus: replaceById(prev.menus, menu) }))
      }),
    [guard],
  )

  // ---------- action แบบสร้างใหม่ (โยน error ต่อให้ฟอร์ม) ----------

  /** สร้างวัตถุดิบใหม่ — คืน id ของตัวที่สร้าง / โยน ApiError ถ้าไม่ผ่าน (เช่น DUPLICATE_NAME) */
  const addIngredient = useCallback(async (fields) => {
    const ingredient = await api.inventory.createIngredient(fields)
    setData((prev) => ({ ...prev, ingredients: [...prev.ingredients, ingredient] }))
    return ingredient.id
  }, [])

  /** สร้างเมนูใหม่ — คืน id ของเมนูที่สร้าง / โยน ApiError ถ้าไม่ผ่าน */
  const addMenu = useCallback(async (fields) => {
    const menu = await api.inventory.createMenu(fields)
    setData((prev) => ({ ...prev, menus: [...prev.menus, menu] }))
    return menu.id
  }, [])

  // ---------- ออเดอร์ ----------

  /**
   * สร้างออเดอร์ — api ตัด stock ตามสูตรเมนูให้ทันที
   * @param {{ items: { menuId: string, qty: number }[], note?: string }} fields
   * @returns {Promise<string>} เลขออเดอร์ที่สร้าง (เช่น "0163")
   * โยน ApiError ต่อให้ฟอร์ม เช่น INSUFFICIENT_STOCK (วัตถุดิบไม่พอ) เพื่อแสดงใต้ฟอร์ม
   */
  const createOrder = useCallback(async (fields) => {
    const { order, ingredients, movements } = await api.orders.create(fields)
    setData((prev) => ({ ...applyStockChanges(prev, ingredients, movements), orders: [order, ...prev.orders] }))
    refreshNotifications() // ออเดอร์ใหม่ (และ stock ที่ถูกตัด) อาจสร้างแจ้งเตือน
    return order.number
  }, [])

  /** เลื่อนออเดอร์ไปสถานะถัดไป (รอรับ → กำลังทำ → พร้อมเสิร์ฟ → เสร็จสิ้น) */
  const advanceOrder = useCallback(
    (id) =>
      guard(async () => {
        const order = await api.orders.advance(id)
        setData((prev) => ({ ...prev, orders: replaceById(prev.orders, order) }))
      }),
    [guard],
  )

  /** ยกเลิกออเดอร์ — api คืน stock ที่เคยตัดไปให้ */
  const cancelOrder = useCallback(
    (id) =>
      guard(async () => {
        const { order, ingredients, movements } = await api.orders.cancel(id)
        setData((prev) => ({ ...applyStockChanges(prev, ingredients, movements), orders: replaceById(prev.orders, order) }))
      }),
    [guard],
  )

  // useMemo กัน component ที่ใช้ context render ใหม่ทุกครั้งโดยไม่จำเป็น
  // (ต้องเรียกก่อน return แบบมีเงื่อนไขด้านล่าง ตามกฎของ hooks — ใช้ ?. กันกรณี data ยังเป็น null)
  const value = useMemo(
    () => ({
      ingredients: data?.ingredients ?? [],
      movements: data?.movements ?? [],
      menus: data?.menus ?? [],
      orders: data?.orders ?? [],
      reload,
      adjustQuantity,
      addIngredient,
      updateIngredient,
      addMenu,
      updateMenu,
      createOrder,
      advanceOrder,
      cancelOrder,
    }),
    [data, reload, adjustQuantity, addIngredient, updateIngredient, addMenu, updateMenu, createOrder, advanceOrder, cancelOrder],
  )

  // ---------- หน้า "กำลังโหลด" / โหลดไม่สำเร็จ ----------
  if (!data) {
    return (
      <div className="app-loading" role="status">
        {loadError ? (
          <>
            <p>{loadError}</p>
            <button type="button" onClick={retry}>
              ลองอีกครั้ง
            </button>
          </>
        ) : (
          <p>กำลังโหลดข้อมูล…</p>
        )}
      </div>
    )
  }

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>
}
