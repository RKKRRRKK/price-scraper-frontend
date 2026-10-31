import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { BREADBOARDS } from '@/lib/breadboard/templates'

// A fresh sheet: one breadboard of the chosen size, no parts, no wires.
function blankData(type = 'half') {
  const t = BREADBOARDS[type] ? type : 'half'
  return {
    breadboards: [{ id: 'bb1', type: t, x: 24, y: 150 }],
    items: [],
    wires: [],
  }
}

// Deep copy of a sheet's data with the arrays the editor relies on filled in.
function normalizedCopy(data) {
  const d = JSON.parse(JSON.stringify(data || blankData()))
  d.breadboards = d.breadboards?.length ? d.breadboards : [{ id: 'bb1', type: 'half', x: 24, y: 150 }]
  d.items = d.items || []
  d.wires = d.wires || []
  return d
}

export const useBreadboardStore = defineStore('breadboard', () => {
  const sheets = ref([]) // breadboard_sheets rows — `data` is always the saved (Supabase) state
  const activeSheetId = ref(null)
  const loading = ref(false)
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref(null)

  // Edits land in a per-sheet draft and only reach Supabase on an explicit save.
  // `baselines` holds the JSON of what's saved, so "unsaved changes" is a string compare.
  const drafts = ref({}) // sheetId → working copy
  const baselines = ref({}) // sheetId → JSON of the saved data

  const activeSheet = computed(
    () => sheets.value.find((s) => s.id === activeSheetId.value) || null,
  )

  function isDirty(id) {
    const d = drafts.value[id]
    return !!d && JSON.stringify(d) !== baselines.value[id]
  }
  const dirtyIds = computed(() => Object.keys(drafts.value).filter(isDirty))

  // The working copy for a sheet, created from the saved data on first open.
  function openDraft(id) {
    const sheet = sheets.value.find((s) => s.id === id)
    if (!sheet) return null
    if (!drafts.value[id]) {
      const d = normalizedCopy(sheet.data)
      baselines.value[id] = JSON.stringify(d)
      drafts.value[id] = d
    }
    return drafts.value[id]
  }

  // Swap a sheet's whole working copy (undo/redo, AI build).
  function setDraft(id, data) {
    if (!(id in baselines.value)) openDraft(id)
    drafts.value[id] = data
    return drafts.value[id]
  }

  async function fetchSheets() {
    if (loaded.value || loading.value) return
    const auth = useAuthStore()
    if (!auth.user) return

    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('breadboard_sheets')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('updated_at', { ascending: false })
      if (err) throw err
      sheets.value = data || []
      loaded.value = true
      if (!activeSheetId.value && sheets.value.length) activeSheetId.value = sheets.value[0].id
    } catch (e) {
      console.error('[Breadboard] fetchSheets error:', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function createSheet({ name, type }) {
    const auth = useAuthStore()
    if (!auth.user) return
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('breadboard_sheets')
        .insert({
          user_id: auth.user.id,
          name: (name || 'Untitled').trim(),
          data: blankData(type),
        })
        .select('*')
        .single()
      if (err) throw err
      sheets.value.unshift(data)
      activeSheetId.value = data.id
      return data
    } catch (e) {
      console.error('[Breadboard] createSheet error:', e)
      error.value = e.message
      throw e
    }
  }

  function selectSheet(id) {
    activeSheetId.value = id
  }

  // Write a sheet's draft to Supabase. Edits made while the request is in flight
  // stay unsaved, since the baseline is the snapshot that was actually sent.
  async function saveSheet(id) {
    const sheet = sheets.value.find((s) => s.id === id)
    const draft = drafts.value[id]
    if (!sheet || !draft) return
    const json = JSON.stringify(draft)
    const now = new Date().toISOString()
    saving.value = true
    error.value = null
    try {
      const { error: err } = await supabase
        .from('breadboard_sheets')
        .update({ data: JSON.parse(json), updated_at: now })
        .eq('id', id)
      if (err) throw err
      sheet.data = JSON.parse(json)
      sheet.updated_at = now
      baselines.value[id] = json
      sortSheets()
    } catch (e) {
      console.error('[Breadboard] saveSheet error:', e)
      error.value = e.message
      throw e
    } finally {
      saving.value = false
    }
  }

  function dropDraft(id) {
    delete drafts.value[id]
    delete baselines.value[id]
  }

  async function renameSheet(id, name) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('breadboard_sheets')
        .update({ name: (name || 'Untitled').trim(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const idx = sheets.value.findIndex((s) => s.id === id)
      if (idx !== -1) sheets.value[idx] = data
      sortSheets()
      return data
    } catch (e) {
      console.error('[Breadboard] renameSheet error:', e)
      error.value = e.message
      throw e
    }
  }

  async function deleteSheet(id) {
    error.value = null
    try {
      const { error: err } = await supabase.from('breadboard_sheets').delete().eq('id', id)
      if (err) throw err
      sheets.value = sheets.value.filter((s) => s.id !== id)
      dropDraft(id)
      if (activeSheetId.value === id) {
        activeSheetId.value = sheets.value[0]?.id || null
      }
    } catch (e) {
      console.error('[Breadboard] deleteSheet error:', e)
      error.value = e.message
      throw e
    }
  }

  // Duplicate a sheet (handy for trying variations of a build).
  async function duplicateSheet(id) {
    const auth = useAuthStore()
    const src = sheets.value.find((s) => s.id === id)
    if (!auth.user || !src) return
    try {
      const { data, error: err } = await supabase
        .from('breadboard_sheets')
        .insert({
          user_id: auth.user.id,
          name: `${src.name} copy`,
          data: normalizedCopy(drafts.value[id] || src.data),
        })
        .select('*')
        .single()
      if (err) throw err
      sheets.value.unshift(data)
      activeSheetId.value = data.id
      return data
    } catch (e) {
      console.error('[Breadboard] duplicateSheet error:', e)
      error.value = e.message
      throw e
    }
  }

  function sortSheets() {
    sheets.value.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }

  function reset() {
    drafts.value = {}
    baselines.value = {}
    sheets.value = []
    activeSheetId.value = null
    loaded.value = false
    loading.value = false
    saving.value = false
    error.value = null
  }

  return {
    sheets,
    activeSheetId,
    activeSheet,
    loading,
    loaded,
    saving,
    error,
    drafts,
    dirtyIds,
    isDirty,
    openDraft,
    setDraft,
    saveSheet,
    fetchSheets,
    createSheet,
    selectSheet,
    renameSheet,
    deleteSheet,
    duplicateSheet,
    reset,
  }
})

// Exposed for components that want a brand-new sheet shape without the store.
export { blankData }
