<template>
  <div class="monitor-page">
    <div class="monitor-header">
      <div class="header-controls">
        <Select
          v-model="store.timeRange"
          :options="store.timeRangeOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Time Range"
          class="time-range-select"
          @change="store.fetchReadings()"
        />
        <Button
          icon="pi pi-refresh"
          severity="secondary"
          outlined
          :loading="store.loading"
          @click="store.fetchReadings()"
          v-tooltip.bottom="'Refresh'"
        />
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="summary-cards" v-if="store.latest">
      <div class="stat-card ping-card">
        <div class="stat-icon"><i class="pi pi-wifi"></i></div>
        <div class="stat-body">
          <span class="stat-label">Ping</span>
          <span class="stat-value">{{ formatVal(store.latest.ping_avg) }} ms</span>
          <span class="stat-range" v-if="store.stats">
            {{ formatVal(store.stats.ping_avg.min) }} – {{ formatVal(store.stats.ping_avg.max) }} ms
          </span>
        </div>
      </div>

      <div class="stat-card loss-card">
        <div class="stat-icon"><i class="pi pi-exclamation-triangle"></i></div>
        <div class="stat-body">
          <span class="stat-label">Packet Loss</span>
          <span class="stat-value">{{ formatVal(store.latest.packet_loss) }}%</span>
          <span class="stat-range" v-if="store.stats">
            max {{ formatVal(store.stats.packet_loss.max) }}%
          </span>
        </div>
      </div>

      <div class="stat-card dns-card">
        <div class="stat-icon"><i class="pi pi-globe"></i></div>
        <div class="stat-body">
          <span class="stat-label">DNS</span>
          <span class="stat-value">{{ formatVal(store.latest.dns_resolve_ms) }} ms</span>
          <span class="stat-range" v-if="store.stats">
            {{ formatVal(store.stats.dns_resolve_ms.min) }} – {{ formatVal(store.stats.dns_resolve_ms.max) }} ms
          </span>
        </div>
      </div>

      <div class="stat-card cpu-card">
        <div class="stat-icon"><i class="pi pi-cog"></i></div>
        <div class="stat-body">
          <span class="stat-label">CPU</span>
          <span class="stat-value">{{ formatVal(store.latest.cpu_percent) }}%</span>
          <span class="stat-range" v-if="store.latest.load_1m != null">
            load {{ formatVal(store.latest.load_1m, 2) }}
          </span>
        </div>
      </div>

      <div class="stat-card mem-card">
        <div class="stat-icon"><i class="pi pi-server"></i></div>
        <div class="stat-body">
          <span class="stat-label">Memory</span>
          <span class="stat-value">{{ formatVal(store.latest.mem_percent) }}%</span>
          <span class="stat-range" v-if="store.latest.mem_used_mb != null">
            {{ store.latest.mem_used_mb }} / {{ store.latest.mem_total_mb }} MB
          </span>
        </div>
      </div>

      <div class="stat-card temp-card">
        <div class="stat-icon"><i class="pi pi-gauge"></i></div>
        <div class="stat-body">
          <span class="stat-label">CPU Temp</span>
          <span class="stat-value">{{ formatVal(store.latest.cpu_temp_c) }}°C</span>
          <span class="stat-range" v-if="store.stats">
            {{ formatVal(store.stats.cpu_temp_c.min) }}° – {{ formatVal(store.stats.cpu_temp_c.max) }}°
          </span>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="store.loading && !store.readings.length" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem; color: var(--p-primary-500)"></i>
      <p>Loading monitor data...</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="!store.loading && !store.readings.length" class="empty-state">
      <i class="pi pi-server" style="font-size: 3rem; color: #9ca3af"></i>
      <p>No monitor readings found.</p>
    </div>

    <!-- Charts -->
    <div class="charts-grid" v-if="store.readings.length">
      <div class="chart-card">
        <v-chart :option="pingChartOptions" autoresize />
      </div>
      <div class="chart-card">
        <v-chart :option="cpuMemChartOptions" autoresize />
      </div>
      <div class="chart-card">
        <v-chart :option="cpuTempChartOptions" autoresize />
      </div>
      <div class="chart-card">
        <v-chart :option="networkChartOptions" autoresize />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, computed, watch } from 'vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
} from 'echarts/components'
import { usePiMonitorStore } from '@/stores/piMonitor'

use([
  CanvasRenderer,
  LineChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
])

const store = usePiMonitorStore()

onMounted(() => store.fetchReadings())
watch(() => store.timeRange, () => store.fetchReadings())

const formatVal = (v, decimals = 1) =>
  v != null ? Number(v).toFixed(decimals) : '–'

const sharedTooltip = {
  trigger: 'axis',
  backgroundColor: 'rgba(30, 30, 30, 0.9)',
  borderColor: 'rgba(255, 255, 255, 0.15)',
  padding: [8, 12],
  textStyle: { color: '#eee', fontSize: 12 },
  confine: true,
}

const sharedDataZoom = [
  { type: 'inside', start: 0, end: 100 },
  {
    type: 'slider', start: 0, end: 100, height: 20, bottom: 8,
    borderColor: 'transparent', backgroundColor: '#f1f5f9',
    fillerColor: 'rgba(34, 197, 94, 0.15)',
    handleStyle: { color: '#16a34a' },
  },
]

function makeSeries(name, data, color, area = true) {
  const s = {
    name,
    type: 'line',
    data,
    smooth: 0.3,
    symbol: 'none',
    lineStyle: { width: 2, color },
    emphasis: { lineStyle: { width: 3 } },
  }
  if (area) {
    s.areaStyle = {
      color: {
        type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [
          { offset: 0, color: color + '30' },
          { offset: 1, color: color + '05' },
        ],
      },
    }
  }
  return s
}

function buildChart({ title, series, yAxisName, yAxisMin, yAxisMax, markLines }) {
  const opts = {
    title: {
      text: title, left: 'center', top: 12,
      textStyle: { fontSize: 15, fontWeight: '600', color: '#1f2937' },
    },
    tooltip: sharedTooltip,
    legend: series.length > 1 ? {
      top: 12, right: 16,
      textStyle: { fontSize: 11, color: '#6b7280' },
    } : undefined,
    grid: { top: series.length > 1 ? 45 : 55, left: 55, right: 25, bottom: 55 },
    dataZoom: sharedDataZoom,
    xAxis: {
      type: 'time', boundaryGap: false,
      axisLabel: { fontSize: 11, color: '#6b7280', hideOverlap: true },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', name: yAxisName,
      min: yAxisMin, max: yAxisMax,
      nameTextStyle: { fontSize: 12, color: '#6b7280', padding: [0, 0, 0, 10] },
      axisLabel: { fontSize: 11, color: '#6b7280' },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
    },
    series,
  }
  if (markLines && opts.series.length) {
    opts.series[0].markLine = {
      silent: true, symbol: 'none',
      lineStyle: { type: 'dashed', width: 1.5 },
      label: { fontSize: 11, position: 'insideEndTop' },
      data: markLines,
    }
  }
  return opts
}

// --- Computed chart data ---

const networkRates = computed(() => {
  const r = store.readings
  if (r.length < 2) return { rx: [], tx: [] }
  const rx = [], tx = []
  for (let i = 1; i < r.length; i++) {
    const dt = (new Date(r[i].timestamp) - new Date(r[i - 1].timestamp)) / 1000
    const drx = r[i].rx_bytes - r[i - 1].rx_bytes
    const dtx = r[i].tx_bytes - r[i - 1].tx_bytes
    // Skip counter resets (reboots) and zero-time gaps
    if (dt > 0 && drx >= 0 && dtx >= 0) {
      rx.push([r[i].timestamp, +(drx / dt / 1024).toFixed(2)])
      tx.push([r[i].timestamp, +(dtx / dt / 1024).toFixed(2)])
    }
  }
  return { rx, tx }
})

// --- Chart options ---

const pingChartOptions = computed(() =>
  buildChart({
    title: 'Ping',
    yAxisName: 'ms',
    series: [
      makeSeries('Avg', store.readings.map(r => [r.timestamp, r.ping_avg]), '#22c55e'),
    ],
  })
)

const cpuMemChartOptions = computed(() =>
  buildChart({
    title: 'CPU & Memory',
    yAxisName: '%',
    yAxisMin: 0, yAxisMax: 100,
    series: [
      makeSeries('CPU', store.readings.map(r => [r.timestamp, r.cpu_percent]), '#65a30d'),
      makeSeries('Memory', store.readings.map(r => [r.timestamp, r.mem_percent]), '#0d9488'),
    ],
  })
)

const cpuTempChartOptions = computed(() =>
  buildChart({
    title: 'CPU Temperature',
    yAxisName: '°C',
    series: [
      makeSeries('Temp', store.readings.map(r => [r.timestamp, r.cpu_temp_c]), '#047857'),
    ],
    markLines: [
      { yAxis: 80, label: { formatter: 'Throttle (80°C)' }, lineStyle: { color: '#047857' } },
    ],
  })
)

const networkChartOptions = computed(() =>
  buildChart({
    title: 'Network Throughput',
    yAxisName: 'KB/s',
    series: [
      makeSeries('RX', networkRates.value.rx, '#84cc16'),
      makeSeries('TX', networkRates.value.tx, '#15803d'),
    ],
  })
)
</script>

<style scoped>
.monitor-page {
  max-width: 1800px;
  margin: 0 auto;
  padding: 1.5rem 2rem 3rem;
}

.monitor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.monitor-header h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.time-range-select {
  min-width: 160px;
}

/* Summary Cards */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  background: #fff;
  border-radius: 12px;
  padding: 1rem 1.25rem;
  display: flex;
  align-items: center;
  gap: 0.875rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  border: 1px solid #f3f4f6;
}

.stat-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 1.15rem;
}

.ping-card .stat-icon { background: #f0fdf4; color: #22c55e; }
.loss-card .stat-icon { background: #f7fee7; color: #84cc16; }
.dns-card .stat-icon { background: #ecfdf5; color: #10b981; }
.cpu-card .stat-icon { background: #f7fee7; color: #65a30d; }
.mem-card .stat-icon { background: #f0fdfa; color: #0d9488; }
.temp-card .stat-icon { background: #ecfdf5; color: #047857; }

.stat-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.stat-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #111827;
  line-height: 1.3;
}

.stat-range {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 2px;
}

/* Charts Grid */
.charts-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.chart-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  border: 1px solid #f3f4f6;
  padding: 0.75rem;
  height: 340px;
}

.chart-card :deep(.echarts-for-vue),
.chart-card :deep(canvas) {
  width: 100% !important;
  height: 100% !important;
}

/* States */
.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 1rem;
  gap: 1rem;
  color: #6b7280;
}

/* Responsive */
@media (max-width: 1200px) {
  .summary-cards {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 900px) {
  .monitor-page {
    padding: 1.5rem 1rem 3rem;
  }

  .summary-cards {
    grid-template-columns: repeat(2, 1fr);
  }

  .charts-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 500px) {
  .summary-cards {
    grid-template-columns: 1fr;
  }

  .monitor-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
}
</style>
