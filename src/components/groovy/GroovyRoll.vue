<!-- File: src/components/groovy/GroovyRoll.vue -->
<!--
  The practice surface: a grid scrolling right-to-left past a fixed now-line,
  with what you played drawn on it.

  Two lanes share one time axis.

    Pitch lane   the note you are playing, as a trace, with a dot at each
                 detected attack. The open strings are drawn as faint rules so
                 the vertical axis means something at a glance.
    Timing lane  one tick per attack, at the grid line it belongs to, as tall as
                 the error is large. Up is early, down is late. The shaded band
                 across the middle is the tolerance window — hits inside it are
                 the ones you were trying for.

  Colour carries one thing only: which side of the beat you were on. Blue is
  early, red is late, and "in the pocket" is conveyed by the band rather than by
  recolouring the marks, so the hue never has to mean two things at once.

  The now-line sits at 72% rather than at the right edge so the next beat is
  visible on its way in — you can see a bar line coming and aim at it.
-->
<template>
  <div class="roll-wrap" ref="wrap">
    <canvas ref="cv" class="roll-canvas" @pointermove="onHover" @pointerleave="hover = null"></canvas>

    <div
      v-if="hover"
      class="roll-tip"
      :style="{ left: hover.x + 'px', top: hover.y + 'px' }"
      role="tooltip"
    >
      <b :class="hover.hit.devMs < 0 ? 'early' : 'late'">
        {{ hover.hit.devMs > 0 ? '+' : '' }}{{ Math.round(hover.hit.devMs) }} ms
      </b>
      <span class="tip-sub">
        {{ hover.hit.devMs < 0 ? 'early' : 'late' }} · beat {{ hover.hit.label }}
        <template v-if="hover.hit.midi"> · {{ noteNameOfMidi(hover.hit.midi) }}</template>
      </span>
    </div>

    <div v-if="!running" class="roll-idle">
      <i class="pi pi-play-circle"></i>
      <span>Start the count to begin</span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { currentContext } from '@/lib/groovy/context'
import { noteNameOfMidi } from '@/lib/groovy/pitch'

const props = defineProps({
  transport: { type: Object, required: true },
  // Live hits, in playing order: { time, devMs, slotTime, slotInBar, label, midi, midiFloat, str }
  hits: { type: Array, default: () => [] },
  // Pitch samples: { t, midiFloat }
  trace: { type: Array, default: () => [] },
  toleranceMs: { type: Number, default: 25 },
  windowBars: { type: Number, default: 2 },
  running: { type: Boolean, default: false },
  recording: { type: Boolean, default: false },
  // While counting in, everything before this context time is shaded out.
  countInUntil: { type: Number, default: 0 },
})

const wrap = ref(null)
const cv = ref(null)
const hover = ref(null)

let raf = 0
let ro = null
let w = 0
let h = 0
let dpr = 1
// Hit positions from the last frame, in CSS pixels, for hover testing.
let picks = []

const NOW_X = 0.72
const OPEN_STRINGS = [
  { midi: 28, name: 'E1' },
  { midi: 33, name: 'A1' },
  { midi: 38, name: 'D2' },
  { midi: 43, name: 'G2' },
]

const C = {
  surface: '#ffffff',
  sunken: '#faf9f7',
  bar: '#b9b6b0',
  pulse: '#d6d4ce',
  medium: '#c8c5bf',
  sub: '#ecebe6',
  ink: '#1a1a1a',
  dim: '#5c5c5c',
  faint: '#9a9a9a',
  early: '#2a78d6',
  late: '#e34948',
  now: '#ef4444',
  band: 'rgba(22, 163, 74, 0.10)',
  bandEdge: 'rgba(22, 163, 74, 0.35)',
  trace: '#6f6c66',
}

// Pitch window, eased toward what is actually being played so the roll does not
// jump a full octave the moment one low note lands.
let loMidi = 26
let hiMidi = 55

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

function fitPitch() {
  let lo = Infinity
  let hi = -Infinity
  for (let i = props.trace.length - 1; i >= 0 && props.trace.length - i < 900; i--) {
    const m = props.trace[i].midiFloat
    if (m < lo) lo = m
    if (m > hi) hi = m
  }
  for (const s of props.hits) {
    if (!s.midiFloat) continue
    if (s.midiFloat < lo) lo = s.midiFloat
    if (s.midiFloat > hi) hi = s.midiFloat
  }
  if (!Number.isFinite(lo)) return
  const targetLo = Math.min(lo - 3, 43)
  const targetHi = Math.max(hi + 3, 33)
  loMidi += (targetLo - loMidi) * 0.04
  hiMidi += (targetHi - hiMidi) * 0.04
  if (hiMidi - loMidi < 12) hiMidi = loMidi + 12
}

function draw() {
  raf = requestAnimationFrame(draw)
  const c = cv.value
  if (!c || !w || !h) return
  const g = c.getContext('2d')
  const ac = currentContext()
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  g.fillStyle = C.surface
  g.fillRect(0, 0, w, h)

  const pitchH = Math.round(h * 0.66)
  const laneY = pitchH + 1
  const laneH = h - laneY

  g.fillStyle = C.sunken
  g.fillRect(0, laneY, w, laneH)

  if (!ac || !props.running || !props.transport?.segments?.length) {
    drawStringRules(g, pitchH)
    return
  }

  fitPitch()

  const now = ac.currentTime
  const windowSec = Math.max(0.5, props.transport.barSeconds() * props.windowBars)
  const t0 = now - NOW_X * windowSec
  const t1 = now + (1 - NOW_X) * windowSec
  const X = (t) => ((t - t0) / (t1 - t0)) * w
  const Y = (midi) => pitchH - ((midi - loMidi) / (hiMidi - loMidi)) * (pitchH - 14) - 7

  const maxDev = Math.max(50, props.toleranceMs * 2.5)
  const centreY = laneY + laneH / 2
  const devY = (ms) => centreY + (Math.max(-maxDev, Math.min(maxDev, ms)) / maxDev) * (laneH / 2 - 6)

  drawGrid(g, X, t0, t1, h, pitchH, laneY)
  drawStringRules(g, pitchH, Y)
  drawToleranceBand(g, devY, laneY, laneH)
  drawTrace(g, X, Y, t0)
  picks = drawHits(g, X, Y, devY, t0, centreY)

  // Count-in: everything before the take starts is dimmed, so the moment
  // recording begins is unmissable without a flashing number.
  if (props.countInUntil > now) {
    g.fillStyle = 'rgba(250, 249, 247, 0.72)'
    g.fillRect(0, 0, w, h)
  }

  // Now-line last so nothing sits on top of it.
  const nx = X(now)
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
}

function drawGrid(g, X, t0, t1, height, pitchH, laneY) {
  const slots = props.transport.slotsBetween(t0, t1)
  g.lineWidth = 1
  for (const s of slots) {
    const x = Math.round(X(s.time)) + 0.5
    if (s.kind === 'sub') g.strokeStyle = C.sub
    else if (s.kind === 'bar') g.strokeStyle = C.bar
    else if (s.kind === 'medium') g.strokeStyle = C.medium
    else g.strokeStyle = C.pulse
    g.beginPath()
    g.moveTo(x, s.kind === 'sub' ? 14 : 0)
    g.lineTo(x, height)
    g.stroke()

    if (s.kind !== 'sub') {
      g.fillStyle = s.kind === 'bar' ? C.dim : C.faint
      g.font = `${s.kind === 'bar' ? 700 : 500} 10px ui-monospace, Menlo, Consolas, monospace`
      g.textAlign = 'left'
      g.fillText(
        s.kind === 'bar' ? String(s.bar + 1) : String(Math.floor(s.slotInBar / s.subdiv) + 1),
        x + 3,
        11,
      )
    }
  }
  g.strokeStyle = C.pulse
  g.beginPath()
  g.moveTo(0, laneY - 0.5)
  g.lineTo(w, laneY - 0.5)
  g.stroke()
}

function drawStringRules(g, pitchH, Y) {
  if (!Y) return
  g.lineWidth = 1
  g.setLineDash([])
  for (const s of OPEN_STRINGS) {
    const y = Math.round(Y(s.midi)) + 0.5
    if (y < 12 || y > pitchH - 2) continue
    g.strokeStyle = '#efeeea'
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(w, y)
    g.stroke()
    g.fillStyle = C.faint
    g.font = '500 9px ui-monospace, Menlo, Consolas, monospace'
    g.textAlign = 'left'
    g.fillText(s.name, 3, y - 3)
  }
}

function drawToleranceBand(g, devY, laneY, laneH) {
  const top = devY(-props.toleranceMs)
  const bottom = devY(props.toleranceMs)
  g.fillStyle = C.band
  g.fillRect(0, top, w, bottom - top)
  g.strokeStyle = C.bandEdge
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(0, Math.round(top) + 0.5)
  g.lineTo(w, Math.round(top) + 0.5)
  g.moveTo(0, Math.round(bottom) + 0.5)
  g.lineTo(w, Math.round(bottom) + 0.5)
  g.stroke()

  const centre = laneY + laneH / 2
  g.strokeStyle = '#c3c2b7'
  g.beginPath()
  g.moveTo(0, Math.round(centre) + 0.5)
  g.lineTo(w, Math.round(centre) + 0.5)
  g.stroke()

  g.fillStyle = C.faint
  g.font = '500 9px ui-monospace, Menlo, Consolas, monospace'
  g.textAlign = 'right'
  g.fillText('early', w - 4, top - 3)
  g.fillText('late', w - 4, bottom + 10)
}

function drawTrace(g, X, Y, t0) {
  const tr = props.trace
  if (tr.length < 2) return
  g.strokeStyle = C.trace
  g.lineWidth = 2
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.beginPath()
  let pen = false
  let prevT = 0
  for (let i = 0; i < tr.length; i++) {
    const p = tr[i]
    if (p.t < t0) continue
    const x = X(p.t)
    const y = Y(p.midiFloat)
    // A gap in the samples is a gap in the playing — don't join across silence.
    if (!pen || p.t - prevT > 0.12) {
      g.moveTo(x, y)
      pen = true
    } else {
      g.lineTo(x, y)
    }
    prevT = p.t
  }
  g.stroke()
}

function drawHits(g, X, Y, devY, t0, centreY) {
  const out = []
  const hits = props.hits
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i]
    if (hit.time < t0) break
    const late = hit.devMs > 0
    const col = late ? C.late : C.early
    const gx = X(hit.slotTime)
    const hx = X(hit.time)

    // Timing lane: a tick from the zero line to the error.
    const y = devY(hit.devMs)
    g.strokeStyle = col
    g.lineWidth = 2
    g.beginPath()
    g.moveTo(Math.round(gx) + 0.5, centreY)
    g.lineTo(Math.round(gx) + 0.5, y)
    g.stroke()
    g.fillStyle = col
    g.beginPath()
    g.arc(gx, y, 3, 0, Math.PI * 2)
    g.fill()

    // Pitch lane: the note, joined back to the grid line it was aiming at.
    if (hit.midiFloat) {
      const py = Y(hit.midiFloat)
      g.strokeStyle = col
      g.globalAlpha = 0.5
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(gx, py)
      g.lineTo(hx, py)
      g.stroke()
      g.globalAlpha = 1

      const r = 4 + Math.min(4, (hit.str || 0) * 26)
      g.fillStyle = C.surface
      g.beginPath()
      g.arc(hx, py, r + 2, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = col
      g.beginPath()
      g.arc(hx, py, r, 0, Math.PI * 2)
      g.fill()
      out.push({ x: hx, y: py, hit })
    } else {
      out.push({ x: gx, y, hit })
    }
  }
  return out
}

function onHover(e) {
  const rect = cv.value?.getBoundingClientRect()
  if (!rect) return
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  let best = null
  let bestD = 24 * 24 // a generous hit area — these are small marks
  for (const p of picks) {
    const d = (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  hover.value = best ? { x: best.x, y: best.y, hit: best.hit } : null
}

onMounted(() => {
  resize()
  ro = new ResizeObserver(resize)
  if (wrap.value) ro.observe(wrap.value)
  raf = requestAnimationFrame(draw)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
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
}

.roll-tip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 0.75rem));
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

.roll-tip b.early {
  color: #8dbcf2;
}

.roll-tip b.late {
  color: #f3a3a3;
}

.tip-sub {
  font-size: 0.66rem;
  color: #c3c2b7;
}

.roll-idle {
  position: absolute;
  inset: 0;
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
