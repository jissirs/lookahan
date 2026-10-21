import './StockTable.css'

/**
 * ตารางกรอบดำตามดีไซน์ ใช้ซ้ำทุกตาราง (Stock, ประวัติ stock, สูตรอาหาร)
 *
 * @param {string[]} columns  ชื่อหัวคอลัมน์ เรียงจากซ้ายไปขวา
 * @param {React.ReactNode} children  แถวข้อมูล (<tr>) ที่จะใส่ใน tbody
 * @param {string} [className]  คลาสเพิ่มเติม เพื่อปรับสไตล์เฉพาะตาราง
 *
 * ตัวอย่าง:
 *   <BorderedTable columns={['ชื่อ', 'จำนวน']}>
 *     <tr><td>ไก่</td><td>3</td></tr>
 *   </BorderedTable>
 */
function BorderedTable({ columns, children, className = '' }) {
  return (
    <div className={`stock-table ${className}`.trim()}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export default BorderedTable
