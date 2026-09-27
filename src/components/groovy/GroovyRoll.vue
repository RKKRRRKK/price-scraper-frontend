<!-- File: src/components/groovy/GroovyRoll.vue -->
<!--
  The practice surface: one lane scrolling right-to-left past a now-line, with
  a large circle for every note you play, left where you played it.

  Each circle carries three things:
    colour  the pocket, the same three words everywhere in the tool (see
            pocketZone() in analysis.js): green in the pocket, yellow on the
            edge, red outside
    label   the note's degree or its name, by the scale map's Degrees / Notes
            toggle
    ring    a dashed dark ring when the note is outside the key

  The circle sits at the moment the note was played; a short stub joins it to
  the grid line it was aiming at, so early and late read as which side of the
  line it landed on. The exact numbers are on the note card underneath.

  The roll follows whatever `clock` returns: the AudioContext time while the
  count runs, a replay's playhead while a take plays. When it returns null the
  roll holds still and can be dragged or scrolled through. Clicking a circle
  selects that note; clicking empty space clears the selection.
-->
<template>
  <div class="roll-wrap" ref="wrap">
    <canvas
      ref="cv"
      class="roll-canvas"
      :class="{ pannable }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="down = null"
      @pointerleave="hover = null"
    ></canvas>

    <div
      v-if="hover"
      class="roll-tip"
      :style="{ left: hover.x + 'px', top: hover.y + 'px' }"
      role="tooltip"
    >
      <b :style="{ color: TIP[zoneOf(hover.hit)] }">
        {{ hover.hit.devMs > 0 ? '+' : '' }}{{ Math.round(hover.hit.devMs) }} ms
      </b>
      <span class="tip-sub">
        <template v-if="hover.hit.midi != null">{{ noteLabel(hover.hit.midi, scale) }} · </template>
        beat {{ hover.hit.label }}
      </span>
    </div>

    <div v-if="idle" class="roll-idle">
      <i class="pi pi-play-circle"></i>
      <span>{{ idleText }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { pocketZone } from '@/lib/groovy/analysis'
import { noteLabel, markLabel } from '@/lib/groovy/scales'

const props = defineProps({
  // Anything with the Transport's grid API: segments, slotsBetween, barSeconds.
  grid: { type: Object, required: true },
  // In playing order: { time, devMs, slotTime, label, midi, str }
  hits: { type: Array, default: () => [] },
  // () => time to follow, or null to hold still.
  clock: { type: Function, default: null },
  // () => a parked playhead to mark while holding still, or null.
  cursor: { type: Function, default: null },
  // The selected note — one of `hits`, by identity.
  focus: { type: Object, default: null },
  // buildScale() output, for labels and the out-of-key ring.
  scale: { type: Object, default: null },
  // 'degrees' | 'notes' — the scale map's toggle.
  labels: { type: String, default: 'degrees' },
  toleranceMs: { type: Number, default: 25 },
  windowBars: { type: Number, default: 2 },
  recording: { type: Boolean, default: false },
  // While counting in, everything before this time is shaded out.
  countInUntil: { type: Number, default: 0 },
  idleText: { type: String, default: 'Start the count to begin' },
})
const emit = defineEmits(['select'])

const wrap = ref(null)
const cv = ref(null)
const hover = ref(null)
const idle = ref(true)
const pannable = ref(false)
const down = ref(null)

let raf = 0
let ro = null
let w = 0
let h = 0
let dpr = 1
// Circle positions from the last frame, in CSS pixels, for picking.
let picks = []
// The time sitting under NOW_X, and whether it has been set for this grid.
let anchor = 0
let hasAnchor = false
let following = false

const NOW_X = 0.72
const MAX_R = 28
const MIN_R = 11

const C = {
  surface: '#ffffff',
  bar: '#b9b6b0',
  pulse: '#d6d4ce',
  medium: '#c8c5bf',
  sub: '#ecebe6',
  ink: '#1a1a1a',
  dim: '#5c5c5c',
  faint: '#9a9a9a',
  now: '#ef4444',
  cursor: '#2a78d6',
}

// Fill, and the label colour that reads on it. Yellow is too light for white
// text, so it takes dark ink instead.
const ZONE = {
  pocket: { fill: '#16a34a', text: '#ffffff' },
  edge: { fill: '#f0b400', text: '#3d2c00' },
  out: { fill: '#e34948', text: '#ffffff' },
}
// The same three, lightened for the dark tooltip.
const TIP = { pocket: '#86efac', edge: '#fcd34d', out: '#fca5a5' }

function zoneOf(hit) {
  return pocketZone(hit.devMs, props.toleranceMs)
}

function windowSeconds() {
  return Math.max(0.5, props.grid.barSeconds() * props.windowBars)
}

// Put a time under the now-line, or ('left') just inside the left edge.
function showAt(t, align = 'now') {
  const win = windowSeconds()
  anchor = align === 'left' ? t + (NOW_X - 0.06) * win : t
  hasAnchor = true
}
defineExpose({ showAt })

watch(
  () => props.grid,
  () => {
    hasAnchor = false
  },
)

// Selecting a note that is off screen while the roll is holding still brings it
// to the middle.
watch(
  () => props.focus,
  (hit) => {
    if (!hit || following || !props.grid?.segments?.length) return
    const win = windowSeconds()
    const t0 = anchor - NOW_X * win
    const t1 = t0 + win
    if (hit.time < t0 + win * 0.05 || hit.time > t1 - win * 0.05) {
      anchor = hit.time + (NOW_X - 0.5) * win
      hasAnchor = true
    }
  },
)

function resize() {
  const el = wrap.value
  const c = cv.value
  if (!el || !c) return
  dpr = Math.min(3, window.devicePixelRatio || 1)
  w = el.clientWidth
  h = el.clientHeight
  c.width = Math.max(1, Math.round(w * dpr))
  c.height = Math.max(1, Math.round(h * dpr))
  c.style.width = w + 'px'
  c.style.height = h + 'px'
}

function draw() {
  raf = requestAnimationFrame(draw)
  const c = cv.value
  if (!c || !w || !h) return
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.fillStyle = C.surface
  g.fillRect(0, 0, w, h)

  const f = props.clock ? props.clock() : null
  following = f != null
  if (following) {
    anchor = f
    hasAnchor = true
  } else if (!hasAnchor && props.hits.length) {
    anchor = props.hits[props.hits.length - 1].time
    hasAnchor = true
  }
  const isIdle = !following && !props.hits.length
  if (idle.value !== isIdle) idle.value = isIdle
  const canPan = !following && hasAnchor && !isIdle
  if (pannable.value !== canPan) pannable.value = canPan

  if (!hasAnchor || !props.grid?.segments?.length) {
    picks = []
    return
  }

  const windowSec = windowSeconds()
  const t0 = anchor - NOW_X * windowSec
  const t1 = t0 + windowSec
  const X = (t) => ((t - t0) / windowSec) * w

  // Circles as big as the grid allows: just under half the gap between two
  // grid lines, so neighbouring notes on a busy line do not swallow each other.
  const seg = props.grid.segments[props.grid.segments.length - 1]
  const slotPx = (seg.slotSec / windowSec) * w
  const r = Math.max(MIN_R, Math.min(MAX_R, slotPx * 0.46, (h - 24) * 0.3))
  const midY = Math.round(14 + (h - 14) / 2)

  drawGrid(g, X, t0, t1, midY)
  picks = drawHits(g, X, t0, t1, midY, r)

  // Count-in: everything before the take starts is dimmed, so the moment
  // recording begins is unmissable without a flashing number.
  if (following && props.countInUntil > anchor) {
    g.fillStyle = 'rgba(250, 249, 247, 0.72)'
    g.fillRect(0, 0, w, h)
  }

  if (following) {
    // Now-line last so nothing sits on top of it.
    const nx = X(anchor)
    g.strokeStyle = C.now
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(nx, 0)
    g.lineTo(nx, h)
    g.stroke()
    if (props.recording) {
      g.fillStyle = C.now
      g.beginPath()
      g.arc(nx, 9, 4, 0, Math.PI * 2)
      g.fill()
    }
  } else {
    const cur = props.cursor ? props.cursor() : null
    if (cur != null && cur >= t0 && cur <= t1) {
      const cx = Math.round(X(cur)) + 0.5
      g.strokeStyle = C.cursor
      g.lineWidth = 1.5
      g.setLineDash([4, 3])
      g.beginPath()
      g.moveTo(cx, 0)
      g.lineTo(cx, h)
      g.stroke()
      g.setLineDash([])
    }
  }
}

function drawGrid(g, X, t0, t1, midY) {
  const slots = props.grid.slotsBetween(t0, t1)
  g.lineWidth = 1
  for (const s of slots) {
    const x = Math.round(X(s.time)) + 0.5
    if (s.kind === 'sub') g.strokeStyle = C.sub
    else if (s.kind === 'bar') g.strokeStyle = C.bar
    else if (s.kind === 'medium') g.strokeStyle = C.medium
    else g.strokeStyle = C.pulse
    g.beginPath()
    g.moveTo(x, s.kind === 'sub' ? 14 : 0)
    g.lineTo(x, h)
    g.stroke()

    if (s.kind !== 'sub') {
      g.fillStyle = s.kind === 'bar' ? C.dim : C.faint
      g.font = `${s.kind === 'bar' ? 700 : 500} 10px ui-monospace, Menlo, Consolas, monospace`
      g.textAlign = 'left'
      g.textBaseline = 'alphabetic'
      g.fillText(
        s.kind === 'bar' ? String(s.bar + 1) : String(Math.floor(s.slotInBar / s.subdiv) + 1),
        x + 3,
        11,
      )
    }
  }
  // The line the circles sit on.
  g.strokeStyle = '#efeeea'
  g.beginPath()
  g.moveTo(0, midY + 0.5)
  g.lineTo(w, midY + 0.5)
  g.stroke()
}

function drawHits(g, X, t0, t1, y, r) {
  const out = []
  const hits = props.hits
  const tones = props.scale?.tones
  const font = Math.round(r * 0.72)
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i]
    if (hit.time > t1 + 0.3) continue
    if (hit.time < t0 - 0.3) break
    const zone = ZONE[zoneOf(hit)]
    const gx = X(hit.slotTime)
    const hx = X(hit.time)
    const pitched = hit.midi != null
    const inKey = !pitched || !tones || tones.has(((hit.midi % 12) + 12) % 12)

    // Stub from the grid line to the note, and a notch on the line itself.
    g.strokeStyle = zone.fill
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(gx, y)
    g.lineTo(hx, y)
    g.stroke()
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(Math.round(gx) + 0.5, y - r - 5)
    g.lineTo(Math.round(gx) + 0.5, y + r + 5)
    g.stroke()

    // A white halo so overlapping circles stay separate.
    g.fillStyle = C.surface
    g.beginPath()
    g.arc(hx, y, r + 2.5, 0, Math.PI * 2)
    g.fill()

    g.beginPath()
    g.arc(hx, y, r, 0, Math.PI * 2)
    g.fillStyle = zone.fill
    g.fill()

    if (!inKey) {
      g.strokeStyle = C.ink
      g.lineWidth = 2.5
      g.setLineDash([5, 3.5])
      g.beginPath()
      g.arc(hx, y, r + 5.5, 0, Math.PI * 2)
      g.stroke()
      g.setLineDash([])
    }

    // The pitch arrives ~130 ms after the note does; until then, and for a note
    // the tracker never names, a question mark.
    g.fillStyle = zone.text
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const text = pitched ? markLabel(hit.midi, props.scale, props.labels) : '?'
    g.font = `800 ${text.length > 2 ? Math.round(font * 0.82) : font}px -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`
    g.fillText(text, hx, y + 1)

    if (hit === props.focus) {
      g.strokeStyle = '#2a78d6'
      g.lineWidth = 3
      g.beginPath()
      g.arc(hx, y, r + (inKey ? 6 : 10), 0, Math.PI * 2)
      g.stroke()
    }
    out.push({ x: hx, y, r, hit })
  }
  return out
}

// ── Pointer ─────────────────────────────────────────────────────────────────
function localXY(e) {
  const rect = cv.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function pickAt(x, y) {
  let best = null
  let bestD = Infinity
  for (const p of picks) {
    const d = Math.hypot(p.x - x, p.y - y)
    if (d <= p.r + 6 && d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

function onDown(e) {
  if (e.button !== 0) return
  const { x } = localXY(e)
  down.value = { x, anchor, moved: false }
  cv.value.setPointerCapture?.(e.pointerId)
}

function onMove(e) {
  const { x, y } = localXY(e)
  const d = down.value
  if (d) {
    const dx = x - d.x
    if (!d.moved && Math.abs(dx) > 4) d.moved = true
    if (d.moved && pannable.value) {
      anchor = d.anchor - (dx / w) * windowSeconds()
      hover.value = null
    }
    return
  }
  const p = pickAt(x, y)
  hover.value = p ? { x: p.x, y: p.y - p.r, hit: p.hit } : null
}

function onUp(e) {
  const d = down.value
  down.value = null
  cv.value.releasePointerCapture?.(e.pointerId)
  if (!d || d.moved) return
  const { x, y } = localXY(e)
  const p = pickAt(x, y)
  emit('select', p ? p.hit : null)
}

function onWheel(e) {
  if (!pannable.value) return
  e.preventDefault()
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  const px = e.deltaMode === 1 ? d * 16 : d
  anchor += (px / w) * windowSeconds() * 0.6
  hover.value = null
}

onMounted(() => {
  resize()
  ro = new ResizeObserver(resize)
  if (wrap.value) ro.observe(wrap.value)
  // Not passive: a wheel over a still roll scrolls the roll, not the page.
  wrap.value?.addEventListener('wheel', onWheel, { passive: false })
  raf = requestAnimationFrame(draw)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  wrap.value?.removeEventListener('wheel', onWheel)
  ro?.disconnect()
  ro = null
})
</script>

<style scoped>
.roll-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.roll-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: pointer;
}

.roll-canvas.pannable {
  cursor: grab;
}

.roll-canvas.pannable:active {
  cursor: grabbing;
}

.roll-tip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 0.9rem));
  pointer-events: none;
  background: #1a1a1a;
  color: #fff;
  border-radius: 0.4rem;
  padding: 0.3rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  white-space: nowrap;
  z-index: 5;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.roll-tip b {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.tip-sub {
  font-size: 0.66rem;
  color: #c3c2b7;
}

/* Opaque: an idle grid behind a half-transparent message read as a broken box
   rather than a waiting one. */
.roll-idle {
  position: absolute;
  inset: 0;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #9a9a9a;
  font-size: 0.85rem;
  pointer-events: none;
}

.roll-idle i {
  font-size: 1.75rem;
}
</style>
