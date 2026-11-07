import { defineStore } from 'pinia'
import { ref, reactive, computed } from 'vue'
import dayjs from 'dayjs'
import { supabase } from '@/lib/supabase'
import { DIRECT_SOURCE, legacySource, stageMinutes } from '@/lib/health/metrics'

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const MIN = 60e3
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const HISTORY_DAYS = 90       // daily totals, sessions, vitals
export const PACE_DAYS = 28          // hourly steps behind "today vs usual"
export const DETAIL_HOURS = [3, 6, 12, 24]
export const TREND_DAYS = [7, 30, 90]
export const STRESS_DAYS = [7, 30, 90]

const DAILY_METRICS = ['steps', 'active_kcal', 'total_kcal', 'distance_m', 'floors', 'stress', 'body_energy', 'skin_temp_c']
const POINT_METRICS = [
  'resting_heart_rate', 'spo2', 'hrv_rmssd', 'respiratory_rate', 'vo2max', 'pai',
  'weight_kg', 'body_fat_pct', 'muscle_kg', 'water_pct', 'bone_kg', 'visceral_fat', 'bmr_kcal', 'bmi',
]
// Scale weigh-ins are sparse (a few a week), so their whole history loads, not just HISTORY_DAYS.
const BODY_METRICS = new Set(['weight_kg', 'body_fat_pct', 'muscle_kg', 'water_pct', 'bone_kg', 'visceral_fat', 'bmr_kcal', 'bmi'])
const BODY_HISTORY_DAYS = 3650
// Minute-level watch series: only their daily means and latest reading go in the overview.
const LATEST_METRICS = ['stress', 'body_energy', 'skin_temp_c']

const SESSION_COLS = 'record_id, kind, start_time, end_time, title, exercise_type, stages, source'
// Workout `details` also holds the HR curve and GPS route (hundreds of KB), so the
// list asks only for the scalar fields; the full object loads when a workout is opened.
const DETAIL_KEYS = {
  xiaomi_type: 'xiaomi_type', kcal: 'kcal', distance_m: 'distance_m', avg_hr: 'avg_hr', max_hr: 'max_hr',
  pace: 'avg_pace_s_per_km', zones: 'hr_zones_s',
}
const SESSION_SELECT = `${SESSION_COLS}, ${Object.entries(DETAIL_KEYS).map(([k, p]) => `d_${k}:details->${p}`).join(', ')}`
const UNDEFINED_COLUMN = '42703'    // health_v2_migration.sql hasn't been run yet

const iso = (ms) => new Date(ms).toISOString()
const dayKey = (ms) => dayjs(ms).format('YYYY-MM-DD')

// The cutover parameters exist only after health_v2_migration.sql; without them a
// call falls back to plain Health Bridge data (and stays there until a reload).
const CUTOVER_ARGS = ['p_legacy_source', 'p_cutover']
const MISSING_FUNCTION = ['PGRST202', '42883']
let cutoverSupported = true

async function rpc(name, args) {
  const hasCutover = CUTOVER_ARGS.some((k) => k in args)
  if (hasCutover && cutoverSupported) {
    const { data, error } = await supabase.rpc(name, args)
    if (!error) return data ?? []
    if (!MISSING_FUNCTION.includes(error.code)) throw error
    cutoverSupported = false
  }
  const plain = Object.fromEntries(Object.entries(args).filter(([k]) => !CUTOVER_ARGS.includes(k)))
  const { data, error } = await supabase.rpc(name, plain)
  if (error) throw error
  return data ?? []
}

export const useHealthStore = defineStore(
  'health',
  () => {
    // ── Per-browser preferences (persisted) ──
    const settings = reactive({ maxHr: 190, stepGoal: 10000 })
    const detailHours = ref(12)
    const trendDays = ref(7)

    // Ticks every minute while the view is open so live windows slide.
    const now = ref(Date.now())
    const ready = ref(false)
    const loading = ref(false)
    const error = ref(null)

    const sources = ref({})      // metric -> { source, legacy, cutover }: the old app's rows (`legacy`) up to Health Bridge's first reading (`cutover`), `source` after
    const link = ref(null)       // { device, last_used_at, created_at }

    const spark = ref([])        // [[ms, bpm]] last 3 h, for the KPI strip
    const daily = ref({})        // metric -> [{ day, total, mean, lo, hi, n }] local days
    const hrDaily = ref([])      // [{ day, lo, p05, mean, hi, n }]
    const vitals = ref({})       // metric -> [[ms, value]]
    const sessions = ref([])     // health_sessions rows, oldest first (`details` = scalar summary or null)
    const detailsReady = ref(true)  // false until health_v2_migration.sql adds health_sessions.details
    const latest = ref({})       // metric -> [ms, value] newest reading of the last 36 h (stress, body energy, skin temp)

    const stressDays = ref(30)       // range behind the stress distribution and daily bars
    const stressDayKey = ref(null)   // local day shown in the stress curve; null = newest day with data
    const stressDay = ref({ key: null, stress: [], energy: [] })   // [[ms, value]] over the local day
    const stressRange = ref([])      // [[ms, mean, lo, hi, n]] 15-minute stress buckets over stressDays
    const stressLoading = ref(false)

    const workoutId = ref(null)      // record_id of the workout opened in the workout panel
    const workoutFull = ref({})      // record_id -> full `details` (HR curve, GPS)
    const workoutLoading = ref(false)
    const stepsHourly = ref([])  // [[ms, total]] last PACE_DAYS days

    const trend = ref([])        // [[ms, mean, lo, hi, n]] hourly heart rate
    const trendLoading = ref(false)

    // Minute-by-minute window. detailEnd null = follow "now".
    const detailEnd = ref(null)
    const detail = ref({ start: 0, end: 0, hr: [], steps: [] })  // hr [[ms, bpm]], steps [[start, end, n]]
    const detailLoading = ref(false)

    function fail(err) {
      console.error('Health:', err)
      error.value = err?.message || String(err)
    }

    // ── Loaders ──

    async function loadSources() {
      const rows = await rpc('health_sources', { p_start: iso(Date.now() - HISTORY_DAYS * DAY) })
      const byMetric = {}
      for (const r of rows) (byMetric[r.metric] ||= []).push(r)
      // With Health Bridge rows: the old app's history before its first reading, Health Bridge from then on.
      sources.value = Object.fromEntries(
        Object.entries(byMetric).map(([metric, list]) => {
          const direct = list.find((r) => r.source === DIRECT_SOURCE)
          const legacy = legacySource(list.filter((r) => r.source !== DIRECT_SOURCE))
          if (!direct) return [metric, { source: legacy, legacy: null, cutover: null }]
          return [metric, { source: DIRECT_SOURCE, legacy, cutover: direct.first_at ?? null }]
        }),
      )
    }

    // A health_* query for one metric, filtered to its source(s). Pass the cutover
    // parameters only when it has one.
    function query(name, metric, args) {
      const src = sources.value[metric]
      const extra = src?.cutover && src.legacy ? { p_legacy_source: src.legacy, p_cutover: src.cutover } : {}
      return rpc(name, { ...args, p_source: src?.source ?? null, ...extra })
    }

    async function loadLink() {
      const { data, error: err } = await supabase
        .from('health_ingest_tokens')
        .select('device, last_used_at, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (err) throw err
      link.value = data
    }

    async function loadSpark() {
      if (!sources.value.heart_rate) return (spark.value = [])
      const pts = await query('health_points', 'heart_rate', {
        p_metric: 'heart_rate',
        p_start: iso(Date.now() - 3 * HOUR),
      })
      spark.value = pts.map(([t, , v]) => [t, v])
    }

    // Sessions with a scalar summary of `details`; without the column (42703) the same list minus it.
    async function loadSessions(start) {
      const query = (cols) =>
        supabase.from('health_sessions').select(cols).gte('end_time', start).order('start_time', { ascending: true }).limit(1000)
      let { data, error: err } = await query(SESSION_SELECT)
      detailsReady.value = true
      if (err?.code === UNDEFINED_COLUMN) {
        detailsReady.value = false
        ;({ data, error: err } = await query(SESSION_COLS))
      }
      if (err) throw err
      return (data || []).map((row) => {
        const out = {}
        const details = {}
        for (const [k, v] of Object.entries(row)) {
          if (k.startsWith('d_')) {
            if (v != null) details[k.slice(2)] = v
          } else out[k] = v
        }
        return { ...out, details: Object.keys(details).length ? details : null }
      })
    }

    async function loadLatest() {
      const from = iso(Date.now() - 36 * HOUR)
      const out = {}
      await Promise.all(LATEST_METRICS.map(async (m) => {
        if (!sources.value[m]) return
        const pts = await query('health_points', m, { p_metric: m, p_start: from })
        const last = pts.at(-1)
        if (last) out[m] = [last[0], last[2]]
      }))
      latest.value = out
    }

    async function loadOverview() {
      const src = sources.value
      const has = (m) => !!src[m]
      const start = iso(dayjs().subtract(HISTORY_DAYS, 'day').startOf('day').valueOf())
      const paceStart = iso(dayjs().subtract(PACE_DAYS, 'day').startOf('day').valueOf())
      const bodyStart = iso(dayjs().subtract(BODY_HISTORY_DAYS, 'day').startOf('day').valueOf())

      const [dailyRows, hrRows, pointRows, stepRows, sessionRes] = await Promise.all([
        Promise.all(DAILY_METRICS.map((m) =>
          has(m) ? query('health_daily', m, { p_metric: m, p_tz: tz, p_start: start }) : [],
        )),
        has('heart_rate') ? query('health_hr_daily', 'heart_rate', { p_tz: tz, p_start: start }) : [],
        Promise.all(POINT_METRICS.map((m) =>
          has(m) ? query('health_points', m, { p_metric: m, p_start: BODY_METRICS.has(m) ? bodyStart : start }) : [],
        )),
        has('steps')
          ? query('health_buckets', 'steps', { p_metric: 'steps', p_bucket_seconds: 3600, p_start: paceStart })
          : [],
        loadSessions(start),
        loadLink(),
        loadLatest(),
      ])

      daily.value = Object.fromEntries(
        DAILY_METRICS.map((m, i) => [m, dailyRows[i].map((r) => ({ ...r, day: String(r.day).slice(0, 10) }))]),
      )
      hrDaily.value = hrRows.map((r) => ({ ...r, day: String(r.day).slice(0, 10) }))
      vitals.value = Object.fromEntries(
        POINT_METRICS.map((m, i) => [m, pointRows[i].map(([t, , v]) => [t, v])]).filter(([, pts]) => pts.length),
      )
      stepsHourly.value = stepRows.map(([t, , , , total]) => [t, total])

      // Sleep and workouts can come from more than one app too. Same cutover as the
      // samples: the old app's sessions before Health Bridge's first one of that kind.
      const rows = sessionRes
      const keep = {}
      for (const kind of ['sleep', 'exercise']) {
        const counts = {}
        let cutover = Infinity
        for (const s of rows) {
          if (s.kind !== kind) continue
          counts[s.source] = (counts[s.source] || 0) + 1
          if (s.source === DIRECT_SOURCE) cutover = Math.min(cutover, new Date(s.start_time).getTime())
        }
        const legacy = legacySource(Object.entries(counts).filter(([s]) => s !== DIRECT_SOURCE).map(([source, n]) => ({ source, n })))
        keep[kind] = { legacy, cutover }
      }
      sessions.value = rows.filter((s) => {
        const k = keep[s.kind]
        return s.source === DIRECT_SOURCE || (s.source === k.legacy && new Date(s.start_time).getTime() < k.cutover)
      })
    }

    async function loadTrend() {
      if (!sources.value.heart_rate) return (trend.value = [])
      trendLoading.value = true
      try {
        const rows = await query('health_buckets', 'heart_rate', {
          p_metric: 'heart_rate',
          p_bucket_seconds: 3600,
          p_start: iso(dayjs().subtract(trendDays.value, 'day').startOf('day').valueOf()),
        })
        trend.value = rows.map(([t, mean, lo, hi, , n]) => [t, mean, lo, hi, n])
      } catch (err) {
        fail(err)
      } finally {
        trendLoading.value = false
      }
    }

    let detailSeq = 0
    async function loadDetail() {
      const { start, end, live } = detailRange.value
      const seq = ++detailSeq
      detailLoading.value = true
      try {
        const window = (metric) => ({
          p_metric: metric,
          p_start: iso(start),
          p_end: live ? null : iso(end),
        })
        const [hr, steps] = await Promise.all([
          sources.value.heart_rate ? query('health_points', 'heart_rate', window('heart_rate')) : [],
          // Steps come in 30-minute blocks; reach back one block so the first bar isn't cut.
          sources.value.steps ? query('health_points', 'steps', { ...window('steps'), p_start: iso(start - 30 * MIN) }) : [],
        ])
        if (seq !== detailSeq) return
        detail.value = { start, end, hr: hr.map(([t, , v]) => [t, v]), steps }
      } catch (err) {
        fail(err)
      } finally {
        if (seq === detailSeq) detailLoading.value = false
      }
    }

    // ── Stress: one local day as a curve, plus a longer range for the distribution ──

    const stressKey = computed(() => stressDayKey.value ?? daily.value.stress?.at(-1)?.day ?? todayKey.value)

    let stressSeq = 0
    async function loadStressDay() {
      const src = sources.value
      const key = stressKey.value
      const seq = ++stressSeq
      if (!src.stress) return (stressDay.value = { key, stress: [], energy: [] })
      const from = dayjs(key).startOf('day')
      const win = (metric) => ({
        p_metric: metric,
        p_start: iso(from.valueOf()),
        p_end: iso(from.add(1, 'day').valueOf()),
      })
      const [stress, energy] = await Promise.all([
        query('health_points', 'stress', win('stress')),
        src.body_energy ? query('health_points', 'body_energy', win('body_energy')) : [],
      ])
      if (seq !== stressSeq) return
      stressDay.value = { key, stress: stress.map(([t, , v]) => [t, v]), energy: energy.map(([t, , v]) => [t, v]) }
    }

    async function loadStressRange() {
      if (!sources.value.stress) return (stressRange.value = [])
      const rows = await query('health_buckets', 'stress', {
        p_metric: 'stress',
        p_bucket_seconds: 900,
        p_start: iso(dayjs().subtract(stressDays.value, 'day').startOf('day').valueOf()),
      })
      stressRange.value = rows.map(([t, mean, lo, hi, , n]) => [t, mean, lo, hi, n])
    }

    async function loadStress() {
      stressLoading.value = true
      try {
        await Promise.all([loadStressDay(), loadStressRange()])
      } catch (err) {
        fail(err)
      } finally {
        stressLoading.value = false
      }
    }

    function setStressDays(d) {
      stressDays.value = d
      stressLoading.value = true
      loadStressRange().catch(fail).finally(() => (stressLoading.value = false))
    }

    // dir -1 = earlier, +1 = later; stops at today.
    function shiftStressDay(dir) {
      const next = dayjs(stressKey.value).add(dir, 'day').format('YYYY-MM-DD')
      if (next > todayKey.value) return
      stressDayKey.value = next === todayKey.value ? null : next
      stressLoading.value = true
      loadStressDay().catch(fail).finally(() => (stressLoading.value = false))
    }

    function selectStressDay(key) {
      stressDayKey.value = key >= todayKey.value ? null : key
      stressLoading.value = true
      loadStressDay().catch(fail).finally(() => (stressLoading.value = false))
    }

    // ── Workout detail (HR curve, GPS) ──

    const workout = computed(
      () => workouts.value.find((w) => w.record_id === workoutId.value)
        ?? workouts.value.find((w) => w.details)
        ?? null,
    )
    const workoutDetails = computed(() => (workout.value ? workoutFull.value[workout.value.record_id] ?? null : null))
    const hasWorkoutDetails = computed(() => workouts.value.some((w) => w.details))

    async function ensureWorkout() {
      const w = workout.value
      if (!w?.details || workoutFull.value[w.record_id]) return
      workoutLoading.value = true
      try {
        const { data, error: err } = await supabase
          .from('health_sessions')
          .select('details')
          .eq('record_id', w.record_id)
          .maybeSingle()
        if (err) throw err
        workoutFull.value = { ...workoutFull.value, [w.record_id]: data?.details ?? {} }
      } catch (err) {
        fail(err)
      } finally {
        workoutLoading.value = false
      }
    }

    function selectWorkout(id) {
      workoutId.value = id
      ensureWorkout()
    }

    async function refresh() {
      loading.value = true
      error.value = null
      try {
        await loadSources()
        await Promise.all([loadOverview(), loadTrend(), loadDetail(), loadSpark()])
        ready.value = true
        await Promise.all([loadStress(), ensureWorkout()])
      } catch (err) {
        fail(err)
      } finally {
        loading.value = false
      }
    }

    // ── Live updates (data lands every 15+ min, so this is plenty) ──
    let timer = null
    let ticks = 0
    function startPolling() {
      stopPolling()
      timer = setInterval(() => {
        now.value = Date.now()
        ticks++
        if (ticks % 10 === 0) refresh()
        else if (ticks % 2 === 0) {
          loadSpark().catch(fail)
          loadLatest().catch(fail)
          loadLink().catch(fail)
          if (detailEnd.value == null) loadDetail()
        }
      }, MIN)
    }
    function stopPolling() {
      clearInterval(timer)
      timer = null
    }

    // ── Minute-detail window ──

    const detailRange = computed(() => {
      const end = detailEnd.value ?? now.value
      return { start: end - detailHours.value * HOUR, end, live: detailEnd.value == null }
    })

    function setDetailHours(h) {
      detailHours.value = h
      loadDetail()
    }

    // dir -1 = earlier, +1 = later, by half a window.
    function shiftDetail(dir) {
      now.value = Date.now()
      const end = detailRange.value.end + (dir * detailHours.value * HOUR) / 2
      detailEnd.value = end >= now.value - MIN ? null : end
      loadDetail()
    }

    function goLive() {
      now.value = Date.now()
      detailEnd.value = null
      loadDetail()
    }

    // Show [from, to] — a clicked hour, a workout, a night — in the smallest
    // preset window that fits, centred.
    function focusRange(from, to) {
      now.value = Date.now()
      const span = (to - from) * 1.15
      const hours = DETAIL_HOURS.find((h) => h * HOUR >= span) ?? DETAIL_HOURS.at(-1)
      const end = (from + to) / 2 + (hours * HOUR) / 2
      detailHours.value = hours
      detailEnd.value = end >= now.value ? null : end
      loadDetail()
    }

    function setTrendDays(d) {
      trendDays.value = d
      loadTrend()
    }

    // ── Derived ──

    const hasData = computed(() => Object.keys(sources.value).length > 0)
    const todayKey = computed(() => dayKey(now.value))

    function dayTotal(metric, key = todayKey.value) {
      if (!sources.value[metric]) return null
      return daily.value[metric]?.find((d) => d.day === key)?.total ?? 0
    }

    const latestHr = computed(() => {
      const last = spark.value.at(-1)
      return last ? { t: last[0], bpm: last[1] } : null
    })

    // One value per local day: the watch's resting HR when it writes one,
    // otherwise the day's 5th-percentile heart rate (needs 2 h+ of readings).
    const resting = computed(() => {
      const pts = vitals.value.resting_heart_rate
      if (pts?.length) {
        const byDay = new Map()
        for (const [t, v] of pts) byDay.set(dayKey(t), v)
        return { estimated: false, days: [...byDay].map(([day, value]) => ({ day, value })) }
      }
      return {
        estimated: true,
        days: hrDaily.value.filter((d) => d.n >= 120).map((d) => ({ day: d.day, value: d.p05 })),
      }
    })

    const sleeps = computed(() => sessions.value.filter((s) => s.kind === 'sleep'))
    const workouts = computed(() => sessions.value.filter((s) => s.kind === 'exercise').slice().reverse())

    // Sleep grouped by the local date it ended on (naps fold into that day).
    // `main` is the longest session — the one bed/wake times come from.
    const nights = computed(() => {
      const map = new Map()
      for (const s of sleeps.value) {
        const key = dayKey(new Date(s.end_time).getTime())
        const n = map.get(key) || { key, sessions: [], mins: { awake: 0, rem: 0, light: 0, deep: 0 } }
        n.sessions.push(s)
        const m = stageMinutes(s)
        for (const k in m) n.mins[k] += m[k]
        map.set(key, n)
      }
      return [...map.values()].map((n) => {
        const dur = (s) => new Date(s.end_time) - new Date(s.start_time)
        const main = n.sessions.reduce((a, b) => (dur(b) > dur(a) ? b : a))
        return {
          ...n,
          main,
          start: new Date(main.start_time).getTime(),
          end: new Date(main.end_time).getTime(),
          asleep: n.mins.rem + n.mins.light + n.mins.deep,
          inBed: n.sessions.reduce((a, s) => a + dur(s) / MIN, 0),
        }
      })
    })

    // Sessions overlapping the minute-detail window (for the sleep / workout bands).
    const detailSessions = computed(() => {
      const { start, end } = detailRange.value
      return sessions.value.filter(
        (s) => new Date(s.end_time).getTime() > start && new Date(s.start_time).getTime() < end,
      )
    })

    // Returns the new phone token (shown once — only its hash is stored).
    async function createToken() {
      const { data, error: err } = await supabase.rpc('health_create_token')
      if (err) throw err
      await loadLink().catch(fail)
      return data
    }

    return {
      settings,
      detailHours,
      trendDays,
      now,
      ready,
      loading,
      error,
      sources,
      link,
      spark,
      daily,
      hrDaily,
      vitals,
      sessions,
      detailsReady,
      latest,
      stressDays,
      stressKey,
      stressDay,
      stressRange,
      stressLoading,
      workout,
      workoutDetails,
      workoutLoading,
      hasWorkoutDetails,
      stepsHourly,
      trend,
      trendLoading,
      detailEnd,
      detail,
      detailLoading,
      detailRange,
      hasData,
      todayKey,
      latestHr,
      resting,
      sleeps,
      workouts,
      nights,
      detailSessions,
      dayTotal,
      refresh,
      loadDetail,
      loadTrend,
      startPolling,
      stopPolling,
      setDetailHours,
      shiftDetail,
      goLive,
      focusRange,
      setTrendDays,
      setStressDays,
      shiftStressDay,
      selectStressDay,
      selectWorkout,
      query,
      createToken,
    }
  },
  { persist: { pick: ['settings', 'detailHours', 'trendDays', 'stressDays'] } },
)
