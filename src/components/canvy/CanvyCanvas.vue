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
        <!-- rotated visual layer (keeps handles/toolbar/outline upright) -->
        <div class="el-rot" :style="rotStyle(el)">
          <!-- shape backdrop (rect / ellipse / diamond) -->
          <div
            v-if="el.type === 'shape'"
            class="shape-fill"
            :class="'shape-' + el.shape"
            :style="fillStyle(el)"
          ></div>

          <!-- freehand stroke (inline so it shares element z-order) -->
          <svg v-if="el.type === 'draw'" class="draw-svg" :width="el.w" :height="el.h">
            <path
              :d="pointsToPath(el.points)"
              :stroke="resolveColor(el).stroke"
              :stroke-width="el.strokeWidth || 3"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>

          <div
            v-if="el.type !== 'draw'"
            class="el-content"
            :contenteditable="editingId === el.id"
            spellcheck="false"
            :data-placeholder="placeholderFor(el)"
            :ref="(node) => initText(node, el)"
            @input="onTextInput($event, el)"
            @blur="onTextBlur"
            @pointerdown="onTextPointerDown($event, el)"
          ></div>
        </div>

        <div
          v-if="selectedId === el.id && editingId !== el.id && el.type !== 'draw'"
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
          <!-- shade strip: 5 shades of the picked hue, expanded above -->
          <div v-if="shadeHue" class="shade-strip">
            <button
              v-for="(s, i) in COLORS[shadeHue]"
              :key="i"
              class="swatch"
              :class="{ on: shadeHue === (el.color || 'yellow') && (el.shade ?? DEFAULT_SHADE) === i }"
              :style="{ background: s.fill, borderColor: s.stroke }"
              :title="shadeHue + ' ' + (i + 1)"
              @click="setShade(el, shadeHue, i)"
            ></button>
          </div>
          <button
            v-for="key in SWATCHES"
            :key="key"
            class="swatch hue"
            :class="{ on: (el.color || 'yellow') === key }"
            :style="{ background: COLORS[key][DEFAULT_SHADE].fill, borderColor: COLORS[key][DEFAULT_SHADE].stroke }"
            :title="key + ' — click again for shades'"
            @click="onHueClick(el, key)"
          ></button>
          <span class="el-toolbar-sep"></span>
          <input
            class="opacity-range"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            :value="el.opacity ?? 1"
            title="Opacity"
            @input="setOpacity(el, $event.target.value)"
            @change="commitOpacity"
          />
          <!-- stroke width (draw strokes only) -->
          <template v-if="el.type === 'draw'">
            <span class="el-toolbar-sep"></span>
            <input
              class="stroke-range"
              type="range"
              :min="DRAW_MIN_STROKE"
              :max="DRAW_MAX_STROKE"
              step="1"
              :value="el.strokeWidth ?? 3"
              :title="'Stroke width: ' + (el.strokeWidth ?? 3) + 'px'"
              @input="setStrokeWidth(el, $event.target.value)"
              @change="commitStroke"
            />
          </template>
          <span class="el-toolbar-sep"></span>
          <button class="el-toolbar-btn danger" title="Delete" @click="removeElement(el.id)">
            <i class="pi pi-trash"></i>
          </button>
        </div>
      </div>

      <!-- In-progress stroke preview (committed strokes render per-element above) -->
      <svg v-if="drawing" class="world-draw" width="1" height="1">
        <path
          :d="drawingPath"
          :style="drawingStrokeStyle"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
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
        <path
          class="arrow-hit"
          :d="a.d"
          @pointerdown.stop="onArrowPointerDown(a.id)"
          @dblclick.stop="editArrowLabel(a.id)"
        />
        <path
          class="arrow-line"
          :class="{ on: selectedArrowId === a.id }"
          :d="a.d"
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

    <!-- Selected-arrow toolbar: bend / straighten / delete -->
    <div
      v-if="selectedArrowGeom"
      class="arrow-toolbar"
      :style="{ left: selectedArrowGeom.mx + 'px', top: selectedArrowGeom.my + 'px' }"
      @pointerdown.stop
    >
      <button class="arrow-tb-btn" title="Bow left" @click="bendArrow(selectedArrowId, -1)">
        <i class="pi pi-arrow-up-left"></i>
      </button>
      <button class="arrow-tb-btn" title="Straighten" @click="straightenArrow(selectedArrowId)">
        <i class="pi pi-minus"></i>
      </button>
      <button class="arrow-tb-btn" title="Bow right" @click="bendArrow(selectedArrowId, 1)">
        <i class="pi pi-arrow-up-right"></i>
      </button>
      <span class="el-toolbar-sep"></span>
      <button class="arrow-tb-btn danger" title="Delete arrow" @click="removeArrow(selectedArrowId)">
        <i class="pi pi-trash"></i>
      </button>
    </div>

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
const emit = defineEmits(['update', 'tool-used', 'set-tool', 'selection-change'])

// ── Sticky / shape / draw colour palette ──
// Each hue is a 5-step ramp (light → saturated). Index 1 reproduces the original
// flat colour, so boards saved before shades existed (no `shade`) look unchanged.
const DEFAULT_SHADE = 1
const COLORS = {
  yellow: [
    { fill: '#fffdf0', stroke: '#f1e4a8' },
    { fill: '#fff6c2', stroke: '#ecd56b' },
    { fill: '#ffec99', stroke: '#e3c33d' },
    { fill: '#ffe066', stroke: '#d4af1f' },
    { fill: '#f6cf3a', stroke: '#b8930f' },
  ],
  pink: [
    { fill: '#fff0f4', stroke: '#f7c6d3' },
    { fill: '#ffd9e2', stroke: '#f3a3b6' },
    { fill: '#ffbccd', stroke: '#ec7e9a' },
    { fill: '#ff97b1', stroke: '#e15c7e' },
    { fill: '#f56d92', stroke: '#c43c64' },
  ],
  blue: [
    { fill: '#eef6ff', stroke: '#bcd8f7' },
    { fill: '#d6e8ff', stroke: '#94bff2' },
    { fill: '#b3d4ff', stroke: '#6aa3ec' },
    { fill: '#88bbff', stroke: '#4684e0' },
    { fill: '#5b9bf5', stroke: '#2b66c4' },
  ],
  green: [
    { fill: '#eefaf1', stroke: '#b8e6c6' },
    { fill: '#d4f3dd', stroke: '#8fd3a3' },
    { fill: '#aee9c0', stroke: '#66c184' },
    { fill: '#7fdb9d', stroke: '#43a868' },
    { fill: '#4cc47b', stroke: '#2b864f' },
  ],
  purple: [
    { fill: '#f4eeff', stroke: '#d6c4f6' },
    { fill: '#e7dcff', stroke: '#bda3f0' },
    { fill: '#d3bfff', stroke: '#a07ee8' },
    { fill: '#b899ff', stroke: '#8257dd' },
    { fill: '#9a72f0', stroke: '#6638c0' },
  ],
  gray: [
    { fill: '#f6f5f3', stroke: '#ddd9d2' },
    { fill: '#ecebe7', stroke: '#cfccc5' },
    { fill: '#d9d6cf', stroke: '#b3afa5' },
    { fill: '#bcb8ae', stroke: '#918c80' },
    { fill: '#97928a', stroke: '#6b665d' },
  ],
}
const SWATCHES = Object.keys(COLORS)

// Resolve an element's hue + shade index to its concrete { fill, stroke }.
// Tolerates legacy/missing values (unknown hue → yellow, out-of-range shade
// clamped, absent shade → DEFAULT_SHADE).
function resolveColor(el) {
  const ramp = COLORS[el?.color] || COLORS.yellow
  const idx = clamp(Number.isFinite(el?.shade) ? el.shade : DEFAULT_SHADE, 0, ramp.length - 1)
  return ramp[idx]
}

// Connection grab points (% of the element box): 4 sides only.
const CONNECT_POINTS = [
  { k: 't', x: 50, y: 0 }, { k: 'b', x: 50, y: 100 },
  { k: 'l', x: 0, y: 50 }, { k: 'r', x: 100, y: 50 },
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
  drawing.value = null
  shadeHue.value = null
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
  if (props.tool === 'comment') return 'Click an element, an arrow, or empty space to drop a comment'
  if (props.tool === 'draw') return 'Drag to draw a freehand stroke'
  if (props.tool) return 'Click on the canvas to place'
  return ''
})

// ── Element styles ──
// The `.el` box carries only position/size/opacity; rotation lives on the inner
// `.el-rot` wrapper so the selection outline, handles and mini-toolbar stay
// upright (and arrows keep anchoring to the axis-aligned box).
function elStyle(el) {
  const style = {
    left: el.x + 'px',
    top: el.y + 'px',
    width: el.w + 'px',
    height: el.h + 'px',
  }
  if (el.opacity != null && el.opacity < 1) style.opacity = el.opacity
  // Sticky notes paint their own fill on the box; shapes/text/draw don't.
  if (el.type === 'sticky') {
    const c = resolveColor(el)
    style.background = c.fill
    style.borderColor = c.stroke
  }
  return style
}
function rotStyle(el) {
  return el.rotation ? { transform: `rotate(${el.rotation}deg)` } : {}
}
function fillStyle(el) {
  const c = resolveColor(el)
  return { background: c.fill, borderColor: c.stroke }
}
function placeholderFor(el) {
  if (el.type === 'sticky') return 'Sticky note'
  if (el.type === 'text') return 'Text'
  return 'Label'
}

// ── Background pointer (create / pan / deselect) ──
function onBgPointerDown(e) {
  // Freehand brush: begin collecting a stroke.
  if (props.tool === 'draw') { startDraw(e); return }
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
  // Brush tool: draw over elements too (start the stroke instead of selecting).
  if (props.tool === 'draw') { startDraw(e); return }
  if (props.tool === 'arrow') {
    handleArrowClick(el)
    return
  }
  if (props.tool === 'comment') {
    addCommentOn({ elementId: el.id })
    emit('tool-used')
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
  if (drawing.value) { appendDrawPoint(e); return }
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
    // Dragging detaches an anchored comment into a free-floating one.
    if (c.on) delete c.on
    pinDrag.moved = true
    return
  }
}

function onPointerUp(e) {
  if (drawing.value) {
    finishDraw()
    try { wrap.value.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    return
  }
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
const DRAW_STROKE = 3
const DRAW_MIN_STROKE = 1
const DRAW_MAX_STROKE = 24
const DRAW_COLOR = 'gray'
const DRAW_SHADE = 4 // strokes read best with the darkest shade
// Current brush thickness for new strokes; editing a stroke's width updates it so
// the next stroke matches.
const brushWidth = ref(DRAW_STROKE)
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

// ── Freehand drawing (brush / pen) ──
// While drawing we collect raw world points; on release we compute the bbox and
// store points *relative* to it, so the stroke moves/selects like any element.
const drawing = ref(null) // { points: [[wx,wy],…] } in world coords while active
function startDraw(e) {
  const p = screenToWorld(e.clientX, e.clientY)
  drawing.value = { points: [[p.x, p.y]] }
  capture(e)
}
function appendDrawPoint(e) {
  const p = screenToWorld(e.clientX, e.clientY)
  const pts = drawing.value.points
  const last = pts[pts.length - 1]
  // throttle to meaningful movement so paths stay light
  if (Math.hypot(p.x - last[0], p.y - last[1]) >= 2) pts.push([p.x, p.y])
}
function finishDraw() {
  const pts = drawing.value?.points || []
  drawing.value = null
  if (pts.length < 2) return // a tap, not a stroke
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of pts) {
    minX = Math.min(minX, px); minY = Math.min(minY, py)
    maxX = Math.max(maxX, px); maxY = Math.max(maxY, py)
  }
  const pad = brushWidth.value
  minX -= pad; minY -= pad; maxX += pad; maxY += pad
  const el = {
    id: uuid(),
    type: 'draw',
    x: Math.round(minX),
    y: Math.round(minY),
    w: Math.max(1, Math.round(maxX - minX)),
    h: Math.max(1, Math.round(maxY - minY)),
    points: pts.map(([px, py]) => [Math.round(px - minX), Math.round(py - minY)]),
    color: DRAW_COLOR,
    shade: DRAW_SHADE,
    strokeWidth: brushWidth.value,
  }
  model.elements.push(el)
  // Keep the brush active for the next stroke, and don't auto-select the stroke
  // we just drew — so you can keep drawing freely.
  commit()
}

// Build a smoothed SVG path from a points array, offset by (ox, oy).
function pointsToPath(points, ox = 0, oy = 0) {
  if (!points || !points.length) return ''
  const p = points
  if (p.length === 1) return `M ${p[0][0] + ox} ${p[0][1] + oy}`
  let d = `M ${p[0][0] + ox} ${p[0][1] + oy}`
  // Quadratic smoothing: control = each point, endpoint = midpoint to the next.
  for (let i = 1; i < p.length - 1; i++) {
    const cx = p[i][0] + ox, cy = p[i][1] + oy
    const mx = (p[i][0] + p[i + 1][0]) / 2 + ox
    const my = (p[i][1] + p[i + 1][1]) / 2 + oy
    d += ` Q ${cx} ${cy} ${mx} ${my}`
  }
  const lastP = p[p.length - 1]
  d += ` L ${lastP[0] + ox} ${lastP[1] + oy}`
  return d
}
// The in-progress preview lives inside `.world` (which carries the pan/zoom
// transform), so it uses raw world coordinates; committed strokes use
// element-local coords inside their own box.
const drawingPath = computed(() => (drawing.value ? pointsToPath(drawing.value.points) : ''))
const drawingStrokeStyle = computed(() => ({
  stroke: COLORS[DRAW_COLOR][DRAW_SHADE].stroke,
  strokeWidth: brushWidth.value + 'px',
}))

function addComment(x, y) {
  const c = { id: uuid(), x: Math.round(x), y: Math.round(y), messages: [] }
  model.comments.push(c)
  commit()
  setOpenComment(c.id)
  nextTick(() => commentInput.value?.focus())
}
// Drop a comment anchored to an element / arrow / between two elements.
function addCommentOn(on) {
  const c = { id: uuid(), on, messages: [] }
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
  if (el.type === 'draw') { selectOnly(el.id); return } // strokes have no text
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

// ── Colours / shades / opacity / delete ──
// Which hue's shade strip is expanded in the mini-toolbar (null = collapsed).
const shadeHue = ref(null)
// First click on a hue selects it; clicking the already-selected hue toggles its
// shade strip open/closed.
function onHueClick(el, key) {
  if ((el.color || 'yellow') === key) {
    shadeHue.value = shadeHue.value === key ? null : key
    return
  }
  el.color = key
  shadeHue.value = key
  commit()
}
function setShade(el, hue, idx) {
  el.color = hue
  el.shade = idx
  commit()
}
// Opacity slider: drag updates live (no history spam); the @change commits once.
function setOpacity(el, v) {
  el.opacity = clamp(Number(v), 0.1, 1)
}
function commitOpacity() {
  commit()
}
// Stroke-width slider for a draw element. Mirrors the opacity pattern; also stores
// the value as the current brush width so the next stroke matches.
function setStrokeWidth(el, v) {
  const w = clamp(Math.round(Number(v)), DRAW_MIN_STROKE, DRAW_MAX_STROKE)
  el.strokeWidth = w
  brushWidth.value = w
}
function commitStroke() {
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

// ── Transform / layering (driven from the stage toolbar) ──
// Rotate every selected element by `deg`, normalised to [0, 360).
function rotateSelection(deg) {
  if (!selectedIds.value.size) return
  for (const el of model.elements) {
    if (selectedIds.value.has(el.id)) {
      el.rotation = (((Number(el.rotation) || 0) + deg) % 360 + 360) % 360
    }
  }
  commit()
}
// Z-order: model.elements order is back→front. Pull selected items out and
// reinsert them at the front / back, or nudge them one step.
function reorderSelection(mode) {
  const ids = selectedIds.value
  if (!ids.size) return
  const sel = model.elements.filter((el) => ids.has(el.id))
  const rest = model.elements.filter((el) => !ids.has(el.id))
  if (mode === 'front') {
    model.elements = [...rest, ...sel]
  } else if (mode === 'back') {
    model.elements = [...sel, ...rest]
  } else if (mode === 'forward' || mode === 'backward') {
    const arr = model.elements.slice()
    const step = mode === 'forward' ? 1 : -1
    const order = mode === 'forward' ? [...arr.keys()].reverse() : [...arr.keys()]
    for (const i of order) {
      if (!ids.has(arr[i].id)) continue
      const j = i + step
      if (j < 0 || j >= arr.length || ids.has(arr[j].id)) continue
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    model.elements = arr
  }
  commit()
}
function bringToFront() { reorderSelection('front') }
function sendToBack() { reorderSelection('back') }
function bringForward() { reorderSelection('forward') }
function sendBackward() { reorderSelection('backward') }

// Tell the parent how many elements are selected and (for a single selection)
// its rotation, so the stage toolbar can enable controls and show the angle.
watch(
  selectedIds,
  (ids) => {
    shadeHue.value = null
    const id = ids.size === 1 ? [...ids][0] : null
    const el = id ? byId.value.get(id) : null
    emit('selection-change', { count: ids.size, ids: [...ids], rotation: el ? Number(el.rotation) || 0 : 0 })
  },
)

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
function onArrowPointerDown(id) {
  // Comment tool active → drop a comment at the arrow's midpoint instead.
  if (props.tool === 'comment') {
    addCommentOn({ arrowId: id })
    emit('tool-used')
    return
  }
  selectArrow(id)
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
// Bow the arrow: step the signed curve fraction, clamped. 0 = straight.
const CURVE_STEP = 0.18
const CURVE_MAX = 0.9
function bendArrow(id, dir) {
  const a = model.arrows.find((x) => x.id === id)
  if (!a) return
  const next = Math.max(-CURVE_MAX, Math.min(CURVE_MAX, (Number(a.curve) || 0) + dir * CURVE_STEP))
  a.curve = Math.abs(next) < 0.001 ? 0 : Number(next.toFixed(3))
  commit()
}
function straightenArrow(id) {
  const a = model.arrows.find((x) => x.id === id)
  if (!a || !a.curve) return
  a.curve = 0
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

// Perpendicular bow offset (world units) for an arrow's `curve` value: a signed
// fraction of the chord length. 0 / absent → straight line.
function curveControl(fc, tc, curve) {
  const dx = tc.x - fc.x
  const dy = tc.y - fc.y
  const len = Math.hypot(dx, dy) || 1
  const off = curve * len
  // unit normal (perpendicular to the chord)
  const nx = -dy / len
  const ny = dx / len
  return { x: (fc.x + tc.x) / 2 + nx * off, y: (fc.y + tc.y) / 2 + ny * off }
}

// World-space geometry for one arrow: the two edge points, the curve control
// point (null when straight) and the visual midpoint. Shared by the renderer
// and by comment anchoring.
function arrowWorldGeom(a) {
  const from = endpointCenter(a.from)
  const to = endpointCenter(a.to)
  const curve = Number(a.curve) || 0
  // Control point; edges exit aiming toward it so the curve leaves each box
  // naturally. For curve 0 it sits on the chord → straight.
  const ctrl = curveControl(from, to, curve)
  const fp = from.el ? edgePoint(from.el, ctrl.x, ctrl.y) : { x: from.x, y: from.y }
  const tp = to.el ? edgePoint(to.el, ctrl.x, ctrl.y) : { x: to.x, y: to.y }
  let cw = null, mid
  if (curve) {
    // recompute control off the actual edge points so the bow is symmetric
    cw = curveControl(fp, tp, curve * 2)
    mid = { x: 0.25 * fp.x + 0.5 * cw.x + 0.25 * tp.x, y: 0.25 * fp.y + 0.5 * cw.y + 0.25 * tp.y }
  } else {
    mid = { x: (fp.x + tp.x) / 2, y: (fp.y + tp.y) / 2 }
  }
  return { fp, tp, cw, mid }
}

const arrowGeoms = computed(() => {
  // depend on camera so screen coords recompute on pan/zoom
  void cam.x; void cam.y; void cam.zoom
  const out = []
  for (const a of model.arrows) {
    const { fp, tp, cw } = arrowWorldGeom(a)
    const s1 = worldToScreen(fp.x, fp.y)
    const s2 = worldToScreen(tp.x, tp.y)
    let d, mx, my
    if (cw) {
      const sc = worldToScreen(cw.x, cw.y)
      d = `M ${s1.x} ${s1.y} Q ${sc.x} ${sc.y} ${s2.x} ${s2.y}`
      // midpoint of a quadratic bezier at t=0.5
      mx = 0.25 * s1.x + 0.5 * sc.x + 0.25 * s2.x
      my = 0.25 * s1.y + 0.5 * sc.y + 0.25 * s2.y - 6
    } else {
      d = `M ${s1.x} ${s1.y} L ${s2.x} ${s2.y}`
      mx = (s1.x + s2.x) / 2
      my = (s1.y + s2.y) / 2 - 6
    }
    out.push({ id: a.id, d, mx, my, label: a.label })
  }
  return out
})

const selectedArrowGeom = computed(() =>
  selectedArrowId.value ? arrowGeoms.value.find((a) => a.id === selectedArrowId.value) : null,
)

// ── Connection handles (drag from any element side/corner) ──
function showHandles(el) {
  if (editingId.value === el.id) return false
  // While the comment tool is active, clicking an element should drop a comment
  // on it — don't surface the connect handles that would start an arrow instead.
  if (props.tool === 'comment') return false
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
// Resolve a comment's world position from its anchor (`on`), falling back to its
// stored free point. Anchors keep the pin attached as elements/arrows move:
//   { elementId }            → the element's top-right corner
//   { betweenIds:[a, b] }    → halfway between two element centres
//   { arrowId }              → the arrow's midpoint
function commentPos(c) {
  const on = c?.on
  if (on) {
    if (on.elementId != null) {
      const el = byId.value.get(on.elementId)
      if (el) return { x: el.x + el.w, y: el.y }
    } else if (Array.isArray(on.betweenIds) && on.betweenIds.length === 2) {
      const a = byId.value.get(on.betweenIds[0])
      const b = byId.value.get(on.betweenIds[1])
      if (a && b) return {
        x: (a.x + a.w / 2 + b.x + b.w / 2) / 2,
        y: (a.y + a.h / 2 + b.y + b.h / 2) / 2,
      }
    } else if (on.arrowId != null) {
      const ar = model.arrows.find((x) => x.id === on.arrowId)
      if (ar) return arrowWorldGeom(ar).mid
    }
  }
  return { x: c?.x ?? 0, y: c?.y ?? 0 }
}
function pinStyle(c) {
  const w = commentPos(c)
  const s = worldToScreen(w.x, w.y)
  return { left: s.x + 'px', top: s.y + 'px' }
}
function popStyle(c) {
  const w = commentPos(c)
  const s = worldToScreen(w.x, w.y)
  return { left: s.x + 14 + 'px', top: s.y + 'px' }
}
const commentInput = ref(null)
function onPinPointerDown(e, c) {
  const p = screenToWorld(e.clientX, e.clientY)
  const w = commentPos(c)
  pinDrag = { id: c.id, ox: p.x - w.x, oy: p.y - w.y, moved: false }
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
  const out = { id: c.id, x: c.x, y: c.y, messages }
  if (c.on) out.on = c.on
  return out
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
    else if (k === 'p') { e.preventDefault(); emit('set-tool', props.tool === 'draw' ? null : 'draw') }
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

defineExpose({
  fit,
  resetView,
  rotateSelection,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
})
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
.el-draw { background: transparent; }

/* rotated visual layer: fills the element's content box; rotation pivots on its
   centre while the box, outline, handles and toolbar stay upright. */
.el-rot {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: stretch;
  transform-origin: center;
}

/* freehand stroke svg */
.draw-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

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
.el-text .el-content { font-size: 1.05rem; font-weight: 500; padding: 0.3rem 0.4rem; }
.el-shape .el-content {
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
/* expanding shade strip, floated just above the toolbar row */
.shade-strip {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  display: flex;
  gap: 0.25rem;
  padding: 0.3rem 0.4rem;
  background: #fff;
  border: 1px solid #e5e4e1;
  border-radius: 0.5rem;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
}
.opacity-range,
.stroke-range {
  width: 4.5rem;
  height: 1rem;
  cursor: pointer;
  accent-color: var(--accent-500);
}
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

/* ── Selected-arrow toolbar ── */
.arrow-toolbar {
  position: absolute;
  transform: translate(-50%, calc(-100% - 8px));
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.35rem;
  background: #fff;
  border: 1px solid #e5e4e1;
  border-radius: 0.5rem;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
  z-index: 5;
  white-space: nowrap;
}
.arrow-tb-btn {
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
.arrow-tb-btn:hover { background: #f3f2f0; color: #1a1a1a; }
.arrow-tb-btn.danger:hover { background: #fff0f0; color: #c33; }

/* in-progress freehand preview (lives inside the transformed .world) */
.world-draw {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
}

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
