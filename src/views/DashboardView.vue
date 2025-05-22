<template>
  <div class="dashboard-layout">
    <!-- main dashboard card (left) -->
    <div class="dashboard-card">
      <!-- Controls Panel -->
      <div class="controls-toolbar">
        <!-- Filters (left) -->
        <div class="filters">
          <!-- Search Terms -->
          <div class="filter-item">
            <label for="termSelect">Search Terms</label>
            <MultiSelect
              id="termSelect"
              v-model="store.selectedTerms"
              :options="termOptions"
              optionLabel="label"
              optionValue="value"
              filter
              placeholder="Select terms"
              :maxSelectedLabels="1"
              selectedItemsLabel="{0} items selected"
              class="p-multiselect-sm"
              style="min-width: 180px"
            />
          </div>
          <!-- Sources -->
          <div class="filter-item">
            <label for="sourceSelect">Sources</label>
            <MultiSelect
              id="sourceSelect"
              v-model="store.selectedSources"
              :options="sourceOptions"
              optionLabel="label"
              optionValue="value"
              filter
              placeholder="Select sources"
              :maxSelectedLabels="1"
              selectedItemsLabel="{0} sources selected"
              class="p-multiselect-sm"
              style="min-width: 180px"
            />
          </div>
          <!-- File IDs -->
          <div class="filter-item">
            <label for="fileSelect">File IDs</label>
            <MultiSelect
              id="fileSelect"
              v-model="store.selectedFileIds"
              :options="fileOptions"
              optionLabel="label"
              optionValue="value"
              filter
              placeholder="Select files"
              :maxSelectedLabels="1"
              selectedItemsLabel="{0} files selected"
              class="p-multiselect-sm"
              style="min-width: 180px"
            />
          </div>
        </div>

        <!-- Display Options (right) -->
        <div class="display-options">
          <label for="mergeData">Merge Lines</label>
          <ToggleSwitch id="mergeData" v-model="mergeData" />
        </div>
      </div>

      <!-- Line Chart -->
      <div class="chart-container">
        <v-chart :option="lineOptions" autoresize />
      </div>

      <!-- Bar Chart -->
      <div class="chart-container">
        <v-chart :option="barOptions" autoresize />
      </div>
    </div>

    <!-- price-spread card (right) -->
    <div class="spread-wrapper">
      <SpreadChart />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import MultiSelect from 'primevue/multiselect'
import ToggleSwitch from 'primevue/toggleswitch'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from 'echarts/components'
import { useDashboardStore } from '@/stores/timelineDashboard'
import SpreadChart from '@/components/dash/SpreadChart.vue'

// Register eCharts components
use([
  CanvasRenderer,
  LineChart,
  BarChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
])

const store = useDashboardStore()
onMounted(() => store.fetchTimeline())

// UI toggles
const mergeData = ref(true)

// Dropdown options
const termOptions = computed(() => store.allTerms.map((t) => ({ label: t, value: t })))
const sourceOptions = computed(() => store.allSources.map((s) => ({ label: s, value: s })))
const fileOptions = computed(() => store.allFileIds.map((f) => ({ label: f, value: f })))

// Helpers
const safeGet = (arr, idx) => (Array.isArray(arr) && idx < arr.length ? arr[idx] : undefined)

const sumDefined = (arr) =>
  arr.map((v) => (typeof v === 'number' ? v : 0)).reduce((a, b) => a + b, 0)

const avgDefined = (arr) => {
  const nums = arr.filter((v) => typeof v === 'number')
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined
}

// Base computed for dates and raw series
const base = computed(() => {
  const { dates, series: raw } = store.chartData
  const keys = Object.keys(raw)
  return { dates, raw, keys }
})

// Color palette
const colorPalette = [
  '#5470C6',
  '#91CC75',
  '#FAC858',
  '#EE6666',
  '#73C0DE',
  '#3BA272',
  '#FC8452',
  '#9A60B4',
  '#EA7CCC',
]
const primaryColor = 'rgb(249, 115, 22)'

// Shared tooltip styling
const sharedTooltipConfig = {
  trigger: 'item',
  backgroundColor: 'rgba(50, 50, 50, 0.85)',
  borderColor: 'rgba(255, 255, 255, 0.2)',
  padding: [6, 10],
  textStyle: { color: '#eee', fontSize: 12 },
  valueFormatter: (v) => (typeof v === 'number' ? v.toFixed(2) : 'N/A'),
  confine: true,
}

// Line chart options
const lineOptions = computed(() => {
  const dates = base.value.dates
  const filtered = store.filtered

  // Build date→(key→min_price) map
  const byDateMin = filtered.reduce((acc, { the_date, search_term, source, min_price }) => {
    acc[the_date] = acc[the_date] || {}
    acc[the_date][`${search_term}__${source}`] = Number(min_price)
    return acc
  }, {})

  // All series keys
  const allKeys = Array.from(new Set(filtered.map((r) => `${r.search_term}__${r.source}`)))

  const series = []
  const legendData = []

  if (mergeData.value) {
    // Average line
    const avgMin = dates.map((date) => avgDefined(allKeys.map((key) => byDateMin[date]?.[key])))
    const name = 'Average Min Price'
    series.push({
      name,
      type: 'line',
      data: avgMin,
      smooth: 0.3,
      symbol: 'emptyCircle',
      symbolSize: 14,
      itemStyle: { color: primaryColor },
      lineStyle: { width: 5, color: primaryColor },
    })
    legendData.push(name)
  } else {
    // One line per key
    allKeys.forEach((key, i) => {
      const data = dates.map((date) =>
        typeof byDateMin[date]?.[key] === 'number' ? byDateMin[date][key] : null,
      )
      const color = colorPalette[i % colorPalette.length]
      series.push({
        name: key,
        type: 'line',
        data,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 11,
        itemStyle: { color },
        lineStyle: { width: 5, color },
      })
      legendData.push(key)
    })
  }

  return {
    title: {
      text: 'Min Price Over Time',
      left: 'center',
      top: 30,
      textStyle: { fontSize: 16, fontWeight: '600' },
    },
    color: colorPalette,
    tooltip: { ...sharedTooltipConfig },
    legend: {
      data: legendData,
      show: !mergeData.value,
      type: 'scroll',
      top: 'auto',
      textStyle: { fontSize: 14 },
    },
    grid: { top: 70, left: 50, right: 30 },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: true,
      axisLabel: { interval: 'auto', rotate: 0 },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: 'value',
      name: 'Min Price',
      nameTextStyle: { padding: [0, 0, 0, 40] },
      axisLabel: { formatter: '{value}' },
    },
    series,
  }
})

// Bar chart options
const barOptions = computed(() => {
  const dates = base.value.dates

  // Sum offers per date
  const offersByDate = store.filtered.reduce((acc, { the_date, offers }) => {
    acc[the_date] = (acc[the_date] || 0) + Number(offers)
    return acc
  }, {})

  const sumOff = dates.map((date) => offersByDate[date] || 0)

  return {
    title: {
      text: 'Total Offers Over Time',
      left: 'center',
      top: 10,
      textStyle: { fontSize: 16, fontWeight: '600' },
    },
    tooltip: {
      ...sharedTooltipConfig,
      axisPointer: { type: 'shadow' },
    },
    grid: { top: 60, left: 50, right: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { interval: 'auto', rotate: 0 },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: 'value',
      name: 'Offers',
      nameTextStyle: { padding: [0, 0, 0, 30] },
    },
    series: [
      {
        name: 'Total Offers',
        type: 'bar',
        data: sumOff,
        barMaxWidth: '40px',
        itemStyle: { color: primaryColor, borderRadius: [3, 3, 0, 0] },
      },
    ],
  }
})
</script>

<style scoped>
.dashboard-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  margin: 2rem auto;
  max-width: 900px;
  padding: 1.5rem;
  border: 1px solid #eef2f7;
}

.controls-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1.5rem;
  margin-bottom: 0.5rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid #eef2f7;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  align-items: flex-end;
}

.filter-item {
  display: flex;
  flex-direction: column;
}

.filter-item label,
.display-options label {
  margin-bottom: 0.4rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4b5563;
}

.display-options {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-bottom: 5px;
}

:deep(.p-multiselect.p-multiselect-sm .p-multiselect-label) {
  padding-top: 0.4rem;
  padding-bottom: 0.4rem;
  font-size: 0.875rem;
}

.chart-container {
  height: 400px;
}

.chart-container :deep(.echarts-for-vue),
.chart-container :deep(canvas) {
  width: 100% !important;
  height: 100% !important;
}

/* Tooltip height fix */
:deep(div[style*='z-index: 9999999']) {
  height: auto !important;
  min-height: auto !important;
  max-height: none !important;
}

/* side-by-side chart layout */
.charts-wrapper {
  display: flex;
  align-items: flex-start; /* prevents overlap */
  gap: 1.5rem;
}

.left-charts {
  flex: 2 1 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.right-charts {
  flex-shrink: 0; /* stop it from squeezing */
  width: 320px; /* fixed column so it stays beside, not over */
  display: flex;
}

.dashboard-layout {
  display: flex;
  gap: 1.5rem;
  align-items: stretch; /* makes both cards equal height */
  margin: 2rem auto;
  max-width: 1400px;
}

/* let each card decide its own width */
.dashboard-card {
  flex: 2 1 0;
  max-width: none; /* remove the 900px cap so it can expand */
}

.spread-wrapper {
  padding: 2rem;

  flex: 1 1 0;
  display: flex; /* lets the inner SpreadChart stretch vertically */
}
</style>
