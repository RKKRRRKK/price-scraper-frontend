import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const BUCKET = 'bawu'

// A fresh score: nothing transcribed yet.
function blankData() {
  return { key: 'F', bpm: 80, timeSig: '4/4', lines: [] }
}

export const useBawuStore = defineStore('bawu', () => {
  const scores = ref([]) // bawu_scores rows (catalogue)
  const folders = ref([]) // bawu_folders rows
  const activeScoreId = ref(null)
  const loading = ref(false)
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref(null)

  const activeScore = computed(
    () => scores.value.find((s) => s.id === activeScoreId.value) || null,
  )

  const saveTimers = new Map()

  // ── Scores ──────────────────────────────────────────────────────────────
  async function fetchScores() {
    if (loaded.value || loading.value) return
    const auth = useAuthStore()
    if (!auth.user) return

    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('bawu_scores')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('updated_at', { ascending: false })
      if (err) throw err
      scores.value = data || []
      loaded.value = true
    } catch (e) {
      console.error('[Bawu] fetchScores error:', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
    // Folders are optional; a failure here must not break the catalogue.
    await fetchFolders()
  }

  // Create a score. When the conversion came from a picture, `imageBlob` is
  // uploaded to the private bucket so every conversion is stored with its
  // original image; `aiMeta` records model + usage + raw reply.
  async function createScore({ name, folderId = null, source = 'manual', data = null, imageBlob = null, aiMeta = null } = {}) {
    const auth = useAuthStore()
    if (!auth.user) return
    error.value = null
    try {
      let image_path = null
      const id = crypto.randomUUID()
      // Record the key the score was born in so we can always offer a way back
      // to it after transposing. Immutable: the key buttons never touch origKey.
      const finalData = data || blankData()
      if (!finalData.origKey) finalData.origKey = finalData.key || 'F'
      if (imageBlob) {
        const ext = imageBlob.type === 'image/png' ? 'png' : 'jpg'
        image_path = `${auth.user.id}/${id}.${ext}`
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(image_path, imageBlob, { contentType: imageBlob.type || 'image/jpeg', upsert: false })
        if (upErr) throw upErr
      }
      const { data: row, error: err } = await supabase
        .from('bawu_scores')
        .insert({
          id,
          user_id: auth.user.id,
          name: (name || 'Untitled score').trim(),
          folder_id: folderId,
          source,
          data: finalData,
          image_path,
          ai_meta: aiMeta,
        })
        .select('*')
        .single()
      if (err) {
        if (image_path) await supabase.storage.from(BUCKET).remove([image_path])
        throw err
      }
      scores.value.unshift(row)
      activeScoreId.value = row.id
      return row
    } catch (e) {
      console.error('[Bawu] createScore error:', e)
      error.value = e.message
      throw e
    }
  }

  function selectScore(id) {
    activeScoreId.value = id
  }

  // Update a score's data locally (immediate) and persist (debounced).
  function updateScoreData(id, data) {
    const score = scores.value.find((s) => s.id === id)
    if (!score) return
    score.data = data
    score.updated_at = new Date().toISOString()
    sortScores()
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
    const score = scores.value.find((s) => s.id === id)
    if (!score) return
    saving.value = true
    try {
      const { error: err } = await supabase
        .from('bawu_scores')
        .update({ data: score.data, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (err) throw err
    } catch (e) {
      console.error('[Bawu] flushSave error:', e)
      error.value = e.message
    } finally {
      saving.value = false
    }
  }

  async function updateScore(id, updates) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('bawu_scores')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const idx = scores.value.findIndex((s) => s.id === id)
      if (idx !== -1) scores.value[idx] = data
      sortScores()
      return data
    } catch (e) {
      console.error('[Bawu] updateScore error:', e)
      error.value = e.message
      throw e
    }
  }

  function renameScore(id, name) {
    return updateScore(id, { name: (name || 'Untitled score').trim(), updated_at: new Date().toISOString() })
  }

  function moveScoreToFolder(scoreId, folderId) {
    return updateScore(scoreId, { folder_id: folderId })
  }

  async function deleteScore(id) {
    error.value = null
    try {
      const score = scores.value.find((s) => s.id === id)
      if (score?.image_path) {
        const { error: stErr } = await supabase.storage.from(BUCKET).remove([score.image_path])
        if (stErr) console.warn('[Bawu] storage cleanup error:', stErr)
      }
      const { error: err } = await supabase.from('bawu_scores').delete().eq('id', id)
      if (err) throw err
      scores.value = scores.value.filter((s) => s.id !== id)
      if (activeScoreId.value === id) activeScoreId.value = null
    } catch (e) {
      console.error('[Bawu] deleteScore error:', e)
      error.value = e.message
      throw e
    }
  }

  // Short-lived signed URL for a score's original picture.
  async function getImageUrl(image_path, expiresIn = 600) {
    const { data, error: err } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(image_path, expiresIn)
    if (err) {
      console.error('[Bawu] getImageUrl error:', err)
      throw err
    }
    return data.signedUrl
  }

  function sortScores() {
    scores.value.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }

  // ── Folders ─────────────────────────────────────────────────────────────
  async function fetchFolders() {
    const auth = useAuthStore()
    if (!auth.user) return
    try {
      const { data, error: err } = await supabase
        .from('bawu_folders')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('name', { ascending: true })
      if (err) throw err
      folders.value = data || []
    } catch (e) {
      console.error('[Bawu] fetchFolders error:', e)
    }
  }

  async function createFolder(name) {
    const auth = useAuthStore()
    if (!auth.user || !name.trim()) return
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('bawu_folders')
        .insert({ user_id: auth.user.id, name: name.trim() })
        .select('*')
        .single()
      if (err) throw err
      folders.value = [...folders.value, data].sort((a, b) => a.name.localeCompare(b.name))
      return data
    } catch (e) {
      console.error('[Bawu] createFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function renameFolder(id, name) {
    if (!name.trim()) return
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('bawu_folders')
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const idx = folders.value.findIndex((f) => f.id === id)
      if (idx !== -1) folders.value[idx] = data
      folders.value = [...folders.value].sort((a, b) => a.name.localeCompare(b.name))
      return data
    } catch (e) {
      console.error('[Bawu] renameFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function deleteFolder(id) {
    error.value = null
    try {
      // scores.folder_id is set to null server-side via the FK (on delete set null)
      const { error: err } = await supabase.from('bawu_folders').delete().eq('id', id)
      if (err) throw err
      folders.value = folders.value.filter((f) => f.id !== id)
      scores.value = scores.value.map((s) => (s.folder_id === id ? { ...s, folder_id: null } : s))
    } catch (e) {
      console.error('[Bawu] deleteFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  function reset() {
    for (const t of saveTimers.values()) clearTimeout(t)
    saveTimers.clear()
    scores.value = []
    folders.value = []
    activeScoreId.value = null
    loaded.value = false
    loading.value = false
    saving.value = false
    error.value = null
  }

  return {
    scores,
    folders,
    activeScoreId,
    activeScore,
    loading,
    loaded,
    saving,
    error,
    fetchScores,
    createScore,
    selectScore,
    updateScoreData,
    updateScore,
    renameScore,
    moveScoreToFolder,
    deleteScore,
    getImageUrl,
    fetchFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    reset,
  }
})

export { blankData }
