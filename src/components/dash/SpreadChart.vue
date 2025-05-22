<template>
  <div class="spread-card">
    <!-- local selectors (single row) -->
    <div class="spread-toolbar">
      <!-- Search term -->
      <div class="toolbar-item">
        <label for="spreadTerm">Search term</label>
        <Dropdown
          id="spreadTerm"
          v-model="selectedTerm"
          :options="termOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Choose…"
          class="p-dropdown-sm"
          :disabled="termOptions.length === 0"
          style="min-width: 180px"
        />
      </div>

      <!-- Sources -->
      <div class="toolbar-item">
        <label for="sourceSelect">Sources</label>
        <MultiSelect
          id="sourceSelect"
          v-model="selectedSources"
          :options="sourceOptions"
          optionLabel="label"
          optionValue="value"
          placeholder="Select sources"
          class="p-multiselect-sm"
          :disabled="sourceOptions.length === 0"
          display="chip"
          style="min-width: 180px"
        />
      </div>
    </div>

    <!-- chart -->
    <div class="spread-chart">
      <v-chart :option="option" autoresize />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import Dropdown from 'primevue/dropdown'
import MultiSelect from 'primevue/multiselect'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { ScatterChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, TitleComponent } from 'echarts/components'
import { useListingsTable } from '@/stores/listingsTable'

/* ---------------------------------------------------------------- ECharts */
use([CanvasRenderer, ScatterChart, GridComponent, TooltipComponent, TitleComponent])

/* ----------------------------------------------------------------  data  */
const listings = useListingsTable()
onMounted(() => {
  if (!listings.loaded && !listings.loading) listings.fetchAll()
})

/* ------------------------------------------------------ term selector --- */
const termOptions = computed(() =>
  [...new Set(listings.rows.map((r) => r.search_term))].map((t) => ({
    label: t,
    value: t,
  })),
)

const selectedTerm = ref(null)
watch(
  termOptions,
  (opts) => {
    if (opts.length) selectedTerm.value = opts[0].value
  },
  { immediate: true },
)

/* ----------------------------------------------------- source selector -- */
const sourceOptions = computed(() =>
  [...new Set(listings.rows.map((r) => r.source))].map((s) => ({
    label: s,
    value: s,
  })),
)

const selectedSources = ref([])
watch(
  sourceOptions,
  (opts) => {
    // on first load or when the list changes, pre-select everything
    if (selectedSources.value.length === 0 && opts.length) {
      selectedSources.value = opts.map((o) => o.value)
    }
  },
  { immediate: true },
)

/* ---------------------------------------------- rows after selections -- */
const rows = computed(() =>
  listings.rows
    .filter(
      (r) =>
        r.search_term === selectedTerm.value &&
        (selectedSources.value.length === 0 || selectedSources.value.includes(r.source)),
    )
    .sort((a, b) => new Date(a.date_inserted) - new Date(b.date_inserted)),
)

/* ------------------------ outlier filter (±5× median, need ≥5 rows) ---- */
const filteredRows = computed(() => {
  const arr = rows.value
  if (arr.length < 5) return arr

  const prices = arr.map((r) => r.price).sort((a, b) => a - b)
  const median = prices[Math.floor(prices.length / 2)]
  const lower = median / 5
  const upper = median * 5
  return arr.filter((r) => r.price >= lower && r.price <= upper)
})

/* --------------------------------------- cheapest offer after filtering */
const minRow = computed(() =>
  filteredRows.value.reduce((min, r) => (!min || r.price < min.price ? r : min), null),
)

const makeItem = (r) => [r.date_inserted, r.price, r] // attach row obj

const otherItems = computed(() =>
  filteredRows.value.filter((r) => r.id !== minRow.value?.id).map(makeItem),
)
const minItems = computed(() => (minRow.value ? [makeItem(minRow.value)] : []))

/* ------------------------------------------------------ chart options --- */
const tooltipFmt = (p) => {
  const r = p.data[2]
  return `
      <strong>${r.title}</strong><br/>
      Price: ${r.price} ${r.currency ?? ''}<br/>
      Date:  ${r.date_inserted}<br/>
      Source: ${r.source}<br/>
      <a href="${r.url}" target="_blank">open listing ↗</a>
    `
}

const option = computed(() => ({
  title: {
    text: 'Price spread',
    left: 'center',
    top: 20,
    textStyle: { fontSize: 16, fontWeight: 600 },
  },
  grid: { top: 60, bottom: 50, left: 70, right: 30 },
  tooltip: { trigger: 'item', confine: true, formatter: tooltipFmt },
  xAxis: {
    type: 'time',
    name: 'Date',
    nameLocation: 'middle',
    nameGap: 28,
    min: (value) => value.min - 24 * 60 * 60 * 1000,
  },
  yAxis: {
    type: 'value',
    name: 'Price',
    nameLocation: 'middle',
    nameGap: 45,
  },
  series: [
    {
      name: 'Offers',
      type: 'scatter',
      data: otherItems.value,
      symbolSize: 40,
      itemStyle: {
        color: 'rgba(65, 134, 111, 0.15)',
        borderWidth: 0,
      },
      symbol: 'circle',
      borderWidth: 100,
    },
    {
      name: 'Min price',
      type: 'scatter',
      data: minItems.value,
      symbolSize: 42,
      itemStyle: {
        color: 'rgba(16, 185, 129, 0.3)',
        borderWidth: 3,
        borderType: 'dotted',
        borderColor: '#10b981',
      },
    },
  ],
}))
</script>

<style scoped>
.spread-card {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  width: 500px; /* hard limit */
  flex: 0 0 500px; /* no growing, no shrinking */
  display: flex;
  flex-direction: column;
}

/* toolbar (single row) */
.spread-toolbar {
  display: flex;
  flex-wrap: nowrap; /* stay on one line */
  gap: 0.75rem;
  padding: 1.2rem 1rem 0;
}

/* each selector column */
.toolbar-item {
  flex: 1 1 0; /* let them share the row */
  min-width: 120px; /* small enough to fit two in 320 px */
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.toolbar-item label {
  font-size: 0.875rem;
  font-weight: 500;
  color: #4b5563;
}

/* make PrimeVue controls fill their column width */
.toolbar-item :deep(.p-dropdown),
.toolbar-item :deep(.p-multiselect) {
  width: 100%;
}

/* chart container */
.spread-chart {
  flex: 1 1 0;
  min-height: 400px;
  padding: 0 1rem 1.5rem;
}
.spread-chart :deep(.echarts-for-vue),
.spread-chart :deep(canvas) {
  width: 100% !important;
  height: 100% !important;
}
</style>
