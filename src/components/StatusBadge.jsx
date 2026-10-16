import { STATUS_LABEL } from '../utils/stockStatus.js'

/** จุดสี + ชื่อสถานะ stock  เช่น 🟢 Normal  (สีจุดกำหนดใน ui.css ตามชื่อสถานะ) */
function StatusBadge({ status }) {
  return (
    <span className="status-badge">
      <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  )
}

export default StatusBadge
