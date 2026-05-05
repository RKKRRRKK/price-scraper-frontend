import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

export const useNotesStore = defineStore('notes', () => {
  const notes = ref([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref(null)

  // ── Filters ──
  const searchQuery = ref('')
  const activeContexts = ref([])      // ['work','personal']
  const activeCategories = ref([])    // ['meeting','idea',...]
  const deadlineFilter = ref(false)
  const dateFrom = ref(null)       // 'YYYY-MM-DD' string or null
  const dateTo = ref(null)         // 'YYYY-MM-DD' string or null

  // ── All unique categories from data ──
  const allCategories = computed(() => {
    const set = new Set(notes.value.map(n => n.category).filter(Boolean))
    return [...set].sort()
  })

  // ── All unique contexts from data ──
  const allContexts = computed(() => {
    const set = new Set(notes.value.map(n => n.context).filter(Boolean))
    return [...set].sort()
  })

  // ── Category color palette ──
  // Each entry is a full HSL color. Edit h (0–360), s (0–100), l (0–100)
  // directly to pick the exact color you want. Purple (h ~250–320) is
  // reserved for the selection accent — avoid that band here.
  const CATEGORY_PALETTE = [
    { h: 215, s: 100, l: 50 }, // blue
    { h: 39,  s: 100, l: 50 }, // orange
    { h: 140, s: 100, l: 42 }, // green
    { h: 0,   s: 0,   l: 20 }, // near-black
    { h: 64,  s: 100, l: 45 }, // yellow-green
    { h: 185, s: 100, l: 40 }, // cyan
    { h: 0,   s: 100, l: 55 }, // red
  ]

  // Assign palette entries to categories in the order they appear in
  // `allCategories` (alphabetical). Wraps if there are more categories
  // than palette entries. Unknown categories fall back to a deterministic
  // hash into the same palette.
  function categoryColor(cat) {
    if (!cat) return CATEGORY_PALETTE[0]
    const idx = allCategories.value.indexOf(cat)
    if (idx === -1) {
      let h = 0
      for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0
      return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length]
    }
    return CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length]
  }

  // ── Deadline urgency helper ──
  function deadlineUrgency(dateStr) {
    if (!dateStr) return null
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    const d = new Date(dateStr)
    const diff = Math.ceil((d - now) / 86400000)
    if (diff < 0) return 'overdue'
    if (diff <= 2) return 'urgent'
    if (diff <= 7) return 'soon'
    return 'later'
  }

  // ── Filtered notes ──
  const filteredNotes = computed(() => {
    let result = notes.value

    // Context filter
    if (activeContexts.value.length) {
      result = result.filter(n => activeContexts.value.includes(n.context))
    }

    // Category filter
    if (activeCategories.value.length) {
      result = result.filter(n => activeCategories.value.includes(n.category))
    }

    // Deadline filter
    if (deadlineFilter.value) {
      result = result.filter(n => n.deadline)
    }

    // Date range filter
    if (dateFrom.value) {
      const from = new Date(dateFrom.value)
      from.setHours(0, 0, 0, 0)
      result = result.filter(n => new Date(n.created_at) >= from)
    }
    if (dateTo.value) {
      const to = new Date(dateTo.value)
      to.setHours(23, 59, 59, 999)
      result = result.filter(n => new Date(n.created_at) <= to)
    }

    // Search (content + keywords)
    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      result = result.filter(n => {
        const inContent = n.content.toLowerCase().includes(q)
        const inKeywords = (n.keywords || []).some(kw => kw.toLowerCase().includes(q))
        const inTitle = (n.content.split('\n')[0] || '').toLowerCase().includes(q)
        const inProcessed = (n.processed_content || '').toLowerCase().includes(q)
        return inContent || inKeywords || inTitle || inProcessed
      })
    }

    return result
  })

  // ── Stats ──
  const stats = computed(() => {
    const total = notes.value.length
    const withDeadline = notes.value.filter(n => n.deadline).length
    const categories = allCategories.value.length
    const thisWeek = notes.value.filter(n => {
      const d = new Date(n.created_at)
      const now = new Date()
      const weekAgo = new Date(now - 7 * 86400000)
      return d >= weekAgo
    }).length
    return { total, withDeadline, categories, thisWeek }
  })

  // ── Upcoming deadlines ──
  const upcomingDeadlines = computed(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return notes.value
      .filter(n => n.deadline && n.deadline_date)
      .filter(n => new Date(n.deadline_date) >= now)
      .sort((a, b) => new Date(a.deadline_date) - new Date(b.deadline_date))
      .slice(0, 5)
  })

  // ── Category counts (for filter pills) ──
  const categoryCounts = computed(() => {
    const map = {}
    notes.value.forEach(n => {
      if (n.category) map[n.category] = (map[n.category] || 0) + 1
    })
    return map
  })

  // ── CRUD ──
  async function fetchNotes() {
    if (loaded.value || loading.value) return
    const auth = useAuthStore()
    if (!auth.user) return

    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('created_at', { ascending: false })

      if (err) throw err
      notes.value = data || []
      loaded.value = true
    } catch (e) {
      console.error('[Notes] fetchNotes error:', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function addNote(note) {
    const auth = useAuthStore()
    if (!auth.user) return

    error.value = null
    try {
      const payload = {
        user_id: auth.user.id,
        context: note.context,
        category: note.category,
        content: note.content,
        keywords: note.keywords || [],
        speaker: note.speaker || null,
        deadline: note.deadline || false,
        deadline_stakeholder: note.deadline_stakeholder || null,
        deadline_date: note.deadline_date || null,
        processed_content: note.processed_content || null,
      }

      const { data, error: err } = await supabase
        .from('notes')
        .insert(payload)
        .select('*')
        .single()

      if (err) throw err
      notes.value.unshift(data)
      return data
    } catch (e) {
      console.error('[Notes] addNote error:', e)
      error.value = e.message
      throw e
    }
  }

  async function updateNote(id, updates) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('notes')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single()

      if (err) throw err
      const idx = notes.value.findIndex(n => n.id === id)
      if (idx !== -1) notes.value[idx] = data
      return data
    } catch (e) {
      console.error('[Notes] updateNote error:', e)
      error.value = e.message
      throw e
    }
  }

  async function deleteNote(id) {
    error.value = null
    try {
      const { error: err } = await supabase
        .from('notes')
        .delete()
        .eq('id', id)

      if (err) throw err
      notes.value = notes.value.filter(n => n.id !== id)
    } catch (e) {
      console.error('[Notes] deleteNote error:', e)
      error.value = e.message
      throw e
    }
  }

  function reset() {
    notes.value = []
    loaded.value = false
    loading.value = false
    error.value = null
    searchQuery.value = ''
    activeContexts.value = []
    activeCategories.value = []
    deadlineFilter.value = false
    dateFrom.value = null
    dateTo.value = null
  }

  // ── Toggle helpers ──
  function toggleContext(ctx) {
    const i = activeContexts.value.indexOf(ctx)
    if (i === -1) activeContexts.value.push(ctx)
    else activeContexts.value.splice(i, 1)
  }

  function toggleCategory(cat) {
    const i = activeCategories.value.indexOf(cat)
    if (i === -1) activeCategories.value.push(cat)
    else activeCategories.value.splice(i, 1)
  }

  return {
    notes,
    loading,
    loaded,
    error,
    searchQuery,
    activeContexts,
    activeCategories,
    deadlineFilter,
    dateFrom,
    dateTo,
    allCategories,
    allContexts,
    filteredNotes,
    stats,
    upcomingDeadlines,
    categoryCounts,
    categoryColor,
    deadlineUrgency,
    fetchNotes,
    addNote,
    updateNote,
    deleteNote,
    reset,
    toggleContext,
    toggleCategory,
  }
})
