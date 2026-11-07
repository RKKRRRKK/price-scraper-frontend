<template>
  <div class="zones">
    <template v-if="total">
      <div class="zones-head">
        <span class="hx-stat-label">Time in zone</span>
        <span class="recorded">{{ fmt.duration(total / MIN) }} recorded · max HR {{ store.settings.maxHr }}</span>
      </div>

      <div class="mix">
        <span
          v-for="z in present"
          :key="z.key"
          :style="{ flexGrow: z.ms, background: z.color }"
          :title="`${z.label} ${pct(z.ms / total)}`"
        />
      </div>

      <!-- Empty zones keep readable labels; their swatch goes hollow instead. -->
      <ul class="rows">
        <li v-for="z in ladder" :key="z.key" :class="{ dim: !z.ms }">
          <i
            class="sw"
            :style="z.ms
              ? { background: z.color, boxShadow: `0 0 0 0.125rem ${alpha(z.color, 0.18)}` }
              : { boxShadow: `inset 0 0 0 1.5px ${alpha(z.color, 0.75)}` }"
          />
          <span class="name">{{ z.label }}</span>
          <span class="range">{{ z.range }}<small>bpm</small></span>
          <span class="track">
            <b :style="{ width: `${(z.ms / total) * 100}%`, background: `linear-gradient(90deg, ${alpha(z.color, 0.3)}, ${z.color})` }" />
          </span>
          <span class="dur">{{ z.ms ? fmt.duration(z.ms / MIN) : '–' }}</span>
          <span class="pct">{{ pct(z.ms / total) }}</span>
        </li>
      </ul>

      <div ref="histBox" class="hist" @mouseleave="hover = null">
        <svg v-if="hist" :width="hsize.w" :height="hsize.h" @mousemove="onMove">
          <defs>
            <linearGradient v-for="z in bounds" :id="`${uid}-${z.key}`" :key="z.key" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" :stop-color="z.color" stop-opacity="0.9" />
              <stop offset="1" :stop-color="z.color" stop-opacity="0.2" />
            </linearGradient>
          </defs>
          <line :x1="0" :x2="hsize.w" :y1="hist.baseY + 0.5" :y2="hist.baseY + 0.5" class="base" />
          <rect
            v-for="s in hist.ruler"
            :key="s.key"
            :x="s.x"
            :y="hist.baseY + 3"
            :width="s.w"
            height="2.5"
            rx="1.25"
            :fill="s.color"
            opacity="0.85"
          />
          <path
            v-for="b in hist.bars"
            :key="b.i"
            :d="b.d"
            :fill="hover === b ? b.zone.color : `url(#${uid}-${b.zone.key})`"
            :class="{ on: hover === b, off: hover && hover !== b }"
          />
          <line :x1="hist.avgX" :x2="hist.avgX" :y1="hist.padT - 2" :y2="hist.baseY" class="avg" />
          <text v-for="t in hist.ticks" :key="t.v" :x="t.x" :y="hist.baseY + 17" class="tick">{{ t.v }}</text>
        </svg>
        <div v-if="hist" class="avg-chip" :style="{ left: `${hist.avgX}px`, top: `${hist.padT - 4}px` }">
          avg {{ Math.round(hist.avg) }}
        </div>
        <div v-if="hover && hist" class="tip" :style="{ left: `${hover.x + hover.w / 2}px`, top: `${hover.y - 6}px` }">
          <b :style="{ color: `color-mix(in srgb, ${hover.zone.color} 70%, var(--hx-text))` }">{{ hover.from }}–{{ hover.to - 1 }} bpm</b>
          {{ fmt.duration(hover.ms / MIN) }} · {{ hover.zone.label }}
        </div>
      </div>
    </template>
    <div v-else class="hx-empty">No heart-rate readings in this window.</div>
  </div>
</template>

<script setup>
// Time in each heart-rate zone for the minute-detail window, and how the
// readings spread across bpm (a hand-drawn SVG histogram, bars in zone colours).
import { ref, shallowRef, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { alpha, zoneBounds, zoneOf, fmt } from '@/lib/health/theme'
import { useHealthStore } from '@/stores/health'

const store = useHealthStore()

const MIN = 60e3
const CAP = 3 * MIN      // a reading counts until the next one, at most this long
const uid = `hz${Math.random().toString(36).slice(2, 8)}`

const bounds = computed(() => zoneBounds(store.settings.maxHr))

// [bpm, ms it stands for] for every reading in the window.
const samples = computed(() => {
  const { start, end } = store.detailRange
  const pts = store.detail.hr.filter(([t]) => t >= start && t <= end)
  return pts.map(([t, v], i) => [v, i + 1 < pts.length ? Math.min(pts[i + 1][0] - t, CAP) : MIN])
})

function zoneIndex(v) {
  const z = bounds.value
  for (let i = z.length - 1; i >= 0; i--) if (v >= z[i].lo) return i
  return 0
}

const zones = computed(() => {
  const ms = bounds.value.map(() => 0)
  for (const [v, d] of samples.value) ms[zoneIndex(v)] += d
  return bounds.value.map((z, i) => ({
    ...z,
    ms: ms[i],
    range: z.lo === 0 ? `< ${z.hi}` : z.hi === Infinity ? `${z.lo}+` : `${z.lo}–${z.hi - 1}`,
  }))
})

const total = computed(() => zones.value.reduce((a, z) => a + z.ms, 0))
const present = computed(() => zones.value.filter((z) => z.ms > 0))
const ladder = computed(() => [...zones.value].reverse())

function pct(share) {
  if (!share) return '–'
  if (share < 0.005) return '<1%'
  return `${Math.round(share * 100)}%`
}

// ── Histogram ──
const histBox = ref(null)
const hsize = ref({ w: 0, h: 0 })
const hover = shallowRef(null)   // the raw bar object, so `hover === b` matches in the template
let observer = null

watch(
  histBox,
  async (el) => {
    observer?.disconnect()
    if (!el) return
    await nextTick()
    observer = new ResizeObserver(([entry]) => {
      hsize.value = { w: entry.contentRect.width, h: entry.contentRect.height }
    })
    observer.observe(el)
  },
  { flush: 'post' },
)
onBeforeUnmount(() => observer?.disconnect())

// Rounded-top bar path.
function barPath(x, y, w, h) {
  const r = Math.min(2, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

const hist = computed(() => {
  const { w, h } = hsize.value
  const pts = samples.value
  if (!pts.length || w < 60 || h < 56) return null

  let lo = Infinity
  let hi = -Infinity
  let weighted = 0
  let weight = 0
  for (const [v, d] of pts) {
    if (v < lo) lo = v
    if (v > hi) hi = v
    weighted += v * d
    weight += d
  }
  const span = hi - lo
  const bin = span > 80 ? 5 : span > 40 ? 3 : 2
  const from = Math.floor(lo / bin) * bin
  const to = Math.floor(hi / bin) * bin + bin
  const mins = new Array(Math.round((to - from) / bin)).fill(0)
  for (const [v, d] of pts) mins[Math.min(Math.floor((v - from) / bin), mins.length - 1)] += d

  const padT = 22
  const padB = 22
  const padX = 2
  const baseY = h - padB
  const plotH = baseY - padT
  const xs = (v) => padX + ((v - from) / (to - from)) * (w - 2 * padX)
  const peak = Math.max(...mins)

  const bars = []
  mins.forEach((ms, i) => {
    if (!ms) return
    const x0 = xs(from + i * bin) + 0.75
    const x1 = xs(from + (i + 1) * bin) - 0.75
    const bh = Math.max((ms / peak) * plotH, 1.5)
    bars.push({
      i,
      x: x0,
      w: Math.max(x1 - x0, 1),
      y: baseY - bh,
      d: barPath(x0, baseY - bh, Math.max(x1 - x0, 1), bh),
      zone: zoneOf(from + i * bin + bin / 2, bounds.value),
      from: from + i * bin,
      to: from + (i + 1) * bin,
      ms,
    })
  })

  const ruler = bounds.value
    .map((z) => {
      const a = Math.max(z.lo, from)
      const b = Math.min(z.hi, to)
      return b > a ? { key: z.key, color: z.color, x: xs(a) + 0.5, w: Math.max(xs(b) - xs(a) - 1, 1) } : null
    })
    .filter(Boolean)

  const tickStep = to - from > 70 ? 20 : 10
  const ticks = []
  for (let v = Math.ceil(from / tickStep) * tickStep; v <= to; v += tickStep) {
    const x = xs(v)
    if (x > 10 && x < w - 10) ticks.push({ v, x })
  }

  return { bars, ruler, ticks, from, bin, baseY, padT, avg: weighted / weight, avgX: xs(weighted / weight), xs }
})

function onMove(e) {
  const H = hist.value
  if (!H) return
  const x = e.offsetX
  hover.value = H.bars.reduce((best, b) => {
    const d = Math.abs(b.x + b.w / 2 - x)
    return d < 14 && (!best || d < Math.abs(best.x + best.w / 2 - x)) ? b : best
  }, null)
}
</script>

<style scoped>
.zones {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.zones-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.375rem;
}

.recorded {
  font-size: 0.6875rem;
  color: var(--hx-text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mix {
  display: flex;
  gap: 2px;
  height: 0.375rem;
  margin-bottom: 0.5rem;
  border-radius: 999px;
  overflow: hidden;
  flex-shrink: 0;
}

.mix span {
  min-width: 2px;
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
  flex-shrink: 0;
}

.rows li {
  display: grid;
  grid-template-columns: 0.5rem 4.25rem 4.5rem minmax(2rem, 1fr) 3.5rem 2.25rem;
  align-items: center;
  gap: 0.5rem;
  height: 1.3125rem;
  padding: 0 0.25rem;
  font-size: 0.75rem;
  border-radius: 0.375rem;
  transition: background 0.15s, opacity 0.15s;
}

.rows li:hover {
  background: var(--hx-panel2);
}

.rows li.dim .name {
  font-weight: 500;
  color: var(--hx-text2);
}

.rows li.dim .dur,
.rows li.dim .pct {
  color: var(--hx-text3);
}

.sw {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 2px;
}

.name {
  font-weight: 600;
  color: var(--hx-text);
  white-space: nowrap;
}

.range {
  color: var(--hx-text3);
  white-space: nowrap;
}

.range small {
  margin-left: 0.1875rem;
  font-size: 0.625rem;
}

.track {
  position: relative;
  height: 0.3125rem;
  background: var(--hx-panel2);
  border-radius: 999px;
  overflow: hidden;
}

.track b {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
}

.dur {
  text-align: right;
  font-weight: 600;
  color: var(--hx-text);
  white-space: nowrap;
}

.pct {
  text-align: right;
  color: var(--hx-text2);
}

.hist {
  position: relative;
  flex: 1;
  min-height: 0;
  margin-top: 0.375rem;
}

.hist svg {
  position: absolute;
  inset: 0;
  display: block;
  overflow: visible;
}

.hist path {
  transition: opacity 0.15s;
}

.hist path.off {
  opacity: 0.45;
}

.base {
  stroke: var(--hx-axis);
  stroke-width: 1;
}

.avg {
  stroke: var(--hx-text2);
  stroke-width: 1;
  stroke-dasharray: 2 3;
  opacity: 0.8;
}

.tick {
  font-size: 0.625rem;
  fill: var(--hx-text3);
  text-anchor: middle;
}

.avg-chip {
  position: absolute;
  transform: translate(-50%, -100%);
  padding: 0.0625rem 0.375rem;
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--hx-text);
  white-space: nowrap;
  background: var(--hx-panel2);
  border: 1px solid var(--hx-border2);
  border-radius: 999px;
  pointer-events: none;
}

.tip {
  position: absolute;
  z-index: 2;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.375rem 0.5rem;
  font-size: 0.6875rem;
  color: var(--hx-text2);
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid var(--hx-border2);
  border-radius: 0.5rem;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  pointer-events: none;
}

.tip b {
  font-size: 0.75rem;
}
</style>
