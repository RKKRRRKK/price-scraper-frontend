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
    @mousedown.middle.prevent
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
            selected: selectedIds.has(el.id),
            editing: editingId === el.id,
            'arrow-src': (tool === 'arrow' && arrowStart === el.id) || (connecting && connecting.fromId === el.id),
            'arrow-target':
              (tool === 'arrow' && arrowStart && arrowStart !== el.id) ||
              (connecting && connectTargetId === el.id && connecting.fromId !== el.id),
          },
        ]"
        :style="elStyle(el)"
        @pointerenter="hoverId = el.id"
        @pointerleave="hoverId === el.id && (hoverId = null)"
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

        <!-- connection handles: drag from any side/corner to draw an arrow -->
        <template v-if="showHandles(el)">
          <div
            v-for="h in CONNECT_POINTS"
            :key="h.k"
            class="connect-handle"
            :class="'ch-' + h.k"
            :style="{ left: h.x + '%', top: h.y + '%' }"
            title="Drag to connect"
            @pointerdown.stop="startConnect($event, el)"
          ></div>
        </template>

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
      <line
        v-if="tempArrow"
        class="arrow-line temp"
        :x1="tempArrow.x1" :y1="tempArrow.y1" :x2="tempArrow.x2" :y2="tempArrow.y2"
        marker-end="url(#canvy-arrowhead-on)"
      />
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
      <span v-if="messageCount(c)" class="comment-pin-badge">{{ messageCount(c) }}</span>
    </div>

    <!-- Comment thread popover -->
    <div
      v-if="openComment"
      class="comment-pop"
      :style="popStyle(openComment)"
      @pointerdown.stop
    >
      <div class="comment-pop-head">
        <span><i class="pi pi-comment"></i> Thread</span>
        <button class="comment-head-del" title="Delete whole thread" @click="removeComment(openComment.id)">
          <i class="pi pi-trash"></i>
        </button>
      </div>

      <div class="comment-thread">
        <div v-if="!openComment.messages.length" class="comment-empty">No messages yet — start the thread below.</div>
        <div v-for="m in openComment.messages" :key="m.id" class="comment-msg">
          <div class="comment-msg-body">{{ m.text }}</div>
          <div class="comment-msg-meta">
            <span class="comment-msg-time">{{ msgTime(m) }}</span>
            <button class="comment-msg-del" title="Delete message" @click="deleteMessage(openComment.id, m.id)">
              <i class="pi pi-times"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="comment-reply">
        <textarea
          ref="commentInput"
          class="comment-ta"
          v-model="replyDraft"
          :placeholder="openComment.messages.length ? 'Reply… (Enter to send)' : 'Write a comment… (Enter to send)'"
          rows="2"
          @keydown.enter.exact.prevent="sendReply"
        ></textarea>
        <button class="comment-send" :disabled="!replyDraft.trim()" title="Send (Enter)" @click="sendReply">
          <i class="pi pi-send"></i>
        </button>
      </div>
    </div>

    <!-- Rubber-band selection rectangle -->
    <div
      v-if="marqueeRect"
      class="marquee"
      :style="{ left: marqueeRect.x + 'px', top: marqueeRect.y + 'px', width: marqueeRect.w + 'px', height: marqueeRect.h + 'px' }"
    ></div>

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
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime)

const props = defineProps({
  boardId: { type: String, default: null },
  data: { type: Object, default: () => ({}) },
  tool: { type: String, default: null }, // 'sticky'|'text'|'shape-rect'|'shape-ellipse'|'shape-diamond'|'arrow'|'comment'|null
})
const emit = defineEmits(['update', 'tool-used', 'set-tool'])

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

// Connection grab points (% of the element box): 4 sides + 4 corners.
const CONNECT_POINTS = [
  { k: 't', x: 50, y: 0 }, { k: 'b', x: 50, y: 100 },
  { k: 'l', x: 0, y: 50 }, { k: 'r', x: 100, y: 50 },
  { k: 'tl', x: 0, y: 0 }, { k: 'tr', x: 100, y: 0 },
  { k: 'bl', x: 0, y: 100 }, { k: 'br', x: 100, y: 100 },
]

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
  model.comments = (clone(d.comments || [])).map(normalizeComment)
  replyDraft.value = ''
  clearSelection()
  editingId.value = null
  selectedArrowId.value = null
  openCommentId.value = null
  arrowStart.value = null
  // reset undo/redo history for the freshly-loaded board
  undoStack = []
  redoStack = []
  lastSnapshot = serialize()
}

// ── Persist + undo/redo history ──
let undoStack = []
let redoStack = []
let lastSnapshot = '{}'
function serialize() {
  return JSON.stringify({ elements: model.elements, arrows: model.arrows, comments: model.comments })
}
function emitUpdate() {
  emit('update', {
    elements: clone(model.elements),
    arrows: clone(model.arrows),
    comments: clone(model.comments),
  })
}
function commit() {
  // Record the state *before* this change so it can be undone.
  undoStack.push(lastSnapshot)
  if (undoStack.length > 100) undoStack.shift()
  redoStack = []
  lastSnapshot = serialize()
  emitUpdate()
}
function applySnapshot(s) {
  const d = JSON.parse(s)
  model.elements = d.elements || []
  model.arrows = d.arrows || []
  model.comments = d.comments || []
  clearSelection()
  editingId.value = null
  selectedArrowId.value = null
  openCommentId.value = null
  replyDraft.value = ''
}
function undo() {
  if (!undoStack.length) return
  redoStack.push(serialize())
  const prev = undoStack.pop()
  applySnapshot(prev)
  lastSnapshot = prev
  emitUpdate()
}
function redo() {
  if (!redoStack.length) return
  undoStack.push(serialize())
  const next = redoStack.pop()
  applySnapshot(next)
  lastSnapshot = next
  emitUpdate()
}

// ── Clipboard (copy / paste of the selected element(s)) ──
let clipboard = null // array of element snapshots
function copySelected() {
  const ids = selectedIds.value
  if (!ids.size) return
  clipboard = model.elements.filter((el) => ids.has(el.id)).map((el) => clone(el))
}
function pasteClipboard() {
  if (!clipboard || !clipboard.length) return
  const fresh = clipboard.map((el) => ({ ...clone(el), id: uuid(), x: (el.x || 0) + 24, y: (el.y || 0) + 24 }))
  model.elements.push(...fresh)
  selectedIds.value = new Set(fresh.map((el) => el.id))
  clipboard = fresh.map((el) => clone(el)) // cascade repeated pastes
  commit()
}

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
const selectedIds = ref(new Set())        // multi-select; replaced (not mutated) so it stays reactive
const selectedId = computed(() => (selectedIds.value.size === 1 ? [...selectedIds.value][0] : null))
const editingId = ref(null)
const selectedArrowId = ref(null)
const arrowStart = ref(null)
const openCommentId = ref(null)
const replyDraft = ref('')
const panning = ref(false)
const spaceDown = ref(false)
const hoverId = ref(null)
const connectTargetId = ref(null)
const connecting = ref(null) // { fromId } while dragging a new arrow from a handle
const connectEnd = reactive({ x: 0, y: 0 })
const marqueeRect = ref(null) // { x, y, w, h } in screen px while rubber-band selecting

function selectOnly(id) { selectedIds.value = new Set(id ? [id] : []) }
function clearSelection() { selectedIds.value = new Set() }

const openComment = computed(() => model.comments.find((c) => c.id === openCommentId.value) || null)

let pan = null
let drag = null
let resize = null
let marquee = null
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
  // Pan only with space held or the middle mouse button.
  if (spaceDown.value || e.button === 1) { startPan(e); return }
  // Plain left drag on empty canvas → rubber-band selection (no panning).
  startMarquee(e)
}

function startPan(e) {
  pan = { sx: e.clientX, sy: e.clientY, camx: cam.x, camy: cam.y }
  panning.value = true
  capture(e)
}
function startMarquee(e) {
  selectedArrowId.value = null
  setOpenComment(null)
  if (!e.shiftKey) clearSelection()
  const r = wrap.value.getBoundingClientRect()
  marquee = { sx: e.clientX, sy: e.clientY, additive: e.shiftKey, base: new Set(selectedIds.value) }
  marqueeRect.value = { x: e.clientX - r.left, y: e.clientY - r.top, w: 0, h: 0 }
  capture(e)
}

function deselectAll() {
  clearSelection()
  selectedArrowId.value = null
  if (editingId.value) editingId.value = null
  setOpenComment(null)
}

function capture(e) {
  try { wrap.value.setPointerCapture(e.pointerId) } catch { /* ignore */ }
}

// ── Element pointer ──
function onElPointerDown(e, el) {
  if (spaceDown.value || e.button === 1) { startPan(e); return }
  if (props.tool === 'arrow') {
    handleArrowClick(el)
    return
  }
  selectedArrowId.value = null
  setOpenComment(null)
  if (e.shiftKey) {
    const next = new Set(selectedIds.value)
    next.has(el.id) ? next.delete(el.id) : next.add(el.id)
    selectedIds.value = next
  } else if (!selectedIds.value.has(el.id)) {
    selectOnly(el.id)
  }
  if (editingId.value === el.id) return // editing — let the caret handle it
  if (!selectedIds.value.has(el.id)) return // shift-click removed it from the selection
  // Arm a (possibly group) drag, but don't capture yet — capturing here would
  // swallow the follow-up click/dblclick (which is how you enter text-edit mode).
  const p = screenToWorld(e.clientX, e.clientY)
  const items = [...selectedIds.value]
    .map((id) => { const t = byId.value.get(id); return t ? { id, x0: t.x, y0: t.y } : null })
    .filter(Boolean)
  drag = { primary: el.id, items, ox: p.x, oy: p.y, moved: false, captured: false, sx: e.clientX, sy: e.clientY }
}

function onTextPointerDown(e, el) {
  // While editing this element, keep the click for the caret (don't start a drag)
  if (editingId.value === el.id) e.stopPropagation()
}

function onPointerMove(e) {
  if (connecting.value) {
    const p = screenToWorld(e.clientX, e.clientY)
    connectEnd.x = p.x
    connectEnd.y = p.y
    const target = elementAt(p.x, p.y, connecting.value.fromId)
    connectTargetId.value = target ? target.id : null
    return
  }
  if (pan) {
    cam.x = pan.camx + (e.clientX - pan.sx)
    cam.y = pan.camy + (e.clientY - pan.sy)
    return
  }
  if (marquee) {
    const r = wrap.value.getBoundingClientRect()
    const x1 = marquee.sx, y1 = marquee.sy, x2 = e.clientX, y2 = e.clientY
    marqueeRect.value = {
      x: Math.min(x1, x2) - r.left, y: Math.min(y1, y2) - r.top,
      w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    }
    const a = screenToWorld(Math.min(x1, x2), Math.min(y1, y2))
    const b = screenToWorld(Math.max(x1, x2), Math.max(y1, y2))
    const hit = new Set(marquee.additive ? marquee.base : [])
    for (const el of model.elements) {
      if (el.x < b.x && el.x + el.w > a.x && el.y < b.y && el.y + el.h > a.y) hit.add(el.id)
    }
    selectedIds.value = hit
    return
  }
  if (drag) {
    if (!drag.captured) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return
      drag.captured = true
      if (editingId.value) editingId.value = null
      capture(e)
    }
    const p = screenToWorld(e.clientX, e.clientY)
    const dx = p.x - drag.ox
    const dy = p.y - drag.oy
    for (const it of drag.items) {
      const el = byId.value.get(it.id)
      if (!el) continue
      el.x = Math.round(it.x0 + dx)
      el.y = Math.round(it.y0 + dy)
    }
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
  if (connecting.value) {
    finishConnect(e)
    try { wrap.value.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    return
  }
  if (pan) { pan = null; panning.value = false }
  if (marquee) { marquee = null; marqueeRect.value = null }
  if (drag) { if (drag.moved) commit(); drag = null }
  if (resize) { commit(); resize = null }
  if (pinDrag) {
    if (pinDrag.moved) commit()
    else setOpenComment(pinDrag.id)
    pinDrag = null
  }
  try { wrap.value.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
}

function finishConnect(e) {
  const fromId = connecting.value.fromId
  const p = screenToWorld(e.clientX, e.clientY)
  const target = elementAt(p.x, p.y, fromId)
  connecting.value = null
  connectTargetId.value = null
  if (target) {
    model.arrows.push({ id: uuid(), from: { elementId: fromId }, to: { elementId: target.id }, label: '' })
    commit()
  } else {
    const src = byId.value.get(fromId)
    // Ignore an accidental click with no real drag.
    if (src && Math.hypot(p.x - (src.x + src.w / 2), p.y - (src.y + src.h / 2)) > 12) {
      model.arrows.push({ id: uuid(), from: { elementId: fromId }, to: { x: Math.round(p.x), y: Math.round(p.y) }, label: '' })
      commit()
    }
  }
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
  selectOnly(el.id)
  commit()
  nextTick(() => startEdit(el))
}
function snap(v) {
  return Math.round(v)
}

function addComment(x, y) {
  const c = { id: uuid(), x: Math.round(x), y: Math.round(y), messages: [] }
  model.comments.push(c)
  commit()
  setOpenComment(c.id)
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
  selectOnly(el.id)
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
  removeElementIds(new Set([id]))
}
function removeSelected() {
  if (!selectedIds.value.size) return
  removeElementIds(new Set(selectedIds.value))
}
function removeElementIds(ids) {
  model.elements = model.elements.filter((el) => !ids.has(el.id))
  model.arrows = model.arrows.filter(
    (a) => !(a.from?.elementId && ids.has(a.from.elementId)) && !(a.to?.elementId && ids.has(a.to.elementId)),
  )
  ids.forEach((id) => textNodes.delete(id))
  clearSelection()
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
  clearSelection()
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

// ── Connection handles (drag from any element side/corner) ──
function showHandles(el) {
  if (editingId.value === el.id) return false
  if (connecting.value) return connecting.value.fromId === el.id
  return hoverId.value === el.id || selectedId.value === el.id
}
// Topmost element whose box contains a world point (optionally excluding one id).
function elementAt(wx, wy, excludeId = null) {
  for (let i = model.elements.length - 1; i >= 0; i--) {
    const el = model.elements[i]
    if (el.id === excludeId) continue
    if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) return el
  }
  return null
}
function startConnect(e, el) {
  connecting.value = { fromId: el.id }
  const p = screenToWorld(e.clientX, e.clientY)
  connectEnd.x = p.x
  connectEnd.y = p.y
  connectTargetId.value = null
  capture(e)
}
const tempArrow = computed(() => {
  void cam.x; void cam.y; void cam.zoom
  if (!connecting.value) return null
  const src = byId.value.get(connecting.value.fromId)
  if (!src) return null
  const fp = edgePoint(src, connectEnd.x, connectEnd.y)
  const s1 = worldToScreen(fp.x, fp.y)
  const s2 = worldToScreen(connectEnd.x, connectEnd.y)
  return { x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y }
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
function messageCount(c) {
  return c?.messages?.length || 0
}
function msgTime(m) {
  return m?.created_at ? dayjs(m.created_at).fromNow() : ''
}
// Legacy comments stored a single `text`; fold it into the threaded shape.
function normalizeComment(c) {
  if (Array.isArray(c.messages)) return c
  const messages = []
  if (c.text && c.text.trim()) {
    messages.push({ id: uuid(), text: c.text, created_at: c.created_at || null })
  }
  return { id: c.id, x: c.x, y: c.y, messages }
}
function sendReply() {
  const c = openComment.value
  const text = replyDraft.value.trim()
  if (!c || !text) return
  c.messages.push({ id: uuid(), text, created_at: new Date().toISOString() })
  replyDraft.value = ''
  commit()
  nextTick(() => commentInput.value?.focus())
}
function deleteMessage(commentId, msgId) {
  const c = model.comments.find((x) => x.id === commentId)
  if (!c) return
  c.messages = c.messages.filter((m) => m.id !== msgId)
  commit()
}
function removeComment(id) {
  model.comments = model.comments.filter((c) => c.id !== id)
  if (openCommentId.value === id) { openCommentId.value = null; replyDraft.value = '' }
  commit()
}
// Open a thread; discard any previously-open thread that was never written to.
function setOpenComment(id) {
  const prev = model.comments.find((c) => c.id === openCommentId.value)
  if (prev && !prev.messages.length && prev.id !== id) {
    model.comments = model.comments.filter((c) => c.id !== prev.id)
    commit()
  }
  openCommentId.value = id
  replyDraft.value = ''
}
function closeComment() {
  setOpenComment(null)
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

  // Ctrl/Cmd combos: undo / redo / copy / paste
  const mod = e.ctrlKey || e.metaKey
  if (mod) {
    if (isTyping(e.target)) return // let the browser handle text edits natively
    const k = e.key.toLowerCase()
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
    if (k === 'y') { e.preventDefault(); redo(); return }
    if (k === 'c') { if (selectedIds.value.size) { e.preventDefault(); copySelected() } return }
    if (k === 'v') { e.preventDefault(); pasteClipboard(); return }
    return
  }

  if (e.key === 'Escape') {
    if (connecting.value) { connecting.value = null; connectTargetId.value = null; return }
    arrowStart.value = null
    deselectAll()
    emit('tool-used')
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (isTyping(e.target)) return
    if (selectedIds.value.size) { e.preventDefault(); removeSelected() }
    else if (selectedArrowId.value) { e.preventDefault(); removeArrow(selectedArrowId.value) }
    return
  }

  // Single-key tool shortcuts (only when not typing)
  if (!isTyping(e.target)) {
    const k = e.key.toLowerCase()
    if (k === 'r') { e.preventDefault(); emit('set-tool', 'shape-rect') }
    else if (k === 'e') { e.preventDefault(); emit('set-tool', 'shape-ellipse') }
    else if (k === 'd') { e.preventDefault(); emit('set-tool', 'shape-diamond') }
    else if (k === 't') { e.preventDefault(); emit('set-tool', 'text') }
    else if (k === 'c') { e.preventDefault(); emit('set-tool', 'comment') }
    else if (k === 's') { e.preventDefault(); emit('set-tool', 'sticky') }
  }
}
function onKeyUp(e) {
  if (e.key === ' ' || e.code === 'Space') spaceDown.value = false
}

// ── Board sync ── (declared last so loadFromProps/fit and the refs they touch exist)
watch(
  () => props.boardId,
  () => {
    loadFromProps()
    nextTick(fit)
  },
  { immediate: true },
)

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
.el .el-content[contenteditable='true'] {
  cursor: text;
  /* The canvas root sets user-select:none for clean dragging; re-enable it here
     or the contenteditable becomes impossible to type into. */
  user-select: text;
  -webkit-user-select: text;
}
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

/* connection handles (drag to draw an arrow) */
.connect-handle {
  position: absolute;
  width: 11px;
  height: 11px;
  margin: -5.5px 0 0 -5.5px; /* centre on the side/corner point */
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--accent-500);
  cursor: crosshair;
  z-index: 4;
  opacity: 0.55;
  transition: opacity 120ms, transform 120ms;
}
.connect-handle:hover { opacity: 1; transform: scale(1.25); }

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
.arrow-line.temp { stroke: var(--accent-500); stroke-width: 2; stroke-dasharray: 5 4; }
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
.comment-pin-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.2rem;
  border-radius: 999px;
  background: #1a1a1a;
  color: #fff;
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1rem;
  text-align: center;
  box-shadow: 0 0 0 2px #fff;
}

.comment-pop {
  position: absolute;
  width: 16rem;
  background: #fff;
  border: 1px solid #e5e4e1;
  border-radius: 0.6rem;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.16);
  padding: 0.6rem;
  z-index: 7;
  user-select: text;
  -webkit-user-select: text;
}
.comment-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent-600);
  margin-bottom: 0.5rem;
}
.comment-pop-head span { display: inline-flex; align-items: center; gap: 0.35rem; }
.comment-pop-head i { font-size: 0.7rem; }
.comment-head-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 0.35rem;
  color: var(--text-faint, #9a9a9a);
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.75rem;
}
.comment-head-del:hover { background: #fff0f0; color: #c33; }

.comment-thread {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 14rem;
  overflow-y: auto;
  margin-bottom: 0.5rem;
}
.comment-empty {
  font-size: 0.78rem;
  color: #9a9a9a;
  font-style: italic;
  padding: 0.2rem 0;
}
.comment-msg {
  background: #f6f5f2;
  border: 1px solid #ecebe7;
  border-radius: 0.5rem;
  padding: 0.4rem 0.5rem;
}
.comment-msg-body {
  font-size: 0.85rem;
  line-height: 1.4;
  color: #1f1f1f;
  white-space: pre-wrap;
  word-break: break-word;
}
.comment-msg-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.2rem;
}
.comment-msg-time { font-size: 0.66rem; color: #9a9a9a; }
.comment-msg-del {
  width: 1.1rem;
  height: 1.1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: #b8b5ae;
  cursor: pointer;
  font-size: 0.62rem;
  border-radius: 0.25rem;
  opacity: 0;
  transition: opacity 120ms;
}
.comment-msg:hover .comment-msg-del { opacity: 1; }
.comment-msg-del:hover { color: #c33; background: #fff0f0; }

.comment-reply {
  display: flex;
  align-items: flex-end;
  gap: 0.35rem;
}
.comment-ta {
  flex: 1;
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
.comment-send {
  flex: none;
  width: 2.1rem;
  height: 2.1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.45rem;
  background: var(--accent-500);
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
}
.comment-send:hover:not(:disabled) { background: var(--accent-600); }
.comment-send:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Marquee (rubber-band) selection ── */
.marquee {
  position: absolute;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid var(--accent-500);
  border-radius: 2px;
  pointer-events: none;
  z-index: 5;
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
