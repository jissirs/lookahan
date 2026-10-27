import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext.js'
import { useInventory } from '../../context/InventoryContext.js'
import { listQueued, deleteQueued } from '../../utils/offlineStore.js'
export default function OfflineOrders() {
  const { user } = useAuth()
  const { createOrder, reload, staleAt } = useInventory()
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const guard = useRef(false)
  const load = async () => setRows(await listQueued(user.id))
  useEffect(() => { listQueued(user.id).then(setRows).catch(err => setError(err.message)) }, [user.id])
  const sync = async row => {
    if (guard.current) return
    guard.current = true; setBusy(true); setError('')
    try {
      await createOrder(row.request)
      await deleteQueued(row.key); await load(); await reload()
    } catch (err) { setError(err.code === 'PRICE_CHANGED' ? 'ราคาเปลี่ยนแล้ว ให้ตรวจออเดอร์ที่เซิร์ฟเวอร์ก่อนลบร่างและสร้างใหม่ตามราคาปัจจุบัน' : err.message) }
    finally { guard.current = false; setBusy(false) }
  }
  return <details className="restaurant-panel" open={rows.length > 0 || Boolean(staleAt)}><summary>ออเดอร์ในเครื่องที่ยังไม่ยืนยัน ({rows.length})</summary>
    {staleAt && <p role="status">ข้อมูลสำเนา ณ {new Date(staleAt).toLocaleString('th-TH')} ยังตรวจสต๊อกปัจจุบันไม่ได้</p>}
    <p>ร่างเหล่านี้ยังไม่ถือว่าส่งครัว ระบบตรวจราคาและสต๊อกที่เซิร์ฟเวอร์เมื่อกดส่ง การส่งซ้ำใช้รหัสเดิม</p>
    {error && <p role="alert">{error}</p>}
    {rows.map(row => <div key={row.key}><p>{new Date(row.savedAt).toLocaleString('th-TH')} · {row.request.tableLabel || 'กลับบ้าน'} · {row.cart.map(x => `${x.name} ×${x.qty}`).join(', ')} · ฿{row.request.expectedTotal}</p>
      <button disabled={busy} onClick={() => sync(row)}>ส่ง / ตรวจคำขอเดิม</button>{' '}
      <button disabled={busy} onClick={async () => { if (window.confirm('ลบร่างในเครื่อง? หากเคยส่งแล้วต้องตรวจรายการออเดอร์ที่เซิร์ฟเวอร์ก่อน การลบร่างไม่ยกเลิกออเดอร์ที่เซิร์ฟเวอร์')) { await deleteQueued(row.key); await load() } }}>ลบร่างในเครื่อง</button>
    </div>)}
  </details>
}
