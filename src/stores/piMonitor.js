import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'

export const usePiMonitorStore = defineStore('piMonitor', () => {
  const readings = ref([])
  const loading = ref(false)
  const timeRange = ref('24h')

  const timeRangeOptions = [
    { label: 'Last 6 Hours', value: '6h' },
    { label: 'Last 12 Hours', value: '12h' },
    { label: 'Last 24 Hours', value: '24h' },
    { label: 'Last 3 Days', value: '3d' },
    { label: 'Last 7 Days', value: '7d' },
    { label: 'Last 30 Days', value: '30d' },
    { label: 'All Time', value: 'all' },
  ]

  function getStartDate(range) {
    const now = new Date()
    switch (range) {
      case '6h': return new Date(now - 6 * 60 * 60 * 1000)
      case '12h': return new Date(now - 12 * 60 * 60 * 1000)
      case '24h': return new Date(now - 24 * 60 * 60 * 1000)
      case '3d': return new Date(now - 3 * 24 * 60 * 60 * 1000)
      case '7d': return new Date(now - 7 * 24 * 60 * 60 * 1000)
      case '30d': return new Date(now - 30 * 24 * 60 * 60 * 1000)
      default: return null
    }
  }

  async function fetchReadings() {
    loading.value = true
    try {
      let query = supabase
        .from('pi_monitor')
        .select('*')
        .order('timestamp', { ascending: true })

      const start = getStartDate(timeRange.value)
      if (start) {
        query = query.gte('timestamp', start.toISOString())
      }

      const { data, error } = await query
      if (error) throw error
      readings.value = data || []
    } catch (err) {
      console.error('Failed to fetch pi monitor readings:', err)
      readings.value = []
    } finally {
      loading.value = false
    }
  }

  const latest = computed(() => {
    if (!readings.value.length) return null
    return readings.value[readings.value.length - 1]
  })

  const stats = computed(() => {
    const r = readings.value
    if (!r.length) return null

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
    const min = arr => arr.length ? Math.min(...arr) : null
    const max = arr => arr.length ? Math.max(...arr) : null
    const field = (name) => r.map(d => d[name]).filter(v => v != null)

    const result = { count: r.length }
    for (const k of ['ping_avg', 'packet_loss', 'dns_resolve_ms', 'cpu_percent', 'mem_percent', 'cpu_temp_c']) {
      const vals = field(k)
      result[k] = { avg: avg(vals), min: min(vals), max: max(vals) }
    }
    return result
  })

  return {
    readings,
    loading,
    timeRange,
    timeRangeOptions,
    fetchReadings,
    latest,
    stats,
  }
})
