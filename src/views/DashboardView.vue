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
            :maxSelectedLabels="2"
            class="full-width"
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
            :maxSelectedLabels="2"
            class="full-width"
          />
        </div>
      </div>

      <!-- Display Options (right) -->
      <div class="display-options">
        <div class="toggle-item">
          <label for="showBars">Show Bars</label>
          <ToggleSwitch id="showBars" v-model="showBars" />
        </div>
        <div class="toggle-item">
          <label for="mergeData">Merge Lines</label>
          <ToggleSwitch id="mergeData" v-model="mergeData" />
        </div>
      </div>
    </div>

    <!-- Chart -->
    <div class="chart-container">
      <v-chart :option="chartOptions" autoresize />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import MultiSelect from 'primevue/multiselect'
import ToggleSwitch from 'primevue/toggleswitch'
import VChart from 'vue-echarts'
import { useDashboardStore } from '@/stores/timelineDashboard'

const store = useDashboardStore()
onMounted(() => store.fetchTimeline())

const showBars = ref(true)
const mergeData = ref(false)

const termOptions = computed(() =>
  store.allTerms.map(t => ({ label: t, value: t }))
)
const sourceOptions = computed(() =>
  store.allSources.map(s => ({ label: s, value: s }))
)

// simple average helper
const avg = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1)

const chartOptions = computed(() => {
  const { dates, series: raw } = store.chartData
  const keys = Object.keys(raw)
  const series = []

  // 1) Lines
  if (mergeData.value) {
    // one merged-avg line
    const avgMin = dates.map((_, i) => avg(keys.map(k => raw[k].minPrices[i])))
    series.push({
      name: 'Avg Min Price',
      type: 'line',
      data: avgMin,
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: { width: 3 }
    })
  } else {
    // one line per key, using default palette
    keys.forEach(k => {
      series.push({
        name: `${k} – Min Price`,
        type: 'line',
        data: raw[k].minPrices,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 3 }
      })
    })
  }

  // 2) Bars (always merged)
  if (showBars.value) {
    const avgOff = dates.map((_, i) => avg(keys.map(k => raw[k].offers[i])))
    series.push({
      name: 'Offers',
      type: 'bar',
      data: avgOff,
      yAxisIndex: 1,
      barMaxWidth: '20%',
      itemStyle: { color: 'rgba(200,200,200,0.4)' }
    })
  }

  return {
    // omit `color`, so ECharts cycles its built-in line palette
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { top: 20, left: 40, right: 40, bottom: 80 },

    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,     // ← ensure points/bars sit exactly on each date
      axisLabel: {
        interval: 0,          // ← force every label
        rotate: -30
      },
      axisTick: { alignWithLabel: true }
    },

    yAxis: [
      { type: 'value', name: 'Min Price' },
      { type: 'value', name: 'Offers', position: 'right' }
    ],

    series
  }
})
</script>

<style scoped>
.dashboard-card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  margin: 2rem auto;
  max-width: 800px;
  padding: 1rem;
}

/* Grid: two columns (filters | toggles) */
.controls-toolbar {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

/* Filters */
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}
.filter-item label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 600;
}

/* Toggles */
.display-options {
  border-left: 1px solid #eee;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.toggle-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.toggle-item label {
  margin-bottom: 0.25rem;
  font-weight: 500;
}

/* Chart */
.chart-container {
  height: 450px;
}
.chart-container :deep(.echarts-for-vue) {
  width: 100% !important;
  height: 100% !important;
}

/* Utility */
.full-width {
  width: 100%;
}
</style>
