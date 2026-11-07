// The session in progress, kept in this browser so a reload or a closed tab
// does not cost an idea. One slot; "New session" empties it. Nothing here ever
// leaves the machine — the way out is the export.
//
// Each layer is stored as its raw capture plus the numbers that cut it, not as
// the finished loop: the loop is rebuilt on load, which is also what lets a
// later sync change re-align layers recorded before it.

const DB_NAME = 'looper'
const STORE = 'session'
const KEY = 'current'

let dbp = null

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }).catch((e) => {
      dbp = null
      throw e
    })
  }
  return dbp
}

function tx(mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        t.oncomplete = () => resolve(req?.result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      }),
  )
}

export function loadSession() {
  return tx('readonly', (s) => s.get(KEY)).catch(() => null)
}

export function saveSession(data) {
  return tx('readwrite', (s) => s.put(data, KEY))
}

export function clearSession() {
  return tx('readwrite', (s) => s.delete(KEY)).catch(() => {})
}
