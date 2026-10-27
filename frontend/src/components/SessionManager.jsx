import { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { useAuth } from '../context/AuthContext.js'
import { useCommand } from '../hooks/useCommand.js'
export default function SessionManager({ userId }) {
  const [sessions, setSessions] = useState([])
  const [error, setError] = useState('')
  const { logout } = useAuth()
  const load = async () => setSessions(await api.pos.sessions(userId))
  const action = useCommand(load)
  useEffect(() => { api.pos.sessions(userId).then(setSessions).catch(err => setError(err.message)) }, [userId])
  return <div className="restaurant-panel"><p>อุปกรณ์ที่เข้าสู่ระบบ</p>{(error || action.error) && <p role="alert">{error || action.error}</p>}
    {action.uncertain && <button disabled={action.busy} onClick={action.retry}>ตรวจคำขอเดิมซ้ำ</button>}
    {sessions.map(x => <div key={x.id}><p style={{ overflowWrap: 'anywhere' }}>{x.device} {x.current ? '· เครื่องนี้' : ''}<br />ใช้งานล่าสุด {x.lastSeenAt ? new Date(x.lastSeenAt).toLocaleString('th-TH') : 'ไม่ทราบ'}</p>
      <button disabled={action.busy || action.uncertain} onClick={async () => {
        if (window.confirm(x.current ? 'ออกจากระบบเครื่องนี้?' : 'เพิกถอนการเข้าสู่ระบบของอุปกรณ์นี้?')) {
          const ok = await action.run(fields => api.pos.revokeSession(userId, x.id, fields))
          if (ok && x.current) logout()
        }
      }}>เพิกถอน</button></div>)}
  </div>
}
