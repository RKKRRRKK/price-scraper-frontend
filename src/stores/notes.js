import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { isCanonical } from '@/lib/taxonomy'

export const useNotesStore = defineStore('notes', () => {
  const notes = ref([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref(null)

  // ── Filters ──
  const searchQuery = ref('')
  const activeContexts = ref([])           // ['work','personal']
  const categoryFilter = ref('all')        // single-select: 'all' | <value>
  const activeSubcategories = ref([])      // multi-select pill toggle, e.g. ['idea','meta',…]
  const deadlineFilter = ref(false)
  const dateFrom = ref(null)               // 'YYYY-MM-DD' string or null
  const dateTo = ref(null)                 // 'YYYY-MM-DD' string or null
  const statusFilter = ref('all')          // 'all' | 'active' | 'completed' | 'suspended'
  const priorityFilter = ref('all')        // 'all' | 'none' | 'low' | 'medium' | 'high'
  const stakeholderFilter = ref('all')     // 'all' | <value>
  const needsReviewFilter = ref(false)     // true → only show non-canonical notes

  // ── Note field helpers (apply defaults for legacy rows) ──
  function noteStatus(note) {
    return note?.status || 'active'
  }
  function notePriority(note) {
    return note?.priority || 'none'
  }
  function noteSubcategory(note) {
    return note?.subcategory || 'unassigned'
  }
  // True if this note's (context, category, subcategory) does NOT match the
  // canonical taxonomy. Used to flag legacy/free-text rows for the user.
  function needsReview(note) {
    if (!note) return false
    return !isCanonical(note.context, note.category, note.subcategory)
  }

  // ── Scoping pool: notes after context + date are applied. Basis for all
  //    "scoped" counts (stats, category/status/priority counts, allCategories). ──
  const scopedNotes = computed(() => {
    let r = notes.value
    if (activeContexts.value.length) {
      r = r.filter(n => activeContexts.value.includes(n.context))
    }
    if (dateFrom.value) {
      const from = new Date(dateFrom.value); from.setHours(0, 0, 0, 0)
      r = r.filter(n => new Date(n.created_at) >= from)
    }
    if (dateTo.value) {
      const to = new Date(dateTo.value); to.setHours(23, 59, 59, 999)
      r = r.filter(n => new Date(n.created_at) <= to)
    }
    return r
  })

  // ── All unique categories from data (scoped to context+date) ──
  const allCategories = computed(() => {
    const set = new Set(scopedNotes.value.map(n => n.category).filter(Boolean))
    return [...set].sort()
  })

  // ── Pool for subcategory pills: all filters applied except activeSubcategories,
  //    so the pill bar reflects the current filter context without filtering itself. ──
  const preSubcategoryPool = computed(() => {
    let r = notes.value
    if (activeContexts.value.length) {
      r = r.filter(n => activeContexts.value.includes(n.context))
    }
    if (categoryFilter.value !== 'all') {
      r = r.filter(n => n.category === categoryFilter.value)
    }
    if (deadlineFilter.value) {
      r = r.filter(n => n.deadline)
    }
    if (statusFilter.value !== 'all') {
      r = r.filter(n => noteStatus(n) === statusFilter.value)
    }
    if (priorityFilter.value !== 'all') {
      r = r.filter(n => notePriority(n) === priorityFilter.value)
    }
    if (stakeholderFilter.value !== 'all') {
      r = r.filter(n => n.stakeholder === stakeholderFilter.value)
    }
    if (needsReviewFilter.value) {
      r = r.filter(n => needsReview(n))
    }
    if (dateFrom.value) {
      const from = new Date(dateFrom.value); from.setHours(0, 0, 0, 0)
      r = r.filter(n => new Date(n.created_at) >= from)
    }
    if (dateTo.value) {
      const to = new Date(dateTo.value); to.setHours(23, 59, 59, 999)
      r = r.filter(n => new Date(n.created_at) <= to)
    }
    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      r = r.filter(n => {
        const inContent = n.content.toLowerCase().includes(q)
        const inKeywords = (n.keywords || []).some(kw => kw.toLowerCase().includes(q))
        const inTitle = (n.content.split('\n')[0] || '').toLowerCase().includes(q)
        const inProcessed = (n.processed_content || '').toLowerCase().includes(q)
        return inContent || inKeywords || inTitle || inProcessed
      })
    }
    return r
  })

  // ── All unique subcategories — scoped to preSubcategoryPool so pills update
  //    when category/status/priority filters change. ──
  const allSubcategories = computed(() => {
    const set = new Set(preSubcategoryPool.value.map(n => n.subcategory || 'unassigned'))
    return [...set].sort()
  })

  // ── All unique stakeholders (scoped, excludes empty) ──
  const allStakeholders = computed(() => {
    const set = new Set(scopedNotes.value.map(n => n.stakeholder).filter(Boolean))
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

  // Palette assignment now follows **subcategories** (the colored pill axis).
  // Entries are picked in the alphabetical order of `allSubcategories`. Unknown
  // names hash deterministically into the same palette so a brand-new
  // subcategory still gets a stable color.
  function subcategoryColor(name) {
    if (!name) return CATEGORY_PALETTE[0]
    const idx = allSubcategories.value.indexOf(name)
    if (idx === -1) {
      let h = 0
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
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

  // ── Filtered notes — preSubcategoryPool already has all other filters applied ──
  const filteredNotes = computed(() => {
    if (!activeSubcategories.value.length) return preSubcategoryPool.value
    // Only honour active subcategories that still exist in the current context.
    const valid = activeSubcategories.value.filter(s => allSubcategories.value.includes(s))
    if (!valid.length) return preSubcategoryPool.value
    return preSubcategoryPool.value.filter(n => valid.includes(n.subcategory || 'unassigned'))
  })

  // ── Stats (scoped to context+date) ──
  const stats = computed(() => {
    const pool = scopedNotes.value
    const total = pool.length
    const withDeadline = pool.filter(n => n.deadline).length
    const categories = allCategories.value.length
    const thisWeek = pool.filter(n => {
      const d = new Date(n.created_at)
      const now = new Date()
      const weekAgo = new Date(now - 7 * 86400000)
      return d >= weekAgo
    }).length
    const completed = pool.filter(n => noteStatus(n) === 'completed').length
    const suspended = pool.filter(n => noteStatus(n) === 'suspended').length
    return { total, withDeadline, categories, thisWeek, completed, suspended }
  })

  // ── Status counts (for filter dropdown) — scoped to context+date ──
  const statusCounts = computed(() => {
    const pool = scopedNotes.value
    return {
      all: pool.length,
      active: pool.filter(n => noteStatus(n) === 'active').length,
      completed: pool.filter(n => noteStatus(n) === 'completed').length,
      suspended: pool.filter(n => noteStatus(n) === 'suspended').length,
    }
  })

  // ── Priority counts (for filter dropdown) — scoped to context+date ──
  const priorityCounts = computed(() => {
    const pool = scopedNotes.value
    return {
      all: pool.length,
      none:   pool.filter(n => notePriority(n) === 'none').length,
      low:    pool.filter(n => notePriority(n) === 'low').length,
      medium: pool.filter(n => notePriority(n) === 'medium').length,
      high:   pool.filter(n => notePriority(n) === 'high').length,
    }
  })

  // ── Subcategory counts — from preSubcategoryPool so counts reflect active filters ──
  const subcategoryCounts = computed(() => {
    const map = { all: preSubcategoryPool.value.length }
    preSubcategoryPool.value.forEach(n => {
      const k = n.subcategory || 'unassigned'
      map[k] = (map[k] || 0) + 1
    })
    return map
  })

  // ── Stakeholder counts (scoped) ──
  const stakeholderCounts = computed(() => {
    const map = { all: scopedNotes.value.length }
    scopedNotes.value.forEach(n => {
      if (n.stakeholder) map[n.stakeholder] = (map[n.stakeholder] || 0) + 1
    })
    return map
  })

  // ── Needs-review count (scoped) ──
  const needsReviewCount = computed(
    () => scopedNotes.value.filter(n => needsReview(n)).length
  )

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

  // ── Category counts (for the Category dropdown) — scoped to context+date ──
  const categoryCounts = computed(() => {
    const map = { all: scopedNotes.value.length }
    scopedNotes.value.forEach(n => {
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
        subcategory: note.subcategory || 'unassigned',
        content: note.content,
        keywords: note.keywords || [],
        speaker: note.speaker || null,
        stakeholder: note.stakeholder || null,
        deadline: note.deadline || false,
        deadline_stakeholder: note.deadline_stakeholder || null,
        deadline_date: note.deadline_date || null,
        processed_content: note.processed_content || null,
        status: note.status || 'active',
        priority: note.priority || 'none',
        related_note_ids: note.related_note_ids || [],
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

      // Scrub the deleted id from every sibling's related_note_ids
      const orphans = notes.value.filter(n => (n.related_note_ids || []).includes(id))
      await Promise.all(orphans.map(o => updateNote(o.id, {
        related_note_ids: (o.related_note_ids || []).filter(x => x !== id),
      })))
    } catch (e) {
      console.error('[Notes] deleteNote error:', e)
      error.value = e.message
      throw e
    }
  }

  // ── Push a note to a given status ('active' | 'completed' | 'suspended') ──
  async function setNoteStatus(id, status) {
    return updateNote(id, { status })
  }

  // ── Bidirectional linking between two notes ──
  async function linkRelated(aId, bId) {
    if (!aId || !bId || aId === bId) return
    const a = notes.value.find(n => n.id === aId)
    const b = notes.value.find(n => n.id === bId)
    if (!a || !b) return
    const aIds = Array.from(new Set([...(a.related_note_ids || []), bId]))
    const bIds = Array.from(new Set([...(b.related_note_ids || []), aId]))
    await Promise.all([
      updateNote(aId, { related_note_ids: aIds }),
      updateNote(bId, { related_note_ids: bIds }),
    ])
  }

  async function unlinkRelated(aId, bId) {
    if (!aId || !bId) return
    const a = notes.value.find(n => n.id === aId)
    const b = notes.value.find(n => n.id === bId)
    if (!a || !b) return
    await Promise.all([
      updateNote(aId, { related_note_ids: (a.related_note_ids || []).filter(x => x !== bId) }),
      updateNote(bId, { related_note_ids: (b.related_note_ids || []).filter(x => x !== aId) }),
    ])
  }

  function reset() {
    notes.value = []
    loaded.value = false
    loading.value = false
    error.value = null
    searchQuery.value = ''
    activeContexts.value = []
    activeSubcategories.value = []
    categoryFilter.value = 'all'
    deadlineFilter.value = false
    dateFrom.value = null
    dateTo.value = null
    statusFilter.value = 'all'
    priorityFilter.value = 'all'
    stakeholderFilter.value = 'all'
    needsReviewFilter.value = false
  }

  // ── Toggle helpers ──
  function toggleContext(ctx) {
    const i = activeContexts.value.indexOf(ctx)
    if (i === -1) activeContexts.value.push(ctx)
    else activeContexts.value.splice(i, 1)
  }

  function toggleSubcategory(sub) {
    const i = activeSubcategories.value.indexOf(sub)
    if (i === -1) activeSubcategories.value.push(sub)
    else activeSubcategories.value.splice(i, 1)
  }

  return {
    notes,
    loading,
    loaded,
    error,
    searchQuery,
    activeContexts,
    activeSubcategories,
    categoryFilter,
    deadlineFilter,
    dateFrom,
    dateTo,
    statusFilter,
    priorityFilter,
    stakeholderFilter,
    needsReviewFilter,
    scopedNotes,
    allCategories,
    allContexts,
    allSubcategories,
    allStakeholders,
    filteredNotes,
    stats,
    statusCounts,
    priorityCounts,
    subcategoryCounts,
    stakeholderCounts,
    needsReviewCount,
    upcomingDeadlines,
    categoryCounts,
    subcategoryColor,
    deadlineUrgency,
    noteStatus,
    notePriority,
    noteSubcategory,
    needsReview,
    fetchNotes,
    addNote,
    updateNote,
    deleteNote,
    setNoteStatus,
    linkRelated,
    unlinkRelated,
    reset,
    toggleContext,
    toggleSubcategory,
  }
})
