<template>
  <HealthPanel class="trend-panel" :accent="P.hr" :loading="loading">
    <template #title>
      <span class="hx-dot" />
      <h2><span class="t-long">Heart-rate trend</span><span class="t-short">Trend</span></h2>
    </template>

    <template #meta>
      <template v-if="stats">
        <div class="hx-stat">
          <span class="hx-stat-label">Average</span>
          <span class="hx-stat-value">{{ Math.round(stats.avg) }}<small>bpm</small></span>
        </div>
        <template v-if="view === 'hourly'">
          <div
            v-if="stats.resting != null"
            class="hx-stat m-2"
            :title="store.resting.estimated ? 'Lowest 5% of each day\'s readings, averaged' : 'Average of the watch\'s daily resting values'"
          >
            <span class="hx-stat-label">Resting{{ store.resting.estimated ? ' · est.' : '' }}</span>
            <span class="hx-stat-value">{{ Math.round(stats.resting) }}<small>bpm</small></span>
          </div>
          <div class="hx-stat m-3" :title="`Highest reading, in the hour from ${dayjs(stats.peakAt).format('ddd D MMM, HH:00')}`">
            <span class="hx-stat-label">Peak</span>
            <span class="hx-stat-value">{{ Math.round(stats.peak) }}<small>bpm</small></span>
          </div>
        </template>
        <template v-else-if="heat">
          <div class="ramp m-2">
            <span>{{ heat.lo }}</span><i :style="{ background: RAMP_CSS }" /><span>{{ heat.hi }} bpm</span>
          </div>
          <span class="here-chip m-3"><i class="here-key" />In view</span>
        </template>
      </template>
    </template>

    <template #actions>
      <button v-if="view === 'hourly' && zoomed" class="hx-btn" title="Show the whole range" @click="resetZoom">
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <circle cx="7" cy="7" r="4.5" /><path d="M5 7h4M10.4 10.4 14 14" />
        </svg>
      </button>
      <HxSegmented v-model="view" :options="VIEWS" />
      <HxSegmented :model-value="store.trendDays" :options="RANGES" @update:model-value="store.setTrendDays" />
    </template>

    <!-- Hourly: mean line, min–max band, resting, nights, and the minute chart's window -->
    <template v-if="view === 'hourly' && hasTrend">
      <div class="legend">
        <span class="lg"><i class="sw" :style="{ height: '2px', background: `linear-gradient(90deg, ${LINE_GRAD.slice().reverse().join(', ')})` }" />Hourly avg</span>
        <span class="lg"><i class="sw" :style="{ background: `linear-gradient(${alpha(P.hr, 0.35)}, ${alpha(P.hr, 0.08)})` }" />Range</span>
        <span v-if="dense" class="lg"><i class="sw" :style="{ height: '2px', background: DAILY_COLOR }" />24 h avg</span>
        <span v-if="store.resting.days.length" class="lg opt"><i class="sw" :style="{ height: 0, borderTop: `2px dashed ${REST_COLOR}` }" />Resting</span>
        <span v-if="showNights" class="lg opt"><i class="sw" :style="{ background: `linear-gradient(${alpha(SLEEP.light, 0.08)}, ${alpha(SLEEP.light, 0.3)})` }" />Asleep</span>
      </div>
      <v-chart
        ref="chart"
        :class="['hx-chart', { pointer: inGrid }]"
        :option="option"
        :update-options="UPDATE"
        autoresize
        @zr:click="onZrClick"
        @zr:mousemove="onZrMove"
        @zr:globalout="inGrid = false"
        @datazoom="onDataZoom"
      />
    </template>

    <!-- Heatmap: one row per day (today on top), one column per hour -->
    <div
      v-else-if="view === 'heatmap' && hasTrend"
      ref="heatEl"
      :class="['heat', { clickable: !!hover?.cell }]"
      @mousemove="onHeatMove"
      @mouseleave="hover = null"
      @click="onHeatClick"
    >
      <svg v-if="layout" :width="size.w" :height="size.h" :viewBox="`0 0 ${size.w} ${size.h}`">
        <defs>
          <!-- hours without readings: a grey hatch, so "no data" never reads as a low value -->
          <pattern :id="hatchId" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" :fill="P.panel2" />
            <line x1="1" y1="0" x2="1" y2="4" :stroke="P.border2" stroke-width="1.25" />
          </pattern>
        </defs>

        <text
          v-for="t in hourTicks"
          :key="`h${t.hour}`"
          :x="t.x"
          :y="TOP - 6"
          text-anchor="middle"
          :class="['hl', { major: t.hour % 6 === 0, on: hover?.hour === t.hour }]"
        >{{ t.label }}</text>

        <g v-memo="[heatRects]">
          <rect
            v-for="c in heatRects"
            :key="c.k"
            :x="c.x"
            :y="c.y"
            :width="c.w"
            :height="c.h"
            :rx="layout.r"
            :fill="c.fill"
          />
        </g>

        <!-- crosshair on the hovered row / column -->
        <template v-if="hover && hover.row >= 0 && hover.hour >= 0">
          <rect :x="layout.xOf(hover.hour)" :y="TOP" :width="layout.cw" :height="layout.bottom - TOP" class="cross" />
          <rect :x="LEFT" :y="layout.yOf(hover.row)" :width="layout.right - LEFT" :height="layout.ch" class="cross" />
        </template>

        <!-- the minute chart's window: a white keyline under a rose bracket keeps
             it crisp over rose and crimson cells alike -->
        <g v-for="(s, i) in hereSegs" :key="`w${i}`">
          <rect :x="s.x" :y="s.y" :width="s.w" :height="s.h" :rx="Math.min(layout.r + 1.5, s.h / 2)" class="here-keyline" />
          <rect :x="s.x" :y="s.y" :width="s.w" :height="s.h" :rx="Math.min(layout.r + 1.5, s.h / 2)" class="here" />
        </g>

        <!-- hovered cell -->
        <rect
          v-if="hover?.cell"
          :x="layout.xOf(hover.hour) + layout.gx / 2 - 1"
          :y="layout.yOf(hover.row) + layout.gy / 2 - 1"
          :width="layout.cw - layout.gx + 2"
          :height="layout.ch - layout.gy + 2"
          :rx="layout.r + 1"
          class="cell-hover"
        />

        <text
          v-for="d in dayLabels"
          :key="`d${d.row}`"
          :x="LEFT - 8"
          :y="layout.yOf(d.row) + layout.ch / 2"
          text-anchor="end"
          dominant-baseline="central"
          :class="['dl', { today: d.row === 0 }]"
        >{{ d.label }}</text>

        <!-- hovered row's date, drawn over whatever label sits there -->
        <g v-if="hover && hover.row >= 0">
          <rect :x="2" :y="layout.yOf(hover.row) + layout.ch / 2 - 8" :width="LEFT - 6" height="16" rx="4" class="row-tag" />
          <text :x="LEFT - 8" :y="layout.yOf(hover.row) + layout.ch / 2" text-anchor="end" dominant-baseline="central" class="dl on">
            {{ dayLabel(heat.days[hover.row], hover.row) }}
          </text>
        </g>
      </svg>

      <div v-if="hover && hover.row >= 0 && hover.hour >= 0" class="tip" :style="tipStyle" v-html="heatTip" />
    </div>

    <div v-if="!hasTrend && !loading" class="hx-empty">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12h4l2-5 4 10 2-5h6" />
      </svg>
      No heart-rate history in this range yet.
    </div>
  </HealthPanel>
</template>

<script setup>
// Hourly heart rate over 7–90 days, as a line or a day × hour heatmap. Both
// show the minute chart's current window and open any hour in it on click,
// so the two charts work as one tool.
import { ref, computed, watch, onBeforeUnmount, useId } from 'vue'
import dayjs from 'dayjs'
import VChart from 'vue-echarts'
import { use, graphic } from 'echarts/core'
import { CustomChart } from 'echarts/charts'
import HealthPanel from './HealthPanel.vue'
import HxSegmented from './HxSegmented.vue'
import { P, SLEEP, FONT, alpha, axisLabel, axisLine, valueAxis, tooltip, base, tipRow, tipTitle, fmt } from '@/lib/health/theme'
import { useHealthStore, TREND_DAYS } from '@/stores/health'

use([CustomChart])

const HOUR = 3600e3
const DAY = 24 * HOUR

const VIEWS = [
  { label: 'Hourly', value: 'hourly' },
  { label: 'Heatmap', value: 'heatmap' },
]
const RANGES = TREND_DAYS.map((d) => ({ label: `${d}d`, value: d, title: `Last ${d} days` }))

// Merge rather than replace on every update, so a zoom survives the live
// window sliding forward each minute (series keep stable ids).
const UPDATE = { notMerge: false }

const store = useHealthStore()

// ── Colours ──

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a, b, t) {
  const A = rgb(a)
  const B = rgb(b)
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

// Resting in the palette's crimson; the 24 h average a much darker wine so
// the two stay apart when they run close on the 30/90-day views.
const REST_COLOR = P.resting
const DAILY_COLOR = mix(P.hr, P.text, 0.55)

// Heatmap ramp, all from the palette: pale lavender (sleep, low) → periwinkle
// → soft rose → the heart-rate rose → deep crimson. Lightness falls
// monotonically, so a busier hour always reads darker on the white panel.
// Hours without readings are a grey hatch (see the pattern), never a colour.
const RAMP = [
  [0, mix(SLEEP.light, P.panel, 0.74)],
  [0.28, mix(SLEEP.light, P.panel, 0.32)],
  [0.55, mix(P.hr, P.panel, 0.42)],
  [0.8, P.hr],
  [1, mix(P.hr, P.text, 0.4)],
]
const RAMP_CSS = `linear-gradient(90deg, ${RAMP.map(([o, c]) => `${c} ${o * 100}%`).join(', ')})`

function ramp(t) {
  const x = Math.min(1, Math.max(0, t))
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i][0]) {
      const [o0, c0] = RAMP[i - 1]
      const [o1, c1] = RAMP[i]
      return mix(c0, c1, (x - o0) / (o1 - o0))
    }
  }
  return RAMP.at(-1)[1]
}

// ── Shared state ──

const VIEW_KEY = 'health.trend.view'
const view = ref(readView())
function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'heatmap' ? 'heatmap' : 'hourly'
  } catch {
    return 'hourly'
  }
}
watch(view, (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // storage blocked — the choice just isn't remembered
  }
  zoomed.value = false
  hover.value = null
})

const loading = computed(() => store.trendLoading || (store.loading && !store.trend.length))
const hasTrend = computed(() => store.trend.length > 0)
const rangeStart = computed(() => dayjs(store.now).subtract(store.trendDays, 'day').startOf('day').valueOf())
const dense = computed(() => store.trendDays >= 30)
const showNights = computed(() => store.trendDays <= 7 && store.nights.length > 0)

const byHour = computed(() => new Map(store.trend.map((r) => [r[0], r])))
const restByDay = computed(() => new Map(store.resting.days.map((d) => [d.day, d.value])))
const sleepSpans = computed(() =>
  store.nights.flatMap((n) => n.sessions.map((s) => [new Date(s.start_time).getTime(), new Date(s.end_time).getTime()])),
)

const stats = computed(() => {
  const rows = store.trend
  if (!rows.length) return null
  let sum = 0
  let count = 0
  let peak = -Infinity
  let peakAt = null
  for (const [t, mean, , hi, n] of rows) {
    sum += mean * n
    count += n
    if (hi > peak) {
      peak = hi
      peakAt = t
    }
  }
  const startKey = dayjs(rangeStart.value).format('YYYY-MM-DD')
  const rest = store.resting.days.filter((d) => d.day >= startKey)
  return {
    avg: count ? sum / count : rows[0][1],
    peak,
    peakAt,
    resting: rest.length ? rest.reduce((a, d) => a + d.value, 0) / rest.length : null,
  }
})

function hourTitle(t) {
  const d = dayjs(t)
  return `${d.format('ddd D MMM')} · ${d.format('HH:00')}–${d.add(1, 'hour').format('HH:00')}`
}

const HINT = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${P.border};color:${P.text3};font-size:11px">`
  + 'Click to open this hour in the minute chart</div>'

// Tooltip body for one hourly bucket (both views).
function hourTip(t, row) {
  const asleep = sleepSpans.value.some(([a, b]) => t + HOUR / 2 >= a && t + HOUR / 2 < b)
  const title = tipTitle(`${hourTitle(t)}${asleep ? ' · asleep' : ''}`)
  if (!row) {
    return title + `<div style="color:${P.text2}">No readings — watch off or charging</div>`
  }
  const [, mean, lo, hi, n] = row
  const rest = restByDay.value.get(dayjs(t).format('YYYY-MM-DD'))
  return title
    + tipRow(P.hr, 'Average', fmt.bpm(mean))
    + tipRow(alpha(P.hr, 0.45), 'Range', `${Math.round(lo)}–${Math.round(hi)} bpm`)
    + (rest != null ? tipRow(REST_COLOR, store.resting.estimated ? 'Resting (est.)' : 'Resting', fmt.bpm(rest)) : '')
    + tipRow(P.text3, 'Readings', String(n))
    + HINT
}

// ── Hourly chart ──

const chart = ref(null)
const inGrid = ref(false)
const zoomed = ref(false)

// 24-hour centred average, weighted by readings; needs 6 h+ of data in the window.
function rolling(rows) {
  if (!rows.length) return []
  const t0 = rows[0][0]
  const N = Math.round((rows.at(-1)[0] - t0) / HOUR) + 1
  const S = new Float64Array(N + 1)
  const C = new Float64Array(N + 1)
  for (const [t, mean, , , n] of rows) {
    const i = Math.round((t - t0) / HOUR)
    S[i + 1] += mean * n
    C[i + 1] += n
  }
  for (let i = 1; i <= N; i++) {
    S[i] += S[i - 1]
    C[i] += C[i - 1]
  }
  return rows.map(([t]) => {
    const i = Math.round((t - t0) / HOUR)
    const a = Math.max(0, i - 12)
    const b = Math.min(N, i + 13)
    const c = C[b] - C[a]
    return [t, c >= 360 ? +((S[b] - S[a]) / c).toFixed(1) : null]
  })
}

// Daily resting value as a step that holds through its day.
function restingLine(t0, t1) {
  const out = []
  let prev = null
  for (const d of store.resting.days) {
    const day = dayjs(d.day).valueOf()
    if (day + DAY <= t0) continue
    if (prev != null && day - prev > 1.5 * DAY) out.push([prev + DAY, null])
    out.push([Math.max(day, t0), d.value])
    prev = day
  }
  if (out.length) out.push([Math.min(prev + DAY, t1), out.at(-1)[1]])
  return out
}

// Top-to-bottom gradient over the element's own box. Custom-series styles
// need a real LinearGradient; a plain {type:'linear'} object renders flat.
function vgrad(...colors) {
  return new graphic.LinearGradient(0, 0, 0, 1, colors.map((color, i) => ({ offset: i / (colors.length - 1), color })))
}

// The hourly line is coloured by value with the heatmap's hues: indigo
// troughs (sleep), rose through the day, deep crimson at the peaks.
const LINE_GRAD = [mix(P.hr, P.text, 0.35), P.hr, mix(P.hr, SLEEP.deep, 0.45), mix(SLEEP.light, SLEEP.deep, 0.35)]

// White halo under a line drawn over others: knocks out what's beneath
// instead of the coloured glow it had on the dark panel.
const HALO = { shadowBlur: 5, shadowColor: P.panel }

function renderNight(params, api) {
  const cs = params.coordSys
  const a = api.coord([api.value(0), api.value(2)])[0]
  const b = api.coord([api.value(1), api.value(2)])[0]
  const x0 = Math.max(a, cs.x)
  const x1 = Math.min(b, cs.x + cs.width)
  if (x1 <= x0) return null
  return {
    type: 'rect',
    shape: { x: x0, y: cs.y, width: x1 - x0, height: cs.height },
    style: { fill: vgrad(alpha(SLEEP.light, 0.03), alpha(SLEEP.light, 0.2)) },
  }
}

// The minute chart's window: a crisp rose bracket with a solid "IN VIEW" tab
// on top. Narrower than 4 px (90-day view) it still shows as a sliver.
function renderHere(params, api) {
  const cs = params.coordSys
  const a = api.coord([api.value(0), api.value(2)])[0]
  const b = api.coord([api.value(1), api.value(2)])[0]
  if (b < cs.x - 2 || a > cs.x + cs.width + 2) return null
  let x0 = Math.max(a, cs.x)
  let x1 = Math.min(b, cs.x + cs.width)
  if (x1 - x0 < 4) {
    const c = (x0 + x1) / 2
    x0 = c - 2
    x1 = c + 2
  }
  const top = cs.y
  const bottom = cs.y + cs.height
  const pw = 46
  const ph = 14
  const cx = Math.min(Math.max((x0 + x1) / 2, cs.x + pw / 2), cs.x + cs.width - pw / 2)
  const edge = { stroke: P.hr, lineWidth: 1.25 }
  return {
    type: 'group',
    children: [
      { type: 'rect', shape: { x: x0, y: top, width: x1 - x0, height: cs.height }, style: { fill: vgrad(alpha(P.hr, 0.11), alpha(P.hr, 0.02)) } },
      { type: 'line', shape: { x1: x0, y1: top, x2: x0, y2: bottom }, style: edge },
      { type: 'line', shape: { x1: x1, y1: top, x2: x1, y2: bottom }, style: edge },
      { type: 'line', shape: { x1: x0, y1: top, x2: x1, y2: top }, style: { ...edge, lineWidth: 1.75 } },
      {
        type: 'rect',
        shape: { x: cx - pw / 2, y: top - ph - 3, width: pw, height: ph, r: ph / 2 },
        style: { fill: P.hr, shadowBlur: 4, shadowOffsetY: 1, shadowColor: 'rgba(15, 23, 42, 0.2)' },
      },
      {
        type: 'text',
        style: {
          text: 'IN VIEW',
          x: cx,
          y: top - 3 - ph / 2,
          align: 'center',
          verticalAlign: 'middle',
          fill: P.panel,
          fontSize: 8.5,
          fontWeight: 700,
          fontFamily: FONT,
        },
      },
    ],
  }
}

function xLabel(v) {
  const d = dayjs(v)
  if (d.hour() || d.minute()) return d.format('HH:mm')
  if (store.trendDays > 7 && d.date() === 1) return `{m|${d.format('MMM')}}`
  return d.format(store.trendDays <= 7 ? 'ddd D' : 'D MMM')
}

const option = computed(() => {
  const rows = store.trend
  const t0 = rangeStart.value
  const t1 = store.now
  const level = store.trendDays >= 90 ? 2 : store.trendDays >= 30 ? 1 : 0

  // Break the line wherever an hour has no readings.
  const lo = []
  const span = []
  const mean = []
  let prev = null
  for (const [t, m, l, h] of rows) {
    if (prev != null && t - prev > 1.5 * HOUR) {
      lo.push([prev + HOUR, null])
      span.push([prev + HOUR, null])
      mean.push([prev + HOUR, null])
    }
    lo.push([t, l])
    span.push([t, h - l])
    mean.push([t, m])
    prev = t
  }

  // Custom series need a y value; any in-range number keeps the axis honest.
  const yMid = stats.value?.avg ?? 70
  const nights = showNights.value
    ? sleepSpans.value.filter(([a, b]) => b > t0 && a < t1).map(([a, b]) => [a, b, yMid])
    : []
  const { start, end } = store.detailRange
  const here = end > t0 && start < t1 ? [[start, end, yMid]] : []

  const bandAlpha = [[0.2, 0.04], [0.1, 0.02], [0.07, 0.015]][level]
  const meanStyle = [
    { width: 1.75, opacity: 1, ...HALO },
    { width: 1, opacity: 0.5, shadowBlur: 0 },
    { width: 0.8, opacity: 0.32, shadowBlur: 0 },
  ][level]

  return base({
    grid: { left: 34, right: 12, top: 26, bottom: 22 },
    tooltip: tooltip({ formatter: (params) => {
      const p = Array.isArray(params) ? params[0] : params
      if (!p) return ''
      const t = Math.floor(p.axisValue / HOUR) * HOUR
      if (t < rangeStart.value || t > store.now) return ''
      return hourTip(t, byHour.value.get(t))
    } }),
    dataZoom: [{
      type: 'inside',
      filterMode: 'none',
      zoomOnMouseWheel: true,
      moveOnMouseMove: true,
      moveOnMouseWheel: false,
      minValueSpan: 6 * HOUR,
    }],
    xAxis: {
      type: 'time',
      min: t0,
      max: t1,
      splitNumber: store.trendDays <= 7 ? 7 : 6,
      axisLabel: {
        ...axisLabel,
        hideOverlap: true,
        formatter: xLabel,
        rich: { m: { ...axisLabel, color: P.text2, fontWeight: 600 } },
      },
      axisLine,
      axisTick: { show: false },
      splitLine: { show: true, lineStyle: { color: P.grid } },
    },
    yAxis: valueAxis({ scale: true, splitNumber: 4 }),
    series: [
      { id: 'nights', type: 'custom', data: nights, renderItem: renderNight, encode: { x: [0, 1], y: 2 }, silent: true, z: 0, tooltip: { show: false } },
      { id: 'lo', type: 'line', data: lo, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, z: 1, emphasis: { disabled: true } },
      {
        id: 'span',
        type: 'line',
        data: span,
        stack: 'band',
        symbol: 'none',
        lineStyle: { opacity: 0 },
        areaStyle: { color: vgrad(alpha(P.hr, bandAlpha[0]), alpha(P.hr, bandAlpha[1])) },
        silent: true,
        z: 1,
        emphasis: { disabled: true },
      },
      { id: 'here', type: 'custom', data: here, renderItem: renderHere, encode: { x: [0, 1], y: 2 }, silent: true, z: 2, tooltip: { show: false } },
      {
        id: 'mean',
        type: 'line',
        data: mean,
        symbol: 'none',
        smooth: level ? 0.15 : 0.3,
        lineStyle: { color: vgrad(...LINE_GRAD), ...meanStyle },
        z: 3,
        emphasis: { disabled: true },
      },
      {
        id: 'daily',
        type: 'line',
        data: level ? rolling(rows) : [],
        symbol: 'none',
        smooth: 0.5,
        lineStyle: { color: DAILY_COLOR, width: 2, ...HALO },
        z: 4,
        emphasis: { disabled: true },
      },
      {
        id: 'resting',
        type: 'line',
        data: restingLine(t0, t1),
        step: 'end',
        symbol: 'none',
        lineStyle: { color: REST_COLOR, width: 1.3, type: [5, 4] },
        z: 4,
        emphasis: { disabled: true },
      },
    ],
  })
})

function onZrMove(e) {
  inGrid.value = !!chart.value?.containPixel('grid', [e.offsetX, e.offsetY])
}

function onZrClick(e) {
  const c = chart.value
  if (!c || !c.containPixel('grid', [e.offsetX, e.offsetY])) return
  const [x] = c.convertFromPixel('grid', [e.offsetX, e.offsetY])
  const h = dayjs(x).startOf('hour').valueOf()
  store.focusRange(h, h + HOUR)
}

function onDataZoom(e) {
  const p = e.batch?.[0] ?? e
  zoomed.value = (p.start ?? 0) > 0.01 || (p.end ?? 100) < 99.99
}

function resetZoom() {
  chart.value?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
  zoomed.value = false
}

watch(() => store.trendDays, resetZoom)

// ── Heatmap (hand-drawn SVG) ──

const LEFT = 54
const TOP = 18
const hatchId = `trend-hatch-${useId()}`
const heatEl = ref(null)
const size = ref({ w: 0, h: 0 })
const hover = ref(null)   // { x, y, row, hour, cell }

let ro = null
watch(heatEl, (el) => {
  ro?.disconnect()
  ro = null
  if (!el) return
  ro = new ResizeObserver(([entry]) => {
    size.value = { w: entry.contentRect.width, h: entry.contentRect.height }
  })
  ro.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())

const heat = computed(() => {
  if (view.value !== 'heatmap' || !store.trend.length) return null
  const first = dayjs(rangeStart.value)
  const days = []
  for (let d = dayjs(store.now).startOf('day'); !d.isBefore(first); d = d.subtract(1, 'day')) days.push(d)
  const rowOf = new Map(days.map((d, i) => [d.format('YYYY-MM-DD'), i]))
  const cells = new Map()
  const means = []
  for (const r of store.trend) {
    const d = dayjs(r[0])
    const row = rowOf.get(d.format('YYYY-MM-DD'))
    if (row == null) continue
    cells.set(row * 24 + d.hour(), r)
    means.push(r[1])
  }
  means.sort((a, b) => a - b)
  const q = (p) => means[Math.round(p * (means.length - 1))]
  const lo = Math.floor(q(0.02) / 5) * 5
  const hi = Math.max(lo + 10, Math.ceil(q(0.98) / 5) * 5)
  return { days, cells, lo, hi }
})

// Cell geometry: columns grouped in 6-hour blocks, rows grouped by week.
const layout = computed(() => {
  const h = heat.value
  const { w, h: H } = size.value
  if (!h || w < 120 || H < 60) return null
  const rows = h.days.length
  const right = w - 2
  const bottom = H - 2
  const gw = right - LEFT
  const blockGap = gw > 400 ? 5 : 3
  const cw = (gw - 3 * blockGap) / 24
  const weekly = rows > 10
  const weeksAbove = []
  let mondays = 0
  for (let i = 0; i < rows; i++) {
    weeksAbove.push(mondays)
    if (weekly && h.days[i].day() === 1 && i < rows - 1) mondays++
  }
  const gh = bottom - TOP
  const weekGap = weekly ? (gh / rows > 5 ? 4 : 3) : 0
  const ch = (gh - mondays * weekGap) / rows
  const gx = cw >= 20 ? 3 : cw >= 10 ? 2 : 1
  const gy = ch >= 20 ? 3 : ch >= 8 ? 2 : ch >= 4 ? 1 : 0
  const r = Math.min(5, Math.max(0, Math.min(cw - gx, ch - gy) * 0.28))
  return {
    cw,
    ch,
    gx,
    gy,
    r,
    right,
    bottom,
    xOf: (hour) => LEFT + hour * cw + Math.floor(hour / 6) * blockGap,
    yOf: (row) => TOP + row * ch + weeksAbove[row] * weekGap,
  }
})

const heatRects = computed(() => {
  const L = layout.value
  const h = heat.value
  if (!L) return []
  const out = []
  h.days.forEach((d, row) => {
    for (let hour = 0; hour < 24; hour++) {
      if (d.hour(hour).valueOf() > store.now) break   // the rest of today hasn't happened
      const c = h.cells.get(row * 24 + hour)
      out.push({
        k: row * 24 + hour,
        x: L.xOf(hour) + L.gx / 2,
        y: L.yOf(row) + L.gy / 2,
        w: Math.max(0.5, L.cw - L.gx),
        h: Math.max(0.5, L.ch - L.gy),
        fill: c ? ramp((c[1] - h.lo) / (h.hi - h.lo)) : `url(#${hatchId})`,
      })
    }
  })
  return out
})

const hourTicks = computed(() => {
  const L = layout.value
  if (!L) return []
  const step = L.cw * 3 >= 26 ? 3 : 6
  const out = []
  for (let hour = 0; hour < 24; hour += step) {
    out.push({ hour, x: L.xOf(hour) + L.cw / 2, label: String(hour).padStart(2, '0') })
  }
  return out
})

function dayLabel(d, row) {
  if (row === 0) return 'Today'
  return d.format(heat.value.days.length <= 10 ? 'ddd D' : 'D MMM')
}

// Every day when there's room; otherwise today and each Monday, never closer than 13 px.
const dayLabels = computed(() => {
  const L = layout.value
  const h = heat.value
  if (!L) return []
  const all = h.days.length <= 10 || L.ch >= 13
  const out = []
  let lastY = -Infinity
  h.days.forEach((d, row) => {
    if (!all && row !== 0 && d.day() !== 1) return
    const y = L.yOf(row) + L.ch / 2
    if (y - lastY < 13) return
    out.push({ row, label: dayLabel(d, row) })
    lastY = y
  })
  return out
})

// Fractional hour → x, honouring the block gaps.
function xAt(L, hf) {
  const i = Math.min(23, Math.max(0, Math.floor(hf)))
  return L.xOf(i) + (hf - i) * L.cw
}

const hereSegs = computed(() => {
  const L = layout.value
  const h = heat.value
  if (!L) return []
  const { start, end } = store.detailRange
  const out = []
  h.days.forEach((d, row) => {
    const ds = d.valueOf()
    const de = d.add(1, 'day').valueOf()
    const a = Math.max(start, ds)
    const b = Math.min(end, de, store.now)
    if (b <= a) return
    const x0 = xAt(L, (a - ds) / HOUR)
    const x1 = xAt(L, (b - ds) / HOUR)
    out.push({ x: x0 - 1.5, y: L.yOf(row) + L.gy / 2 - 1.5, w: Math.max(3, x1 - x0) + 3, h: Math.max(3, L.ch - L.gy) + 3 })
  })
  return out
})

// Nearest row / column under the pointer (gaps count toward the cell before them).
function locate(e) {
  const L = layout.value
  const h = heat.value
  if (!L || !heatEl.value) return null
  const box = heatEl.value.getBoundingClientRect()
  const x = e.clientX - box.left
  const y = e.clientY - box.top
  let hour = -1
  if (x >= LEFT && x <= L.right) {
    hour = 23
    for (let i = 0; i < 23; i++) if (x < L.xOf(i + 1)) { hour = i; break }
  }
  let row = -1
  if (y >= TOP && y <= L.bottom) {
    row = h.days.length - 1
    for (let i = 0; i < h.days.length - 1; i++) if (y < L.yOf(i + 1)) { row = i; break }
  }
  // Hours of today that haven't happened yet aren't cells.
  if (row >= 0 && hour >= 0 && h.days[row].hour(hour).valueOf() > store.now) hour = -1
  return { x, y, row, hour }
}

function onHeatMove(e) {
  const p = locate(e)
  if (!p) return (hover.value = null)
  const cell = p.row >= 0 && p.hour >= 0 ? heat.value.cells.get(p.row * 24 + p.hour) || null : null
  hover.value = { ...p, cell }
}

function onHeatClick() {
  const c = hover.value?.cell
  if (c) store.focusRange(c[0], c[0] + HOUR)
}

const heatTip = computed(() => {
  const p = hover.value
  if (!p || p.row < 0 || p.hour < 0) return ''
  const t = heat.value.days[p.row].hour(p.hour).valueOf()
  return hourTip(t, p.cell)
})

const tipStyle = computed(() => {
  const p = hover.value
  const W = 250
  const H = p?.cell ? 140 : 56
  const left = p.x + 16 + W > size.value.w ? p.x - 16 - W : p.x + 16
  const top = p.y + 16 + H > size.value.h ? Math.max(0, p.y - 16 - H) : p.y + 16
  return { left: `${Math.max(0, left)}px`, top: `${top}px` }
})
</script>

<style scoped>
.trend-panel {
  container-type: inline-size;
}

.t-short {
  display: none;
}

/* ── Hourly ── */

.legend {
  position: absolute;
  top: 0;
  left: 2.125rem;
  right: 0.75rem;
  z-index: 1;
  display: flex;
  gap: 0.875rem;
  height: 1rem;
  font-size: 0.6875rem;
  color: var(--hx-text3);
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
}

.lg {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.sw {
  display: inline-block;
  width: 0.875rem;
  height: 0.5rem;
  border-radius: 2px;
}

.hx-chart.pointer :deep(canvas) {
  cursor: pointer !important;
}

/* ── Header extras ── */

.ramp {
  display: inline-flex;
  align-items: center;
  gap: 0.4375rem;
  font-size: 0.6875rem;
  color: var(--hx-text2);
  white-space: nowrap;
}

.ramp i {
  width: 5rem;
  height: 0.375rem;
  border-radius: 999px;
  box-shadow: 0 0 0 1px var(--hx-border);
}

.here-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  color: var(--hx-text2);
  white-space: nowrap;
}

.here-key {
  display: inline-block;
  width: 0.875rem;
  height: 0.5rem;
  border-radius: 2px;
  border: 1.5px solid var(--hx-hr);
  background: color-mix(in srgb, var(--hx-hr) 10%, transparent);
}

/* ── Heatmap ── */

.heat {
  position: relative;
  flex: 1;
  min-height: 0;
}

.heat svg {
  position: absolute;
  inset: 0;
  display: block;
  overflow: visible;
}

.heat.clickable svg {
  cursor: pointer;
}

.hl {
  font-size: 0.625rem;
  fill: var(--hx-text3);
}

.hl.major {
  fill: var(--hx-text2);
}

.hl.on {
  fill: var(--hx-text);
  font-weight: 600;
}

.dl {
  font-size: 0.6875rem;
  fill: var(--hx-text3);
}

.dl.today {
  fill: var(--hx-text);
  font-weight: 600;
}

.dl.on {
  fill: var(--hx-text);
  font-weight: 600;
}

.row-tag {
  fill: var(--hx-panel);
}

.cross {
  fill: rgba(15, 23, 42, 0.05);
  pointer-events: none;
}

.here-keyline {
  fill: none;
  stroke: var(--hx-panel);
  stroke-width: 4;
  pointer-events: none;
}

.here {
  fill: color-mix(in srgb, var(--hx-hr) 8%, transparent);
  stroke: var(--hx-hr);
  stroke-width: 1.75;
  pointer-events: none;
}

.cell-hover {
  fill: none;
  stroke: var(--hx-text);
  stroke-width: 1.5;
  pointer-events: none;
}

.tip {
  position: absolute;
  z-index: 5;
  width: max-content;
  max-width: 16rem;
  padding: 0.5rem 0.6875rem;
  font-size: 0.75rem;
  color: var(--hx-text);
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid var(--hx-border2);
  border-radius: 0.5rem;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  pointer-events: none;
}

/* ── Narrow panels: shed header extras, then shorten the title ── */

@container (max-width: 46rem) {
  .m-3 {
    display: none;
  }
}

@container (max-width: 38rem) {
  .m-2,
  .lg.opt {
    display: none;
  }
}

@container (max-width: 31rem) {
  .trend-panel :deep(.hx-panel-meta) {
    display: none;
  }
}

@container (max-width: 26rem) {
  .t-long {
    display: none;
  }

  .t-short {
    display: inline;
  }
}
</style>
