import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

// Dedicated data path for the Database (diagnosis) page. Deliberately does NOT
// share state with `listingsTable` (which the Dashboard eagerly loads in full):
// this store only ever pulls a lightweight distinct-terms list up front, and
// the actual listing rows only after a specific search term is chosen — so a
// visit to /database never fetches the whole table.
export const useListingsExplorer = defineStore('listingsExplorer', {
  state: () => ({
    terms: [], // [{ term, count }], from the DB-side distinct_search_terms() RPC
    termsLoaded: false,
    termsLoading: false,

    selectedTerm: null,
    rows: [],
    rowsLoading: false,

    error: null,
  }),
  persist: false,

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

    async fetchTerms() {
      if (this.termsLoaded || this.termsLoading) return
      const auth = useAuthStore()
      if (!auth.user) return

      this.termsLoading = true
      this.error = null
      try {
        const { data, error } = await supabase.rpc('distinct_search_terms')
        if (error) throw error
        this.terms = (data ?? []).map((r) => ({ term: r.search_term, count: r.listing_count }))
        this.termsLoaded = true
      } catch (err) {
        console.error('[listingsExplorer] fetchTerms error:', err)
        this.error = err.message ?? 'Failed to load search terms.'
      } finally {
        this.termsLoading = false
      }
    },

    async selectTerm(term) {
      this.selectedTerm = term
      this.rows = []
      if (!term) return

      const auth = useAuthStore()
      if (!auth.user) return

      this.rowsLoading = true
      this.error = null
      try {
        const { data, error } = await supabase
          .from('listings')
          .select('*')
          .eq('user_id', auth.user.id)
          .eq('search_term', term)
          .order('date_inserted', { ascending: false })

        if (error) throw error
        this.rows = (data ?? []).map(this._mapDbRow).filter(Boolean)
      } catch (err) {
        console.error('[listingsExplorer] selectTerm error:', err)
        this.error = err.message ?? 'Failed to load listings.'
      } finally {
        this.rowsLoading = false
      }
    },

    async deleteListing(id) {
      const idx = this.rows.findIndex((r) => r.id === id)
      if (idx === -1) return
      try {
        const { error } = await supabase.from('listings').delete().eq('id', id)
        if (error) throw error
        this.rows.splice(idx, 1)
        const termEntry = this.terms.find((t) => t.term === this.selectedTerm)
        if (termEntry) termEntry.count -= 1
      } catch (err) {
        console.error('[listingsExplorer] deleteListing error:', err)
        this.error = err.message ?? 'Deletion failed.'
        throw err
      }
    },

    reset() {
      this.terms = []
      this.termsLoaded = false
      this.termsLoading = false
      this.selectedTerm = null
      this.rows = []
      this.rowsLoading = false
      this.error = null
    },
  },
})
