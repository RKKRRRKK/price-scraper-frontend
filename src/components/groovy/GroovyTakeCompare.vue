<!-- File: src/components/groovy/GroovyTakeCompare.vue -->
<!--
  What a take actually told you, and how it stacks up against the others.

  Three views of the same hits, in order of how often they're worth looking at:

    Tiles      spread first. A consistent 20 ms behind the click is a feel; 20 ms
               of scatter either side of it is the thing to practise. The hero
               figure is the standard deviation, not the average.
    Histogram  the shape of the error. Small multiples rather than an overlay —
               overlaid distributions hide each other, and stacked rows on one
               shared axis compare honestly. Blue is early, red is late; the
               green band is the tolerance window.
    Positions  mean ±1 sd at each spot in the bar, which is where habits show up
               ("every 'a' drags"). Only drawn when the takes share a grid,
               because the fourth sixteenth of 4/4 is not the fourth eighth of
               6/8 and pretending otherwise would be a lie.

  The table under the charts is the same numbers in text — it is the readable
  twin for anything colour is carrying, and it is always on rather than hidden
  behind a toggle.
-->
<template>
  <div class="cmp">
    <div class="cmp-head">
      <div>
        <div class="eyebrow">{{ entries.length === 1 ? 'Take' : 'Comparing' }}</div>
        <h2 class="cmp-title">
          {{ entries.length === 1 ? entries[0].take.name : `${entries.length} takes` }}
        </h2>
      </div>
      <button v-if="entries.length" class="icon-btn" title="Clear selection" @click="$emit('clear')">
        <i class="pi pi-times"></i>
      </button>
    </div>

    <div v-if="!entries.length" class="cmp-empty">
      <i class="pi pi-chart-bar"></i>
      <span>Pick a take from the list to see how it went. Pick up to three to compare.</span>
    </div>

    <template v-else>
      <!-- Legend: always present once there is more than one series. -->
      <div v-if="entries.length > 1" class="legend">
        <span v-for="e in entries" :key="e.take.id" class="legend-item">
          <i class="sw" :style="{ background: e.color }"></i>{{ e.take.name }}
        </span>
      </div>

      <!-- ── Tiles ── -->
      <div class="tiles">
        <div v-for="e in entries" :key="e.take.id" class="tile">
          <div v-if="entries.length > 1" class="tile-who">
            <i class="sw" :style="{ background: e.color }"></i>{{ e.take.name }}
          </div>
          <div class="tile-hero">
            <span class="hero-num">{{ fmt(e.stats.sdMs) }}</span>
            <span class="hero-unit">ms spread</span>
          </div>
          <div class="tile-grade" :class="e.grade.tone">{{ e.grade.label }}</div>
          <dl class="tile-rows">
            <div>
              <dt>Feel</dt>
              <dd>
                {{ e.stats.meanMs > 0 ? '+' : '' }}{{ fmt(e.stats.meanMs) }} ms
                <span class="muted">{{ e.feel }}</span>
              </dd>
            </div>
            <div>
              <dt>In pocket</dt>
              <dd>{{ Math.round(e.stats.inPocketPct) }}% <span class="muted">±{{ e.tol }} ms</span></dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{{ e.stats.count }}</dd>
            </div>
            <div>
              <dt>Worst spot</dt>
              <dd v-if="e.stats.worst">
                beat {{ e.stats.worst.label }}
                <span class="muted"
                  >{{ e.stats.worst.meanMs > 0 ? '+' : '' }}{{ fmt(e.stats.worst.meanMs) }} ms</span
                >
              </dd>
              <dd v-else class="muted">not enough notes</dd>
            </div>
          </dl>
        </div>
      </div>

      <!-- ── Histogram, one row per take on a shared axis ── -->
      <section class="chart-block">
        <h3 class="chart-title">Where the notes landed</h3>
        <p class="chart-sub">
          Each bar is how many notes missed by that much. Left of centre is early, right is late;
          the green band is ±{{ entries[0].tol }} ms.
        </p>

        <div v-for="e in entries" :key="e.take.id" class="hist-row">
          <div v-if="entries.length > 1" class="hist-label">
            <i class="sw" :style="{ background: e.color }"></i>{{ e.take.name }}
          </div>
          <svg class="hist" :viewBox="`0 0 ${W} ${HIST_H}`" role="img"
               :aria-label="`Timing error distribution for ${e.take.name}`">
            <rect
              :x="xOf(-entries[0].tol)"
              y="0"
              :width="xOf(entries[0].tol) - xOf(-entries[0].tol)"
              :height="HIST_PLOT"
              fill="rgba(22,163,74,0.10)"
            />
            <line
              :x1="xOf(0)" y1="0" :x2="xOf(0)" :y2="HIST_PLOT"
              stroke="#c3c2b7" stroke-width="1"
            />
            <g v-for="(c, i) in e.hist.counts" :key="i">
              <rect
                v-if="c > 0"
                :x="xOf(e.hist.centres[i] - e.hist.binMs / 2) + 1"
                :y="HIST_PLOT - barH(c, e.hist.max)"
                :width="Math.max(1, (xOf(e.hist.binMs) - xOf(0)) - 2)"
                :height="barH(c, e.hist.max)"
                :fill="e.hist.centres[i] < 0 ? EARLY : LATE"
                rx="2"
              >
                <title>
                  {{ c }} {{ c === 1 ? 'note' : 'notes' }} at
                  {{ Math.round(e.hist.centres[i]) }} ms
                </title>
              </rect>
            </g>
            <line :x1="0" :y1="HIST_PLOT + 0.5" :x2="W" :y2="HIST_PLOT + 0.5"
                  stroke="#c3c2b7" stroke-width="1" />
            <g class="axis">
              <text v-for="t in axisTicks" :key="t" :x="xOf(t)" :y="HIST_PLOT + 13"
                    text-anchor="middle">
                {{ t > 0 ? '+' + t : t }}
              </text>
            </g>
          </svg>
        </div>
        <div class="axis-caption">milliseconds from the grid line</div>
      </section>

      <!-- ── Per-position ── -->
      <section class="chart-block">
        <h3 class="chart-title">Position in the bar</h3>
        <p class="chart-sub" v-if="sameGrid">
          Average error at each spot on the grid, with the bar showing one standard deviation
          either side. A dot well off the centre line is a habit, not an accident.
        </p>
        <p class="chart-sub warn" v-else>
          <i class="pi pi-info-circle"></i>
          These takes were played on different grids ({{ gridSummary }}), so position-by-position
          comparison would not mean anything. The spread and feel above still compare fine.
        </p>

        <svg v-if="sameGrid" class="pos" :viewBox="`0 0 ${W} ${POS_H}`" role="img"
             aria-label="Average timing error by position in the bar">
          <rect :x="0" :y="posY(tolCommon)" :width="W"
                :height="posY(-tolCommon) - posY(tolCommon)" fill="rgba(22,163,74,0.10)" />
          <line :x1="0" :y1="posY(0)" :x2="W" :y2="posY(0)" stroke="#c3c2b7" stroke-width="1" />

          <g v-for="(lbl, i) in slotLabels" :key="'g' + i">
            <line
              v-if="lbl.isPulse"
              :x1="slotX(i)" :y1="0" :x2="slotX(i)" :y2="POS_PLOT"
              stroke="#eeede9" stroke-width="1"
            />
            <text
              v-if="lbl.show"
              class="axis" :x="slotX(i)" :y="POS_PLOT + 13" text-anchor="middle"
              :font-weight="lbl.isPulse ? 700 : 400"
            >{{ lbl.text }}</text>
          </g>

          <g v-for="(e, ei) in entries" :key="e.take.id">
            <g v-for="b in e.stats.bySlot" :key="b.slotInBar">
              <template v-if="b.n">
                <line
                  :x1="slotX(b.slotInBar) + dodge(ei)" :y1="posY(clampMs(b.meanMs - b.sdMs))"
                  :x2="slotX(b.slotInBar) + dodge(ei)" :y2="posY(clampMs(b.meanMs + b.sdMs))"
                  :stroke="e.color" stroke-width="2" stroke-linecap="round" opacity="0.45"
                />
                <circle
                  :cx="slotX(b.slotInBar) + dodge(ei)" :cy="posY(clampMs(b.meanMs))" r="4.5"
                  fill="#fff"
                />
                <circle
                  :cx="slotX(b.slotInBar) + dodge(ei)" :cy="posY(clampMs(b.meanMs))" r="3"
                  :fill="e.color"
                >
                  <title>
                    {{ e.take.name }} · beat {{ b.label }} · {{ b.n }}
                    {{ b.n === 1 ? 'note' : 'notes' }} ·
                    {{ b.meanMs > 0 ? '+' : '' }}{{ fmt(b.meanMs) }} ms ± {{ fmt(b.sdMs) }}
                  </title>
                </circle>
              </template>
            </g>
            <!-- Direct-label the one position that matters for this take. -->
            <text
              v-if="e.stats.worst"
              class="pos-callout" :fill="e.color"
              :x="calloutX(e.stats.worst.slotInBar, ei)"
              :y="posY(clampMs(e.stats.worst.meanMs)) - 9"
              :text-anchor="calloutAnchor(e.stats.worst.slotInBar)"
            >{{ e.take.name }}</text>
          </g>

          <g class="axis">
            <text v-for="t in [-tolCommon * 2, 0, tolCommon * 2]" :key="'y' + t"
                  :x="W - 2" :y="posY(t) - 3" text-anchor="end">
              {{ t > 0 ? '+' + Math.round(t) : Math.round(t) }} ms
            </text>
          </g>
        </svg>
      </section>

      <!-- ── The same numbers, in text ── -->
      <section class="chart-block">
        <h3 class="chart-title">The numbers</h3>
        <div class="table-scroll">
          <table class="cmp-table">
            <thead>
              <tr>
                <th>Take</th>
                <th>When</th>
                <th>Grid</th>
                <th class="num">Notes</th>
                <th class="num">Spread</th>
                <th class="num">Feel</th>
                <th class="num">In pocket</th>
                <th>Worst spot</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in entries" :key="e.take.id">
                <th scope="row">
                  <i v-if="entries.length > 1" class="sw" :style="{ background: e.color }"></i>
                  {{ e.take.name }}
                </th>
                <td>{{ when(e.take.created_at) }}</td>
                <td>{{ gridOf(e.take) }}</td>
                <td class="num">{{ e.stats.count }}</td>
                <td class="num">{{ fmt(e.stats.sdMs) }} ms</td>
                <td class="num">{{ e.stats.meanMs > 0 ? '+' : '' }}{{ fmt(e.stats.meanMs) }} ms</td>
                <td class="num">{{ Math.round(e.stats.inPocketPct) }}%</td>
                <td>{{ e.stats.worst ? `beat ${e.stats.worst.label}` : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import dayjs from 'dayjs'
import { histogram, grade, feelLabel } from '@/lib/groovy/analysis'
import { meterById, subdivisionsFor } from '@/lib/groovy/grid'

const props = defineProps({
  // [{ slot, take } | null] — fixed slots, so a take keeps its colour when a
  // neighbour is deselected.
  slots: { type: Array, default: () => [] },
})
defineEmits(['clear'])

// Categorical slots 1–3 of the validated palette. Capped at three on purpose:
// this is an all-pairs chart (any two series can end up side by side), and
// three is as far as the palette clears the colourblind separation floor.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a']
const EARLY = '#2a78d6'
const LATE = '#e34948'

const W = 640
const HIST_PLOT = 78
const HIST_H = HIST_PLOT + 18
const POS_PLOT = 150
const POS_H = POS_PLOT + 18
const PAD_L = 8
const PAD_R = 44

const base = computed(() =>
  props.slots
    .map((s, i) => {
      if (!s?.take) return null
      const take = s.take
      const stats = take.stats || {}
      const devs = (take.hits || []).map((h) => h.devMs)
      const tol = stats.toleranceMs ?? take.settings?.toleranceMs ?? 25
      return {
        take,
        color: SERIES[i % SERIES.length],
        stats: {
          count: 0,
          meanMs: 0,
          sdMs: 0,
          inPocketPct: 0,
          bySlot: [],
          worst: null,
          ...stats,
        },
        devs,
        tol,
        grade: grade(stats.sdMs || 0),
        feel: feelLabel(stats.meanMs || 0, tol),
      }
    })
    .filter(Boolean),
)

// One shared x-range across every histogram row. Rows stacked on a shared axis
// only compare honestly if the axis really is shared.
const histRange = computed(() => {
  let r = 60
  for (const e of base.value) r = Math.max(r, histogram(e.devs).range)
  return r
})

const entries = computed(() =>
  base.value.map((e) => ({
    ...e,
    hist: histogram(e.devs, { minRange: histRange.value, maxRange: histRange.value }),
  })),
)

const axisTicks = computed(() => {
  const r = Math.round(histRange.value)
  const tol = Math.round(entries.value[0]?.tol ?? 25)
  return [-r, -tol, 0, tol, r]
})

function xOf(ms) {
  const r = histRange.value
  return PAD_L + ((ms + r) / (2 * r)) * (W - PAD_L - PAD_R)
}

function barH(count, max) {
  if (!max) return 0
  return Math.max(2, (count / max) * (HIST_PLOT - 6))
}

// ── Per-position ──
const sameGrid = computed(() => {
  if (entries.value.length < 2) return entries.value.length === 1
  const key = (e) => `${e.take.settings?.meterId}|${e.take.settings?.subdiv}`
  return entries.value.every((e) => key(e) === key(entries.value[0]))
})

const gridSummary = computed(() =>
  [...new Set(entries.value.map((e) => gridOf(e.take)))].join(' vs '),
)

const tolCommon = computed(() => entries.value[0]?.tol ?? 25)

const posRange = computed(() => {
  let m = tolCommon.value * 2
  for (const e of entries.value) {
    for (const b of e.stats.bySlot || []) {
      if (!b.n) continue
      m = Math.max(m, Math.abs(b.meanMs) + b.sdMs)
    }
  }
  return Math.min(200, Math.ceil(m / 10) * 10)
})

const slotCount = computed(() => entries.value[0]?.stats?.slotsPerBar || 8)

const slotLabels = computed(() => {
  const e = entries.value[0]
  const bySlot = e?.stats?.bySlot || []
  const dense = slotCount.value > 12
  return Array.from({ length: slotCount.value }, (_v, i) => {
    const b = bySlot[i]
    const isPulse = b ? b.isPulse : false
    return { text: b?.label ?? String(i + 1), isPulse, show: !dense || isPulse }
  })
})

function slotX(i) {
  const usable = W - PAD_L - PAD_R
  const step = usable / Math.max(1, slotCount.value)
  return PAD_L + step * (i + 0.5)
}

function posY(ms) {
  const r = posRange.value
  const clamped = Math.max(-r, Math.min(r, ms))
  return POS_PLOT / 2 - (clamped / r) * (POS_PLOT / 2 - 8)
}

function clampMs(ms) {
  const r = posRange.value
  return Math.max(-r, Math.min(r, ms))
}

function dodge(i) {
  const n = entries.value.length
  if (n < 2) return 0
  return (i - (n - 1) / 2) * 5
}

function calloutX(slot, ei) {
  const x = slotX(slot) + dodge(ei)
  return Math.max(PAD_L + 2, Math.min(W - PAD_R - 2, x))
}

function calloutAnchor(slot) {
  if (slot < slotCount.value * 0.15) return 'start'
  if (slot > slotCount.value * 0.85) return 'end'
  return 'middle'
}

// ── Formatting ──
function fmt(v) {
  return (Math.round((v || 0) * 10) / 10).toFixed(1)
}

function when(iso) {
  return dayjs(iso).format('D MMM, HH:mm')
}

function gridOf(take) {
  const s = take.settings || {}
  const meter = meterById(s.meterId || '4/4')
  const sub = subdivisionsFor(meter).find((o) => o.n === s.subdiv)
  return `${s.bpm ?? '?'} bpm · ${meter.label} · ${sub ? sub.label.toLowerCase() : 'grid'}`
}
</script>

<style scoped>
.cmp {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  overflow-y: auto;
  height: 100%;
}

.cmp-head {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

.eyebrow {
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--accent-500, #ef4444);
}

.cmp-title {
  margin: 0.1rem 0 0;
  font-size: 1.05rem;
  font-weight: 800;
  line-height: 1.2;
}

.icon-btn {
  margin-left: auto;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.45rem;
  display: grid;
  place-items: center;
  border: 1px solid var(--border, #e5e4e1);
  background: #fff;
  color: var(--text-faint, #9a9a9a);
  font-size: 0.75rem;
}

.icon-btn:hover {
  color: var(--text, #1a1a1a);
}

.cmp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  text-align: center;
  padding: 3rem 1.5rem;
  color: var(--text-faint, #9a9a9a);
  font-size: 0.82rem;
  line-height: 1.55;
}

.cmp-empty i {
  font-size: 1.75rem;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.legend-item,
.tile-who,
.hist-label {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-dim, #5c5c5c);
}

.sw {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 2px;
  display: inline-block;
  flex: none;
}

/* ── Tiles ── */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13.5rem, 1fr));
  gap: 0.65rem;
}

.tile {
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 0.7rem;
  padding: 0.75rem;
  background: var(--bg-card, #fff);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.tile-hero {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}

.hero-num {
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}

.hero-unit {
  font-size: 0.72rem;
  color: var(--text-faint, #9a9a9a);
}

.tile-grade {
  align-self: flex-start;
  font-size: 0.66rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
}

.tile-grade.good {
  background: var(--ok-soft, #dcfce7);
  color: var(--ok-ink, #166534);
}

.tile-grade.warn {
  background: var(--warn-soft, #fffbeb);
  color: #92400e;
}

.tile-grade.bad {
  background: var(--accent-050, #fef2f2);
  color: #991b1b;
}

.tile-rows {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.tile-rows > div {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.tile-rows dt {
  font-size: 0.7rem;
  color: var(--text-faint, #9a9a9a);
  min-width: 5rem;
}

.tile-rows dd {
  margin: 0;
  font-size: 0.74rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: var(--text-faint, #9a9a9a);
  font-weight: 400;
}

/* ── Charts ── */
.chart-block {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.chart-title {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 800;
}

.chart-sub {
  margin: 0 0 0.3rem;
  font-size: 0.7rem;
  line-height: 1.5;
  color: var(--text-faint, #9a9a9a);
}

.chart-sub.warn {
  display: flex;
  gap: 0.4rem;
  color: #92400e;
  background: var(--warn-soft, #fffbeb);
  border: 1px solid #fde68a;
  border-radius: 0.5rem;
  padding: 0.45rem 0.55rem;
}

.hist-row {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.hist,
.pos {
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}

.axis,
text.axis {
  font-size: 9px;
  fill: #898781;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.pos-callout {
  font-size: 9px;
  font-weight: 700;
  font-family: inherit;
}

.axis-caption {
  font-size: 0.64rem;
  color: var(--text-faint, #9a9a9a);
  text-align: center;
}

/* ── Table ── */
.table-scroll {
  overflow-x: auto;
}

.cmp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.72rem;
}

.cmp-table th,
.cmp-table td {
  text-align: left;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--border-soft, #eeede9);
  white-space: nowrap;
}

.cmp-table thead th {
  font-size: 0.64rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint, #9a9a9a);
  font-weight: 700;
}

.cmp-table tbody th {
  font-weight: 700;
}

.cmp-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
