<template>
  <div class="dashboard-page">
    <div class="dashboard-card">
      <!-- Header -->
      <div class="card-header">
        <div class="title-block">
          <h2 class="card-title">Price Spread</h2>
          <p class="card-subtitle">
            Every offer over time for the selected product. The cheapest live offer is ringed.
          </p>
        </div>

        <!-- quick stats -->
        <div v-if="stats" class="stats">
          <div class="stat">
            <span class="stat-value">{{ stats.count }}</span>
            <span class="stat-label">offers</span>
          </div>
          <div class="stat">
            <span class="stat-value accent">{{ fmtPrice(stats.min) }}</span>
            <span class="stat-label">cheapest</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ fmtPrice(stats.median) }}</span>
            <span class="stat-label">median</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ stats.spanDays }}d</span>
            <span class="stat-label">span</span>
          </div>
        </div>
      </div>

      <!-- Controls -->
      <div class="controls-toolbar">
        <div class="filters">
          <!-- Folder (by name) -->
          <div class="filter-item">
            <label for="folderSelect">Folders</label>
            <MultiSelect
              id="folderSelect"
              v-model="selectedFolders"
              :options="folderOptions"
              optionLabel="label"
              optionValue="value"
              filter
              placeholder="All folders"
              :maxSelectedLabels="1"
              selectedItemsLabel="{0} folders"
              :showToggleAll="true"
              class="ctl"
            />
          </div>

          <!-- File (by name, grouped under its folder) -->
          <div class="filter-item">
            <label for="fileSelect">Files</label>
            <MultiSelect
              id="fileSelect"
              v-model="selectedFiles"
              :options="fileGroups"
              optionLabel="label"
              optionValue="value"
              optionGroupLabel="label"
              optionGroupChildren="items"
              filter
              placeholder="All files"
              :maxSelectedLabels="1"
              selectedItemsLabel="{0} files"
              :disabled="fileGroups.length === 0"
              class="ctl"
            />
          </div>

          <!-- Search term -->
          <div class="filter-item">
            <label for="termSelect">Search term</label>
            <Select
              id="termSelect"
              v-model="selectedTerm"
              :options="termOptions"
              optionLabel="label"
              optionValue="value"
              filter
              placeholder="Choose a product…"
              :disabled="termOptions.length === 0"
              class="ctl"
              emptyMessage="No products in this scope"
            />
          </div>
        </div>

        <!-- Time range -->
        <div class="filter-item time-range">
          <label>Time range</label>
          <SelectButton
            v-model="timeRange"
            :options="timeRangeOptions"
            optionLabel="label"
            optionValue="value"
            :allowEmpty="false"
            class="time-buttons"
          />
        </div>
      </div>

      <!-- Chart -->
      <div class="chart-container">
        <v-chart v-if="hasData" :option="option" autoresize />
        <div v-else class="empty-state">
          <i class="pi pi-chart-scatter" />
          <p>{{ emptyMessage }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import MultiSelect from 'primevue/multiselect'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  DataZoomComponent,
} from 'echarts/components'
import { useListingsTable } from '@/stores/listingsTable'
import { useSearchTerms } from '@/stores/searchTerms'
import { useSidebarStore } from '@/stores/sidebar'

use([
  CanvasRenderer,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  DataZoomComponent,
])

/* ----------------------------------------------------------------  stores  */
const listings = useListingsTable()
const searchTerms = useSearchTerms()
const sidebar = useSidebarStore()

onMounted(() => {
  listings.fetchAll()
  searchTerms.fetchAll()
  sidebar.fetchFolders()
})

/* ----------------------------------------------------- folder / file scope */
// folder id -> name, file id -> { name, folderId, folderName }
const folderOptions = computed(() =>
  [...sidebar.folders]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ label: f.name, value: f.id })),
)

const selectedFolders = ref([])
const selectedFiles = ref([])

// Files grouped under their folder, scoped by the folder selection.
const fileGroups = computed(() => {
  const folders = selectedFolders.value.length
    ? sidebar.folders.filter((f) => selectedFolders.value.includes(f.id))
    : sidebar.folders
  return folders
    .filter((f) => (f.files?.length ?? 0) > 0)
    .map((f) => ({
      label: f.name,
      items: [...f.files]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((file) => ({ label: file.name, value: file.id })),
    }))
})

// Drop any selected files that fall outside the current folder scope.
watch(fileGroups, (groups) => {
  const valid = new Set(groups.flatMap((g) => g.items.map((i) => i.value)))
  selectedFiles.value = selectedFiles.value.filter((id) => valid.has(id))
})

// The set of file ids the chart is restricted to (null = no restriction).
const allowedFileIds = computed(() => {
  if (selectedFiles.value.length) return new Set(selectedFiles.value)
  if (selectedFolders.value.length) {
    const ids = sidebar.folders
      .filter((f) => selectedFolders.value.includes(f.id))
      .flatMap((f) => (f.files ?? []).map((file) => file.id))
    return new Set(ids)
  }
  return null
})

// search term -> set of file ids it is configured under (from scrape_jobs)
const termFileIds = computed(() => {
  const map = new Map()
  for (const t of searchTerms.terms) {
    if (t.fileId == null) continue
    if (!map.has(t.term)) map.set(t.term, new Set())
    map.get(t.term).add(t.fileId)
  }
  return map
})

/* ------------------------------------------------------ term selector  --- */
const ALL_TERMS = '__ALL_TERMS__'

const termOptions = computed(() => {
  const allowed = allowedFileIds.value
  const counts = {}
  for (const r of listings.rows) {
    if (allowed) {
      const fileIds = termFileIds.value.get(r.search_term)
      if (!fileIds || ![...fileIds].some((id) => allowed.has(id))) continue
    }
    counts[r.search_term] = (counts[r.search_term] || 0) + 1
  }
  const terms = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
  const opts = terms.map((t) => ({ label: t, value: t }))
  if (opts.length > 1) opts.unshift({ label: 'All search terms', value: ALL_TERMS })
  return opts
})

const selectedTerm = ref(null)
watch(
  termOptions,
  (opts) => {
    if (!opts.some((o) => o.value === selectedTerm.value)) {
      selectedTerm.value = opts.length ? opts[0].value : null
    }
  },
  { immediate: true },
)

/* ---------------------------------------------------------- time range  --- */
const timeRangeOptions = [
  { label: '7D', value: 7 },
  { label: '30D', value: 30 },
  { label: '90D', value: 90 },
  { label: '1Y', value: 365 },
  { label: 'All', value: null },
]
const timeRange = ref(null)

/* ---------------------------------------------- rows after all selections */
// names of the search terms currently in scope (excludes the "All" sentinel)
const scopedTerms = computed(() =>
  termOptions.value.map((o) => o.value).filter((v) => v !== ALL_TERMS),
)

const rows = computed(() => {
  if (!selectedTerm.value) return []
  const keep =
    selectedTerm.value === ALL_TERMS
      ? new Set(scopedTerms.value)
      : new Set([selectedTerm.value])
  let arr = listings.rows.filter((r) => keep.has(r.search_term))
  if (timeRange.value) {
    const cutoff = Date.now() - timeRange.value * 24 * 60 * 60 * 1000
    arr = arr.filter((r) => new Date(r.date_inserted).getTime() >= cutoff)
  }
  return arr.sort((a, b) => new Date(a.date_inserted) - new Date(b.date_inserted))
})

/* ------------------------ outlier filter (±5× median, per product) ----- */
// Group by search_term so price scales of different products don't mix.
const groupedRows = computed(() => {
  const groups = new Map()
  for (const r of rows.value) {
    if (!groups.has(r.search_term)) groups.set(r.search_term, [])
    groups.get(r.search_term).push(r)
  }
  return groups
})

const filteredRows = computed(() => {
  const out = []
  for (const arr of groupedRows.value.values()) {
    if (arr.length < 5) {
      out.push(...arr)
      continue
    }
    const prices = arr.map((r) => r.price).sort((a, b) => a - b)
    const median = prices[Math.floor(prices.length / 2)]
    out.push(...arr.filter((r) => r.price >= median / 5 && r.price <= median * 5))
  }
  return out
})

// cheapest live offer per product (one orange ring each)
const minRows = computed(() => {
  const mins = new Map()
  for (const r of filteredRows.value) {
    const cur = mins.get(r.search_term)
    if (!cur || r.price < cur.price) mins.set(r.search_term, r)
  }
  return [...mins.values()]
})

/* -------------------------------------------------------------- stats  --- */
const fmtPrice = (v) => (typeof v === 'number' ? v.toFixed(0) : '—')

const stats = computed(() => {
  const arr = filteredRows.value
  if (!arr.length) return null
  const prices = arr.map((r) => r.price).sort((a, b) => a - b)
  const median = prices[Math.floor(prices.length / 2)]
  const first = new Date(arr[0].date_inserted).getTime()
  const last = new Date(arr[arr.length - 1].date_inserted).getTime()
  return {
    count: arr.length,
    min: prices[0],
    median,
    spanDays: Math.max(1, Math.round((last - first) / (24 * 60 * 60 * 1000))),
  }
})

/* ------------------------------------------------------ chart options  --- */
const primaryColor = 'rgb(249, 115, 22)'

const hasData = computed(() => filteredRows.value.length > 0)
const emptyMessage = computed(() => {
  if (!termOptions.value.length) return 'No products match the selected folders / files.'
  if (!selectedTerm.value) return 'Pick a search term to see its price spread.'
  return 'No offers in the selected time range.'
})

const makeItem = (r) => [r.date_inserted, r.price, r]

const tooltipFmt = (p) => {
  const r = p.data[2]
  return `
    <strong>${r.title}</strong><br/>
    Price: ${r.price} ${r.currency ?? ''}<br/>
    Date:  ${new Date(r.date_inserted).toLocaleDateString()}<br/>
    Source: ${r.source}<br/>
    <a href="${r.url}" target="_blank">open listing ↗</a>
  `
}

const option = computed(() => {
  const minIds = new Set(minRows.value.map((r) => r.id))
  const series = [
    {
      name: 'Offers',
      type: 'scatter',
      data: filteredRows.value.filter((r) => !minIds.has(r.id)).map(makeItem),
      symbolSize: 40,
      symbol: 'circle',
      itemStyle: { color: 'rgba(177, 128, 93, 0.15)', borderWidth: 0 },
    },
  ]

  if (minRows.value.length) {
    series.push({
      name: 'Min price',
      type: 'scatter',
      data: minRows.value.map(makeItem),
      symbolSize: 42,
      z: 10,
      itemStyle: {
        color: 'rgba(249, 115, 22, 0.3)',
        borderWidth: 3,
        borderType: 'dotted',
        borderColor: primaryColor,
      },
    })
  }

  return {
    grid: { top: 30, bottom: 80, left: 64, right: 32 },
    tooltip: {
      trigger: 'item',
      confine: true,
      formatter: tooltipFmt,
      backgroundColor: 'rgba(50, 50, 50, 0.9)',
      borderColor: 'rgba(255,255,255,0.2)',
      textStyle: { color: '#eee', fontSize: 12 },
    },
    xAxis: {
      type: 'time',
      name: 'Date',
      nameLocation: 'middle',
      nameGap: 30,
      min: (v) => v.min - 24 * 60 * 60 * 1000,
    },
    yAxis: {
      type: 'value',
      name: 'Price',
      nameLocation: 'middle',
      nameGap: 48,
      scale: true,
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, bottom: 16, height: 22 },
    ],
    series,
  }
})
</script>

<style scoped>
.dashboard-page {
  max-width: 1400px;
  margin: 2rem auto;
  padding: 0 1.5rem;
}

.dashboard-card {
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 0.75rem;
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.08);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* header */
.card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1.5rem;
}
.card-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
  color: #1f2937;
}
.card-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: #6b7280;
  max-width: 32rem;
}

/* stats */
.stats {
  display: flex;
  gap: 0.75rem;
}
.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 4.5rem;
  padding: 0.5rem 0.75rem;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 0.625rem;
}
.stat-value {
  font-size: 1.125rem;
  font-weight: 700;
  color: #1f2937;
  line-height: 1.2;
}
.stat-value.accent {
  color: rgb(249, 115, 22);
}
.stat-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #9ca3af;
}

/* controls */
.controls-toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 1.25rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid #eef2f7;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  align-items: flex-end;
}
.filter-item {
  display: flex;
  flex-direction: column;
}
.filter-item label {
  margin-bottom: 0.4rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #4b5563;
}
.ctl {
  min-width: 12rem;
}
.time-range .time-buttons {
  align-self: flex-start;
}

/* chart */
.chart-container {
  height: 65vh;
  min-height: 26rem;
}
.chart-container :deep(.echarts-for-vue),
.chart-container :deep(canvas) {
  width: 100% !important;
  height: 100% !important;
}

.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: #9ca3af;
}
.empty-state i {
  font-size: 2.5rem;
}
.empty-state p {
  margin: 0;
  font-size: 0.9375rem;
}

/* tooltip height fix (carried over) */
:deep(div[style*='z-index: 9999999']) {
  height: auto !important;
  min-height: auto !important;
  max-height: none !important;
}
</style>
