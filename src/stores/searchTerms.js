// src/stores/searchTerms.js
import { defineStore } from 'pinia'
import { supabase }    from '@/lib/supabase'
import dayjs           from 'dayjs'

export const useSearchTerms = defineStore('searchTerms', {
  state: () => ({
    terms: []
  }),

  getters: {
    termsByMarketplace: state => marketplace =>
      state.terms.filter(t => t.marketplace === marketplace)
  },

  actions: {
    _upsertLocal(row) {
      console.log('[searchTerms] _upsertLocal:', row)
      const i = this.terms.findIndex(t => t.id === row.id)
      if (i === -1) this.terms.push(row)
      else this.terms[i] = row
    },

    _mergePrice(row) {
      console.log('[searchTerms] _mergePrice for term:', row.search_term, row)
      const term = this.terms.find(t => t.term === row.search_term)
      if (!term) {
        console.warn('[searchTerms] _mergePrice: no matching term for', row.search_term)
        return
      }
      term.currentPrice = row.current_lowest_price
      term.lastChanged  = row.latest_date
      term.link         = row.link

      if (term.lowestPrice == null || row.current_lowest_price < term.lowestPrice) {
        term.lowestPrice = row.current_lowest_price
      }
    },

    async fetchAll() {
      console.log('[searchTerms] fetchAll: start')
      try {
        const { data: jobs, error: e1 } = await supabase
          .from('scrape_jobs')
          .select('*')
        if (e1) throw e1
        console.log('[searchTerms] fetchAll: loaded jobs count', jobs.length)

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
        console.log('[searchTerms] fetchAll: loaded prices count', prices.length)
        prices.forEach(this._mergePrice)

        console.log('[searchTerms] fetchAll: initializing realtime')
        this.initRealtime()
        console.log('[searchTerms] fetchAll: done')
      } catch (error) {
        console.error('[searchTerms] fetchAll error:', error)
        throw error
      }
    },

    async addTerm({ marketplace, term, primeOnly, include, exclude }) {
      console.log('[searchTerms] addTerm:', term)
      const { data, error } = await supabase
        .from('scrape_jobs')
        .insert({
          source:        marketplace,
          search_term:   term,
          include_terms: include,
          exclude_terms: exclude,
          exclude_zoom:  primeOnly
        })
        .select('*')
        .single()
      if (error) {
        console.error('[searchTerms] addTerm error:', error)
        throw error
      }
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

    async removeTerm(id) {
      console.log('[searchTerms] removeTerm:', id)
      const { error } = await supabase
        .from('scrape_jobs')
        .delete()
        .eq('id', id)
      if (error) {
        console.error('[searchTerms] removeTerm error:', error)
        throw error
      }
      this.terms = this.terms.filter(t => t.id !== id)
    },

    initRealtime() {
      console.log('[searchTerms] initRealtime: subscribing to channels')

      console.log('[searchTerms] subscribe scrape_jobs_live')
      supabase
        .channel('scrape_jobs_live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'scrape_jobs' }, payload => {
          const { eventType, new: n, old } = payload
          console.log('[searchTerms] scrape_jobs_live event:', eventType, payload)
          if (eventType === 'DELETE') {
            this.removeTerm(old.id)
          } else {
            this._upsertLocal({
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
          }
        })
        .subscribe()

      console.log('[searchTerms] subscribe prices_live')
      supabase
        .channel('prices_live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, payload => {
          console.log('[searchTerms] prices_live event, refreshing prices:', payload)
          this.refreshPrices()
        })
        .subscribe()

    },

    async refreshPrices() {
      console.log('[searchTerms] refreshPrices: start')
      const { data, error } = await supabase.rpc('current_low_query')
      if (error) {
        console.error('[searchTerms] refreshPrices error:', error)
        return
      }
      console.log('[searchTerms] refreshPrices: fetched rows count', data.length)
      data.forEach(this._mergePrice)
      console.log('[searchTerms] refreshPrices: merged prices')
    }
  },

  persist: false
})
