import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../services/api.js'
import { useAuth } from '../../context/AuthContext.js'
import { confirmAction } from '../../utils/dialogs.js'
import OperationsReport from './OperationsReport.jsx'
import SessionManager from '../../components/SessionManager.jsx'
import { useCommand } from '../../hooks/useCommand.js'

function OwnerRestaurant() {
  const { logout } = useAuth()
  const [target, setTarget] = useState('')
  const [password, setPassword] = useState('')
  const transfer = useCommand(() => logout())
  const [data, setData] = useState(null)
  const [staff, setStaff] = useState([])
  const [audit, setAudit] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const guard = useRef(false)
  const [opening, setOpening] = useState('0')
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const load = useCallback(async () => {
    const [cash, members, history] = await Promise.all([api.restaurant.cash(), api.restaurant.staff(), api.restaurant.audit()])
    setData(cash); setStaff(members); setAudit(history)
  }, [])
  useEffect(() => {
    let active = true
    Promise.all([api.restaurant.cash(), api.restaurant.staff(), api.restaurant.audit()]).then(([cash, members, history]) => {
      if (active) { setData(cash); setStaff(members); setAudit(history) }
    }).catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [])
  const work = async fn => {
    if (guard.current) return
    guard.current = true; setBusy(true); setError('')
    try { await fn(); await load() } catch (err) { setError(err.message) }
    finally { guard.current = false; setBusy(false) }
  }
  const close = async e => {
    e.preventDefault()
    const ok = await confirmAction({ title: 'ยืนยันปิดเงินวันนี้?', text: 'หลังปิดจะรับหรือคืนเงินเพิ่มในวันนี้ไม่ได้ กรุณาตรวจยอดก่อน', confirmText: 'ปิดเงินวันนี้' })
    if (ok) await work(() => api.restaurant.closeCash({ opening, counted, note }))
  }
  return <section className="restaurant-panel" id="restaurant-operations">
    <h2>จัดการร้านและปิดเงิน</h2>
    <button type="button" disabled={busy} onClick={() => work(async () => {})}>รีเฟรชข้อมูล</button>
    {error && <p className="field-error" role="alert">{error}</p>}
    {!data ? <p>กำลังโหลด…</p> : <>
      <p>วันที่ {data.date} · เงินสดสุทธิ ฿{Number(data.cash).toFixed(2)} · โอนสุทธิ ฿{Number(data.transfer).toFixed(2)} · คืนเงิน ฿{Number(data.refunds).toFixed(2)}</p>
      <p>ยอดค้างชำระทุกวันที่ยังไม่ยกเลิก ฿{Number(data.outstandingAllDates).toFixed(2)}</p>
      <p>ประวัติออเดอร์เดิมยังไม่มีหลักฐานรับเงิน ระบบจึงไม่ถือว่าชำระแล้ว</p>
      {data.closing ? <p>ปิดเงินแล้ว · เงินที่ควรมี ฿{Number(data.closing.expected).toFixed(2)} · นับได้ ฿{Number(data.closing.counted).toFixed(2)} · ส่วนต่าง ฿{Number(data.closing.variance).toFixed(2)}</p> :
        <form onSubmit={close}><fieldset disabled={busy} className="restaurant-panel"><legend>กระทบยอดเงินสดประจำวัน</legend>
          <div className="restaurant-inline"><label>เงินทอนตั้งต้น<input className="field-input" type="number" min="0" step="0.01" required value={opening} onChange={e => setOpening(e.target.value)} /></label>
          <label>เงินสดนับได้จริง<input className="field-input" type="number" min="0" step="0.01" required value={counted} onChange={e => setCounted(e.target.value)} /></label></div>
          <p>ควรมี ฿{(Number(opening) + Number(data.cash)).toFixed(2)} · ส่วนต่าง ฿{(Number(counted || 0) - Number(opening) - Number(data.cash)).toFixed(2)}</p>
          <label>หมายเหตุ<input className="field-input" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          <button type="submit">ปิดเงินวันนี้</button>
        </fieldset></form>}
    </>}
    <details><summary>บัญชีพนักงานและการอนุมัติ</summary><p>พนักงานรับออเดอร์ เลื่อนสถานะ ยกเลิกออเดอร์ที่ยังไม่จบ และรับเงินได้ เจ้าของร้านจัดการสูตร สต๊อก คืนเงิน และปิดร้าน</p>
      {staff.map(member => <div className="restaurant-inline" key={member.id}><span>{member.name} {member.surname} · {member.email} · {member.role === 'owner' ? 'เจ้าของร้าน' : member.approved ? 'อนุมัติแล้ว' : 'รออนุมัติ'}</span>
        <details><summary>อุปกรณ์ของบัญชีนี้</summary><SessionManager userId={member.id} /></details>
        {member.role !== 'owner' && <button type="button" disabled={busy} onClick={() => work(() => api.restaurant.approve(member.id, !member.approved))}>{member.approved ? 'ระงับสิทธิ์' : 'อนุมัติเข้าร้าน'}</button>}
      </div>)}
    </details>
    <details><summary>โอนสิทธิ์เจ้าของร้าน</summary><form onSubmit={async e => {
      e.preventDefault()
      if (await confirmAction({ title: 'โอนสิทธิ์เจ้าของร้าน?', text: 'บัญชีคุณจะเป็นพนักงาน และทั้งสองบัญชีต้องเข้าสู่ระบบใหม่', confirmText: 'ยืนยันโอนสิทธิ์' })) await transfer.run(api.pos.transferOwner, { userId: target, password })
      setPassword('')
    }}><fieldset disabled={transfer.busy || transfer.uncertain}>
      <label>ผู้รับสิทธิ์<select className="field-input" required value={target} onChange={e => setTarget(e.target.value)}><option value="">เลือกพนักงาน</option>{staff.filter(x => x.approved && x.role !== 'owner').map(x => <option value={x.id} key={x.id}>{x.name} · {x.email}</option>)}</select></label>
      <label>รหัสผ่านเจ้าของร้านปัจจุบัน<input className="field-input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button>โอนสิทธิ์</button>
    </fieldset></form>{transfer.error && <p role="alert">{transfer.error}</p>}{transfer.uncertain && <button onClick={transfer.retry}>ตรวจคำขอเดิมซ้ำ</button>}</details>
    <OperationsReport />
    <details><summary>ประวัติการทำรายการล่าสุด</summary><ul className="restaurant-audit">{audit.map(e => <li key={e.id}>{new Date(e.createdAt).toLocaleString('th-TH')} · ผู้ใช้ #{e.userId} · {e.action}</li>)}</ul></details>
  </section>
}

export default function RestaurantSection() {
  const { user } = useAuth()
  return user?.role === 'owner' ? <OwnerRestaurant /> : null
}
