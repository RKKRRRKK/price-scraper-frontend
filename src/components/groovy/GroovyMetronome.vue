<!-- File: src/components/groovy/GroovyMetronome.vue -->
<!--
  Everything the click does, in one sheet.

  The centre of it is the beat editor: one pad per slot of the bar, grouped by
  pulse, whose height is the weight that slot plays at — accent, normal, soft,
  or nothing. A click cycles a pad; a drag across the row draws the heights
  straight in, the way a step sequencer does. The pattern is kept per meter +
  subdivision (beatKey in grid.js), because the slots of one are not the slots
  of another.

  Below that, the gap trainer: N bars of click, then M of silence. The grid and
  the detector keep running through the silence, so it is a test of where your
  own time drifts with nothing to lean on — the Pocket still scores every note.

  While the count runs, the pad being played lights up. That is fine here:
  this is the place you set the click up, not the place you play against it.
-->
<template>
  <div class="mt">
    <!-- ── Tempo ── -->
    <section class="mt-hero">
      <button
        class="mt-round"
        title="Slower (hold to repeat)"
        @pointerdown="holdStart(-1)"
        @pointerup="holdEnd"
        @pointerleave="holdEnd"
        @click="keyNudge($event, -1)"
      >
        <i class="pi pi-minus"></i>
      </button>

      <div class="mt-bpm">
        <input
          v-model="bpmDraft"
          class="mt-bpm-num"
          inputmode="numeric"
          aria-label="Tempo in beats per minute"
          @focus="bpmEditing = true"
          @blur="commitBpm"
          @keydown.enter="$event.target.blur()"
        />
        <div class="mt-bpm-sub">
          <span>bpm</span>
          <i></i>
          <em>{{ marking }}</em>
        </div>
      </div>

      <button
        class="mt-round"
        title="Faster (hold to repeat)"
        @pointerdown="holdStart(1)"
        @pointerup="holdEnd"
        @pointerleave="holdEnd"
        @click="keyNudge($event, 1)"
      >
        <i class="pi pi-plus"></i>
      </button>

      <button class="mt-tap" :class="{ hit: tapHit }" title="Tap the tempo" @click="onTap">
        <span>Tap</span>
      </button>
    </section>

    <input
      class="rng mt-tempo-slider"
      type="range"
      min="30"
      max="260"
      step="1"
      :value="prefs.bpm"
      :style="{ '--pct': pct(prefs.bpm, 30, 260) }"
      aria-label="Tempo"
      @input="emit('update', { bpm: +$event.target.value })"
    />

    <!-- ── Meter + grid ── -->
    <section class="mt-row">
      <div class="mt-field">
        <span class="mt-label">Meter</span>
        <div class="seg">
          <button
            v-for="m in METERS"
            :key="m.id"
            :class="{ on: prefs.meterId === m.id }"
            @click="emit('meter', m.id)"
          >
            {{ m.label }}
          </button>
        </div>
      </div>
      <div class="mt-field">
        <span class="mt-label">Grid</span>
        <div class="seg">
          <button
            v-for="s in subdivs"
            :key="s.n"
            :class="{ on: prefs.subdiv === s.n }"
            :title="s.label"
            @click="emit('update', { subdiv: s.n })"
          >
            {{ s.glyph }}
          </button>
        </div>
      </div>
    </section>

    <!-- ── Beats ── -->
    <section class="mt-sec">
      <div class="mt-sec-head">
        <span class="mt-label">Beats</span>
        <div class="mt-presets">
          <button
            v-for="pr in presets"
            :key="pr.id"
            class="chip"
            :class="{ on: same(pr.beats, beats) }"
            @click="setBeats(pr.beats)"
          >
            {{ pr.label }}
          </button>
        </div>
      </div>

      <div
        ref="padsEl"
        class="pads"
        :class="{ silent: silentNow, dense: beats.length > 12 }"
        @pointermove="padsMove"
        @pointerup="padsUp"
        @pointercancel="drag = null"
      >
        <div v-for="(group, gi) in groups" :key="gi" class="pad-group">
          <div v-for="s in group" :key="s.i" class="pad-col" :class="{ sub: s.sub }">
            <button
              class="pad"
              :class="[STATE_CLASS[beats[s.i]], { lit: nowSlot === s.i }]"
              :data-i="s.i"
              :aria-label="`Beat ${s.full}: ${STATE_WORD[beats[s.i]]}`"
              @pointerdown="padDown($event, s.i)"
              @click="padKeyClick($event, s.i)"
              @contextmenu.prevent="cycle(s.i, -1)"
              @keydown.up.prevent.stop="step(s.i, 1)"
              @keydown.down.prevent.stop="step(s.i, -1)"
            >
              <span class="pad-fill"></span>
            </button>
            <span class="pad-label">{{ s.short }}</span>
          </div>
        </div>
        <div v-if="silentNow" class="pads-silent">Silent bar</div>
      </div>

      <div class="mt-legend">
        <span v-for="k in ['a', 'n', 's', 'm']" :key="k" class="lg">
          <i :class="STATE_CLASS[k]"></i>{{ STATE_WORD[k] }}
        </span>
        <span class="lg-hint">Click to cycle, drag to draw.</span>
      </div>
    </section>

    <div class="mt-grid">
      <!-- ── Sound ── -->
      <section class="mt-sec">
        <div class="mt-sec-head">
          <span class="mt-label">Sound</span>
        </div>
        <div class="sounds">
          <button
            v-for="s in CLICK_SOUNDS"
            :key="s.id"
            class="snd"
            :class="{ on: prefs.clickSound === s.id }"
            :title="`${s.label} — click to hear it`"
            @click="pickSound(s.id)"
          >
            <svg viewBox="0 0 64 22" class="snd-wave" aria-hidden="true">
              <path :d="WAVES[s.id]" />
            </svg>
            <span>{{ s.label }}</span>
          </button>
        </div>

        <div class="vol">
          <button
            class="sw"
            role="switch"
            :aria-checked="prefs.clickOn"
            :class="{ on: prefs.clickOn }"
            title="Click on/off"
            @click="emit('update', { clickOn: !prefs.clickOn })"
          >
            <span></span>
          </button>
          <i class="pi" :class="prefs.clickOn ? 'pi-volume-up' : 'pi-volume-off'"></i>
          <input
            class="rng"
            type="range"
            min="0"
            max="1.4"
            step="0.02"
            :value="prefs.clickLevel"
            :disabled="!prefs.clickOn"
            :style="{ '--pct': pct(prefs.clickLevel, 0, 1.4) }"
            aria-label="Click volume"
            @input="emit('update', { clickLevel: +$event.target.value })"
          />
          <span class="vol-n">{{ Math.round((prefs.clickLevel / 1.4) * 100) }}</span>
        </div>
      </section>

      <div class="mt-col">
        <!-- ── Gap ── -->
        <section class="mt-sec">
          <div class="mt-sec-head">
            <span class="mt-label">Gap</span>
            <button
              class="sw"
              role="switch"
              :aria-checked="gap.on"
              :class="{ on: gap.on }"
              title="Gap trainer on/off"
              @click="setGap({ on: !gap.on })"
            >
              <span></span>
            </button>
          </div>

          <div class="gap" :class="{ off: !gap.on }">
            <div class="gap-steps">
              <div class="stepper">
                <span>Play</span>
                <button :disabled="gap.play <= 1" @click="setGap({ play: gap.play - 1 })">
                  <i class="pi pi-minus"></i>
                </button>
                <b>{{ gap.play }}</b>
                <button :disabled="gap.play >= 16" @click="setGap({ play: gap.play + 1 })">
                  <i class="pi pi-plus"></i>
                </button>
              </div>
              <div class="stepper">
                <span>Silent</span>
                <button :disabled="gap.mute <= 1" @click="setGap({ mute: gap.mute - 1 })">
                  <i class="pi pi-minus"></i>
                </button>
                <b>{{ gap.mute }}</b>
                <button :disabled="gap.mute >= 16" @click="setGap({ mute: gap.mute + 1 })">
                  <i class="pi pi-plus"></i>
                </button>
              </div>
            </div>
            <div class="gap-strip" aria-hidden="true">
              <span
                v-for="k in gap.play + gap.mute"
                :key="k"
                :class="{ rest: k > gap.play, lit: gap.on && nowCycle === k - 1 }"
              ></span>
            </div>
            <p class="mt-hint">Silent bars still get measured.</p>
          </div>
        </section>

        <!-- ── Drums ── -->
        <section class="mt-sec mt-drums">
          <div class="mt-sec-head">
            <span class="mt-label">Drums</span>
            <button
              class="sw"
              role="switch"
              :aria-checked="prefs.drumsOn"
              :class="{ on: prefs.drumsOn }"
              title="Drums on/off"
              @click="emit('update', { drumsOn: !prefs.drumsOn })"
            >
              <span></span>
            </button>
          </div>
          <div class="drums" :class="{ off: !prefs.drumsOn }">
            <div class="mt-presets">
              <button
                v-for="pt in drumPatterns"
                :key="pt.id"
                class="chip"
                :class="{ on: drumId === pt.id }"
                @click="emit('update', { patternId: pt.id, drumsOn: true })"
              >
                {{ pt.label }}
              </button>
            </div>
            <div class="vol">
              <i class="pi pi-volume-up"></i>
              <input
                class="rng"
                type="range"
                min="0"
                max="1.4"
                step="0.02"
                :value="prefs.drumLevel"
                :style="{ '--pct': pct(prefs.drumLevel, 0, 1.4) }"
                aria-label="Drum volume"
                @input="emit('update', { drumLevel: +$event.target.value })"
              />
              <span class="vol-n">{{ Math.round((prefs.drumLevel / 1.4) * 100) }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  METERS,
  meterById,
  subdivisionsFor,
  slotLabel,
  beatKey,
  defaultBeats,
  beatPresets,
  BEAT_CYCLE,
  patternsFor,
  patternById,
} from '@/lib/groovy/grid'
import { CLICK_SOUNDS } from '@/lib/groovy/click'

const props = defineProps({
  prefs: { type: Object, required: true },
  running: { type: Boolean, default: false },
  // () => { slot, spb, cycle, silent } for what is sounding now, or null.
  now: { type: Function, default: null },
})
const emit = defineEmits(['update', 'meter', 'tap', 'preview'])

const STATE_CLASS = { a: 'st-a', n: 'st-n', s: 'st-s', m: 'st-m' }
const STATE_WORD = { a: 'Accent', n: 'Normal', s: 'Soft', m: 'Mute' }
const LEVELS = ['m', 's', 'n', 'a']

const meter = computed(() => meterById(props.prefs.meterId))
const subdivs = computed(() => subdivisionsFor(meter.value))
const key = computed(() => beatKey(props.prefs.meterId, props.prefs.subdiv))
const beats = computed(
  () =>
    props.prefs.beatPatterns?.[key.value] ||
    defaultBeats(meter.value, props.prefs.subdiv, props.prefs.clickSubdivisions),
)
const presets = computed(() => beatPresets(meter.value, props.prefs.subdiv))
const gap = computed(() => props.prefs.gap || { on: false, play: 4, mute: 2 })
const drumPatterns = computed(() => patternsFor(props.prefs.meterId))
const drumId = computed(() => patternById(props.prefs.meterId, props.prefs.patternId)?.id ?? null)

// Pads grouped by pulse, each with the syllable a player would count.
const groups = computed(() => {
  const sub = props.prefs.subdiv
  const out = []
  for (let p = 0; p < meter.value.pulses; p++) {
    const g = []
    for (let o = 0; o < sub; o++) {
      const i = p * sub + o
      const full = slotLabel(i, sub, meter.value)
      g.push({ i, sub: o > 0, full, short: o === 0 ? full : full.split(' ')[1] })
    }
    out.push(g)
  }
  return out
})

const marking = computed(() => {
  const b = props.prefs.bpm
  if (b < 40) return 'Grave'
  if (b < 60) return 'Largo'
  if (b < 66) return 'Larghetto'
  if (b < 76) return 'Adagio'
  if (b < 108) return 'Andante'
  if (b < 120) return 'Moderato'
  if (b < 156) return 'Allegro'
  if (b < 176) return 'Vivace'
  if (b < 200) return 'Presto'
  return 'Prestissimo'
})

function pct(v, lo, hi) {
  return `${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%`
}

// ── Tempo ───────────────────────────────────────────────────────────────────
// The number is a draft while it is being typed into: this sheet re-renders as
// the playhead moves, and a bound value would be put back under the cursor.
const bpmDraft = ref(String(props.prefs.bpm))
const bpmEditing = ref(false)
watch(
  () => props.prefs.bpm,
  (v) => {
    if (!bpmEditing.value) bpmDraft.value = String(v)
  },
)

function commitBpm() {
  bpmEditing.value = false
  const v = Math.round(+bpmDraft.value)
  if (Number.isFinite(v) && v > 0) emit('update', { bpm: Math.max(20, Math.min(300, v)) })
  bpmDraft.value = String(props.prefs.bpm)
}

function nudge(d) {
  emit('update', { bpm: Math.max(20, Math.min(300, props.prefs.bpm + d)) })
}

let holdT = 0
let holdI = 0
let pointerNudged = false
function holdStart(d) {
  pointerNudged = true
  nudge(d)
  holdT = setTimeout(() => (holdI = setInterval(() => nudge(d), 70)), 380)
}
function holdEnd() {
  clearTimeout(holdT)
  clearInterval(holdI)
}
// A keyboard press arrives as a click with no pointer before it.
function keyNudge(e, d) {
  if (pointerNudged) {
    pointerNudged = false
    return
  }
  if (e.detail === 0) nudge(d)
}

const tapHit = ref(false)
let tapT = 0
function onTap() {
  emit('tap')
  tapHit.value = false
  requestAnimationFrame(() => (tapHit.value = true))
  clearTimeout(tapT)
  tapT = setTimeout(() => (tapHit.value = false), 220)
}

// ── Beats ───────────────────────────────────────────────────────────────────
function same(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function setBeats(list) {
  emit('update', { beatPatterns: { ...props.prefs.beatPatterns, [key.value]: [...list] } })
}

function setBeat(i, st) {
  if (beats.value[i] === st) return
  const next = [...beats.value]
  next[i] = st
  setBeats(next)
}

function cycle(i, dir = 1) {
  const at = BEAT_CYCLE.indexOf(beats.value[i])
  setBeat(i, BEAT_CYCLE[(at + dir + BEAT_CYCLE.length) % BEAT_CYCLE.length])
}

function step(i, d) {
  const at = LEVELS.indexOf(beats.value[i])
  setBeat(i, LEVELS[Math.max(0, Math.min(LEVELS.length - 1, at + d))])
}

// Click cycles; a drag paints. While dragging, the pad under the pointer's x
// takes the level of the pointer's height on it, so a sweep draws a contour.
const padsEl = ref(null)
const drag = ref(null)

function padDown(e, i) {
  if (e.button !== 0) return
  drag.value = { i, x: e.clientX, y: e.clientY, moved: false }
  padsEl.value?.setPointerCapture?.(e.pointerId)
}

function padsMove(e) {
  const d = drag.value
  if (!d) return
  if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return
  d.moved = true
  for (const el of padsEl.value.querySelectorAll('.pad')) {
    const r = el.getBoundingClientRect()
    if (e.clientX < r.left - 3 || e.clientX > r.right + 3) continue
    const f = 1 - (e.clientY - r.top) / r.height
    setBeat(+el.dataset.i, f > 0.82 ? 'a' : f > 0.5 ? 'n' : f > 0.17 ? 's' : 'm')
    break
  }
}

function padsUp(e) {
  const d = drag.value
  drag.value = null
  padsEl.value?.releasePointerCapture?.(e.pointerId)
  if (d && !d.moved) cycle(d.i, e.shiftKey ? -1 : 1)
}

function padKeyClick(e, i) {
  if (e.detail === 0) cycle(i, 1)
}

// ── Gap + sound ─────────────────────────────────────────────────────────────
function setGap(patch) {
  emit('update', { gap: { ...gap.value, ...patch } })
}

function pickSound(id) {
  if (props.prefs.clickSound !== id) emit('update', { clickSound: id })
  emit('preview', id)
}

// Each sound's outline, drawn from the same recipe the synth uses: a carrier
// under its envelope. Decoration, but honest decoration.
function rnd(i) {
  const s = Math.sin(i * 12.9898) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}
const SHAPES = {
  wood: (x) => Math.exp(-x * 8) * Math.sin(2 * Math.PI * x * 7),
  beep: (x) => (x < 0.5 ? 1 : Math.exp(-(x - 0.5) * 26)) * Math.sin(2 * Math.PI * x * 10),
  clave: (x) => Math.exp(-x * 5.5) * Math.sin(2 * Math.PI * x * 15),
  cowbell: (x) =>
    Math.exp(-x * 3) *
    (0.6 * Math.sign(Math.sin(2 * Math.PI * x * 5)) +
      0.4 * Math.sign(Math.sin(2 * Math.PI * x * 7.2))),
  stick: (x, i) => Math.exp(-x * 11) * rnd(i),
}
const WAVES = Object.fromEntries(
  Object.entries(SHAPES).map(([id, f]) => {
    let d = ''
    const N = 120
    for (let i = 0; i <= N; i++) {
      const x = i / N
      const y = Math.min(1, x * 40) * f(x, i)
      d += `${i ? 'L' : 'M'}${(2 + x * 60).toFixed(1)} ${(11 - y * 9).toFixed(1)}`
    }
    return [id, d]
  }),
)

// ── Playhead ────────────────────────────────────────────────────────────────
const nowSlot = ref(-1)
const nowCycle = ref(-1)
const silentNow = ref(false)
let raf = 0

function tick() {
  raf = requestAnimationFrame(tick)
  const n = props.running && props.now ? props.now() : null
  const slot = n && n.spb === beats.value.length ? n.slot : -1
  if (slot !== nowSlot.value) nowSlot.value = slot
  const cyc = n ? n.cycle : -1
  if (cyc !== nowCycle.value) nowCycle.value = cyc
  const sil = !!n?.silent
  if (sil !== silentNow.value) silentNow.value = sil
}

onMounted(() => (raf = requestAnimationFrame(tick)))
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  holdEnd()
  clearTimeout(tapT)
})
</script>

<style scoped>
.mt {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

:where(.mt button) {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

.mt button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mt-label {
  font-size: 0.66rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}

.mt-hint {
  margin: 0;
  font-size: 0.72rem;
  color: var(--text-faint);
}

/* ── Tempo hero ── */
.mt-hero {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  padding-top: 0.25rem;
}

.mt-round {
  flex: none;
  width: 3rem;
  height: 3rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border) !important;
  color: var(--text-dim);
  font-size: 0.85rem;
  transition:
    border-color 120ms,
    color 120ms,
    transform 80ms;
  touch-action: manipulation;
}

.mt-round:hover {
  border-color: var(--accent-400) !important;
  color: var(--accent-600);
}

.mt-round:active {
  transform: scale(0.93);
}

.mt-bpm {
  flex: 0 1 12rem;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mt-bpm-num {
  width: 100%;
  border: none;
  background: none;
  text-align: center;
  font-size: 4.25rem;
  font-weight: 800;
  line-height: 0.95;
  letter-spacing: -0.045em;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  outline: none;
  padding: 0;
  border-radius: 0.5rem;
  caret-color: var(--accent-500);
}

.mt-bpm-num:focus {
  background: var(--bg-sunken);
}

.mt-bpm-sub {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 700;
}

.mt-bpm-sub i {
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 999px;
  background: var(--accent-400);
}

.mt-bpm-sub em {
  font-style: italic;
  text-transform: none;
  letter-spacing: 0.01em;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 0.95rem;
  font-weight: 400;
  color: var(--text-dim);
}

.mt-tap {
  flex: none;
  position: relative;
  width: 4.25rem;
  height: 4.25rem;
  border-radius: 1.1rem;
  background: var(--text) !important;
  color: #fff !important;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  transition: transform 90ms;
  touch-action: manipulation;
  overflow: hidden;
}

.mt-tap::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--accent-500);
  opacity: 0;
  transition: opacity 260ms;
}

.mt-tap.hit::after {
  opacity: 0.85;
  transition: none;
}

.mt-tap span {
  position: relative;
  z-index: 1;
}

.mt-tap:active {
  transform: scale(0.94);
}

/* ── Ranges ── */
.rng {
  -webkit-appearance: none;
  appearance: none;
  height: 0.375rem;
  border-radius: 999px;
  background: linear-gradient(to right, var(--accent-500) var(--pct, 50%), #e8e6e1 var(--pct, 50%));
  cursor: pointer;
  outline: none;
}

.rng:disabled {
  filter: grayscale(1);
  opacity: 0.4;
  cursor: not-allowed;
}

.rng::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 999px;
  background: #fff;
  border: 2px solid var(--accent-500);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transition: transform 100ms;
}

.rng::-webkit-slider-thumb:hover {
  transform: scale(1.12);
}

.rng::-moz-range-thumb {
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 999px;
  background: #fff;
  border: 2px solid var(--accent-500);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
}

.mt-tempo-slider {
  width: 100%;
  margin-top: -0.35rem;
}

/* ── Meter + grid ── */
.mt-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.5rem;
}

.mt-field {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 0.6rem;
  background: var(--bg-sunken);
  padding: 0.15rem;
  gap: 0.1rem;
}

.seg button {
  min-width: 2.6rem;
  height: 2rem;
  padding: 0 0.5rem;
  border-radius: 0.45rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-dim);
}

.seg button.on {
  background: #fff;
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

/* ── Sections ── */
.mt-sec {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-soft);
}

.mt-sec-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 1.75rem;
}

.mt-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-left: auto;
}

.drums .mt-presets {
  margin-left: 0;
}

.chip {
  height: 1.75rem;
  padding: 0 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border) !important;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-dim);
  white-space: nowrap;
  transition:
    background 120ms,
    border-color 120ms,
    color 120ms;
}

.chip:hover {
  border-color: var(--text-faint) !important;
}

.chip.on {
  background: var(--text);
  border-color: var(--text) !important;
  color: #fff;
}

/* ── Beat pads ── */
.pads {
  position: relative;
  display: flex;
  gap: 0.85rem;
  padding: 0.85rem;
  border-radius: 0.9rem;
  background: var(--bg-sunken);
  user-select: none;
  touch-action: none;
  transition: opacity 160ms;
}

.pads.dense {
  gap: 0.5rem;
  padding: 0.7rem 0.6rem;
}

.pad-group {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 0.3rem;
}

.pads.dense .pad-group {
  gap: 0.18rem;
}

.pad-col {
  flex: 1.35;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
}

.pad-col.sub {
  flex: 1;
}

.pad {
  position: relative;
  height: 5.5rem;
  border-radius: 0.55rem;
  background: #fff !important;
  box-shadow: inset 0 0 0 1px var(--border);
  overflow: hidden;
  transition: box-shadow 220ms;
}

.pad:focus-visible {
  outline: 2px solid var(--accent-400);
  outline-offset: 2px;
}

.pad-fill {
  position: absolute;
  left: 0.2rem;
  right: 0.2rem;
  bottom: 0.2rem;
  height: 0;
  border-radius: 0.38rem;
  transition:
    height 170ms cubic-bezier(0.3, 1.3, 0.5, 1),
    filter 220ms;
}

.pad.st-a .pad-fill {
  height: calc(100% - 0.4rem);
  background: linear-gradient(180deg, #f87171, #dc2626);
}

.pad.st-n .pad-fill {
  height: 62%;
  background: linear-gradient(180deg, #52525b, #27272a);
}

.pad.st-s .pad-fill {
  height: 32%;
  background: linear-gradient(180deg, #d6d3cc, #b8b3aa);
}

.pad.st-m {
  background: repeating-linear-gradient(-45deg, #fff 0 0.4rem, #f1efeb 0.4rem 0.5rem) !important;
  box-shadow: inset 0 0 0 1px var(--border);
}

.pad.lit {
  box-shadow:
    inset 0 0 0 1px var(--border),
    0 0 0 2px #fff,
    0 0 0 4px var(--accent-400);
  transition: none;
}

.pad.lit .pad-fill {
  filter: brightness(1.18) saturate(1.1);
  transition: height 170ms cubic-bezier(0.3, 1.3, 0.5, 1);
}

.pad.st-m.lit {
  box-shadow:
    inset 0 0 0 1px var(--border),
    0 0 0 2px #fff,
    0 0 0 4px #d6d3cc;
}

.pad-label {
  text-align: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}

.pad-col.sub .pad-label {
  font-weight: 500;
  color: var(--text-faint);
}

.pads.dense .pad-label {
  font-size: 0.6rem;
}

.pads.silent .pad-group {
  opacity: 0.32;
}

.pads-silent {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -80%);
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  background: var(--text);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  pointer-events: none;
}

.mt-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem 0.9rem;
  font-size: 0.72rem;
  color: var(--text-dim);
}

.lg {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.lg i {
  width: 0.6rem;
  height: 0.8rem;
  border-radius: 0.15rem;
}

.lg i.st-a {
  background: #dc2626;
}

.lg i.st-n {
  background: #3f3f46;
  height: 0.55rem;
}

.lg i.st-s {
  background: #c4c0b8;
  height: 0.35rem;
}

.lg i.st-m {
  border: 1px dashed var(--text-faint);
}

.lg-hint {
  margin-left: auto;
  color: var(--text-faint);
}

/* ── Two-up ── */
.mt-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 0 1.5rem;
}

@container (max-width: 34rem) {
  .mt-grid {
    grid-template-columns: 1fr;
  }

  .mt-col {
    margin-top: 0.9rem;
  }

  .sounds {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .mt-hero {
    gap: 0.6rem;
  }

  .mt-bpm {
    min-width: 8rem;
  }

  .mt-bpm-num {
    font-size: 3.6rem;
  }

  .mt-tap {
    width: 3.5rem;
    height: 3.5rem;
  }

  .lg-hint {
    margin-left: 0;
  }
}

/* ── Sound ── */
.sounds {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.35rem;
}

.snd {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.5rem 0.25rem 0.4rem;
  border-radius: 0.7rem;
  border: 1px solid var(--border) !important;
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--text-dim);
  white-space: nowrap;
  transition:
    border-color 120ms,
    background 120ms,
    transform 80ms;
}

.snd:hover {
  border-color: var(--text-faint) !important;
}

.snd:active {
  transform: scale(0.97);
}

.snd.on {
  border-color: var(--accent-500) !important;
  background: var(--accent-050);
  color: var(--accent-600);
}

.snd-wave {
  width: 100%;
  height: 1.4rem;
}

.snd-wave path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linejoin: round;
  opacity: 0.85;
}

.vol {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.25rem;
  color: var(--text-dim);
  font-size: 0.8rem;
}

.vol .rng {
  flex: 1;
  min-width: 0;
}

.vol-n {
  width: 2rem;
  text-align: right;
  font-size: 0.72rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-faint);
}

/* ── Switch ── */
.sw {
  flex: none;
  width: 2.35rem;
  height: 1.35rem;
  border-radius: 999px;
  background: #dcd9d3 !important;
  position: relative;
  transition: background 160ms;
}

.sw span {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 180ms cubic-bezier(0.3, 1.3, 0.5, 1);
}

.sw.on {
  background: var(--accent-500) !important;
}

.sw.on span {
  transform: translateX(1rem);
}

/* ── Gap ── */
.gap,
.drums {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  transition: opacity 160ms;
}

.gap.off,
.drums.off {
  opacity: 0.5;
}

.gap-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.1rem;
}

.stepper {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  color: var(--text-dim);
}

.stepper span {
  margin-right: 0.15rem;
}

.stepper button {
  width: 1.65rem;
  height: 1.65rem;
  border-radius: 999px;
  border: 1px solid var(--border) !important;
  display: grid;
  place-items: center;
  font-size: 0.55rem;
  color: var(--text-dim);
}

.stepper button:hover:not(:disabled) {
  border-color: var(--accent-400) !important;
  color: var(--accent-600);
}

.stepper b {
  min-width: 1.4rem;
  text-align: center;
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.gap-strip {
  display: flex;
  gap: 0.25rem;
}

.gap-strip span {
  flex: 1;
  max-width: 2.4rem;
  height: 0.85rem;
  border-radius: 0.25rem;
  background: var(--text);
  transition:
    transform 160ms,
    box-shadow 160ms;
}

.gap-strip span.rest {
  background: repeating-linear-gradient(-45deg, #fff 0 0.25rem, #e8e6e1 0.25rem 0.35rem);
  box-shadow: inset 0 0 0 1px var(--border);
}

.gap-strip span.lit {
  transform: scaleY(1.45);
  box-shadow: 0 0 0 2px var(--accent-400);
}

.mt-col {
  display: flex;
  flex-direction: column;
}

.mt-col .mt-drums {
  margin-top: 0.9rem;
}
</style>
