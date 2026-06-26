<template>
  <div ref="wrap" class="bb-canvas">
    <svg
      ref="svgEl"
      :viewBox="vbStr"
      class="bb-svg"
      :class="{ wiring: tool?.type === 'wire', placing: tool?.type === 'place', dragging: !!drag }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @wheel.prevent="onWheel"
    >
      <!-- breadboards -->
      <BreadboardSurface v-for="l in layouts" :key="l.bb.id" :layout="l" />

      <!-- placed items -->
      <ComponentSprite
        v-for="it in data.items"
        :key="it.id"
        :item="it"
        :layout="sceneLayout"
        :board-layout="boardLayouts[it.id]"
        :selected="it.id === selectedId"
      />

      <!-- wires (drawn above parts so connections stay visible on boards) -->
      <g class="wires">
        <g v-for="w in data.wires" :key="w.id">
          <path :d="wirePath(w)" class="wire" :style="{ stroke: w.color || '#16a34a' }" />
          <circle v-for="pt in wireEnds(w)" :key="pt.k" :cx="pt.x" :cy="pt.y" r="3.4" class="wire-end" :style="{ fill: w.color || '#16a34a' }" />
          <g v-if="wireMid(w)" class="wire-del" :transform="`translate(${wireMid(w).x}, ${wireMid(w).y})`" @pointerdown.stop="$emit('remove-wire', w.id)">
            <circle r="7" class="wire-del-bg" />
            <text y="3" text-anchor="middle" class="wire-del-x">×</text>
          </g>
        </g>
      </g>

      <!-- overlays -->
      <circle v-if="showHover && hoverHole" :cx="hoverHole.x" :cy="hoverHole.y" r="7" class="hover-ring" />
      <circle v-if="wireStart" :cx="wireStart.x" :cy="wireStart.y" r="6" class="wire-start" />
      <line
        v-if="wireStart && pointer"
        :x1="wireStart.x" :y1="wireStart.y" :x2="pointer.x" :y2="pointer.y"
        class="wire-rubber"
      />
    </svg>

    <div v-if="!data.items.length && !data.wires.length" class="canvas-empty">
      Pick a part from <strong>Add parts</strong> and click the breadboard to place it.
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { v4 as uuid } from 'uuid'
import BreadboardSurface from './BreadboardSurface.vue'
import ComponentSprite from './ComponentSprite.vue'
import {
  getBreadboardLayout, getBoardLayout, nearestHole, nearestHoleUnbounded,
  placeInlineItem, itemBounds, endpointXY, pinEndpointId, SNAP_R,
} from '@/lib/breadboard/geometry'
import { getTemplate, makeItem } from '@/lib/breadboard/templates'

const props = defineProps({
  data: { type: Object, required: true },
  sheetId: { type: String, default: '' },
  selectedId: { type: String, default: null },
  tool: { type: Object, default: null },
  wireColor: { type: String, default: '#16a34a' },
})
const emit = defineEmits(['add', 'move', 'select', 'add-wire', 'remove-wire', 'placed', 'cancel'])

const wrap = ref(null)
const svgEl = ref(null)
const vb = reactive({ x: 0, y: 0, w: 800, h: 500 })
const vbStr = computed(() => `${vb.x} ${vb.y} ${vb.w} ${vb.h}`)

const pointer = ref(null)
const hoverHole = ref(null)
const wireStart = ref(null)
const drag = ref(null)
const pan = ref(null)

// ── derived geometry ──
const layouts = computed(() => (props.data.breadboards || []).map((bb) => getBreadboardLayout(bb)))
const sceneLayout = computed(() => {
  const ls = layouts.value
  if (!ls.length) return null
  if (ls.length === 1) return ls[0]
  const holes = []
  const holesById = {}
  for (const l of ls) for (const h of l.holes) { holes.push(h); holesById[h.id] = h }
  return { ...ls[0], holes, holesById }
})
const itemsById = computed(() => {
  const m = {}
  for (const it of props.data.items || []) m[it.id] = it
  return m
})
const boardLayouts = computed(() => {
  const m = {}
  for (const it of props.data.items || []) {
    if ((it.placement || getTemplate(it.kind)?.placement) === 'standalone') m[it.id] = getBoardLayout(it)
  }
  return m
})
const showHover = computed(() => props.tool?.type === 'place' || props.tool?.type === 'wire')

function layoutForHole(hole) {
  return layouts.value.find((l) => l.bb.id === hole.bbId) || sceneLayout.value
}

// ── pointer → svg coords ──
function toSvg(e) {
  const svg = svgEl.value
  const ctm = svg?.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

// ── wires ──
function wireCtx() {
  return { layout: sceneLayout.value, itemsById: itemsById.value, boardLayouts: boardLayouts.value }
}
function wirePath(w) {
  const a = endpointXY(w.from, wireCtx())
  const b = endpointXY(w.to, wireCtx())
  if (!a || !b) return ''
  const lift = Math.hypot(b.x - a.x, b.y - a.y) * 0.16 + 6
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2 - lift
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`
}
function wireEnds(w) {
  const a = endpointXY(w.from, wireCtx())
  const b = endpointXY(w.to, wireCtx())
  const out = []
  if (a) out.push({ k: 'a', x: a.x, y: a.y })
  if (b) out.push({ k: 'b', x: b.x, y: b.y })
  return out
}
function wireMid(w) {
  const a = endpointXY(w.from, wireCtx())
  const b = endpointXY(w.to, wireCtx())
  if (!a || !b) return null
  const lift = Math.hypot(b.x - a.x, b.y - a.y) * 0.16 + 6
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - lift / 2 }
}

// ── endpoint hit-testing for wiring (holes + board pins) ──
function nearestEndpoint(p) {
  let best = null
  let bestD = (SNAP_R * 1.3) ** 2
  for (const h of sceneLayout.value.holes) {
    const d = (h.x - p.x) ** 2 + (h.y - p.y) ** 2
    if (d < bestD) { bestD = d; best = { id: h.id, x: h.x, y: h.y } }
  }
  for (const it of props.data.items) {
    const bl = boardLayouts.value[it.id]
    if (!bl) continue
    for (const pin of bl.pins) {
      const d = (pin.x - p.x) ** 2 + (pin.y - p.y) ** 2
      if (d < bestD) { bestD = d; best = { id: pinEndpointId(it, pin), x: pin.x, y: pin.y } }
    }
  }
  return best
}

// ── topmost item under a point ──
function topItemAt(p) {
  const items = props.data.items
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    const b = itemBounds(sceneLayout.value, it, boardLayouts.value[it.id])
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return it
  }
  return null
}

// ── placement ──
function placeAt(kind, p) {
  const tpl = getTemplate(kind)
  const standalone = tpl?.placement === 'standalone'
  if (standalone) {
    const item = makeItem(kind, { x: p.x, y: p.y })
    emit('add', item)
    emit('select', item.id)
    emit('placed')
    return
  }
  const hole = nearestHole(sceneLayout.value, p.x, p.y) || nearestHoleUnbounded(sceneLayout.value, p.x, p.y)
  const item = makeItem(kind, { x: hole?.x ?? p.x, y: hole?.y ?? p.y })
  if (hole) placeInlineItem(layoutForHole(hole), item, hole)
  emit('add', item)
  emit('select', item.id)
  emit('placed')
}

// ── pointer handlers ──
function onDown(e) {
  const p = toSvg(e)
  if (props.tool?.type === 'place') { placeAt(props.tool.kind, p); return }
  if (props.tool?.type === 'wire') {
    const ep = nearestEndpoint(p)
    if (!ep) return
    if (!wireStart.value) wireStart.value = ep
    else if (ep.id !== wireStart.value.id) {
      emit('add-wire', { id: uuid(), from: wireStart.value.id, to: ep.id, color: props.wireColor })
      wireStart.value = null
    }
    return
  }

  const hit = topItemAt(p)
  if (hit) {
    emit('select', hit.id)
    const standalone = (hit.placement || getTemplate(hit.kind)?.placement) === 'standalone'
    const anchor = standalone
      ? { x: hit.x, y: hit.y }
      : sceneLayout.value.holesById[hit.pins[0]?.hole] || { x: hit.x, y: hit.y }
    drag.value = { id: hit.id, ox: p.x - anchor.x, oy: p.y - anchor.y, standalone }
  } else {
    emit('select', null)
    pan.value = { cx: e.clientX, cy: e.clientY, vx: vb.x, vy: vb.y }
  }
  try { svgEl.value.setPointerCapture(e.pointerId) } catch { /* ignore */ }
}

function onMove(e) {
  const p = toSvg(e)
  pointer.value = p
  hoverHole.value = nearestHole(sceneLayout.value, p.x, p.y)

  if (drag.value) {
    const it = itemsById.value[drag.value.id]
    if (!it) return
    if (drag.value.standalone) {
      emit('move', { id: it.id, x: p.x - drag.value.ox, y: p.y - drag.value.oy })
    } else {
      const hole = nearestHoleUnbounded(sceneLayout.value, p.x - drag.value.ox, p.y - drag.value.oy)
      if (hole) {
        const clone = JSON.parse(JSON.stringify(it))
        placeInlineItem(layoutForHole(hole), clone, hole)
        emit('move', { id: it.id, x: clone.x, y: clone.y, pins: clone.pins })
      }
    }
  } else if (pan.value) {
    const scale = vb.w / (wrap.value?.clientWidth || 1)
    vb.x = pan.value.vx - (e.clientX - pan.value.cx) * scale
    vb.y = pan.value.vy - (e.clientY - pan.value.cy) * scale
  }
}

function onUp(e) {
  drag.value = null
  pan.value = null
  try { svgEl.value.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
}

function onWheel(e) {
  const factor = e.deltaY < 0 ? 0.9 : 1.1
  const p = toSvg(e)
  const nw = Math.min(Math.max(vb.w * factor, 140), 8000)
  const real = nw / vb.w
  vb.x = p.x - (p.x - vb.x) * real
  vb.y = p.y - (p.y - vb.y) * real
  vb.w *= real
  vb.h *= real
}

// ── fit to content ──
function contentBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const l of layouts.value) {
    minX = Math.min(minX, l.x0); minY = Math.min(minY, l.y0)
    maxX = Math.max(maxX, l.x0 + l.width); maxY = Math.max(maxY, l.y0 + l.height)
  }
  for (const it of props.data.items || []) {
    const b = itemBounds(sceneLayout.value, it, boardLayouts.value[it.id])
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 700, maxY: 450 }
  return { minX, minY, maxX, maxY }
}
function fit() {
  if (!sceneLayout.value) return
  const b = contentBounds()
  const pad = 44
  let x = b.minX - pad
  let y = b.minY - pad
  let w = b.maxX - b.minX + pad * 2
  let h = b.maxY - b.minY + pad * 2
  const el = wrap.value
  if (el && el.clientWidth) {
    const ar = el.clientHeight / el.clientWidth || 0.66
    const targetH = w * ar
    if (targetH >= h) { const cy = y + h / 2; h = targetH; y = cy - h / 2 } else {
      const targetW = h / ar; const cx = x + w / 2; w = targetW; x = cx - w / 2
    }
  }
  vb.x = x; vb.y = y; vb.w = w; vb.h = h
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (wireStart.value) wireStart.value = null
    emit('cancel')
  }
}

let ro = null
onMounted(() => {
  nextTick(fit)
  window.addEventListener('keydown', onKey)
  if (window.ResizeObserver && wrap.value) {
    ro = new ResizeObserver(() => {
      const el = wrap.value
      if (!el || !el.clientWidth) return
      const cy = vb.y + vb.h / 2
      vb.h = vb.w * (el.clientHeight / el.clientWidth)
      vb.y = cy - vb.h / 2
    })
    ro.observe(wrap.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (ro) ro.disconnect()
})

watch(() => props.sheetId, () => nextTick(fit))

defineExpose({ fit })
</script>

<style scoped>
.bb-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background:
    radial-gradient(circle at 1px 1px, rgba(0, 0, 0, 0.05) 1px, transparent 0) 0 0 / 22px 22px,
    var(--bb-canvas-bg, #fbfaf7);
  overflow: hidden;
}
.bb-svg {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  cursor: grab;
}
.bb-svg.dragging {
  cursor: grabbing;
}
.bb-svg.placing {
  cursor: copy;
}
.bb-svg.wiring {
  cursor: crosshair;
}
.wire {
  fill: none;
  stroke-width: 3.2px;
  stroke-linecap: round;
  opacity: 0.92;
}
.wire-end {
  stroke: rgba(0, 0, 0, 0.25);
  stroke-width: 0.5px;
}
.wire-del {
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}
.wires g:hover .wire-del {
  opacity: 1;
  pointer-events: auto;
}
.wire-del-bg {
  fill: #ef4444;
}
.wire-del-x {
  fill: #fff;
  font-size: 11px;
  font-weight: 700;
}
.hover-ring {
  fill: none;
  stroke: #14b8a6;
  stroke-width: 2px;
  opacity: 0.7;
}
.wire-start {
  fill: none;
  stroke: #16a34a;
  stroke-width: 2px;
}
.wire-rubber {
  stroke: #16a34a;
  stroke-width: 2.5px;
  stroke-dasharray: 5 4;
  opacity: 0.7;
}
.canvas-empty {
  position: absolute;
  inset: auto 0 1.2rem 0;
  text-align: center;
  font-size: 0.85rem;
  color: var(--bb-text-faint, #9a9a9a);
  pointer-events: none;
}
</style>
