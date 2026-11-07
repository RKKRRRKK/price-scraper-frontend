<template>
  <div class="kpis">
    <!-- Heart rate now -->
    <div class="kpi" :style="{ '--accent': P.hr }">
      <div class="kpi-top">
        <span><i class="pi pi-heart-fill" />Heart rate</span>
        <span v-if="hr" :title="fmt.dayTime(hr.t)">{{ fmt.ago(hr.t) }}</span>
      </div>
      <div class="kpi-main">
        <span class="kpi-value">{{ hr ? Math.round(hr.bpm) : '–' }}</span>
        <span class="kpi-unit">bpm</span>
        <svg v-if="hrSpark" class="kpi-viz" viewBox="0 0 120 32" preserveAspectRatio="none">
          <defs>
            <linearGradient id="kpi-hr-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" :stop-color="P.hr" stop-opacity="0.35" />
              <stop offset="1" :stop-color="P.hr" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path :d="hrSpark.area" fill="url(#kpi-hr-fill)" />
          <path :d="hrSpark.line" fill="none" :stroke="P.hr" stroke-width="1.5" vector-effect="non-scaling-stroke" />
        </svg>
      </div>
      <div class="kpi-sub">
        <template v-if="hr">
          <span class="chip" :style="{ color: zone.key === 'rest' ? P.text2 : zone.color }">{{ zone.label }}</span>
          <span v-if="sparkRange">{{ sparkRange.lo }}–{{ sparkRange.hi }} last 3 h</span>
        </template>
        <template v-else>No reading in the last 3 h</template>
      </div>
    </div>

    <!-- Resting heart rate -->
    <div class="kpi" :style="{ '--accent': P.resting }">
      <div class="kpi-top">
        <span :title="store.resting.estimated ? 'Lowest 5% of the day\'s readings — the watch hasn\'t sent a resting value' : ''">
          <i class="pi pi-moon" />Resting{{ store.resting.estimated ? ' · est.' : '' }}
        </span>
      </div>
      <div class="kpi-main">
        <span class="kpi-value">{{ rest ? Math.round(rest.value) : '–' }}</span>
        <span class="kpi-unit">bpm</span>
        <svg v-if="restSpark" class="kpi-viz" viewBox="0 0 120 32" preserveAspectRatio="none">
          <path :d="restSpark.line" fill="none" :stroke="P.resting" stroke-width="1.5" vector-effect="non-scaling-stroke" />
          <circle v-for="(d, i) in restSpark.dots" :key="i" :cx="d[0]" :cy="d[1]" r="1.6" :fill="P.resting" />
        </svg>
      </div>
      <div class="kpi-sub">
        <template v-if="restDelta != null">
          <span :class="['delta', restDelta > 0 ? 'up' : 'down']">
            {{ restDelta > 0 ? '▲' : '▼' }} {{ Math.abs(restDelta).toFixed(1) }}
          </span>
          vs 7-day avg
        </template>
        <template v-else-if="rest">{{ fmt.day(rest.day) }}</template>
        <template v-else>Needs a few hours of wear</template>
      </div>
    </div>

    <!-- Steps today -->
    <div class="kpi" :style="{ '--accent': P.steps }">
      <div class="kpi-top">
        <span><i class="pi pi-directions" />Steps today</span>
      </div>
      <div class="kpi-main">
        <span class="kpi-value">{{ fmt.int(steps) }}</span>
        <svg class="kpi-ring" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15" fill="none" :stroke="P.panel2" stroke-width="4" />
          <circle
            cx="18" cy="18" r="15" fill="none" :stroke="P.steps" stroke-width="4" stroke-linecap="round"
            :stroke-dasharray="`${Math.min(stepPct, 1) * 94.25} 94.25`" transform="rotate(-90 18 18)"
          />
          <text x="18" y="21" text-anchor="middle" :fill="P.text" font-size="8" font-weight="600">
            {{ Math.round(stepPct * 100) }}%
          </text>
        </svg>
      </div>
      <div class="kpi-sub">
        of {{ fmt.int(store.settings.stepGoal) }}<template v-if="stepsAvg != null"> · avg {{ fmt.int(stepsAvg) }}</template>
      </div>
    </div>

    <!-- Last sleep -->
    <div class="kpi" :style="{ '--accent': SLEEP.light }">
      <div class="kpi-top">
        <span><i class="pi pi-moon" />Sleep</span>
        <span v-if="night">{{ nightLabel }}</span>
      </div>
      <div class="kpi-main">
        <span class="kpi-value">{{ night ? fmt.duration(night.asleep) : '–' }}</span>
      </div>
      <div v-if="night" class="stage-bar">
        <span v-for="row in stageBar" :key="row.key" :style="{ flexGrow: row.min, background: row.color }" :title="`${row.label} ${fmt.duration(row.min)}`" />
      </div>
      <div class="kpi-sub">
        <template v-if="night">{{ fmt.time(night.start) }} → {{ fmt.time(night.end) }} · deep {{ fmt.duration(night.mins.deep) }}</template>
        <template v-else>No sleep recorded yet</template>
      </div>
    </div>

    <!-- Blood oxygen -->
    <div class="kpi" :style="{ '--accent': P.spo2 }">
      <div class="kpi-top">
        <span><i class="pi pi-wave-pulse" />Blood oxygen</span>
        <span v-if="spo2">{{ fmt.ago(spo2.t) }}</span>
      </div>
      <div class="kpi-main">
        <span class="kpi-value">{{ spo2 ? Math.round(spo2.v) : '–' }}</span>
        <span class="kpi-unit">%</span>
      </div>
      <div class="kpi-sub">
        <template v-if="spo2Night">night avg {{ spo2Night.avg.toFixed(0) }}% · low {{ Math.round(spo2Night.lo) }}%</template>
        <template v-else-if="spo2">{{ fmt.dayTime(spo2.t) }}</template>
        <template v-else>No reading yet</template>
      </div>
    </div>

    <!-- Active today -->
    <div class="kpi" :style="{ '--accent': P.kcal }">
      <div class="kpi-top">
        <span><i class="pi pi-bolt" />Active today</span>
      </div>
      <div class="kpi-main">
        <span class="kpi-value">{{ fmt.int(kcal) }}</span>
        <span class="kpi-unit">kcal</span>
      </div>
      <div class="kpi-sub">
        {{ distance != null ? fmt.km(distance) : '–' }}<template v-if="workoutsToday"> · {{ workoutsToday }} workout{{ workoutsToday > 1 ? 's' : '' }}</template>
      </div>
    </div>

    <!-- Sync -->
    <div class="kpi sync" :style="{ '--accent': syncColor }">
      <div class="kpi-top">
        <span><i class="pi pi-sync" />Last sync</span>
        <span class="tools">
          <button class="icon" title="Refresh" :disabled="store.loading" @click="store.refresh()">
            <i :class="['pi', store.loading ? 'pi-spin pi-spinner' : 'pi-refresh']" />
          </button>
          <button class="icon" title="Settings" @click="emit('settings')"><i class="pi pi-sliders-h" /></button>
          <button class="icon" title="Link phone" @click="emit('link')"><i class="pi pi-mobile" /></button>
        </span>
      </div>
      <div class="kpi-main">
        <span class="kpi-value small">{{ syncAt ? fmt.ago(syncAt) : 'never' }}</span>
      </div>
      <div class="kpi-sub">
        <span class="status-dot" :style="{ background: syncColor }" />
        {{ store.link?.device || 'No phone linked' }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import dayjs from 'dayjs'
import { P, SLEEP, fmt, zoneBounds, zoneOf } from '@/lib/health/theme'
import { SLEEP_ROWS } from '@/lib/health/metrics'
import { useHealthStore } from '@/stores/health'

const emit = defineEmits(['settings', 'link'])
const store = useHealthStore()
const HOUR = 3600e3

// Sparkline path in a 120×32 box; breaks the line across gaps longer than `gap` ms.
function sparkPath(points, t0, t1, gap) {
  if (points.length < 2) return null
  const vals = points.map((p) => p[1])
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const x = (t) => ((t - t0) / (t1 - t0 || 1)) * 120
  const y = (v) => 30 - ((v - lo) / (hi - lo || 1)) * 27
  let line = ''
  let area = ''
  let runStart = null
  points.forEach(([t, v], i) => {
    const broke = i === 0 || t - points[i - 1][0] > gap
    if (broke) {
      if (runStart != null) area += `L${x(points[i - 1][0]).toFixed(1)},32 L${runStart},32 Z `
      runStart = x(t).toFixed(1)
      line += `M${x(t).toFixed(1)},${y(v).toFixed(1)} `
      area += `M${x(t).toFixed(1)},${y(v).toFixed(1)} `
    } else {
      line += `L${x(t).toFixed(1)},${y(v).toFixed(1)} `
      area += `L${x(t).toFixed(1)},${y(v).toFixed(1)} `
    }
  })
  area += `L${x(points.at(-1)[0]).toFixed(1)},32 L${runStart},32 Z`
  return { line, area, dots: points.map(([t, v]) => [x(t), y(v)]) }
}

// ── Heart rate ──
const hr = computed(() => store.latestHr)
const zone = computed(() => zoneOf(hr.value?.bpm ?? 0, zoneBounds(store.settings.maxHr)))
// A 5-minute moving average: raw minutes jitter too much to read at sparkline size.
const hrSpark = computed(() => {
  const pts = store.spark
  const smooth = pts.map(([t], i) => {
    const win = pts.slice(Math.max(0, i - 2), i + 3).filter(([u]) => Math.abs(u - t) <= 3 * 60e3)
    return [t, win.reduce((a, p) => a + p[1], 0) / win.length]
  })
  return sparkPath(smooth, store.now - 3 * HOUR, store.now, 5 * 60e3)
})
const sparkRange = computed(() => {
  if (!store.spark.length) return null
  const vals = store.spark.map((p) => p[1])
  return { lo: Math.round(Math.min(...vals)), hi: Math.round(Math.max(...vals)) }
})

// ── Resting ──
const rest = computed(() => store.resting.days.at(-1) || null)
const restDelta = computed(() => {
  const days = store.resting.days
  if (days.length < 4) return null
  const prev = days.slice(-8, -1)
  return days.at(-1).value - prev.reduce((a, d) => a + d.value, 0) / prev.length
})
const restSpark = computed(() => {
  const days = store.resting.days.slice(-14)
  if (days.length < 2) return null
  const pts = days.map((d, i) => [i, d.value])
  return sparkPath(pts, 0, pts.length - 1, Infinity)
})

// ── Steps ──
const steps = computed(() => store.dayTotal('steps'))
const stepPct = computed(() => (steps.value ?? 0) / (store.settings.stepGoal || 1))
const stepsAvg = computed(() => {
  const days = (store.daily.steps || []).filter((d) => d.day !== store.todayKey).slice(-7)
  return days.length ? days.reduce((a, d) => a + d.total, 0) / days.length : null
})

// ── Sleep ──
const night = computed(() => store.nights.at(-1) || null)
const nightLabel = computed(() => {
  if (!night.value) return ''
  const d = dayjs(night.value.end)
  if (d.isSame(dayjs(), 'day')) return 'last night'
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'yesterday'
  return d.format('ddd D MMM')
})
const stageBar = computed(() =>
  [...SLEEP_ROWS].reverse().map((r) => ({ ...r, min: night.value?.mins[r.key] ?? 0 })),
)

// ── Blood oxygen ──
const spo2 = computed(() => {
  const last = store.vitals.spo2?.at(-1)
  return last ? { t: last[0], v: last[1] } : null
})
const spo2Night = computed(() => {
  const n = night.value
  const pts = store.vitals.spo2
  if (!n || !pts) return null
  const vals = pts.filter(([t]) => t >= n.start && t <= n.end).map((p) => p[1])
  if (!vals.length) return null
  return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, lo: Math.min(...vals) }
})

// ── Active ──
const kcal = computed(() => store.dayTotal('active_kcal'))
const distance = computed(() => store.dayTotal('distance_m'))
const workoutsToday = computed(
  () => store.workouts.filter((w) => dayjs(w.start_time).isSame(dayjs(store.now), 'day')).length,
)

// ── Sync ──
const syncAt = computed(() => (store.link?.last_used_at ? new Date(store.link.last_used_at).getTime() : null))
const syncColor = computed(() => {
  if (!syncAt.value) return P.text3
  const age = store.now - syncAt.value
  return age < 30 * 60e3 ? P.sync : age < 3 * HOUR ? P.warn : P.bad
})
</script>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.75rem;
}

.kpi {
  --accent: var(--hx-text2);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  padding: 0.625rem 0.875rem 0.6875rem;
  background:
    radial-gradient(90% 120% at 0% 0%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%),
    var(--hx-panel);
  border: 1px solid var(--hx-border);
  border-radius: 0.875rem;
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 4px 16px rgba(15, 23, 42, 0.05);
  overflow: hidden;
}

.kpi::after {
  content: '';
  position: absolute;
  left: 0.875rem;
  right: 0.875rem;
  top: 0;
  height: 1px;
  background: linear-gradient(90deg, var(--accent), transparent 70%);
  opacity: 0.6;
}

.kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 1.25rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--hx-text3);
  white-space: nowrap;
}

.kpi-top > span:last-child:not(:first-child) {
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}

.kpi-top i {
  margin-right: 0.375rem;
  font-size: 0.6875rem;
  color: var(--accent);
}

.kpi-main {
  display: flex;
  align-items: flex-end;
  gap: 0.375rem;
  min-height: 2.25rem;
}

.kpi-value {
  font-size: 1.75rem;
  font-weight: 650;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--hx-text);
}

.kpi-value.small {
  font-size: 1.375rem;
}

.kpi-unit {
  margin-bottom: 0.1875rem;
  font-size: 0.75rem;
  color: var(--hx-text3);
}

.kpi-viz {
  flex: 1;
  min-width: 2rem;
  max-width: 8rem;
  height: 2rem;
  margin-left: auto;
  overflow: visible;
}

.kpi-ring {
  width: 2.375rem;
  height: 2.375rem;
  margin-left: auto;
}

.kpi-sub {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
  font-size: 0.75rem;
  color: var(--hx-text2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip {
  font-weight: 600;
}

.delta.up {
  color: var(--hx-warn);
}

.delta.down {
  color: var(--hx-sync);
}

.stage-bar {
  display: flex;
  gap: 2px;
  height: 0.3125rem;
  margin: 0.125rem 0 0.0625rem;
  border-radius: 999px;
  overflow: hidden;
}

.stage-bar span {
  min-width: 2px;
}

.status-dot {
  width: 0.4375rem;
  height: 0.4375rem;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 0.1875rem color-mix(in srgb, currentColor 20%, transparent);
}

.tools {
  display: flex;
  gap: 0.125rem;
  margin-right: -0.375rem;
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.375rem;
  padding: 0;
  color: var(--hx-text3);
  background: transparent;
  border: 0;
  border-radius: 0.375rem;
  cursor: pointer;
}

.icon i {
  margin: 0;
  color: inherit;
}

.icon:hover:not(:disabled) {
  color: var(--hx-text);
  background: var(--hx-panel2);
}

@media (max-width: 100em) {
  .kpi-value {
    font-size: 1.5rem;
  }
}

@media (max-width: 80em) {
  .kpis {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 47.99875em) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .kpi.sync {
    grid-column: 1 / -1;
  }
}
</style>
