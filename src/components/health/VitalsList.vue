<template>
  <div class="vitals">
    <div v-if="!rows.length" class="hx-empty">
      <svg class="empty-ico" viewBox="0 0 24 24"><path :d="ICONS.drop" /></svg>
      <span v-if="store.ready">Blood oxygen and HRV show up after a night of wear.</span>
    </div>

    <div v-else class="hx-scroll list">
      <div v-for="r in rows" :key="r.key" class="vital" :style="{ '--c': r.color }">
        <div class="id">
          <span class="ico"><svg viewBox="0 0 24 24"><path :d="r.icon" /></svg></span>
          <div class="names">
            <span class="label" :title="r.title">
              {{ r.label }}<em v-if="r.estimated" :title="EST_NOTE">est.</em>
            </span>
            <span class="when">
              <template v-if="hover?.key === r.key">{{ fmt.day(hover.day) }}</template>
              <template v-else>
                {{ r.ago }}
                <span v-if="r.delta" :class="['delta', r.delta.tone]" title="Latest reading against the 30-day average">
                  {{ r.delta.text }}
                </span>
              </template>
            </span>
          </div>
        </div>

        <div class="spark" @mousemove="scrub($event, r)" @mouseleave="hover = null">
          <svg viewBox="0 0 100 40" preserveAspectRatio="none">
            <defs>
              <linearGradient :id="`hx-vital-${r.key}`" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" :stop-color="r.color" stop-opacity="0.26" />
                <stop offset="1" :stop-color="r.color" stop-opacity="0" />
              </linearGradient>
            </defs>
            <rect v-if="r.band" :x="r.x0" :y="r.band.y" :width="100 - r.x0" :height="r.band.h" :fill="r.color" fill-opacity="0.09" />
            <line
              v-if="r.avgY != null"
              :x1="r.x0" x2="100" :y1="r.avgY" :y2="r.avgY"
              :stroke="r.color" stroke-opacity="0.4" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"
            />
            <path v-if="r.area" :d="r.area" :fill="`url(#hx-vital-${r.key})`" />
            <path
              v-if="r.bridge"
              :d="r.bridge"
              fill="none" :stroke="r.color" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="2 3"
              vector-effect="non-scaling-stroke"
            />
            <path
              v-if="r.line"
              :d="r.line"
              fill="none" :stroke="r.color" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <template v-if="hover?.key === r.key">
            <span class="cursor" :style="{ left: hover.x + '%' }" />
            <span class="dot" :style="pos(hover)" />
          </template>
          <span v-else-if="r.last" class="dot glow" :style="pos(r.last)" />
        </div>

        <div class="val">
          <span class="num" :class="hover?.key !== r.key && r.out" :title="r.out ? 'Outside your usual 30-day range' : ''">
            {{ hover?.key === r.key ? r.format(hover.value) : r.format(r.value) }}<small>{{ r.unit }}</small>
          </span>
          <span class="range">{{ r.range ? `typical ${r.range}` : '&nbsp;' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// One row per vital the watch sends: latest value, a 30-day sparkline of daily
// averages over the usual range (10th–90th percentile), and a scrub-able cursor.
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { fmt } from '@/lib/health/theme'
import { METRICS } from '@/lib/health/metrics'
import { useHealthStore } from '@/stores/health'

const store = useHealthStore()

const EST_NOTE = "Lowest 5% of each day's heart rate — the watch hasn't sent a resting value"
const SPAN_DAYS = 30

// Hand-drawn 24×24 stroke icons.
const ICONS = {
  heart: 'M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z',
  drop: 'M12 3.8s-5.6 6.1-5.6 10.2a5.6 5.6 0 0 0 11.2 0c0-4.1-5.6-10.2-5.6-10.2zM9.4 14.6a2.6 2.6 0 0 0 2.6 2.6',
  wave: 'M2.5 12h3.5l2-4.5 3.2 10 3-8 2 2.5h5.3',
  wind: 'M3 9.5h10.5a2.75 2.75 0 1 0-2.75-2.75M3 13.5h15a2.75 2.75 0 1 1-2.75 2.75M3 17.5h6',
  gauge: 'M4.8 17.5a8 8 0 1 1 14.4 0M12 13.6l3.6-4.2M12 13.6h.01',
  bolt: 'M13 3.5L6.5 13.2H12l-1 7.3 6.5-9.7H12z',
  flame: 'M12 3.5c.5 3-2.8 4.6-2.8 8a2.9 2.9 0 0 0 5.8 0c0-1-.4-1.8-1-2.6 2.3 1 3.7 3 3.7 5.1a6.4 6.4 0 0 1-12.8 0c0-4.3 4.2-6 4.8-10.5z',
  therm: 'M10 14.2V5.5a2 2 0 0 1 4 0v8.7a3.7 3.7 0 1 1-4 0zM12 9v7.5',
  scale: 'M5.5 4.5h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zM8.6 10a3.4 3.4 0 0 1 6.8 0M12 10l1.1-1.7',
}

// Display order. `better`: +1 higher is better, −1 lower is better, 0 neutral.
// Overnight metrics are bucketed by the morning they end on, so a night isn't
// split across two dates.
const DEFS = [
  { key: 'resting', metric: 'resting_heart_rate', label: 'Resting HR', better: -1, icon: ICONS.heart },
  { key: 'spo2', metric: 'spo2', label: 'Blood oxygen', better: 1, nightly: true, icon: ICONS.drop },
  { key: 'hrv_rmssd', metric: 'hrv_rmssd', label: 'HRV', title: 'Heart-rate variability (RMSSD)', better: 1, nightly: true, icon: ICONS.wave },
  { key: 'respiratory_rate', metric: 'respiratory_rate', label: 'Respiration', title: 'Breaths per minute', better: 0, nightly: true, icon: ICONS.wind },
  { key: 'vo2max', metric: 'vo2max', label: 'VO₂ max', better: 1, icon: ICONS.gauge },
  { key: 'body_energy', metric: 'body_energy', label: 'Body energy', title: 'Watch battery for the body, 0–100', better: 1, daily: true, icon: ICONS.bolt },
  { key: 'pai', metric: 'pai', label: 'PAI', title: 'Personal Activity Intelligence score', better: 1, icon: ICONS.flame },
  { key: 'skin_temp_c', metric: 'skin_temp_c', label: 'Skin temp', better: 0, daily: true, icon: ICONS.therm },
  { key: 'weight_kg', metric: 'weight_kg', label: 'Weight', better: 0, icon: ICONS.scale },
]

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo)
}

function relDay(day) {
  const d = dayjs(day)
  if (d.isSame(dayjs(store.now), 'day')) return 'today'
  if (d.isSame(dayjs(store.now).subtract(1, 'day'), 'day')) return 'yesterday'
  return d.format('ddd D MMM')
}

// Daily averages [{ day, value }] oldest first.
function dailyAverages(points, nightly) {
  const shift = nightly ? 6 * 3600e3 : 0
  const map = new Map()
  for (const [t, v] of points) {
    const key = dayjs(t + shift).format('YYYY-MM-DD')
    const e = map.get(key) || { sum: 0, n: 0 }
    e.sum += v
    e.n++
    map.set(key, e)
  }
  return [...map].map(([day, e]) => ({ day, value: e.sum / e.n }))
}

function build(def, days, latest) {
  const m = METRICS[def.metric]
  const format = (v) => (v == null ? '–' : Number(v).toFixed(m.decimals))
  const from = dayjs(store.todayKey).subtract(SPAN_DAYS - 1, 'day')
  const recent = days.filter((d) => !dayjs(d.day).isBefore(from, 'day'))
  const vals = recent.map((d) => d.value)
  const sorted = [...vals].sort((a, b) => a - b)
  const enough = vals.length >= 5
  const p10 = enough ? quantile(sorted, 0.1) : null
  const p90 = enough ? quantile(sorted, 0.9) : null
  const avg = vals.length >= 3 ? mean(vals) : null

  const row = {
    key: def.key,
    label: def.label,
    title: def.title,
    icon: def.icon,
    color: m.color,
    unit: m.unit,
    format,
    value: latest.value,
    ago: latest.ago,
    estimated: def.key === 'resting' && store.resting.estimated,
    range: enough ? `${format(p10)}–${format(p90)}` : null,
    // Outside the usual range: amber in the unhealthy direction, green in the healthy one.
    out: !enough ? null
      : latest.value < p10 ? (def.better === 1 ? 'warn' : def.better === -1 ? 'good' : 'warn')
        : latest.value > p90 ? (def.better === -1 ? 'warn' : def.better === 1 ? 'good' : 'warn')
          : null,
    delta: null,
    points: [],
    line: '',
    bridge: '',
    area: '',
    band: null,
    avgY: null,
    last: null,
    x0: 0,
  }

  if (avg != null) {
    const diff = latest.value - avg
    const step = Math.pow(10, -m.decimals)
    if (Math.abs(diff) < step / 2) row.delta = { text: '≈ avg', tone: 'flat' }
    else {
      const good = def.better === 0 ? 'flat' : Math.sign(diff) === def.better ? 'good' : 'warn'
      row.delta = { text: `${diff > 0 ? '▲' : '▼'}${Math.abs(diff).toFixed(m.decimals)} vs avg`, tone: good }
    }
  }

  if (!recent.length) return row

  // Geometry in a 100 × 40 box (x = day across the 30-day span).
  const lo0 = Math.min(...vals, latest.value, p10 ?? Infinity)
  const hi0 = Math.max(...vals, latest.value, p90 ?? -Infinity)
  const pad = (hi0 - lo0 || Math.abs(hi0) * 0.04 || 1) * 0.2
  const lo = lo0 - pad
  const hi = hi0 + pad
  const X = (day) => (dayjs(day).diff(from, 'day') / (SPAN_DAYS - 1)) * 100
  const Y = (v) => 37 - ((v - lo) / (hi - lo)) * 34

  row.points = recent.map((d) => ({ x: X(d.day), y: Y(d.value), day: d.day, value: d.value }))
  row.last = row.points.at(-1)
  row.x0 = row.points[0].x    // band and average start where the readings do
  if (row.points.length > 1) {
    // Days without readings (> 2 missing) break the line; a faint dashed bridge spans them.
    const gap = (2.5 / (SPAN_DAYS - 1)) * 100
    const xy = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`
    const all = row.points.map((p, i) => `${i ? 'L' : 'M'}${xy(p)}`).join(' ')
    row.line = row.points
      .map((p, i) => {
        const prev = row.points[i - 1]
        if (prev && p.x - prev.x > gap) row.bridge += `M${xy(prev)} L${xy(p)} `
        return `${!prev || p.x - prev.x > gap ? 'M' : 'L'}${xy(p)}`
      })
      .join(' ')
    row.area = `${all} L${row.last.x.toFixed(2)},40 L${row.points[0].x.toFixed(2)},40 Z`
  }
  if (enough) row.band = { y: Y(p90), h: Math.max(Y(p10) - Y(p90), 0.6) }
  if (avg != null) row.avgY = Y(avg)
  return row
}

// Minute-level metrics arrive as daily means (store.daily) plus their newest reading (store.latest).
function dailyPoints(metric) {
  return (store.daily[metric] || []).filter((d) => d.mean != null).map((d) => [dayjs(d.day).hour(12).valueOf(), d.mean])
}

const rows = computed(() =>
  DEFS.map((def) => {
    if (def.key === 'resting') {
      const days = store.resting.days
      const last = days.at(-1)
      return last ? build(def, days, { value: last.value, ago: relDay(last.day) }) : null
    }
    const pts = def.daily ? dailyPoints(def.metric) : store.vitals[def.metric]
    if (!pts?.length) return null
    const [t, v] = (def.daily && store.latest[def.metric]) || pts.at(-1)
    const fresh = !def.daily || store.latest[def.metric]
    return build(def, dailyAverages(pts, def.nightly), { value: v, ago: fresh ? fmt.ago(t) : relDay(dayjs(t).format('YYYY-MM-DD')) })
  }).filter(Boolean),
)

// ── Scrubbing ──
const hover = ref(null)

function scrub(e, row) {
  if (!row.points.length) return
  const rect = e.currentTarget.getBoundingClientRect()
  const fx = ((e.clientX - rect.left) / rect.width) * 100
  const p = row.points.reduce((a, b) => (Math.abs(b.x - fx) < Math.abs(a.x - fx) ? b : a))
  hover.value = { key: row.key, ...p }
}

const pos = (p) => ({ left: `${p.x}%`, top: `${(p.y / 40) * 100}%` })
</script>

<style scoped>
.vitals {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.vital {
  --c: var(--hx-text2);
  position: relative;
  flex: 1 1 0;
  min-height: 3.5rem;
  max-height: 5.75rem;
  display: grid;
  grid-template-columns: minmax(8rem, 10.5rem) minmax(0, 1fr) minmax(4.75rem, auto);
  align-items: center;
  gap: 0.875rem;
  padding: 0.4375rem 0.75rem 0.4375rem 0.875rem;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--c) 10%, transparent), transparent 40%),
    var(--hx-panel2);
  border: 1px solid var(--hx-border);
  border-radius: 0.625rem;
  overflow: hidden;
}

.vital::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.625rem;
  bottom: 0.625rem;
  width: 2px;
  border-radius: 999px;
  background: var(--c);
}

.id {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  min-width: 0;
}

.ico {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 1.875rem;
  height: 1.875rem;
  color: var(--c);
  background: radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--c) 28%, transparent), color-mix(in srgb, var(--c) 8%, transparent));
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 30%, transparent);
}

.ico svg,
.empty-ico {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.empty-ico {
  width: 1.5rem;
  height: 1.5rem;
  opacity: 0.6;
}

.names {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--hx-text2);
  white-space: nowrap;
}

.label em {
  margin-left: 0.3125rem;
  font-style: normal;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--hx-text3);
  cursor: help;
}

.when {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--hx-text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.delta {
  font-weight: 600;
}

.delta.good {
  color: var(--hx-sync);
}

.delta.warn {
  color: var(--hx-warn);
}

.delta.flat {
  color: var(--hx-text2);
}

.spark {
  position: relative;
  align-self: stretch;
  min-height: 2.25rem;
  margin: 0.125rem 0;
  cursor: crosshair;
}

.spark svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.dot {
  position: absolute;
  width: 0.4375rem;
  height: 0.4375rem;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 0 2px var(--hx-panel2);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* Latest reading: a tinted halo ring rather than a glow. */
.dot.glow {
  box-shadow:
    0 0 0 2px var(--hx-panel2),
    0 0 0 0.3125rem color-mix(in srgb, var(--c) 22%, transparent);
}

.cursor {
  position: absolute;
  top: -0.125rem;
  bottom: -0.125rem;
  width: 1px;
  background: linear-gradient(transparent, var(--hx-text3), transparent);
  pointer-events: none;
}

.val {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.2;
  white-space: nowrap;
}

.num {
  font-size: 1.125rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--hx-text);
}

.num.warn {
  color: var(--hx-warn);
}

.num.good {
  color: var(--hx-sync);
}

.num small {
  margin-left: 0.1875rem;
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--hx-text3);
}

.range {
  font-size: 0.6875rem;
  color: var(--hx-text3);
}

@media (max-width: 30em) {
  .vital {
    grid-template-columns: minmax(7rem, 8.5rem) minmax(0, 1fr) auto;
    gap: 0.625rem;
  }

  .ico {
    display: none;
  }
}
</style>
