import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

// Server-side level-of-detail (LoD) queries for the Dashboard.
//
// Grouped folder/file views are aggregated in Postgres (GROUP BY file/term +
// day, via RPCs run once by hand — see the SQL that ships alongside this
// store). The single-item view always queries `listings` scoped to exactly
// one search term. Nothing in here ever pulls the whole `listings` table —
// that's the point: the old Dashboard loaded every row up front and filtered
// client-side, which both didn't scale and made folder/file matching a JS
// Map lookup (fragile) instead of a real SQL join (authoritative).
export const useDashboardData = defineStore('dashboardData', {
  state: () => ({}),
  persist: false,

  actions: {
    _requireUser() {
      const auth = useAuthStore()
      if (!auth.user) throw new Error('Not signed in.')
      return auth.user
    },

    // distinct search terms + offer counts, optionally scoped to file ids
    // (fileIds: null = unrestricted, [] = restricted to nothing, [...] = restricted)
    async fetchTerms(fileIds) {
      this._requireUser()
      const { data, error } = await supabase.rpc('dashboard_terms', { p_file_ids: fileIds })
      if (error) throw error
      return (data ?? []).map((r) => ({ term: r.search_term, count: Number(r.offer_count) }))
    },

    // one row per file per day: avg price + offer count
    async fetchAggByFile(fileIds, sinceIso, excludeOutliers) {
      this._requireUser()
      const { data, error } = await supabase.rpc('dashboard_agg_by_file', {
        p_file_ids: fileIds,
        p_since: sinceIso,
        p_exclude_outliers: !!excludeOutliers,
      })
      if (error) throw error
      return (data ?? []).map((r) => ({
        key: r.file_id,
        name: r.file_name,
        date: r.day,
        avgPrice: Number(r.avg_price),
        count: Number(r.offer_count),
      }))
    },

    // one row per search term per day: avg price + offer count
    async fetchAggByTerm(fileIds, sinceIso, excludeOutliers) {
      this._requireUser()
      const { data, error } = await supabase.rpc('dashboard_agg_by_term', {
        p_file_ids: fileIds,
        p_since: sinceIso,
        p_exclude_outliers: !!excludeOutliers,
      })
      if (error) throw error
      return (data ?? []).map((r) => ({
        key: r.search_term,
        name: r.search_term,
        date: r.day,
        avgPrice: Number(r.avg_price),
        count: Number(r.offer_count),
      }))
    },

    // summary stats (mean/median/stddev/quartiles/trend/outlier fences), all
    // computed in SQL. Pass either `fileIds` (folder/file scope) or `term`
    // (single-item scope) — not both; `term` wins if both happen to be set.
    async fetchStats({ fileIds = null, term = null, sinceIso = null, excludeOutliers = false } = {}) {
      this._requireUser()
      const { data, error } = await supabase.rpc('dashboard_stats', {
        p_file_ids: term ? null : fileIds,
        p_search_term: term,
        p_since: sinceIso,
        p_exclude_outliers: !!excludeOutliers,
      })
      if (error) throw error
      const r = data?.[0]
      if (!r || Number(r.offer_count) === 0) return null
      return {
        count: Number(r.offer_count),
        rawCount: Number(r.raw_offer_count ?? r.offer_count),
        min: Number(r.min_price),
        mean: Number(r.mean_price),
        median: Number(r.median_price),
        stdDev: Number(r.stddev_price ?? 0),
        q1: Number(r.q1_price),
        q3: Number(r.q3_price),
        fenceLower: r.fence_lower == null ? null : Number(r.fence_lower),
        fenceUpper: r.fence_upper == null ? null : Number(r.fence_upper),
        totalChange: r.trend_total == null ? null : Number(r.trend_total),
        pctChange: r.trend_pct == null ? null : Number(r.trend_pct),
        spanDays: Math.max(1, Math.round(Number(r.span_days ?? 1))),
        outlierCount: Number(r.outlier_count ?? 0),
      }
    },

    // raw listings for exactly one search term — the only place this store
    // touches `listings` directly rather than through an aggregating RPC.
    async fetchTermRows(term, sinceIso) {
      const user = this._requireUser()
      let q = supabase
        .from('listings')
        .select('*')
        .eq('user_id', user.id)
        .eq('search_term', term)
        .order('date_inserted', { ascending: true })
      if (sinceIso) q = q.gte('date_inserted', sinceIso)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []).map((row) => ({
        id: row.id,
        search_term: row.search_term,
        title: row.title,
        price: row.price,
        currency: row.currency,
        condition: row.condition,
        url: row.url,
        date_inserted: row.date_inserted,
        source: row.source,
      }))
    },
  },
})
