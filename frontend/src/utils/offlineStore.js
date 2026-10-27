// Each outbox entry is a separate IndexedDB record: independent tabs cannot overwrite the queue.
const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('lookahan-local', 1)
  req.onupgradeneeded = () => req.result.createObjectStore('records', { keyPath: 'key' })
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})
async function transaction(mode, work) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('records', mode)
      const req = work(tx.objectStore('records'))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
export const saveSnapshot = (userId, data) => transaction('readwrite', store => store.put({ key: `snapshot:${userId}`, data, savedAt: new Date().toISOString() }))
export const readSnapshot = userId => transaction('readonly', store => store.get(`snapshot:${userId}`))
export const queueOrder = (userId, request, cart) => transaction('readwrite', store => store.put({ key: `order:${userId}:${request.requestKey}`, request, cart, savedAt: new Date().toISOString() }))
export const listQueued = async userId => (await transaction('readonly', store => store.getAll())).filter(x => x.key.startsWith(`order:${userId}:`))
export const deleteQueued = key => transaction('readwrite', store => store.delete(key))
export const clearSnapshot = userId => transaction('readwrite', store => store.delete(`snapshot:${userId}`))
