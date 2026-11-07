<template>
  <v-chart class="hx-chart" :option="option" autoresize />
</template>

<script setup>
// One night's hypnogram: rounded stage blocks (with a soft tinted drop shadow)
// on four banded rows joined by smooth gradient connectors, the night's heart
// rate as a thin line on its own scale, and SpO2 readings as dots.
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use, graphic } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { CustomChart, LineChart, ScatterChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { P, FONT, alpha, base, tooltip, timeAxis, axisLabel, tipRow, tipTitle, fmt } from '@/lib/health/theme'
import { ROWS, ROW_INDEX, STAGE, MIN, blocks, nearest } from './SleepShared'

use([CanvasRenderer, CustomChart, LineChart, ScatterChart, GridComponent, TooltipComponent])

const props = defineProps({
  session: { type: Object, required: true },   // health_sessions row (the night's main sleep)
  hr: { type: Array, default: () => [] },       // [[ms, bpm]]
  spo2: { type: Array, default: () => [] },     // [[ms, %]]
})

const segs = computed(() => blocks(props.session))

function clip(rect, cs) {
  return graphic.clipRectByRect(rect, { x: cs.x, y: cs.y, width: cs.width, height: cs.height })
}

// Mean of the neighbours within `half` samples either side that are close in time.
function smooth(points, half) {
  return points.map((p, i) => {
    let sum = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j++) {
      if (Math.abs(points[j][0] - p[0]) <= (half + 1) * MIN) {
        sum += points[j][1]
        n++
      }
    }
    return [p[0], sum / n]
  })
}

function blockHeight(api) {
  return Math.max(6, Math.min(api.size([0, 1])[1] * 0.5, 22))
}

// [row, start, end]
function renderBlock(params, api) {
  const row = api.value(0)
  const p0 = api.coord([api.value(1), row])
  const p1 = api.coord([api.value(2), row])
  const h = blockHeight(api)
  const rect = clip({ x: p0[0], y: p0[1] - h / 2, width: Math.max(p1[0] - p0[0], 2), height: h }, params.coordSys)
  if (!rect) return null
  const c = ROWS[row].color
  return {
    type: 'rect',
    shape: { ...rect, r: Math.min(4, rect.width / 2, rect.height / 2) },
    style: {
      fill: new graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: c },
        { offset: 1, color: alpha(c, 0.78) },
      ]),
      shadowBlur: 5,
      shadowOffsetY: 1.5,
      shadowColor: alpha(c, 0.3),
    },
  }
}

// [t, fromRow, toRow, prevMs, nextMs] — a soft step that leaves one block
// level, turns, and lands level on the next (the ends tuck under the blocks,
// so the curve never reaches past half of either neighbour), fading from the
// first stage's colour into the second's.
function renderLink(params, api) {
  const t = api.value(0)
  const a = api.coord([t, api.value(1)])
  const b = api.coord([t, api.value(2)])
  const d = Math.min(
    8,
    Math.abs(b[1] - a[1]) / 3,
    api.size([api.value(3), 0])[0] / 2,
    api.size([api.value(4), 0])[0] / 2,
  )
  const from = ROWS[api.value(1)].color
  const to = ROWS[api.value(2)].color
  return {
    type: 'bezierCurve',
    shape: { x1: a[0] - d, y1: a[1], cpx1: a[0], cpy1: a[1], cpx2: b[0], cpy2: b[1], x2: b[0] + d, y2: b[1] },
    style: {
      fill: null,
      lineWidth: 1.5,
      stroke: new graphic.LinearGradient(0, a[1], 0, b[1], [
        { offset: 0, color: alpha(from, 0.85) },
        { offset: 1, color: alpha(to, 0.85) },
      ], true),
    },
    silent: true,
  }
}

const option = computed(() => {
  const s = segs.value
  if (!s.length) return {}
  const t0 = new Date(props.session.start_time).getTime()
  const t1 = new Date(props.session.end_time).getTime()

  const links = []
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1]
    if (s[i].row !== prev.row) {
      links.push([s[i].start, ROW_INDEX[prev.row], ROW_INDEX[s[i].row], prev.end - prev.start, s[i].end - s[i].start])
    }
  }

  // 5-minute centred average (the raw minutes stay in the tooltip), broken
  // where the watch lost contact for 5+ min.
  const hr = []
  smooth(props.hr, 2).forEach((p, i, all) => {
    if (i && p[0] - all[i - 1][0] > 5 * MIN) hr.push([p[0] - 1, null])
    hr.push(p)
  })
  const vals = props.hr.map((p) => p[1])
  const hrLo = vals.length ? Math.min(...vals) : 0
  const hrHi = vals.length ? Math.max(...vals) : 1
  const pad = Math.max(4, hrHi - hrLo)

  // Invisible point every 2 min so the tooltip follows the cursor even with no heart rate.
  const tick = []
  for (let t = t0; t <= t1; t += 2 * MIN) tick.push([t, 0])

  return base({
    grid: { left: 2, right: vals.length ? 2 : 10, top: 8, bottom: 2, containLabel: true },
    tooltip: tooltip({
      axisPointer: { type: 'line', axis: 'x', lineStyle: { color: P.text3, type: 'dashed', width: 1 } },
      formatter: (params) => {
        const t = params[0]?.axisValue
        if (t == null) return ''
        const b = s.find((x) => t >= x.start && t < x.end)
        const h = nearest(props.hr, t, 3 * MIN)
        const o = nearest(props.spo2, t, 15 * MIN)
        let html = tipTitle(fmt.time(t))
        if (b) html += tipRow(STAGE[b.row].color, STAGE[b.row].label, `${fmt.time(b.start)}–${fmt.time(b.end)}`)
        if (h) html += tipRow(P.hr, 'Heart rate', fmt.bpm(h[1]))
        if (o) html += tipRow(P.spo2, 'SpO₂', `${Math.round(o[1])}%`)
        return html
      },
    }),
    xAxis: timeAxis('HH:mm', {
      min: t0,
      max: t1,
      splitNumber: 6,
      splitLine: { show: true, lineStyle: { color: P.grid } },
    }),
    yAxis: [
      {
        type: 'category',
        data: ROWS.map((r) => r.key),
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        splitArea: { show: true, areaStyle: { color: [alpha(P.text, 0.025), alpha(P.text, 0)] } },
        axisLabel: {
          margin: 10,
          formatter: (key) => `{l|${STAGE[key].label}}{${key}| }`,
          rich: {
            l: { color: P.text2, fontSize: 11, fontFamily: FONT, padding: [0, 7, 0, 0] },
            ...Object.fromEntries(ROWS.map((r) => [r.key, { width: 7, height: 7, borderRadius: 2, backgroundColor: r.color }])),
          },
        },
      },
      {
        type: 'value',
        show: vals.length > 0,
        position: 'right',
        min: Math.floor(hrLo - pad * 0.45),
        max: Math.ceil(hrHi + pad * 0.12),
        splitNumber: 2,
        axisLabel: { ...axisLabel, fontSize: 10, color: alpha(P.hr, 0.8), showMinLabel: false, showMaxLabel: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      { type: 'value', show: false, min: 84, max: 101 },
    ],
    series: [
      {
        type: 'custom',
        renderItem: renderLink,
        data: links,
        encode: { x: 0, y: [1, 2] },
        z: 1,
        silent: true,
        tooltip: { show: false },
      },
      {
        type: 'custom',
        renderItem: renderBlock,
        data: s.map((b) => [ROW_INDEX[b.row], b.start, b.end]),
        encode: { x: [1, 2], y: 0 },
        z: 2,
        tooltip: { show: false },
      },
      {
        type: 'line',
        yAxisIndex: 1,
        data: hr,
        showSymbol: false,
        smooth: 0.4,
        connectNulls: false,
        lineStyle: { width: 1.25, color: alpha(P.hr, 0.7), shadowBlur: 3, shadowColor: P.panel },
        emphasis: { disabled: true },
        z: 4,
      },
      {
        type: 'scatter',
        yAxisIndex: 2,
        data: props.spo2,
        symbolSize: 5,
        itemStyle: { color: P.spo2, borderColor: P.panel, borderWidth: 1.25 },
        emphasis: { disabled: true },
        z: 5,
      },
      {
        type: 'line',
        yAxisIndex: 2,
        data: tick,
        symbol: 'none',
        lineStyle: { opacity: 0 },
        emphasis: { disabled: true },
        z: 0,
      },
    ],
  })
})
</script>
