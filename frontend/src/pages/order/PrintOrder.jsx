import { createPortal } from 'react-dom'

export default function PrintOrder({ order, kind, onClose }) {
  if (!order) return null
  const receipt = kind === 'receipt'
  return createPortal(<div className="pos-print-overlay" role="dialog" aria-modal="true" aria-label={receipt ? 'ใบเสร็จ' : 'ใบสั่งครัว'}>
    <div className="pos-print-controls"><button onClick={() => window.print()}>พิมพ์ / บันทึก PDF</button><button onClick={onClose}>ปิดตัวอย่าง</button></div>
    <article id="pos-print-root">
      <h1>{receipt ? 'ใบเสร็จรับเงิน / รายการขาย' : 'ใบสั่งครัว'}</h1>
      <h2>#{order.number} · ครั้งแก้ไข {order.revision}</h2>
      <p>{new Date(order.createdAt).toLocaleString('th-TH')}</p>
      <p>{order.serviceType === 'dine_in' ? `โต๊ะ ${order.tableLabel}` : 'กลับบ้าน'} · {order.status}</p>
      <hr />
      {order.items.map(item => <div key={item.id}><strong>{item.qty} × {item.name}</strong>
        <p>{(item.modifiers || []).map(x => x.name).join(', ')} {item.note}</p>
        {receipt && <p>฿{(item.price * item.qty).toFixed(2)}</p>}
      </div>)}
      {order.note && <p>หมายเหตุ: {order.note}</p>}
      {receipt && <><hr /><p>ก่อนลด ฿{Number(order.grossTotal).toFixed(2)}</p><p>ส่วนลด ฿{Number(order.discount || 0).toFixed(2)} {order.discountReason}</p>
        <h2>รวม ฿{Number(order.total).toFixed(2)}</h2><p>รับสุทธิ ฿{Number(order.paid).toFixed(2)} · ค้าง ฿{Number(order.balance).toFixed(2)}</p>
        {(order.payments || []).map(p => <p key={p.id}>{p.method === 'cash' ? 'สด' : 'โอน'} ฿{p.amount} · ทอน ฿{p.change}</p>)}
        <p>ไม่ใช่ใบกำกับภาษี</p></>}
    </article>
  </div>, document.body)
}
