import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

// AI note generation is delegated to the user's own webhook (DeepSeek via
// OpenRouter). The frontend never holds a provider key. Configure the endpoint
// with VITE_SQUELL_AI_WEBHOOK.
//
// Webhook contract:
//   POST <VITE_SQUELL_AI_WEBHOOK>
//   request  (JSON): { kind, dialect, query_name, sql, previous_sql, current_sql }
//                    kind = 'description' | 'diff_note'
//   response (JSON): { text: string }
const AI_WEBHOOK = import.meta.env.VITE_SQUELL_AI_WEBHOOK || ''

export const useSquellStore = defineStore('squell', () => {
  const queries = ref([])              // squell_queries rows (catalogue)
  const folders = ref([])              // squell_folders rows
  const versionsByQuery = ref({})      // { [query_id]: version[] } ordered by version_number
  const activeQueryId = ref(null)
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref(null)

  const aiConfigured = computed(() => !!AI_WEBHOOK)
  const activeQuery = computed(
    () => queries.value.find(q => q.id === activeQueryId.value) || null,
  )
  const activeVersions = computed(
    () => (activeQueryId.value ? versionsByQuery.value[activeQueryId.value] || [] : []),
  )

  async function fetchQueries() {
    if (loaded.value || loading.value) return
    const auth = useAuthStore()
    if (!auth.user) return

    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('squell_queries')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('updated_at', { ascending: false })

      if (err) throw err
      queries.value = data || []
      loaded.value = true
    } catch (e) {
      console.error('[Squell] fetchQueries error:', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
    // Folders are optional; a failure here (e.g. table not yet created) must not
    // break the catalogue, so load them separately and swallow errors.
    await fetchFolders()
  }

  async function fetchFolders() {
    const auth = useAuthStore()
    if (!auth.user) return
    try {
      const { data, error: err } = await supabase
        .from('squell_folders')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('name', { ascending: true })
      if (err) throw err
      folders.value = data || []
    } catch (e) {
      console.error('[Squell] fetchFolders error:', e)
    }
  }

  async function createFolder(name) {
    const auth = useAuthStore()
    if (!auth.user || !name.trim()) return
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('squell_folders')
        .insert({ user_id: auth.user.id, name: name.trim() })
        .select('*')
        .single()
      if (err) throw err
      folders.value = [...folders.value, data].sort((a, b) => a.name.localeCompare(b.name))
      return data
    } catch (e) {
      console.error('[Squell] createFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function renameFolder(id, name) {
    if (!name.trim()) return
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('squell_folders')
        .update({ name: name.trim(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const idx = folders.value.findIndex(f => f.id === id)
      if (idx !== -1) folders.value[idx] = data
      folders.value = [...folders.value].sort((a, b) => a.name.localeCompare(b.name))
      return data
    } catch (e) {
      console.error('[Squell] renameFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function deleteFolder(id) {
    error.value = null
    try {
      // queries.folder_id is set to null server-side via the FK (on delete set null)
      const { error: err } = await supabase.from('squell_folders').delete().eq('id', id)
      if (err) throw err
      folders.value = folders.value.filter(f => f.id !== id)
      queries.value = queries.value.map(q => (q.folder_id === id ? { ...q, folder_id: null } : q))
    } catch (e) {
      console.error('[Squell] deleteFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  // Assign a query to a folder (or null to ungroup).
  function moveQueryToFolder(queryId, folderId) {
    return updateQuery(queryId, { folder_id: folderId })
  }

  async function fetchVersions(queryId) {
    if (!queryId) return []
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('squell_versions')
        .select('*')
        .eq('query_id', queryId)
        .order('version_number', { ascending: true })

      if (err) throw err
      versionsByQuery.value = { ...versionsByQuery.value, [queryId]: data || [] }
      return data || []
    } catch (e) {
      console.error('[Squell] fetchVersions error:', e)
      error.value = e.message
      throw e
    }
  }

  // Create a new named query with its first one or two versions.
  async function createQuery({ name, dialect, sqlV1, sqlV2, folderId = null }) {
    const auth = useAuthStore()
    if (!auth.user) return

    error.value = null
    try {
      const { data: query, error: qErr } = await supabase
        .from('squell_queries')
        .insert({
          user_id: auth.user.id,
          name: name.trim(),
          dialect: dialect || 'bigquery',
          description: null,
          folder_id: folderId,
        })
        .select('*')
        .single()
      if (qErr) throw qErr

      const rows = []
      if (sqlV1 != null && sqlV1.trim()) {
        rows.push({ query_id: query.id, user_id: auth.user.id, version_number: 1, sql_text: sqlV1, note: null })
      }
      if (sqlV2 != null && sqlV2.trim()) {
        rows.push({ query_id: query.id, user_id: auth.user.id, version_number: rows.length + 1, sql_text: sqlV2, note: null })
      }

      let versions = []
      if (rows.length) {
        const { data: vData, error: vErr } = await supabase
          .from('squell_versions')
          .insert(rows)
          .select('*')
        if (vErr) throw vErr
        versions = (vData || []).sort((a, b) => a.version_number - b.version_number)
      }

      queries.value.unshift(query)
      versionsByQuery.value = { ...versionsByQuery.value, [query.id]: versions }
      activeQueryId.value = query.id
      return query
    } catch (e) {
      console.error('[Squell] createQuery error:', e)
      error.value = e.message
      throw e
    }
  }

  // Append a new version to an existing query.
  async function addVersion(queryId, { sql_text, note, ai_note }) {
    const auth = useAuthStore()
    if (!auth.user) return

    error.value = null
    try {
      const existing = versionsByQuery.value[queryId] || []
      const nextNumber = existing.reduce((max, v) => Math.max(max, v.version_number), 0) + 1

      const { data, error: err } = await supabase
        .from('squell_versions')
        .insert({
          query_id: queryId,
          user_id: auth.user.id,
          version_number: nextNumber,
          sql_text,
          note: note || null,
          ai_note: ai_note || null,
        })
        .select('*')
        .single()
      if (err) throw err

      versionsByQuery.value = {
        ...versionsByQuery.value,
        [queryId]: [...existing, data],
      }
      await touchQuery(queryId)
      return data
    } catch (e) {
      console.error('[Squell] addVersion error:', e)
      error.value = e.message
      throw e
    }
  }

  // Bump updated_at so the query floats to the top of the catalogue.
  async function touchQuery(queryId) {
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('squell_queries')
      .update({ updated_at: now })
      .eq('id', queryId)
      .select('*')
      .single()
    if (err) {
      console.error('[Squell] touchQuery error:', err)
      return
    }
    applyQueryUpdate(data)
  }

  function applyQueryUpdate(updated) {
    const idx = queries.value.findIndex(q => q.id === updated.id)
    if (idx !== -1) queries.value[idx] = updated
    // keep catalogue sorted by updated_at desc
    queries.value.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }

  async function updateQuery(id, updates) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('squell_queries')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      applyQueryUpdate(data)
      return data
    } catch (e) {
      console.error('[Squell] updateQuery error:', e)
      error.value = e.message
      throw e
    }
  }

  function updateQueryDescription(id, description) {
    return updateQuery(id, { description })
  }

  // Patch fields on an existing version (note, ai_note, …) and sync local state.
  async function updateVersion(id, updates) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('squell_versions')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const list = versionsByQuery.value[data.query_id]
      if (list) {
        const idx = list.findIndex(v => v.id === id)
        if (idx !== -1) {
          const next = [...list]
          next[idx] = data
          versionsByQuery.value = { ...versionsByQuery.value, [data.query_id]: next }
        }
      }
      return data
    } catch (e) {
      console.error('[Squell] updateVersion error:', e)
      error.value = e.message
      throw e
    }
  }
  const updateVersionNote = (id, note) => updateVersion(id, { note })

  async function deleteVersion(id) {
    error.value = null
    try {
      const { error: err } = await supabase.from('squell_versions').delete().eq('id', id)
      if (err) throw err
      for (const qid of Object.keys(versionsByQuery.value)) {
        const list = versionsByQuery.value[qid]
        if (list.some(v => v.id === id)) {
          versionsByQuery.value = {
            ...versionsByQuery.value,
            [qid]: list.filter(v => v.id !== id),
          }
          break
        }
      }
    } catch (e) {
      console.error('[Squell] deleteVersion error:', e)
      error.value = e.message
      throw e
    }
  }

  async function deleteQuery(id) {
    error.value = null
    try {
      // versions cascade-delete via the FK
      const { error: err } = await supabase.from('squell_queries').delete().eq('id', id)
      if (err) throw err
      queries.value = queries.value.filter(q => q.id !== id)
      const rest = { ...versionsByQuery.value }
      delete rest[id]
      versionsByQuery.value = rest
      if (activeQueryId.value === id) activeQueryId.value = null
    } catch (e) {
      console.error('[Squell] deleteQuery error:', e)
      error.value = e.message
      throw e
    }
  }

  // Generate AI text via the configured webhook. Returns the generated string.
  async function generateAi(kind, payload) {
    if (!AI_WEBHOOK) {
      throw new Error('AI webhook not configured (set VITE_SQUELL_AI_WEBHOOK).')
    }
    const res = await fetch(AI_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ...payload }),
    })
    if (!res.ok) {
      throw new Error(`AI webhook returned ${res.status}`)
    }
    const data = await res.json()
    const text = data?.text ?? data?.result ?? ''
    if (!text) throw new Error('AI webhook returned no text')
    return text
  }

  async function selectQuery(id) {
    activeQueryId.value = id
    if (id && !versionsByQuery.value[id]) {
      await fetchVersions(id)
    }
  }

  function reset() {
    queries.value = []
    folders.value = []
    versionsByQuery.value = {}
    activeQueryId.value = null
    loaded.value = false
    loading.value = false
    error.value = null
  }

  return {
    queries,
    folders,
    versionsByQuery,
    activeQueryId,
    activeQuery,
    activeVersions,
    loading,
    loaded,
    error,
    aiConfigured,
    fetchQueries,
    fetchFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    moveQueryToFolder,
    fetchVersions,
    createQuery,
    addVersion,
    updateQuery,
    updateQueryDescription,
    updateVersion,
    updateVersionNote,
    deleteVersion,
    deleteQuery,
    generateAi,
    selectQuery,
    reset,
  }
})
