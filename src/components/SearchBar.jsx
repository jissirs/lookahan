/**
 * ช่องค้นหาทรงแคปซูล พร้อมไอคอนแว่นขยาย
 * ไม่เก็บค่าเอง — หน้าที่เรียกใช้เป็นเจ้าของข้อความค้นหา (controlled input)
 * ทำให้หน้านั้นกรองรายการจากข้อความได้ทันที
 */
function SearchBar({ value, onChange, placeholder = 'Search....' }) {
  return (
    <label className="search-bar">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5L21 21" />
      </svg>
    </label>
  )
}

export default SearchBar
