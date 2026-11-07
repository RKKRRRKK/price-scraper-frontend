<!-- File: src/components/looper/LooperNudge.vue -->
<!--
  Moving a loop in time against the others: one turn of it, drawn over the
  bar/beat/sixteenth grid, with everything else that plays against it
  underneath. Dragging the top lane (or the arrows) shifts it; the view hears
  every shift live through `preview`, so the nudge is judged by ear.

  A shift of d is a rotation: the loop's audio moves d later and wraps. That
  is exactly what rebuilding the layer at offset + d gives (buildLayer writes
  everything relative to the offset), so the preview and the applied result
  are the same sound.
-->
<template>
  <div class="nudge">
    <div class="lanes" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up">
      <canvas ref="cv"></canvas>
      <span class="lane-label top">This loop</span>
      <span v-if="reference" class="lane-label bottom">Everything else</span>
    </div>

    <div class="foot">
      <div class="seg">
        <button v-for="s in steps" :key="s.key" :class="{ on: step === s.key }" @click="step = s.key">{{ s.label }}</button>
      </div>
      <button class="nb" title="Earlier (←, Shift for 1 ms)" @click="by(-1)"><i class="pi pi-chevron-left"></i></button>
      <span class="amt">{{ shiftLabel }}</span>
      <button class="nb" title="Later (→, Shift for 1 ms)" @click="by(1)"><i class="pi pi-chevron-right"></i></button>
      <button class="ghost" :disabled="!shift" @click="shift = 0">Reset</button>
      <span class="sp"></span>
      <button class="ghost" @click="$emit('cancel')">Cancel</button>
      <button class="apply" :disabled="!shift" @click="$emit('apply', shift)">Apply</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  // One turn of the loop, as it plays now.
  wet: { type: Float32Array, required: true },
  sr: { type: Number, required: true },
  // Everything else over the same turn, or null when this is the only loop.
  reference: { type: Float32Array, default: null },
  // Grid, in samples. beat/bar null when the session has no tempo; then
  // `division` is a sixteenth of the master loop and `loopLen` its turn.
  beat: { type: Number, default: null },
  bar: { type: Number, default: null },
  division: { type: Number, required: true },
  loopLen: { type: Number, required: true },
  color: { type: String, default: '#eab308' },
  // Where the transport is in this loop now, 0…1, or null when stopped.
  phase: { type: Function, default: () => null },
})
const emit = defineEmits(['preview', 'apply', 'cancel'])

const len = computed(() => props.wet.length)
const shift = ref(0)

const steps = computed(() =>
  props.beat
    ? [
        { key: 'div', label: '1/16', size: props.division },
        { key: 'beat', label: 'Beat', size: props.beat },
        { key: 'free', label: 'Free', size: 0 },
      ]
    : [
        { key: 'div', label: '1/16 loop', size: props.division },
        { key: 'free', label: 'Free', size: 0 },
      ],
)
const step = ref('div')
const stepSize = computed(() => steps.value.find((s) => s.key === step.value)?.size || 0)

// Shown the short way round: a loop moved 7/8 later is 1/8 earlier.
const wrapped = computed(() => {
  const L = len.value
  let d = ((shift.value % L) + L) % L
  if (d > L / 2) d -= L
  return d
})

const shiftLabel = computed(() => {
  const d = wrapped.value
  if (!d) return 'Not moved'
  const ms = `${d > 0 ? '+' : '−'}${Math.abs((d / props.sr) * 1000).toFixed(0)} ms`
  const sixteenths = d / props.division
  if (Math.abs(sixteenths - Math.round(sixteenths)) < 0.02) {
    const k = Math.round(sixteenths)
    const unit = props.beat ? (Math.abs(k) === 1 ? 'sixteenth' : 'sixteenths') : '/16 loop'
    return props.beat ? `${k > 0 ? '+' : '−'}${Math.abs(k)} ${unit} · ${ms}` : `${k > 0 ? '+' : '−'}${Math.abs(k)}${unit} · ${ms}`
  }
  return ms
})

function by(dir, fine = false) {
  const size = fine ? 0.001 * props.sr : stepSize.value || 0.005 * props.sr
  // Stepping on a grid lands on the grid: a free nudge of +7 ms then a
  // sixteenth is one sixteenth from where it was, not 7 ms off it forever.
  const next = stepSize.value && !fine ? (Math.round(shift.value / size) + dir) * size : shift.value + dir * size
  shift.value = Math.round(next)
}

// ── Drag ───────────────────────────────────────────────────────────────────
const cv = ref(null)
let drag = null

function down(e) {
  drag = { x: e.clientX, from: shift.value, w: cv.value.getBoundingClientRect().width }
  e.currentTarget.setPointerCapture(e.pointerId)
}

function move(e) {
  if (!drag) return
  let d = drag.from + ((e.clientX - drag.x) / drag.w) * len.value
  const size = stepSize.value
  if (size) d = Math.round(d / size) * size
  shift.value = Math.round(d)
}

function up() {
  drag = null
}

function onKey(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  by(e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey)
}

// ── Preview, throttled: each one rebuilds a buffer and crossfades it in ──────
let pending = false
watch(shift, () => {
  if (pending) return
  pending = true
  setTimeout(() => {
    pending = false
    emit('preview', shift.value)
  }, 60)
})

// ── Drawing ────────────────────────────────────────────────────────────────
function peaks(x, cols) {
  const out = new Float32Array(cols)
  const n = x.length
  for (let c = 0; c < cols; c++) {
    const a = Math.floor((c / cols) * n)
    const b = Math.floor(((c + 1) / cols) * n)
    let p = 0
    for (let i = a; i < b; i++) {
      const v = x[i] < 0 ? -x[i] : x[i]
      if (v > p) p = v
    }
    out[c] = p
  }
  return out
}

let cache = null

function draw() {
  const el = cv.value
  if (!el) return
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(el.clientWidth * dpr))
  const h = Math.max(1, Math.round(el.clientHeight * dpr))
  if (el.width !== w || el.height !== h) {
    el.width = w
    el.height = h
  }
  if (!cache || cache.w !== w) {
    const mine = peaks(props.wet, w)
    const ref = props.reference ? peaks(props.reference, w) : null
    cache = { w, mine, ref, nMine: Math.max(1e-4, ...mine), nRef: ref ? Math.max(1e-4, ...ref) : 1 }
  }
  const cs = getComputedStyle(el)
  const v = (name, fb) => cs.getPropertyValue(name).trim() || fb
  const faint = v('--text-faint', '#6f6b65')
  const dim = v('--text-dim', '#aaa59e')
  const accent = v('--accent-500', '#ef4444')
  const ctx = el.getContext('2d')
  ctx.clearRect(0, 0, w, h)

  const ruler = 16 * dpr
  const laneH = props.reference ? (h - ruler) / 2 : h - ruler
  const L = len.value

  // Grid: sixteenths faint, beats stronger, bars (or master turns) strongest.
  const lines = (every, alpha, width) => {
    if (!every || (w / L) * every < 3 * dpr) return
    ctx.globalAlpha = alpha
    for (let k = 0; k * every < L; k++) ctx.fillRect(Math.round(((k * every) / L) * w), ruler, width * dpr, h - ruler)
  }
  ctx.fillStyle = faint
  lines(props.division, 0.35, 1)
  ctx.fillStyle = dim
  lines(props.beat, 0.45, 1)
  lines(props.bar || props.loopLen, 0.9, 2)
  ctx.globalAlpha = 1
  // Bar numbers along the top.
  const barLen = props.bar || props.loopLen
  ctx.fillStyle = faint
  ctx.font = `${11 * dpr}px system-ui, sans-serif`
  ctx.textBaseline = 'top'
  for (let k = 0; k * barLen < L; k++) ctx.fillText(String(k + 1), Math.round(((k * barLen) / L) * w) + 4 * dpr, 2 * dpr)

  // This loop, shifted (it wraps).
  const s = shift.value
  ctx.fillStyle = props.color
  const mid = ruler + laneH / 2
  for (let c = 0; c < w; c++) {
    const at = ((((c / w) * L - s) % L) + L) % L
    const p = cache.mine[Math.min(w - 1, Math.floor((at / L) * w))]
    const a = Math.sqrt(p / cache.nMine) * (laneH / 2 - 3 * dpr)
    ctx.fillRect(c, mid - a, 1, a * 2 || 1)
  }
  // Everything else, fixed.
  if (cache.ref) {
    ctx.fillStyle = dim
    const mid2 = ruler + laneH * 1.5
    for (let c = 0; c < w; c++) {
      const a = Math.sqrt(cache.ref[c] / cache.nRef) * (laneH / 2 - 3 * dpr)
      ctx.fillRect(c, mid2 - a, 1, a * 2 || 1)
    }
  }
  // Where this loop's first sample sits now, and the playhead.
  const x0 = Math.round(((((s % L) + L) % L) / L) * w)
  ctx.fillStyle = props.color
  ctx.fillRect(x0 - dpr, ruler, 2 * dpr, laneH)
  const ph = props.phase()
  if (ph != null) {
    ctx.fillStyle = accent
    ctx.fillRect(Math.round(ph * w) - dpr, ruler, 2 * dpr, h - ruler)
  }
}

let raf = 0
function loop() {
  draw()
  raf = requestAnimationFrame(loop)
}

let ro = null
onMounted(() => {
  window.addEventListener('keydown', onKey)
  ro = new ResizeObserver(() => (cache = null))
  ro.observe(cv.value)
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(raf)
  ro?.disconnect()
})
</script>

<style scoped>
.nudge {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.lanes {
  position: relative;
  height: 13rem;
  border-radius: 0.6rem;
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  cursor: grab;
  touch-action: none;
  overflow: hidden;
}

.lanes:active {
  cursor: grabbing;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.lane-label {
  position: absolute;
  right: 0.5rem;
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  pointer-events: none;
}

.lane-label.top {
  top: 1.2rem;
}

.lane-label.bottom {
  top: calc(50% + 0.6rem);
}

.foot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.sp {
  flex: 1;
}

.seg {
  display: inline-flex;
  padding: 0.15rem;
  gap: 0.15rem;
  border-radius: 0.6rem;
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
}

.seg button {
  height: 2rem;
  padding: 0 0.7rem;
  border-radius: 0.45rem;
  font-weight: 700;
  font-size: 0.8rem;
  color: var(--text-faint);
}

.seg button.on {
  background: var(--bg-raised);
  color: var(--text);
}

.nb {
  width: 2.3rem;
  height: 2.3rem;
  border-radius: 0.6rem;
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
}

.amt {
  min-width: 9.5rem;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.foot > button:not(.nb) {
  height: 2.3rem;
  padding: 0 0.9rem;
  border-radius: 0.6rem;
  font-weight: 700;
  font-size: 0.85rem;
}

.ghost {
  color: var(--text-dim);
}

.ghost:hover:not(:disabled) {
  color: var(--text);
}

.apply {
  background: var(--accent-500);
  color: #fff;
}
</style>
