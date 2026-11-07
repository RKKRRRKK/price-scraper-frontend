// Getting an idea out of the Looper and into REAPER.
//
// Three shapes, all rendered from the same arrangement:
//
//   REAPER project  each loop as a single WAV, plus a .rpp that sets the tempo
//                   and lays the loops out as looping items where the
//                   arrangement has them on. Nothing is printed: the items
//                   loop their source, so the song stays editable — drag an
//                   item edge and the loop carries on.
//   Stems           one full-length WAV per layer, all starting at zero, for
//                   any DAW.
//   Mix             the arrangement as one WAV.
//
// WAVs are 32-bit float. Loops come out of the amp, and with gain and level
// both up they can exceed full scale; float keeps every sample, and REAPER
// reads it natively. Only the mix — the one file likely to be played somewhere
// else — is pulled down if it would clip.

import { zipFiles } from '@/lib/canvyZip'

// Fade length on block changes; the engine uses the same (lib/looper/engine.js).
const RAMP_SEC = 0.006

export function wavFloat(samples, sr) {
  const n = samples.length
  const bytes = 58 + n * 4
  const buf = new ArrayBuffer(bytes)
  const v = new DataView(buf)
  const text = (at, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  v.setUint32(4, bytes - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 18, true)
  v.setUint16(20, 3, true) // IEEE float
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sr, true)
  v.setUint32(28, sr * 4, true)
  v.setUint16(32, 4, true)
  v.setUint16(34, 32, true)
  v.setUint16(36, 0, true)
  // Non-PCM WAVs carry a fact chunk with the frame count.
  text(38, 'fact')
  v.setUint32(42, 4, true)
  v.setUint32(46, n, true)
  text(50, 'data')
  v.setUint32(54, n * 4, true)
  // Copied as bytes: the data starts at 58, which a Float32Array view cannot
  // (it needs a multiple of 4). Every browser platform is little-endian, as
  // WAV is.
  new Uint8Array(buf, 58).set(new Uint8Array(samples.buffer, samples.byteOffset, n * 4))
  return new Uint8Array(buf)
}

// The per-sample gain of one row of the arrangement: on or off per block, with
// a short ramp ending on each change, exactly as the engine automates it.
function rowGain(row, blocks, blockLen, sr) {
  const total = blocks * blockLen
  const g = new Float32Array(total)
  for (let b = 0; b < blocks; b++) if (row[b]) g.fill(1, b * blockLen, (b + 1) * blockLen)
  const r = Math.max(1, Math.round(RAMP_SEC * sr))
  for (let b = 1; b <= blocks; b++) {
    const was = !!row[b - 1]
    const now = b < blocks && !!row[b]
    if (was === now) continue
    const at = b * blockLen
    for (let i = 0; i < r; i++) {
      const k = at - r + i
      if (k >= 0 && k < total) g[k] = was ? 1 - i / r : i / r
    }
  }
  return g
}

export function renderLayer(data, row, blocks, blockLen, sr, volume = 1) {
  const g = rowGain(row, blocks, blockLen, sr)
  const out = new Float32Array(g.length)
  const len = data.length
  for (let i = 0; i < out.length; i++) if (g[i]) out[i] = data[i % len] * g[i] * volume
  return out
}

export function renderMix(session) {
  const { layers, song, blockLen, sr, mix } = session
  const out = new Float32Array(song.blocks * blockLen)
  for (const l of layers) {
    const row = song.rows[l.id] || []
    if (!row.some(Boolean)) continue
    const s = renderLayer(l.wet, row, song.blocks, blockLen, sr, mix[l.id]?.volume ?? 1)
    for (let i = 0; i < out.length; i++) out[i] += s[i]
  }
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  if (peak > 0.999) {
    const k = 0.95 / peak
    for (let i = 0; i < out.length; i++) out[i] *= k
  }
  return out
}

// ── REAPER ───────────────────────────────────────────────────────────────────
// Runs of consecutive "on" blocks become one item each. Every layer is phase-
// locked to the song's start, so an item starting at block b begins that far
// into its loop.
function itemsFor(row, blocks, blockLen, loopLen) {
  const out = []
  let b = 0
  while (b < blocks) {
    if (!row[b]) {
      b++
      continue
    }
    const from = b
    while (b < blocks && row[b]) b++
    out.push({ pos: from * blockLen, len: (b - from) * blockLen, soffs: (from * blockLen) % loopLen })
  }
  return out
}

const q = (s) => String(s).replace(/"/g, "'")
const sec = (frames, sr) => (frames / sr).toFixed(9)

function rppTrack({ name, file, volume, muted, items }, sr) {
  const lines = [
    '  <TRACK',
    `    NAME "${q(name)}"`,
    `    VOLPAN ${volume.toFixed(6)} 0 -1 -1 1`,
    `    MUTESOLO ${muted ? 1 : 0} 0 0`,
  ]
  for (const it of items) {
    lines.push(
      '    <ITEM',
      `      POSITION ${sec(it.pos, sr)}`,
      `      LENGTH ${sec(it.len, sr)}`,
      '      LOOP 1',
      `      FADEIN 1 ${RAMP_SEC} 0 1 0 0 0`,
      `      FADEOUT 1 ${RAMP_SEC} 0 1 0 0 0`,
      `      SOFFS ${sec(it.soffs, sr)}`,
      `      NAME "${q(name)}"`,
      '      <SOURCE WAVE',
      `        FILE "${q(file)}"`,
      '      >',
      '    >',
    )
  }
  lines.push('  >')
  return lines.join('\n')
}

export function buildRpp({ sr, bpm, bpb, tracks }) {
  return [
    '<REAPER_PROJECT 0.1 "7.0" 0',
    `  TEMPO ${(bpm || 120).toFixed(4)} ${bpb || 4} 4`,
    `  SAMPLERATE ${sr} 0 0`,
    ...tracks.map((t) => rppTrack(t, sr)),
    '>',
    '',
  ].join('\n')
}

// ── Packaging ────────────────────────────────────────────────────────────────
const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '').trim() || 'Loop'

function fileBase(l) {
  return `${String(l.slot + 1).padStart(2, '0')} ${safe(l.name)}`
}

export function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`
}

// session: { sr, bpm, bpb, blockLen, layers, mix, song }
// `extra`: more files for the zip's folder — the view adds the session, so a
// REAPER export opens in the Looper again (lib/looper/session.js).
export function reaperZip(session, { includeDi = true, extra = [] } = {}) {
  const { sr, bpm, bpb, blockLen, layers, mix, song } = session
  const dir = `Looper ${stamp()}`
  const files = []
  const tracks = []
  for (const l of layers) {
    const base = fileBase(l)
    const items = itemsFor(song.rows[l.id] || [], song.blocks, blockLen, l.wet.length)
    const volume = mix[l.id]?.volume ?? 1
    files.push({ name: `${dir}/${base}.wav`, data: wavFloat(l.wet, sr) })
    tracks.push({ name: base, file: `${base}.wav`, volume, muted: false, items })
    if (includeDi) {
      files.push({ name: `${dir}/${base} DI.wav`, data: wavFloat(l.dry, sr) })
      // The clean DI under each loop, muted, for re-amping in REAPER.
      tracks.push({ name: `${base} DI`, file: `${base} DI.wav`, volume, muted: true, items })
    }
  }
  files.push({ name: `${dir}/Looper.rpp`, data: buildRpp({ sr, bpm, bpb, tracks }) })
  files.push({ name: `${dir}/Mix.wav`, data: wavFloat(renderMix(session), sr) })
  for (const f of extra) files.push({ ...f, name: `${dir}/${f.name}` })
  return { blob: zipFiles(files), name: `${dir}.zip` }
}

export function stemsZip(session, { includeDi = true } = {}) {
  const { sr, blockLen, layers, mix, song } = session
  const dir = `Looper stems ${stamp()}`
  const files = []
  for (const l of layers) {
    const row = song.rows[l.id] || []
    const vol = mix[l.id]?.volume ?? 1
    const base = fileBase(l)
    files.push({ name: `${dir}/${base}.wav`, data: wavFloat(renderLayer(l.wet, row, song.blocks, blockLen, sr, vol), sr) })
    if (includeDi) {
      files.push({ name: `${dir}/${base} DI.wav`, data: wavFloat(renderLayer(l.dry, row, song.blocks, blockLen, sr, 1), sr) })
    }
  }
  files.push({ name: `${dir}/Mix.wav`, data: wavFloat(renderMix(session), sr) })
  return { blob: zipFiles(files), name: `${dir}.zip` }
}

export function mixWav(session) {
  return { blob: new Blob([wavFloat(renderMix(session), session.sr)], { type: 'audio/wav' }), name: `Looper mix ${stamp()}.wav` }
}

export function loopWav(layer, sr) {
  return { blob: new Blob([wavFloat(layer.wet, sr)], { type: 'audio/wav' }), name: `${fileBase(layer)}.wav` }
}

export function download({ blob, name }) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
