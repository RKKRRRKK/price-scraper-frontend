import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

const BUCKET = 'documents'

export const useDocumentsStore = defineStore('documents', () => {
  const folders = ref([])
  const documents = ref([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref(null)

  const foldersById = computed(() => {
    const map = new Map()
    for (const f of folders.value) map.set(f.id, f)
    return map
  })

  function folderChildren(parentId) {
    return folders.value
      .filter(f => (f.parent_id ?? null) === (parentId ?? null))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  function documentsInFolder(folderId) {
    return documents.value
      .filter(d => (d.folder_id ?? null) === (folderId ?? null))
      .slice()
      .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at))
  }

  function folderPath(folderId) {
    const path = []
    let cursor = folderId ? foldersById.value.get(folderId) : null
    const seen = new Set()
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      path.unshift({ id: cursor.id, name: cursor.name })
      cursor = cursor.parent_id ? foldersById.value.get(cursor.parent_id) : null
    }
    return path
  }

  async function fetchAll() {
    if (loaded.value || loading.value) return
    const auth = useAuthStore()
    if (!auth.user) return

    loading.value = true
    error.value = null
    try {
      const [foldersRes, docsRes] = await Promise.all([
        supabase
          .from('document_folders')
          .select('*')
          .eq('user_id', auth.user.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('documents')
          .select('*')
          .eq('user_id', auth.user.id)
          .order('captured_at', { ascending: false }),
      ])
      if (foldersRes.error) throw foldersRes.error
      if (docsRes.error) throw docsRes.error
      folders.value = foldersRes.data || []
      documents.value = docsRes.data || []
      loaded.value = true
    } catch (e) {
      console.error('[Documents] fetchAll error:', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function createFolder({ name, parent_id = null }) {
    const auth = useAuthStore()
    if (!auth.user) return
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('document_folders')
        .insert({
          user_id: auth.user.id,
          parent_id: parent_id || null,
          name: name.trim(),
        })
        .select('*')
        .single()
      if (err) throw err
      folders.value.push(data)
      return data
    } catch (e) {
      console.error('[Documents] createFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function renameFolder(id, name) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('document_folders')
        .update({ name: name.trim() })
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const idx = folders.value.findIndex(f => f.id === id)
      if (idx !== -1) folders.value[idx] = data
      return data
    } catch (e) {
      console.error('[Documents] renameFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  function collectDescendantFolderIds(rootId) {
    const ids = new Set([rootId])
    let added = true
    while (added) {
      added = false
      for (const f of folders.value) {
        if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
          ids.add(f.id)
          added = true
        }
      }
    }
    return ids
  }

  async function deleteFolder(id) {
    error.value = null
    try {
      const descendantIds = collectDescendantFolderIds(id)
      const docsToRemove = documents.value.filter(d => descendantIds.has(d.folder_id))
      if (docsToRemove.length) {
        const paths = docsToRemove.map(d => d.storage_path)
        const { error: storageErr } = await supabase.storage.from(BUCKET).remove(paths)
        if (storageErr) console.warn('[Documents] storage cleanup error:', storageErr)
      }

      const { error: err } = await supabase
        .from('document_folders')
        .delete()
        .eq('id', id)
      if (err) throw err

      folders.value = folders.value.filter(f => !descendantIds.has(f.id))
      documents.value = documents.value.filter(d => !descendantIds.has(d.folder_id))
    } catch (e) {
      console.error('[Documents] deleteFolder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function uploadDocument({ blob, name, folder_id = null }) {
    const auth = useAuthStore()
    if (!auth.user) return
    error.value = null
    try {
      const id = uuidv4()
      const ext = blob.type === 'image/png' ? 'png' : 'jpg'
      const storage_path = `${auth.user.id}/${id}.${ext}`

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(storage_path, blob, {
          contentType: blob.type || 'image/jpeg',
          upsert: false,
        })
      if (upErr) throw upErr

      const payload = {
        id,
        user_id: auth.user.id,
        folder_id: folder_id || null,
        name: name.trim(),
        storage_path,
        mime_type: blob.type || 'image/jpeg',
        size_bytes: blob.size,
        captured_at: new Date().toISOString(),
      }
      const { data, error: err } = await supabase
        .from('documents')
        .insert(payload)
        .select('*')
        .single()
      if (err) {
        await supabase.storage.from(BUCKET).remove([storage_path])
        throw err
      }
      documents.value.unshift(data)
      return data
    } catch (e) {
      console.error('[Documents] uploadDocument error:', e)
      error.value = e.message
      throw e
    }
  }

  async function deleteDocument(id) {
    error.value = null
    try {
      const doc = documents.value.find(d => d.id === id)
      if (!doc) return
      const { error: storageErr } = await supabase.storage
        .from(BUCKET)
        .remove([doc.storage_path])
      if (storageErr) console.warn('[Documents] storage delete error:', storageErr)

      const { error: err } = await supabase.from('documents').delete().eq('id', id)
      if (err) throw err
      documents.value = documents.value.filter(d => d.id !== id)
    } catch (e) {
      console.error('[Documents] deleteDocument error:', e)
      error.value = e.message
      throw e
    }
  }

  async function moveDocument(id, folder_id) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('documents')
        .update({ folder_id: folder_id || null })
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const idx = documents.value.findIndex(d => d.id === id)
      if (idx !== -1) documents.value[idx] = data
      return data
    } catch (e) {
      console.error('[Documents] moveDocument error:', e)
      error.value = e.message
      throw e
    }
  }

  async function renameDocument(id, name) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('documents')
        .update({ name: name.trim() })
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const idx = documents.value.findIndex(d => d.id === id)
      if (idx !== -1) documents.value[idx] = data
      return data
    } catch (e) {
      console.error('[Documents] renameDocument error:', e)
      error.value = e.message
      throw e
    }
  }

  async function getSignedUrl(storage_path, expiresIn = 60, download = false) {
    const opts = download ? { download: true } : undefined
    const { data, error: err } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storage_path, expiresIn, opts)
    if (err) {
      console.error('[Documents] getSignedUrl error:', err)
      throw err
    }
    return data.signedUrl
  }

  function reset() {
    folders.value = []
    documents.value = []
    loaded.value = false
    loading.value = false
    error.value = null
  }

  return {
    folders,
    documents,
    loading,
    loaded,
    error,
    folderChildren,
    documentsInFolder,
    folderPath,
    foldersById,
    fetchAll,
    createFolder,
    renameFolder,
    deleteFolder,
    uploadDocument,
    deleteDocument,
    moveDocument,
    renameDocument,
    getSignedUrl,
    reset,
  }
})
