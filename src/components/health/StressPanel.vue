<template>
  <HealthPanel title="Stress" :accent="P.hrv" :loading="store.stressLoading">
    <template #meta>
      <div v-if="current" class="hx-stat">
        <span class="hx-stat-label">Now</span>
        <span class="hx-stat-value" :style="{ color: current.band.color }">
          {{ Math.round(current.v) }}<small>{{ current.band.label }}</small>
        </span>
      </div>
      <div v-if="rangeAvg != null" class="hx-stat">
        <span class="hx-stat-label">{{ store.stressDays }}-day avg</span>
        <span class="hx-stat-value">{{ Math.round(rangeAvg) }}</span>
      </div>
    </template>
    <template #actions>
      <HxSegmented v-model="days" :options="RANGES" />
    </template>

    <div class="stress">
      <!-- One day, minute by minute -->
      <section class="curve">
        <div class="curve-head">
          <div class="nav">
            <button class="hx-btn" title="Previous day" @click="store.shiftStressDay(-1)"><i class="pi pi-chevron-left" /></button>
            <span class="day">{{ dayLabel }}</span>
            <button class="hx-btn" title="Next day" :disabled="isToday" @click="store.shiftStressDay(1)"><i class="pi pi-chevron-right" /></button>
          </div>
          <div class="read">
            <template v-if="hit">
              <b>{{ fmt.time(hit.t) }}</b>
              <span :style="{ color: hit.band.color }">{{ Math.round(hit.v) }} {{ hit.band.label }}</span>
              <span v-if="hit.e != null" class="energy-read">energy {{ Math.round(hit.e) }}</span>
            </template>
            <template v-else-if="dayAvg != null">
              <span>avg <b>{{ Math.round(dayAvg) }}</b></span>
              <span>peak <b>{{ Math.round(dayPeak) }}</b></span>
            </template>
          </div>
          <button v-if="energyPts.length" :class="['key', { off: !showEnergy }]" @click="showEnergy = !showEnergy">
            <i />Body energy
          </button>
        </div>

        <div ref="plotEl" class="plot">
          <svg v-if="size.w > 40 && size.h > 40" :width="size.w" :height="size.h" @mousemove="onMove" @mouseleave="hoverX = null">
            <defs>
              <linearGradient :id="gid" gradientUnits="userSpaceOnUse" x1="0" :y1="Y(100)" x2="0" :y2="Y(0)">
                <template v-for="(s, i) in gradStops" :key="i">
                  <stop :offset="s.at" :stop-color="s.color" />
                </template>
              </linearGradient>
            </defs>

            <g v-for="b in STRESS" :key="b.key">
              <rect :x="L" :y="Y(Math.min(b.hi - 1, 100))" :width="plotW" :height="Math.max(Y(b.lo) - Y(Math.min(b.hi - 1, 100)), 0)" :fill="b.color" fill-opacity="0.075" />
              <text class="band-label" :x="L + plotW - 4" :y="Y(Math.min(b.hi - 1, 100)) + 11" text-anchor="end" :fill="b.color">{{ b.label }}</text>
            </g>
            <g v-for="v in [0, 25, 50, 80, 100]" :key="v">
              <line :x1="L" :x2="L + plotW" :y1="Y(v)" :y2="Y(v)" :stroke="P.grid" />
              <text class="tick" :x="L - 5" :y="Y(v) + 3.5" text-anchor="end">{{ v }}</text>
            </g>
            <g v-for="t in xTicks" :key="t.h">
              <line :x1="X(t.ms)" :x2="X(t.ms)" :y1="T" :y2="T + plotH" :stroke="P.grid" />
              <text class="tick" :x="X(t.ms)" :y="T + plotH + 13" text-anchor="middle">{{ t.label }}</text>
            </g>

            <template v-if="stressPts.length">
              <path v-if="area" :d="area" :fill="`url(#${gid})`" fill-opacity="0.13" />
              <path v-if="showEnergy && energyLine" :d="energyLine" fill="none" :stroke="P.energy" stroke-width="1.4" stroke-linejoin="round" stroke-opacity="0.85" stroke-dasharray="3 3" />
              <path :d="line" fill="none" :stroke="`url(#${gid})`" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" />
            </template>
            <line v-if="nowX != null" :x1="nowX" :x2="nowX" :y1="T" :y2="T + plotH" :stroke="P.text3" stroke-dasharray="2 3" />

            <template v-if="hit">
              <line :x1="hit.x" :x2="hit.x" :y1="T" :y2="T + plotH" :stroke="P.text3" />
              <circle :cx="hit.x" :cy="hit.y" r="3.6" :fill="hit.band.color" :stroke="P.panel" stroke-width="2" />
              <circle v-if="hit.ey != null && showEnergy" :cx="hit.x" :cy="hit.ey" r="3" :fill="P.energy" :stroke="P.panel" stroke-width="2" />
            </template>
          </svg>
          <div v-if="store.ready && !stressPts.length" class="hx-empty">No stress readings on this day.</div>
        </div>
      </section>

      <!-- The selected range -->
      <section class="lower">
        <div class="dist">
          <span class="cap">Time at each level</span>
          <div v-if="dist.total" class="stack">
            <span v-for="b in dist.bands" :key="b.key" :style="{ flexGrow: b.min, background: b.color }" :title="`${b.label} ${b.pct}%`" />
          </div>
          <div v-if="dist.total" class="levels">
            <div v-for="b in dist.bands" :key="b.key" class="lvl">
              <i :style="{ background: b.color }" />
              <span class="nm">{{ b.label }}</span>
              <span class="pc">{{ b.pct }}%</span>
              <span class="tm">{{ fmt.duration(b.perDay) }}<small>/day</small></span>
            </div>
          </div>
          <span v-else class="none">No readings in {{ store.stressDays }} days.</span>
        </div>

        <div class="daily">
          <span class="cap">Daily average</span>
          <div class="bars">
            <i v-for="v in [25, 50, 80]" :key="v" class="guide" :style="{ bottom: v + '%' }" />
            <button
              v-for="d in rangeDays"
              :key="d.key"
              type="button"
              :class="['bar', { sel: d.key === store.stressKey, empty: d.mean == null }]"
              :style="{ height: d.mean == null ? '0%' : Math.max(d.mean, 3) + '%', background: d.band?.color }"
              :title="`${fmt.day(d.key)}${d.mean != null ? ` · avg ${Math.round(d.mean)} (${d.band.label})` : ' · no data'}`"
              @click="store.selectStressDay(d.key)"
            />
          </div>
          <div class="span"><span>{{ dayjs(rangeDays[0]?.key).format('D MMM') }}</span><span>today</span></div>
        </div>
      </section>
    </div>
  </HealthPanel>
</template>

<script setup>
// Stress (0–100, Xiaomi's levels): the selected day as a minute curve with the
// four level bands behind it (body energy optional), and for the chosen range the
// time spent at each level plus daily averages. A daily bar opens that day's curve.
import { ref, reactive, computed } from 'vue'
import dayjs from 'dayjs'
import HealthPanel from './HealthPanel.vue'
import HxSegmented from './HxSegmented.vue'
import { P, STRESS, stressBand, fmt } from '@/lib/health/theme'
import { useSize, linePath, nearest } from '@/lib/health/draw'
import { useHealthStore } from '@/stores/health'

const store = useHealthStore()

const RANGES = [
  { label: '7 d', value: 7 },
  { label: '30 d', value: 30 },
  { label: '90 d', value: 90 },
]
const days = computed({
  get: () => store.stressDays,
  set: (d) => store.setStressDays(d),
})

const gid = `hx-stress-${Math.random().toString(36).slice(2, 8)}`
const showEnergy = ref(true)

// ── Day curve ──

const plotEl = ref(null)
const size = reactive(useSize(plotEl))
const L = 28
const R = 8
const T = 6
const B = 18
const plotW = computed(() => Math.max(size.w - L - R, 1))
const plotH = computed(() => Math.max(size.h - T - B, 1))

const dayStart = computed(() => dayjs(store.stressKey).startOf('day').valueOf())
const dayEnd = computed(() => dayjs(store.stressKey).add(1, 'day').startOf('day').valueOf())
const isToday = computed(() => store.stressKey === store.todayKey)

const X = (ms) => L + ((ms - dayStart.value) / (dayEnd.value - dayStart.value)) * plotW.value
const Y = (v) => T + (1 - v / 100) * plotH.value

const dayLabel = computed(() => (isToday.value ? 'Today' : dayjs(store.stressKey).format('ddd D MMM')))

const xTicks = computed(() => {
  const step = size.w < 420 ? 6 : 3
  const out = []
  for (let h = 0; h <= 24; h += step) {
    const ms = dayStart.value + h * 3600e3
    out.push({ h, ms, label: h === 24 ? '' : dayjs(ms).format('HH:mm') })
  }
  return out
})

const stressPts = computed(() => store.stressDay.stress)
const energyPts = computed(() => store.stressDay.energy)

// Readings further apart than this are not joined.
const gap = computed(() => {
  const p = stressPts.value
  if (p.length < 3) return 20 * 60e3
  const d = p.slice(1).map((x, i) => x[0] - p[i][0]).sort((a, b) => a - b)
  return Math.max(d[d.length >> 1] * 4, 10 * 60e3)
})

function pathOf(pts) {
  const g = gap.value
  const xy = pts.map(([t, v]) => [X(t), Y(Math.max(0, Math.min(100, v)))])
  let d = ''
  let prevT = null
  pts.forEach(([t], i) => {
    d += `${prevT != null && t - prevT <= g ? 'L' : 'M'}${xy[i][0].toFixed(1)},${xy[i][1].toFixed(1)} `
    prevT = t
  })
  return d.trim()
}

const line = computed(() => pathOf(stressPts.value))
const energyLine = computed(() => (energyPts.value.length ? pathOf(energyPts.value) : ''))

// Filled wash to the baseline, one closed shape per continuous run.
const area = computed(() => {
  const pts = stressPts.value
  if (pts.length < 2) return ''
  const g = gap.value
  const base = Y(0)
  let d = ''
  let run = []
  const flush = () => {
    if (run.length > 1) {
      d += `M${run[0][0].toFixed(1)},${base} ` + run.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + ` L${run.at(-1)[0].toFixed(1)},${base} Z `
    }
    run = []
  }
  let prevT = null
  for (const [t, v] of pts) {
    if (prevT != null && t - prevT > g) flush()
    run.push([X(t), Y(Math.max(0, Math.min(100, v)))])
    prevT = t
  }
  flush()
  return d
})

// Hard colour stops at the band edges, so the line itself reads its level.
const gradStops = computed(() => {
  const stops = []
  const at = (v) => (100 - v) / 100
  const bands = [...STRESS].reverse()   // high first (top of the plot)
  for (const b of bands) {
    stops.push({ at: at(Math.min(b.hi, 101) - 1), color: b.color }, { at: at(b.lo), color: b.color })
  }
  return stops
})

const nowX = computed(() => {
  if (!isToday.value) return null
  const x = X(store.now)
  return x > L && x < L + plotW.value ? x : null
})

const hoverX = ref(null)
function onMove(e) {
  hoverX.value = e.clientX - e.currentTarget.getBoundingClientRect().left
}

const stressXs = computed(() => stressPts.value.map(([t]) => X(t)))
const energyXs = computed(() => energyPts.value.map(([t]) => X(t)))

const hit = computed(() => {
  if (hoverX.value == null || !stressPts.value.length) return null
  const i = nearest(stressXs.value, hoverX.value)
  const [t, v] = stressPts.value[i]
  if (Math.abs(stressXs.value[i] - hoverX.value) > 24) return null
  let e = null
  let ey = null
  if (energyPts.value.length) {
    const j = nearest(energyXs.value, stressXs.value[i])
    if (Math.abs(energyPts.value[j][0] - t) < 30 * 60e3) {
      e = energyPts.value[j][1]
      ey = Y(e)
    }
  }
  return { t, v, band: stressBand(v), x: stressXs.value[i], y: Y(v), e, ey }
})

const dayAvg = computed(() => {
  const p = stressPts.value
  return p.length ? p.reduce((a, x) => a + x[1], 0) / p.length : null
})
const dayPeak = computed(() => Math.max(...stressPts.value.map((p) => p[1])))

const current = computed(() => {
  const l = store.latest.stress
  return l && Date.now() - l[0] < 36 * 3600e3 ? { v: l[1], band: stressBand(l[1]) } : null
})

// ── Range: distribution + daily bars ──

const rangeStartKey = computed(() => dayjs(store.todayKey).subtract(store.stressDays - 1, 'day').format('YYYY-MM-DD'))

// Minutes per reading: the median spacing of the day in view (1 min when it is empty).
const spacingMin = computed(() => {
  const p = stressPts.value
  if (p.length < 3) return 1
  const d = p.slice(1).map((x, i) => x[0] - p[i][0]).sort((a, b) => a - b)
  return Math.min(Math.max(d[d.length >> 1] / 60e3, 1), 30)
})

const dist = computed(() => {
  const mins = STRESS.map(() => 0)
  const seen = new Set()
  for (const [t, mean, , , n] of store.stressRange) {
    mins[STRESS.indexOf(stressBand(mean))] += n * spacingMin.value
    seen.add(dayjs(t).format('YYYY-MM-DD'))
  }
  const total = mins.reduce((a, b) => a + b, 0)
  const nDays = Math.max(seen.size, 1)
  return {
    total,
    bands: STRESS.map((b, i) => ({ ...b, min: mins[i], pct: total ? Math.round((mins[i] / total) * 100) : 0, perDay: mins[i] / nDays })),
  }
})

const rangeDays = computed(() => {
  const byDay = new Map((store.daily.stress || []).map((d) => [d.day, d.mean]))
  const out = []
  for (let d = dayjs(rangeStartKey.value); !d.isAfter(dayjs(store.todayKey), 'day'); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD')
    const mean = byDay.get(key) ?? null
    out.push({ key, mean, band: mean == null ? null : stressBand(mean) })
  }
  return out
})

const rangeAvg = computed(() => {
  const v = rangeDays.value.filter((d) => d.mean != null).map((d) => d.mean)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
})
</script>

<style scoped>
.stress {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.curve {
  flex: 1.45 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.curve-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 1.75rem;
  margin-bottom: 0.25rem;
}

.nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.nav .hx-btn {
  height: 1.5rem;
  min-width: 1.5rem;
  padding: 0;
}

.day {
  min-width: 5.25rem;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 600;
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

.energy-read {
  color: var(--hx-energy);
}

.key {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin-left: auto;
  padding: 0.125rem 0.25rem;
  font: inherit;
  font-size: 0.75rem;
  color: var(--hx-text2);
  background: none;
  border: 0;
  cursor: pointer;
  white-space: nowrap;
}

.key i {
  width: 0.875rem;
  height: 0;
  border-top: 2px dashed currentColor;
  background: none !important;
  color: var(--hx-energy);
}

.key.off {
  opacity: 0.45;
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

.lower {
  flex: 1 1 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 1rem;
  padding-top: 0.625rem;
  border-top: 1px solid var(--hx-border);
}

.cap {
  display: block;
  margin-bottom: 0.375rem;
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--hx-text3);
}

.dist {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.stack {
  display: flex;
  height: 0.75rem;
  gap: 2px;
  flex-shrink: 0;
}

.stack span {
  flex-basis: 0;
  min-width: 2px;
  border-radius: 3px;
}

.levels {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-evenly;
  margin-top: 0.5rem;
}

.lvl {
  display: grid;
  grid-template-columns: 0.5rem minmax(0, 1fr) 2.25rem auto;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  white-space: nowrap;
}

.lvl i {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 2px;
}

.lvl .pc {
  font-weight: 650;
  text-align: right;
}

.lvl .tm {
  min-width: 4.5rem;
  text-align: right;
  color: var(--hx-text2);
}

.lvl small {
  margin-left: 0.125rem;
  color: var(--hx-text3);
  font-size: 0.6875rem;
}

.none {
  font-size: 0.75rem;
  color: var(--hx-text3);
}

.daily {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.bars {
  position: relative;
  flex: 1;
  min-height: 2.5rem;
  display: flex;
  align-items: flex-end;
  gap: 2px;
}

.guide {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 1px dashed var(--hx-grid);
  pointer-events: none;
}

.bar {
  position: relative;
  z-index: 1;
  flex: 1 1 0;
  min-width: 2px;
  max-width: 1.5rem;
  padding: 0;
  border: 0;
  border-radius: 2px 2px 0 0;
  opacity: 0.78;
  cursor: pointer;
  transition: opacity 0.15s;
}

.bar.empty {
  min-height: 2px;
  background: var(--hx-border2);
  opacity: 1;
  cursor: default;
}

.bar:hover:not(.empty) {
  opacity: 1;
}

.bar.sel {
  opacity: 1;
  box-shadow: 0 0 0 1.5px var(--hx-panel), 0 0 0 3px var(--hx-text2);
}

.span {
  display: flex;
  justify-content: space-between;
  margin-top: 0.25rem;
  font-size: 0.625rem;
  color: var(--hx-text3);
}

@media (max-width: 30em) {
  .curve {
    flex: 0 0 15rem;
  }

  .lower {
    flex: 1 0 auto;
    grid-template-columns: minmax(0, 1fr);
  }

  .bars {
    height: 5rem;
    flex: none;
  }
}
</style>
