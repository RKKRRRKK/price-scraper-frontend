<template>
  <v-chart class="hx-chart" :option="option" autoresize @click="onClick" />
</template>

<script setup>
// Stacked stage minutes per night (deep at the bottom), the average time
// asleep as a dashed line over a faint 7–9 h band. Click a night to open it.
import { computed } from 'vue'
import dayjs from 'dayjs'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent } from 'echarts/components'
import { P, SLEEP, alpha, base, tooltip, valueAxis, axisLabel, axisLine, tipRow, tipTitle, fmt } from '@/lib/health/theme'
import { ROWS, mean, efficiency, isWeekend, finePointer } from './SleepShared'

use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent])

const props = defineProps({
  nights: { type: Array, required: true },   // store.nights, oldest first
  visible: { type: Number, default: 30 },    // nights in view (the average uses the same)
})
const emit = defineEmits(['select'])

// Touch screens get a fixed window; mice/trackpads can zoom and pan through all of it.
const shown = computed(() => (finePointer ? props.nights : props.nights.slice(-21)))

const divider = `<div style="height:1px;background:${P.border2};margin:6px 0"></div>`

function tip(n) {
  return tipTitle(dayjs(n.key).format('ddd D MMM'))
    + [...ROWS].reverse().map((r) => tipRow(r.color, r.label, fmt.duration(n.mins[r.key]))).join('')
    + divider
    + tipRow(P.text, 'Asleep', fmt.duration(n.asleep))
    + tipRow(P.text3, 'Efficiency', `${efficiency(n) ?? '–'}%`)
}

const option = computed(() => {
  const ns = shown.value
  if (!ns.length) return {}
  const avg = mean(ns.slice(-props.visible).map((n) => n.asleep)) / 60
  const tallest = Math.max(...ns.map((n) => (n.mins.deep + n.mins.light + n.mins.rem + n.mins.awake) / 60))
  const last = ROWS.length - 1

  return base({
    grid: { left: 2, right: 8, top: 12, bottom: 2, containLabel: true },
    tooltip: tooltip({
      axisPointer: { type: 'shadow', shadowStyle: { color: alpha(P.text, 0.045) } },
      formatter: (params) => tip(ns[params[0].dataIndex]),
    }),
    dataZoom: finePointer
      ? [{ type: 'inside', startValue: Math.max(0, ns.length - props.visible), endValue: ns.length - 1, minValueSpan: 6 }]
      : [],
    xAxis: {
      type: 'category',
      data: ns.map((n) => n.key),
      axisLine,
      axisTick: { show: false },
      axisLabel: {
        ...axisLabel,
        hideOverlap: true,
        formatter: (k) => `{${isWeekend(k) ? 'we' : 'wd'}|${dayjs(k).format('D MMM')}}`,
        rich: { we: { color: P.text2, fontSize: 11 }, wd: { color: P.text3, fontSize: 11 } },
      },
    },
    yAxis: valueAxis({
      min: 0,
      max: Math.max(10, Math.ceil(tallest)),
      interval: 2,
      axisLabel: { ...axisLabel, formatter: (v) => `${v}h` },
    }),
    series: ROWS.map((r, i) => ({
      name: r.label,
      type: 'bar',
      stack: 'night',
      barMaxWidth: 18,
      barCategoryGap: '32%',
      data: ns.map((n) => +(n.mins[r.key] / 60).toFixed(3)),
      itemStyle: {
        color: r.key === 'awake' ? alpha(r.color, 0.85) : r.color,
        borderColor: P.panel,
        borderWidth: 1,
        borderRadius: i === last ? [3, 3, 0, 0] : 0,
      },
      emphasis: { itemStyle: { color: r.color, shadowBlur: 4, shadowOffsetY: 1, shadowColor: 'rgba(15, 23, 42, 0.2)' } },
      ...(i === 0
        ? {
            // The healthy 7–9 h: a faint lavender band with dashed edges.
            markArea: {
              silent: true,
              itemStyle: { color: alpha(SLEEP.light, 0.07), borderColor: alpha(SLEEP.light, 0.4), borderWidth: 1, borderType: [3, 3] },
              data: [[{ yAxis: 7 }, { yAxis: 9 }]],
            },
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { type: [4, 4], color: alpha(P.text, 0.55), width: 1 },
              label: {
                position: 'insideEndTop',
                color: P.text,
                fontSize: 10,
                fontWeight: 600,
                padding: [2, 6],
                borderRadius: 4,
                backgroundColor: alpha(P.panel, 0.92),
                formatter: `avg ${fmt.duration(avg * 60)}`,
              },
              data: [{ yAxis: +avg.toFixed(3) }],
            },
          }
        : {}),
    })),
  })
})

function onClick(e) {
  const n = shown.value[e.dataIndex]
  if (n) emit('select', n.key)
}
</script>
