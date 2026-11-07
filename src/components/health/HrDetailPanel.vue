<template>
  <HealthPanel class="hr-detail" :accent="P.hr" :loading="store.detailLoading">
    <template #title>
      <span class="hx-dot" />
      <h2>Heart rate</h2>
      <span v-if="range.live" class="hx-live">Live</span>
      <span v-else class="when">{{ windowLabel }}</span>
    </template>

    <template #meta>
      <template v-if="stats">
        <div class="hx-stat">
          <span class="hx-stat-label">Low</span>
          <span class="hx-stat-value" :style="{ color: textTint(zoneOf(stats.lo[1], bounds)) }">{{ Math.round(stats.lo[1]) }}<small>bpm</small></span>
        </div>
        <div class="hx-stat opt-avg">
          <span class="hx-stat-label">Avg</span>
          <span class="hx-stat-value">{{ Math.round(stats.avg) }}<small>bpm</small></span>
        </div>
        <div class="hx-stat">
          <span class="hx-stat-label">High</span>
          <span class="hx-stat-value" :style="{ color: textTint(zoneOf(stats.hi[1], bounds)) }">{{ Math.round(stats.hi[1]) }}<small>bpm</small></span>
        </div>
        <div v-if="store.sources.steps" class="hx-stat opt-steps">
          <span class="hx-stat-label">Steps</span>
          <span class="hx-stat-value">{{ fmt.int(stepsTotal) }}</span>
        </div>
        <div v-if="range.live" class="hx-stat" :title="fmt.dayTime(stats.last[0])">
          <span class="hx-stat-label">Latest · {{ fmt.time(stats.last[0]) }}</span>
          <span class="hx-stat-value" :style="{ color: textTint(zoneOf(stats.last[1], bounds)) }">{{ Math.round(stats.last[1]) }}<small>bpm</small></span>
        </div>
      </template>
    </template>

    <template #actions>
      <button v-if="zoomed" class="hx-btn" title="Reset zoom" @click="resetZoom">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M5 7h4M10.5 10.5 14 14" /></svg>
      </button>
      <HxSegmented :model-value="store.detailHours" :options="PRESETS" @update:model-value="store.setDetailHours" />
      <div class="pager">
        <button class="hx-btn" title="Earlier" @click="store.shiftDetail(-1)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
        </button>
        <button class="hx-btn" title="Later" :disabled="range.live" @click="store.shiftDetail(1)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
        </button>
      </div>
      <button v-if="!range.live" class="hx-btn now" title="Back to now" @click="store.goLive()">
        Now
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3.5 8.5 8 4 12.5M9 3.5 13.5 8 9 12.5" /></svg>
      </button>
    </template>

    <div ref="box" class="plot">
      <v-chart ref="chart" class="hx-chart" :option="option" autoresize @datazoom="onZoom" />
      <div v-if="!inWindow.length && !store.detailLoading" class="hx-empty">
        No heart-rate readings in this window.
      </div>
    </div>
  </HealthPanel>
</template>

<script setup>
// Minute-by-minute heart rate for the window the store points at (3–24 h).
// The trace, its zone colouring and glow, the zone ladder, the sleep / workout
// bands and the step blocks are hand-drawn custom series; ECharts only supplies
// the axes, the hover snapping and the wheel / drag zoom.
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import VChart from 'vue-echarts'
import { use, graphic } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, CustomChart, EffectScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  DataZoomInsideComponent,
  VisualMapPiecewiseComponent,
} from 'echarts/components'
import HealthPanel from './HealthPanel.vue'
import HxSegmented from './HxSegmented.vue'
import { P, FONT, alpha, zoneBounds, zoneOf, axisLabel, base, fmt } from '@/lib/health/theme'
import { EXERCISE_TYPES, SLEEP_ROWS, stageRow, stageMinutes } from '@/lib/health/metrics'
import { useHealthStore, DETAIL_HOURS } from '@/stores/health'

use([
  CanvasRenderer,
  LineChart,
  CustomChart,
  EffectScatterChart,
  GridComponent,
  TooltipComponent,
  DataZoomInsideComponent,
  VisualMapPiecewiseComponent,
])

const store = useHealthStore()

const MIN = 60e3
const GAP = 3 * MIN        // a longer silence breaks the trace
const QUIET = 45 * MIN     // long enough to say "no readings" in the gap
const PRESETS = DETAIL_HOURS.map((h) => ({ label: `${h}h`, value: h }))
const STAGE = Object.fromEntries(SLEEP_ROWS.map((r) => [r.key, r]))
const SLEEP_BAND = STAGE.light.color

// Relaxed is most of any day, so its trace is a firm slate that deepens
// towards the top of the zone (slate-500 → slate-600) instead of fading into
// the white panel. Numbers and labels use an inked shade of the zone colour:
// yellow and sky are fine as lines on white but too faint as small type.
const RELAXED_HI = '#475569'
const RELAXED_LO = '#64748b'
const tint = (z) => (z.key === 'rest' ? RELAXED_HI : z.color)
const textTint = (z) => (z.key === 'rest' ? P.text2 : ink(z.color))

function ink(hex, t = 0.3) {
  const a = parseInt(hex.slice(1), 16)
  const b = parseInt(P.text.slice(1), 16)
  const ch = (n, s) => (n >> s) & 255
  const c = [16, 8, 0].map((s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

const STEPS_INK = ink(P.steps)

// Soft white halo under a line: lifts it off the grid and fills beneath
// without the smudge a coloured glow leaves on white.
const HALO = { shadowBlur: 4, shadowColor: P.panel }

const range = computed(() => store.detailRange)
const bounds = computed(() => zoneBounds(store.settings.maxHr))

// ── Size (the chart lays out its two strips in pixels) ──
const box = ref(null)
const chart = ref(null)
const size = ref({ w: 900, h: 320 })
let observer = null
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    if (width && height) size.value = { w: width, h: height }
  })
  observer.observe(box.value)
})
onBeforeUnmount(() => observer?.disconnect())

// The page scrolls below 1280 px; there the wheel and one-finger drag should
// scroll it, so zoom needs Ctrl / a pinch.
const scrollingPage = window.matchMedia('(max-width: 80em)')
const pageScrolls = ref(scrollingPage.matches)
const onMedia = (e) => (pageScrolls.value = e.matches)
scrollingPage.addEventListener('change', onMedia)
onBeforeUnmount(() => scrollingPage.removeEventListener('change', onMedia))

const layout = computed(() => {
  const { w, h } = size.value
  const narrow = w < 560
  const axisH = 24
  const stepsH = Math.round(Math.min(Math.max(h * 0.2, 36), 86))
  const gap = 22
  return {
    narrow,
    left: 34,
    right: narrow ? 14 : 76,
    top: 16,
    axisH,
    stepsH,
    gap,
    hrBottom: axisH + stepsH + gap,
  }
})

// ── Data ──

// Readings inside the window (a live window slides a minute ahead of the last fetch).
const inWindow = computed(() => {
  const { start, end } = range.value
  return store.detail.hr.filter(([t]) => t >= start && t <= end)
})

const stats = computed(() => {
  const pts = inWindow.value
  if (!pts.length) return null
  let lo = pts[0]
  let hi = pts[0]
  let sum = 0
  for (const p of pts) {
    if (p[1] < lo[1]) lo = p
    if (p[1] > hi[1]) hi = p
    sum += p[1]
  }
  return { lo, hi, avg: sum / pts.length, last: pts.at(-1) }
})

// 30-minute step blocks touching the window; the total counts blocks centred in it.
const blocks = computed(() => {
  const { start, end } = range.value
  return store.detail.steps
    .map(([s, e, n]) => [s, e ?? s + 30 * MIN, n])
    .filter(([s, e, n]) => n > 0 && e > start && s < end)
})
const stepsTotal = computed(() => {
  const { start, end } = range.value
  return blocks.value
    .filter(([s, e]) => (s + e) / 2 >= start && (s + e) / 2 <= end)
    .reduce((a, b) => a + b[2], 0)
})

// Continuous stretches of readings, split where the watch went quiet.
const runs = computed(() => {
  const out = []
  let run = []
  for (const p of inWindow.value) {
    if (run.length && p[0] - run.at(-1)[0] > GAP) {
      out.push(run)
      run = []
    }
    run.push(p)
  }
  if (run.length) out.push(run)
  return out
})

// Silences long enough to label (including a window that starts or ends quiet).
const quiet = computed(() => {
  const { start, end, live } = range.value
  const out = []
  const list = runs.value
  if (!list.length) return out
  if (list[0][0][0] - start >= QUIET) out.push([start, list[0][0][0]])
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1].at(-1)[0]
    const b = list[i][0][0]
    if (b - a >= QUIET) out.push([a, b])
  }
  const last = list.at(-1).at(-1)[0]
  if (!live && end - last >= QUIET) out.push([last, end])
  return out
})

// Sleep and workouts in view, clipped to the window.
const bands = computed(() => {
  const { start, end } = range.value
  return store.detailSessions
    .map((s) => {
      const from = new Date(s.start_time).getTime()
      const to = new Date(s.end_time).getTime()
      const sleep = s.kind === 'sleep'
      const m = sleep ? stageMinutes(s) : null
      const name = sleep ? 'Sleep' : s.title || EXERCISE_TYPES[s.exercise_type] || 'Workout'
      return {
        from: Math.max(from, start),
        to: Math.min(to, end),
        sleep,
        name,
        color: sleep ? SLEEP_BAND : P.kcal,
        label: `${name} · ${fmt.duration(sleep ? m.rem + m.light + m.deep : (to - from) / MIN)}`,
        stages: sleep
          ? (s.stages || []).map((st) => [new Date(st.start).getTime(), new Date(st.end).getTime(), stageRow(st.stage)])
          : [],
      }
    })
    .filter((b) => b.to > b.from)
})

// bpm axis: a floor just under the lowest reading, a tick step that gives 3–6
// rows, and a ceiling on a whole step so the top label is a real tick.
const yRange = computed(() => {
  const pts = inWindow.value
  if (!pts.length) return { min: 40, max: 120, interval: 20 }
  let lo = Infinity
  let hi = -Infinity
  for (const [, v] of pts) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const min = Math.max(0, Math.floor((lo - 6) / 10) * 10)
  const span = hi + 8 - min
  const interval = span <= 50 ? 10 : span <= 100 ? 20 : span <= 160 ? 30 : 40
  return { min, max: min + Math.max(Math.ceil(span / interval), 3) * interval, interval }
})

const windowLabel = computed(() => {
  const s = dayjs(range.value.start)
  const e = dayjs(range.value.end)
  return s.isSame(e, 'day')
    ? `${s.format('ddd D MMM')} · ${s.format('HH:mm')}–${e.format('HH:mm')}`
    : `${s.format('ddd D MMM, HH:mm')} – ${e.format('ddd D, HH:mm')}`
})

// ── Zoom (kept across refreshes, reset when the window moves) ──
let zoomState = { start: 0, end: 100 }
const zoomed = ref(false)

function onZoom(e) {
  const z = e.batch?.[0] ?? e
  if (z.start == null || z.end == null) return
  zoomState = { start: z.start, end: z.end }
  zoomed.value = z.end - z.start < 99.5
}

function resetZoom() {
  chart.value?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
}

watch(
  () => [store.detailHours, store.detailEnd],
  () => {
    zoomState = { start: 0, end: 100 }
    zoomed.value = false
  },
)

// ── Tooltip ──

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function nearestReading(t) {
  const pts = inWindow.value
  let lo = 0
  let hi = pts.length - 1
  if (hi < 0) return null
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid][0] < t) lo = mid + 1
    else hi = mid
  }
  const best = [pts[lo], pts[lo - 1]]
    .filter(Boolean)
    .reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a))
  return Math.abs(best[0] - t) <= 90e3 ? best : null
}

const CARD = [
  `font-family:${FONT}`,
  `color:${P.text}`,
  'min-width:12.5rem',
  'padding:0.625rem 0.75rem',
  'background:rgba(255,255,255,0.96)',
  'backdrop-filter:blur(10px)',
  `border:1px solid ${P.border2}`,
  'border-radius:0.75rem',
  'box-shadow:0 2px 6px rgba(15,23,42,0.06),0 14px 34px rgba(15,23,42,0.14)',
].join(';')

function row(color, label, value) {
  return `<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.3rem;font-size:0.75rem">`
    + `<span style="width:0.5rem;height:0.5rem;border-radius:2px;background:${color}"></span>`
    + `<span style="color:${P.text2}">${label}</span>`
    + `<span style="margin-left:auto;padding-left:1rem;font-weight:600;font-variant-numeric:tabular-nums">${value}</span></div>`
}

function tooltipHtml(params) {
  const t = params?.[0]?.axisValue
  if (t == null) return ''
  const hr = nearestReading(t)
  const at = dayjs(hr ? hr[0] : t)
  let html = `<div style="${CARD}">`
    + `<div style="display:flex;justify-content:space-between;gap:1rem;font-size:0.6875rem;color:${P.text3}">`
    + `<span>${at.format('ddd D MMM')}</span><span style="color:${P.text2};font-weight:600">${at.format('HH:mm')}</span></div>`

  if (hr) {
    const z = zoneOf(hr[1], bounds.value)
    const c = tint(z)
    const t = textTint(z)
    html += `<div style="display:flex;align-items:baseline;gap:0.375rem;margin:0.375rem 0 0.125rem">`
      + `<span style="font-size:1.75rem;font-weight:700;line-height:1;letter-spacing:-0.02em;color:${t}">${Math.round(hr[1])}</span>`
      + `<span style="font-size:0.75rem;color:${P.text3}">bpm</span>`
      + `<span style="margin-left:auto;padding:0.125rem 0.5rem;border-radius:999px;font-size:0.6875rem;font-weight:600;color:${t};background:${alpha(c, 0.1)};border:1px solid ${alpha(c, 0.32)}">${z.label}</span></div>`
      + `<div style="font-size:0.6875rem;color:${P.text3}">${Math.round((hr[1] / store.settings.maxHr) * 100)}% of max heart rate</div>`
  } else {
    html += `<div style="margin:0.375rem 0 0.125rem;font-size:0.8125rem;color:${P.text3}">No reading</div>`
  }

  const block = blocks.value.find(([s, e]) => t >= s && t < e)
  if (block) html += row(P.steps, `Steps ${fmt.time(block[0])}–${fmt.time(block[1])}`, fmt.int(block[2]))

  const band = bands.value.find((b) => t >= b.from && t < b.to)
  if (band?.sleep) {
    const st = band.stages.find(([s, e]) => t >= s && t < e)
    html += row(st ? STAGE[st[2]].color : band.color, st ? (st[2] === 'awake' ? 'Awake' : `Asleep · ${STAGE[st[2]].label}`) : 'Asleep', '')
  } else if (band) {
    html += row(band.color, esc(band.name), fmt.duration((band.to - band.from) / MIN))
  }
  return html + '</div>'
}

// ── Hand-drawn layers (custom series renderItems) ──
// Every group is returned with $mergeChildren: false. ECharts otherwise reuses
// children by index, and a child whose type changes (a label slot that becomes
// a rect) inherits the old element's x/y, drawing it somewhere else entirely.

// Pixel-space vertical gradient for the area under the trace: zone-coloured
// strata, strongest at the top of the plot and fading towards the floor.
function strataGradient(api, cs, zones, y) {
  const stops = []
  const fade = (o) => 0.22 * Math.pow(1 - o, 1.15) + 0.03
  for (const z of [...zones].reverse()) {
    const top = Math.min(z.hi, y.max)
    const bot = Math.max(z.lo, y.min)
    if (top <= bot) continue
    const c = z.key === 'rest' ? RELAXED_LO : z.color
    const o1 = (api.coord([0, top])[1] - cs.y) / cs.height
    const o2 = (api.coord([0, bot])[1] - cs.y) / cs.height
    stops.push({ offset: Math.min(Math.max(o1, 0), 1), color: alpha(c, fade(o1)) })
    stops.push({ offset: Math.min(Math.max(o2, 0), 1), color: alpha(c, fade(o2)) })
  }
  if (!stops.length) stops.push({ offset: 0, color: alpha(P.hr, 0.2) }, { offset: 1, color: alpha(P.hr, 0) })
  return new graphic.LinearGradient(0, cs.y, 0, cs.y + cs.height, stops, true)
}

function makeTraceRenderer(runList, zones, y) {
  const zoneIndex = (v) => {
    for (let i = zones.length - 1; i >= 0; i--) if (v >= zones[i].lo) return i
    return 0
  }
  return (params, api) => {
    const cs = params.coordSys
    const left = cs.x - 4
    const right = cs.x + cs.width + 4
    const floor = cs.y + cs.height
    const fill = strataGradient(api, cs, zones, y)
    const relaxedTop = api.coord([0, Math.min(zones[0].hi, y.max)])[1]
    const relaxedStroke = new graphic.LinearGradient(0, relaxedTop, 0, floor, [
      { offset: 0, color: RELAXED_HI },
      { offset: 1, color: RELAXED_LO },
    ], true)
    const children = []
    let lo = null
    let hi = null

    for (const run of runList) {
      // Pixel points, trimmed to what's on screen plus one neighbour each side.
      const px = run.map(([t, v]) => {
        const [x, yy] = api.coord([t, v])
        return { x, y: yy, v }
      })
      let a = px.findIndex((p) => p.x >= left)
      if (a === -1) continue
      let b = px.length - 1
      while (b > a && px[b].x > right) b--
      a = Math.max(0, a - 1)
      b = Math.min(px.length - 1, b + 1)
      const pts = px.slice(a, b + 1)

      for (const p of pts) {
        if (p.x < cs.x || p.x > cs.x + cs.width) continue
        if (!lo || p.v < lo.v) lo = p
        if (!hi || p.v > hi.v) hi = p
      }

      if (pts.length === 1) {
        const z = zones[zoneIndex(pts[0].v)]
        children.push({ type: 'circle', shape: { cx: pts[0].x, cy: pts[0].y, r: 1.75 }, style: { fill: tint(z) } })
        continue
      }

      // Area under the run.
      children.push({
        type: 'polygon',
        shape: { points: [...pts.map((p) => [p.x, p.y]), [pts.at(-1).x, floor], [pts[0].x, floor]] },
        style: { fill },
        silent: true,
      })

      // Stroke split wherever it crosses a zone boundary, each piece in its zone colour.
      let seg = [[pts[0].x, pts[0].y]]
      let segZone = zoneIndex(pts[0].v)
      const flush = () => {
        if (seg.length < 2) return
        const z = zones[segZone]
        const relaxed = z.key === 'rest'
        children.push({
          type: 'polyline',
          shape: { points: seg },
          style: {
            stroke: relaxed ? relaxedStroke : z.color,
            lineWidth: 1.75,
            fill: null,
            lineJoin: 'round',
            lineCap: 'round',
            ...HALO,
          },
          silent: true,
        })
      }
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]
        const q = pts[i]
        const zq = zoneIndex(q.v)
        const step = zq > segZone ? 1 : -1
        for (let k = segZone; k !== zq; k += step) {
          const edge = step > 0 ? zones[k + 1].lo : zones[k].lo
          const f = (edge - p.v) / (q.v - p.v)
          const cross = [p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f]
          seg.push(cross)
          flush()
          seg = [cross]
          segZone = k + step
        }
        seg.push([q.x, q.y])
      }
      flush()
    }

    // High / low markers for what's on screen.
    const marker = (p, above) => {
      const c = tint(zones[zoneIndex(p.v)])
      const ly = above ? Math.max(p.y - 8, cs.y + 2) : Math.min(p.y + 8, floor - 2)
      const lx = Math.min(Math.max(p.x, cs.x + 12), cs.x + cs.width - 12)
      children.push(
        {
          type: 'circle',
          shape: { cx: p.x, cy: p.y, r: 3.25 },
          style: { fill: c, stroke: P.panel, lineWidth: 1.75, shadowBlur: 3, shadowOffsetY: 1, shadowColor: 'rgba(15, 23, 42, 0.3)' },
          z2: 10,
        },
        {
          type: 'text',
          x: lx,
          y: ly,
          style: {
            text: String(Math.round(p.v)),
            fill: P.text,
            font: `600 10px ${FONT}`,
            align: 'center',
            verticalAlign: above ? 'bottom' : 'top',
            stroke: P.panel,
            lineWidth: 3,
          },
          z2: 11,
        },
      )
    }
    if (hi) marker(hi, true)
    if (lo && lo !== hi && hi.v - lo.v >= 3) marker(lo, false)

    return { type: 'group', $mergeChildren: false, children }
  }
}

// Dashed zone boundaries across the plot, the colour ladder on the right edge
// and "no readings" over long silences.
function makeZoneRenderer(zones, y, quietList, L) {
  return (params, api) => {
    const cs = params.coordSys
    const children = []
    const yAt = (v) => Math.round(api.coord([0, v])[1]) + 0.5

    for (const z of zones.slice(1)) {
      if (z.lo <= y.min || z.lo >= y.max) continue
      const yy = yAt(z.lo)
      children.push({
        type: 'line',
        shape: { x1: cs.x, y1: yy, x2: cs.x + cs.width, y2: yy },
        style: { stroke: alpha(z.color, 0.45), lineWidth: 1, lineDash: [2, 5] },
      })
    }

    const lx = cs.x + cs.width + 8
    for (const z of zones) {
      const top = Math.min(z.hi, y.max)
      const bot = Math.max(z.lo, y.min)
      if (top <= bot) continue
      const y1 = api.coord([0, top])[1]
      const y2 = api.coord([0, bot])[1]
      children.push({
        type: 'rect',
        shape: { x: lx, y: y1 + 1, width: 3, height: Math.max(y2 - y1 - 2, 1), r: 1.5 },
        style: { fill: z.color },
      })
      if (!L.narrow && y2 - y1 >= 13) {
        children.push({
          type: 'text',
          x: lx + 8,
          y: (y1 + y2) / 2,
          style: {
            text: z.label,
            fill: textTint(z),
            font: `600 10px ${FONT}`,
            align: 'left',
            verticalAlign: 'middle',
          },
        })
      }
    }

    for (const [a, b] of quietList) {
      const x1 = Math.max(api.coord([a, 0])[0], cs.x)
      const x2 = Math.min(api.coord([b, 0])[0], cs.x + cs.width)
      if (x2 - x1 < 70) continue
      const yy = cs.y + cs.height * 0.62
      children.push(
        { type: 'line', shape: { x1: x1 + 10, y1: yy, x2: x2 - 10, y2: yy }, style: { stroke: alpha(P.text3, 0.35), lineWidth: 1, lineDash: [1, 4] } },
        {
          type: 'text',
          x: (x1 + x2) / 2,
          y: yy,
          style: {
            text: 'no readings',
            fill: P.text3,
            font: `500 10px ${FONT}`,
            align: 'center',
            verticalAlign: 'middle',
            backgroundColor: P.panel,
            padding: [1, 6],
          },
        },
      )
    }
    return { type: 'group', $mergeChildren: false, children }
  }
}

// Sleep / workout bands through both strips, with the sleep stages as a ribbon on top.
function makeBandRenderer(bandList, L) {
  return (params, api) => {
    const b = bandList[params.dataIndex]
    const cs = params.coordSys
    const x0 = Math.max(api.coord([b.from, 0])[0], cs.x)
    const x1 = Math.min(api.coord([b.to, 0])[0], cs.x + cs.width)
    if (x1 - x0 < 1) return null
    const y0 = cs.y - 4
    const y1 = cs.y + cs.height + L.gap + L.stepsH
    const children = [
      {
        type: 'rect',
        shape: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
        style: {
          fill: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: alpha(b.color, 0.13) },
            { offset: 1, color: alpha(b.color, 0.035) },
          ]),
        },
      },
      { type: 'rect', shape: { x: x0, y: y0, width: 1, height: y1 - y0 }, style: { fill: alpha(b.color, 0.22) } },
      { type: 'rect', shape: { x: x1 - 1, y: y0, width: 1, height: y1 - y0 }, style: { fill: alpha(b.color, 0.22) } },
    ]
    if (b.sleep && b.stages.length) {
      for (const [s, e, row] of b.stages) {
        const sx0 = Math.max(api.coord([s, 0])[0], x0)
        const sx1 = Math.min(api.coord([e, 0])[0], x1)
        if (sx1 - sx0 > 0.25) {
          children.push({ type: 'rect', shape: { x: sx0, y: y0, width: sx1 - sx0, height: 4 }, style: { fill: STAGE[row].color } })
        }
      }
    } else {
      children.push({
        type: 'rect',
        shape: { x: x0, y: y0, width: x1 - x0, height: 2.5 },
        style: { fill: b.color },
      })
    }
    if (x1 - x0 >= 36) {
      children.push({
        type: 'text',
        x: x0 + 6,
        y: y0 + 9,
        style: {
          text: x1 - x0 >= 110 ? b.label : b.name,
          fill: ink(b.color),
          font: `600 10px ${FONT}`,
          align: 'left',
          verticalAlign: 'top',
          width: x1 - x0 - 10,
          overflow: 'truncate',
          ellipsis: '…',
        },
      })
    }
    return { type: 'group', $mergeChildren: false, children }
  }
}

function renderStepBlock(params, api) {
  const cs = params.coordSys
  const top = api.coord([api.value(0), api.value(2)])
  const end = api.coord([api.value(1), 0])
  const x0 = Math.max(top[0] + 1, cs.x)
  const x1 = Math.min(end[0] - 1, cs.x + cs.width)
  const h = end[1] - top[1]
  if (x1 - x0 < 0.5 || h < 0.5) return null
  return {
    type: 'rect',
    shape: { x: x0, y: top[1], width: x1 - x0, height: h, r: [2, 2, 0, 0] },
    style: {
      fill: new graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: alpha(P.steps, 0.85) },
        { offset: 1, color: alpha(P.steps, 0.18) },
      ]),
    },
    emphasis: { style: { fill: STEPS_INK } },
  }
}

function makeStepsFrame(peak) {
  return (params) => {
    const cs = params.coordSys
    const children = [
      { type: 'line', shape: { x1: cs.x, y1: cs.y + cs.height + 0.5, x2: cs.x + cs.width, y2: cs.y + cs.height + 0.5 }, style: { stroke: P.axis, lineWidth: 1 } },
      {
        type: 'text',
        x: cs.x,
        y: cs.y - 6,
        style: {
          text: 'STEPS · PER 30 MIN',
          fill: P.text3,
          font: `600 9px ${FONT}`,
          align: 'left',
          verticalAlign: 'bottom',
        },
      },
    ]
    if (peak) {
      children.push({
        type: 'text',
        x: cs.x + cs.width,
        y: cs.y - 6,
        style: {
          text: `peak ${fmt.int(peak)}`,
          fill: STEPS_INK,
          font: `600 9px ${FONT}`,
          align: 'right',
          verticalAlign: 'bottom',
        },
      })
    }
    return { type: 'group', $mergeChildren: false, children }
  }
}

// ── Option ──

const option = computed(() => {
  const { start, end, live } = range.value
  const zones = bounds.value
  const y = yRange.value
  const L = layout.value
  const stepList = blocks.value
  const peak = stepList.reduce((m, b) => Math.max(m, b[2]), 0)
  const stepsMax = Math.max(1000, Math.ceil(peak / 1000) * 1000)
  const last = stats.value?.last
  const pulse = live && last && store.now - last[0] < 30 * MIN

  const xLabel = {
    ...axisLabel,
    fontSize: 10,
    margin: 8,
    hideOverlap: true,
    formatter: (v) => {
      const d = dayjs(v)
      return d.hour() === 0 && d.minute() === 0 ? `{d|${d.format('ddd D')}}` : d.format('HH:mm')
    },
    rich: { d: { color: P.text2, fontWeight: 600, fontSize: 10, fontFamily: FONT } },
  }
  const xBase = {
    type: 'time',
    min: start,
    max: end,
    splitNumber: Math.max(3, Math.round(size.value.w / 120)),
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: true, lineStyle: { color: P.grid } },
    // Follow the cursor exactly; the tooltip finds the nearest reading itself
    // (snapping would jump to step-block starts in the lower strip).
    axisPointer: { snap: false, label: { show: false } },
  }
  const frameDatum = [[start, end, y.min]]

  return base({
    animation: false,
    grid: [
      { left: L.left, right: L.right, top: L.top, bottom: L.hrBottom },
      { left: L.left, right: L.right, bottom: L.axisH, height: L.stepsH },
    ],
    xAxis: [
      { ...xBase, gridIndex: 0, axisLabel: { show: false } },
      { ...xBase, gridIndex: 1, axisLabel: xLabel },
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        min: y.min,
        max: y.max,
        interval: y.interval,
        axisLabel: { ...axisLabel, fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: P.grid } },
      },
      { type: 'value', gridIndex: 1, min: 0, max: stepsMax, show: false },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      extraCssText: 'box-shadow:none;border-radius:0;',
      transitionDuration: 0.1,
      axisPointer: { type: 'line', lineStyle: { color: alpha(P.text, 0.28), width: 1 } },
      formatter: tooltipHtml,
    },
    visualMap: {
      show: false,
      type: 'piecewise',
      seriesIndex: 0,
      dimension: 1,
      pieces: zones.map((z) => (z.hi === Infinity ? { gte: z.lo, color: tint(z) } : { gte: z.lo, lt: z.hi, color: tint(z) })),
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        filterMode: 'none',
        start: zoomState.start,
        end: zoomState.end,
        minValueSpan: 20 * MIN,
        zoomOnMouseWheel: pageScrolls.value ? 'ctrl' : true,
        moveOnMouseMove: !pageScrolls.value,
        moveOnMouseWheel: false,
      },
    ],
    series: [
      // Invisible: gives the hover snapping and the zone-coloured hover dot.
      {
        id: 'hover',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: inWindow.value,
        showSymbol: false,
        symbol: 'circle',
        symbolSize: 9,
        lineStyle: { opacity: 0 },
        itemStyle: { borderColor: P.panel, borderWidth: 2 },
        emphasis: { scale: false, lineStyle: { opacity: 0 } },
        z: 8,
      },
      {
        id: 'bands',
        type: 'custom',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: bands.value.map((b, i) => [b.from, b.to, y.min, i]),
        encode: { x: [0, 1], y: 2 },
        renderItem: makeBandRenderer(bands.value, L),
        silent: true,
        z: 1,
      },
      {
        id: 'zones',
        type: 'custom',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: frameDatum,
        encode: { x: [0, 1], y: 2 },
        renderItem: makeZoneRenderer(zones, y, quiet.value, L),
        silent: true,
        z: 2,
      },
      {
        id: 'trace',
        type: 'custom',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: frameDatum,
        encode: { x: [0, 1], y: 2 },
        renderItem: makeTraceRenderer(runs.value, zones, y),
        clip: true,
        silent: true,
        z: 3,
      },
      {
        id: 'pulse',
        type: 'effectScatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: pulse ? [last] : [],
        symbolSize: 7,
        rippleEffect: { brushType: 'stroke', scale: 3.4, period: 2.6 },
        itemStyle: pulse
          ? { color: tint(zoneOf(last[1], zones)), borderColor: P.panel, borderWidth: 1.5, shadowBlur: 3, shadowOffsetY: 1, shadowColor: 'rgba(15, 23, 42, 0.3)' }
          : {},
        silent: true,
        z: 7,
      },
      {
        id: 'steps',
        type: 'custom',
        xAxisIndex: 1,
        yAxisIndex: 1,
        // The block's midpoint leads the x dims so hover picks the block under the cursor.
        data: stepList.map(([s, e, n]) => [s, e, n, (s + e) / 2]),
        encode: { x: [3, 0, 1], y: 2 },
        renderItem: renderStepBlock,
        clip: true,
        z: 3,
      },
      {
        id: 'stepsFrame',
        type: 'custom',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: [[start, end, 0]],
        encode: { x: [0, 1], y: 2 },
        renderItem: makeStepsFrame(peak),
        silent: true,
        z: 1,
      },
    ],
  })
})
</script>

<style scoped>
.hr-detail {
  container-type: inline-size;
}

.when {
  font-size: 0.75rem;
  color: var(--hx-text2);
  white-space: nowrap;
}

.plot {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.pager {
  display: inline-flex;
  gap: 0.25rem;
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

.hx-btn.now {
  color: var(--hx-text);
  border-color: color-mix(in srgb, var(--hx-hr) 45%, transparent);
  background: color-mix(in srgb, var(--hx-hr) 12%, var(--hx-panel2));
}

.hx-btn.now svg {
  width: 0.75rem;
  height: 0.75rem;
}

@container (max-width: 64rem) {
  .opt-steps {
    display: none;
  }
}

@container (max-width: 54rem) {
  .opt-avg {
    display: none;
  }
}

/* Narrow: header wraps, the stats get their own row. */
@container (max-width: 46rem) {
  .hr-detail :deep(.hx-panel-head) {
    flex-wrap: wrap;
    row-gap: 0.5rem;
  }

  .hr-detail :deep(.hx-panel-meta) {
    order: 3;
    flex-basis: 100%;
  }

  .opt-avg,
  .opt-steps {
    display: flex;
  }
}
</style>
