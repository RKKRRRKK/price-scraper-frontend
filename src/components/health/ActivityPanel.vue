<template>
  <HealthPanel title="Activity" :accent="P.steps" :loading="store.loading && store.ready">
    <template #meta>
      <template v-if="view === 'daily'">
        <div v-if="avg7" class="hx-stat">
          <span class="hx-stat-label">{{ avg7.days }}-day avg</span>
          <span class="hx-stat-value">{{ fmt.int(avg7.value) }}</span>
        </div>
        <div v-if="best" class="hx-stat">
          <span class="hx-stat-label">Best · 30 d</span>
          <span class="hx-stat-value">{{ kfmt(best.steps) }}<small>{{ dayjs(best.key).format('D MMM') }}</small></span>
        </div>
      </template>
      <template v-else>
        <div class="hx-stat">
          <span class="hx-stat-label">So far</span>
          <span class="hx-stat-value">{{ fmt.int(pace.today) }}</span>
        </div>
        <div v-if="pace.diff != null" class="hx-stat">
          <span class="hx-stat-label">Vs usual</span>
          <span class="hx-stat-value" :style="{ color: pace.diff >= 0 ? STEPS_INK : P.warn }">
            {{ pace.diff >= 0 ? '▲' : '▼' }} {{ fmt.int(Math.abs(pace.diff)) }}
          </span>
        </div>
      </template>
    </template>

    <template #actions>
      <HxSegmented v-model="view" :options="VIEWS" />
    </template>

    <v-chart
      v-if="hasSteps"
      :key="view"
      class="hx-chart"
      :option="view === 'daily' ? dailyOption : todayOption"
      autoresize
      @datazoom="onZoom"
      @click="onClick"
    />
    <div v-else-if="store.ready" class="hx-empty">
      <svg class="empty-ico" viewBox="0 0 24 24"><path :d="FOOT" /></svg>
      No step data yet.
    </div>
  </HealthPanel>
</template>

<script setup>
// Steps: a day-by-day view (goal progress, 7-day average) and a "today vs
// usual" pace view built from hourly totals of the last four weeks.
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CustomChart, EffectScatterChart } from 'echarts/charts'
import { MarkLineComponent, MarkPointComponent } from 'echarts/components'
import HealthPanel from './HealthPanel.vue'
import HxSegmented from './HxSegmented.vue'
import { P, FONT, alpha, base, tooltip, timeAxis, valueAxis, axisLabel, axisLine, tipRow, tipTitle, fmt } from '@/lib/health/theme'
import { useHealthStore } from '@/stores/health'

use([CustomChart, EffectScatterChart, MarkLineComponent, MarkPointComponent])

const store = useHealthStore()
const HOUR = 3600e3

const VIEWS = [
  { label: 'Daily', value: 'daily' },
  { label: 'Today', value: 'today', title: "Today's steps against your usual day" },
]
const view = ref('daily')

// Two footprints, for the empty state.
const FOOT =
  'M8 3.5c1.7 0 2.6 2 2.4 4.6-.2 2.2-1 3.9-2.6 3.9S5.6 10.3 5.6 8c0-2.6.7-4.5 2.4-4.5zM6 13.6l4.2.6-.4 2.6c-.3 1.4-1.3 2-2.4 1.8-1.2-.2-1.8-1.2-1.6-2.5zM16 6.5c1.7 0 2.4 1.9 2.4 4.5 0 2.3-.9 4-2.2 4s-2.4-1.7-2.6-3.9c-.2-2.6.7-4.6 2.4-4.6zM14 17.2l4.2-.6.2 2.5c.2 1.3-.4 2.3-1.6 2.5-1.1.2-2.1-.4-2.4-1.8z'

const hasSteps = computed(() => !!store.sources.steps)

const kfmt = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)

// ECharts' own "nice" rounding for tick intervals (1, 2, 3, 5, 10 × 10ⁿ).
function niceNum(v) {
  const e = Math.floor(Math.log10(v))
  const f = v / 10 ** e
  return (f < 1.5 ? 1 : f < 2.5 ? 2 : f < 4 ? 3 : f < 7 ? 5 : 10) * 10 ** e
}

// Axis maximum ≥ m that lands exactly on a tick ECharts will draw for `split`
// intervals, so the top label is never an odd 24k above a 20k gridline.
function axisTop(m, split = 3) {
  let top = Math.max(m, 1)
  for (let k = 0; k < 4; k++) {
    const next = Math.ceil(m / niceNum(top / split)) * niceNum(top / split)
    if (next === top) break
    top = next
  }
  return top
}

function quantile(sorted, q) {
  if (!sorted.length) return null
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo)
}

const vgrad = (top, bottom) => ({
  type: 'linear',
  x: 0, y: 0, x2: 0, y2: 1,
  colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }],
})

// Emerald darkened towards the text colour: bar caps and small green type,
// which plain emerald-500 is too light for on white.
const STEPS_INK = (() => {
  const a = parseInt(P.steps.slice(1), 16)
  const b = parseInt(P.text.slice(1), 16)
  return '#' + [16, 8, 0]
    .map((s) => Math.round(((a >> s) & 255) * 0.68 + ((b >> s) & 255) * 0.32).toString(16).padStart(2, '0'))
    .join('')
})()

// White halo under a line that crosses the bars, instead of a glow.
const HALO = { shadowBlur: 4, shadowColor: P.panel }

// Diagonal hatch for today's still-filling bar.
let hatch = null
function hatchFill() {
  if (!hatch) {
    const c = document.createElement('canvas')
    c.width = c.height = 6
    const g = c.getContext('2d')
    g.fillStyle = alpha(P.steps, 0.18)
    g.fillRect(0, 0, 6, 6)
    g.strokeStyle = alpha(P.steps, 0.75)
    g.lineWidth = 1.4
    for (const [x1, y1, x2, y2] of [[-1, 7, 7, -1], [-1, 1, 1, -1], [5, 7, 7, 5]]) {
      g.beginPath()
      g.moveTo(x1, y1)
      g.lineTo(x2, y2)
      g.stroke()
    }
    hatch = { image: c, repeat: 'repeat' }
  }
  return hatch
}

// ── Daily ──

// Local days from the first synced day (at least the last two weeks) to today.
const days = computed(() => {
  const byDay = (m) => new Map((store.daily[m] || []).map((d) => [d.day, d.total]))
  const steps = byDay('steps')
  const kcal = byDay('active_kcal')
  const dist = byDay('distance_m')
  const today = dayjs(store.todayKey)
  let d = dayjs([...steps.keys()].sort()[0] ?? store.todayKey)
  if (d.isAfter(today.subtract(13, 'day'))) d = today.subtract(13, 'day')

  const out = []
  for (; !d.isAfter(today, 'day'); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD')
    out.push({
      key,
      steps: steps.get(key) ?? null,
      kcal: kcal.get(key) ?? null,
      dist: dist.get(key) ?? null,
      today: key === store.todayKey,
    })
  }
  // Trailing 7-day average of complete days (today is still filling up).
  out.forEach((day, i) => {
    const win = out.slice(Math.max(0, i - 6), i + 1).filter((x) => x.steps != null && !x.today)
    day.avg = !day.today && win.length >= 3 ? win.reduce((a, x) => a + x.steps, 0) / win.length : null
  })
  return out
})

const dayIndex = computed(() => new Map(days.value.map((d, i) => [d.key, i])))

// Average of the last (up to) seven complete days — labelled with how many it has.
const avg7 = computed(() => {
  const w = days.value.filter((d) => !d.today && d.steps != null).slice(-7)
  return w.length ? { days: w.length, value: w.reduce((a, d) => a + d.steps, 0) / w.length } : null
})

const best = computed(() => {
  const w = days.value.slice(-30).filter((d) => d.steps != null)
  return w.length ? w.reduce((a, b) => (b.steps > a.steps ? b : a)) : null
})

// Keep the user's zoom across data refreshes (plain variable: not a dependency).
let zoom = null
function onZoom(e) {
  const b = e.batch?.[0] ?? e
  if (b.start != null) zoom = { start: b.start, end: b.end }
}

// Each day: a faint track up to the goal, the bar over it (solid emerald once
// the goal is met, a lighter wash below it, hatched while today is still
// running), and a crisp darker cap.
function renderDay(params, api) {
  const d = days.value[api.value(0)]
  if (!d) return
  const goal = store.settings.stepGoal
  const band = api.size([1, 0])[0]
  const w = Math.max(2, Math.min(band * 0.62, 18))
  const [cx, y0] = api.coord([api.value(0), 0])
  const yGoal = api.coord([api.value(0), goal])[1]
  const x = cx - w / 2
  const r = Math.min(w / 2, 4)
  const plot = params.coordSys
  const children = [
    // Invisible full-height hit area: the whole day column is clickable, like its tooltip.
    {
      type: 'rect',
      shape: { x: cx - band / 2, y: plot.y, width: band, height: plot.height },
      style: { fill: 'rgba(0, 0, 0, 0)' },
    },
    {
      type: 'rect',
      shape: { x, y: yGoal, width: w, height: Math.max(y0 - yGoal, 0), r: [r, r, 0, 0] },
      style: { fill: alpha(P.text, 0.035) },
    },
  ]
  if (d.steps != null) {
    const met = d.steps >= goal
    const h = Math.max(y0 - api.coord([api.value(0), d.steps])[1], 1.5)
    children.push(
      {
        type: 'rect',
        shape: { x, y: y0 - h, width: w, height: h, r: [r, r, 0, 0] },
        style: d.today
          ? { fill: hatchFill(), stroke: alpha(P.steps, 0.9), lineWidth: 1 }
          : met
            ? { fill: vgrad(P.steps, alpha(P.steps, 0.62)) }
            : { fill: vgrad(alpha(P.steps, 0.4), alpha(P.steps, 0.1)) },
      },
      {
        type: 'rect',
        silent: true,
        shape: { x, y: y0 - h, width: w, height: Math.min(2, h), r: [r, r, 0, 0] },
        style: { fill: met ? STEPS_INK : alpha(P.steps, 0.85) },
      },
    )
  }
  // Children vary per day (no bar on unworn days); without $mergeChildren: false
  // ECharts reuses old children by index and can leave stale bars behind.
  return { type: 'group', $mergeChildren: false, children }
}

function dailyTip(params) {
  const d = days.value[dayIndex.value.get(params[0].axisValue)]
  if (!d) return ''
  let html = tipTitle(dayjs(d.key).format('dddd D MMM') + (d.today ? ' · so far' : ''))
  if (d.steps == null) return html + `<div style="color:${P.text3}">No data</div>`
  const pct = Math.round((d.steps / store.settings.stepGoal) * 100)
  html += tipRow(P.steps, 'Steps', `${fmt.int(d.steps)} <span style="color:${P.text3};font-weight:400">· ${pct}% of goal</span>`)
  if (d.kcal != null) html += tipRow(P.kcal, 'Active', `${fmt.int(d.kcal)} kcal`)
  if (d.dist != null) html += tipRow(P.distance, 'Distance', fmt.km(d.dist))
  if (d.avg != null) html += tipRow(alpha(P.text, 0.7), '7-day avg', fmt.int(d.avg))
  return html + `<div style="color:${P.text3};font-size:11px;margin-top:5px">Click to open the day in the heart-rate chart</div>`
}

const dailyOption = computed(() => {
  const list = days.value
  const goal = store.settings.stepGoal
  const n = list.length
  return base({
    grid: { top: 12, right: 38, bottom: 22, left: 34 },
    tooltip: tooltip({
      axisPointer: { type: 'shadow', shadowStyle: { color: alpha(P.text, 0.045) } },
      formatter: dailyTip,
    }),
    dataZoom: [{
      type: 'inside',
      start: zoom?.start ?? Math.max(0, ((n - 30) / n) * 100),
      end: zoom?.end ?? 100,
      minValueSpan: 7,
    }],
    xAxis: {
      type: 'category',
      data: list.map((d) => d.key),
      axisLabel: { ...axisLabel, hideOverlap: true, formatter: (k) => dayjs(k).format('D MMM') },
      axisLine,
      axisTick: { show: false },
    },
    yAxis: valueAxis({
      splitNumber: 4,
      max: (v) => axisTop(Math.max(v.max, goal * 1.06), 4),
      axisLabel: { ...axisLabel, formatter: kfmt },
    }),
    series: [
      {
        name: 'Steps',
        type: 'custom',
        renderItem: renderDay,
        encode: { x: 0, y: 1 },
        data: list.map((d, i) => [i, d.steps ?? 0]),
        z: 2,
      },
      {
        name: '7-day avg',
        type: 'line',
        data: list.map((d) => d.avg),
        smooth: 0.35,
        symbol: 'none',
        z: 3,
        lineStyle: { width: 1.5, color: alpha(P.text, 0.75), ...HALO },
        markLine: goalLine(goal),
      },
    ],
  })
})

function goalLine(goal) {
  return {
    silent: true,
    symbol: 'none',
    animation: false,
    lineStyle: { color: alpha(P.steps, 0.7), type: [4, 4], width: 1 },
    label: {
      position: 'end',
      distance: 4,
      formatter: 'goal',
      color: STEPS_INK,
      fontSize: 10,
      fontWeight: 600,
      fontFamily: FONT,
      padding: [2, 5],
      borderRadius: 999,
      backgroundColor: alpha(P.steps, 0.12),
      borderColor: alpha(P.steps, 0.35),
      borderWidth: 1,
    },
    data: [{ yAxis: goal }],
  }
}

function onClick(params) {
  if (view.value !== 'daily' || params.seriesType !== 'custom') return
  const d = days.value[params.value?.[0]]
  if (!d) return
  const start = dayjs(d.key).startOf('day')
  store.focusRange(start.valueOf(), start.add(1, 'day').valueOf())
}

// ── Today vs usual ──

const pace = computed(() => {
  const dayStart = dayjs(store.now).startOf('day')
  const t = (h) => dayStart.add(h, 'hour').valueOf()
  const todayKey = store.todayKey

  // Steps per local hour, per day.
  const byDay = new Map()
  for (const [ms, total] of store.stepsHourly) {
    const d = dayjs(ms)
    const key = d.format('YYYY-MM-DD')
    let arr = byDay.get(key)
    if (!arr) byDay.set(key, (arr = new Array(24).fill(0)))
    arr[d.hour()] += total
  }
  const cumulative = (arr) => {
    let s = 0
    return arr.map((v) => (s += v))
  }

  const todayArr = byDay.get(todayKey) ?? new Array(24).fill(0)
  const todayCum = cumulative(todayArr)
  const nowHour = dayjs(store.now).hour()
  const sofar = todayCum[nowHour]

  const todayPts = [[t(0), 0]]
  for (let h = 0; h < nowHour; h++) todayPts.push([t(h + 1), todayCum[h]])
  todayPts.push([store.now, sofar])

  // The usual day: earlier days the watch was actually worn.
  const past = [...byDay]
    .filter(([k, arr]) => k < todayKey && arr.reduce((a, b) => a + b, 0) >= 1000)
    .map(([, arr]) => cumulative(arr))

  let usual = null
  let lo = null
  let hi = null
  let usualAt = null
  if (past.length >= 3) {
    usual = []
    lo = []
    hi = []
    for (let h = 0; h < 24; h++) {
      const col = past.map((c) => c[h]).sort((a, b) => a - b)
      usual.push(col.reduce((a, b) => a + b, 0) / col.length)
      lo.push(quantile(col, 0.25))
      hi.push(quantile(col, 0.75))
    }
    const prev = nowHour ? usual[nowHour - 1] : 0
    usualAt = prev + (usual[nowHour] - prev) * ((store.now - t(nowHour)) / (t(nowHour + 1) - t(nowHour)))
  }

  return {
    t,
    todayCum,
    todayArr,
    nowHour,
    todayPts,
    today: sofar,
    usual,
    lo,
    hi,
    usualAt,
    diff: usualAt != null ? sofar - usualAt : null,
    days: past.length,
  }
})

function todayTip(params) {
  const p = pace.value
  const ms = params[0].axisValue
  const k = Math.max(0, Math.min(24, Math.round((ms - p.t(0)) / HOUR)))
  const isNow = Math.abs(ms - store.now) < 60e3
  const at = isNow ? store.now : p.t(k)
  let html = tipTitle(`${dayjs(at).format('HH:mm')}${isNow ? ' · now' : ''} · total so far`)
  if (isNow) html += tipRow(P.steps, 'Today', fmt.int(p.today))
  else if (k <= p.nowHour) html += tipRow(P.steps, 'Today', fmt.int(k ? p.todayCum[k - 1] : 0))
  if (p.usual) {
    const u = isNow ? p.usualAt : k ? p.usual[k - 1] : 0
    html += tipRow(alpha(P.text, 0.6), 'Usual', fmt.int(u))
    if (k > 0) html += tipRow(alpha(P.text, 0.25), 'Typical', `${fmt.int(p.lo[k - 1])}–${fmt.int(p.hi[k - 1])}`)
  }
  if (k > 0 && k - 1 <= p.nowHour && !isNow) {
    html += `<div style="color:${P.text3};font-size:11px;margin-top:5px">${fmt.int(p.todayArr[k - 1])} steps in ${dayjs(p.t(k - 1)).format('HH:mm')}–${dayjs(p.t(k)).format('HH:mm')}</div>`
  }
  return html
}

const todayOption = computed(() => {
  const p = pace.value
  const goal = store.settings.stepGoal
  const curve = (arr) => [[p.t(0), 0], ...arr.map((v, h) => [p.t(h + 1), v])]
  const series = []

  if (p.usual) {
    const top = curve(p.hi)
    const bottom = curve(p.lo).reverse()
    series.push(
      {
        // Typical range (middle half of past days), drawn as one polygon.
        type: 'custom',
        silent: true,
        tooltip: { show: false },
        z: 1,
        data: [[p.t(0), 0]],
        renderItem: (params, api) => ({
          type: 'polygon',
          shape: { points: [...top, ...bottom].map(([ts, v]) => api.coord([ts, v])) },
          style: { fill: vgrad(alpha(P.text, 0.08), alpha(P.text, 0.025)) },
        }),
      },
      {
        name: 'Usual',
        type: 'line',
        data: curve(p.usual),
        symbol: 'none',
        z: 2,
        lineStyle: { width: 1.25, type: [4, 4], color: alpha(P.text, 0.55) },
        markPoint: {
          silent: true,
          symbol: 'circle',
          symbolSize: 5,
          itemStyle: { color: P.panel, borderColor: alpha(P.text, 0.6), borderWidth: 1.2 },
          label: {
            show: true,
            position: 'top',
            align: 'right',
            distance: 6,
            offset: [4, 0],
            formatter: `usual ${kfmt(p.usual[23])}`,
            color: P.text3,
            fontSize: 10,
            fontFamily: FONT,
          },
          data: [{ coord: [p.t(24), p.usual[23]] }],
        },
      },
    )
  }

  series.push({
    name: 'Today',
    type: 'line',
    data: p.todayPts,
    symbol: 'none',
    smooth: 0.15,
    z: 4,
    lineStyle: { width: 2.25, color: P.steps, ...HALO },
    areaStyle: { color: vgrad(alpha(P.steps, 0.26), alpha(P.steps, 0.02)) },
    markLine: {
      silent: true,
      symbol: 'none',
      animation: false,
      data: [
        { ...goalLine(goal).data[0], lineStyle: goalLine(goal).lineStyle, label: goalLine(goal).label },
        {
          xAxis: store.now,
          lineStyle: { color: alpha(P.steps, 0.5), type: [2, 3], width: 1 },
          label: { formatter: 'now', position: 'end', color: STEPS_INK, fontSize: 10, fontWeight: 600, fontFamily: FONT },
        },
      ],
    },
  })

  // Ahead / behind bracket from the usual curve to today at "now".
  if (p.usualAt != null) {
    const color = p.diff >= 0 ? P.steps : P.warn
    series.push({
      type: 'custom',
      silent: true,
      tooltip: { show: false },
      z: 5,
      data: [[store.now, p.today]],
      renderItem: (params, api) => {
        const a = api.coord([store.now, p.usualAt])
        const b = api.coord([store.now, p.today])
        return {
          type: 'group',
          children: [
            { type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: color, lineWidth: 1.5, lineDash: [2, 2], opacity: 0.9 } },
            { type: 'circle', shape: { cx: a[0], cy: a[1], r: 2.6 }, style: { fill: P.panel, stroke: alpha(P.text, 0.65), lineWidth: 1.2 } },
          ],
        }
      },
    })
  }

  // Rippling "now" marker at the end of today's line, ringed in white.
  series.push({
    type: 'effectScatter',
    data: [[store.now, p.today]],
    symbolSize: 8,
    z: 6,
    silent: true,
    tooltip: { show: false },
    rippleEffect: { brushType: 'stroke', scale: 3.4, period: 2.6 },
    itemStyle: { color: P.steps, borderColor: P.panel, borderWidth: 1.5, shadowBlur: 3, shadowOffsetY: 1, shadowColor: 'rgba(15, 23, 42, 0.3)' },
  })

  return base({
    grid: { top: 16, right: 38, bottom: 22, left: 34 },
    tooltip: tooltip({ formatter: todayTip }),
    xAxis: timeAxis('HH:mm', { min: p.t(0), max: p.t(24), splitNumber: 4 }),
    yAxis: valueAxis({
      splitNumber: 3,
      max: (v) => axisTop(Math.max(v.max, goal * 1.06, p.hi ? Math.max(...p.hi) : 0)),
      axisLabel: { ...axisLabel, formatter: kfmt },
    }),
    series,
  })
})
</script>

<style scoped>
.empty-ico {
  width: 1.5rem;
  height: 1.5rem;
  fill: currentColor;
  opacity: 0.6;
}
</style>
