<!-- File: src/components/groovy/GroovyTuner.vue -->
<!--
  A chromatic tuner on the same pitch tracker the roll uses, shown big in its
  own sheet: you tune before you play, so it is allowed to cover everything.

  The tracker reports ~35 times a second and wobbles by a few cents between
  reports, which is fine for drawing a note and useless for tuning one. So the
  needle shows the median of the last few readings, the run restarts whenever
  the pitch jumps (a new string, not drift), and the last reading stays up,
  dimmed, after the string stops — you read a tuner after plucking, not during.

  Two readouts of the same number, for two kinds of looking:
    the arc     where you are, coarse, in the pocket colours: green within ±5¢,
                yellow to ±15¢, red beyond
    the strobe  which way and how fast you are drifting, fine: it stands still
                only when the note is in tune, and drifts left when flat, right
                when sharp — the way a Peterson strobe does

  The string pills mark each open string once it has held within ±3¢ for half
  a second; click one to hear its reference pitch.
-->
<template>
  <div class="tu">
    <div v-if="!enabled" class="tu-off">
      <svg viewBox="0 0 48 48" class="tu-off-icon" aria-hidden="true">
        <path d="M6 30 A18 18 0 0 1 42 30" />
        <line x1="24" y1="30" x2="31" y2="16" />
        <circle cx="24" cy="30" r="2.5" />
      </svg>
      <p>The tuner listens to your input.</p>
      <button class="tu-enable" @click="$emit('enable')">
        <i class="pi pi-microphone"></i> Turn on the input
      </button>
    </div>

    <template v-else>
      <div class="tu-dial" :class="[zone, { stale: !shown || stale, locked }]">
        <svg viewBox="0 0 440 290" aria-hidden="true">
          <defs>
            <filter id="tu-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
          </defs>
          <path class="arc-base" :d="arc(-60, 60)" />
          <path class="arc-edge" :d="arc(-18, 18)" />
          <path class="arc-in" :d="arc(-6, 6)" />
          <path v-if="locked" class="arc-in glow" :d="arc(-6, 6)" filter="url(#tu-glow)" />

          <line
            v-for="t in TICKS"
            :key="t.c"
            :class="['tick', { major: t.major }]"
            :x1="pt(t.deg, 192).x"
            :y1="pt(t.deg, 192).y"
            :x2="pt(t.deg, t.major ? 208 : 201).x"
            :y2="pt(t.deg, t.major ? 208 : 201).y"
          />
          <text
            v-for="l in LABELS"
            :key="l.c"
            class="tick-label"
            :x="pt(l.deg, 226).x"
            :y="pt(l.deg, 226).y"
          >
            {{ l.text }}
          </text>

          <g v-if="shown" class="needle" :style="{ transform: `rotate(${deg}deg)` }">
            <line :x1="CX" :y1="CY - 112" :x2="CX" :y2="CY - 178" />
            <circle :cx="CX" :cy="CY - 182" r="7" />
          </g>

          <text class="note" :x="CX" :y="CY - 18">
            <template v-if="shown">
              <tspan class="nm">{{ name }}</tspan>
              <tspan class="oct" dx="3">{{ octave }}</tspan>
            </template>
            <template v-else>–</template>
          </text>
        </svg>
      </div>

      <div class="tu-read" :class="zone">
        <template v-if="shown">
          <span class="tu-cents">{{ cents > 0 ? '+' : '' }}{{ cents }}<small>¢</small></span>
          <span class="tu-hz">{{ shown.freq.toFixed(2) }} Hz</span>
          <span class="tu-hint">
            <template v-if="Math.abs(cents) <= 3"><i class="pi pi-check"></i> In tune</template>
            <template v-else-if="cents < 0"><i class="pi pi-arrow-up"></i> Tune up</template>
            <template v-else><i class="pi pi-arrow-down"></i> Tune down</template>
          </span>
        </template>
        <span v-else class="tu-hz">Play one open string.</span>
      </div>

      <div class="strobe" :class="[zone, { still: !shown || stale }]" aria-hidden="true">
        <div ref="strobeEl" class="strobe-bands"></div>
        <span class="strobe-mid"></span>
      </div>

      <div class="tu-foot">
        <div class="strings">
          <button
            v-for="s in strings"
            :key="s"
            class="str"
            :class="{ active: activeString === s, done: tuned.includes(s) }"
            :title="`Hear ${stringName(s, null)}${octaveOf(s)}`"
            @click="$emit('reference', s)"
          >
            <span class="str-name"
              >{{ stringName(s, null) }}<sub>{{ octaveOf(s) }}</sub></span
            >
            <i class="pi" :class="tuned.includes(s) ? 'pi-check' : 'pi-volume-up'"></i>
          </button>
        </div>

        <div class="ref">
          <span>A4</span>
          <button
            title="Lower the reference"
            :disabled="refHz <= 415"
            @click="$emit('set-ref', refHz - 1)"
          >
            <i class="pi pi-minus"></i>
          </button>
          <b>{{ refHz }}</b>
          <button
            title="Raise the reference"
            :disabled="refHz >= 466"
            @click="$emit('set-ref', refHz + 1)"
          >
            <i class="pi pi-plus"></i>
          </button>
          <span>Hz</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { median } from '@/lib/groovy/analysis'
import { stringName } from '@/lib/groovy/scales'

const props = defineProps({
  // The tracker's latest { midiFloat, clarity, ... }, or null on silence.
  reading: { type: Object, default: null },
  enabled: { type: Boolean, default: false },
  // Open-string MIDI notes of the chosen instrument, low to high.
  strings: { type: Array, default: () => [] },
  refHz: { type: Number, default: 440 },
})
defineEmits(['enable', 'reference', 'set-ref'])

// ── Dial geometry ───────────────────────────────────────────────────────────
// ±50¢ spans ±60° of arc, so ±5¢ is ±6° and ±15¢ is ±18°.
const CX = 220
const CY = 262
const R = 180

function pt(deg, r) {
  const a = (deg * Math.PI) / 180
  return { x: +(CX + r * Math.sin(a)).toFixed(2), y: +(CY - r * Math.cos(a)).toFixed(2) }
}

function arc(d0, d1, r = R) {
  const a = pt(d0, r)
  const b = pt(d1, r)
  return `M${a.x} ${a.y} A${r} ${r} 0 0 1 ${b.x} ${b.y}`
}

const TICKS = Array.from({ length: 21 }, (_, i) => {
  const c = -50 + i * 5
  return { c, deg: (c / 50) * 60, major: c % 25 === 0 }
})
const LABELS = [-50, -25, 0, 25, 50].map((c) => ({
  c,
  deg: (c / 50) * 60,
  text: c > 0 ? `+${c}` : String(c),
}))

// ── Reading ─────────────────────────────────────────────────────────────────
const shown = ref(null)
const stale = ref(false)
let recent = []
let staleTimer = 0

watch(
  () => props.reading,
  (r) => {
    if (!r) return
    if (recent.length && Math.abs(r.midiFloat - recent[recent.length - 1]) > 0.5) recent = []
    recent.push(r.midiFloat)
    if (recent.length > 6) recent.shift()
    const m = median(recent)
    shown.value = { midiFloat: m, freq: 440 * Math.pow(2, (m - 69) / 12) }
    stale.value = false
    clearTimeout(staleTimer)
    staleTimer = setTimeout(() => {
      stale.value = true
      recent = []
    }, 1200)
  },
)

// The tracker speaks A440; a different reference just moves where "in tune" is.
const adj = computed(() =>
  shown.value ? shown.value.midiFloat - 12 * Math.log2(props.refHz / 440) : null,
)
const midi = computed(() => (adj.value == null ? null : Math.round(adj.value)))
const exact = computed(() => (adj.value == null ? 0 : (adj.value - midi.value) * 100))
const cents = computed(() => Math.round(exact.value))
const deg = computed(() => (Math.max(-50, Math.min(50, exact.value)) / 50) * 60)
const name = computed(() => (midi.value == null ? '' : stringName(midi.value, null)))
const octave = computed(() => (midi.value == null ? '' : octaveOf(midi.value)))
const zone = computed(() => {
  if (!shown.value) return 'none'
  const a = Math.abs(exact.value)
  if (a <= 5) return 'pocket'
  if (a <= 15) return 'edge'
  return 'out'
})

function octaveOf(m) {
  return Math.floor(m / 12) - 1
}

const activeString = computed(() => {
  if (adj.value == null || stale.value) return null
  let best = null
  for (const s of props.strings) {
    if (
      Math.abs(adj.value - s) <= 2.5 &&
      (best == null || Math.abs(adj.value - s) < Math.abs(adj.value - best))
    )
      best = s
  }
  return best
})

// Held within ±3¢ for half a second: the dial glows and the string is ticked.
const locked = ref(false)
const tuned = ref([])
let inSince = 0
watch([exact, stale], () => {
  const ok = shown.value && !stale.value && Math.abs(exact.value) <= 3
  if (!ok) {
    inSince = 0
    locked.value = false
    return
  }
  const now = performance.now()
  if (!inSince) inSince = now
  if (now - inSince >= 500) {
    locked.value = true
    if (props.strings.includes(midi.value) && !tuned.value.includes(midi.value)) {
      tuned.value = [...tuned.value, midi.value]
    }
  }
})

// ── Strobe ──────────────────────────────────────────────────────────────────
// Moved straight on the element: a reactive transform would re-render the
// sheet sixty times a second for no reason.
const strobeEl = ref(null)
const PERIOD = 28 // px, one light + one dark band
let phase = 0
let last = 0
let raf = 0

function spin(t) {
  raf = requestAnimationFrame(spin)
  const dt = last ? Math.min(0.05, (t - last) / 1000) : 0
  last = t
  if (!strobeEl.value) return
  if (shown.value && !stale.value) {
    const c = Math.max(-50, Math.min(50, exact.value))
    phase = (phase + c * 7 * dt) % PERIOD
  }
  strobeEl.value.style.transform = `translateX(${(phase > 0 ? phase - PERIOD : phase).toFixed(2)}px)`
}

onMounted(() => (raf = requestAnimationFrame(spin)))
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearTimeout(staleTimer)
})
</script>

<style scoped>
.tu {
  --t-pocket: #22c55e;
  --t-edge: #f5b400;
  --t-out: #ef4444;
  --t-dim: rgba(244, 243, 239, 0.45);
  --t-faint: rgba(244, 243, 239, 0.22);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.9rem;
  color: #f4f3ef;
}

:where(.tu button) {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

.tu button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ── Off ── */
.tu-off {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
  padding: 3rem 1rem 3.5rem;
  text-align: center;
}

.tu-off p {
  margin: 0;
  color: var(--t-dim);
  font-size: 0.9rem;
}

.tu-off-icon {
  width: 4rem;
  fill: none;
  stroke: var(--t-dim);
  stroke-width: 2.5;
  stroke-linecap: round;
}

.tu-off-icon circle {
  fill: var(--t-dim);
  stroke: none;
}

.tu-enable {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.5rem;
  padding: 0 1.2rem;
  border-radius: 999px;
  background: var(--accent-500) !important;
  color: #fff !important;
  font-weight: 700;
  font-size: 0.85rem;
}

/* ── Dial ── */
.tu-dial svg {
  display: block;
  width: 100%;
  max-height: 22rem;
  overflow: visible;
}

.arc-base,
.arc-edge,
.arc-in {
  fill: none;
  stroke-linecap: round;
  stroke-width: 12;
}

.arc-base {
  stroke: rgba(255, 255, 255, 0.07);
}

.arc-edge {
  stroke: rgba(245, 180, 0, 0.28);
}

.arc-in {
  stroke: rgba(34, 197, 94, 0.55);
  transition: stroke 200ms;
}

.locked .arc-in {
  stroke: var(--t-pocket);
}

.arc-in.glow {
  stroke-width: 16;
  opacity: 0.8;
}

.tick {
  stroke: var(--t-faint);
  stroke-width: 1.5;
  stroke-linecap: round;
}

.tick.major {
  stroke: var(--t-dim);
  stroke-width: 2.2;
}

.tick-label {
  fill: var(--t-dim);
  font:
    600 12px ui-monospace,
    'SF Mono',
    Menlo,
    Consolas,
    monospace;
  text-anchor: middle;
  dominant-baseline: middle;
}

.needle {
  transform-box: view-box;
  transform-origin: 220px 262px;
  transition: transform 150ms cubic-bezier(0.3, 1.35, 0.5, 1);
}

.needle line {
  stroke: currentColor;
  stroke-width: 5;
  stroke-linecap: round;
}

.needle circle {
  fill: currentColor;
}

.tu-dial.pocket .needle {
  color: var(--t-pocket);
}

.tu-dial.edge .needle {
  color: var(--t-edge);
}

.tu-dial.out .needle {
  color: var(--t-out);
}

.tu-dial.locked .needle {
  filter: drop-shadow(0 0 6px rgba(34, 197, 94, 0.8));
}

.note {
  fill: #f4f3ef;
  font:
    800 108px -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Helvetica,
    Arial,
    sans-serif;
  text-anchor: middle;
  transition: fill 200ms;
}

.note .nm {
  font-weight: 800;
}

.note .oct {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 0;
  fill: var(--t-dim);
}

.tu-dial.locked .note {
  fill: var(--t-pocket);
}

.tu-dial.stale {
  opacity: 0.42;
  transition: opacity 300ms;
}

/* ── Readout ── */
.tu-read {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 1.1rem;
  margin-top: -0.6rem;
  min-height: 2.2rem;
}

.tu-cents {
  font-size: 1.9rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.tu-cents small {
  font-size: 1rem;
  margin-left: 0.1rem;
  opacity: 0.7;
}

.tu-read.pocket .tu-cents,
.tu-read.pocket .tu-hint {
  color: var(--t-pocket);
}

.tu-read.edge .tu-cents,
.tu-read.edge .tu-hint {
  color: var(--t-edge);
}

.tu-read.out .tu-cents,
.tu-read.out .tu-hint {
  color: var(--t-out);
}

.tu-hz {
  font-size: 0.85rem;
  color: var(--t-dim);
  font-variant-numeric: tabular-nums;
}

.tu-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.tu-hint .pi {
  font-size: 0.7rem;
}

/* ── Strobe ── */
.strobe {
  position: relative;
  height: 2.4rem;
  border-radius: 0.6rem;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}

.strobe-bands {
  position: absolute;
  inset: 0 -28px 0 0;
  --band: rgba(255, 255, 255, 0.5);
  background: repeating-linear-gradient(90deg, var(--band) 0 14px, transparent 14px 28px);
  opacity: 0.85;
  transition: opacity 300ms;
  will-change: transform;
}

.strobe.pocket .strobe-bands {
  --band: rgba(34, 197, 94, 0.75);
}

.strobe.edge .strobe-bands {
  --band: rgba(245, 180, 0, 0.7);
}

.strobe.out .strobe-bands {
  --band: rgba(239, 68, 68, 0.7);
}

.strobe.still .strobe-bands {
  opacity: 0.18;
}

.strobe-mid {
  position: absolute;
  left: 50%;
  top: 0.3rem;
  bottom: 0.3rem;
  width: 2px;
  margin-left: -1px;
  border-radius: 999px;
  background: #f4f3ef;
  opacity: 0.6;
}

/* ── Strings + reference ── */
.tu-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.8rem;
  padding-top: 0.2rem;
}

.strings {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.str {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  height: 2.75rem;
  padding: 0 0.85rem 0 1rem;
  border-radius: 0.8rem;
  background: rgba(255, 255, 255, 0.05) !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  transition:
    background 160ms,
    box-shadow 160ms,
    transform 80ms;
}

.str:hover {
  background: rgba(255, 255, 255, 0.1) !important;
}

.str:active {
  transform: scale(0.96);
}

.str-name {
  font-size: 1.25rem;
  font-weight: 800;
  line-height: 1;
}

.str-name sub {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--t-dim);
  vertical-align: baseline;
  margin-left: 0.05rem;
}

.str .pi {
  font-size: 0.72rem;
  color: var(--t-faint);
}

.str.active {
  box-shadow: inset 0 0 0 2px #f4f3ef;
}

.str.done .pi {
  color: var(--t-pocket);
}

.str.done {
  box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.45);
}

.str.done.active {
  box-shadow: inset 0 0 0 2px var(--t-pocket);
}

.ref {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--t-dim);
}

.ref b {
  min-width: 2rem;
  text-align: center;
  font-size: 0.95rem;
  color: #f4f3ef;
  font-variant-numeric: tabular-nums;
}

.ref button {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.55rem;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}

.ref button:hover:not(:disabled) {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
}
</style>
