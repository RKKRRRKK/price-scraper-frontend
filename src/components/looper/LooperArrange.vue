<!-- File: src/components/looper/LooperArrange.vue -->
<!--
  The song, as a grid: one column per turn of the first loop, one row per
  loop, each cell on or off. That is the whole arranging model — enough to
  sketch intro / verse / drop and hear it, with the real editing left to
  REAPER, where the export lands as looping items laid out the same way.

  Cells are painted: press on one to flip it, keep the button down and drag to
  set the cells you pass over the same way.

  The playhead is positioned by --head (in blocks), which the view writes from
  its animation loop.
-->
<template>
  <div class="arr">
    <div v-if="!layers.length" class="arr-empty">
      <i class="pi pi-th-large"></i>
      <span>Record a loop first — it shows up here as a row.</span>
    </div>

    <div v-else class="arr-scroll">
      <div
        class="arr-grid"
        :style="{ '--blocks': song.blocks, '--row-count': layers.length }"
        @pointerleave="hover = -1"
      >
        <div class="corner">
          <span>{{ song.blocks }} × {{ blockLabel }}</span>
        </div>
        <div
          v-for="b in song.blocks"
          :key="'h' + b"
          class="bhead"
          :class="{ hot: hover === b - 1 }"
        >
          <button class="bplay" :title="`Play from block ${b}`" @click="$emit('play-from', b - 1)">
            <span>{{ b }}</span><i class="pi pi-play"></i>
          </button>
          <button
            v-if="song.blocks > 1"
            class="bx"
            :title="`Remove block ${b}`"
            @click="$emit('remove-block', b - 1)"
          >
            <i class="pi pi-times"></i>
          </button>
        </div>
        <button class="badd" title="Add a block" @click="$emit('add-block')">
          <i class="pi pi-plus"></i>
        </button>

        <template v-for="l in layers" :key="l.id">
          <div class="rhead" :style="{ '--c': colorOf(l) }">
            <span class="dot"></span>
            <span class="rname">{{ l.name }}</span>
            <span class="rlen">{{ lengthLabel(l) }}</span>
          </div>
          <div
            v-for="b in song.blocks"
            :key="l.id + ':' + b"
            class="cell"
            :class="{ on: song.rows[l.id]?.[b - 1] }"
            :style="{ '--c': colorOf(l) }"
            @pointerdown.prevent="startPaint(l.id, b - 1)"
            @pointerenter="paintOver(l.id, b - 1)"
          >
            <svg viewBox="0 0 48 20" preserveAspectRatio="none" aria-hidden="true">
              <path :d="cellPath(l, b - 1)" />
            </svg>
          </div>
          <div class="rpad"></div>
        </template>

        <div class="head"></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { linePeaks } from '@/lib/looper/detect'
import { PAD_COLORS } from '@/stores/looper'

const props = defineProps({
  layers: { type: Array, required: true },
  song: { type: Object, required: true },
  // Length of one block (the first loop) in samples, and its rate.
  blockFrames: { type: Number, default: 0 },
  sr: { type: Number, default: 48000 },
  bars: { type: Number, default: null },
})
const emit = defineEmits(['paint-start', 'cell', 'add-block', 'remove-block', 'play-from'])

const hover = ref(-1)

const blockLabel = computed(() => {
  if (props.bars) return `${props.bars} ${props.bars === 1 ? 'bar' : 'bars'}`
  return `${(props.blockFrames / props.sr).toFixed(1)} s`
})

function colorOf(l) {
  return PAD_COLORS[l.slot % PAD_COLORS.length]
}

function lengthLabel(l) {
  const turns = l.len / props.blockFrames
  if (Math.abs(turns - 1) < 1e-6) return ''
  return turns > 1 ? `×${Math.round(turns)}` : `÷${Math.round(1 / turns)}`
}

// ── Waveforms ──────────────────────────────────────────────────────────────
// A cell shows the stretch of its loop that plays in that block. Layers longer
// or shorter than a block repeat with their own period, so the drawing is
// cached by where in the loop the block starts.
const BINS = 48
let cache = new Map()
watch(
  () => props.layers,
  () => {
    cache = new Map()
  },
)

function cellPath(l, b) {
  if (!props.blockFrames) return ''
  const from = (b * props.blockFrames) % l.len
  const key = `${l.id}:${from}`
  let d = cache.get(key)
  if (d != null) return d
  const p = linePeaks(l.wet, from, props.blockFrames, BINS, l.peak)
  let top = ''
  let bot = ''
  for (let i = 0; i < BINS; i++) {
    const h = Math.max(0.35, p[i] * 9.5)
    top += `${i ? 'L' : 'M'}${i + 0.5},${(10 - h).toFixed(2)}`
    bot = `L${i + 0.5},${(10 + h).toFixed(2)}` + bot
  }
  d = top + bot + 'Z'
  cache.set(key, d)
  return d
}

// ── Painting ───────────────────────────────────────────────────────────────
let paint = null

function startPaint(id, b) {
  const on = !props.song.rows[id]?.[b]
  paint = { on }
  emit('paint-start')
  emit('cell', id, b, on)
  window.addEventListener('pointerup', endPaint)
  window.addEventListener('pointercancel', endPaint)
}

function paintOver(id, b) {
  hover.value = b
  if (paint) emit('cell', id, b, paint.on)
}

function endPaint() {
  paint = null
  window.removeEventListener('pointerup', endPaint)
  window.removeEventListener('pointercancel', endPaint)
}

onBeforeUnmount(endPaint)
</script>

<style scoped>
.arr {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.arr-empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  color: var(--text-faint);
  font-size: 0.9rem;
  text-align: center;
}

.arr-empty .pi {
  font-size: 1.6rem;
}

.arr-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  /* A size container: cells stretch to fill the width, and the grid's own
     width can never widen the page — past the minimum it scrolls in here. */
  container-type: inline-size;
  padding-bottom: 0.5rem;
}

.arr-grid {
  --label: 10rem;
  --cell: clamp(6.5rem, calc((100cqw - var(--label) - 2.5rem - (var(--blocks) + 1) * 0.3rem) / var(--blocks)), 14rem);
  --row: 3.6rem;
  position: relative;
  display: grid;
  grid-template-columns: var(--label) repeat(var(--blocks), var(--cell)) 2.5rem;
  grid-auto-rows: var(--row);
  grid-template-rows: 2.25rem;
  gap: 0.3rem;
  width: max-content;
  user-select: none;
  touch-action: none;
}

.corner {
  display: flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--bg);
}

.bhead {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 0.5rem;
}

.bplay {
  flex: 1;
  height: 100%;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.5rem;
  font-size: 0.78rem;
  font-weight: 800;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.bplay .pi {
  font-size: 0.6rem;
  opacity: 0;
  transition: opacity 120ms ease;
}

.bplay:hover {
  background: var(--bg-raised);
  color: var(--text);
}

.bplay:hover .pi,
.bhead.hot .bplay .pi {
  opacity: 1;
}

.bx {
  position: absolute;
  right: 0.2rem;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.55rem;
  color: var(--text-faint);
  opacity: 0;
}

.bhead:hover .bx {
  opacity: 1;
}

.bx:hover {
  color: var(--accent-400);
  background: var(--bg-raised);
}

.badd {
  border-radius: 0.5rem;
  border: 1px dashed var(--border);
  color: var(--text-faint);
  display: grid;
  place-items: center;
}

.badd:hover {
  color: var(--text);
  border-color: var(--text-dim);
}

.rhead {
  position: sticky;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.6rem;
  border-radius: 0.6rem;
  background: var(--bg-raised);
  min-width: 0;
}

.dot {
  flex-shrink: 0;
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--c);
}

.rname {
  font-weight: 700;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rlen {
  margin-left: auto;
  font-size: 0.7rem;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.cell {
  border-radius: 0.6rem;
  background: var(--bg-raised);
  border: 1px solid var(--border-soft);
  cursor: pointer;
  overflow: hidden;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}

.cell svg {
  width: 100%;
  height: 100%;
  display: block;
}

.cell path {
  fill: var(--text-faint);
  opacity: 0.25;
}

.cell:hover {
  border-color: var(--c);
}

.cell.on {
  background: var(--c);
  border-color: transparent;
}

.cell.on path {
  fill: #000;
  opacity: 0.5;
}

.rpad {
  /* the column under the add button */
}

.head {
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--label) + 0.3rem + var(--head, -100) * (var(--cell) + 0.3rem));
  width: 2px;
  margin-left: -1px;
  background: var(--text);
  box-shadow: 0 0 0.5rem rgba(255, 255, 255, 0.35);
  pointer-events: none;
  z-index: 4;
}

@media (max-width: 767.98px) {
  .arr-grid {
    --label: 6.5rem;
    --cell: clamp(4.5rem, calc((100cqw - var(--label) - 2.5rem - (var(--blocks) + 1) * 0.3rem) / var(--blocks)), 8rem);
  }
}
</style>
