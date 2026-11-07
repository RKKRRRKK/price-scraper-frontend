<template>
  <HealthPanel title="Body" :accent="BODY.weight" :loading="store.loading && store.ready">
    <template #meta>
      <div v-if="weight.last" class="hx-stat">
        <span class="hx-stat-label">Weight</span>
        <span class="hx-stat-value">{{ weight.last[1].toFixed(1) }}<small>kg</small></span>
      </div>
      <div v-if="weight.delta != null" class="hx-stat">
        <span class="hx-stat-label">{{ range ? `Last ${range} d` : 'All time' }}</span>
        <span class="hx-stat-value">{{ weight.delta > 0 ? '▲' : weight.delta < 0 ? '▼' : '' }} {{ Math.abs(weight.delta).toFixed(1) }}<small>kg</small></span>
      </div>
    </template>
    <template #actions>
      <HxSegmented v-model="range" :options="RANGES" />
    </template>

    <div class="body">
      <section class="chart">
        <div class="chart-head">
          <span class="cap">Weight</span>
          <div class="read">
            <template v-if="hit">
              <b>{{ dayjs(hit.t).format('ddd D MMM, HH:mm') }}</b>
              <span>{{ hit.v.toFixed(1) }} kg</span>
              <span v-if="hit.fat != null" class="fat">{{ hit.fat.toFixed(1) }}% fat</span>
            </template>
            <template v-else-if="weight.last">last weigh-in {{ fmt.ago(weight.last[0]) }}</template>
          </div>
        </div>

        <div ref="plotEl" class="plot">
          <svg v-if="size.w > 40 && size.h > 40" :width="size.w" :height="size.h" @mousemove="onMove" @mouseleave="hoverX = null" @click="pin">
            <defs>
              <linearGradient :id="gid" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" :stop-color="BODY.weight" stop-opacity="0.2" />
                <stop offset="1" :stop-color="BODY.weight" stop-opacity="0" />
              </linearGradient>
            </defs>
            <g v-for="v in yTicks" :key="v">
              <line :x1="L" :x2="L + plotW" :y1="Y(v)" :y2="Y(v)" :stroke="P.grid" />
              <text class="tick" :x="L - 5" :y="Y(v) + 3.5" text-anchor="end">{{ v }}</text>
            </g>
            <text v-for="t in xTicks" :key="t.ms" class="tick" :x="X(t.ms)" :y="T + plotH + 13" :text-anchor="t.anchor">{{ t.label }}</text>

            <template v-if="pts.length">
              <path v-if="trendArea" :d="trendArea" :fill="`url(#${gid})`" />
              <path v-if="trendLine" :d="trendLine" fill="none" :stroke="BODY.weight" stroke-width="1.8" stroke-linecap="round" />
              <circle v-for="p in pts" :key="p[0]" :cx="X(p[0])" :cy="Y(p[1])" r="2.6" :fill="P.panel" :stroke="BODY.weight" stroke-width="1.3" />
              <circle :cx="X(pts.at(-1)[0])" :cy="Y(pts.at(-1)[1])" r="4.2" :fill="BODY.weight" :stroke="P.panel" stroke-width="2" />
              <text
                class="last"
                :x="Math.min(X(pts.at(-1)[0]) + 8, L + plotW)"
                :y="Y(pts.at(-1)[1]) - 8"
                :text-anchor="X(pts.at(-1)[0]) + 8 + 28 > L + plotW ? 'end' : 'start'"
              >{{ pts.at(-1)[1].toFixed(1) }}</text>
            </template>
            <template v-if="pinnedXY">
              <line :x1="pinnedXY.x" :x2="pinnedXY.x" :y1="T" :y2="T + plotH" :stroke="BODY.weight" stroke-dasharray="3 3" />
              <circle :cx="pinnedXY.x" :cy="pinnedXY.y" r="4.2" :fill="BODY.weight" :stroke="P.panel" stroke-width="2" />
            </template>
            <template v-if="hit">
              <line :x1="hit.x" :x2="hit.x" :y1="T" :y2="T + plotH" :stroke="P.text3" />
              <circle :cx="hit.x" :cy="hit.y" r="4.2" :fill="BODY.weight" :stroke="P.panel" stroke-width="2" />
            </template>
          </svg>
          <div v-if="store.ready && !pts.length" class="hx-empty">No weigh-ins {{ range ? `in the last ${range} days` : 'yet' }}.</div>
        </div>
      </section>

      <section v-if="tiles.length" class="tiles">
        <div class="tiles-head">
          <template v-if="focus != null">
            <span>{{ dayjs(focus).format('ddd D MMM YYYY, HH:mm') }}</span>
            <button v-if="pinned != null" class="clear" type="button" @click="pinned = null">Latest</button>
          </template>
          <span v-else>Latest weigh-in · click the chart to pick another</span>
        </div>
        <div v-for="t in tiles" :key="t.key" class="tile" :style="{ '--c': t.color }">
          <span class="lbl">{{ t.label }}</span>
          <span class="val">{{ t.value }}<small v-if="t.unit">{{ t.unit }}</small></span>
          <span v-if="t.delta" :class="['delta', t.delta.tone]" :title="t.deltaTitle">{{ t.delta.text }}</span>
          <span v-else class="delta flat">{{ t.ago }}</span>
          <svg v-if="t.spark" class="spark" viewBox="0 0 100 24" preserveAspectRatio="none">
            <path :d="t.spark" fill="none" :stroke="t.color" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
            <line v-if="t.mark != null" :x1="t.mark" :x2="t.mark" y1="0" y2="24" :stroke="t.color" stroke-width="1" stroke-opacity="0.55" vector-effect="non-scaling-stroke" />
          </svg>
        </div>
      </section>
    </div>
  </HealthPanel>
</template>

<script setup>
// Scale readings: a weight trend (every weigh-in as a dot, smoothed line through
// them) and a tile per body-composition value with its latest reading and the
// change over the chosen range.
import { ref, reactive, computed, watch } from 'vue'
import dayjs from 'dayjs'
import HealthPanel from './HealthPanel.vue'
import HxSegmented from './HxSegmented.vue'
import { P, BODY, fmt } from '@/lib/health/theme'
import { METRICS } from '@/lib/health/metrics'
import { useSize, niceTicks, smoothPath, nearest } from '@/lib/health/draw'
import { useHealthStore } from '@/stores/health'

const store = useHealthStore()

const RANGES = [
  { label: '30 d', value: 30 },
  { label: '90 d', value: 90 },
  { label: '1 y', value: 365 },
  { label: 'All', value: 0 },
]
const range = ref(90)
const gid = `hx-body-${Math.random().toString(36).slice(2, 8)}`

// "All" starts at the first weigh-in.
const startMs = computed(() => {
  if (range.value) return dayjs(store.now).subtract(range.value, 'day').startOf('day').valueOf()
  const first = store.vitals.weight_kg?.[0]?.[0]
  return dayjs(first ?? store.now).subtract(1, 'day').startOf('day').valueOf()
})
const inRange = (pts) => (pts || []).filter(([t]) => t >= startMs.value)

const weight = computed(() => {
  const all = store.vitals.weight_kg || []
  const p = inRange(all)
  return { last: all.at(-1) || null, delta: p.length > 1 ? p.at(-1)[1] - p[0][1] : null }
})

// ── Weight chart ──

const plotEl = ref(null)
const size = reactive(useSize(plotEl))
const L = 34
const R = 12
const T = 10
const B = 18
const plotW = computed(() => Math.max(size.w - L - R, 1))
const plotH = computed(() => Math.max(size.h - T - B, 1))

const pts = computed(() => inRange(store.vitals.weight_kg))

const yDomain = computed(() => {
  const v = pts.value.map((p) => p[1])
  if (!v.length) return [0, 1]
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const pad = Math.max((hi - lo) * 0.25, 0.6)
  return [lo - pad, hi + pad]
})
const yTicks = computed(() => niceTicks(yDomain.value[0], yDomain.value[1], Math.max(2, Math.round(plotH.value / 38))))

const X = (ms) => L + ((ms - startMs.value) / (store.now - startMs.value)) * plotW.value
const Y = (v) => T + (1 - (v - yDomain.value[0]) / (yDomain.value[1] - yDomain.value[0])) * plotH.value

const xTicks = computed(() => {
  const n = size.w < 360 ? 3 : 5
  return Array.from({ length: n }, (_, i) => {
    const ms = startMs.value + ((store.now - startMs.value) * i) / (n - 1)
    return { ms, label: dayjs(ms).format('D MMM'), anchor: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }
  }).map((t, i, a) => (i === 0 ? { ...t, ms: Math.max(t.ms, startMs.value) } : i === a.length - 1 ? { ...t, ms: Math.min(t.ms, store.now) } : t))
})

// Exponential moving average: the trend a single noisy weigh-in can't swing.
const trendXY = computed(() => {
  let ema = null
  return pts.value.map(([t, v]) => {
    ema = ema == null ? v : ema + 0.3 * (v - ema)
    return [X(t), Y(ema)]
  })
})
const trendLine = computed(() => (trendXY.value.length >= 3 ? smoothPath(trendXY.value) : ''))
const trendArea = computed(() => {
  const xy = trendXY.value
  if (xy.length < 3) return ''
  return `${smoothPath(xy)} L${xy.at(-1)[0].toFixed(2)},${T + plotH.value} L${xy[0][0].toFixed(2)},${T + plotH.value} Z`
})

const hoverX = ref(null)
function onMove(e) {
  hoverX.value = e.clientX - e.currentTarget.getBoundingClientRect().left
}
const hit = computed(() => {
  if (hoverX.value == null || !pts.value.length) return null
  const xs = pts.value.map((p) => X(p[0]))
  const i = nearest(xs, hoverX.value)
  const [t, v] = pts.value[i]
  const fat = (store.vitals.body_fat_pct || []).find(([ft]) => Math.abs(ft - t) < SAME_WEIGHIN_MS)
  return { t, v, x: xs[i], y: Y(v), fat: fat ? fat[1] : null }
})

// A clicked weigh-in stays selected (click it again, or "Latest", to let go); the tiles follow
// the hovered weigh-in, else the pinned one, else the latest.
const pinned = ref(null)
function pin() {
  if (!hit.value) return
  pinned.value = pinned.value === hit.value.t ? null : hit.value.t
}
watch(range, () => { pinned.value = null })
const focus = computed(() => hit.value?.t ?? pinned.value)
const pinnedXY = computed(() => {
  const p = pinned.value != null && pts.value.find(([t]) => t === pinned.value)
  return p ? { x: X(p[0]), y: Y(p[1]) } : null
})

// All values of one weigh-in share its time (to the second); allow a little slack.
const SAME_WEIGHIN_MS = 2 * 60e3

// ── Tiles ──

// better: +1 higher is better, −1 lower is better, 0 neutral.
const DEFS = [
  { metric: 'body_fat_pct', label: 'Body fat', better: -1, color: BODY.fat },
  { metric: 'muscle_kg', label: 'Muscle', better: 1, color: BODY.muscle },
  { metric: 'water_pct', label: 'Water', better: 1, color: BODY.water },
  { metric: 'bone_kg', label: 'Bone', better: 0, color: BODY.bone },
  { metric: 'visceral_fat', label: 'Visceral fat', better: -1, color: BODY.visceral },
  { metric: 'bmr_kcal', label: 'BMR', better: 1, color: BODY.bmr },
  { metric: 'bmi', label: 'BMI', better: 0, color: BODY.bmi },
]

const sparkX = (t) => ((t - startMs.value) / (store.now - startMs.value)) * 100

const tiles = computed(() =>
  DEFS.map((def) => {
    const all = store.vitals[def.metric]
    if (!all?.length) return null
    const m = METRICS[def.metric]
    const p = inRange(all)
    const step = 10 ** -m.decimals
    const change = (d) => {
      if (Math.abs(d) < step / 2) return { text: 'no change', tone: 'flat' }
      const tone = def.better === 0 ? 'flat' : Math.sign(d) === def.better ? 'good' : 'warn'
      return { text: `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(m.decimals)}`, tone }
    }

    // A selected weigh-in: its own value, and the change from the reading before it.
    let cur
    let delta = null
    let deltaTitle = ''
    let ago
    if (focus.value != null) {
      const i = all.findIndex(([t]) => Math.abs(t - focus.value) < SAME_WEIGHIN_MS)
      cur = all[i] || null
      if (cur && i > 0) {
        delta = change(cur[1] - all[i - 1][1])
        deltaTitle = `Change since the weigh-in of ${dayjs(all[i - 1][0]).format('D MMM YYYY')}`
      }
      ago = cur ? 'first reading' : 'not measured'
    } else {
      cur = all.at(-1)
      if (p.length > 1) {
        delta = change(cur[1] - p[0][1])
        deltaTitle = range.value ? `Change since ${range.value} days ago` : 'Change since the first weigh-in'
      }
      ago = fmt.ago(cur[0])
    }

    let spark = null
    if (p.length > 1) {
      const lo = Math.min(...p.map((x) => x[1]))
      const hi = Math.max(...p.map((x) => x[1]))
      const span = hi - lo || 1
      spark = p.map(([t, v], i) => `${i ? 'L' : 'M'}${sparkX(t).toFixed(2)},${(21 - ((v - lo) / span) * 18).toFixed(2)}`).join(' ')
    }
    return {
      key: def.metric,
      label: def.label,
      color: def.color,
      value: cur ? cur[1].toFixed(m.decimals) : '–',
      unit: cur ? m.unit : '',
      delta,
      deltaTitle,
      ago,
      spark,
      mark: focus.value != null && focus.value >= startMs.value ? sparkX(focus.value) : null,
    }
  }).filter(Boolean),
)
</script>

<style scoped>
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.chart {
  flex: 1.2 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chart-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  min-height: 1.25rem;
  margin-bottom: 0.25rem;
}

.cap {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--hx-text3);
}

.read {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  min-width: 0;
  font-size: 0.75rem;
  color: var(--hx-text2);
  white-space: nowrap;
  overflow: hidden;
}

.read b {
  color: var(--hx-text);
  font-weight: 650;
}

.fat {
  color: var(--hx-text3);
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

.last {
  font-size: 0.6875rem;
  font-weight: 650;
  fill: var(--hx-text);
}

.tiles {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6.25rem, 1fr));
  grid-template-rows: auto; /* the "which weigh-in" line */
  grid-auto-rows: 4rem;
  gap: 0.375rem;
  padding-top: 0.625rem;
  border-top: 1px solid var(--hx-border);
}

.tiles-head {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--hx-text3);
}

.tiles-head .clear {
  padding: 0.0625rem 0.5rem;
  font: inherit;
  color: var(--hx-text2);
  background: var(--hx-panel2);
  border: 1px solid var(--hx-border);
  border-radius: 999px;
  cursor: pointer;
}

.tile {
  --c: var(--hx-text2);
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0.375rem 0.625rem 0.375rem 0.75rem;
  line-height: 1.2;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--c) 10%, transparent), transparent 70%),
    var(--hx-panel2);
  border: 1px solid var(--hx-border);
  border-radius: 0.625rem;
  overflow: hidden;
}

.tile::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.5rem;
  bottom: 0.5rem;
  width: 2px;
  border-radius: 999px;
  background: var(--c);
}

.lbl {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--hx-text2);
  white-space: nowrap;
}

.val {
  font-size: 1rem;
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

.delta {
  font-size: 0.6875rem;
  font-weight: 600;
  white-space: nowrap;
}

.delta.good {
  color: var(--hx-sync);
}

.delta.warn {
  color: var(--hx-warn);
}

.delta.flat {
  font-weight: 500;
  color: var(--hx-text3);
}

.spark {
  position: absolute;
  right: 0.5rem;
  bottom: 0.4375rem;
  width: 34%;
  height: 1rem;
  overflow: visible;
}
</style>
