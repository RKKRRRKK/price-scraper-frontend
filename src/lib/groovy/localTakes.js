// Takes kept in this browser, in IndexedDB.
//
// A take stays on this computer until you choose to upload it: practising
// should not need a network, and most takes are scratch nobody wants in a
// database. Rows here have the same shape as `groovy_takes` rows, so uploading
// one is an insert of the row as it stands. Audio lives in its own store, keyed
// by take id, so listing takes never pulls megabytes of WAV off disk.

const DB_NAME = 'groovy'
const DB_VERSION = 1

let dbp = null

function openDb() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('This browser has no IndexedDB.'))
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbp = null
        reject(req.error)
      }
    })
  }
  return dbp
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// Ask once for storage the browser will not evict under pressure. Best effort:
// a refusal just means the default policy, which is still fine for practice.
let askedPersist = false
function askPersist() {
  if (askedPersist) return
  askedPersist = true
  navigator.storage?.persist?.().catch(() => {})
}

export async function listLocalTakes() {
  const db = await openDb()
  return result(db.transaction('takes').objectStore('takes').getAll())
}

export async function saveLocalTake(row, audioBlob = null) {
  askPersist()
  const db = await openDb()
  const tx = db.transaction(['takes', 'audio'], 'readwrite')
  tx.objectStore('takes').put(row)
  if (audioBlob) tx.objectStore('audio').put(audioBlob, row.id)
  return committed(tx)
}

export async function updateLocalTake(row) {
  const db = await openDb()
  const tx = db.transaction('takes', 'readwrite')
  tx.objectStore('takes').put(row)
  return committed(tx)
}

export async function getLocalAudio(id) {
  const db = await openDb()
  return (await result(db.transaction('audio').objectStore('audio').get(id))) || null
}

export async function deleteLocalTake(id) {
  const db = await openDb()
  const tx = db.transaction(['takes', 'audio'], 'readwrite')
  tx.objectStore('takes').delete(id)
  tx.objectStore('audio').delete(id)
  return committed(tx)
}
