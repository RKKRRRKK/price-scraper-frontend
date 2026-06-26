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

export const useBreadboardStore = defineStore('breadboard', () => {
  const sheets = ref([]) // breadboard_sheets rows
  const activeSheetId = ref(null)
  const loading = ref(false)
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref(null)

  const activeSheet = computed(
    () => sheets.value.find((s) => s.id === activeSheetId.value) || null,
  )

  const saveTimers = new Map()

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

  // Update a sheet's data locally (immediate) and persist (debounced).
  function updateSheetData(id, data) {
    const sheet = sheets.value.find((s) => s.id === id)
    if (!sheet) return
    sheet.data = data
    sheet.updated_at = new Date().toISOString()
    sortSheets()
    scheduleSave(id)
  }

  function scheduleSave(id) {
    if (saveTimers.has(id)) clearTimeout(saveTimers.get(id))
    saveTimers.set(
      id,
      setTimeout(() => {
        saveTimers.delete(id)
        flushSave(id)
      }, 600),
    )
  }

  async function flushSave(id) {
    const sheet = sheets.value.find((s) => s.id === id)
    if (!sheet) return
    saving.value = true
    try {
      const { error: err } = await supabase
        .from('breadboard_sheets')
        .update({ data: sheet.data, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (err) throw err
    } catch (e) {
      console.error('[Breadboard] flushSave error:', e)
      error.value = e.message
    } finally {
      saving.value = false
    }
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
          data: JSON.parse(JSON.stringify(src.data || blankData())),
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
    for (const t of saveTimers.values()) clearTimeout(t)
    saveTimers.clear()
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
    fetchSheets,
    createSheet,
    selectSheet,
    updateSheetData,
    renameSheet,
    deleteSheet,
    duplicateSheet,
    reset,
  }
})

// Exposed for components that want a brand-new sheet shape without the store.
export { blankData }
