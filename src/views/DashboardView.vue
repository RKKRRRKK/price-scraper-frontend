<!-- src/components/PriceTimelineChart.vue -->
<template>
  <div class="dashboard-card">
    <!-- Controls Panel -->
    <div class="controls-toolbar">
      <!-- Filters (left) -->
      <div class="filters">
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
            style="min-width: 180px;"
          />
        </div>
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
            style="min-width: 180px;"
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
  LegendComponent
} from 'echarts/components'
import { useDashboardStore } from '@/stores/timelineDashboard'

// Register necessary eCharts components
use([
  CanvasRenderer,
  LineChart,
  BarChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent
])

const store = useDashboardStore()
onMounted(() => store.fetchTimeline())

// UI toggles
const mergeData = ref(true)

// Dropdown options
const termOptions   = computed(() => store.allTerms  .map(t => ({ label: t, value: t })))
const sourceOptions = computed(() => store.allSources.map(s => ({ label: s, value: s })))

// Helpers
const safeGet = (arr, idx) => Array.isArray(arr) && idx < arr.length ? arr[idx] : undefined
const sumDefined = arr => arr.map(v => (typeof v === 'number' ? v : 0)).reduce((a, b) => a + b, 0)
const avgDefined = arr => {
  const nums = arr.filter(v => typeof v === 'number')
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : undefined
}

// Base computed for dates and raw series
const base = computed(() => {
  const { dates, series: raw } = store.chartData
  const keys = Object.keys(raw)
  return { dates, raw, keys }
})

// Define a color palette for consistency
const colorPalette = [
  '#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE',
  '#3BA272', '#FC8452', '#9A60B4', '#EA7CCC'
];

const primaryColor = 'rgb(16, 185, 129)';

// --- Tooltip Configuration (Minimal with Basic Styling) ---
const sharedTooltipConfig = {
    trigger: 'axis',
    // Basic styling via config to ensure visibility if defaults are broken
    backgroundColor: 'rgba(50, 50, 50, 0.85)', // Slightly darker/more opaque
    borderColor: 'rgba(255, 255, 255, 0.2)',
    padding: [6, 10], // Reasonable padding
    textStyle: {
        color: '#eee',
        fontSize: 12
    },
    // Format numbers nicely
    valueFormatter: value => (typeof value === 'number' ? value.toFixed(2) : 'N/A'),
    // Keep inside chart bounds
    confine: true
};

// Line chart options
const lineOptions = computed(() => {
  const { dates, raw, keys } = base.value
  const series = []
  const legendData = []

  if (mergeData.value) {
    const avgMin = dates.map((_, i) =>
      avgDefined(keys.map(k => safeGet(raw[k].minPrices, i)))
    );
    const seriesName = 'Average Min Price';
    series.push({
      name: seriesName, type: 'line', data: avgMin, smooth: 0.3,
      symbol: 'circle', symbolSize: 10, itemStyle: { color: primaryColor },
      lineStyle: { width: 5, color: primaryColor }
    });
    legendData.push(seriesName);
  } else {
    keys.forEach((k, index) => {
      const data = raw[k].minPrices.map(v => (typeof v === 'number' ? v : null));
      const seriesName = `${k}`;
      const color = colorPalette[index % colorPalette.length];
      series.push({
        name: seriesName, type: 'line', data, smooth: 0.3,
        symbol: 'circle', symbolSize: 8, itemStyle: { color: color },
        lineStyle: { width: 2, color: color }
      });
      legendData.push(seriesName);
    });
  }

  return {
    title: {
      text: 'Min Price Over Time', left: 'center', top: 10,
      textStyle: { fontSize: 16, fontWeight: '600' }
    },
    color: colorPalette,
    tooltip: { ...sharedTooltipConfig }, // Use shared config
    legend: {
      data: legendData, show: !mergeData.value, type: 'scroll',
      bottom: 5, textStyle: { fontSize: 11 }
    },
    grid: {
      top: 60, left: 50, right: 30, bottom: mergeData.value ? 40 : 60
    },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false,
      axisLabel: { interval: 'auto', rotate: 0 }, axisTick: { alignWithLabel: true }
    },
    yAxis: {
      type: 'value', name: 'Min Price',
      nameTextStyle: { padding: [0, 0, 0, 40] }, axisLabel: { formatter: '{value}' }
    },
    series
  }
})

// Bar chart options
const barOptions = computed(() => {
  const { dates, raw, keys } = base.value
  const sumOff = dates.map((_, i) =>
    sumDefined(keys.map(k => safeGet(raw[k].offers, i)))
  )

  return {
    title: {
      text: 'Total Offers Over Time', left: 'center', top: 10,
      textStyle: { fontSize: 16, fontWeight: '600' }
    },
    tooltip: { // Use shared config + axis pointer specific to bar
        ...sharedTooltipConfig,
        axisPointer: { type: 'shadow' }
    },
    grid: { top: 60, left: 50, right: 30, bottom: 40 },
    xAxis: {
      type: 'category', data: dates,
      axisLabel: { interval: 'auto', rotate: 0 }, axisTick: { alignWithLabel: true }
    },
    yAxis: {
      type: 'value', name: 'Offers', nameTextStyle: { padding: [0, 0, 0, 30] },
    },
    series: [
      {
        name: 'Total Offers', type: 'bar', data: sumOff,
        barMaxWidth: '30px',
        itemStyle: { color: primaryColor, borderRadius: [3, 3, 0, 0] }
      }
    ]
  }
})
</script>

<style scoped>
/* General layout styles remain the same */
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
  margin-bottom: 2rem;
  padding-bottom: 1rem;
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
  height: 380px;
  margin-top: 1.5rem;
}

.chart-container :deep(.echarts-for-vue),
.chart-container :deep(canvas)
{
  /* Ensure canvas size is correct */
  width: 100% !important;
  height: 100% !important;
}


/* --- CORRECTED CSS Override for Tooltip Height --- */
/* Target the tooltip using a unique inline style attribute */
/* The z-index is a likely candidate, but check display or position if needed */
:deep(div[style*="z-index: 9999999"]) {
  height: auto !important;
  min-height: auto !important; /* Reset min-height */
  max-height: none !important; /* Reset max-height */

  /* Optional: Limit width if text gets too long horizontally */
  /* max-width: 400px !important;  */
}
/* --- End of CSS Override --- */

</style>