<!-- File: src/components/groovy/GroovyPocket.vue -->
<!--
  The live practice surface: a fixed gauge that answers each note you play and
  never cues the next one.

  The scrolling roll it replaces (still used to replay takes) showed upcoming
  grid lines sliding toward a now-line, which trains you to aim with your eyes
  — the opposite of the skill being practised. Nothing here moves with the
  beat. Nothing moves at all until you play; then the note drops onto an
  early ↔ late axis centred on the beat, and that is the whole interaction.
  Your ears own the time, the screen only reports.

  On the axis:
    the band     the pocket zones in the tool's three colours (pocketZone()):
                 green in, yellow on the edge, red outside the tolerance
    the disc     the latest (or selected) note, labelled like the roll; a
                 short bar joins it to the beat so distance reads at a glance
    the ticks    the last notes as fading afterimages, so a tight cluster and
                 a scattered one look different without a single number
    the bracket  your feel over those notes: mean ± spread, under the band

  Above it, the verdict in words and the run of notes in a row that stayed in
  the pocket. Below it, "where in the bar": the same notes split by grid
  position, which is where a habit like rushing the & of 2 shows up.

  A soft wash of the zone colour crosses the whole panel on each note — enough
  for peripheral vision while your eyes are on the neck.
-->
<template>
  <div class="pk">
    <div v-if="washKey" :key="washKey" class="pk-wash" :class="washZone"></div>

    <header class="pk-head">
      <div class="pk-verdict" :class="zone">
        <span class="pk-eyebrow">
          {{ pinned ? 'Selected note' : focus ? 'Last note' : running ? 'Listening' : 'Ready' }}
        </span>
        <div class="pk-line">
          <Transition name="pk-word" mode="out-in">
            <span :key="headline" class="pk-word">{{ headline }}</span>
          </Transition>
          <span v-if="focus" class="pk-ms">{{ msText }}</span>
        </div>
      </div>

      <div class="pk-streak" :class="{ hot: streak >= 8, none: !streak }">
        <Transition name="pk-pop" mode="out-in">
          <b :key="streak">{{ streak }}</b>
        </Transition>
        <span>
          in a row
          <em v-if="best > streak">best {{ best }}</em>
        </span>
      </div>
    </header>

    <div ref="wrap" class="pk-stage">
      <canvas ref="cv"></canvas>
    </div>

    <footer class="pk-map">
      <div class="pk-map-head">
        <span class="pk-eyebrow">Where in the bar</span>
        <span v-if="insight" class="pk-insight" :class="insight.zone">{{ insight.text }}</span>
      </div>
      <div class="pk-cells" :class="{ dense: cells.length > 12 }">
        <div v-for="(g, gi) in groups" :key="gi" class="pk-group">
          <div
            v-for="c in g"
            :key="c.i"
            class="pk-cell"
            :class="[c.zone || 'empty', { sub: c.sub, worst: insight && insight.i === c.i }]"
            :title="
              c.n
                ? `${c.full}: ${fmtMs(c.mean)} average over ${c.n} notes`
                : `${c.full}: no notes yet`
            "
          >
            <span class="pk-cell-label">{{ c.short }}</span>
            <span class="pk-track">
              <i v-if="c.n" :style="{ left: trackPct(c.mean) }"></i>
            </span>
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { pocketZone, EDGE_FRACTION } from '@/lib/groovy/analysis'
import { markLabel } from '@/lib/groovy/scales'
import { meterById, slotLabel, beatKey } from '@/lib/groovy/grid'

const props = defineProps({
  // Live hits in playing order; a plain array, read every frame.
  hits: { type: Array, default: () => [] },
  // The note to feature — one of `hits`, by identity.
  focus: { type: Object, default: null },
  // Bumped on every new note (and on reset): the DOM half re-reads `hits`.
  tick: { type: Number, default: 0 },
  pinned: { type: Boolean, default: false },
  running: { type: Boolean, default: false },
  toleranceMs: { type: Number, default: 25 },
  scale: { type: Object, default: null },
  labels: { type: String, default: 'degrees' },
  meterId: { type: String, default: '4/4' },
  subdiv: { type: Number, default: 2 },
})

const TRAIL = 28
const MAP_WINDOW = 96

const ZONE = {
  pocket: { fill: '#16a34a', text: '#ffffff', tint: 'rgba(22, 163, 74, 0.15)' },
  edge: { fill: '#f0b400', text: '#3d2c00', tint: 'rgba(240, 180, 0, 0.2)' },
  out: { fill: '#e34948', text: '#ffffff', tint: 'rgba(227, 73, 72, 0.07)' },
}

function zoneOf(d) {
  return pocketZone(d, props.toleranceMs)
}

function fmtMs(d) {
  const r = Math.round(d)
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} ms`
}

// ── Verdict ─────────────────────────────────────────────────────────────────
const zone = computed(() => {
  void props.tick
  return props.focus ? zoneOf(props.focus.devMs) : 'none'
})

const headline = computed(() => {
  const h = props.focus
  if (!h) return props.running ? 'Play.' : 'Start the click and play.'
  const late = h.devMs > 0
  if (zone.value === 'pocket') return 'In the pocket'
  if (zone.value === 'edge') return late ? 'A touch late' : 'A touch early'
  return late ? 'Late' : 'Early'
})

const msText = computed(() => (props.focus ? fmtMs(props.focus.devMs) : ''))

// ── Streak, wash, bar map — re-read on each note ────────────────────────────
const streak = ref(0)
const best = ref(0)
const washKey = ref(0)
const washZone = ref('pocket')
const mapTick = ref(0)

watch(
  () => props.tick,
  () => {
    const hits = props.hits
    if (!hits.length) {
      streak.value = 0
      best.value = 0
      washKey.value = 0
      mapTick.value++
      return
    }
    let n = 0
    for (let i = hits.length - 1; i >= 0 && zoneOf(hits[i].devMs) !== 'out'; i--) n++
    streak.value = n
    if (n > best.value) best.value = n
    washZone.value = zoneOf(hits[hits.length - 1].devMs)
    washKey.value++
    mapTick.value++
  },
)

const meter = computed(() => meterById(props.meterId))

const cells = computed(() => {
  void mapTick.value
  const m = meter.value
  const sub = props.subdiv
  const key = beatKey(props.meterId, sub)
  const out = Array.from({ length: m.pulses * sub }, (_, i) => {
    const full = slotLabel(i, sub, m)
    return {
      i,
      full,
      sub: i % sub > 0,
      short: i % sub ? full.split(' ')[1] : full,
      sum: 0,
      n: 0,
      mean: 0,
      zone: null,
    }
  })
  const hits = props.hits
  for (let k = hits.length - 1, seen = 0; k >= 0 && seen < MAP_WINDOW; k--) {
    const h = hits[k]
    if (h.gridKey !== key) continue
    seen++
    const c = out[h.slotInBar]
    if (!c) continue
    c.sum += h.devMs
    c.n++
  }
  for (const c of out) {
    if (!c.n) continue
    c.mean = c.sum / c.n
    c.zone = zoneOf(c.mean)
  }
  return out
})

const groups = computed(() => {
  const sub = props.subdiv
  const out = []
  for (let i = 0; i < cells.value.length; i += sub) out.push(cells.value.slice(i, i + sub))
  return out
})

// The one position worth a sentence: the furthest from the beat on average,
// once it has enough notes to mean it.
const insight = computed(() => {
  let worst = null
  let notes = 0
  for (const c of cells.value) {
    notes += c.n
    if (c.n < 3) continue
    if (!worst || Math.abs(c.mean) > Math.abs(worst.mean)) worst = c
  }
  if (!worst) return null
  if (Math.abs(worst.mean) <= props.toleranceMs * EDGE_FRACTION * 0.5) {
    return notes >= 8 ? { i: -1, zone: 'pocket', text: 'Even across the bar' } : null
  }
  return {
    i: worst.i,
    zone: worst.zone,
    text: `${worst.mean < 0 ? 'Rushing' : 'Dragging'} “${worst.full}” by ${Math.round(Math.abs(worst.mean))} ms`,
  }
})

function range() {
  return Math.max(45, props.toleranceMs * 3)
}

function trackPct(d) {
  const r = range()
  return `${50 + (Math.max(-r, Math.min(r, d)) / r) * 50}%`
}

// ── Canvas ──────────────────────────────────────────────────────────────────
const wrap = ref(null)
const cv = ref(null)
let w = 0
let h = 0
let dpr = 1
let raf = 0
let ro = null
let landedAt = -1e9

watch(
  () => props.focus,
  (hit, old) => {
    if (hit && hit !== old) landedAt = performance.now()
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

function easeOutBack(t) {
  const c1 = 1.9
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function capsule(g, x, y, ww, hh) {
  const r = Math.min(ww, hh) / 2
  g.beginPath()
  g.roundRect(x, y, ww, hh, r)
}

function draw() {
  raf = requestAnimationFrame(draw)
  const c = cv.value
  if (!c || !w || !h) return
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)

  const tol = props.toleranceMs
  const R = range()
  const bandH = Math.max(40, Math.min(96, h * 0.34))
  const r = Math.max(15, Math.min(30, bandH * 0.4))
  // Room for a disc parked at either end, plus its overflow arrow.
  const side = r + 24
  const x0 = side
  const x1 = w - side
  const cx = (x0 + x1) / 2
  const half = (x1 - x0) / 2
  const X = (d) => cx + (Math.max(-R, Math.min(R, d)) / R) * half

  const cy = Math.round(h * 0.46)
  const top = cy - bandH / 2

  // Band and zones.
  g.save()
  capsule(g, x0, top, x1 - x0, bandH)
  g.fillStyle = '#f6f5f2'
  g.fill()
  g.clip()
  g.fillStyle = ZONE.out.tint
  g.fillRect(x0, top, x1 - x0, bandH)
  const edgeIn = tol * EDGE_FRACTION
  g.fillStyle = ZONE.edge.tint
  g.fillRect(X(-tol), top, X(-edgeIn) - X(-tol), bandH)
  g.fillRect(X(edgeIn), top, X(tol) - X(edgeIn), bandH)
  g.fillStyle = ZONE.pocket.tint
  g.fillRect(X(-edgeIn), top, X(edgeIn) - X(-edgeIn), bandH)
  g.restore()

  // Scale above the band.
  g.font = '500 10px ui-monospace, Menlo, Consolas, monospace'
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  for (const k of [-3, -2, -1, 0, 1, 2, 3]) {
    const d = k * tol
    if (Math.abs(d) > R + 0.01) continue
    const x = Math.round(X(d)) + 0.5
    g.strokeStyle = k === 0 ? '#1a1a1a' : '#cfccc5'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(x, top - 7)
    g.lineTo(x, top - 2)
    g.stroke()
    g.fillStyle = k === 0 ? '#5c5c5c' : '#a3a09a'
    g.fillText(k === 0 ? '0' : `${k > 0 ? '+' : '−'}${Math.abs(d)}`, x, top - 11)
  }

  // Which end is which, inside the band's ends.
  g.font = '800 10px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'
  if ('letterSpacing' in g) g.letterSpacing = '1.5px'
  g.fillStyle = 'rgba(160, 60, 58, 0.55)'
  g.textBaseline = 'middle'
  g.textAlign = 'left'
  g.fillText('EARLY', x0 + bandH * 0.42, cy)
  g.textAlign = 'right'
  g.fillText('LATE', x1 - bandH * 0.42, cy)
  if ('letterSpacing' in g) g.letterSpacing = '0px'

  // Afterimages: the last notes, fading with age.
  const hits = props.hits
  const focus = props.focus
  const trail = []
  for (let i = hits.length - 1; i >= 0 && trail.length < TRAIL; i--) trail.push(hits[i])
  for (let a = trail.length - 1; a >= 0; a--) {
    const hit = trail[a]
    if (hit === focus) continue
    g.globalAlpha = 0.07 + 0.55 * Math.pow(1 - a / TRAIL, 1.6)
    g.fillStyle = ZONE[zoneOf(hit.devMs)].fill
    capsule(g, X(hit.devMs) - 2, cy - bandH * 0.3, 4, bandH * 0.6)
    g.fill()
  }
  g.globalAlpha = 1

  // The beat.
  g.strokeStyle = '#1a1a1a'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(cx, top - 2)
  g.lineTo(cx, top + bandH + 2)
  g.stroke()

  // Feel bracket under the band.
  if (trail.length >= 4) {
    let sum = 0
    for (const t of trail) sum += t.devMs
    const m = sum / trail.length
    let ss = 0
    for (const t of trail) ss += (t.devMs - m) ** 2
    const sd = Math.sqrt(ss / (trail.length - 1))
    const by = top + bandH + 15
    const la = X(m - sd)
    const lb = X(m + sd)
    g.strokeStyle = '#8a8780'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(la, by - 4)
    g.lineTo(la, by)
    g.lineTo(lb, by)
    g.lineTo(lb, by - 4)
    g.stroke()
    const mx = X(m)
    g.fillStyle = '#1a1a1a'
    g.beginPath()
    g.moveTo(mx, by - 6)
    g.lineTo(mx - 5, by + 2)
    g.lineTo(mx + 5, by + 2)
    g.closePath()
    g.fill()
    g.font = '600 11px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'top'
    g.fillStyle = '#5c5c5c'
    const label = `feel ${fmtMs(m)} · spread ±${Math.round(sd)}`
    const tw = g.measureText(label).width / 2
    g.fillText(label, Math.max(x0 + tw, Math.min(x1 - tw, mx)), by + 7)
  }

  if (!focus) return

  // The featured note: a bar from the beat, then the disc dropping in.
  const zf = ZONE[zoneOf(focus.devMs)]
  const fx = X(focus.devMs)
  const now = performance.now()
  const e = Math.min(1, (now - landedAt) / 380)
  const eb = easeOutBack(e)

  g.strokeStyle = zf.fill
  g.globalAlpha = 0.9 * Math.min(1, e * 2)
  g.lineWidth = 5
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(cx, cy)
  g.lineTo(cx + (fx - cx) * Math.min(1, eb), cy)
  g.stroke()
  g.lineCap = 'butt'
  g.globalAlpha = 1

  const e2 = Math.min(1, (now - landedAt) / 750)
  if (e2 < 1) {
    g.strokeStyle = zf.fill
    g.globalAlpha = 0.55 * Math.pow(1 - e2, 1.5)
    g.lineWidth = 2
    g.beginPath()
    g.arc(fx, cy, r * (1 + 1.7 * e2), 0, Math.PI * 2)
    g.stroke()
    g.globalAlpha = 1
  }

  const dy = (1 - eb) * -bandH * 0.9
  const rr = r * (0.6 + 0.4 * eb)
  const y = cy + dy

  // Past the end of the scale: the disc waits at the edge, pointing on.
  if (Math.abs(focus.devMs) > R) {
    const dir = Math.sign(focus.devMs)
    const tx = fx + dir * (rr + 10)
    g.fillStyle = zf.fill
    g.beginPath()
    g.moveTo(tx + dir * 7, y)
    g.lineTo(tx, y - 6)
    g.lineTo(tx, y + 6)
    g.closePath()
    g.fill()
  }

  g.shadowColor = 'rgba(0, 0, 0, 0.18)'
  g.shadowBlur = 10
  g.shadowOffsetY = 3
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.arc(fx, y, rr + 3, 0, Math.PI * 2)
  g.fill()
  g.shadowColor = 'transparent'
  g.shadowBlur = 0
  g.shadowOffsetY = 0

  g.fillStyle = zf.fill
  g.beginPath()
  g.arc(fx, y, rr, 0, Math.PI * 2)
  g.fill()

  const pitched = focus.midi != null
  const tones = props.scale?.tones
  const inKey = !pitched || !tones || tones.has(((focus.midi % 12) + 12) % 12)
  if (!inKey) {
    g.strokeStyle = '#1a1a1a'
    g.lineWidth = 2.5
    g.setLineDash([5, 3.5])
    g.beginPath()
    g.arc(fx, y, rr + 6, 0, Math.PI * 2)
    g.stroke()
    g.setLineDash([])
  }

  const text = pitched ? markLabel(focus.midi, props.scale, props.labels) : '?'
  const font = Math.round(rr * (text.length > 2 ? 0.6 : 0.74))
  g.fillStyle = zf.text
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `800 ${font}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`
  g.fillText(text, fx, y + 1)

  if (props.pinned) {
    g.strokeStyle = '#2a78d6'
    g.lineWidth = 3
    g.beginPath()
    g.arc(fx, y, rr + (inKey ? 7 : 11), 0, Math.PI * 2)
    g.stroke()
  }
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
.pk {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  overflow: hidden;
}

/* ── Wash ── */
.pk-wash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  animation: pk-wash 900ms ease-out forwards;
}

.pk-wash.pocket {
  background: radial-gradient(
    120% 90% at 50% 46%,
    rgba(22, 163, 74, 0.16),
    rgba(22, 163, 74, 0.04) 70%
  );
}

.pk-wash.edge {
  background: radial-gradient(
    120% 90% at 50% 46%,
    rgba(240, 180, 0, 0.18),
    rgba(240, 180, 0, 0.04) 70%
  );
}

.pk-wash.out {
  background: radial-gradient(
    120% 90% at 50% 46%,
    rgba(227, 73, 72, 0.17),
    rgba(227, 73, 72, 0.04) 70%
  );
}

@keyframes pk-wash {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

/* ── Head ── */
.pk-head {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1.1rem 0;
  flex-shrink: 0;
}

.pk-eyebrow {
  font-size: 0.64rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}

/* Fixed height and no wrapping: the headline swapping must not resize the
   stage (and with it the canvas) on every note. */
.pk-verdict {
  min-width: 0;
}

.pk-line {
  height: 2.4rem;
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  white-space: nowrap;
}

.pk-word {
  display: inline-block;
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.03em;
  color: var(--text);
}

.pk-verdict.none .pk-word {
  color: var(--text-faint);
  font-weight: 700;
  font-size: 1.6rem;
}

.pk-verdict.pocket .pk-word {
  color: #15803d;
}

.pk-verdict.edge .pk-word {
  color: #a16207;
}

.pk-verdict.out .pk-word {
  color: #c62828;
}

.pk-ms {
  font-family: var(--mono);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.pk-word-enter-active,
.pk-word-leave-active {
  transition:
    opacity 120ms ease,
    transform 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
}

.pk-word-enter-from {
  opacity: 0;
  transform: translateY(0.35rem);
}

.pk-word-leave-to {
  opacity: 0;
  transform: translateY(-0.25rem);
}

/* ── Streak ── */
.pk-streak {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.35rem 0.8rem 0.35rem 0.6rem;
  border-radius: 999px;
  background: var(--bg-sunken);
  transition: background 200ms;
}

.pk-streak b {
  display: inline-block;
  min-width: 1.6rem;
  text-align: center;
  font-size: 1.6rem;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.pk-streak span {
  display: flex;
  flex-direction: column;
  font-size: 0.64rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  line-height: 1.25;
  color: var(--text-faint);
}

.pk-streak em {
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: none;
}

.pk-streak.none b {
  color: var(--text-faint);
}

.pk-streak.hot {
  background: #dcfce7;
}

.pk-streak.hot b {
  color: #15803d;
}

.pk-pop-enter-active {
  transition: transform 220ms cubic-bezier(0.3, 1.6, 0.5, 1);
}

.pk-pop-enter-from {
  transform: scale(1.35);
}

/* ── Stage ── */
.pk-stage {
  position: relative;
  flex: 1;
  min-height: 7rem;
}

.pk-stage canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* ── Bar map ── */
.pk-map {
  position: relative;
  flex-shrink: 0;
  padding: 0 1.1rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.pk-map-head {
  height: 1.1rem;
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.pk-insight {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-dim);
}

.pk-insight.pocket {
  color: #15803d;
}

.pk-insight.edge {
  color: #a16207;
}

.pk-insight.out {
  color: #c62828;
}

.pk-cells {
  display: flex;
  gap: 0.6rem;
}

.pk-cells.dense {
  gap: 0.35rem;
}

.pk-group {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 0.2rem;
}

.pk-cell {
  flex: 1.35;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.3rem 0.35rem 0.4rem;
  border-radius: 0.45rem;
  background: var(--bg-sunken);
  transition: background 200ms;
}

.pk-cell.sub {
  flex: 1;
}

.pk-cell-label {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-dim);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}

.pk-cell.sub .pk-cell-label {
  font-weight: 500;
  color: var(--text-faint);
}

.pk-track {
  position: relative;
  height: 0.5rem;
}

.pk-track::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: #dcd9d3;
}

.pk-track::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #9a9a9a;
}

.pk-track i {
  position: absolute;
  top: 50%;
  width: 0.5rem;
  height: 0.5rem;
  margin: -0.25rem 0 0 -0.25rem;
  border-radius: 999px;
  z-index: 1;
  transition: left 300ms cubic-bezier(0.3, 1.3, 0.5, 1);
}

.pk-cell.pocket .pk-track i {
  background: #16a34a;
}

.pk-cell.edge .pk-track i {
  background: #f0b400;
}

.pk-cell.out .pk-track i {
  background: #e34948;
}

.pk-cell.worst {
  background: #fff;
  box-shadow: inset 0 0 0 1.5px currentColor;
}

.pk-cell.worst.edge {
  color: #f0b400;
}

.pk-cell.worst.out {
  color: #e34948;
}

@media (max-width: 860px) {
  .pk-word {
    font-size: 1.6rem;
  }

  .pk-map {
    display: none;
  }
}
</style>
