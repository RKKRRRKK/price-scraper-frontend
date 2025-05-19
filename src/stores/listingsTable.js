import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

export const useListingsTable = defineStore('listingsTable', {
  state: () => ({
    rows: [],
    loaded: false,
    loading: false,
    error: null,

    realtimeChannel: null,
  }),
  persist: false,

  getters: {},

  actions: {
    _mapDbRow(row) {
      if (!row) return null
      return {
        id: row.id,
        search_term: row.search_term,
        title: row.title,
        price: row.price,
        currency: row.currency,
        condition: row.condition,
        url: row.url,
        date_inserted: row.date_inserted,
        source: row.source,
      }
    },

    _upsertLocal(listing) {
      const idx = this.rows.findIndex((r) => r.id === listing.id)
      if (idx === -1) {
        this.rows.push(listing)
      } else {
        this.rows[idx] = { ...this.rows[idx], ...listing }
      }
    },

    async fetchAll() {
      if (this.loaded || this.loading) return
      const auth = useAuthStore()
      if (!auth.user) {
        this.reset()
        return
      }

      this.loading = true
      this.error = null
      try {
        const { data, error } = await supabase
          .from('listings')
          .select('*')
          .eq('user_id', auth.user.id)
          .order('search_term', { ascending: false })

        if (error) throw error
        this.rows = (data ?? []).map(this._mapDbRow).filter(Boolean)
        this.loaded = true

        this._initRealtime(auth.user.id)
      } catch (err) {
        console.error('[listingsTable] fetchAll error:', err)
        this.error = err.message ?? 'Failed to load listings.'
      } finally {
        this.loading = false
      }
    },

    async deleteListing(id) {
      const existingIdx = this.rows.findIndex((r) => r.id === id)
      if (existingIdx === -1) return

      try {
        const { error } = await supabase.from('listings').delete().eq('id', id)
        if (error) throw error
        this.rows.splice(existingIdx, 1)
      } catch (err) {
        console.error('[listingsTable] deleteListing error:', err)
        this.error = err.message ?? 'Deletion failed.'

        throw err
      }
    },

    async reset() {
      await this._removeRealtime()
      this.rows = []
      this.loaded = false
      this.loading = false
      this.error = null
    },

    _initRealtime(userId) {
      if (this.realtimeChannel) return
      this.realtimeChannel = supabase
        .channel(`listings_user_${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'listings', filter: `user_id=eq.${userId}` },
          ({ eventType, new: newRec, old: oldRec }) => {
            if (eventType === 'DELETE' && oldRec?.id) {
              this.rows = this.rows.filter((r) => r.id !== oldRec.id)
            } else {
              const mapped = this._mapDbRow(newRec)
              if (mapped) this._upsertLocal(mapped)
            }
          },
        )
        .subscribe((status) => console.log('[listingsTable] realtime status:', status))
    },

    async _removeRealtime() {
      if (this.realtimeChannel) {
        await supabase.removeChannel(this.realtimeChannel)
        this.realtimeChannel = null
      }
    },
  },
})
