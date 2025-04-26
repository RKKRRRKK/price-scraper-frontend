// src/stores/searchTerms.js
import { defineStore } from 'pinia'
import { supabase }    from '@/lib/supabase'
import dayjs           from 'dayjs'

export const useSearchTerms = defineStore('searchTerms', {
  state: () => ({
    terms: [],
    _subscribed: false
  }),

  getters: {
    termsByMarketplace: s => mp => s.terms.filter(t => t.marketplace === mp)
  },

  actions: {
    _upsertLocal (row) {
      const i = this.terms.findIndex(t => t.id === row.id)
      i === -1 ? this.terms.push(row) : (this.terms[i] = row)
    },

    /* merge result of current_low_query */
    _mergePrice (row) {
      const t = this.terms.find(x => x.term === row.search_term)
      if (!t) return
      t.currentPrice = row.current_lowest_price
      t.lastChanged  = row.latest_date
      t.link         = row.link                    // ← keep the link
      if (t.lowestPrice == null || row.current_lowest_price < t.lowestPrice)
        t.lowestPrice = row.current_lowest_price
    },

    async fetchAll () {
      const { data: jobs,  error: e1 } = await supabase.from('scrape_jobs').select('*')
      if (e1) throw e1
      this.terms = jobs.map(j => ({
        id:           j.id,
        marketplace:  j.source,
        term:         j.search_term,
        primeOnly:    j.exclude_zoom,
        include:      j.include_terms,
        exclude:      j.exclude_terms,
        link:         null,
        currentPrice: null,
        lowestPrice:  null,
        lastChanged:  null
      }))

      const { data: prices, error: e2 } = await supabase.rpc('current_low_query')
      if (e2) throw e2
      prices.forEach(this._mergePrice)

      this.initRealtime()
    },

    async addTerm ({ marketplace, term, primeOnly, include, exclude }) {
      const { data, error } = await supabase.from('scrape_jobs')
        .insert({
          source:        marketplace,
          search_term:   term,
          include_terms: include,
          exclude_terms: exclude,
          exclude_zoom:  primeOnly
        })
        .select('*')
        .single()
      if (error) throw error
      this._upsertLocal({
        id:           data.id,
        marketplace:  data.source,
        term:         data.search_term,
        primeOnly,
        include,
        exclude,
        link:         null,
        currentPrice: null,
        lowestPrice:  null,
        lastChanged:  null
      })
    },

    async removeTerm (id) {
      const { error } = await supabase.from('scrape_jobs').delete().eq('id', id)
      if (error) throw error
      this.terms = this.terms.filter(t => t.id !== id)
    },

    initRealtime () {
      if (this._subscribed) return

      supabase.channel('scrape_jobs_live')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'scrape_jobs' },
          ({ eventType, new: n, old }) => {
            if (eventType === 'DELETE') this.removeTerm(old.id)
            else this._upsertLocal({
              id:           n.id,
              marketplace:  n.source,
              term:         n.search_term,
              primeOnly:    n.exclude_zoom,
              include:      n.include_terms,
              exclude:      n.exclude_terms,
              link:         null,
              currentPrice: null,
              lowestPrice:  null,
              lastChanged:  null
            })
          })
        .subscribe()

      supabase.channel('prices_live')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'listings' },
          () => this.refreshPrices())
        .subscribe()

      this._subscribed = true
    },

    async refreshPrices () {
      const { data, error } = await supabase.rpc('current_low_query')
      if (error) return
      data.forEach(this._mergePrice)
    }
  },

  persist: true
})
