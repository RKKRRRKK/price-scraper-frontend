// Board validation / normalisation for Canvy.
//
// Both AI flows now speak the terse op-DSL (see canvyOps + canvyPrompts); this module
// is the shared bottom layer they funnel through: `normalizeBoard` clamps and cleans
// a raw board spec into a valid `data` object, and `scopedData` selects a section.
// A Canvy board's `data` IS the build spec, so there's no translation layer — just
// this validation.

import { v4 as uuid } from 'uuid'

const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray']
const SHAPES = ['rect', 'ellipse', 'diamond', 'cylinder', 'parallelogram']
const TYPES = ['sticky', 'text', 'shape', 'draw', 'frame']
const ARROW_MODES = ['straight', 'curved', 'elbow']

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const str = (v) => (v == null ? '' : String(v))
const clampN = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

// Pick the elements/arrows/comments to expose to the assistant. When `scopeIds`
// is given, restrict to that selection: the selected elements, arrows whose both
// endpoints are selected, and comments anchored within the selection.
export function scopedData(d, scopeIds) {
  const elements = Array.isArray(d.elements) ? d.elements : []
  const arrows = Array.isArray(d.arrows) ? d.arrows : []
  const comments = Array.isArray(d.comments) ? d.comments : []
  if (!scopeIds || !scopeIds.size) return { elements, arrows, comments }

  const inScope = (id) => id != null && scopeIds.has(String(id))
  const els = elements.filter((el) => scopeIds.has(String(el.id)))
  const ars = arrows.filter((a) => inScope(a.from?.elementId) && inScope(a.to?.elementId))
  const arIds = new Set(ars.map((a) => String(a.id)))
  const coms = comments.filter((c) => {
    const on = c.on
    if (!on) return false // free-floating comments are board-wide, not section-scoped
    if (on.elementId != null) return inScope(on.elementId)
    if (Array.isArray(on.betweenIds)) return on.betweenIds.every(inScope)
    if (on.arrowId != null) return arIds.has(String(on.arrowId))
    return false
  })
  return { elements: els, arrows: ars, comments: coms }
}

function normalizeEndpoint(end, ids) {
  if (!end || typeof end !== 'object') return null
  if (end.elementId != null && ids.has(String(end.elementId))) {
    const e = { elementId: String(end.elementId) }
    // Optional fractional boundary anchor (0..1 across the element box). Absent =>
    // the arrow exits directionally from the centre (legacy behaviour).
    if (end.ax != null && end.ay != null) {
      e.ax = clampN(num(end.ax), 0, 1)
      e.ay = clampN(num(end.ay), 0, 1)
    }
    return e
  }
  if (end.x != null && end.y != null) return { x: num(end.x), y: num(end.y) }
  return null
}

// A comment anchor (`on`): { elementId } | { betweenIds:[a,b] } | { arrowId }.
// Returns null if the anchor is missing or references ids that don't exist.
function normalizeAnchor(on, ids, arrowIds) {
  if (!on || typeof on !== 'object') return null
  if (on.elementId != null && ids.has(String(on.elementId))) return { elementId: String(on.elementId) }
  if (Array.isArray(on.betweenIds)) {
    const b = on.betweenIds.map(String).filter((x) => ids.has(x))
    if (b.length === 2) return { betweenIds: [b[0], b[1]] }
  }
  if (on.arrowId != null && arrowIds.has(String(on.arrowId))) return { arrowId: String(on.arrowId) }
  return null
}

function normalizeMessages(raw) {
  if (Array.isArray(raw.messages)) {
    return raw.messages
      .filter((m) => m && m.text != null)
      .map((m) => ({ id: m.id != null ? String(m.id) : uuid(), text: str(m.text), created_at: m.created_at || null }))
  }
  if (raw.text != null && String(raw.text).trim()) {
    return [{ id: uuid(), text: str(raw.text), created_at: null }]
  }
  return []
}

// Validate + clean a raw board spec into a board `data` object. Shared by the
// full build and the scoped merge.
export function normalizeBoard(spec) {
  const warnings = []

  // ── elements ──
  const elements = []
  const ids = new Set()
  for (const raw of Array.isArray(spec.elements) ? spec.elements : []) {
    if (!raw || typeof raw !== 'object') continue
    const type = TYPES.includes(raw.type) ? raw.type : null
    if (!type) { warnings.push(`Skipped element with unknown type "${raw.type}"`); continue }
    let id = raw.id != null ? String(raw.id) : uuid()
    if (ids.has(id)) id = uuid()
    ids.add(id)

    if (type === 'draw') {
      const pts = Array.isArray(raw.points)
        ? raw.points
            .map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : null))
            .filter(Boolean)
        : []
      if (pts.length < 2) { warnings.push('Skipped a draw element with fewer than 2 points.'); ids.delete(id); continue }
      // Derive the bbox and store points relative to it (matches the editor).
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const [px, py] of pts) {
        minX = Math.min(minX, px); minY = Math.min(minY, py)
        maxX = Math.max(maxX, px); maxY = Math.max(maxY, py)
      }
      const el = {
        id,
        type: 'draw',
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.max(1, Math.round(maxX - minX)),
        h: Math.max(1, Math.round(maxY - minY)),
        points: pts.map(([px, py]) => [Math.round(px - minX), Math.round(py - minY)]),
        color: COLORS.includes(raw.color) ? raw.color : 'gray',
        shade: clampN(num(raw.shade, 4), 0, 4),
        strokeWidth: clampN(num(raw.strokeWidth, 3), 1, 24),
      }
      applyCommonStyle(el, raw)
      elements.push(el)
      continue
    }

    const el = {
      id,
      type,
      x: num(raw.x),
      y: num(raw.y),
      w: Math.max(60, num(raw.w, type === 'text' ? 220 : type === 'frame' ? 640 : 180)),
      h: Math.max(36, num(raw.h, type === 'text' ? 48 : type === 'sticky' ? 140 : type === 'frame' ? 420 : 110)),
      text: str(raw.text),
    }
    if (type === 'shape') el.shape = SHAPES.includes(raw.shape) ? raw.shape : 'rect'
    if (type !== 'text') {
      el.color = COLORS.includes(raw.color) ? raw.color : type === 'sticky' ? 'yellow' : type === 'frame' ? 'gray' : 'blue'
      el.shade = clampN(num(raw.shade, 1), 0, 4)
    }
    applyCommonStyle(el, raw)
    elements.push(el)
  }

  // ── arrows ──
  const arrows = []
  const arrowIds = new Set()
  for (const raw of Array.isArray(spec.arrows) ? spec.arrows : []) {
    if (!raw || typeof raw !== 'object') continue
    const from = normalizeEndpoint(raw.from, ids)
    const to = normalizeEndpoint(raw.to, ids)
    if (!from || !to) { warnings.push('Skipped an arrow with an endpoint that referenced a missing element.'); continue }
    let id = raw.id != null ? String(raw.id) : uuid()
    if (arrowIds.has(id)) id = uuid()
    arrowIds.add(id)
    const curve = clampN(num(raw.curve, 0), -0.9, 0.9)
    const mode = ARROW_MODES.includes(raw.mode) ? raw.mode : curve ? 'curved' : 'straight'
    const hs = raw.heads && typeof raw.heads === 'object' ? raw.heads : null
    const heads = { start: hs ? !!hs.start : false, end: hs ? hs.end !== false : true }
    const arrow = { id, from, to, label: str(raw.label), curve, mode, heads }
    if (raw.labelPos != null) arrow.labelPos = clampN(num(raw.labelPos, 0.5), 0, 1)
    if (raw.labelSize != null) arrow.labelSize = clampN(num(raw.labelSize, 13), 6, 200)
    arrows.push(arrow)
  }

  // ── comments ──
  const comments = []
  for (const raw of Array.isArray(spec.comments) ? spec.comments : []) {
    if (!raw || typeof raw !== 'object') continue
    const comment = { id: raw.id != null ? String(raw.id) : uuid(), x: num(raw.x), y: num(raw.y), messages: normalizeMessages(raw) }
    const on = normalizeAnchor(raw.on, ids, arrowIds)
    if (on) comment.on = on
    comments.push(comment)
  }

  return { data: { elements, arrows, comments }, warnings }
}

// Carry optional opacity/rotation through normalization for any element type,
// plus per-shape border styling (width / colour / opacity / dashed).
function applyCommonStyle(el, raw) {
  if (raw.opacity != null) el.opacity = clampN(num(raw.opacity, 1), 0.1, 1)
  if (raw.rotation != null) el.rotation = ((num(raw.rotation, 0) % 360) + 360) % 360
  if (raw.locked != null) el.locked = !!raw.locked
  // Per-element font size (world units) for text-bearing elements; absent => the
  // CSS default. Ignored for freehand draw.
  if (raw.fontSize != null && el.type !== 'draw') el.fontSize = clampN(num(raw.fontSize, 16), 6, 240)
  if (el.type === 'shape') {
    if (raw.borderWidth != null) el.borderWidth = clampN(num(raw.borderWidth, 2), 0, 40)
    if (raw.borderStyle === 'dashed' || raw.borderStyle === 'solid') el.borderStyle = raw.borderStyle
    if (COLORS.includes(raw.borderColor)) el.borderColor = raw.borderColor
    if (raw.borderShade != null) el.borderShade = clampN(num(raw.borderShade, 3), 0, 4)
    if (raw.borderOpacity != null) el.borderOpacity = clampN(num(raw.borderOpacity, 1), 0, 1)
  }
}

