<!-- File: src/components/groovy/GroovyFretboard.vue -->
<!--
  Scale map: every fret in the chosen key, on the chosen neck.

  Drawn as it looks from the player's seat in tab: highest string on top, so it
  reads the same way up as the roll's pitch lane above it. Frets are evenly
  spaced rather than to scale — on a real neck the 20th fret is less than a
  third the width of the 1st, and the dots up there would have to shrink to
  match. Even spacing keeps every label the same size wherever the range sits.

  The root is the only coloured dot. Everything else in the key is ink, and
  anything outside the key is simply not drawn.

  Width follows the container. When the range asks for more frets than fit at a
  readable size, the board keeps its minimum fret width and scrolls sideways
  inside the panel instead of shrinking the labels.

  `lit` is the note selected on the roll (or sounding in a replay). Every place
  it can be fretted in view gets a blue ring — a detected pitch never says which
  string it was played on. A lit note outside the key has no dot of its own, so
  it gets a dashed one.
-->
<template>
  <section class="fb" :class="{ closed: !value.open }">
    <header class="fb-head">
      <button class="fb-toggle" @click="set({ open: !value.open })" :aria-expanded="value.open">
        <i class="pi" :class="value.open ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
        <span class="fb-title">Scale</span>
        <span class="fb-name">{{ scale.name }}</span>
        <span v-if="value.open && litOffRange" class="fb-lit">{{ litName }} is outside these frets</span>
      </button>

      <template v-if="value.open">
        <label class="sel">
          <span class="sel-label">Key</span>
          <select :value="value.root" @change="set({ root: +$event.target.value })">
            <option v-for="r in ROOTS" :key="r.pc" :value="r.pc">{{ r.label }}</option>
          </select>
        </label>

        <div class="seg" role="group" aria-label="Scale">
          <button
            v-for="s in SCALES"
            :key="s.id"
            :class="{ on: value.type === s.id }"
            @click="set({ type: s.id })"
          >
            {{ s.label }}
          </button>
        </div>

        <div class="seg" role="group" aria-label="Labels">
          <button :class="{ on: value.labels === 'degrees' }" @click="set({ labels: 'degrees' })">
            Degrees
          </button>
          <button :class="{ on: value.labels === 'notes' }" @click="set({ labels: 'notes' })">
            Notes
          </button>
        </div>

        <div class="range">
          <span class="sel-label">Frets</span>
          <button class="nudge" :disabled="value.from <= 0" title="Move down the neck" @click="shift(-1)">
            <i class="pi pi-chevron-left"></i>
          </button>
          <select :value="value.from" aria-label="From fret" @change="setFrom(+$event.target.value)">
            <option v-for="f in MAX_FRET" :key="f - 1" :value="f - 1">{{ f - 1 }}</option>
          </select>
          <span class="dash">–</span>
          <select :value="value.to" aria-label="To fret" @change="setTo(+$event.target.value)">
            <option v-for="f in MAX_FRET" :key="f" :value="f">{{ f }}</option>
          </select>
          <button class="nudge" :disabled="value.to >= MAX_FRET" title="Move up the neck" @click="shift(1)">
            <i class="pi pi-chevron-right"></i>
          </button>
          <button class="chip" :class="{ on: wholeNeck }" @click="set({ from: 0, to: MAX_FRET })">
            Whole neck
          </button>
        </div>

        <label class="sel fb-tuning">
          <select :value="value.tuning" aria-label="Instrument" @change="set({ tuning: $event.target.value })">
            <option v-for="t in TUNINGS" :key="t.id" :value="t.id">{{ t.label }}</option>
          </select>
        </label>
      </template>
    </header>

    <div v-if="value.open" class="fb-scroll" ref="scroller">
      <svg
        class="fb-svg"
        :width="g.width"
        :height="g.height"
        :viewBox="`0 0 ${g.width} ${g.height}`"
        role="img"
        :aria-label="`${scale.name}, frets ${value.from} to ${value.to}`"
      >
        <!-- Board -->
        <rect
          :x="g.boardX"
          :y="g.top - g.rowH * 0.5"
          :width="g.boardW"
          :height="g.rowH * strings.length"
          class="board"
        />

        <!-- Inlays -->
        <template v-for="f in inlays" :key="'in' + f">
          <template v-if="f % 12 === 0">
            <circle :cx="g.mid(f)" :cy="g.top + g.span * 0.25" :r="g.inlayR" class="inlay" />
            <circle :cx="g.mid(f)" :cy="g.top + g.span * 0.75" :r="g.inlayR" class="inlay" />
          </template>
          <circle v-else :cx="g.mid(f)" :cy="g.top + g.span * 0.5" :r="g.inlayR" class="inlay" />
        </template>

        <!-- Fret wires; the nut when the open strings are in view -->
        <line
          v-for="f in wires"
          :key="'w' + f"
          :x1="g.wire(f)"
          :x2="g.wire(f)"
          :y1="g.top - g.rowH * 0.5"
          :y2="g.bottom + g.rowH * 0.5"
          :class="f === 0 ? 'nut' : 'wire'"
        />

        <!-- Strings, heaviest at the bottom -->
        <g v-for="(s, i) in strings" :key="'s' + i">
          <text :x="g.labelW / 2" :y="g.y(i)" class="str-name">{{ stringName(s, scale) }}</text>
          <line
            :x1="g.boardX"
            :x2="g.boardX + g.boardW"
            :y1="g.y(i)"
            :y2="g.y(i)"
            class="string"
            :stroke-width="gauge(i)"
          />
        </g>

        <!-- Notes in the key -->
        <g
          v-for="d in dots"
          :key="d.key"
          class="dot"
          :class="{ root: d.tone.root }"
        >
          <title>{{ d.tone.note }} · {{ d.tone.degreeLabel }} · {{ d.fret === 0 ? 'open' : 'fret ' + d.fret }}, {{ stringName(strings[d.string], scale) }} string</title>
          <circle :cx="d.x" :cy="d.y" :r="g.dotR" />
          <text :x="d.x" :y="d.y" :style="{ fontSize: g.font + 'px' }">
            {{ value.labels === 'notes' ? d.tone.note : d.tone.degreeLabel }}
          </text>
        </g>

        <!-- The selected note -->
        <g v-for="l in litDots" :key="l.key" class="lit" :class="{ outside: !l.inKey }">
          <title>{{ litName }} · {{ l.fret === 0 ? 'open' : 'fret ' + l.fret }}, {{ stringName(strings[l.string], scale) }} string</title>
          <template v-if="!l.inKey">
            <circle :cx="l.x" :cy="l.y" :r="g.dotR" class="ghost" />
            <text :x="l.x" :y="l.y" :style="{ fontSize: g.font + 'px' }">{{ litPlain }}</text>
          </template>
          <circle :cx="l.x" :cy="l.y" :r="g.dotR + 4" class="halo" />
        </g>

        <!-- Fret numbers -->
        <text
          v-for="f in numbered"
          :key="'n' + f"
          :x="g.mid(f)"
          :y="g.bottom + g.rowH * 0.5 + 12"
          class="fret-num"
          :class="{ marked: INLAYS.includes(f) }"
        >
          {{ f }}
        </text>
      </svg>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  SCALES,
  TUNINGS,
  ROOTS,
  MAX_FRET,
  buildScale,
  tuningById,
  stringName,
  noteLabel,
  positionsOf,
} from '@/lib/groovy/scales'

const props = defineProps({
  // { open, root, type, labels, from, to, tuning } — prefs.scale
  value: { type: Object, required: true },
  // { midi, key } — the note to light, or null. `key` changes per note so the
  // ring pops again when the same pitch is played twice.
  lit: { type: Object, default: null },
})
const emit = defineEmits(['update'])

const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]
// Below this a two-character label ("♭7", "F♯") no longer fits inside its dot.
// 32 is also what lets the whole neck fit a 1440-wide screen without scrolling.
const MIN_FRET_W = 32

const scroller = ref(null)
const width = ref(0)
let ro = null

const scale = computed(() => buildScale(props.value.root, props.value.type))
const strings = computed(() => tuningById(props.value.tuning).strings)
const wholeNeck = computed(() => props.value.from === 0 && props.value.to === MAX_FRET)

function set(patch) {
  emit('update', patch)
}

function setFrom(f) {
  set({ from: f, to: Math.max(props.value.to, f + 1) })
}

function setTo(f) {
  set({ to: f, from: Math.min(props.value.from, f - 1) })
}

// Slide the window along the neck, keeping its width.
function shift(d) {
  const { from, to } = props.value
  if (from + d < 0 || to + d > MAX_FRET) return
  set({ from: from + d, to: to + d })
}

// ── Geometry ────────────────────────────────────────────────────────────────
// Columns: an "open" column left of the nut when fret 0 is in range, then one
// column per fret. A fret's column sits between wire f−1 and wire f, which is
// where the finger goes and so where the dot is drawn.
const g = computed(() => {
  const { from, to } = props.value
  const first = Math.max(from, 1)
  const n = to - first + 1
  const openCols = from === 0 ? 0.75 : 0
  const labelW = 30
  const padR = 10
  const avail = Math.max(0, width.value - labelW - padR)
  const fretW = Math.max(MIN_FRET_W, avail / (n + openCols))
  const openW = openCols * fretW

  const count = strings.value.length
  // Rows open up when frets are wide, so zooming in on a few frets actually
  // makes the labels bigger — but only so far, or the roll pays for it.
  const rowH = Math.round(Math.min(40, Math.max(28, fretW * 0.3)))
  const top = rowH * 0.5 + 6
  const span = (count - 1) * rowH
  const bottom = top + span
  const dotR = Math.min(rowH, fretW) * 0.42

  const boardX = labelW + openW
  const wire = (f) => boardX + (f - (first - 1)) * fretW
  return {
    labelW,
    rowH,
    top,
    span,
    bottom,
    boardX,
    boardW: n * fretW,
    width: Math.floor(labelW + openW + n * fretW + padR),
    height: Math.round(bottom + rowH * 0.5 + 20),
    dotR,
    inlayR: Math.max(3, rowH * 0.13),
    font: Math.round(dotR * 0.95),
    wire,
    mid: (f) => (f === 0 ? labelW + openW / 2 : wire(f - 1) + fretW / 2),
    y: (i) => top + (count - 1 - i) * rowH,
  }
})

const wires = computed(() => {
  const out = []
  for (let f = Math.max(props.value.from, 1) - 1; f <= props.value.to; f++) out.push(f)
  return out
})

const numbered = computed(() => {
  const out = []
  for (let f = Math.max(props.value.from, 1); f <= props.value.to; f++) out.push(f)
  return out
})

const inlays = computed(() => numbered.value.filter((f) => INLAYS.includes(f)))

const dots = computed(() => {
  const out = []
  const { from, to } = props.value
  strings.value.forEach((open, i) => {
    for (let f = from; f <= to; f++) {
      const tone = scale.value.tones.get((open + f) % 12)
      if (!tone) continue
      out.push({ key: `${i}:${f}`, string: i, fret: f, tone, x: g.value.mid(f), y: g.value.y(i) })
    }
  })
  return out
})

const litDots = computed(() => {
  const l = props.lit
  if (!l || l.midi == null) return []
  const { from, to } = props.value
  const inKey = scale.value.tones.has(((l.midi % 12) + 12) % 12)
  return positionsOf(l.midi, strings.value)
    .filter((p) => p.fret >= from && p.fret <= to)
    .map((p) => ({
      key: `${l.key}:${p.string}:${p.fret}`,
      string: p.string,
      fret: p.fret,
      inKey,
      x: g.value.mid(p.fret),
      y: g.value.y(p.string),
    }))
})

const litName = computed(() => (props.lit?.midi != null ? noteLabel(props.lit.midi, scale.value) : ''))
const litPlain = computed(() => (props.lit?.midi != null ? stringName(props.lit.midi, scale.value) : ''))
const litOffRange = computed(() => props.lit?.midi != null && !litDots.value.length)

// Heavier strings drawn heavier, low string at the bottom.
function gauge(i) {
  const n = strings.value.length
  return n > 1 ? 2.4 - (1.4 * i) / (n - 1) : 1.6
}

// ── Sizing ──────────────────────────────────────────────────────────────────
function measure() {
  width.value = scroller.value?.clientWidth || 0
}

function observe() {
  ro?.disconnect()
  if (!scroller.value) return
  ro = new ResizeObserver(measure)
  ro.observe(scroller.value)
  measure()
}

watch(
  () => props.value.open,
  async (open) => {
    if (!open) return
    await nextTick()
    observe()
  },
)

onMounted(observe)
onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.fb {
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
  padding: 0.45rem 0.6rem 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.fb.closed {
  padding-bottom: 0.45rem;
}

:where(.fb button) {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

.fb button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.fb select {
  font: inherit;
  color: inherit;
}

/* ── Header ── */
.fb-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem 0.6rem;
}

.fb-toggle {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  margin-right: auto;
  min-width: 0;
}

.fb-toggle .pi {
  font-size: 0.6rem;
  color: var(--text-faint);
  align-self: center;
}

.fb-title {
  font-size: 0.8rem;
  font-weight: 800;
}

.fb-name {
  font-size: 0.74rem;
  color: var(--text-dim);
  white-space: nowrap;
}

.sel {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.sel-label {
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
}

.sel select,
.range select {
  height: 1.7rem;
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  background: #fff;
  padding: 0 0.3rem;
  font-size: 0.74rem;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  background: var(--bg-sunken);
  padding: 0.1rem;
  gap: 0.1rem;
}

.seg button {
  height: 1.45rem;
  padding: 0 0.55rem;
  border-radius: 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-dim);
  white-space: nowrap;
}

.seg button.on {
  background: #fff;
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.range {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.dash {
  color: var(--text-faint);
  font-size: 0.74rem;
}

.nudge {
  width: 1.5rem;
  height: 1.7rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-dim);
  font-size: 0.6rem;
  display: grid;
  place-items: center;
}

.nudge:not(:disabled):hover,
.chip:hover {
  border-color: var(--accent-400);
  color: var(--accent-600);
}

.chip {
  height: 1.7rem;
  padding: 0 0.6rem;
  margin-left: 0.2rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-dim);
  white-space: nowrap;
}

.chip.on {
  background: var(--accent-050);
  border-color: var(--accent-400);
  color: var(--accent-600);
}

/* ── Board ── */
/* contain: the SVG's width must not count toward the layout's min-content
   width, or a long neck widens the whole page instead of scrolling in here. */
.fb-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  min-width: 0;
  contain: inline-size;
}

.fb-svg {
  display: block;
  font-family: inherit;
}

.board {
  fill: #faf9f7;
}

.inlay {
  fill: #e4e2dc;
}

.wire {
  stroke: #cfccc5;
  stroke-width: 1.5;
}

.nut {
  stroke: #5c5c5c;
  stroke-width: 4;
}

.string {
  stroke: #a19d95;
}

.str-name {
  font-size: 0.72rem;
  font-weight: 700;
  fill: var(--text-faint);
  text-anchor: middle;
  dominant-baseline: central;
}

.fret-num {
  font-size: 0.66rem;
  fill: #b5b2ab;
  text-anchor: middle;
  font-variant-numeric: tabular-nums;
}

.fret-num.marked {
  fill: var(--text-dim);
  font-weight: 700;
}

.dot circle {
  fill: var(--text);
}

.dot.root circle {
  fill: var(--accent-500);
}

.dot text {
  fill: #fff;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}

.fb-lit {
  font-size: 0.7rem;
  font-weight: 600;
  color: #2a78d6;
  white-space: nowrap;
}

.lit .halo {
  fill: rgba(42, 120, 214, 0.12);
  stroke: #2a78d6;
  stroke-width: 3;
  transform-box: fill-box;
  transform-origin: center;
  animation: lit-pop 220ms ease-out;
}

.lit .ghost {
  fill: #fff;
  stroke: var(--text);
  stroke-width: 1.5;
  stroke-dasharray: 3 2;
}

.lit text {
  fill: var(--text);
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}

@keyframes lit-pop {
  from {
    transform: scale(1.35);
    opacity: 0;
  }
}
</style>
