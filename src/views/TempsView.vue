<template>
  <div class="temps-page">
    <div class="temps-header">
      <h1>Weather Station</h1>
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
      <div class="stat-card temp-card">
        <div class="stat-icon">
          <i class="pi pi-sun"></i>
        </div>
        <div class="stat-body">
          <span class="stat-label">Temperature</span>
          <span class="stat-value">{{ formatVal(store.latest.temperature, 1) }}°C</span>
          <span class="stat-range" v-if="store.stats">
            {{ formatVal(store.stats.temperature.min, 1) }}° – {{ formatVal(store.stats.temperature.max, 1) }}°
          </span>
        </div>
      </div>

      <div class="stat-card humidity-card">
        <div class="stat-icon">
          <i class="pi pi-cloud"></i>
        </div>
        <div class="stat-body">
          <span class="stat-label">Humidity</span>
          <span class="stat-value">{{ formatVal(store.latest.humidity, 1) }}%</span>
          <span class="stat-range" v-if="store.stats">
            {{ formatVal(store.stats.humidity.min, 1) }}% – {{ formatVal(store.stats.humidity.max, 1) }}%
          </span>
        </div>
      </div>

      <div class="stat-card pressure-card">
        <div class="stat-icon">
          <i class="pi pi-gauge"></i>
        </div>
        <div class="stat-body">
          <span class="stat-label">Pressure</span>
          <span class="stat-value">{{ formatVal(store.latest.pressure, 1) }} hPa</span>
          <span class="stat-range" v-if="store.stats">
            {{ formatVal(store.stats.pressure.min, 1) }} – {{ formatVal(store.stats.pressure.max, 1) }} hPa
          </span>
        </div>
      </div>

      <div class="stat-card readings-card">
        <div class="stat-icon">
          <i class="pi pi-database"></i>
        </div>
        <div class="stat-body">
          <span class="stat-label">Readings</span>
          <span class="stat-value">{{ store.stats?.count ?? '–' }}</span>
          <span class="stat-range">
            Last: {{ formatTime(store.latest.timestamp) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="store.loading && !store.readings.length" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 2rem; color: var(--p-primary-500)"></i>
      <p>Loading weather data...</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="!store.loading && !store.readings.length" class="empty-state">
      <i class="pi pi-cloud" style="font-size: 3rem; color: #9ca3af"></i>
      <p>No weather readings found.</p>
    </div>

    <!-- Charts -->
    <template v-if="store.readings.length">
      <!-- Temperature Chart -->
      <div class="chart-card">
        <v-chart :option="temperatureChartOptions" autoresize />
      </div>

      <!-- Humidity Chart -->
      <div class="chart-card">
        <v-chart :option="humidityChartOptions" autoresize />
      </div>

      <!-- Pressure Chart -->
      <div class="chart-card">
        <v-chart :option="pressureChartOptions" autoresize />
      </div>
    </template>
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
} from 'echarts/components'
import { useWeatherStore } from '@/stores/weatherReadings'
import dayjs from 'dayjs'

use([
  CanvasRenderer,
  LineChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
])

const store = useWeatherStore()

onMounted(() => store.fetchReadings())
watch(() => store.timeRange, () => store.fetchReadings())

const formatVal = (v, decimals = 1) =>
  v != null ? Number(v).toFixed(decimals) : '–'

const formatTime = (ts) => ts ? dayjs(ts).format('MMM D, HH:mm') : '–'

// No longer needed — time axis uses raw timestamps

const sharedTooltip = {
  trigger: 'axis',
  backgroundColor: 'rgba(30, 30, 30, 0.9)',
  borderColor: 'rgba(255, 255, 255, 0.15)',
  padding: [8, 12],
  textStyle: { color: '#eee', fontSize: 12 },
  confine: true,
}

const sharedDataZoom = [
  {
    type: 'inside',
    start: 0,
    end: 100,
  },
  {
    type: 'slider',
    start: 0,
    end: 100,
    height: 20,
    bottom: 8,
    borderColor: 'transparent',
    backgroundColor: '#f1f5f9',
    fillerColor: 'rgba(249, 115, 22, 0.15)',
    handleStyle: { color: '#f97316' },
  },
]

function buildChartOptions(title, data, color, unit, yAxisName) {
  return {
    title: {
      text: title,
      left: 'center',
      top: 12,
      textStyle: { fontSize: 15, fontWeight: '600', color: '#1f2937' },
    },
    tooltip: {
      ...sharedTooltip,
      valueFormatter: (v) => (v != null ? `${Number(v).toFixed(1)} ${unit}` : 'N/A'),
    },
    grid: { top: 55, left: 55, right: 25, bottom: 55 },
    dataZoom: sharedDataZoom,
    xAxis: {
      type: 'time',
      boundaryGap: false,
      axisLabel: {
        fontSize: 11,
        color: '#6b7280',
        formatter: (val) => dayjs(val).format('MMM D HH:mm'),
      },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      name: yAxisName,
      nameTextStyle: { fontSize: 12, color: '#6b7280', padding: [0, 0, 0, 10] },
      axisLabel: { fontSize: 11, color: '#6b7280' },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
    },
    series: [
      {
        type: 'line',
        data,
        smooth: 0.3,
        symbol: 'none',
        lineStyle: { width: 2.5, color },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: color + '30' },
              { offset: 1, color: color + '05' },
            ],
          },
        },
        emphasis: {
          lineStyle: { width: 3 },
        },
      },
    ],
  }
}

const temperatureChartOptions = computed(() =>
  buildChartOptions(
    'Temperature',
    store.readings.map((r) => [r.timestamp, r.temperature]),
    '#ef4444',
    '°C',
    '°C'
  )
)

const humidityChartOptions = computed(() =>
  buildChartOptions(
    'Humidity',
    store.readings.map((r) => [r.timestamp, r.humidity]),
    '#3b82f6',
    '%',
    '%'
  )
)

const pressureChartOptions = computed(() =>
  buildChartOptions(
    'Pressure',
    store.readings.map((r) => [r.timestamp, r.pressure]),
    '#8b5cf6',
    'hPa',
    'hPa'
  )
)
</script>

<style scoped>
.temps-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}

.temps-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.temps-header h1 {
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
  grid-template-columns: repeat(4, 1fr);
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

.temp-card .stat-icon {
  background: #fef2f2;
  color: #ef4444;
}

.humidity-card .stat-icon {
  background: #eff6ff;
  color: #3b82f6;
}

.pressure-card .stat-icon {
  background: #f5f3ff;
  color: #8b5cf6;
}

.readings-card .stat-icon {
  background: #f0fdf4;
  color: #22c55e;
}

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

/* Chart Cards */
.chart-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  border: 1px solid #f3f4f6;
  padding: 0.75rem;
  margin-bottom: 1rem;
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
@media (max-width: 900px) {
  .summary-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 500px) {
  .summary-cards {
    grid-template-columns: 1fr;
  }

  .temps-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
}
</style>
