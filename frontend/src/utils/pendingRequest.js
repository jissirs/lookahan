// Preserve an uncertain mutation across refresh; scoped by account and operation.
export function readPending(key) {
  try { return JSON.parse(sessionStorage.getItem(key)) } catch { return null }
}
export function savePending(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* Retry still works in this mounted page. */ }
}
export function clearPending(key) {
  try { sessionStorage.removeItem(key) } catch { /* Storage may be disabled. */ }
}
