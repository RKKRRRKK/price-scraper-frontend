<!-- File: src/components/looper/LooperTrim.vue -->
<!--
  Cutting a loop by hand: the whole take (or, for an older loop, what it kept)
  with the loop's start and end as handles.

  The overview is for finding the part; it is far too coarse to set a seam
  on, so each edge also gets a close-up a second wide where a drag moves the
  edge a few milliseconds per pixel and snaps to the start of a note. Dragging
  between the edges in the overview slides the whole loop.

  Free (the only loop in the session): any length. Otherwise the length is a
  whole number of grid units the other loops allow, so the end steps.
-->
<template>
  <div class="trim">
    <div class="ov" @pointerdown="downOverview" @pointermove="moveOverview" @pointerup="up" @pointercancel="up">
      <canvas ref="ovEl"></canvas>
    </div>

    <div class="close">
      <div v-for="edge in ['start', 'end']" :key="edge" class="cu">
        <span class="cu-label">{{ edge === 'start' ? 'Start' : 'End' }}</span>
        <div
          class="cu-box"
          @pointerdown="downClose(edge, $event)"
          @pointermove="moveClose(edge, $event)"
          @pointerup="up"
          @pointercancel="up"
        >
          <canvas :ref="(el) => (cuEl[edge] = el)"></canvas>
        </div>
      </div>
    </div>

    <div class="foot">
      <button class="pv" :class="{ on: previewing }" @click="togglePreview">
        <i :class="previewing ? 'pi pi-stop' : 'pi pi-play'"></i> {{ previewing ? 'Stop' : 'Preview' }}
      </button>
      <span class="len">{{ lenLabel }}</span>
      <span class="sp"></span>
      <button class="ghost" @click="$emit('cancel')">Cancel</button>
      <button class="apply" @click="$emit('apply', { start, end })">Apply</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { onsets, attackFoot } from '@/lib/looper/detect'

const props = defineProps({
  // { dry, wet } Float32Arrays, the whole source.
  src: { type: Object, required: true },
  sr: { type: Number, required: true },
  start: { type: Number, required: true },
  end: { type: Number, required: true },
  // Any length (true), or whole grid units from `allowed`.
  free: { type: Boolean, default: true },
  unit: { type: Number, default: 0 },
  allowed: { type: Array, default: null },
  // 'bar' when the grid unit is a bar, else the unit is a whole loop.
  unitName: { type: String, default: 'bar' },
  ac: { type: Object, default: null },
})
defineEmits(['apply', 'cancel'])

const MIN_SEC = 0.25
const CLOSE_SEC = 1.0
const SNAP_PX = 7

const start = ref(props.start)
const end = ref(props.end)
const n = computed(() => props.src.wet.length)

// Note starts in the source, for the close-ups to show and snap to.
const feet = onsets(props.src.dry, props.sr).map((o) => attackFoot(props.src.dry, props.sr, o.i))

const lenLabel = computed(() => {
  const L = end.value - start.value
  const sec = `${(L / props.sr).toFixed(2)} s`
  if (props.free || !props.unit) return sec
  const k = Math.round(L / props.unit)
  if (props.unitName !== 'bar') return `${k}× the loop · ${sec}`
  return `${k} ${k === 1 ? 'bar' : 'bars'} · ${sec}`
})

// ── Constraints ────────────────────────────────────────────────────────────
function units(L) {
  const want = L / props.unit
  return props.allowed.reduce((a, k) => (Math.abs(k - want) < Math.abs(a - want) ? k : a), props.allowed[0])
}

function setStart(s, keepLength) {
  const L = end.value - start.value
  if (keepLength || !props.free) {
    const len = props.free ? L : units(L) * props.unit
    s = Math.max(0, Math.min(n.value - len, s))
    start.value = Math.round(s)
    end.value = Math.round(s + len)
    return
  }
  start.value = Math.round(Math.max(0, Math.min(end.value - MIN_SEC * props.sr, s)))
}

function setEnd(e) {
  if (!props.free) {
    const len = units(e - start.value) * props.unit
    end.value = Math.round(Math.min(n.value, start.value + len))
    return
  }
  end.value = Math.round(Math.min(n.value, Math.max(start.value + MIN_SEC * props.sr, e)))
}

// ── Overview ───────────────────────────────────────────────────────────────
const ovEl = ref(null)
let drag = null

function ovIndex(e) {
  const r = ovEl.value.getBoundingClientRect()
  return ((e.clientX - r.left) / r.width) * n.value
}

function downOverview(e) {
  const r = ovEl.value.getBoundingClientRect()
  const px = (i) => r.left + (i / n.value) * r.width
  const ds = Math.abs(e.clientX - px(start.value))
  const de = Math.abs(e.clientX - px(end.value))
  if (Math.min(ds, de) <= 8) drag = { kind: ds <= de ? 'start' : 'end' }
  else if (e.clientX > px(start.value) && e.clientX < px(end.value)) drag = { kind: 'slide', from: ovIndex(e), s0: start.value }
  else return
  e.currentTarget.setPointerCapture(e.pointerId)
}

function moveOverview(e) {
  if (!drag) return
  const i = ovIndex(e)
  if (drag.kind === 'start') setStart(i, false)
  else if (drag.kind === 'end') setEnd(i)
  else setStart(drag.s0 + (i - drag.from), true)
}

function up() {
  drag = null
}

// ── Close-ups ──────────────────────────────────────────────────────────────
const cuEl = {}
// Each close-up's window, fixed while dragging so the waveform doesn't slide
// under the pointer, re-centred on the edge otherwise.
const win = { start: 0, end: 0 }

function centre(edge) {
  const at = edge === 'start' ? start.value : end.value
  win[edge] = Math.round(at - (CLOSE_SEC * props.sr) / 2)
}

function cuIndex(edge, e) {
  const r = cuEl[edge].getBoundingClientRect()
  const px = e.clientX - r.left
  let i = win[edge] + (px / r.width) * CLOSE_SEC * props.sr
  // Snap to a note's start when the pointer is within a few pixels of one.
  const perPx = (CLOSE_SEC * props.sr) / r.width
  let best = null
  for (const f of feet) {
    const d = Math.abs(f - i) / perPx
    if (d <= SNAP_PX && (!best || d < best.d)) best = { f, d }
  }
  if (best) i = best.f
  return i
}

function downClose(edge, e) {
  drag = { kind: 'close', edge }
  e.currentTarget.setPointerCapture(e.pointerId)
  moveClose(edge, e)
}

function moveClose(edge, e) {
  if (!drag || drag.kind !== 'close' || drag.edge !== edge) return
  const i = cuIndex(edge, e)
  if (edge === 'start') setStart(i, false)
  else setEnd(i)
}

// ── Drawing ────────────────────────────────────────────────────────────────
function colors(el) {
  const cs = getComputedStyle(el)
  const v = (name, fb) => cs.getPropertyValue(name).trim() || fb
  return {
    wave: v('--text-dim', '#aaa59e'),
    faint: v('--text-faint', '#6f6b65'),
    accent: v('--accent-500', '#ef4444'),
    bg: v('--bg-sunken', '#161514'),
  }
}

function fit(canvas) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  return { ctx: canvas.getContext('2d'), w, h, dpr }
}

// Peak level per column over [from, from + span), wet channel.
function peaks(from, span, cols) {
  const x = props.src.wet
  const out = new Float32Array(cols)
  for (let c = 0; c < cols; c++) {
    const a = Math.max(0, Math.floor(from + (c / cols) * span))
    const b = Math.min(x.length, Math.floor(from + ((c + 1) / cols) * span))
    let p = 0
    for (let i = a; i < b; i++) {
      const v = x[i] < 0 ? -x[i] : x[i]
      if (v > p) p = v
    }
    out[c] = p
  }
  return out
}

let ovPeaks = null
let norm = 1

function drawOverview() {
  const el = ovEl.value
  if (!el) return
  const { ctx, w, h } = fit(el)
  const col = colors(el)
  if (!ovPeaks || ovPeaks.length !== w) {
    ovPeaks = peaks(0, n.value, w)
    norm = Math.max(1e-4, ...ovPeaks)
  }
  ctx.clearRect(0, 0, w, h)
  const x0 = (start.value / n.value) * w
  const x1 = (end.value / n.value) * w
  ctx.fillStyle = col.accent + '22'
  ctx.fillRect(x0, 0, x1 - x0, h)
  for (let c = 0; c < w; c++) {
    const a = Math.sqrt(ovPeaks[c] / norm) * (h / 2 - 2)
    ctx.fillStyle = c >= x0 && c <= x1 ? col.wave : col.faint
    ctx.fillRect(c, h / 2 - a, 1, a * 2 || 1)
  }
  ctx.fillStyle = col.accent
  ctx.fillRect(Math.round(x0) - 1, 0, 2, h)
  ctx.fillRect(Math.round(x1) - 1, 0, 2, h)
}

function drawClose(edge) {
  const el = cuEl[edge]
  if (!el) return
  const { ctx, w, h, dpr } = fit(el)
  const col = colors(el)
  const span = CLOSE_SEC * props.sr
  const from = win[edge]
  const at = edge === 'start' ? start.value : end.value
  const p = peaks(from, span, w)
  ctx.clearRect(0, 0, w, h)
  const xAt = ((at - from) / span) * w
  // The side that's in the loop.
  ctx.fillStyle = col.accent + '22'
  if (edge === 'start') ctx.fillRect(xAt, 0, w - xAt, h)
  else ctx.fillRect(0, 0, xAt, h)
  ctx.fillStyle = col.wave
  for (let c = 0; c < w; c++) {
    const a = Math.sqrt(p[c] / norm) * (h / 2 - 2)
    ctx.fillRect(c, h / 2 - a, 1, a * 2 || 1)
  }
  ctx.fillStyle = col.faint
  for (const f of feet) {
    if (f < from || f > from + span) continue
    ctx.fillRect(Math.round(((f - from) / span) * w), h - 6 * dpr, Math.max(1, dpr), 6 * dpr)
  }
  ctx.fillStyle = col.accent
  ctx.fillRect(Math.round(xAt) - dpr, 0, 2 * dpr, h)
}

let raf = 0
function draw() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    if (!drag || drag.kind !== 'close' || drag.edge !== 'start') centre('start')
    if (!drag || drag.kind !== 'close' || drag.edge !== 'end') centre('end')
    drawOverview()
    drawClose('start')
    drawClose('end')
  })
}

watch([start, end], () => {
  draw()
  updatePreview()
})

let ro = null
onMounted(async () => {
  await nextTick()
  draw()
  ro = new ResizeObserver(() => {
    ovPeaks = null
    draw()
  })
  ro.observe(ovEl.value)
})

// ── Preview ────────────────────────────────────────────────────────────────
const previewing = ref(false)
let node = null
let buffer = null

function togglePreview() {
  if (previewing.value) return stopPreview()
  const ac = props.ac
  if (!ac) return
  if (!buffer) {
    buffer = ac.createBuffer(1, n.value, props.sr)
    buffer.copyToChannel(props.src.wet, 0)
  }
  node = ac.createBufferSource()
  node.buffer = buffer
  node.loop = true
  node.loopStart = start.value / props.sr
  node.loopEnd = end.value / props.sr
  node.connect(ac.destination)
  node.start(ac.currentTime + 0.03, start.value / props.sr)
  previewing.value = true
}

function updatePreview() {
  if (!node) return
  node.loopStart = start.value / props.sr
  node.loopEnd = end.value / props.sr
}

function stopPreview() {
  try {
    node?.stop()
  } catch {
    /* already stopped */
  }
  node?.disconnect()
  node = null
  previewing.value = false
}

onBeforeUnmount(() => {
  stopPreview()
  cancelAnimationFrame(raf)
  ro?.disconnect()
})
</script>

<style scoped>
.trim {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.ov {
  height: 6rem;
  border-radius: 0.6rem;
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  cursor: ew-resize;
  touch-action: none;
  overflow: hidden;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.close {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.8rem;
}

.cu {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.cu-label {
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}

.cu-box {
  height: 5rem;
  border-radius: 0.6rem;
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  cursor: col-resize;
  touch-action: none;
  overflow: hidden;
}

.foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.sp {
  flex: 1;
}

.len {
  font-size: 0.85rem;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.foot button {
  height: 2.3rem;
  padding: 0 0.9rem;
  border-radius: 0.6rem;
  font-weight: 700;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.pv {
  border: 1px solid var(--border);
}

.pv.on {
  color: var(--accent-400);
  border-color: var(--accent-500);
}

.ghost {
  color: var(--text-dim);
}

.ghost:hover {
  color: var(--text);
}

.apply {
  background: var(--accent-500);
  color: #fff;
}

@media (max-width: 767.98px) {
  .close {
    grid-template-columns: 1fr;
  }
}
</style>
