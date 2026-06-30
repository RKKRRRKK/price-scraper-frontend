import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

// A fresh board: empty surface. The whole board lives in `data` as JSONB.
function blankData() {
  return { elements: [], arrows: [], comments: [] }
}

export const useCanvyStore = defineStore('canvy', () => {
  const boards = ref([])             // canvy_boards rows (catalogue)
  const folders = ref([])            // canvy_folders rows
  const activeBoardId = ref(null)
  const loading = ref(false)
  const loaded = ref(false)
  const saving = ref(false)
  const error = ref(null)

  const activeBoard = computed(
    () => boards.value.find((b) => b.id === activeBoardId.value) || null,
  )

  const saveTimers = new Map()

  // ── Boards ──────────────────────────────────────────────────────────────
  async function fetchBoards() {
    if (loaded.value || loading.value) return
    const auth = useAuthStore()
    if (!auth.user) return

    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('canvy_boards')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('updated_at', { ascending: false })
      if (err) throw err
      boards.value = data || []
      loaded.value = true
    } catch (e) {
      console.error('[Canvy] fetchBoards error:', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
    // Folders are optional; a failure here (e.g. table not yet created) must not
    // break the catalogue, so load them separately and swallow errors.
    await fetchFolders()
  }

  async function createBoard({ name, folderId = null } = {}) {
    const auth = useAuthStore()
    if (!auth.user) return
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('canvy_boards')
        .insert({
          user_id: auth.user.id,
          name: (name || 'Untitled board').trim(),
          folder_id: folderId,
          data: blankData(),
          branch_data: blankData(),
        })
        .select('*')
        .single()
      if (err) throw err
      boards.value.unshift(data)
      activeBoardId.value = data.id
      return data
    } catch (e) {
      console.error('[Canvy] createBoard error:', e)
      error.value = e.message
      throw e
    }
  }

  function selectBoard(id) {
    activeBoardId.value = id
  }

  // Update a board's data locally (immediate) and persist (debounced).
  // `view` selects which copy to write: 'main' (the stable `data`) or 'branch'.
  function updateBoardData(id, data, view = 'main') {
    const board = boards.value.find((b) => b.id === id)
    if (!board) return
    if (view === 'branch') board.branch_data = data
    else board.data = data
    board.updated_at = new Date().toISOString()
    sortBoards()
    scheduleSave(id)
  }

  // Merge the branch into main: main takes the branch's content, branch resets to
  // blank. Persisted immediately (not debounced).
  async function mergeBranch(id) {
    const board = boards.value.find((b) => b.id === id)
    if (!board) return
    const merged = JSON.parse(JSON.stringify(board.branch_data || blankData()))
    board.data = merged
    board.branch_data = blankData()
    board.updated_at = new Date().toISOString()
    sortBoards()
    return updateBoard(id, {
      data: board.data,
      branch_data: board.branch_data,
      updated_at: board.updated_at,
    })
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
    const board = boards.value.find((b) => b.id === id)
    if (!board) return
    saving.value = true
    try {
      const { error: err } = await supabase
        .from('canvy_boards')
        .update({
          data: board.data,
          branch_data: board.branch_data ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (err) throw err
    } catch (e) {
      console.error('[Canvy] flushSave error:', e)
      error.value = e.message
    } finally {
      saving.value = false
    }
  }

  async function updateBoard(id, updates) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('canvy_boards')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const idx = boards.value.findIndex((b) => b.id === id)
      if (idx !== -1) boards.value[idx] = data
      sortBoards()
      return data
    } catch (e) {
      console.error('[Canvy] updateBoard error:', e)
      error.value = e.message
      throw e
    }
  }

  function renameBoard(id, name) {
    return updateBoard(id, { name: (name || 'Untitled board').trim(), updated_at: new Date().toISOString() })
  }

  // Assign a board to a folder (or null to ungroup).
  function moveBoardToFolder(boardId, folderId) {
    return updateBoard(boardId, { folder_id: folderId })
  }

  async function deleteBoard(id) {
    error.value = null
    try {
      const { error: err } = await supabase.from('canvy_boards').delete().eq('id', id)
      if (err) throw err
      boards.value = boards.value.filter((b) => b.id !== id)
      if (activeBoardId.value === id) activeBoardId.value = null
    } catch (e) {
      console.error('[Canvy] deleteBoard error:', e)
      error.value = e.message
      throw e
    }
  }

  // Duplicate a board (handy for trying variations of a diagram).
  async function duplicateBoard(id) {
    const auth = useAuthStore()
    const src = boards.value.find((b) => b.id === id)
    if (!auth.user || !src) return
    try {
      const { data, error: err } = await supabase
        .from('canvy_boards')
        .insert({
          user_id: auth.user.id,
          name: `${src.name} copy`,
          folder_id: src.folder_id || null,
          data: JSON.parse(JSON.stringify(src.data || blankData())),
          branch_data: JSON.parse(JSON.stringify(src.branch_data || blankData())),
        })
        .select('*')
        .single()
      if (err) throw err
      boards.value.unshift(data)
      activeBoardId.value = data.id
      return data
    } catch (e) {
      console.error('[Canvy] duplicateBoard error:', e)
      error.value = e.message
      throw e
    }
  }

  function sortBoards() {
    boards.value.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }

  // ── Folders ─────────────────────────────────────────────────────────────
  async function fetchFolders() {
    const auth = useAuthStore()
    if (!auth.user) return
    try {
      const { data, error: err } = await supabase
        .from('canvy_folders')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('name', { ascending: true })
      if (err) throw err
      folders.value = data || []
    } catch (e) {
      console.error('[Canvy] fetchFolders error:', e)
    }
  }

  async function createFolder(name) {
    const auth = useAuthStore()
    if (!auth.user || !name.trim()) return
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('canvy_folders')
        .insert({ user_id: auth.user.id, name: name.trim() })
        .select('*')
        .single()
      if (err) throw err
      folders.value = [...folders.value, data].sort((a, b) => a.name.localeCompare(b.name))
      return data
    } catch (e) {
      console.error('[Canvy] createFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function renameFolder(id, name) {
    if (!name.trim()) return
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('canvy_folders')
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
      console.error('[Canvy] renameFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function deleteFolder(id) {
    error.value = null
    try {
      // boards.folder_id is set to null server-side via the FK (on delete set null)
      const { error: err } = await supabase.from('canvy_folders').delete().eq('id', id)
      if (err) throw err
      folders.value = folders.value.filter((f) => f.id !== id)
      boards.value = boards.value.map((b) => (b.folder_id === id ? { ...b, folder_id: null } : b))
    } catch (e) {
      console.error('[Canvy] deleteFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  function reset() {
    for (const t of saveTimers.values()) clearTimeout(t)
    saveTimers.clear()
    boards.value = []
    folders.value = []
    activeBoardId.value = null
    loaded.value = false
    loading.value = false
    saving.value = false
    error.value = null
  }

  return {
    boards,
    folders,
    activeBoardId,
    activeBoard,
    loading,
    loaded,
    saving,
    error,
    fetchBoards,
    createBoard,
    selectBoard,
    updateBoardData,
    mergeBranch,
    updateBoard,
    renameBoard,
    moveBoardToFolder,
    deleteBoard,
    duplicateBoard,
    fetchFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    reset,
  }
})

// Exposed for components that want a brand-new board shape without the store.
export { blankData }
