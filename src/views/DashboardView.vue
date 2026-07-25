<template>
  <div class="dashboard-page">
    <!-- Page header (outside the chart box) -->
    <div class="page-header">
      <h2 class="page-title">Price Spread</h2>
      <p class="page-subtitle">
        Every offer over time for the selected product. The cheapest live offer is ringed.
      </p>
    </div>

    <div class="dashboard-body">
      <!-- Stats modules (outside the chart box, on the left) -->
      <aside v-if="stats" class="stats-panel">
        <div class="stat-module accent-module">
          <span class="stat-value accent">{{ fmtPrice(stats.min) }}</span>
          <span class="stat-label">cheapest</span>
        </div>
        <div class="stat-module">
          <span class="stat-value">{{ fmtPrice(stats.mean) }}</span>
          <span class="stat-label">average</span>
        </div>
        <div class="stat-module">
          <span class="stat-value">{{ fmtPrice(stats.median) }}</span>
          <span class="stat-label">median</span>
        </div>
        <div class="stat-module">
          <span class="stat-value">±{{ fmtPrice(stats.stdDev) }}</span>
          <span class="stat-label">std dev</span>
        </div>
        <div
          class="stat-module"
          title="Least-squares trend line fitted across every offer in the window (slope × span). It's how much the fitted price fell or rose start-to-end — negative means the item got cheaper. Uses all points, so a single odd day doesn't skew it. The % is relative to the average price."
        >
          <span class="stat-value" :class="changeClass">{{ fmtChange(stats.totalChange) }}</span>
          <span class="stat-label">
            trend / {{ stats.spanDays }}d
            <template v-if="stats.pctChange != null">· {{ fmtPct(stats.pctChange) }}</template>
          </span>
        </div>
        <div v-if="outlierStat" class="stat-module outlier-module">
          <span class="stat-value outlier">{{ outlierStat.count }}</span>
          <span class="stat-label">outliers · {{ fmtPct(outlierStat.pct) }}</span>
        </div>
        <div class="stat-module muted-module">
          <span class="stat-value">{{ stats.count }}</span>
          <span class="stat-label">
            {{ hideOutliers ? 'shown' : 'offers' }} · {{ stats.spanDays }}d
          </span>
        </div>

        <!-- how outliers are defined -->
        <p class="outlier-note">
          <strong>Outliers</strong> are offers beyond the Tukey fences — below
          <em>Q1 − 1.5×IQR</em> or above <em>Q3 + 1.5×IQR</em>.
          <span class="swatch swatch--low"></span> unusually cheap ·
          <span class="swatch swatch--high"></span> unusually dear ·
          <span class="swatch swatch--normal"></span> within range.
        </p>
      </aside>

      <!-- Chart box -->
      <div class="dashboard-card">
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
              :loading="termsLoading"
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

        <!-- Overlays / outliers -->
        <div class="filter-item">
          <label>Overlays</label>
          <div class="toggle-row">
            <ToggleButton v-model="showIqr" onLabel="IQR shown" offLabel="Show IQR" class="ov-toggle" />
            <ToggleButton
              v-model="hideOutliers"
              onLabel="Outliers hidden"
              offLabel="Hide outliers"
              :disabled="!outlierStat"
              class="ov-toggle"
            />
          </div>
        </div>
      </div>

        <!-- Chart -->
        <div class="chart-container">
          <v-chart v-if="hasData" :option="option" autoresize @click="onChartClick" />
          <div v-else-if="dataLoading" class="empty-state">
            <i class="pi pi-spin pi-spinner" />
            <p>Loading…</p>
          </div>
          <div v-else class="empty-state">
            <i class="pi pi-chart-scatter" />
            <p>{{ emptyMessage }}</p>
          </div>
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
import ToggleButton from 'primevue/togglebutton'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { ScatterChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
} from 'echarts/components'
import { useSidebarStore } from '@/stores/sidebar'
import { useDashboardData } from '@/stores/dashboardData'

use([
  CanvasRenderer,
  ScatterChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  TitleComponent,
  LegendComponent,
  DataZoomComponent,
  MarkAreaComponent,
  MarkLineComponent,
])

/* ----------------------------------------------------------------  stores  */
const sidebar = useSidebarStore()
const dashboardData = useDashboardData()

onMounted(() => sidebar.fetchFolders())

/* ----------------------------------------------------- folder / file scope */
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

// File ids the queries are restricted to: null = unrestricted (no folder/file
// picked), [] = restricted to nothing (folder picked has zero files), [...]
// = restricted to exactly these. This goes straight to the RPCs as
// `p_file_ids`, which do the folder/file <-> search-term matching as a real
// SQL join against scrape_jobs — no more client-side Map lookups to drift
// out of sync with the DB.
const scopeFileIds = computed(() => {
  if (selectedFiles.value.length) return selectedFiles.value
  if (selectedFolders.value.length) {
    return sidebar.folders
      .filter((f) => selectedFolders.value.includes(f.id))
      .flatMap((f) => (f.files ?? []).map((file) => file.id))
  }
  return null
})

/* ------------------------------------------------------ term selector  --- */
const ALL_TERMS = '__ALL_TERMS__'
const termOptions = ref([])
const termsLoading = ref(false)

let termsToken = 0
async function loadTerms() {
  const token = ++termsToken
  termsLoading.value = true
  try {
    const terms = await dashboardData.fetchTerms(scopeFileIds.value)
    if (token !== termsToken) return
    const opts = terms
      .sort((a, b) => b.count - a.count)
      .map((t) => ({ label: `${t.term} (${t.count})`, value: t.term }))
    termOptions.value = opts.length > 1 ? [{ label: 'All search terms', value: ALL_TERMS }, ...opts] : opts
  } catch (err) {
    console.error('[Dashboard] loadTerms error:', err)
    if (token === termsToken) termOptions.value = []
  } finally {
    if (token === termsToken) termsLoading.value = false
  }
}
watch(scopeFileIds, loadTerms, { immediate: true })

const selectedTerm = ref(null)
watch(termOptions, (opts) => {
  if (!opts.some((o) => o.value === selectedTerm.value)) {
    selectedTerm.value = opts.length ? opts[0].value : null
  }
})

// 'item'    -> a single search term is chosen: query & plot its raw listings.
// 'perItem' -> file(s) chosen, no single term: server-grouped avg/day per item.
// 'perFile' -> only folder(s) (or nothing) chosen: server-grouped avg/day per file.
const viewMode = computed(() => {
  if (selectedTerm.value && selectedTerm.value !== ALL_TERMS) return 'item'
  if (selectedFiles.value.length) return 'perItem'
  return 'perFile'
})

/* ---------------------------------------------------------- time range  --- */
const timeRangeOptions = [
  { label: '7D', value: 7 },
  { label: '30D', value: 30 },
  { label: '90D', value: 90 },
  { label: '1Y', value: 365 },
  { label: 'All', value: null },
]
const timeRange = ref(null)
const sinceIso = computed(() =>
  timeRange.value ? new Date(Date.now() - timeRange.value * 24 * 60 * 60 * 1000).toISOString() : null,
)

/* ---------------------------- IQR fences + outliers (Tukey 1.5×IQR) ----- */
const hideOutliers = ref(false)
const showIqr = ref(false)

/* ------------------------------------------------- server-backed data  --- */
// raw listings (item mode) or day-grouped averages (perFile/perItem mode),
// plus the summary stats — all fetched fresh whenever the scope changes.
const itemRows = ref([])
const aggGroups = ref([]) // [{ key, name, points: [...], totalCount }]
const statsData = ref(null)
const dataLoading = ref(false)
const dataError = ref(null)

// flatten day-grouped points into per-key groups, sorted by total offers
function groupPoints(points) {
  const map = new Map()
  for (const p of points) {
    if (!map.has(p.key)) map.set(p.key, { key: p.key, name: p.name, points: [], totalCount: 0 })
    const g = map.get(p.key)
    g.points.push(p)
    g.totalCount += p.count
  }
  return [...map.values()].sort((a, b) => b.totalCount - a.totalCount)
}

let reloadToken = 0
async function reload() {
  const token = ++reloadToken
  dataLoading.value = true
  dataError.value = null
  try {
    if (viewMode.value === 'item') {
      const term = selectedTerm.value
      const [rows, stats] = await Promise.all([
        dashboardData.fetchTermRows(term, sinceIso.value),
        dashboardData.fetchStats({ term, sinceIso: sinceIso.value, excludeOutliers: hideOutliers.value }),
      ])
      if (token !== reloadToken) return
      itemRows.value = rows
      statsData.value = stats
      aggGroups.value = []
    } else {
      const fetchAgg =
        viewMode.value === 'perFile'
          ? dashboardData.fetchAggByFile.bind(dashboardData)
          : dashboardData.fetchAggByTerm.bind(dashboardData)
      const [points, stats] = await Promise.all([
        fetchAgg(scopeFileIds.value, sinceIso.value, hideOutliers.value),
        dashboardData.fetchStats({
          fileIds: scopeFileIds.value,
          sinceIso: sinceIso.value,
          excludeOutliers: hideOutliers.value,
        }),
      ])
      if (token !== reloadToken) return
      aggGroups.value = groupPoints(points)
      statsData.value = stats
      itemRows.value = []
    }
  } catch (err) {
    console.error('[Dashboard] reload error:', err)
    if (token === reloadToken) {
      dataError.value = err.message ?? 'Failed to load dashboard data.'
      itemRows.value = []
      aggGroups.value = []
      statsData.value = null
    }
  } finally {
    if (token === reloadToken) dataLoading.value = false
  }
}
watch([viewMode, selectedTerm, scopeFileIds, sinceIso, hideOutliers], reload, { immediate: true })

// outliers were server-excluded from itemRows only when fetched that way —
// they weren't, so filter client-side using the stable (pre-exclusion) fences
const displayItemRows = computed(() => {
  const lower = statsData.value?.fenceLower
  const upper = statsData.value?.fenceUpper
  if (!hideOutliers.value || lower == null || upper == null) return itemRows.value
  return itemRows.value.filter((r) => r.price >= lower && r.price <= upper)
})

/* -------------------------------------------------------------- stats  --- */
const fmtPrice = (v) => (typeof v === 'number' ? `${v.toFixed(0)}€` : '—')
const fmtChange = (v) => {
  if (typeof v !== 'number') return '—'
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}${Math.abs(v).toFixed(0)}€`
}
const fmtPct = (v) => {
  if (typeof v !== 'number') return '—'
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}${Math.abs(v).toFixed(1)}%`
}
// falling price = good (green), rising price = bad (red); no change = neutral
const changeClass = computed(() => {
  const v = stats.value?.totalChange
  if (typeof v !== 'number' || v === 0) return ''
  return v < 0 ? 'stat-value--good' : 'stat-value--bad'
})

const stats = computed(() => statsData.value)

// share of the (pre-hide) population flagged as outliers
const outlierStat = computed(() => {
  const s = statsData.value
  if (!s || !s.outlierCount) return null
  return { count: s.outlierCount, pct: (s.outlierCount / s.rawCount) * 100 }
})

/* ------------------------------------------------------ chart options  --- */
const primaryColor = 'rgb(249, 115, 22)'
// categorical slots (light-mode, all-pairs-validated first 4 — dataviz skill default palette)
const CATEGORY_COLORS = ['#2a78d6', '#008300', '#e87ba4', '#eda100']
const OTHER_COLOR = '#9ca3af'
// IQR overlay shares the orange brand ramp
const IQR_LINE = 'rgba(234, 88, 12, 0.9)' // orange-600, median line
const IQR_EDGE = 'rgba(249, 115, 22, 0.45)' // quartile edges / fences
const IQR_FILL = 'rgba(249, 115, 22, 0.12)' // Q1–Q3 band
const OUTLIER_COLOR = '#b91c1c' // deep red, outlier-count label
// circle fill by IQR zone
const ZONE_NORMAL = 'rgba(171, 176, 184, 0.26)' // light, desaturated gray — within range
const ZONE_HIGH = 'rgba(249, 115, 22, 0.55)' // brand orange — dear outliers
const ZONE_LOW = 'rgba(30, 143, 110, 0.55)' // sensors green (#1e8f6e) — cheap outliers

const hasData = computed(() => {
  if (viewMode.value === 'item') return displayItemRows.value.length > 0
  return aggGroups.value.length > 0
})
const emptyMessage = computed(() => {
  if (dataError.value) return dataError.value
  if (!termOptions.value.length) return 'No products match the selected folders / files.'
  if (viewMode.value === 'item' && !selectedTerm.value)
    return 'Pick a search term to see its price spread.'
  return 'No offers in the selected time range.'
})

const makeItem = (r) => [r.date_inserted, r.price, r]
const makeAggItem = (p) => [p.date, p.avgPrice, p]

// Clicking a circle either opens the listing (raw item view) or drills one
// level deeper into the folder->file->item hierarchy (aggregate views).
const onChartClick = (params) => {
  const d = params?.data?.[2]
  if (!d) return
  if (viewMode.value === 'item') {
    if (d.url) window.open(d.url, '_blank', 'noopener')
    return
  }
  if (viewMode.value === 'perFile') {
    selectedFiles.value = [d.key]
    return
  }
  if (viewMode.value === 'perItem') {
    selectedTerm.value = d.key
  }
}

const tooltipFmt = (p) => {
  const d = p.data[2]
  if (viewMode.value === 'item') {
    return `
      <strong>${d.title}</strong><br/>
      Price: ${d.price}€<br/>
      Date:  ${new Date(d.date_inserted).toLocaleDateString()}<br/>
      Source: ${d.source}<br/>
      <span style="opacity:.7;font-style:italic;">Click to open listing ↗</span>
    `
  }
  const noun = viewMode.value === 'perFile' ? 'file' : 'item'
  return `
    <strong>${d.name}</strong><br/>
    Avg price: ${fmtPrice(d.avgPrice)}<br/>
    Date: ${new Date(d.date).toLocaleDateString()}<br/>
    ${d.count} offer${d.count === 1 ? '' : 's'}<br/>
    <span style="opacity:.7;font-style:italic;">Click to drill into this ${noun}</span>
  `
}

const option = computed(() => {
  let series = []

  if (viewMode.value === 'item') {
    const rows = displayItemRows.value
    const lower = stats.value?.fenceLower
    const upper = stats.value?.fenceUpper
    const isHigh = (r) => upper != null && r.price > upper
    const isLow = (r) => lower != null && r.price < lower

    let minRow = null
    for (const r of rows) if (!minRow || r.price < minRow.price) minRow = r
    const base = minRow ? rows.filter((r) => r.id !== minRow.id) : rows

    // one circle style, split into three same-shape series coloured by IQR zone
    series = [
      {
        name: 'Within range',
        type: 'scatter',
        data: base.filter((r) => !isHigh(r) && !isLow(r)).map(makeItem),
        symbolSize: 40,
        symbol: 'circle',
        itemStyle: { color: ZONE_NORMAL, borderWidth: 0 },
      },
    ]
    const lows = base.filter(isLow)
    if (lows.length) {
      series.push({
        name: 'Cheap outlier',
        type: 'scatter',
        data: lows.map(makeItem),
        symbolSize: 40,
        symbol: 'circle',
        itemStyle: { color: ZONE_LOW, borderWidth: 0 },
      })
    }
    const highs = base.filter(isHigh)
    if (highs.length) {
      series.push({
        name: 'Dear outlier',
        type: 'scatter',
        data: highs.map(makeItem),
        symbolSize: 40,
        symbol: 'circle',
        itemStyle: { color: ZONE_HIGH, borderWidth: 0 },
      })
    }
    if (minRow) {
      series.push({
        name: 'Min price',
        type: 'scatter',
        data: [minRow].map(makeItem),
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
  } else {
    // Aggregate views: first 4 groups (by offer count) get a distinct
    // categorical color + legend entry; the rest fold into a muted "Other"
    // series so the legend/color count stays readable (dataviz: past 4
    // categorical slots, fold to "Other" rather than cycling hues).
    const groups = aggGroups.value
    const featured = groups.slice(0, CATEGORY_COLORS.length)
    const rest = groups.slice(CATEGORY_COLORS.length)

    series = featured.map((g, i) => ({
      name: g.name,
      type: 'scatter',
      data: g.points.map(makeAggItem),
      symbolSize: 22,
      itemStyle: { color: CATEGORY_COLORS[i], opacity: 0.75 },
    }))

    if (rest.length) {
      series.push({
        name: `Other (${rest.length})`,
        type: 'scatter',
        data: rest.flatMap((g) => g.points.map(makeAggItem)),
        symbolSize: 18,
        itemStyle: { color: OTHER_COLOR, opacity: 0.6 },
      })
    }
  }

  // real, legend-worthy series (the overlay below is added on top of these)
  const legendNames = series.map((s) => s.name).filter(Boolean)

  if (showIqr.value && stats.value) {
    const s = stats.value

    // x-span of the current plot so the horizontal overlay lines run full width
    const times =
      viewMode.value === 'item'
        ? displayItemRows.value.map((r) => new Date(r.date_inserted).getTime())
        : aggGroups.value.flatMap((g) => g.points.map((p) => new Date(p.date).getTime()))

    if (times.length) {
      const x0 = Math.min(...times) - 24 * 60 * 60 * 1000
      const x1 = Math.max(...times)

      // Each overlay line is its OWN line series at a high z. Real series honour
      // z-order over scatter points (markArea/markLine do not), so these — plus
      // the band fill (an areaStyle anchored to Q1) and the end labels — reliably
      // sit ABOVE the circles. `verticalAlign: bottom` lifts each label just
      // above its line so the line doesn't strike through the text.
      const hLine = (y, style, labelText, labelColor, extra = {}) => ({
        type: 'line',
        data: [
          [x0, y],
          [x1, y],
        ],
        showSymbol: false,
        silent: true,
        z: 30,
        lineStyle: style,
        endLabel: {
          show: !!labelText,
          formatter: labelText,
          color: labelColor,
          fontSize: 13,
          fontWeight: 700,
          align: 'right',
          verticalAlign: 'bottom',
          offset: [-6, -5],
        },
        tooltip: { show: false },
        ...extra,
      })

      series.push(
        // Q3 edge carries the shaded band down to Q1 (fill rides on top too)
        hLine(s.q3, { color: IQR_EDGE, type: 'dashed', width: 2 }, `IQR ${fmtPrice(s.q1)}–${fmtPrice(s.q3)}`, IQR_LINE, {
          areaStyle: { color: IQR_FILL, origin: s.q1 },
        }),
        hLine(s.q1, { color: IQR_EDGE, type: 'dashed', width: 2 }, '', IQR_LINE),
        hLine(s.median, { color: IQR_LINE, type: 'solid', width: 3 }, `median ${fmtPrice(s.median)}`, IQR_LINE),
      )
      if (!hideOutliers.value && s.fenceLower != null && s.fenceUpper != null) {
        series.push(
          hLine(s.fenceUpper, { color: IQR_EDGE, type: 'dotted', width: 4 }, '', OUTLIER_COLOR),
          hLine(s.fenceLower, { color: IQR_EDGE, type: 'dotted', width: 4 }, '', OUTLIER_COLOR),
        )
      }
    }
  }

  return {
    grid: { top: 56, bottom: 80, left: 64, right: 32 },
    legend: {
      top: 4,
      type: 'scroll',
      show: legendNames.length > 1,
      data: legendNames,
      textStyle: { fontSize: 11, color: '#4b5563' },
    },
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
      axisLabel: { formatter: '{value}€' },
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
  /* keep the chart at its original ~1400px and widen the page by the
     stats panel (13rem) + gap (1.5rem) so the cards sit alongside it
     instead of eating into the chart's width */
  max-width: calc(1400px + 14.5rem);
  margin: 2rem auto;
  padding: 0 1.5rem;
}

/* page header (outside the chart box) */
.page-header {
  margin-bottom: 1.25rem;
}
.page-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 700;
  color: #1f2937;
}
.page-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: #6b7280;
  max-width: 32rem;
}

/* body: stats panel (left, outside box) + chart card (right) */
.dashboard-body {
  display: flex;
  gap: 1.5rem;
  align-items: stretch;
}

.dashboard-card {
  flex: 1 1 auto;
  min-width: 0;
  background: #fff;
  border: 1px solid #eef2f7;
  border-radius: 0.75rem;
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.08);
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* stats side panel (left of chart, outside the box) */
.stats-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 13rem;
  flex: 0 0 13rem;
}
.stat-module {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 1.15rem;
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 0.75rem;
}
.stat-module[title] {
  cursor: help;
}
.stat-module.accent-module {
  background: #fff7ed;
  border-color: #fed7aa;
}
.stat-module.muted-module {
  background: transparent;
  border-style: dashed;
}
.stat-module.outlier-module {
  background: #fef2f2;
  border-color: #fecaca;
}
.stat-value.outlier {
  color: #b91c1c;
}
.stat-value {
  font-size: 1.625rem;
  font-weight: 700;
  color: #1f2937;
  line-height: 1.15;
}
.stat-value.accent {
  color: rgb(249, 115, 22);
}
.stat-value--good {
  color: #006300;
}
.stat-value--bad {
  color: #d03b3b;
}
.stat-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #9ca3af;
}

/* outlier definition note */
.outlier-note {
  margin: 0.25rem 0 0;
  font-size: 0.6875rem;
  line-height: 1.5;
  color: #9ca3af;
}
.outlier-note strong {
  color: #6b7280;
}
.outlier-note em {
  font-style: normal;
  font-weight: 600;
  color: #6b7280;
}
.swatch {
  display: inline-block;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  vertical-align: middle;
}
.swatch--normal {
  background: rgba(171, 176, 184, 0.6);
}
.swatch--high {
  background: rgba(249, 115, 22, 0.85);
}
.swatch--low {
  background: rgba(30, 143, 110, 0.85);
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
.toggle-row {
  display: flex;
  gap: 0.5rem;
}
.toggle-row :deep(.ov-toggle) {
  white-space: nowrap;
}

/* chart */
.chart-container {
  flex: 1 1 auto;
  min-width: 0;
  height: 65vh;
  min-height: 26rem;
}
.chart-container :deep(.echarts-for-vue),
.chart-container :deep(canvas) {
  width: 100% !important;
  height: 100% !important;
}

/* stack the stats above the chart on narrow screens */
@media (max-width: 48rem) {
  .dashboard-body {
    flex-direction: column;
  }
  .stats-panel {
    width: 100%;
    flex: 0 0 auto;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .stats-panel .stat-module {
    flex: 1 1 6rem;
  }
  .outlier-note {
    flex: 1 1 100%;
  }
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
