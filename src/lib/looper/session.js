// Saving a Looper session to a file and opening it again.
//
// The file (.looper) is a zip written by the same store-only zipFiles as the
// exports: session.json — everything about the session except audio — and
// each layer's raw capture as two 32-bit float WAVs. Raw, not the finished
// loops: a layer is rebuilt from its capture and the numbers that cut it
// (makeLayer in stores/looper.js), so an opened session can be trimmed,
// nudged and re-synced exactly like the one that was saved.
//
// The REAPER export carries the same files in a Session/ folder, so a REAPER
// zip opens too. A zip re-made by another tool (Windows "Send to → Compressed
// folder" deflates) still opens where the browser can inflate.

import { zipFiles } from '@/lib/canvyZip'
import { wavFloat } from './export'

const FORMAT = 'looper-session'

// ── Writing ──────────────────────────────────────────────────────────────────
// data: the store's sessionData() — { master, syncMs, mix, song, layers[] }
// with each layer's raw { dry, wet }. Paths are under `prefix`.
export function sessionFiles(data, prefix = '') {
  const sr = data.master.sr
  const files = []
  const layers = data.layers.map((l, k) => {
    const base = `takes/${k + 1}`
    files.push({ name: `${prefix}${base} dry.wav`, data: wavFloat(l.raw.dry, sr) })
    files.push({ name: `${prefix}${base} wet.wav`, data: wavFloat(l.raw.wet, sr) })
    const { raw, ...spec } = l
    return { ...spec, dry: `${base} dry.wav`, wet: `${base} wet.wav` }
  })
  const json = {
    format: FORMAT,
    v: 1,
    savedAt: new Date().toISOString(),
    master: data.master,
    syncMs: data.syncMs,
    mix: data.mix,
    song: data.song,
    layers,
  }
  files.unshift({ name: `${prefix}session.json`, data: JSON.stringify(json, null, 1) })
  return files
}

export function sessionFile(data, name) {
  return { blob: zipFiles(sessionFiles(data)), name }
}

// ── Reading ──────────────────────────────────────────────────────────────────
// The central directory, name → { method, bytes }.
function readZip(buf) {
  const v = new DataView(buf)
  let eocd = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('That isn’t a Looper session file.')
  const count = v.getUint16(eocd + 10, true)
  let at = v.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const out = new Map()
  for (let k = 0; k < count; k++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error('That file is damaged.')
    const method = v.getUint16(at + 10, true)
    const size = v.getUint32(at + 20, true)
    const nameLen = v.getUint16(at + 28, true)
    const extraLen = v.getUint16(at + 30, true)
    const commentLen = v.getUint16(at + 32, true)
    const local = v.getUint32(at + 42, true)
    const name = dec.decode(new Uint8Array(buf, at + 46, nameLen))
    at += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true)
    out.set(name, { method, bytes: new Uint8Array(buf, start, size) })
  }
  return out
}

async function entryBytes(e) {
  if (e.method === 0) return e.bytes
  if (e.method === 8 && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([e.bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  throw new Error('That zip is compressed in a way the browser can’t read — open the original file.')
}

// The mono 32-bit float WAVs wavFloat writes.
function readWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('A take in that file isn’t audio.')
  let fmt = null
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(at)
    const size = v.getUint32(at + 4, true)
    if (id === 'fmt ') {
      fmt = { format: v.getUint16(at + 8, true), ch: v.getUint16(at + 10, true), bits: v.getUint16(at + 22, true) }
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 3 || fmt.ch !== 1 || fmt.bits !== 32) throw new Error('A take in that file isn’t in the Looper’s format.')
      const out = new Float32Array(size / 4)
      // Copied as bytes: the data rarely starts on a multiple of 4.
      new Uint8Array(out.buffer).set(bytes.subarray(at + 8, at + 8 + size))
      return out
    }
    at += 8 + size + (size & 1)
  }
  throw new Error('A take in that file has no audio.')
}

// A .looper file, or any zip with a session.json in it (the REAPER export).
// Returns the same shape the store saves to IndexedDB.
export async function readSessionFile(file) {
  const zip = readZip(await file.arrayBuffer())
  const jsonName = [...zip.keys()].find((n) => n === 'session.json' || n.endsWith('/session.json'))
  if (!jsonName) throw new Error('There’s no Looper session in that file.')
  const dir = jsonName.slice(0, -'session.json'.length)
  const json = JSON.parse(new TextDecoder().decode(await entryBytes(zip.get(jsonName))))
  if (json.format !== FORMAT || json.v !== 1) throw new Error('That session is from a version of the Looper this one can’t open.')
  const m = json.master
  if (!(m?.sr > 0 && m.len > 0) || !Array.isArray(json.layers) || !json.layers.length) throw new Error('That session is empty or damaged.')

  const take = async (path) => {
    const e = zip.get(dir + path)
    if (!e) throw new Error(`That session is missing “${path}”.`)
    return readWav(await entryBytes(e))
  }
  const layers = []
  for (const l of json.layers) {
    const { dry, wet, ...spec } = l
    if (!(spec.slot >= 0 && spec.slot < 8) || layers.some((x) => x.slot === spec.slot)) throw new Error('That session is damaged.')
    layers.push({ ...spec, raw: { dry: await take(dry), wet: await take(wet) } })
  }
  return { v: 1, master: m, syncMs: json.syncMs ?? null, mix: json.mix || {}, song: json.song, layers }
}

// ── Sample rate ──────────────────────────────────────────────────────────────
// Loops play from buffers at the audio context's own rate, so a session made
// at another rate is resampled (by the browser's own resampler, offline) and
// every position and length scaled with it. Loops that were whole multiples of
// the master stay exact multiples of the new master length.
async function resample(x, from, to) {
  const n = Math.max(1, Math.round((x.length * to) / from))
  const oc = new OfflineAudioContext(1, n, to)
  const b = oc.createBuffer(1, x.length, from)
  b.copyToChannel(x, 0)
  const src = oc.createBufferSource()
  src.buffer = b
  src.connect(oc.destination)
  src.start()
  const out = await oc.startRendering()
  return new Float32Array(out.getChannelData(0))
}

export async function atRate(data, sr) {
  const m = data.master
  if (Math.abs(m.sr - sr) < 1) return data
  const r = sr / m.sr
  const len = Math.round(m.len * r)
  const master = { ...m, sr, len, unit: Math.abs(m.unit - m.len) < 1 ? len : m.unit * r }
  const layers = []
  for (const l of data.layers) {
    const k = l.len / m.len
    const lLen = Math.abs(k - Math.round(k)) < 1e-9 ? len * Math.round(k) : Math.round(l.len * r)
    layers.push({
      ...l,
      len: lLen,
      offset: Math.round(l.offset * r) % lLen,
      R: Math.round(l.R * r),
      base: Math.round(l.base * r),
      raw: { dry: await resample(l.raw.dry, m.sr, sr), wet: await resample(l.raw.wet, m.sr, sr) },
    })
  }
  return { ...data, master, layers }
}
