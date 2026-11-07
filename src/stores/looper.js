import { defineStore } from 'pinia'
import { ref, shallowRef, computed, watch, markRaw } from 'vue'
import { buildLayer, radialPeaks, peakOf } from '@/lib/looper/detect'
import { loadSession, saveSession, clearSession } from '@/lib/looper/sessionDb'

const PREFS_KEY = 'looper.prefs.v1'
export const PADS = 8

// Pad colours, in slot order. Red is kept out: it means "recording".
export const PAD_COLORS = ['#eab308', '#ec4899', '#14b8a6', '#8b5cf6', '#3b82f6', '#f97316', '#84cc16', '#06b6d4']

// Settings are per machine (which input, which channel, that interface's round
// trip), so they live in localStorage like Groovy's.
export const DEFAULT_PREFS = {
  deviceId: null,
  channelIndex: 0,
  // Auto: catch the part played twice and keep one pass of it; when nothing
  // repeated, first note → Enter.
  auto: true,
  click: false,
  bpm: 100,
  bpb: 4,
  clickLevel: 0.7,
  instrument: 'bass',
  gate: 0.008,
  sensitivity: 0.55,
  // The last sync measured or set per input device, in ms — a starting point
  // for the next session, which can always be re-set by ear.
  sync: {},
  amp: { on: true, monitor: false, gain: 1, drive: 0, compress: 0, bass: 0, mid: 0, treble: 0, level: 0.8 },
  showScale: false,
  scale: { open: true, root: 9, type: 'minorPent', labels: 'degrees', from: 0, to: 12, tuning: 'bass4' },
  includeDi: true,
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null')
    if (!saved) return structuredClone(DEFAULT_PREFS)
    return {
      ...DEFAULT_PREFS,
      ...saved,
      amp: { ...DEFAULT_PREFS.amp, ...(saved.amp || {}) },
      scale: { ...DEFAULT_PREFS.scale, ...(saved.scale || {}) },
      sync: { ...(saved.sync || {}) },
    }
  } catch {
    return structuredClone(DEFAULT_PREFS)
  }
}

// A layer as it is kept: the raw capture plus the numbers that cut it, and the
// finished loop built from those. `base` indexes raw at the region's first
// sample with no sync applied; a layer that was played along to something
// (`follow`) moves with the sync, so changing it later re-aligns old layers too.
export function makeLayer(spec, syncFrames, sr) {
  const start = spec.base + (spec.follow ? syncFrames : 0)
  const built = buildLayer(spec.raw, { len: spec.len, offset: spec.offset, start, R: spec.R }, sr)
  return Object.freeze({
    ...spec,
    raw: markRaw(spec.raw),
    wet: markRaw(built.wet),
    dry: markRaw(built.dry),
    peaks: markRaw(radialPeaks(built.wet)),
    peak: peakOf(built.wet),
  })
}

// Reactive state is a Proxy, which neither structuredClone nor IndexedDB can
// copy. Everything that goes through here is plain JSON-shaped data.
const plain = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

export const useLooperStore = defineStore('looper', () => {
  const prefs = ref(loadPrefs())

  let prefsTimer = 0
  function savePrefs(patch = {}) {
    prefs.value = { ...prefs.value, ...patch }
    clearTimeout(prefsTimer)
    prefsTimer = setTimeout(() => {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value))
      } catch {
        /* private mode or a full quota */
      }
    }, 250)
  }
  const saveAmp = (patch) => savePrefs({ amp: { ...prefs.value.amp, ...patch } })
  const saveScale = (patch) => savePrefs({ scale: { ...prefs.value.scale, ...patch } })

  // ── Session ─────────────────────────────────────────────────────────────
  // master: { sr, len, bpm, bpb, unit } — the first loop sets it, every later
  // layer is cut to its grid. unit is a bar when the tempo is known, else the
  // whole loop.
  const master = ref(null)
  const layers = shallowRef(Array(PADS).fill(null))
  const mix = ref({})
  const song = ref({ blocks: 4, rows: {}, touched: false })
  const syncMs = ref(null)
  const ready = ref(false)

  const filled = computed(() => layers.value.filter(Boolean))
  const isEmpty = computed(() => !filled.value.length)

  // ── Undo ────────────────────────────────────────────────────────────────
  // Snapshots are cheap: layers are frozen, so a snapshot holds references.
  // Volume and mute are left out on purpose — they are played, not edited.
  const past = shallowRef([])
  const future = shallowRef([])
  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  function snap() {
    return { master: master.value, layers: layers.value.slice(), song: plain(song.value) }
  }
  function restore(s) {
    master.value = s.master
    layers.value = s.layers.slice()
    song.value = s.song
  }
  function remember() {
    past.value = [...past.value.slice(-39), snap()]
    future.value = []
  }
  function undo() {
    if (!past.value.length) return false
    future.value = [...future.value, snap()]
    const s = past.value[past.value.length - 1]
    past.value = past.value.slice(0, -1)
    restore(s)
    return true
  }
  function redo() {
    if (!future.value.length) return false
    past.value = [...past.value, snap()]
    const s = future.value[future.value.length - 1]
    future.value = future.value.slice(0, -1)
    restore(s)
    return true
  }

  // ── Song ────────────────────────────────────────────────────────────────
  // Until it is edited, the arrangement is generated: layers come in one
  // block at a time in the order they were recorded, then everything plays
  // for two more. Muted layers sit it out. Once edited, a new layer joins
  // every block and nothing is regenerated.
  function autoSong() {
    const order = filled.value.filter((l) => !mix.value[l.id]?.muted).sort((a, b) => a.createdAt - b.createdAt)
    const blocks = Math.max(4, order.length + 2)
    const rows = {}
    for (const l of filled.value) rows[l.id] = Array(blocks).fill(false)
    order.forEach((l, k) => {
      for (let b = k; b < blocks; b++) rows[l.id][b] = true
    })
    song.value = { blocks, rows, touched: false }
  }

  function syncSongRows() {
    if (!song.value.touched) return autoSong()
    const rows = {}
    for (const l of filled.value) rows[l.id] = song.value.rows[l.id] || Array(song.value.blocks).fill(true)
    song.value = { ...song.value, rows }
  }

  // Called once at the start of a paint gesture, so the whole drag is one undo.
  function beginSongEdit() {
    remember()
  }

  function setCell(id, b, on) {
    const row = song.value.rows[id]
    if (!row || row[b] === on) return
    const next = row.slice()
    next[b] = on
    song.value = { ...song.value, rows: { ...song.value.rows, [id]: next }, touched: true }
  }

  function addBlock() {
    remember()
    const rows = {}
    for (const [id, row] of Object.entries(song.value.rows)) rows[id] = [...row, row[row.length - 1] ?? true]
    song.value = { blocks: song.value.blocks + 1, rows, touched: true }
  }

  function removeBlock(b) {
    if (song.value.blocks <= 1) return
    remember()
    const rows = {}
    for (const [id, row] of Object.entries(song.value.rows)) rows[id] = row.filter((_, i) => i !== b)
    song.value = { blocks: song.value.blocks - 1, rows, touched: true }
  }

  // ── Layers ──────────────────────────────────────────────────────────────
  // A take recorded over a filled pad replaces it and inherits its volume and
  // its row in the song; a fresh id keeps the old take whole for undo.
  function addLayer(layer, masterInfo = null) {
    remember()
    if (masterInfo) master.value = masterInfo
    const old = layers.value[layer.slot]
    const next = layers.value.slice()
    next[layer.slot] = layer
    layers.value = next
    if (!mix.value[layer.id]) {
      mix.value = { ...mix.value, [layer.id]: { volume: (old && mix.value[old.id]?.volume) ?? 1, muted: false, solo: false } }
    }
    if (old && song.value.rows[old.id]) song.value = { ...song.value, rows: { ...song.value.rows, [layer.id]: song.value.rows[old.id] } }
    syncSongRows()
  }

  // A rebuilt layer (tail captured, sync changed): same take, no undo step.
  function replaceLayer(layer) {
    const next = layers.value.map((l) => (l && l.id === layer.id ? layer : l))
    layers.value = next
    past.value = past.value.map((s) => ({ ...s, layers: s.layers.map((l) => (l && l.id === layer.id ? layer : l)) }))
    future.value = future.value.map((s) => ({ ...s, layers: s.layers.map((l) => (l && l.id === layer.id ? layer : l)) }))
  }

  function clearLayer(slot) {
    if (!layers.value[slot]) return
    remember()
    const next = layers.value.slice()
    next[slot] = null
    layers.value = next
    if (!next.some(Boolean)) master.value = null
    syncSongRows()
  }

  function clearAll() {
    if (isEmpty.value) return
    remember()
    layers.value = Array(PADS).fill(null)
    master.value = null
    song.value = { blocks: 4, rows: {}, touched: false }
  }

  function rename(id, name) {
    const l = filled.value.find((x) => x.id === id)
    if (!l || !name.trim()) return
    replaceLayer(Object.freeze({ ...l, name: name.trim() }))
  }

  function setVolume(id, v) {
    mix.value = { ...mix.value, [id]: { ...(mix.value[id] || { muted: false }), volume: v } }
  }

  function toggleMute(id) {
    const m = mix.value[id] || { volume: 1, muted: false }
    mix.value = { ...mix.value, [id]: { ...m, muted: !m.muted } }
    if (!song.value.touched) autoSong()
  }

  // Solo is a listening aid like mute: it never touches the song.
  function toggleSolo(id) {
    const m = mix.value[id] || { volume: 1, muted: false }
    mix.value = { ...mix.value, [id]: { ...m, solo: !m.solo } }
  }

  // Re-read the detected tempo an octave up or down. Only the grid's name
  // changes — the loop keeps its length — so halving is only offered when the
  // loop is an even number of bars.
  function scaleTempo(f) {
    const m = master.value
    if (!m?.bpm) return
    const bpm = m.bpm * f
    const unit = Math.round((m.bpb * 60 * m.sr) / bpm)
    if (Math.abs(m.len / unit - Math.round(m.len / unit)) > 0.01) return
    master.value = { ...m, bpm, unit, bars: Math.round(m.len / unit) }
  }

  // ── Persistence ─────────────────────────────────────────────────────────
  // The whole session as plain data: what this browser keeps (IndexedDB) and
  // what a saved file holds (lib/looper/session.js). Each layer is its raw
  // capture plus the numbers that cut it; makeLayer rebuilds the rest.
  function sessionData() {
    return {
      v: 1,
      master: plain(master.value),
      syncMs: syncMs.value,
      mix: plain(mix.value),
      song: plain(song.value),
      layers: filled.value.map((l) => ({
        id: l.id,
        slot: l.slot,
        name: l.name,
        instrument: l.instrument,
        createdAt: l.createdAt,
        len: l.len,
        offset: l.offset,
        R: l.R,
        base: l.base,
        follow: l.follow,
        raw: { dry: l.raw.dry, wet: l.raw.wet },
      })),
    }
  }

  let saveTimer = 0
  function persist() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (isEmpty.value) return clearSession()
      saveSession(sessionData()).catch((e) => console.warn('[Looper] could not save the session', e))
    }, 800)
  }
  watch([master, layers, mix, song, syncMs], persist)

  // Replace the session with saved data. Opened over one in progress, it is
  // one undo step, like New session; the mix merges so undo finds the old
  // layers' volumes still there.
  function applySession(data, { undoable = false } = {}) {
    const sr = data.master?.sr || 48000
    const sync = Math.round(((data.syncMs || 0) / 1000) * sr)
    const next = Array(PADS).fill(null)
    for (const spec of data.layers) next[spec.slot] = makeLayer(spec, sync, sr)
    if (undoable) remember()
    master.value = data.master
    syncMs.value = data.syncMs ?? null
    mix.value = undoable ? { ...mix.value, ...(data.mix || {}) } : data.mix || {}
    song.value = data.song || { blocks: 4, rows: {}, touched: false }
    layers.value = next
    syncSongRows()
  }

  async function restoreSaved() {
    const data = await loadSession()
    if (data?.v === 1 && data.layers?.length && isEmpty.value) applySession(data)
    ready.value = true
  }
  restoreSaved()

  return {
    prefs,
    savePrefs,
    saveAmp,
    saveScale,
    master,
    layers,
    filled,
    isEmpty,
    mix,
    song,
    syncMs,
    ready,
    canUndo,
    canRedo,
    undo,
    redo,
    addLayer,
    replaceLayer,
    clearLayer,
    clearAll,
    rename,
    setVolume,
    toggleMute,
    toggleSolo,
    scaleTempo,
    beginSongEdit,
    setCell,
    addBlock,
    removeBlock,
    autoSong,
    sessionData,
    applySession,
  }
})
