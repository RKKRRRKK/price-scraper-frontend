import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import {
  listLocalTakes,
  saveLocalTake,
  updateLocalTake,
  getLocalAudio,
  deleteLocalTake,
} from '@/lib/groovy/localTakes'

const BUCKET = 'groovy'
const PREFS_KEY = 'groovy.prefs.v1'

// Practice settings live in localStorage rather than the database: they are
// per-machine (which input, how much latency that interface adds) and there is
// no sense syncing one desk's calibration to another.
export const DEFAULT_PREFS = {
  bpm: 90,
  meterId: '4/4',
  subdiv: 2,
  clickOn: true,
  clickSubdivisions: false,
  drumsOn: false,
  patternId: null,
  clickLevel: 0.8,
  drumLevel: 0.7,
  toleranceMs: 25,
  countInBars: 1,
  keepAudio: false,
  // Input + detection
  deviceId: null,
  channelIndex: 0,
  sensitivity: 0.55,
  gate: 0.008,
  refractoryMs: 60,
  // System latency, measured each session. Deliberately NOT remembered across
  // loads — see loadPrefs().
  offsetMs: 0,
  // Amp
  amp: { gain: 1, drive: 0, bass: 0, mid: 0, treble: 0, level: 0.8, compress: 0, monitor: false },
  // Look for the Windows native monitor helper (lib/groovy/nativeMonitor.js).
  nativeHelper: true,
  // Roll
  windowBars: 2,
  tunerOpen: false,
  // Scale map under the roll. root is a pitch class (0 = C); from/to are frets.
  scale: { open: true, root: 9, type: 'minorPent', labels: 'degrees', from: 0, to: 12, tuning: 'bass4' },
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const saved = JSON.parse(raw)
    return {
      ...DEFAULT_PREFS,
      ...saved,
      amp: { ...DEFAULT_PREFS.amp, ...(saved.amp || {}) },
      scale: { ...DEFAULT_PREFS.scale, ...(saved.scale || {}) },
      // The offset is the one setting that never survives a reload. The
      // browser renegotiates its buffer depth every time the input stream
      // opens, so a remembered number describes a path that no longer exists
      // — and it looks exactly as trustworthy as a real one. Starting at zero
      // makes "measure it" the obvious first move instead of a warning nobody
      // reads.
      offsetMs: 0,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export const useGroovyStore = defineStore('groovy', () => {
  // Newest first, local and uploaded together. Each row is a `groovy_takes`
  // row plus `where: 'local' | 'cloud'`; local rows also carry `has_audio`,
  // since their audio sits in IndexedDB rather than at an `audio_path`.
  const takes = ref([])
  const uploadingIds = ref([])
  const loading = ref(false)
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref(null)
  const prefs = ref(loadPrefs())

  // Takes chosen for side-by-side comparison. Three is the cap: past three
  // series the compare chart's colours stop being reliably distinguishable.
  //
  // Fixed slots rather than a list, so dropping the second take does not slide
  // the third into its colour. A reader who learned "the loud one is blue"
  // keeps that as the selection changes underneath them.
  const MAX_COMPARE = 3
  const compareIds = ref(new Array(MAX_COMPARE).fill(null))

  const compared = computed(() =>
    compareIds.value.map((id, slot) =>
      id ? { slot, take: takes.value.find((t) => t.id === id) || null } : null,
    ),
  )

  const compareCount = computed(() => compareIds.value.filter(Boolean).length)

  // Dragging an amp slider fires this sixty times a second; the in-memory value
  // updates immediately and the write to disk waits for the drag to finish.
  let prefsTimer = 0
  function savePrefs(patch = {}) {
    prefs.value = { ...prefs.value, ...patch }
    clearTimeout(prefsTimer)
    prefsTimer = setTimeout(() => {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value))
      } catch {
        /* private mode, or a full quota — practice still works */
      }
    }, 250)
  }

  function saveAmpPrefs(patch = {}) {
    savePrefs({ amp: { ...prefs.value.amp, ...patch } })
  }

  function saveScalePrefs(patch = {}) {
    savePrefs({ scale: { ...prefs.value.scale, ...patch } })
  }

  // ── Takes ───────────────────────────────────────────────────────────────
  // Takes are saved in this browser (lib/groovy/localTakes.js) and reach
  // Supabase only through uploadTake(), which is always a deliberate click.
  // Reading the cloud list is the one Supabase call made on its own.
  function sortTakes(rows) {
    return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  }

  function replaceTake(id, row) {
    const idx = takes.value.findIndex((t) => t.id === id)
    if (idx !== -1) takes.value[idx] = row
  }

  async function fetchTakes() {
    if (loaded.value || loading.value) return
    loading.value = true
    error.value = null
    let local = []
    let cloud = []
    try {
      local = (await listLocalTakes()).map((r) => ({ ...r, where: 'local' }))
    } catch (e) {
      console.error('[Groovy] local takes error:', e)
      error.value = e.message
    }
    const auth = useAuthStore()
    if (auth.user) {
      try {
        const { data, error: err } = await supabase
          .from('groovy_takes')
          .select('*')
          .eq('user_id', auth.user.id)
          .order('created_at', { ascending: false })
        if (err) throw err
        cloud = (data || []).map((r) => ({ ...r, where: 'cloud' }))
      } catch (e) {
        console.error('[Groovy] fetchTakes error:', e)
        error.value = e.message
      }
    }
    takes.value = sortTakes([...local, ...cloud])
    loaded.value = true
    loading.value = false
  }

  // `audioBlob` is optional — the "keep audio" toggle on the transport.
  async function createTake({ name, settings, hits, stats, durationMs, audioBlob = null } = {}) {
    error.value = null
    saving.value = true
    try {
      const row = {
        id: crypto.randomUUID(),
        name: (name || 'Untitled take').trim(),
        settings: settings || {},
        hits: hits || [],
        stats: stats || {},
        duration_ms: Math.round(durationMs || 0),
        audio_path: null,
        has_audio: !!audioBlob,
        created_at: new Date().toISOString(),
      }
      await saveLocalTake(row, audioBlob)
      const shown = { ...row, where: 'local' }
      takes.value.unshift(shown)
      return shown
    } catch (e) {
      console.error('[Groovy] createTake error:', e)
      error.value = e.message
      throw e
    } finally {
      saving.value = false
    }
  }

  // Move a local take to Supabase: audio to the private bucket under
  // <user_id>/<take_id>.<ext>, the row to groovy_takes with its original id and
  // timestamp, and only then off this computer. A failure at any step leaves
  // the local copy exactly as it was.
  async function uploadTake(id) {
    const take = takes.value.find((t) => t.id === id)
    if (!take || take.where !== 'local') return null
    const auth = useAuthStore()
    if (!auth.user) throw new Error('signed-out')
    if (uploadingIds.value.includes(id)) return null
    uploadingIds.value = [...uploadingIds.value, id]
    error.value = null
    let audio_path = null
    try {
      const blob = take.has_audio ? await getLocalAudio(id) : null
      if (blob) {
        const type = blob.type || 'audio/wav'
        const ext = type.includes('wav') ? 'wav' : type.includes('mp4') ? 'm4a' : 'webm'
        audio_path = `${auth.user.id}/${id}.${ext}`
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(audio_path, blob, { contentType: type, upsert: true })
        if (upErr) throw upErr
      }
      const { data: row, error: err } = await supabase
        .from('groovy_takes')
        .insert({
          id,
          user_id: auth.user.id,
          name: take.name,
          settings: take.settings || {},
          hits: take.hits || [],
          stats: take.stats || {},
          duration_ms: take.duration_ms || 0,
          audio_path,
          created_at: take.created_at,
        })
        .select('*')
        .single()
      if (err) {
        if (audio_path) await supabase.storage.from(BUCKET).remove([audio_path])
        throw err
      }
      await deleteLocalTake(id).catch((e) => console.warn('[Groovy] local cleanup error:', e))
      const shown = { ...row, where: 'cloud' }
      replaceTake(id, shown)
      return shown
    } catch (e) {
      console.error('[Groovy] uploadTake error:', e)
      error.value = e.message
      throw e
    } finally {
      uploadingIds.value = uploadingIds.value.filter((x) => x !== id)
    }
  }

  async function renameTake(id, name) {
    error.value = null
    const take = takes.value.find((t) => t.id === id)
    if (!take) return null
    const clean = (name || 'Untitled take').trim()
    try {
      if (take.where === 'local') {
        const row = { ...take, name: clean }
        delete row.where
        await updateLocalTake(row)
        const shown = { ...take, name: clean }
        replaceTake(id, shown)
        return shown
      }
      const { data, error: err } = await supabase
        .from('groovy_takes')
        .update({ name: clean })
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const shown = { ...data, where: 'cloud' }
      replaceTake(id, shown)
      return shown
    } catch (e) {
      console.error('[Groovy] renameTake error:', e)
      error.value = e.message
      throw e
    }
  }

  async function deleteTake(id) {
    error.value = null
    const take = takes.value.find((t) => t.id === id)
    if (!take) return
    try {
      if (take.where === 'local') {
        await deleteLocalTake(id)
      } else {
        if (take.audio_path) {
          const { error: stErr } = await supabase.storage.from(BUCKET).remove([take.audio_path])
          if (stErr) console.warn('[Groovy] storage cleanup error:', stErr)
        }
        const { error: err } = await supabase.from('groovy_takes').delete().eq('id', id)
        if (err) throw err
      }
      takes.value = takes.value.filter((t) => t.id !== id)
      const at = compareIds.value.indexOf(id)
      if (at !== -1) compareIds.value[at] = null
    } catch (e) {
      console.error('[Groovy] deleteTake error:', e)
      error.value = e.message
      throw e
    }
  }

  // A take's recording as an ArrayBuffer ready for decodeAudioData, wherever it
  // lives, or null when it kept none.
  async function getTakeAudio(take) {
    if (!take) return null
    if (take.where === 'local') {
      if (!take.has_audio) return null
      const blob = await getLocalAudio(take.id)
      return blob ? blob.arrayBuffer() : null
    }
    if (!take.audio_path) return null
    const url = await getAudioUrl(take.audio_path)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Audio download failed (${res.status})`)
    return res.arrayBuffer()
  }

  async function getAudioUrl(audio_path, expiresIn = 600) {
    const { data, error: err } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(audio_path, expiresIn)
    if (err) {
      console.error('[Groovy] getAudioUrl error:', err)
      throw err
    }
    return data.signedUrl
  }

  // ── Compare selection ───────────────────────────────────────────────────
  function toggleCompare(id) {
    const at = compareIds.value.indexOf(id)
    if (at !== -1) {
      compareIds.value[at] = null
      return
    }
    const free = compareIds.value.indexOf(null)
    // When all three are taken the first one gives way; the other two keep both
    // their take and their colour.
    compareIds.value[free === -1 ? 0 : free] = id
  }

  function clearCompare() {
    compareIds.value = new Array(MAX_COMPARE).fill(null)
  }

  function reset() {
    takes.value = []
    compareIds.value = new Array(MAX_COMPARE).fill(null)
    loaded.value = false
    loading.value = false
    saving.value = false
    error.value = null
  }

  return {
    takes,
    uploadingIds,
    loading,
    loaded,
    saving,
    error,
    prefs,
    compareIds,
    compared,
    compareCount,
    MAX_COMPARE,
    savePrefs,
    saveAmpPrefs,
    saveScalePrefs,
    fetchTakes,
    createTake,
    uploadTake,
    renameTake,
    deleteTake,
    getTakeAudio,
    getAudioUrl,
    toggleCompare,
    clearCompare,
    reset,
  }
})
