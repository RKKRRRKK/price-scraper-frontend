import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

export const useRemindersStore = defineStore('reminders', () => {
  const reminders = ref([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref(null)

  function startOfToday() {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }

  // Repeating + checked reminders should auto-uncheck once the next day rolls over.
  // Done client-side on fetch and persisted back to the DB so other devices stay in sync.
  async function reconcileRepeats(rows) {
    const today = startOfToday()
    const stale = rows.filter(r =>
      r.repeating && r.checked && r.checked_at && new Date(r.checked_at) < today
    )
    if (!stale.length) return rows
    const ids = stale.map(r => r.id)
    const { error: err } = await supabase
      .from('reminders')
      .update({ checked: false, checked_at: null })
      .in('id', ids)
    if (err) {
      console.error('[Reminders] reconcileRepeats error:', err)
      return rows
    }
    return rows.map(r => ids.includes(r.id) ? { ...r, checked: false, checked_at: null } : r)
  }

  async function fetchReminders() {
    if (loaded.value || loading.value) return
    const auth = useAuthStore()
    if (!auth.user) return

    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('reminders')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('remind_at', { ascending: true })

      if (err) throw err
      reminders.value = await reconcileRepeats(data || [])
      loaded.value = true
    } catch (e) {
      console.error('[Reminders] fetchReminders error:', e)
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function addReminder(r) {
    const auth = useAuthStore()
    if (!auth.user) return

    error.value = null
    try {
      const payload = {
        user_id: auth.user.id,
        content: r.content,
        remind_at: r.remind_at,
        repeating: !!r.repeating,
        repeat_interval: r.repeating ? (r.repeat_interval || 'daily') : null,
        checked: false,
        checked_at: null,
      }
      const { data, error: err } = await supabase
        .from('reminders')
        .insert(payload)
        .select('*')
        .single()
      if (err) throw err
      reminders.value.push(data)
      reminders.value.sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))
      return data
    } catch (e) {
      console.error('[Reminders] addReminder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function updateReminder(id, updates) {
    error.value = null
    try {
      const { data, error: err } = await supabase
        .from('reminders')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single()
      if (err) throw err
      const idx = reminders.value.findIndex(r => r.id === id)
      if (idx !== -1) reminders.value[idx] = data
      reminders.value.sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))
      return data
    } catch (e) {
      console.error('[Reminders] updateReminder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function deleteReminder(id) {
    error.value = null
    try {
      const { error: err } = await supabase.from('reminders').delete().eq('id', id)
      if (err) throw err
      reminders.value = reminders.value.filter(r => r.id !== id)
    } catch (e) {
      console.error('[Reminders] deleteReminder error:', e)
      error.value = e.message
      throw e
    }
  }

  async function toggleChecked(id) {
    const r = reminders.value.find(x => x.id === id)
    if (!r) return
    const next = !r.checked
    return updateReminder(id, {
      checked: next,
      checked_at: next ? new Date().toISOString() : null,
    })
  }

  function reset() {
    reminders.value = []
    loaded.value = false
    loading.value = false
    error.value = null
  }

  return {
    reminders,
    loading,
    loaded,
    error,
    fetchReminders,
    addReminder,
    updateReminder,
    deleteReminder,
    toggleChecked,
    reset,
  }
})
