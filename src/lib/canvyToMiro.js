// Convert a Canvy whiteboard into a Miro clipboard payload so the board can be
// pasted straight into miro.com. This mirrors, in the browser, what the
// local_utilities/miro_compress.js Node script does — but builds the Miro object
// graph from Canvy's own elements/arrows instead of a pre-decoded JSON file.
//
// The Miro clipboard format (reverse-engineered from local_utilities/variants):
//   payload  = { isProtected, boardId, data:{ objects, meta }, version, host, … }
//   objects  = [ { widgetData:{ json, type }, type:14, id, initialId, meta } ]
//   encoded  = base64( utf8(JSON.stringify(payload)).map(b => (b + 59) % 256) )
//   html     = <span data-meta="<!--(miro-data-v1)${encoded}(/miro-data-v1)-->"></span>…
//
// Each object's `id` is its index in the `objects` array; connectors ("line"
// widgets) reference the objects they join by that index via `widgetIndex`.

// ── Colour palette (mirrors CanvyCanvas.vue COLORS ramp) ──────────────────────
// Kept in sync by hand: a hue + shade index resolves to concrete { fill, stroke }.
const DEFAULT_SHADE = 1
const COLORS = {
  yellow: [
    { fill: '#fffdf0', stroke: '#f1e4a8' }, { fill: '#fff6c2', stroke: '#ecd56b' },
    { fill: '#ffec99', stroke: '#e3c33d' }, { fill: '#ffe066', stroke: '#d4af1f' },
    { fill: '#f6cf3a', stroke: '#b8930f' },
  ],
  pink: [
    { fill: '#fff0f4', stroke: '#f7c6d3' }, { fill: '#ffd9e2', stroke: '#f3a3b6' },
    { fill: '#ffbccd', stroke: '#ec7e9a' }, { fill: '#ff97b1', stroke: '#e15c7e' },
    { fill: '#f56d92', stroke: '#c43c64' },
  ],
  blue: [
    { fill: '#eef6ff', stroke: '#bcd8f7' }, { fill: '#d6e8ff', stroke: '#94bff2' },
    { fill: '#b3d4ff', stroke: '#6aa3ec' }, { fill: '#88bbff', stroke: '#4684e0' },
    { fill: '#5b9bf5', stroke: '#2b66c4' },
  ],
  green: [
    { fill: '#eefaf1', stroke: '#b8e6c6' }, { fill: '#d4f3dd', stroke: '#8fd3a3' },
    { fill: '#aee9c0', stroke: '#66c184' }, { fill: '#7fdb9d', stroke: '#43a868' },
    { fill: '#4cc47b', stroke: '#2b864f' },
  ],
  purple: [
    { fill: '#f4eeff', stroke: '#d6c4f6' }, { fill: '#e7dcff', stroke: '#bda3f0' },
    { fill: '#d3bfff', stroke: '#a07ee8' }, { fill: '#b899ff', stroke: '#8257dd' },
    { fill: '#9a72f0', stroke: '#6638c0' },
  ],
  gray: [
    { fill: '#f6f5f3', stroke: '#ddd9d2' }, { fill: '#ecebe7', stroke: '#cfccc5' },
    { fill: '#d9d6cf', stroke: '#b3afa5' }, { fill: '#bcb8ae', stroke: '#918c80' },
    { fill: '#97928a', stroke: '#6b665d' },
  ],
}

// Canvy shape → Miro shape code (both `st` in the style string and `shape`).
// Verified against local_utilities/variants: rect=3, ellipse=4, diamond=8,
// parallelogram=10. `cylinder` is NOT a plain shape — Miro models it as a
// flowchart stencil widget, handled by stencilObject() below.
const SHAPE_CODE = {
  rect: 3,
  ellipse: 4,
  diamond: 8,
  parallelogram: 10,
}

// Multiply Canvy pixels so pasted objects land at comfortable Miro sizes.
const SCALE = 3
// Miro dark ink used for text + outlines in every captured sample (#1a1a1a).
const INK = 0x1a1a1a
// Miro sticky notes are a fixed-aspect widget scaled by `scale`; this is the
// canonical base size seen in the yellow-sticky-note sample.
const STICKY_BASE = { width: 199, height: 228 }
// Miro board id is cosmetic for a cross-board paste (Miro reassigns on paste); we
// reuse the value from the captured samples.
const BOARD_ID = 'uXjVH_znONY='

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi)
}
function resolveColor(el) {
  const ramp = COLORS[el?.color] || COLORS.yellow
  const idx = clamp(Number.isFinite(el?.shade) ? el.shade : DEFAULT_SHADE, 0, ramp.length - 1)
  return ramp[idx]
}
// The border stroke colour for a shape (its own border hue if set, else the fill
// tone) — matches CanvyCanvas.vue shapeStroke().
function resolveBorder(el) {
  const ramp = COLORS[el.borderColor || el.color] || COLORS.blue
  const idx = el.borderColor
    ? (Number.isFinite(el.borderShade) ? el.borderShade : 3)
    : (Number.isFinite(el.shade) ? el.shade : DEFAULT_SHADE)
  return ramp[clamp(idx, 0, ramp.length - 1)].stroke
}
function hexToInt(hex) {
  return parseInt(String(hex).replace('#', ''), 16)
}
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
// Canvy stores text as plain innerText; Miro wants HTML paragraphs.
function textToMiroHtml(text) {
  const t = escapeHtml(text).split('\n')
  return t.map((line) => `<p>${line}</p>`).join('')
}

// ── Geometry ──────────────────────────────────────────────────────────────────
// Point on an element's box border in the direction of (tx,ty) — same routine as
// CanvyCanvas.vue edgePoint(), so anchors match what Canvy draws.
function edgePoint(el, tx, ty) {
  const cx = el.x + el.w / 2
  const cy = el.y + el.h / 2
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scale = 1 / Math.max(Math.abs(dx) / (el.w / 2), Math.abs(dy) / (el.h / 2))
  return { x: cx + dx * scale, y: cy + dy * scale }
}
// A Miro attachment point is the edge point expressed as a 0–1 fraction of the box.
function anchorPoint(el, towardX, towardY) {
  const e = edgePoint(el, towardX, towardY)
  return {
    x: clamp((e.x - el.x) / el.w, 0, 1),
    y: clamp((e.y - el.y) / el.h, 0, 1),
  }
}

// ── Unique-id helpers (Miro reassigns real ids on paste; these just need to be
// internally unique and plausibly shaped) ──────────────────────────────────────
function makeIdGen() {
  let n = 0
  const base = 3458764677100000000
  return () => String(base + Math.floor(Math.random() * 8999999) + n++ * 37)
}

// Font size for a shape/stencil, proportional to its (scaled) height.
function fontFor(el) {
  return clamp(Math.round(el.h * SCALE * 0.16), 12, 160)
}

// Miro rotation is in degrees, counter-clockwise-positive; Canvy stores CSS
// degrees (clockwise-positive), so negate. (Verified: scene-3 stored ≈ -40.7°
// for a hand-rotated "45°" shape.)
function rotationDeg(el) {
  return -(Number(el?.rotation) || 0)
}

// ── Object builders ─────────────────────────────────────────────────────────
function shapeStyle(el, code) {
  const style = {
    st: code,
    ss: 2,
    sc: INK,
    bc: hexToInt(resolveColor(el).fill),
    bo: el.opacity != null ? Number(el.opacity) : 1,
    brc: hexToInt(resolveBorder(el)),
    brw: clamp(Number.isFinite(el.borderWidth) ? el.borderWidth : 2, 0, 40),
    bro: el.borderOpacity != null ? Number(el.borderOpacity) : 1,
    brs: el.borderStyle === 'dashed' ? 1 : 2, // 2=solid (verified); 1=dashed (guess)
    ffn: 'Noto Sans',
    tc: INK,
    tsc: 1,
    ta: 'c',
    tav: 'm',
    fs: fontFor(el),
    b: 0, i: 0, u: 0, s: 0,
    bsc: 1,
    VER: 2.1,
    hl: '',
    brr: 0,
  }
  return JSON.stringify(style)
}

function shapeObject(el, nextId) {
  const code = SHAPE_CODE[el.shape] ?? SHAPE_CODE.rect
  return {
    widgetData: {
      json: {
        _position: { offsetPx: { x: 0, y: 0 } }, // filled in by caller
        scale: { scale: 1 },
        relativeScale: 1,
        rotation: { rotation: rotationDeg(el) },
        relativeRotation: rotationDeg(el),
        size: { width: el.w * SCALE, height: el.h * SCALE },
        _parent: null,
        text: textToMiroHtml(el.text),
        style: shapeStyle(el, code),
        shape: String(code),
      },
      type: 'shape',
    },
    type: 14,
    id: 0,
    initialId: nextId(),
    meta: { boardId: BOARD_ID, widgetToken: 100 },
  }
}

// Cylinder → Miro flowchart-database stencil (verified from scene-2). Text lives
// in the schema, not the top-level `text` field.
function stencilObject(el, nextId) {
  const w = el.w * SCALE
  const h = el.h * SCALE
  const fs = fontFor(el)
  const style = {
    tc: INK, tsc: 0, bc: hexToInt(resolveColor(el).fill), bo: 1,
    brc: hexToInt(resolveBorder(el)),
    brw: clamp(Number.isFinite(el.borderWidth) ? el.borderWidth : 2, 0, 40),
    bro: 1, brs: 2, ffn: 'Noto Sans', ta: 'c', tav: 'm', fs,
  }
  return {
    widgetData: {
      json: {
        'ns:diagrammingNotation': { element: 'flowchart-database', collection: 'flowchart' },
        _position: { offsetPx: { x: 0, y: 0 } },
        scale: { scale: 1 },
        relativeScale: 1,
        rotation: { rotation: rotationDeg(el) },
        relativeRotation: rotationDeg(el),
        size: { width: w, height: h },
        _parent: null,
        style: JSON.stringify(style),
        schema: {
          id: 'flowchart-database',
          data: {
            formulaValues: {
              width: w, height: h,
              ellipseVerticalRadiusRatio: 0.1,
              textPaddingHorizontal: 16, textPaddingBottom: 8,
            },
            texts: {
              name: {
                text: textToMiroHtml(el.text),
                styles: { ffn: 'Noto Sans', ta: 'c', tav: 'm', fs },
              },
            },
            resources: {},
            iterators: {},
          },
        },
        matrixLayoutData: null,
      },
      type: 'stencil',
    },
    type: 14,
    id: 0,
    initialId: nextId(),
    meta: { boardId: BOARD_ID, widgetToken: 100 },
  }
}

// Text block → Miro text widget (verified from scene-2). Font size is driven by
// `scale`, and the box is sized so scale×size reproduces the Canvy box.
function textObject(el, nextId) {
  const scale = Number(((el.h * SCALE) / 20).toFixed(3)) || 1
  const style = {
    st: 14, bc: -1, bo: 1, bsc: 0, ta: 'l', tc: INK, tsc: 1,
    ffn: 'Noto Sans', p: 0, b: 0, u: 0, i: 0, s: 0, fw: 1,
    brc: -1, bro: 1, brw: 0, brs: 2, hl: 0,
  }
  return {
    widgetData: {
      json: {
        _position: { offsetPx: { x: 0, y: 0 } },
        scale: { scale },
        relativeScale: scale,
        rotation: { rotation: rotationDeg(el) },
        relativeRotation: rotationDeg(el),
        size: { width: (el.w * SCALE) / scale, height: 20 },
        _parent: null,
        text: textToMiroHtml(el.text),
        style: JSON.stringify(style),
      },
      type: 'text',
    },
    type: 14,
    id: 0,
    initialId: nextId(),
    meta: { boardId: BOARD_ID, widgetToken: 100 },
  }
}

// Freehand stroke → Miro paint widget (verified from scene-2). Canvy stores
// points as [x,y] pairs relative to the box; Miro wants {x,y} objects.
function paintObject(el, nextId) {
  const pts = (Array.isArray(el.points) ? el.points : []).map(([x, y]) => ({
    x: x * SCALE, y: y * SCALE,
  }))
  const style = {
    lc: hexToInt(resolveColor(el).stroke),
    t: Math.round((el.strokeWidth || 3) * SCALE), // stroke thickness (verified: scene-3 thick=30 / thin=2)
    lo: el.opacity != null ? Number(el.opacity) : 1,
    e: 10, // per-session smoothing epsilon; ~constant regardless of thickness in samples
  }
  return {
    widgetData: {
      json: {
        _position: { offsetPx: { x: 0, y: 0 } },
        scale: { scale: 1 },
        relativeScale: 1,
        rotation: { rotation: rotationDeg(el) },
        relativeRotation: rotationDeg(el),
        size: { width: el.w * SCALE, height: el.h * SCALE },
        _parent: null,
        points: pts,
        style: JSON.stringify(style),
      },
      type: 'paint',
    },
    type: 14,
    id: 0,
    initialId: nextId(),
    meta: { boardId: BOARD_ID, widgetToken: 100 },
  }
}

function stickyObject(el, nextId) {
  // Miro stickies keep a fixed aspect and are sized via `scale`; derive a uniform
  // scale from the Canvy sticky's (scaled) height.
  const scale = Number(((el.h * SCALE) / STICKY_BASE.height).toFixed(3)) || 1
  const style = {
    fs: 0, fsa: 1, ffn: 'Noto Sans', ta: 'c', tav: 'm',
    taw: 0, tah: 0, lh: 1.36, sbc: hexToInt(resolveColor(el).fill),
  }
  return {
    widgetData: {
      json: {
        _position: { offsetPx: { x: 0, y: 0 } },
        scale: { scale },
        relativeScale: scale,
        rotation: { rotation: rotationDeg(el) },
        relativeRotation: rotationDeg(el),
        size: { ...STICKY_BASE },
        _parent: null,
        text: textToMiroHtml(el.text),
        style: JSON.stringify(style),
        'ns:author': { id: '3458764677100601411', enabled: false },
      },
      type: 'sticker',
    },
    type: 14,
    id: 0,
    initialId: nextId(),
    meta: { boardId: BOARD_ID, widgetToken: 100 },
  }
}

const CAPTION_FS = 48

// An endpoint descriptor is either { widgetIndex, point:{x,y in 0..1} } for an
// attachment, or { widgetIndex:-1, point:{x,y in world units} } for a floating
// end (verified from scene-2's floating arrow).
function lineObject({ from, to, curved, label }, nextId, captionNonce, captionSeq) {
  const style = {
    lc: 3355443, ls: 2, t: 12,
    lt: curved ? 2 : 0, // 0=straight, 2=curved (verified against scene-1)
    a_start: 0, a_end: 9, VER: 2, jump: 0,
  }
  const captions = []
  if (label && String(label).trim()) {
    style.fs = CAPTION_FS
    captions.push({
      id: `${captionNonce}:${String(captionSeq()).padStart(5, '0')}`,
      text: textToMiroHtml(label),
      fontSize: CAPTION_FS,
      width: Math.max(40, Math.round(String(label).length * CAPTION_FS * 0.2)),
      position: { x: 0.5, y: 0.5 },
      rotated: false,
      color: 3355443,
    })
  }
  return {
    widgetData: {
      json: {
        points: [],
        primary: { point: from.point, positionType: 0, widgetIndex: from.widgetIndex },
        secondary: { point: to.point, positionType: 0, widgetIndex: to.widgetIndex },
        _position: null,
        _parent: null,
        style: JSON.stringify(style),
        line: { captions },
      },
      type: 'line',
    },
    type: 14,
    id: 0,
    initialId: nextId(),
    meta: { boardId: BOARD_ID, widgetToken: 100 },
  }
}

// ── Board → Miro payload ──────────────────────────────────────────────────────
// Returns { payload, stats }. `stats` reports what was skipped so the UI can warn.
// `opts.onlyIds` (array/Set of element ids) restricts the export to a selection:
// only those elements, and only arrows whose attached ends both fall inside it.
export function boardToMiroPayload(board, opts = {}) {
  const data = board?.data || {}
  const onlyIds = opts.onlyIds ? new Set(opts.onlyIds) : null
  const allElements = Array.isArray(data.elements) ? data.elements : []
  const allArrows = Array.isArray(data.arrows) ? data.arrows : []
  const elements = onlyIds ? allElements.filter((el) => onlyIds.has(el.id)) : allElements
  // An attached arrow end is in-scope only if its element is in the selection; a
  // floating end (no elementId) is always fine. Skip arrows that leave the set.
  const endInScope = (end) => end?.elementId == null || onlyIds.has(end.elementId)
  const arrows = onlyIds
    ? allArrows.filter((a) => endInScope(a.from) && endInScope(a.to))
    : allArrows
  const nextId = makeIdGen()
  // A per-copy nonce shared by all arrow-label captions (matches scene-2's
  // "09ueqir1:00001" / ":00002" pattern); a running counter numbers each caption.
  const captionNonce = Math.random().toString(36).slice(2, 10)
  let captionN = 0
  const captionSeq = () => ++captionN

  const stats = { shapes: 0, cylinders: 0, stickies: 0, texts: 0, draws: 0, arrows: 0, skippedArrows: 0 }

  // Group centroid = centre of the elements' bounding box. Only relative offsets
  // matter (Miro re-centres the group on paste), so any consistent origin works.
  const objects = []
  const indexById = new Map()
  let originX = 0
  let originY = 0
  if (elements.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const el of elements) {
      minX = Math.min(minX, el.x); minY = Math.min(minY, el.y)
      maxX = Math.max(maxX, el.x + el.w); maxY = Math.max(maxY, el.y + el.h)
    }
    originX = (minX + maxX) / 2
    originY = (minY + maxY) / 2
  }
  // World point → Miro world units, relative to the group origin.
  const toWorld = (x, y) => ({ x: (x - originX) * SCALE, y: (y - originY) * SCALE })

  for (const el of elements) {
    let obj
    if (el.type === 'sticky') { obj = stickyObject(el, nextId); stats.stickies++ }
    else if (el.type === 'text') { obj = textObject(el, nextId); stats.texts++ }
    else if (el.type === 'draw') { obj = paintObject(el, nextId); stats.draws++ }
    else if (el.type === 'shape' && el.shape === 'cylinder') { obj = stencilObject(el, nextId); stats.cylinders++ }
    else { obj = shapeObject(el, nextId); stats.shapes++ }
    // Centre of the element, relative to the group origin, scaled to Miro units.
    obj.widgetData.json._position.offsetPx = toWorld(el.x + el.w / 2, el.y + el.h / 2)
    indexById.set(el.id, objects.length)
    objects.push(obj)
  }

  const byId = new Map(elements.map((el) => [el.id, el]))
  // Resolve an arrow end to a line endpoint descriptor. Attached ends anchor to a
  // widget (0–1 point); floating ends use widgetIndex -1 + absolute world point.
  function resolveEnd(end, towardCenter) {
    const el = end?.elementId != null ? byId.get(end.elementId) : null
    if (el && indexById.has(el.id)) {
      return { widgetIndex: indexById.get(el.id), point: anchorPoint(el, towardCenter.x, towardCenter.y) }
    }
    if (end && end.x != null && end.y != null) {
      return { widgetIndex: -1, point: toWorld(end.x, end.y) }
    }
    return null
  }
  // The world centre of an arrow end, used to aim the opposite end's anchor.
  function endCenter(end) {
    const el = end?.elementId != null ? byId.get(end.elementId) : null
    if (el) return { x: el.x + el.w / 2, y: el.y + el.h / 2 }
    return { x: end?.x ?? 0, y: end?.y ?? 0 }
  }

  for (const a of arrows) {
    const from = resolveEnd(a.from, endCenter(a.to))
    const to = resolveEnd(a.to, endCenter(a.from))
    if (!from || !to) { stats.skippedArrows++; continue }
    objects.push(
      lineObject(
        { from, to, curved: !!(Number(a.curve) || 0), label: a.label },
        nextId, captionNonce, captionSeq,
      ),
    )
    stats.arrows++
  }

  // `id` is the object's own index in the array (connectors reference elements by
  // this same index via widgetIndex).
  objects.forEach((obj, i) => { obj.id = i })

  const payload = {
    isProtected: false,
    boardId: BOARD_ID,
    data: { objects, meta: {} },
    version: 2,
    host: 'miro.com',
    asPortalAmount: 0,
    copierType: 'COPY',
  }
  return { payload, stats }
}

// ── Encode (inverse of miro_decompress.js decodeMiro) ─────────────────────────
export function encodeMiroPayload(payload) {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode((b + 59) % 256)
  return btoa(bin)
}

// Build the CF_HTML-style fragment Miro reads from the clipboard. The browser
// adds the Windows clipboard byte-offset headers itself, so we only supply the
// HTML body (the data-meta span carries the real payload; the divs are a plain
// fallback for non-Miro paste targets).
// The display text of an object, wherever it lives (stencils keep it in schema).
function objText(o) {
  const j = o?.widgetData?.json
  return j?.text || j?.schema?.data?.texts?.name?.text || ''
}
function buildFragmentHtml(payload, encoded) {
  const plain = (payload.data.objects || [])
    .map((o) => `<div>${objText(o).replace(/<\/?p>/g, '')}</div>`)
    .join('')
  return `<span data-meta="<!--(miro-data-v1)${encoded}(/miro-data-v1)-->"></span>${plain}`
}

// Top-level: Canvy board → { html, text, stats } ready for the clipboard.
// Pass `opts.onlyIds` to export just a selection (see boardToMiroPayload).
export function buildMiroClipboard(board, opts = {}) {
  const { payload, stats } = boardToMiroPayload(board, opts)
  const encoded = encodeMiroPayload(payload)
  const html = buildFragmentHtml(payload, encoded)
  const text = (payload.data.objects || [])
    .map((o) => objText(o).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return { html, text, stats }
}
