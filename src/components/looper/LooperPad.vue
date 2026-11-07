<!-- File: src/components/looper/LooperPad.vue -->
<!--
  One loop: a disc in the layer's colour with its waveform drawn round the
  circle, so where you are in the loop is where the hand points.

  The hand and the recording ring move every frame, so they are not props: the
  view writes --turn and --rec straight onto this element's style from its one
  animation loop, and Vue never re-renders a pad to move them.

  Tap: focus it, and empty → record here; recording → keep the take;
  playing → mute. The ⋯ menu (or a right-click) holds the rest.
-->
<template>
  <div class="pad" :class="[state, { filled: !!layer, menu: menuOpen, focused }]" :style="{ '--c': color }">
    <button
      class="disc"
      :aria-label="ariaLabel"
      :title="title"
      @click="$emit('tap')"
      @contextmenu.prevent="layer && $emit('toggle-menu')"
    >
      <svg viewBox="-50 -50 100 100" aria-hidden="true">
        <circle class="face" r="48" />
        <template v-if="layer">
          <path class="wave" :d="wavePath" />
          <circle class="hub" :r="R0" />
          <g class="hand">
            <line :x1="0" :y1="-(R0 + 2)" :x2="0" y2="-46.5" />
          </g>
        </template>
        <circle class="ring" r="48" pathLength="100" />
      </svg>

      <span v-if="!layer && state === 'empty'" class="mark">
        <i class="pi pi-plus"></i>
        <kbd>{{ focused ? 'Space' : index + 1 }}</kbd>
      </span>
      <span v-else-if="overlay" class="overlay">{{ overlay }}</span>
    </button>

    <div class="cap">
      <span v-if="layer" class="flags">
        <button :class="{ on: muted }" title="Mute (M)" @click.stop="$emit('mute')">M</button>
        <button class="solo" :class="{ on: soloed }" title="Solo (S)" @click.stop="$emit('solo')">S</button>
      </span>
      <span class="cap-name">{{ layer ? layer.name : ' ' }}</span>
      <span class="cap-meta">{{ meta }}</span>
      <button
        v-if="layer"
        class="more"
        title="Volume, rename, trim, nudge, download, clear"
        @click.stop="$emit('toggle-menu')"
      >
        <i class="pi pi-ellipsis-h"></i>
      </button>
    </div>

    <div v-if="menuOpen && layer" class="pad-menu" @pointerdown.stop>
      <input
        v-model="nameDraft"
        class="name"
        maxlength="32"
        aria-label="Loop name"
        @keydown.enter="$event.target.blur()"
        @blur="commitName"
      />
      <label class="vol">
        <i class="pi pi-volume-up"></i>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.01"
          :value="volume"
          aria-label="Volume"
          @input="$emit('volume', +$event.target.value)"
        />
        <span>{{ Math.round(volume * 100) }}%</span>
      </label>
      <div class="menu-row">
        <button title="Trim (T)" @click="$emit('trim')"><i class="pi pi-arrows-h"></i> Trim</button>
        <button title="Nudge (N)" @click="$emit('nudge')"><i class="pi pi-sort-alt rot"></i> Nudge</button>
        <button @click="$emit('download')"><i class="pi pi-download"></i> WAV</button>
        <button class="danger" @click="$emit('clear')"><i class="pi pi-trash"></i> Clear</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  index: { type: Number, required: true },
  layer: { type: Object, default: null },
  color: { type: String, required: true },
  // empty | armed | counting | recording | closing | playing | stopped | muted
  state: { type: String, default: 'empty' },
  overlay: { type: String, default: '' },
  meta: { type: String, default: '' },
  volume: { type: Number, default: 1 },
  focused: { type: Boolean, default: false },
  muted: { type: Boolean, default: false },
  soloed: { type: Boolean, default: false },
  menuOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['tap', 'toggle-menu', 'volume', 'download', 'clear', 'rename', 'mute', 'solo', 'trim', 'nudge'])

const R0 = 15
const R1 = 45

// The waveform as one closed outline round the hub, a point per bin.
const wavePath = computed(() => {
  const p = props.layer?.peaks
  if (!p?.length) return ''
  const n = p.length
  let d = ''
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n
    const r = R0 + p[k] * (R1 - R0)
    d += `${k ? 'L' : 'M'}${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`
  }
  return d + 'Z'
})

const ariaLabel = computed(() => {
  const n = props.index + 1
  if (!props.layer) return props.state === 'empty' ? `Record into pad ${n}` : `Stop recording pad ${n}`
  return `${props.layer.name}, ${props.state === 'muted' ? 'muted — tap to unmute' : 'tap to mute'}`
})

const title = computed(() => {
  if (props.state === 'empty') return `Record here (${props.index + 1})`
  if (props.state === 'armed') return 'Waiting for your first note — tap to cancel'
  if (props.state === 'recording') return 'Tap to keep this take (Enter)'
  if (props.state === 'muted') return 'Muted — tap to unmute'
  if (props.layer) return 'Tap to mute'
  return ''
})

const nameDraft = ref('')
watch(
  () => [props.menuOpen, props.layer?.name],
  () => {
    nameDraft.value = props.layer?.name || ''
  },
  { immediate: true },
)

function commitName() {
  if (nameDraft.value.trim() && nameDraft.value.trim() !== props.layer?.name) emit('rename', nameDraft.value.trim())
}
</script>

<style scoped>
.pad {
  --turn: 0;
  --rec: 0;
  position: relative;
  width: var(--pad);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
}

.disc {
  position: relative;
  width: var(--pad);
  height: var(--pad);
  border-radius: 50%;
  display: block;
  transition: transform 140ms ease;
}

.disc:active {
  transform: scale(0.97);
}

.disc:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 4px;
}

/* The pad the keys act on. */
.focused .disc {
  outline: 2px solid var(--text-dim);
  outline-offset: 0.35rem;
}

svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.face {
  fill: var(--bg-raised);
  stroke: var(--border);
  stroke-width: 1;
  transition: fill 200ms ease;
}

.filled .face {
  fill: var(--c);
  stroke: none;
}

.wave {
  fill: rgba(0, 0, 0, 0.58);
}

.hub {
  fill: var(--c);
}

.hand line {
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 2.6;
  stroke-linecap: round;
}

.hand {
  transform: rotate(calc(var(--turn) * 1turn));
}

.stopped .hand {
  opacity: 0.35;
}

.muted .disc {
  opacity: 0.32;
  filter: saturate(0.4);
}

.muted .hand {
  opacity: 0;
}

/* The ring: red, filling clockwise from the top while recording. */
.ring {
  fill: none;
  stroke: var(--accent-500);
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-dasharray: 100px 100px;
  stroke-dashoffset: calc(100px - var(--rec) * 100px);
  transform: rotate(-90deg);
  opacity: 0;
  transition: opacity 160ms ease;
}

.recording .ring,
.closing .ring {
  opacity: 1;
}

.armed .ring,
.counting .ring {
  opacity: 1;
  stroke-dashoffset: 0;
  animation: pulse 900ms ease-in-out infinite;
}

/* Recording over a filled pad: the old take shows through, faded. */
.filled:is(.armed, .counting, .recording, .closing) :is(.face, .wave, .hub, .hand) {
  opacity: 0.3;
}

.armed .face,
.counting .face,
.recording:not(.filled) .face,
.closing:not(.filled) .face {
  fill: color-mix(in srgb, var(--accent-500) 14%, var(--bg-raised));
}

@keyframes pulse {
  50% {
    opacity: 0.25;
  }
}

.mark {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: calc(var(--pad) * 0.16);
  pointer-events: none;
}

.mark .pi {
  font-size: calc(var(--pad) * 0.14);
}

.disc:hover .mark {
  color: var(--text-dim);
}

.mark kbd {
  position: absolute;
  bottom: 18%;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-faint);
  opacity: 0.7;
}

.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: max(0.8rem, calc(var(--pad) * 0.1));
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--text);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  text-align: center;
  padding: 0 18%;
  line-height: 1.2;
}

/* ── Caption ── */
.flags {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 0.15rem;
}

.flags button {
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 0.3rem;
  font-size: 0.66rem;
  font-weight: 800;
  color: var(--text-faint);
  opacity: 0;
  transition: opacity 120ms ease;
}

.pad:hover .flags button,
.focused .flags button,
.flags button.on,
.flags button:focus-visible {
  opacity: 1;
}

.flags button:hover {
  color: var(--text);
  background: var(--bg-raised);
}

.flags button.on {
  color: #121110;
  background: #eab308;
}

.flags .solo.on {
  background: #22c55e;
}

@media (hover: none) {
  .flags button {
    opacity: 1;
  }
}


.cap {
  position: relative;
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.4rem;
  min-height: 1.3rem;
  padding: 0 2.9rem;
  font-size: 0.78rem;
}

.cap-name {
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}

.cap-meta {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.more {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  opacity: 0;
  transition: opacity 120ms ease;
}

.pad:hover .more,
.pad.menu .more,
.more:focus-visible {
  opacity: 1;
}

.more:hover {
  color: var(--text);
  background: var(--bg-raised);
}

@media (hover: none) {
  .more {
    opacity: 1;
  }
}

/* ── Menu ── */
.pad-menu {
  position: absolute;
  top: calc(100% + 0.25rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  width: 13.5rem;
  padding: 0.6rem;
  border-radius: 0.8rem;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  box-shadow: 0 0.75rem 2rem rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.name {
  width: 100%;
  height: 2rem;
  padding: 0 0.55rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border);
  background: var(--bg);
  font-weight: 700;
}

.name:focus {
  outline: none;
  border-color: var(--c);
}

.vol {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.75rem;
  color: var(--text-dim);
}

.vol input {
  flex: 1;
  min-width: 0;
  accent-color: var(--c);
}

.vol span {
  width: 2.4rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.menu-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.rot {
  transform: rotate(90deg);
}

.menu-row button {
  height: 2rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border);
  font-size: 0.78rem;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.menu-row button:hover {
  background: var(--bg);
}

.menu-row .danger:hover {
  color: var(--accent-400);
  border-color: var(--accent-500);
}
</style>
