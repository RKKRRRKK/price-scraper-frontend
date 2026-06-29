<template>
  <div
    ref="wrap"
    class="canvy-canvas"
    :class="{ panning: panning, 'tool-active': !!tool, 'space-down': spaceDown }"
    @pointerdown="onBgPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
    @wheel.prevent="onWheel"
    @contextmenu.prevent
  >
    <!-- World (panned + zoomed) -->
    <div class="world" :style="worldStyle">
      <div
        v-for="el in model.elements"
        :key="el.id"
        class="el"
        :class="[
          'el-' + el.type,
          {
            selected: selectedId === el.id,
            editing: editingId === el.id,
            'arrow-src': arrowStart === el.id,
            'arrow-target': tool === 'arrow' && arrowStart && arrowStart !== el.id,
          },
        ]"
        :style="elStyle(el)"
        @pointerdown.stop="onElPointerDown($event, el)"
        @dblclick.stop="startEdit(el)"
      >
        <!-- shape backdrop (rect / ellipse / diamond) -->
        <div
          v-if="el.type === 'shape'"
          class="shape-fill"
          :class="'shape-' + el.shape"
          :style="fillStyle(el)"
        ></div>

        <div
          class="el-content"
          :contenteditable="editingId === el.id"
          spellcheck="false"
          :data-placeholder="placeholderFor(el)"
          :ref="(node) => initText(node, el)"
          @input="onTextInput($event, el)"
          @blur="onTextBlur"
          @pointerdown="onTextPointerDown($event, el)"
        ></div>

        <div
          v-if="selectedId === el.id && editingId !== el.id"
          class="resize-handle"
          @pointerdown.stop="onResizeDown($event, el)"
        ></div>

        <!-- per-element mini toolbar -->
        <div
          v-if="selectedId === el.id && editingId !== el.id"
          class="el-toolbar"
          @pointerdown.stop
        >
          <button
            v-for="key in SWATCHES"
            :key="key"
            class="swatch"
            :class="{ on: (el.color || 'yellow') === key }"
            :style="{ background: COLORS[key].fill, borderColor: COLORS[key].stroke }"
            :title="key"
            @click="setColor(el, key)"
          ></button>
          <span class="el-toolbar-sep"></span>
          <button class="el-toolbar-btn danger" title="Delete" @click="removeElement(el.id)">
            <i class="pi pi-trash"></i>
          </button>
        </div>
      </div>
    </div>

    <!-- Screen-space overlay: connectors -->
    <svg class="overlay" :width="size.w" :height="size.h">
      <defs>
        <marker
          id="canvy-arrowhead"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L8,3 L0,6 Z" fill="#6b6b6b" />
        </marker>
        <marker
          id="canvy-arrowhead-on"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L8,3 L0,6 Z" fill="var(--accent-600)" />
        </marker>
      </defs>
      <g v-for="a in arrowGeoms" :key="a.id">
        <line
          class="arrow-hit"
          :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2"
          @pointerdown.stop="selectArrow(a.id)"
          @dblclick.stop="editArrowLabel(a.id)"
        />
        <line
          class="arrow-line"
          :class="{ on: selectedArrowId === a.id }"
          :x1="a.x1" :y1="a.y1" :x2="a.x2" :y2="a.y2"
          :marker-end="selectedArrowId === a.id ? 'url(#canvy-arrowhead-on)' : 'url(#canvy-arrowhead)'"
        />
        <text v-if="a.label" class="arrow-label" :x="a.mx" :y="a.my">{{ a.label }}</text>
      </g>
    </svg>

    <!-- Comment pins (screen space) -->
    <div
      v-for="c in model.comments"
      :key="c.id"
      class="comment-pin"
      :class="{ open: openCommentId === c.id }"
      :style="pinStyle(c)"
      @pointerdown.stop="onPinPointerDown($event, c)"
    >
      <i class="pi pi-comment"></i>
    </div>

    <!-- Comment popover -->
    <div
      v-if="openComment"
      class="comment-pop"
      :style="popStyle(openComment)"
      @pointerdown.stop
    >
      <textarea
        ref="commentInput"
        class="comment-ta"
        v-model="openComment.text"
        placeholder="Write a comment…"
        rows="3"
        @change="commit"
      ></textarea>
      <div class="comment-pop-foot">
        <button class="comment-del" @click="removeComment(openComment.id)">
          <i class="pi pi-trash"></i> Delete
        </button>
        <button class="comment-done" @click="closeComment">Done</button>
      </div>
    </div>

    <!-- Hint while a tool is active -->
    <div v-if="hint" class="canvas-hint">{{ hint }}</div>

    <!-- Zoom controls -->
    <div class="zoom-controls">
      <button title="Zoom out" @click="zoomBy(0.83)"><i class="pi pi-minus"></i></button>
      <button class="zoom-level" title="Reset zoom" @click="resetView">{{ Math.round(cam.zoom * 100) }}%</button>
      <button title="Zoom in" @click="zoomBy(1.2)"><i class="pi pi-plus"></i></button>
      <button title="Fit to content" @click="fit"><i class="pi pi-expand"></i></button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { v4 as uuid } from 'uuid'

const props = defineProps({
  boardId: { type: String, default: null },
  data: { type: Object, default: () => ({}) },
  tool: { type: String, default: null }, // 'sticky'|'text'|'shape-rect'|'shape-ellipse'|'shape-diamond'|'arrow'|'comment'|null
})
const emit = defineEmits(['update', 'tool-used'])

// ── Sticky / shape colour palette ──
const COLORS = {
  yellow: { fill: '#fff6c2', stroke: '#ecd56b' },
  pink: { fill: '#ffd9e2', stroke: '#f3a3b6' },
  blue: { fill: '#d6e8ff', stroke: '#94bff2' },
  green: { fill: '#d4f3dd', stroke: '#8fd3a3' },
  purple: { fill: '#e7dcff', stroke: '#bda3f0' },
  gray: { fill: '#ecebe7', stroke: '#cfccc5' },
}
const SWATCHES = Object.keys(COLORS)

// ── Local working copy (mutated for instant feedback, emitted up to persist) ──
const model = reactive({ elements: [], arrows: [], comments: [] })
const byId = computed(() => {
  const m = new Map()
  for (const el of model.elements) m.set(el.id, el)
  return m
})

function clone(v) {
  return JSON.parse(JSON.stringify(v ?? []))
}
function loadFromProps() {
  const d = props.data || {}
  model.elements = clone(d.elements || [])
  model.arrows = clone(d.arrows || [])
  model.comments = clone(d.comments || [])
  selectedId.value = null
  editingId.value = null
  selectedArrowId.value = null
  openCommentId.value = null
  arrowStart.value = null
}
function commit() {
  emit('update', {
    elements: clone(model.elements),
    arrows: clone(model.arrows),
    comments: clone(model.comments),
  })
}

watch(
  () => props.boardId,
  () => {
    loadFromProps()
    nextTick(fit)
  },
  { immediate: true },
)

// ── Camera (CSS transform) ──
const wrap = ref(null)
const cam = reactive({ x: 0, y: 0, zoom: 1 })
const size = reactive({ w: 0, h: 0 })
const worldStyle = computed(() => ({
  transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`,
}))

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi)
}
function screenToWorld(clientX, clientY) {
  const r = wrap.value.getBoundingClientRect()
  return {
    x: (clientX - r.left - cam.x) / cam.zoom,
    y: (clientY - r.top - cam.y) / cam.zoom,
  }
}
function worldToScreen(wx, wy) {
  return { x: wx * cam.zoom + cam.x, y: wy * cam.zoom + cam.y }
}

function onWheel(e) {
  const r = wrap.value.getBoundingClientRect()
  const sx = e.clientX - r.left
  const sy = e.clientY - r.top
  const factor = e.deltaY < 0 ? 1.1 : 0.9
  const nz = clamp(cam.zoom * factor, 0.2, 4)
  const wx = (sx - cam.x) / cam.zoom
  const wy = (sy - cam.y) / cam.zoom
  cam.zoom = nz
  cam.x = sx - wx * nz
  cam.y = sy - wy * nz
}
function zoomBy(factor) {
  const r = wrap.value.getBoundingClientRect()
  const sx = r.width / 2
  const sy = r.height / 2
  const nz = clamp(cam.zoom * factor, 0.2, 4)
  const wx = (sx - cam.x) / cam.zoom
  const wy = (sy - cam.y) / cam.zoom
  cam.zoom = nz
  cam.x = sx - wx * nz
  cam.y = sy - wy * nz
}
function resetView() {
  cam.x = 0
  cam.y = 0
  cam.zoom = 1
}
function fit() {
  const els = model.elements
  const r = wrap.value?.getBoundingClientRect()
  if (!r) return
  if (!els.length) {
    resetView()
    return
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const el of els) {
    minX = Math.min(minX, el.x)
    minY = Math.min(minY, el.y)
    maxX = Math.max(maxX, el.x + el.w)
    maxY = Math.max(maxY, el.y + el.h)
  }
  const pad = 80
  minX -= pad; minY -= pad; maxX += pad; maxY += pad
  const bw = maxX - minX
  const bh = maxY - minY
  const zoom = clamp(Math.min(r.width / bw, r.height / bh), 0.2, 2)
  cam.zoom = zoom
  cam.x = (r.width - bw * zoom) / 2 - minX * zoom
  cam.y = (r.height - bh * zoom) / 2 - minY * zoom
}

// ── Selection / interaction state ──
const selectedId = ref(null)
const editingId = ref(null)
const selectedArrowId = ref(null)
const arrowStart = ref(null)
const openCommentId = ref(null)
const panning = ref(false)
const spaceDown = ref(false)

const openComment = computed(() => model.comments.find((c) => c.id === openCommentId.value) || null)

let pan = null
let drag = null
let resize = null
let pinDrag = null

const hint = computed(() => {
  if (props.tool === 'arrow') {
    return arrowStart.value ? 'Click a target element to connect' : 'Click a source element'
  }
  if (props.tool === 'comment') return 'Click anywhere to drop a comment'
  if (props.tool) return 'Click on the canvas to place'
  return ''
})

// ── Element styles ──
function elStyle(el) {
  return {
    left: el.x + 'px',
    top: el.y + 'px',
    width: el.w + 'px',
    height: el.h + 'px',
    ...(el.type !== 'shape' && el.type !== 'text'
      ? { background: COLORS[el.color || 'yellow'].fill, borderColor: COLORS[el.color || 'yellow'].stroke }
      : {}),
  }
}
function fillStyle(el) {
  const c = COLORS[el.color || 'blue']
  return { background: c.fill, borderColor: c.stroke }
}
function placeholderFor(el) {
  if (el.type === 'sticky') return 'Sticky note'
  if (el.type === 'text') return 'Text'
  return 'Label'
}

// ── Background pointer (create / pan / deselect) ──
function onBgPointerDown(e) {
  // Creation tools
  if (props.tool && props.tool !== 'arrow') {
    const p = screenToWorld(e.clientX, e.clientY)
    if (props.tool === 'comment') {
      addComment(p.x, p.y)
    } else {
      addElement(props.tool, p.x, p.y)
    }
    emit('tool-used')
    return
  }
  // Arrow tool: clicking empty cancels the in-progress connection
  if (props.tool === 'arrow') {
    arrowStart.value = null
    emit('tool-used')
    return
  }
  // Otherwise: deselect + pan
  deselectAll()
  pan = { sx: e.clientX, sy: e.clientY, camx: cam.x, camy: cam.y }
  panning.value = true
  capture(e)
}

function deselectAll() {
  selectedId.value = null
  selectedArrowId.value = null
  if (editingId.value) editingId.value = null
  openCommentId.value = null
}

function capture(e) {
  try { wrap.value.setPointerCapture(e.pointerId) } catch { /* ignore */ }
}

// ── Element pointer ──
function onElPointerDown(e, el) {
  if (spaceDown.value) {
    pan = { sx: e.clientX, sy: e.clientY, camx: cam.x, camy: cam.y }
    panning.value = true
    capture(e)
    return
  }
  if (props.tool === 'arrow') {
    handleArrowClick(el)
    return
  }
  selectedArrowId.value = null
  openCommentId.value = null
  selectedId.value = el.id
  if (editingId.value === el.id) return // editing — let the caret handle it
  if (editingId.value) editingId.value = null
  const p = screenToWorld(e.clientX, e.clientY)
  drag = { id: el.id, ox: p.x - el.x, oy: p.y - el.y, moved: false }
  capture(e)
}

function onTextPointerDown(e, el) {
  // While editing this element, keep the click for the caret (don't start a drag)
  if (editingId.value === el.id) e.stopPropagation()
}

function onPointerMove(e) {
  if (pan) {
    cam.x = pan.camx + (e.clientX - pan.sx)
    cam.y = pan.camy + (e.clientY - pan.sy)
    return
  }
  if (drag) {
    const p = screenToWorld(e.clientX, e.clientY)
    const el = byId.value.get(drag.id)
    if (!el) return
    el.x = Math.round(p.x - drag.ox)
    el.y = Math.round(p.y - drag.oy)
    drag.moved = true
    return
  }
  if (resize) {
    const el = byId.value.get(resize.id)
    if (!el) return
    el.w = Math.max(60, Math.round(resize.w0 + (e.clientX - resize.sx) / cam.zoom))
    el.h = Math.max(40, Math.round(resize.h0 + (e.clientY - resize.sy) / cam.zoom))
    return
  }
  if (pinDrag) {
    const c = model.comments.find((x) => x.id === pinDrag.id)
    if (!c) return
    const p = screenToWorld(e.clientX, e.clientY)
    c.x = Math.round(p.x - pinDrag.ox)
    c.y = Math.round(p.y - pinDrag.oy)
    pinDrag.moved = true
    return
  }
}

function onPointerUp(e) {
  if (pan) { pan = null; panning.value = false }
  if (drag) { if (drag.moved) commit(); drag = null }
  if (resize) { commit(); resize = null }
  if (pinDrag) {
    if (pinDrag.moved) commit()
    else openCommentId.value = pinDrag.id
    pinDrag = null
  }
  try { wrap.value.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
}

// ── Resize ──
function onResizeDown(e, el) {
  resize = { id: el.id, sx: e.clientX, sy: e.clientY, w0: el.w, h0: el.h }
  capture(e)
}

// ── Create elements / comments ──
const DEFAULTS = {
  sticky: { w: 180, h: 140, color: 'yellow' },
  text: { w: 220, h: 48 },
  shape: { w: 180, h: 110, color: 'blue' },
}
function addElement(tool, x, y) {
  let el
  if (tool === 'sticky') {
    el = { id: uuid(), type: 'sticky', x: snap(x), y: snap(y), ...DEFAULTS.sticky, text: '' }
  } else if (tool === 'text') {
    el = { id: uuid(), type: 'text', x: snap(x), y: snap(y), ...DEFAULTS.text, text: '' }
  } else if (tool.startsWith('shape-')) {
    el = { id: uuid(), type: 'shape', shape: tool.slice(6), x: snap(x), y: snap(y), ...DEFAULTS.shape, text: '' }
  } else {
    return
  }
  // Center the new element on the click point
  el.x = Math.round(el.x - el.w / 2)
  el.y = Math.round(el.y - el.h / 2)
  model.elements.push(el)
  selectedId.value = el.id
  commit()
  nextTick(() => startEdit(el))
}
function snap(v) {
  return Math.round(v)
}

function addComment(x, y) {
  const c = { id: uuid(), x: Math.round(x), y: Math.round(y), text: '' }
  model.comments.push(c)
  commit()
  openCommentId.value = c.id
  nextTick(() => commentInput.value?.focus())
}

// ── Text editing (contenteditable) ──
const textNodes = new Map()
function initText(node, el) {
  if (!node) return
  textNodes.set(el.id, node)
  if (node.__initId !== el.id) {
    node.textContent = el.text || ''
    node.__initId = el.id
  }
}
function onTextInput(e, el) {
  el.text = e.target.innerText
}
function onTextBlur() {
  editingId.value = null
  commit()
}
function startEdit(el) {
  selectedId.value = el.id
  editingId.value = el.id
  nextTick(() => {
    const node = textNodes.get(el.id)
    if (node) {
      node.focus()
      // place caret at end
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(node)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  })
}

// ── Colours / delete ──
function setColor(el, key) {
  el.color = key
  commit()
}
function removeElement(id) {
  model.elements = model.elements.filter((el) => el.id !== id)
  model.arrows = model.arrows.filter(
    (a) => a.from?.elementId !== id && a.to?.elementId !== id,
  )
  if (selectedId.value === id) selectedId.value = null
  textNodes.delete(id)
  commit()
}

// ── Arrows ──
function handleArrowClick(el) {
  if (!arrowStart.value) {
    arrowStart.value = el.id
    return
  }
  if (arrowStart.value !== el.id) {
    model.arrows.push({
      id: uuid(),
      from: { elementId: arrowStart.value },
      to: { elementId: el.id },
      label: '',
    })
    commit()
  }
  arrowStart.value = null
  emit('tool-used')
}
function selectArrow(id) {
  selectedArrowId.value = id
  selectedId.value = null
}
function editArrowLabel(id) {
  const a = model.arrows.find((x) => x.id === id)
  if (!a) return
  const label = window.prompt('Connection label', a.label || '')
  if (label !== null) {
    a.label = label
    commit()
  }
}
function removeArrow(id) {
  model.arrows = model.arrows.filter((a) => a.id !== id)
  if (selectedArrowId.value === id) selectedArrowId.value = null
  commit()
}

// Point on a box border in the direction of (tx, ty) from the box centre.
function edgePoint(el, tx, ty) {
  const cx = el.x + el.w / 2
  const cy = el.y + el.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const hw = el.w / 2
  const hh = el.h / 2
  const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh)
  return { x: cx + dx * scale, y: cy + dy * scale }
}
function endpointCenter(end) {
  if (end?.elementId != null) {
    const el = byId.value.get(end.elementId)
    if (el) return { x: el.x + el.w / 2, y: el.y + el.h / 2, el }
  }
  return { x: end?.x ?? 0, y: end?.y ?? 0, el: null }
}

const arrowGeoms = computed(() => {
  // depend on camera so screen coords recompute on pan/zoom
  void cam.x; void cam.y; void cam.zoom
  const out = []
  for (const a of model.arrows) {
    const from = endpointCenter(a.from)
    const to = endpointCenter(a.to)
    const fp = from.el ? edgePoint(from.el, to.x, to.y) : from
    const tp = to.el ? edgePoint(to.el, from.x, from.y) : to
    const s1 = worldToScreen(fp.x, fp.y)
    const s2 = worldToScreen(tp.x, tp.y)
    out.push({
      id: a.id,
      x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y,
      mx: (s1.x + s2.x) / 2, my: (s1.y + s2.y) / 2 - 6,
      label: a.label,
    })
  }
  return out
})

// ── Comments ──
function pinStyle(c) {
  const s = worldToScreen(c.x, c.y)
  return { left: s.x + 'px', top: s.y + 'px' }
}
function popStyle(c) {
  const s = worldToScreen(c.x, c.y)
  return { left: s.x + 14 + 'px', top: s.y + 'px' }
}
const commentInput = ref(null)
function onPinPointerDown(e, c) {
  const p = screenToWorld(e.clientX, e.clientY)
  pinDrag = { id: c.id, ox: p.x - c.x, oy: p.y - c.y, moved: false }
  capture(e)
}
function removeComment(id) {
  model.comments = model.comments.filter((c) => c.id !== id)
  if (openCommentId.value === id) openCommentId.value = null
  commit()
}
function closeComment() {
  openCommentId.value = null
  commit()
}

// ── Keyboard ──
function isTyping(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
function onKey(e) {
  if (e.key === ' ' || e.code === 'Space') {
    if (isTyping(e.target)) return
    e.preventDefault()
    spaceDown.value = true
    return
  }
  if (e.key === 'Escape') {
    arrowStart.value = null
    deselectAll()
    emit('tool-used')
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (isTyping(e.target)) return
    if (selectedId.value) { e.preventDefault(); removeElement(selectedId.value) }
    else if (selectedArrowId.value) { e.preventDefault(); removeArrow(selectedArrowId.value) }
  }
}
function onKeyUp(e) {
  if (e.key === ' ' || e.code === 'Space') spaceDown.value = false
}

// ── Lifecycle ──
let ro = null
function measure() {
  const r = wrap.value?.getBoundingClientRect()
  if (r) { size.w = r.width; size.h = r.height }
}
onMounted(() => {
  measure()
  nextTick(fit)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  if (window.ResizeObserver && wrap.value) {
    ro = new ResizeObserver(measure)
    ro.observe(wrap.value)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
  if (ro) ro.disconnect()
})

defineExpose({ fit, resetView })
</script>

<style scoped>
.canvy-canvas {
  --accent-500: #ef4444;
  --accent-600: #b91c1c;
  --accent-400: #f87171;
  --accent-100: #fee2e2;
  --accent-050: #fef2f2;

  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #faf9f7;
  background-image: radial-gradient(#e2e0db 1px, transparent 1px);
  background-size: 22px 22px;
  touch-action: none;
  cursor: default;
  user-select: none;
}
.canvy-canvas.tool-active { cursor: crosshair; }
.canvy-canvas.space-down { cursor: grab; }
.canvy-canvas.panning { cursor: grabbing; }

.world {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  width: 0;
  height: 0;
}

/* ── Elements ── */
.el {
  position: absolute;
  box-sizing: border-box;
  border-radius: 0.5rem;
  display: flex;
  align-items: stretch;
}
.el.selected { outline: 2px solid var(--accent-500); outline-offset: 2px; }
.el.arrow-target { outline: 2px dashed var(--accent-400); outline-offset: 2px; cursor: pointer; }
.el.arrow-src { outline: 2px solid var(--accent-600); outline-offset: 2px; }

.el-sticky {
  border: 1px solid;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  padding: 0.55rem 0.65rem;
}
.el-text { background: transparent; }
.el-shape { padding: 0; }

/* shape backdrop */
.shape-fill {
  position: absolute;
  inset: 0;
  border: 2px solid;
  pointer-events: none;
}
.shape-fill.shape-rect { border-radius: 0.5rem; }
.shape-fill.shape-ellipse { border-radius: 50%; }
.shape-fill.shape-diamond {
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  border: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.12));
}

/* text content */
.el .el-content {
  position: relative;
  flex: 1;
  min-width: 0;
  outline: none;
  font-size: 0.95rem;
  line-height: 1.4;
  color: #1f1f1f;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
}
.el .el-content[contenteditable='true'] { cursor: text; }
.el-text > .el-content { font-size: 1.05rem; font-weight: 500; padding: 0.3rem 0.4rem; }
.el-shape > .el-content {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0.5rem;
}
.el-content:empty::before {
  content: attr(data-placeholder);
  color: #b5b2ab;
  pointer-events: none;
}

/* resize handle */
.resize-handle {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: #fff;
  border: 2px solid var(--accent-500);
  cursor: nwse-resize;
  z-index: 3;
}

/* per-element mini toolbar */
.el-toolbar {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem 0.4rem;
  background: #fff;
  border: 1px solid #e5e4e1;
  border-radius: 0.5rem;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
  z-index: 4;
  white-space: nowrap;
}
.swatch {
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  border: 1.5px solid;
  cursor: pointer;
  padding: 0;
}
.swatch.on { outline: 2px solid var(--accent-500); outline-offset: 1px; }
.el-toolbar-sep { width: 1px; height: 1.1rem; background: #e5e4e1; margin: 0 0.15rem; }
.el-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.35rem;
  border: none;
  background: none;
  color: #5c5c5c;
  cursor: pointer;
  font-size: 0.8rem;
}
.el-toolbar-btn.danger:hover { background: #fff0f0; color: #c33; }

/* ── Connectors overlay ── */
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
.arrow-line {
  stroke: #6b6b6b;
  stroke-width: 2;
  fill: none;
}
.arrow-line.on { stroke: var(--accent-600); stroke-width: 2.5; }
.arrow-hit {
  stroke: transparent;
  stroke-width: 14;
  fill: none;
  pointer-events: stroke;
  cursor: pointer;
}
.arrow-label {
  font-size: 12px;
  fill: #3a3a3a;
  text-anchor: middle;
  paint-order: stroke;
  stroke: #faf9f7;
  stroke-width: 3px;
}

/* ── Comment pins ── */
.comment-pin {
  position: absolute;
  transform: translate(-4px, -100%);
  width: 1.85rem;
  height: 1.85rem;
  border-radius: 50% 50% 50% 2px;
  background: var(--accent-500);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  z-index: 6;
}
.comment-pin.open,
.comment-pin:hover { background: var(--accent-600); }

.comment-pop {
  position: absolute;
  width: 15rem;
  background: #fff;
  border: 1px solid #e5e4e1;
  border-radius: 0.6rem;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.16);
  padding: 0.6rem;
  z-index: 7;
}
.comment-ta {
  width: 100%;
  border: 1px solid #e5e4e1;
  border-radius: 0.45rem;
  padding: 0.45rem 0.55rem;
  font: inherit;
  font-size: 0.85rem;
  resize: vertical;
  outline: none;
}
.comment-ta:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-050); }
.comment-pop-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.45rem;
}
.comment-del {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.78rem;
  color: #c33;
  background: none;
  border: none;
  cursor: pointer;
}
.comment-done {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent-600);
  background: var(--accent-050);
  border: 1px solid var(--accent-100);
  border-radius: 0.4rem;
  padding: 0.25rem 0.7rem;
  cursor: pointer;
}

/* ── Hint + zoom controls ── */
.canvas-hint {
  position: absolute;
  top: 0.85rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(26, 26, 26, 0.85);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  pointer-events: none;
  z-index: 8;
}
.zoom-controls {
  position: absolute;
  right: 0.85rem;
  bottom: 0.85rem;
  display: flex;
  align-items: center;
  gap: 0.15rem;
  background: #fff;
  border: 1px solid #e5e4e1;
  border-radius: 0.6rem;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  padding: 0.2rem;
  z-index: 8;
}
.zoom-controls button {
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: #5c5c5c;
  border-radius: 0.4rem;
  cursor: pointer;
  font-size: 0.8rem;
}
.zoom-controls button:hover { background: #f3f2f0; color: #1a1a1a; }
.zoom-controls .zoom-level {
  width: auto;
  padding: 0 0.5rem;
  font-size: 0.78rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
