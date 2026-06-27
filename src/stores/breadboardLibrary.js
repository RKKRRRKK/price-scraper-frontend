import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { registerCustomParts } from '@/lib/breadboard/templates'

// User-global breadboard parts library + stock list. Unlike a sheet (which is one
// layout), the library spans every sheet — it's the set of parts the user has
// defined and what they physically have on hand. Persisted as a single row per
// user in `public.breadboard_library` (run supabase/breadboard_library_schema.sql).
export const useBreadboardLibraryStore = defineStore('breadboardLibrary', () => {
  const customParts = ref([]) // array of part definitions (see buildCustomTemplate)
  const stock = ref({}) // { [partKind]: true } — what the user has in stock
  const loaded = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref(null)

  let saveTimer = null

  // Keep templates.js's registry in sync so getTemplate/makeItem see custom parts.
  function sync() {
    registerCustomParts(customParts.value)
  }

  const inStockKinds = computed(() => Object.keys(stock.value).filter((k) => stock.value[k]))

  async function fetchLibrary() {
    if (loaded.value || loading.value) return
    const auth = useAuthStore()
    if (!auth.user) return
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('breadboard_library')
        .select('*')
        .eq('user_id', auth.user.id)
        .maybeSingle()
      if (err) throw err
      if (data) {
        customParts.value = Array.isArray(data.custom_parts) ? data.custom_parts : []
        stock.value = data.stock && typeof data.stock === 'object' ? data.stock : {}
      }
      loaded.value = true
    } catch (e) {
      console.error('[BreadboardLibrary] fetchLibrary error:', e)
      error.value = e.message
    } finally {
      // Register whatever we have (even empty) so the breadboard works regardless.
      sync()
      loading.value = false
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flushSave, 500)
  }

  async function flushSave() {
    const auth = useAuthStore()
    if (!auth.user) return
    saving.value = true
    error.value = null
    try {
      const { error: err } = await supabase
        .from('breadboard_library')
        .upsert(
          {
            user_id: auth.user.id,
            custom_parts: customParts.value,
            stock: stock.value,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
      if (err) throw err
    } catch (e) {
      console.error('[BreadboardLibrary] flushSave error:', e)
      error.value = e.message
    } finally {
      saving.value = false
    }
  }

  function addCustomPart(def) {
    customParts.value = [...customParts.value, def]
    sync()
    scheduleSave()
  }
  function updateCustomPart(kind, patch) {
    customParts.value = customParts.value.map((p) => (p.kind === kind ? { ...p, ...patch } : p))
    sync()
    scheduleSave()
  }
  function removeCustomPart(kind) {
    customParts.value = customParts.value.filter((p) => p.kind !== kind)
    if (stock.value[kind]) {
      const s = { ...stock.value }
      delete s[kind]
      stock.value = s
    }
    sync()
    scheduleSave()
  }

  function isInStock(kind) {
    return !!stock.value[kind]
  }
  function setStock(kind, inStock) {
    const s = { ...stock.value }
    if (inStock) s[kind] = true
    else delete s[kind]
    stock.value = s
    scheduleSave()
  }
  function toggleStock(kind) {
    setStock(kind, !isInStock(kind))
  }

  function reset() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    customParts.value = []
    stock.value = {}
    loaded.value = false
    loading.value = false
    saving.value = false
    error.value = null
    registerCustomParts([])
  }

  return {
    customParts,
    stock,
    inStockKinds,
    loaded,
    loading,
    saving,
    error,
    fetchLibrary,
    addCustomPart,
    updateCustomPart,
    removeCustomPart,
    isInStock,
    setStock,
    toggleStock,
    reset,
  }
})
