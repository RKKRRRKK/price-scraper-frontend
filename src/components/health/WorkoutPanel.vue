<template>
  <HealthPanel id="hx-workout" :accent="kind.color" :loading="store.workoutLoading">
    <template #title>
      <span class="hx-dot" />
      <h2>Workout</h2>
      <div class="nav">
        <button class="hx-btn" title="Older workout" :disabled="idx >= list.length - 1" @click="step(1)"><i class="pi pi-chevron-left" /></button>
        <button class="hx-btn" title="Newer workout" :disabled="idx <= 0" @click="step(-1)"><i class="pi pi-chevron-right" /></button>
      </div>
    </template>
    <template #meta>
      <div class="hx-stat">
        <span class="hx-stat-label">{{ name }}</span>
        <span class="hx-stat-value">{{ when }}</span>
      </div>
    </template>
    <template #actions>
      <button class="hx-btn" title="Show in the heart-rate chart" @click="store.focusRange(w.start, w.end)">
        <i class="pi pi-chart-line" />Chart
      </button>
    </template>

    <div v-if="w" class="wk">
      <div class="stats">
        <div v-for="s in stats" :key="s.label" class="stat">
          <span class="lbl">{{ s.label }}</span>
          <span class="val">{{ s.value }}<small>{{ s.unit }}</small></span>
        </div>
      </div>

      <div :class="['main', { solo: !hasRoute || !hrPts.length }]">
        <div v-if="hasRoute" ref="routeEl" class="route">
          <svg v-if="route" :width="rsize.w" :height="rsize.h">
            <path :d="route.all" fill="none" :stroke="P.panel" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
            <path :d="route.all" fill="none" :stroke="P.border2" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
            <path v-for="(r, i) in route.runs" :key="i" :d="r.d" fill="none" :stroke="r.color" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            <circle :cx="route.start[0]" :cy="route.start[1]" r="5" :fill="P.sync" :stroke="P.panel" stroke-width="2" />
            <circle :cx="route.end[0]" :cy="route.end[1]" r="5" :fill="P.text" :stroke="P.panel" stroke-width="2" />
          </svg>
          <span class="route-cap">{{ routeLen }}</span>
        </div>

        <div v-if="hrPts.length" class="hr">
          <div class="hr-head">
            <span class="cap">Heart rate</span>
            <div class="read">
              <template v-if="hit">
                <b>{{ elapsed(hit.t) }}</b>
                <span :style="{ color: hit.zone.color }">{{ Math.round(hit.v) }} bpm · {{ hit.zone.label }}</span>
              </template>
              <template v-else-if="avgHr">avg <b>{{ Math.round(avgHr) }}</b> · max <b>{{ Math.round(maxHrSeen) }}</b></template>
            </div>
          </div>
          <div ref="plotEl" class="plot">
            <svg v-if="size.w > 40 && size.h > 40" :width="size.w" :height="size.h" @mousemove="onMove" @mouseleave="hoverX = null">
              <defs>
                <linearGradient :id="gid" gradientUnits="userSpaceOnUse" x1="0" :y1="T" x2="0" :y2="T + plotH">
                  <stop v-for="(s, i) in gradStops" :key="i" :offset="s.at" :stop-color="s.color" />
                </linearGradient>
              </defs>
              <g v-for="z in zoneBands" :key="z.key">
                <rect :x="L" :y="z.y0" :width="plotW" :height="z.y1 - z.y0" :fill="z.color" fill-opacity="0.07" />
                <text class="band-label" :x="L + plotW - 4" :y="z.y0 + 10" text-anchor="end" :fill="z.color">{{ z.label }}</text>
              </g>
              <g v-for="v in yTicks" :key="v">
                <line :x1="L" :x2="L + plotW" :y1="Y(v)" :y2="Y(v)" :stroke="P.grid" />
                <text class="tick" :x="L - 5" :y="Y(v) + 3.5" text-anchor="end">{{ v }}</text>
              </g>
              <text v-for="t in xTicks" :key="t.ms" class="tick" :x="X(t.ms)" :y="T + plotH + 13" :text-anchor="t.anchor">{{ t.label }}</text>
              <path :d="areaD" :fill="`url(#${gid})`" fill-opacity="0.13" />
              <path :d="lineD" fill="none" :stroke="`url(#${gid})`" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" />
              <line v-if="avgHr" :x1="L" :x2="L + plotW" :y1="Y(avgHr)" :y2="Y(avgHr)" :stroke="P.text2" stroke-opacity="0.5" stroke-dasharray="3 4" />
              <template v-if="hit">
                <line :x1="hit.x" :x2="hit.x" :y1="T" :y2="T + plotH" :stroke="P.text3" />
                <circle :cx="hit.x" :cy="hit.y" r="3.8" :fill="hit.zone.color" :stroke="P.panel" stroke-width="2" />
              </template>
            </svg>
          </div>
        </div>
        <div v-else-if="!hasRoute" class="plain">
          {{ store.workoutLoading ? 'Loading workout…' : 'No heart-rate curve or route was recorded.' }}
        </div>
      </div>

      <div v-if="zones.total" class="zones">
        <div class="stack">
          <span v-for="z in zones.list" :key="z.key" :style="{ flexGrow: z.s, background: z.color }" :title="`${z.label} ${fmt.duration(z.s / 60)}`" />
        </div>
        <div class="hx-keys">
          <span v-for="z in zones.list" :key="z.key" class="hx-key"><i :style="{ background: z.color }" />{{ z.label }} {{ fmt.duration(z.s / 60) }}</span>
        </div>
      </div>
    </div>
  </HealthPanel>
</template>

<script setup>
// One workout: summary figures, the GPS route coloured by heart-rate zone, the
// heart-rate curve over the zone bands, and time in each zone. Everything but the
// header hides when the watch didn't record it.
import { ref, reactive, computed } from 'vue'
import dayjs from 'dayjs'
import HealthPanel from './HealthPanel.vue'
import { P, ZONES, zoneBounds, zoneOf, fmt } from '@/lib/health/theme'
import { useSize, niceTicks, nearest, pace } from '@/lib/health/draw'
import { kindOf, workoutName } from '@/lib/health/workouts'
import { useHealthStore } from '@/stores/health'

const store = useHealthStore()

const w = computed(() => {
  const s = store.workout
  if (!s) return null
  const start = new Date(s.start_time).getTime()
  const end = new Date(s.end_time).getTime()
  return { ...s, start, end }
})
const kind = computed(() => (w.value ? kindOf(w.value.exercise_type) : { color: P.kcal }))
const name = computed(() => (w.value ? workoutName(w.value) : ''))
const when = computed(() =>
  w.value ? `${dayjs(w.value.start).format('ddd D MMM, HH:mm')} · ${fmt.duration((w.value.end - w.value.start) / 60e3)}` : '',
)

// Workouts newest first; arrows walk through them.
const list = computed(() => store.workouts)
const idx = computed(() => list.value.findIndex((s) => s.record_id === w.value?.record_id))
function step(dir) {
  const next = list.value[idx.value + dir]
  if (next) store.selectWorkout(next.record_id)
}

// Scalar summary first, the full object once it has loaded.
const d = computed(() => ({ ...(w.value?.details || {}), ...(store.workoutDetails || {}) }))

const stats = computed(() => {
  const x = d.value
  const out = []
  const add = (label, value, unit = '') => value != null && value !== '' && out.push({ label, value, unit })
  const mins = w.value ? (w.value.end - w.value.start) / 60e3 : null
  add('Time', fmt.duration(mins))
  if (x.distance_m) add('Distance', (x.distance_m / 1000).toFixed(x.distance_m >= 10000 ? 1 : 2), 'km')
  if (x.avg_pace_s_per_km) add('Pace', pace(x.avg_pace_s_per_km), '/km')
  else if (x.avg_speed_kmh) add('Speed', x.avg_speed_kmh.toFixed(1), 'km/h')
  if (x.kcal) add('Calories', Math.round(x.kcal), 'kcal')
  if (x.avg_hr) add('Avg HR', Math.round(x.avg_hr), 'bpm')
  if (x.max_hr) add('Max HR', Math.round(x.max_hr), 'bpm')
  if (x.elevation_gain_m) add('Climb', Math.round(x.elevation_gain_m), 'm')
  if (x.avg_cadence) add('Cadence', Math.round(x.avg_cadence), 'spm')
  if (x.steps) add('Steps', fmt.int(x.steps))
  if (x.training_effect_aerobic) add('Effect', x.training_effect_aerobic.toFixed(1))
  if (x.recovery_h) add('Recovery', Math.round(x.recovery_h), 'h')
  return out
})

// ── Heart-rate curve ──

const bounds = computed(() => zoneBounds(store.settings.maxHr))
const zoneColor = (bpm) => zoneOf(bpm, bounds.value)

// [[ms, bpm]]
const hrPts = computed(() => (d.value.hr || []).filter((p) => p[1] > 0).map(([t, v]) => [t * 1000, v]))
const avgHr = computed(() => d.value.avg_hr || (hrPts.value.length ? hrPts.value.reduce((a, p) => a + p[1], 0) / hrPts.value.length : null))
const maxHrSeen = computed(() => d.value.max_hr || Math.max(...hrPts.value.map((p) => p[1])))

const plotEl = ref(null)
const size = reactive(useSize(plotEl))
const L = 30
const R = 8
const T = 6
const B = 18
const plotW = computed(() => Math.max(size.w - L - R, 1))
const plotH = computed(() => Math.max(size.h - T - B, 1))

const t0 = computed(() => hrPts.value[0]?.[0] ?? w.value?.start ?? 0)
const t1 = computed(() => hrPts.value.at(-1)?.[0] ?? w.value?.end ?? 1)
const yDomain = computed(() => {
  const v = hrPts.value.map((p) => p[1])
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  return [Math.floor((lo - 6) / 5) * 5, Math.ceil((hi + 6) / 5) * 5]
})
const X = (ms) => L + ((ms - t0.value) / (t1.value - t0.value || 1)) * plotW.value
const Y = (v) => T + (1 - (v - yDomain.value[0]) / (yDomain.value[1] - yDomain.value[0])) * plotH.value
const yTicks = computed(() => niceTicks(yDomain.value[0], yDomain.value[1], Math.max(2, Math.round(plotH.value / 36))))

const elapsed = (ms) => {
  const s = Math.round((ms - t0.value) / 1000)
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const xTicks = computed(() => {
  const span = (t1.value - t0.value) / 60e3
  const step = [1, 2, 5, 10, 15, 30, 60].find((m) => span / m <= (size.w < 300 ? 4 : 7)) || 120
  const out = []
  for (let m = 0; m <= span + 1e-6; m += step) {
    out.push({ ms: t0.value + m * 60e3, label: m === 0 ? '0' : `${m}m`, anchor: m === 0 ? 'start' : 'middle' })
  }
  return out
})

// Thin to about one point per pixel; the curve keeps its peaks.
const plotPts = computed(() => {
  const p = hrPts.value
  const maxN = Math.max(Math.floor(plotW.value), 60)
  if (p.length <= maxN) return p
  const k = p.length / maxN
  const out = []
  for (let i = 0; i < maxN; i++) {
    const seg = p.slice(Math.floor(i * k), Math.floor((i + 1) * k) || undefined)
    const mid = seg[seg.length >> 1]
    const peak = seg.reduce((a, b) => (b[1] > a[1] ? b : a))
    out.push([mid[0], (mid[1] + peak[1]) / 2])
  }
  return out
})
const xy = computed(() => plotPts.value.map(([t, v]) => [X(t), Y(v)]))
const lineD = computed(() => xy.value.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '))
const areaD = computed(() =>
  xy.value.length > 1 ? `${lineD.value} L${xy.value.at(-1)[0].toFixed(1)},${T + plotH.value} L${xy.value[0][0].toFixed(1)},${T + plotH.value} Z` : '',
)

// Zone bands that fall inside the plotted range, and the line's colour stops.
const zoneBands = computed(() => {
  const [lo, hi] = yDomain.value
  return bounds.value
    .map((z) => ({ ...z, y0: Y(Math.min(z.hi, hi)), y1: Y(Math.max(z.lo, lo)), vis: Math.min(z.hi, hi) > Math.max(z.lo, lo) }))
    .filter((z) => z.vis && z.y1 - z.y0 > 4)
})
const gradStops = computed(() => {
  const [lo, hi] = yDomain.value
  const at = (v) => Math.min(Math.max((hi - v) / (hi - lo), 0), 1)
  const out = []
  for (const z of [...bounds.value].reverse()) {
    out.push({ at: at(Math.min(z.hi, hi)), color: z.color }, { at: at(Math.max(z.lo, lo)), color: z.color })
  }
  return out
})

const hoverX = ref(null)
function onMove(e) {
  hoverX.value = e.clientX - e.currentTarget.getBoundingClientRect().left
}
const hit = computed(() => {
  if (hoverX.value == null || !plotPts.value.length) return null
  const i = nearest(xy.value.map((p) => p[0]), hoverX.value)
  const [t, v] = plotPts.value[i]
  return { t, v, x: xy.value[i][0], y: xy.value[i][1], zone: zoneColor(v) }
})

// ── Zones ──

const ZONE_KEY = { warmup: 1, fatburn: 2, aerobic: 3, anaerobic: 4, extreme: 5 }
const zones = computed(() => {
  let secs = null
  const given = d.value.hr_zones_s
  if (given && Object.keys(given).length) {
    secs = Object.entries(ZONE_KEY).map(([k, zi]) => ({ ...ZONES[zi], s: given[k] || 0 }))
  } else if (hrPts.value.length > 2) {
    // No watch-supplied zones: count the curve's own samples against the dashboard's max HR.
    const p = hrPts.value
    const step = (p.at(-1)[0] - p[0][0]) / (p.length - 1) / 1000
    const acc = new Map()
    for (const [, v] of p) acc.set(zoneColor(v).key, (acc.get(zoneColor(v).key) || 0) + step)
    secs = ZONES.map((z) => ({ ...z, s: acc.get(z.key) || 0 }))
  }
  if (!secs) return { list: [], total: 0 }
  const list = secs.filter((z) => z.s > 0)
  return { list, total: list.reduce((a, z) => a + z.s, 0) }
})

// ── Route ──

const routeEl = ref(null)
const rsize = reactive(useSize(routeEl))

const gps = computed(() => (d.value.gps || []).filter((p) => p[1] != null && p[2] != null))
const hasRoute = computed(() => gps.value.length >= 2)
const route = computed(() => {
  const g = gps.value
  if (g.length < 2 || rsize.w < 40 || rsize.h < 40) return null
  const lat0 = g.reduce((a, p) => a + p[1], 0) / g.length
  const kx = Math.cos((lat0 * Math.PI) / 180)
  const pts = g.map((p) => [p[2] * kx, -p[1]])
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const sw = Math.max(Math.max(...xs) - minX, 1e-9)
  const sh = Math.max(Math.max(...ys) - minY, 1e-9)
  const pad = 18
  const k = Math.min((rsize.w - pad * 2) / sw, (rsize.h - pad * 2) / sh)
  const ox = (rsize.w - sw * k) / 2
  const oy = (rsize.h - sh * k) / 2
  const P2 = pts.map(([x, y]) => [ox + (x - minX) * k, oy + (y - minY) * k])
  const f = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`

  // Runs of one colour (heart-rate zone at that moment), each joined to the previous point.
  const hr = hrPts.value
  const hrXs = hr.map((p) => p[0])
  const colorAt = (t) => (hr.length ? zoneColor(hr[nearest(hrXs, t * 1000)][1]).color : kind.value.color)
  const runs = []
  let cur = null
  P2.forEach((p, i) => {
    const color = colorAt(g[i][0])
    if (!cur || cur.color !== color) {
      cur = { color, d: i ? `M${f(P2[i - 1])} L${f(p)}` : `M${f(p)}` }
      runs.push(cur)
    } else cur.d += ` L${f(p)}`
  })
  return { all: `M${P2.map(f).join(' L')}`, runs, start: P2[0], end: P2.at(-1) }
})

// Haversine length of the recorded track.
const routeLen = computed(() => {
  const g = gps.value
  let m = 0
  for (let i = 1; i < g.length; i++) {
    const [la1, lo1] = [g[i - 1][1] * (Math.PI / 180), g[i - 1][2] * (Math.PI / 180)]
    const [la2, lo2] = [g[i][1] * (Math.PI / 180), g[i][2] * (Math.PI / 180)]
    const a = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2
    m += 12742000 * Math.asin(Math.sqrt(a))
  }
  return fmt.km(m)
})
</script>

<style scoped>
.nav {
  display: flex;
  gap: 0.25rem;
}

.nav .hx-btn {
  height: 1.5rem;
  min-width: 1.5rem;
  padding: 0;
}

.wk {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(5.25rem, 1fr));
  gap: 0.375rem;
  flex-shrink: 0;
}

.stat {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0.3125rem 0.625rem;
  line-height: 1.2;
  background: var(--hx-panel2);
  border: 1px solid var(--hx-border);
  border-radius: 0.5rem;
}

.lbl,
.cap {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--hx-text3);
  white-space: nowrap;
}

.val {
  font-size: 0.9375rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.val small {
  margin-left: 0.1875rem;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--hx-text3);
}

.main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.35fr);
  gap: 0.75rem;
}

.main.solo {
  grid-template-columns: minmax(0, 1fr);
}

.route {
  position: relative;
  min-height: 0;
  min-width: 0;
  background:
    radial-gradient(circle at 1px 1px, var(--hx-border2) 1px, transparent 1.5px) 0 0 / 0.875rem 0.875rem,
    var(--hx-panel2);
  border: 1px solid var(--hx-border);
  border-radius: 0.625rem;
  overflow: hidden;
}

.route svg {
  position: absolute;
  inset: 0;
  display: block;
}

.route-cap {
  position: absolute;
  left: 0.5rem;
  bottom: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--hx-text2);
}

.hr {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.hr-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  min-height: 1.25rem;
  margin-bottom: 0.25rem;
}

.read {
  font-size: 0.75rem;
  color: var(--hx-text2);
  white-space: nowrap;
  overflow: hidden;
}

.read b {
  color: var(--hx-text);
  font-weight: 650;
}

.plot {
  position: relative;
  flex: 1;
  min-height: 0;
}

.plot svg {
  position: absolute;
  inset: 0;
  display: block;
  cursor: crosshair;
}

.tick {
  font-size: 0.625rem;
  fill: var(--hx-text3);
}

.band-label {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
  pointer-events: none;
}

.plain {
  display: grid;
  place-items: center;
  font-size: 0.8125rem;
  color: var(--hx-text3);
}

.zones {
  flex-shrink: 0;
}

.stack {
  display: flex;
  height: 0.625rem;
  gap: 2px;
  margin-bottom: 0.4375rem;
}

.stack span {
  flex-basis: 0;
  min-width: 2px;
  border-radius: 3px;
}

@media (max-width: 30em) {
  .main {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
