<template>
  <div ref="wrap" class="bb-canvas">
    <svg
      ref="svgEl"
      :viewBox="vbStr"
      class="bb-svg"
      :class="{ wiring: tool?.type === 'wire', placing: tool?.type === 'place', dragging: !!drag, panmode: panMode }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerleave="onLeave"
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
        :dimmed="itemDimmed(it)"
      />

      <!-- wires (drawn above parts so connections stay visible on boards) -->
      <g class="wires">
        <g v-for="w in data.wires" :key="w.id">
          <path
            :d="wirePath(w)" class="wire"
            :class="{ 'wire-sel': w.id === selectedWireId, dimmed: wireDimmed(w) }"
            :style="{ stroke: w.color || '#16a34a' }"
          />
          <circle
            v-for="pt in wireEnds(w)" :key="pt.k" :cx="pt.x" :cy="pt.y" r="3.4"
            class="wire-end" :class="{ dimmed: wireDimmed(w) }" :style="{ fill: w.color || '#16a34a' }"
          />
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
  placeInlineItem, itemBounds, endpointXY, pinEndpointId, isPinEndpoint, SNAP_R,
} from '@/lib/breadboard/geometry'
import { getTemplate, makeItem } from '@/lib/breadboard/templates'

const props = defineProps({
  data: { type: Object, required: true },
  sheetId: { type: String, default: '' },
  selectedId: { type: String, default: null },
  selectedWireId: { type: String, default: null },
  tool: { type: Object, default: null },
  wireColor: { type: String, default: '#16a34a' },
  wireGauge: { type: Number, default: 22 },
  wireType: { type: String, default: 'M-M' },
  locked: { type: Boolean, default: false },
  highlightDepth: { type: Number, default: 1 },
})
const emit = defineEmits(['add', 'move', 'select', 'add-wire', 'remove-wire', 'delete-selected', 'placed', 'cancel'])

const wrap = ref(null)
const svgEl = ref(null)
const vb = reactive({ x: 0, y: 0, w: 800, h: 500 })
const vbStr = computed(() => `${vb.x} ${vb.y} ${vb.w} ${vb.h}`)

const pointer = ref(null)
const hoverHole = ref(null)
const wireStart = ref(null)
const drag = ref(null)
const pan = ref(null)
const panMode = ref(false)
const hover = ref(null) // { type: 'item' | 'wire', id } under the pointer

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
  const dir = w.arc === -1 ? -1 : 1
  const lift = Math.hypot(b.x - a.x, b.y - a.y) * 0.16 + 6
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2 - lift * dir
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

// ── unified pick: nearest wire (forgiving) else topmost item ──
// Hit radius tracks zoom so a thin wire stays grabbable at any scale:
// ~12 screen px worth of scene units, floored so it's never too tight when zoomed in.
function wireHitRadius() {
  const scale = vb.w / (wrap.value?.clientWidth || 1) // scene units per screen px
  return Math.max(10, 12 * scale)
}
function nearestWire(p) {
  let best = null
  let bestD = wireHitRadius() ** 2
  const ctx = wireCtx()
  for (const w of props.data.wires || []) {
    const a = endpointXY(w.from, ctx)
    const b = endpointXY(w.to, ctx)
    if (!a || !b) continue
    const dir = w.arc === -1 ? -1 : 1
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const lift = len * 0.16 + 6
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2 - lift * dir
    // enough samples that the gap between them stays under the hit radius
    const steps = Math.max(16, Math.ceil((len + lift) / 8))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const mt = 1 - t
      const x = mt * mt * a.x + 2 * mt * t * cx + t * t * b.x
      const y = mt * mt * a.y + 2 * mt * t * cy + t * t * b.y
      const d = (x - p.x) ** 2 + (y - p.y) ** 2
      if (d < bestD) { bestD = d; best = w }
    }
  }
  return best
}
function pick(p) {
  const w = nearestWire(p)
  if (w) return { type: 'wire', id: w.id }
  const it = topItemAt(p)
  if (it) return { type: 'item', id: it.id }
  return null
}

// ── focus + highlight (hover overrides persisted selection) ──
const activeFocus = computed(() => {
  if (hover.value) return hover.value
  if (props.selectedWireId) return { type: 'wire', id: props.selectedWireId }
  if (props.selectedId) return { type: 'item', id: props.selectedId }
  return null
})
// Local connectivity maps. We expand outward from the focused element by
// "hops" — each hop crosses one jumper wire. Parts sharing a copper strip
// (a column-half or rail segment, no wire between them) are always lit together
// as one region; the highlight-depth control governs how many wire-hops further
// we keep lit, rather than always stopping at the single part one hop away.
//
// A "terminal" is the unit a wire actually lands on: a strip group, or — for a
// standalone part wired straight to its pins — a bare pin endpoint.
const connectivity = computed(() => {
  const holesById = sceneLayout.value?.holesById || {}
  const epOwner = new Map() // pin endpoint id → item id
  const epGroup = new Map() // pin endpoint id → strip group (when plugged in)
  const groupParts = new Map() // strip group → Set(item id)
  const termParts = new Map() // terminal id → Set(item id)
  const itemTerminals = new Map() // item id → Set(terminal id)
  const addTo = (map, key, val) => {
    if (!map.has(key)) map.set(key, new Set())
    map.get(key).add(val)
  }
  for (const it of props.data.items || []) {
    for (const pin of it.pins || []) {
      const ep = pinEndpointId(it, pin)
      epOwner.set(ep, it.id)
      const g = pin.hole ? holesById[pin.hole]?.group : null
      const term = g ? `grp:${g}` : `pin:${ep}`
      if (g) { epGroup.set(ep, g); addTo(groupParts, g, it.id) }
      addTo(termParts, term, it.id)
      addTo(itemTerminals, it.id, term)
    }
  }
  return { holesById, epOwner, epGroup, groupParts, termParts, itemTerminals }
})
// Resolve a wire endpoint (a hole id, or a pin endpoint) to its terminal key.
function terminalOf(ep) {
  const c = connectivity.value
  if (isPinEndpoint(ep)) {
    const g = c.epGroup.get(ep)
    return g ? `grp:${g}` : `pin:${ep}`
  }
  const g = c.holesById[ep]?.group
  return g ? `grp:${g}` : null
}
// Set of { items, wires } to keep lit; null ⇒ dim nothing.
const highlight = computed(() => {
  const f = activeFocus.value
  if (!f) return null
  const c = connectivity.value
  const wlist = props.data.wires || []
  const depth = Math.max(0, props.highlightDepth ?? 1)

  const items = new Set()
  const wires = new Set()
  const terminals = new Set()

  // Pull in a part together with every strip it bridges and the other parts on
  // those strips — transitively, all without crossing a wire (one copper region).
  function reachItem(id) {
    if (items.has(id)) return
    items.add(id)
    for (const t of c.itemTerminals.get(id) || []) reachTerminal(t)
  }
  function reachTerminal(t) {
    if (!t || terminals.has(t)) return
    terminals.add(t)
    for (const pid of c.termParts.get(t) || []) reachItem(pid)
  }

  // Seed level 0 (the copper region touching the focus).
  let hops = depth
  if (f.type === 'wire') {
    const w = wlist.find((x) => x.id === f.id)
    if (!w) return null
    wires.add(w.id)
    reachTerminal(terminalOf(w.from))
    reachTerminal(terminalOf(w.to))
    hops = depth - 1 // the focused wire itself spends the first hop
  } else {
    reachItem(f.id)
  }

  // Each hop lights up one more layer of jumper wires and what they reach.
  for (let i = 0; i < hops; i++) {
    const next = new Set()
    for (const w of wlist) {
      const tf = terminalOf(w.from)
      const tt = terminalOf(w.to)
      const fHit = tf && terminals.has(tf)
      const tHit = tt && terminals.has(tt)
      if (!fHit && !tHit) continue
      wires.add(w.id)
      if (fHit && tt && !terminals.has(tt)) next.add(tt)
      if (tHit && tf && !terminals.has(tf)) next.add(tf)
    }
    if (!next.size) break
    for (const t of next) reachTerminal(t)
  }
  return { items, wires }
})
function itemDimmed(it) {
  return !!highlight.value && !highlight.value.items.has(it.id)
}
function wireDimmed(w) {
  return !!highlight.value && !highlight.value.wires.has(w.id)
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
    emit('select', { type: 'item', id: item.id })
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
  // a locked board still selects + pans for inspection, but never places,
  // wires, or moves anything — so the layout can't be nudged by accident.
  if (!props.locked && props.tool?.type === 'place') { placeAt(props.tool.kind, p); return }
  if (!props.locked && props.tool?.type === 'wire') {
    const ep = nearestEndpoint(p)
    if (!ep) return
    if (!wireStart.value) wireStart.value = ep
    else if (ep.id !== wireStart.value.id) {
      emit('add-wire', { id: uuid(), from: wireStart.value.id, to: ep.id, color: props.wireColor, gauge: props.wireGauge, type: props.wireType })
      wireStart.value = null
    }
    return
  }

  // panning only via middle mouse or held Space — never on a plain background click
  if (e.button === 1 || panMode.value) {
    hover.value = null
    pan.value = { cx: e.clientX, cy: e.clientY, vx: vb.x, vy: vb.y }
    try { svgEl.value.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    return
  }

  const picked = pick(p)
  if (picked?.type === 'wire') {
    emit('select', { type: 'wire', id: picked.id })
    return
  }
  if (picked?.type === 'item') {
    const hit = itemsById.value[picked.id]
    emit('select', { type: 'item', id: hit.id })
    hover.value = null
    if (props.locked) return // selected for inspection, but no dragging
    const standalone = (hit.placement || getTemplate(hit.kind)?.placement) === 'standalone'
    const anchor = standalone
      ? { x: hit.x, y: hit.y }
      : sceneLayout.value.holesById[hit.pins[0]?.hole] || { x: hit.x, y: hit.y }
    drag.value = { id: hit.id, ox: p.x - anchor.x, oy: p.y - anchor.y, standalone }
    try { svgEl.value.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  } else {
    emit('select', null)
  }
}

function onMove(e) {
  const p = toSvg(e)
  pointer.value = p
  hoverHole.value = nearestHole(sceneLayout.value, p.x, p.y)

  // hover-focus only in selection mode (not while placing/wiring/dragging/panning)
  if (!drag.value && !pan.value && !props.tool) hover.value = pick(p)

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

function onLeave() {
  hover.value = null
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

function isTypingTarget(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}
function onKey(e) {
  if (isTypingTarget(e.target)) return
  if (e.key === 'Escape') {
    if (wireStart.value) wireStart.value = null
    emit('cancel')
  } else if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault()
    panMode.value = true
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (props.locked) return // no destructive edits while locked
    e.preventDefault()
    emit('delete-selected')
  }
}
function onKeyUp(e) {
  if (e.key === ' ' || e.code === 'Space') panMode.value = false
}

let ro = null
onMounted(() => {
  nextTick(fit)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
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
  window.removeEventListener('keyup', onKeyUp)
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
  cursor: default;
}
.bb-svg.panmode {
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
  transition: opacity 0.12s;
}
.wire.wire-sel {
  stroke-width: 4.6px;
  opacity: 1;
  filter: drop-shadow(0 0 2px rgba(20, 184, 166, 0.9));
}
.wire.dimmed,
.wire-end.dimmed {
  opacity: 0.12;
}
.wire-end {
  stroke: rgba(0, 0, 0, 0.25);
  stroke-width: 0.5px;
  transition: opacity 0.12s;
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
