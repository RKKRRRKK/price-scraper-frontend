// Minimal, dependency-free ZIP writer (store / no compression).
//
// The AI debug download bundles many files — a .md + .png per call plus a
// summary — and the browser can only hand back one file per download. Rather
// than pull in JSZip, we assemble a store-only archive by hand: PNG screenshots
// are already compressed, so deflate would buy almost nothing.
//
// zipFiles([{ name, data }]) → Blob, where `data` is a string (UTF-8 text) or a
// Uint8Array (raw bytes, e.g. a decoded PNG). Names may contain `/` for folders.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()
function toBytes(data) {
  return typeof data === 'string' ? enc.encode(data) : data
}

// Decode a `data:...;base64,xxxx` URI to raw bytes (for embedded PNGs).
export function dataUriToBytes(uri) {
  const comma = uri.indexOf(',')
  const b64 = comma >= 0 ? uri.slice(comma + 1) : uri
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// DOS date/time — a fixed valid timestamp is fine for our purposes.
const DOS_TIME = 0
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1 // 2024-01-01

export function zipFiles(files) {
  const chunks = []      // Uint8Arrays, in final archive order
  const central = []     // central-directory records
  let offset = 0

  const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff])
  const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff])
  const push = (arr) => { chunks.push(arr); offset += arr.length }

  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const body = toBytes(f.data)
    const crc = crc32(body)
    const localOffset = offset

    // Local file header
    push(u32(0x04034b50))
    push(u16(20)); push(u16(0)); push(u16(0))        // version, flags, method(store)
    push(u16(DOS_TIME)); push(u16(DOS_DATE))
    push(u32(crc)); push(u32(body.length)); push(u32(body.length))
    push(u16(nameBytes.length)); push(u16(0))         // name len, extra len
    push(nameBytes)
    push(body)

    // Central directory record (buffered, appended after all locals)
    const rec = []
    const cpush = (arr) => rec.push(arr)
    cpush(u32(0x02014b50))
    cpush(u16(20)); cpush(u16(20)); cpush(u16(0)); cpush(u16(0)) // ver made/needed, flags, method
    cpush(u16(DOS_TIME)); cpush(u16(DOS_DATE))
    cpush(u32(crc)); cpush(u32(body.length)); cpush(u32(body.length))
    cpush(u16(nameBytes.length)); cpush(u16(0)); cpush(u16(0))   // name, extra, comment len
    cpush(u16(0)); cpush(u16(0)); cpush(u32(0))                  // disk, int attrs, ext attrs
    cpush(u32(localOffset))
    cpush(nameBytes)
    central.push(rec)
  }

  const cdStart = offset
  for (const rec of central) for (const arr of rec) push(arr)
  const cdSize = offset - cdStart

  // End of central directory
  push(u32(0x06054b50))
  push(u16(0)); push(u16(0))
  push(u16(files.length)); push(u16(files.length))
  push(u32(cdSize)); push(u32(cdStart))
  push(u16(0))

  return new Blob(chunks, { type: 'application/zip' })
}
