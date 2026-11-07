<template>
  <div class="sleep">
    <HealthPanel :accent="SLEEP.light" :loading="hrLoading || (store.loading && !store.ready)">
      <template #title>
        <span class="hx-dot" />
        <h2>Sleep</h2>
        <span v-if="subText" class="hx-panel-sub sub">{{ subText }}</span>
      </template>

      <template #meta>
        <template v-if="view === 'night' && night">
          <div class="hx-stat">
            <span class="hx-stat-label">Asleep</span>
            <span class="hx-stat-value">{{ fmt.duration(night.asleep) }}</span>
          </div>
          <div class="hx-stat opt-1">
            <span class="hx-stat-label">Efficiency</span>
            <span class="hx-stat-value">{{ efficiency(night) ?? '–' }}%<small>of {{ fmt.duration(night.inBed) }} in bed</small></span>
          </div>
          <div v-if="hrStats" class="hx-stat opt-2">
            <span class="hx-stat-label">Sleep HR</span>
            <span class="hx-stat-value">{{ hrStats.avg }}<small>bpm · low {{ hrStats.lo }}</small></span>
          </div>
          <div v-if="spo2Stats" class="hx-stat opt-3">
            <span class="hx-stat-label">SpO₂</span>
            <span class="hx-stat-value">{{ spo2Stats.avg }}%<small>low {{ spo2Stats.lo }}%</small></span>
          </div>
        </template>

        <template v-else-if="view === 'history' && historyStats">
          <div class="hx-stat">
            <span class="hx-stat-label">Avg asleep</span>
            <span class="hx-stat-value">{{ fmt.duration(historyStats.asleep) }}</span>
          </div>
          <div class="hx-stat opt-1">
            <span class="hx-stat-label">Avg in bed</span>
            <span class="hx-stat-value">{{ fmt.duration(historyStats.inBed) }}</span>
          </div>
          <div v-if="historyStats.eff != null" class="hx-stat opt-2">
            <span class="hx-stat-label">Efficiency</span>
            <span class="hx-stat-value">{{ Math.round(historyStats.eff) }}%</span>
          </div>
        </template>

        <template v-else-if="view === 'schedule' && scheduleStats">
          <div class="hx-stat">
            <span class="hx-stat-label">Bedtime</span>
            <span class="hx-stat-value">
              {{ clock(scheduleStats.bed) }}<small v-if="scheduleStats.bedSd != null">±{{ Math.round(scheduleStats.bedSd * 60) }}m</small>
            </span>
          </div>
          <div class="hx-stat opt-1">
            <span class="hx-stat-label">Wake</span>
            <span class="hx-stat-value">
              {{ clock(scheduleStats.wake) }}<small v-if="scheduleStats.wakeSd != null">±{{ Math.round(scheduleStats.wakeSd * 60) }}m</small>
            </span>
          </div>
          <div class="hx-stat opt-2">
            <span class="hx-stat-label">Avg in bed</span>
            <span class="hx-stat-value">{{ fmt.duration(scheduleStats.inBed) }}</span>
          </div>
        </template>
      </template>

      <template #actions>
        <HxSegmented v-if="store.nights.length" v-model="view" :options="VIEWS" />
      </template>

      <!-- Nothing yet -->
      <div v-if="!store.nights.length" class="hx-empty">
        <template v-if="store.ready">
          <svg class="empty-moon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
          </svg>
          No sleep recorded yet — wear the watch overnight.
        </template>
      </div>

      <!-- Night -->
      <template v-else-if="view === 'night' && night">
        <div class="night-bar">
          <button class="hx-btn nav" :disabled="index <= 0" title="Previous night" @click="step(-1)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
          </button>
          <div class="night-date">
            <strong>{{ nightTitle }}</strong>
            <span class="night-span">{{ fmt.time(night.start) }} → {{ fmt.time(night.end) }}</span>
            <span v-if="napMinutes" class="night-nap">+ nap {{ fmt.duration(napMinutes) }}</span>
          </div>
          <button class="hx-btn nav" :disabled="index >= store.nights.length - 1" title="Next night" @click="step(1)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
          </button>
          <div class="night-tools">
            <span v-if="nightHr.length" class="overlay-key hr"><i />Heart rate</span>
            <span v-if="nightSpo2.length" class="overlay-key spo2"><i />SpO₂</span>
            <button
              class="hx-btn"
              title="Show this night in the minute heart-rate chart"
              @click="store.focusRange(night.start, night.end)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8.5h3l1.5-4 3 8 1.5-4h4" /></svg>
              <span class="btn-label">HR detail</span>
            </button>
          </div>
        </div>

        <SleepHypnogram :session="night.main" :hr="nightHr" :spo2="nightSpo2" />

        <div class="hx-keys keys">
          <span v-for="k in nightKeys" :key="k.key" class="hx-key" :title="`${k.label}: ${k.pct}% of the night`">
            <i :style="{ background: k.color }" />{{ k.label }}
            <b>{{ fmt.duration(k.min) }}</b><em>{{ k.pct }}%</em>
          </span>
        </div>
      </template>

      <!-- History -->
      <template v-else-if="view === 'history'">
        <SleepHistory :nights="store.nights" :visible="HISTORY_WINDOW" @select="openNight" />
        <div class="hx-keys keys">
          <span class="keys-label">Avg</span>
          <span v-for="k in historyKeys" :key="k.key" class="hx-key">
            <i :style="{ background: k.color }" />{{ k.label }}<b>{{ fmt.duration(k.min) }}</b>
          </span>
          <span class="hx-key band"><i />7–9 h</span>
        </div>
      </template>

      <!-- Schedule -->
      <template v-else-if="view === 'schedule'">
        <SleepClock :nights="store.nights" :count="SCHEDULE_NIGHTS" @select="openNight" />
        <div class="hx-keys keys">
          <span v-for="r in KEY_ORDER" :key="r" class="hx-key"><i :style="{ background: STAGE[r].color }" />{{ STAGE[r].label }}</span>
          <span class="hx-key usual"><i />Usual window</span>
        </div>
      </template>
    </HealthPanel>
  </div>
</template>

<script setup>
// Sleep (grid area "sleep"): one night as a hypnogram, nightly history, and
// the bed/wake schedule as a 24-hour clock.
import { ref, shallowRef, computed, watch } from 'vue'
import dayjs from 'dayjs'
import HealthPanel from './HealthPanel.vue'
import HxSegmented from './HxSegmented.vue'
import SleepHypnogram from './SleepHypnogram.vue'
import SleepHistory from './SleepHistory.vue'
import SleepClock from './SleepClock.vue'
import { SLEEP, fmt } from '@/lib/health/theme'
import { stageMinutes } from '@/lib/health/metrics'
import { useHealthStore } from '@/stores/health'
import { STAGE, KEY_ORDER, HOUR, noonBefore, clock, mean, spread, efficiency, share } from './SleepShared'

const store = useHealthStore()

const VIEWS = [
  { label: 'Night', value: 'night' },
  { label: 'History', value: 'history' },
  { label: 'Schedule', value: 'schedule' },
]
const HISTORY_WINDOW = 30
const SCHEDULE_NIGHTS = 14

const view = ref('night')

// ── Selected night (null = follow the latest) ──
const selectedKey = ref(null)

const index = computed(() => {
  const ns = store.nights
  if (!ns.length) return -1
  const i = selectedKey.value ? ns.findIndex((n) => n.key === selectedKey.value) : -1
  return i >= 0 ? i : ns.length - 1
})
const night = computed(() => store.nights[index.value] || null)

function step(dir) {
  const ns = store.nights
  const i = index.value + dir
  if (i < 0 || i >= ns.length) return
  selectedKey.value = i === ns.length - 1 ? null : ns[i].key
}

function openNight(key) {
  selectedKey.value = key === store.nights.at(-1)?.key ? null : key
  view.value = 'night'
}

const nightTitle = computed(() => {
  const d = dayjs(night.value.key)
  if (d.isSame(dayjs(), 'day')) return `Last night · ${d.format('ddd D MMM')}`
  return d.format('ddd D MMM')
})

// Other sessions that ended the same day (naps) — counted in the totals, not drawn.
const napMinutes = computed(() => {
  const n = night.value
  if (!n || n.sessions.length < 2) return 0
  return n.sessions
    .filter((s) => s !== n.main)
    .reduce((a, s) => {
      const m = stageMinutes(s)
      return a + m.rem + m.light + m.deep
    }, 0)
})

// ── Heart rate during the selected night (fetched on demand, cached) ──
const hrCache = shallowRef(new Map())
const hrLoading = ref(false)
let hrSeq = 0

const hrKey = (n) => `${n.key}:${n.start}:${n.end}`

watch(
  () => [night.value && hrKey(night.value), store.sources.heart_rate],
  async () => {
    const n = night.value
    if (!n || !store.sources.heart_rate || hrCache.value.has(hrKey(n))) return
    const seq = ++hrSeq
    hrLoading.value = true
    try {
      const data = await store.query('health_points', 'heart_rate', {
        p_metric: 'heart_rate',
        p_start: new Date(n.start).toISOString(),
        p_end: new Date(n.end).toISOString(),
      })
      const next = new Map(hrCache.value)
      next.set(hrKey(n), (data || []).map(([t, , v]) => [t, v]))
      hrCache.value = next
    } catch (err) {
      console.error('Sleep heart rate:', err)
    } finally {
      if (seq === hrSeq) hrLoading.value = false
    }
  },
  { immediate: true },
)

const nightHr = computed(() => (night.value && hrCache.value.get(hrKey(night.value))) || [])

const nightSpo2 = computed(() => {
  const n = night.value
  const pts = store.vitals.spo2
  if (!n || !pts) return []
  return pts.filter(([t]) => t >= n.start && t <= n.end)
})

const hrStats = computed(() => {
  const v = nightHr.value.map((p) => p[1])
  return v.length ? { avg: Math.round(mean(v)), lo: Math.round(Math.min(...v)) } : null
})

const spo2Stats = computed(() => {
  const v = nightSpo2.value.map((p) => p[1])
  return v.length ? { avg: Math.round(mean(v)), lo: Math.round(Math.min(...v)) } : null
})

const nightKeys = computed(() => {
  const n = night.value
  if (!n) return []
  const total = KEY_ORDER.reduce((a, k) => a + n.mins[k], 0)
  return KEY_ORDER.map((k) => ({
    key: k,
    label: STAGE[k].label,
    color: STAGE[k].color,
    min: n.mins[k],
    pct: share(n.mins[k], total),
  }))
})

// ── History / schedule summaries ──
const historyNights = computed(() => store.nights.slice(-HISTORY_WINDOW))

const historyStats = computed(() => {
  const ns = historyNights.value
  if (!ns.length) return null
  return {
    asleep: mean(ns.map((n) => n.asleep)),
    inBed: mean(ns.map((n) => n.inBed)),
    eff: mean(ns.map(efficiency).filter((v) => v != null)),
  }
})

const historyKeys = computed(() =>
  KEY_ORDER.map((k) => ({
    key: k,
    label: STAGE[k].label,
    color: STAGE[k].color,
    min: mean(historyNights.value.map((n) => n.mins[k])) ?? 0,
  })),
)

const scheduleStats = computed(() => {
  const ns = store.nights.slice(-SCHEDULE_NIGHTS)
  if (!ns.length) return null
  const beds = ns.map((n) => (n.start - noonBefore(n.key)) / HOUR)
  const wakes = ns.map((n) => (n.end - noonBefore(n.key)) / HOUR)
  return {
    bed: mean(beds),
    bedSd: spread(beds),
    wake: mean(wakes),
    wakeSd: spread(wakes),
    inBed: mean(ns.map((n) => n.inBed)),
  }
})

const subText = computed(() => {
  const count = store.nights.length
  if (!count || view.value === 'night') return ''
  const n = Math.min(count, view.value === 'history' ? HISTORY_WINDOW : SCHEDULE_NIGHTS)
  return `last ${n} night${n > 1 ? 's' : ''}`
})
</script>

<style scoped>
.sleep {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
}

.sleep > .hx-panel {
  flex: 1;
}

.night-bar {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 1.625rem;
  margin-bottom: 0.25rem;
  flex-shrink: 0;
}

.hx-btn svg {
  width: 0.875rem;
  height: 0.875rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hx-btn.nav {
  height: 1.5rem;
  min-width: 1.5rem;
  padding: 0;
}

.night-date {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
  padding: 0 0.25rem;
}

.night-date strong {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--hx-text);
  white-space: nowrap;
}

.night-span {
  font-size: 0.75rem;
  color: var(--hx-text3);
  white-space: nowrap;
}

.night-nap {
  padding: 0 0.375rem;
  font-size: 0.6875rem;
  color: var(--hx-text3);
  border: 1px solid var(--hx-border2);
  border-radius: 999px;
  white-space: nowrap;
}

.night-tools {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-left: auto;
}

.night-tools .hx-btn {
  height: 1.5rem;
}

.overlay-key {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  color: var(--hx-text3);
  white-space: nowrap;
}

.overlay-key.hr i {
  width: 0.75rem;
  height: 2px;
  border-radius: 1px;
  background: var(--hx-hr);
}

.overlay-key.spo2 i {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: var(--hx-spo2);
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--hx-spo2) 18%, transparent);
}

.keys {
  flex-shrink: 0;
  justify-content: center;
  margin-top: 0.375rem;
}

.keys b {
  margin-left: 0.25rem;
  font-weight: 600;
  color: var(--hx-text);
}

.keys em {
  margin-left: 0.25rem;
  font-style: normal;
  color: var(--hx-text3);
}

.keys-label {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--hx-text3);
}

/* Matches the history chart's 7–9 h band. */
.hx-key.band i {
  width: 0.75rem;
  background: color-mix(in srgb, var(--hx-sleep-light) 10%, transparent);
  border: 1px dashed color-mix(in srgb, var(--hx-sleep-light) 55%, transparent);
}

.hx-key.usual i {
  width: 0.875rem;
  height: 2px;
  border-radius: 1px;
  background: var(--hx-sleep-light);
}

.empty-moon {
  width: 1.375rem;
  height: 1.375rem;
  fill: color-mix(in srgb, var(--hx-sleep-light) 35%, transparent);
  stroke: var(--hx-sleep-light);
  stroke-width: 1.2;
  stroke-linejoin: round;
}

/* Header stats give way first, then the night bar's extras. */
@container (max-width: 46rem) {
  .opt-3 {
    display: none;
  }
}

@container (max-width: 40rem) {
  .opt-2 {
    display: none;
  }
}

@container (max-width: 34rem) {
  .opt-1,
  .sub,
  .overlay-key,
  .keys em,
  .hx-key.band {
    display: none;
  }
}

@container (max-width: 28rem) {
  .hx-stat,
  .btn-label,
  .night-nap {
    display: none;
  }
}

@container (max-width: 22rem) {
  .night-span {
    display: none;
  }
}
</style>
