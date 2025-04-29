import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'

export const useDashboardStore = defineStore('dashboard', {
  state: () => ({
    rawTimeline: [],       // full data from Supabase
    selectedTerms: [],     // array of selected search_terms
    selectedSources: [],   // array of selected sources
  }),
  getters: {
    // unique lists for the dropdown filters
    allTerms: (state) => [...new Set(state.rawTimeline.map(r => r.search_term))],
    allSources: (state) => [...new Set(state.rawTimeline.map(r => r.source))],

    // filtered timeline based on selections
    filtered: (state) => {
      return state.rawTimeline.filter(r =>
        (state.selectedTerms.length === 0 || state.selectedTerms.includes(r.search_term)) &&
        (state.selectedSources.length === 0 || state.selectedSources.includes(r.source))
      )
    },

    // shape data for ECharts: returns { dates, series: { [term_source]: { minPrices:[], offers:[] } } }
    chartData: (state) => {
      const byDate = {}
      state.filtered.forEach(({ the_date, search_term, source, min_price, offers }) => {
        if (!byDate[the_date]) byDate[the_date] = {}
        const key = `${search_term}__${source}`
        byDate[the_date][key] = {
          min_price: Number(min_price),
          offers: Number(offers),
        }
      })
      const dates = Object.keys(byDate).sort()
      // build series
      const series = {}
      dates.forEach(date => {
        Object.entries(byDate[date]).forEach(([key, vals]) => {
          if (!series[key]) series[key] = { minPrices: [], offers: [] }
          series[key].minPrices.push(vals.min_price)
          series[key].offers.push(vals.offers)
        })
      })
      return { dates, series }
    }
  },
  actions: {
    async fetchTimeline() {
      const { data, error } = await supabase
        .rpc('get_price_timeline')
      if (error) {
        console.error('Error loading timeline:', error)
        return
      }
      this.rawTimeline = data
      // initialize filters to all options
      this.selectedTerms = this.allTerms
      this.selectedSources = this.allSources
    },
    setTerms(terms) {
      this.selectedTerms = terms
    },
    setSources(sources) {
      this.selectedSources = sources
    }
  }
})