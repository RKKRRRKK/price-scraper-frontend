// Convert a Miro clipboard payload back into Canvy elements/arrows so objects
// copied in miro.com can be pasted straight into a Canvy board. This is the
// inverse of src/lib/canvyToMiro.js — it decodes the same proprietary clipboard
// format (see local_utilities/MIRO_FORMAT.md) and rebuilds Canvy's own
// elements/arrows from the Miro object graph.
//
//   html    → extract base64 between (miro-data-v1)…(/miro-data-v1)
//   payload = JSON.parse( utf8( base64(html).map(b => (b - 59 + 256) % 256) ) )
//   objects → Canvy elements (by widgetData.type) + arrows (line widgets)
//
// Miro object `id` is the object's index in data.objects; connectors reference
// the widgets they join by that index via widgetIndex, so we map array index →
// freshly-generated Canvy element id and resolve arrow ends against it.

import { v4 as uuid } from 'uuid'
import { COLORS, SCALE, SHAPE_CODE, STICKY_BASE, DEFAULT_SHADE } from './canvyToMiro'

// Reverse of SHAPE_CODE: Miro shape code (number) → Canvy shape name.
const SHAPE_NAME = Object.fromEntries(Object.entries(SHAPE_CODE).map(([name, code]) => [code, name]))

// A curved Miro connector (lt:2) has no stored bow magnitude; use one Canvy
// bend step so it reads as a gentle curve.
const CURVE_DEFAULT = 0.18

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi)
}

// ── Decode (inverse of canvyToMiro.encodeMiroPayload) ─────────────────────────
// Reliable delimiters are the parentheses, not the surrounding <!-- --> (some
// captures mangle the comment); see MIRO_FORMAT.md §2.
const MARKER = /\(miro-data-v1\)([\s\S]*?)\(\/miro-data-v1\)/

export function decodeMiroHtml(html) {
  if (!html || typeof html !== 'string') return null
  const m = html.match(MARKER)
  if (!m) return null
  try {
    // The base64 may carry HTML-escaped chars if it came through an attribute.
    const b64 = m[1].replace(/&amp;/g, '&').replace(/\s+/g, '')
    const raw = atob(b64)
    const bytes = Uint8Array.from(raw, (c) => (c.charCodeAt(0) - 59 + 256) % 256)
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

// ── Colour: Miro RGB int → nearest Canvy { hue, shade } ───────────────────────
// Flatten the shared COLORS ramp into a lookup table once, keyed by tone kind.
function buildRamp(kind /* 'fill' | 'stroke' */) {
  const out = []
  for (const hue of Object.keys(COLORS)) {
    COLORS[hue].forEach((step, shade) => {
      const int = parseInt(step[kind].replace('#', ''), 16)
      out.push({ hue, shade, r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, int })
    })
  }
  return out
}
const FILL_RAMP = buildRamp('fill')
const STROKE_RAMP = buildRamp('stroke')

function nearest(ramp, int) {
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  let best = ramp[0]
  let bestD = Infinity
  for (const c of ramp) {
    const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

// ── Text: Miro rich-text HTML → Canvy plain text (inverse of textToMiroHtml) ──
function htmlToText(html) {
  if (!html) return ''
  return String(html)
    .replace(/<\/p\s*>/gi, '\n')      // paragraph breaks → newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')          // drop <p>, inline <span> runs, etc.
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n+$/, '')              // trim the trailing newline from the last </p>
}

function parseStyle(s) {
  if (!s) return {}
  try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return {} }
}

function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ── Object → Canvy element ────────────────────────────────────────────────────
// Each builder returns an element centred using offsetPx (relative to the Miro
// group origin); the caller re-centres the whole group into the viewport.
function centreBox(json, w, h) {
  const off = json?._position?.offsetPx || { x: 0, y: 0 }
  return {
    x: Math.round(off.x / SCALE - w / 2),
    y: Math.round(off.y / SCALE - h / 2),
  }
}
// Miro rotation is CCW-positive degrees; Canvy stores CSS (CW-positive), so negate.
function rotationOf(json) {
  const r = -num(json?.rotation?.rotation, 0)
  return r || 0
}

// Apply a fill colour (bc) to an element as hue + shade.
function applyFill(el, style) {
  if (style.bc != null && style.bc !== -1) {
    const c = nearest(FILL_RAMP, style.bc)
    el.color = c.hue
    el.shade = c.shade
  }
  if (style.bo != null && Number(style.bo) !== 1) el.opacity = Number(style.bo)
}
// Apply border (brc/brw/brs/bro). Only set borderColor when it differs from the
// tone Canvy would derive from the fill by default (so plain shapes stay plain).
function applyBorder(el, style) {
  if (style.brw != null) el.borderWidth = clamp(num(style.brw, 2), 0, 40)
  if (style.brs != null) el.borderStyle = Number(style.brs) === 1 ? 'dashed' : 'solid'
  if (style.bro != null && Number(style.bro) !== 1) el.borderOpacity = Number(style.bro)
  if (style.brc != null && style.brc !== -1) {
    const fillHue = el.color || 'blue'
    const fillShade = Number.isFinite(el.shade) ? el.shade : DEFAULT_SHADE
    const defaultBorderInt = parseInt(COLORS[fillHue][fillShade].stroke.replace('#', ''), 16)
    if (style.brc !== defaultBorderInt) {
      const c = nearest(STROKE_RAMP, style.brc)
      el.borderColor = c.hue
      el.borderShade = c.shade
    }
  }
}

function shapeElement(json) {
  const size = json.size || { width: 0, height: 0 }
  const w = Math.round(size.width / SCALE)
  const h = Math.round(size.height / SCALE)
  const style = parseStyle(json.style)
  const code = num(json.shape ?? style.st, SHAPE_CODE.rect)
  const el = {
    id: uuid(), type: 'shape', shape: SHAPE_NAME[code] || 'rect',
    ...centreBox(json, w, h), w, h,
    color: 'blue', shade: DEFAULT_SHADE, text: htmlToText(json.text),
    rotation: rotationOf(json),
  }
  applyFill(el, style)
  applyBorder(el, style)
  return el
}

function stencilElement(json) {
  const size = json.size || { width: 0, height: 0 }
  const w = Math.round(size.width / SCALE)
  const h = Math.round(size.height / SCALE)
  const style = parseStyle(json.style)
  const text = json?.schema?.data?.texts?.name?.text || ''
  const el = {
    id: uuid(), type: 'shape', shape: 'cylinder',
    ...centreBox(json, w, h), w, h,
    color: 'blue', shade: DEFAULT_SHADE, text: htmlToText(text),
    rotation: rotationOf(json),
  }
  applyFill(el, style)
  applyBorder(el, style)
  return el
}

function stickyElement(json) {
  const scale = num(json?.scale?.scale, 1) || 1
  const h = Math.round((scale * STICKY_BASE.height) / SCALE)
  const w = Math.round((scale * STICKY_BASE.width) / SCALE)
  const style = parseStyle(json.style)
  const el = {
    id: uuid(), type: 'sticky',
    ...centreBox(json, w, h), w, h,
    color: 'yellow', shade: DEFAULT_SHADE, text: htmlToText(json.text),
    rotation: rotationOf(json),
  }
  // Stickies carry their fill in `sbc`, not `bc`.
  if (style.sbc != null && style.sbc !== -1) {
    const c = nearest(FILL_RAMP, style.sbc)
    el.color = c.hue
    el.shade = c.shade
  }
  return el
}

function textElement(json) {
  const scale = num(json?.scale?.scale, 1) || 1
  const size = json.size || { width: 0, height: 20 }
  const h = Math.round((scale * 20) / SCALE)
  const w = Math.round((size.width * scale) / SCALE)
  return {
    id: uuid(), type: 'text',
    ...centreBox(json, w, h), w, h,
    text: htmlToText(json.text),
    rotation: rotationOf(json),
  }
}

function drawElement(json) {
  const size = json.size || { width: 0, height: 0 }
  const w = Math.round(size.width / SCALE)
  const h = Math.round(size.height / SCALE)
  const style = parseStyle(json.style)
  const pts = (Array.isArray(json.points) ? json.points : []).map((p) => [
    Math.round(num(p.x) / SCALE), Math.round(num(p.y) / SCALE),
  ])
  const el = {
    id: uuid(), type: 'draw',
    ...centreBox(json, w, h), w, h, points: pts,
    color: 'gray', shade: 4,
    strokeWidth: Math.max(1, Math.round(num(style.t, 3) / SCALE)),
  }
  if (style.lc != null && style.lc !== -1) {
    const c = nearest(STROKE_RAMP, style.lc)
    el.color = c.hue
    el.shade = c.shade
  }
  if (style.lo != null && Number(style.lo) !== 1) el.opacity = Number(style.lo)
  return el
}

// ── Payload → { elements, arrows } ────────────────────────────────────────────
export function payloadToCanvy(payload) {
  const objects = Array.isArray(payload?.data?.objects) ? payload.data.objects : []
  const elements = []
  const lines = []             // { json, index } deferred until element ids exist
  const idByIndex = new Map()  // objects[] index → new Canvy element id

  objects.forEach((obj, index) => {
    const kind = obj?.widgetData?.type
    const json = obj?.widgetData?.json
    if (!json) return
    let el = null
    if (kind === 'shape') el = shapeElement(json)
    else if (kind === 'stencil') el = stencilElement(json)
    else if (kind === 'sticker') el = stickyElement(json)
    else if (kind === 'text') el = textElement(json)
    else if (kind === 'paint') el = drawElement(json)
    else if (kind === 'line') { lines.push({ json, index }); return }
    else return // unknown widget type → skip
    idByIndex.set(index, el.id)
    elements.push(el)
  })

  const arrows = []
  // Resolve one connector endpoint to a Canvy arrow end: attached → { elementId },
  // floating (widgetIndex -1) → { x, y } in the same recentred group space.
  function resolveEnd(end) {
    if (!end) return null
    if (end.widgetIndex != null && end.widgetIndex >= 0) {
      const elementId = idByIndex.get(end.widgetIndex)
      return elementId ? { elementId } : null
    }
    const p = end.point
    if (p && p.x != null && p.y != null) {
      return { x: Math.round(num(p.x) / SCALE), y: Math.round(num(p.y) / SCALE) }
    }
    return null
  }

  for (const { json } of lines) {
    const from = resolveEnd(json.primary)
    const to = resolveEnd(json.secondary)
    if (!from || !to) continue // both ends must resolve
    const style = parseStyle(json.style)
    const caption = json?.line?.captions?.[0]
    arrows.push({
      id: uuid(),
      from, to,
      label: caption ? htmlToText(caption.text) : '',
      curve: Number(style.lt) === 2 ? CURVE_DEFAULT : 0,
    })
  }

  return { elements, arrows }
}

// Top-level: clipboard HTML → { elements, arrows } | null (null = not Miro data).
export function parseMiroClipboard(html) {
  const payload = decodeMiroHtml(html)
  if (!payload) return null
  const result = payloadToCanvy(payload)
  if (!result.elements.length && !result.arrows.length) return null
  return result
}
