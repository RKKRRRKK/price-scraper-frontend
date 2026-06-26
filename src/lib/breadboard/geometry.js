// Geometry for the breadboard tool. Everything works in SVG user units; the
// canvas scales the whole scene via the viewBox. Pure functions — no Vue/DOM.

import { BREADBOARDS, ROWS, getTemplate } from './templates'

export const PITCH = 26 // distance between adjacent holes
export const HOLE_R = 4.2 // hole radius
export const SNAP_R = PITCH * 0.62 // pointer snap radius for hit-testing

const MARGIN_X = PITCH * 1.4 // left/right padding before col 1
const RAIL_PAD = PITCH * 0.9 // padding from board edge to first rail line
const RAIL_GAP = PITCH * 1.5 // gap between a rail block and the main grid
const RAVINE = PITCH * 0.7 // extra gap for the centre ravine (between E and F)
const RAIL_GROUP = 5 // rail holes per visual group
const TOP_PAD = PITCH * 0.9 // top padding for railless (mini) boards

const RAIL_DEFS = [
  { key: 'TP', polarity: '+', where: 'top' },
  { key: 'TM', polarity: '−', where: 'top' },
  { key: 'BP', polarity: '+', where: 'bottom' },
  { key: 'BM', polarity: '−', where: 'bottom' },
]

// Compute the full layout for one breadboard instance { id, type, x, y }.
export function getBreadboardLayout(bb) {
  const cfg = BREADBOARDS[bb.type] || BREADBOARDS.full
  const x0 = bb.x || 0
  const y0 = bb.y || 0
  const cols = cfg.cols
  const colX = (c) => x0 + MARGIN_X + (c - 1) * PITCH

  const holes = []
  const railLines = []

  // ── vertical band positions ──
  let mainTopStart
  const railY = {}
  if (cfg.rails) {
    railY.TP = y0 + RAIL_PAD
    railY.TM = railY.TP + PITCH
    mainTopStart = railY.TM + RAIL_GAP
  } else {
    mainTopStart = y0 + TOP_PAD
  }

  const rowY = []
  for (let i = 0; i < 5; i++) rowY[i] = mainTopStart + i * PITCH
  for (let i = 5; i < 10; i++) rowY[i] = mainTopStart + i * PITCH + RAVINE
  const ravineY = (rowY[4] + rowY[5]) / 2

  if (cfg.rails) {
    railY.BP = rowY[9] + RAIL_GAP
    railY.BM = railY.BP + PITCH
  }

  // ── main grid holes ──
  for (let c = 1; c <= cols; c++) {
    for (let r = 0; r < ROWS.length; r++) {
      const row = ROWS[r]
      const half = r < 5 ? 'top' : 'bot'
      holes.push({
        id: `${bb.id}:c${c}:${row}`,
        bbId: bb.id, kind: 'main', col: c, row,
        x: colX(c), y: rowY[r],
        group: `${bb.id}:col${c}:${half}`,
        label: `${c}${row}`,
      })
    }
  }

  // ── power-rail holes ──
  if (cfg.rails) {
    const segCount = cfg.railSegments || 1
    const splitCol = Math.ceil(cols / 2)
    for (const def of RAIL_DEFS) {
      const y = railY[def.key]
      railLines.push({ key: def.key, polarity: def.polarity, where: def.where, y, x1: colX(1), x2: colX(cols) })
      let idx = 0
      for (let c = 2; c < cols; c++) {
        // group of 5 then a gap (skip every 6th position) for a realistic rail
        if ((c - 2) % (RAIL_GROUP + 1) === RAIL_GROUP) continue
        const segment = segCount === 1 ? 0 : c <= splitCol ? 0 : 1
        holes.push({
          id: `${bb.id}:${def.key}:${idx}`,
          bbId: bb.id, kind: 'rail', railKey: def.key, polarity: def.polarity,
          where: def.where, segment, x: colX(c), y,
          group: `${bb.id}:${def.key}:seg${segment}`,
          label: `${def.polarity} ${def.where} rail`,
        })
        idx++
      }
    }
  }

  const holesById = {}
  for (const h of holes) holesById[h.id] = h

  const width = colX(cols) + MARGIN_X - x0
  const height = (cfg.rails ? railY.BM + RAIL_PAD : rowY[9] + TOP_PAD) - y0

  return {
    bb, cfg, holes, holesById, railLines, rowY, ravineY,
    colX, x0, y0, width, height,
    mainTop: rowY[0], mainBottom: rowY[9],
  }
}

// Snap a pointer position to the nearest hole within SNAP_R. Returns hole | null.
export function nearestHole(layout, x, y) {
  let best = null
  let bestD = SNAP_R * SNAP_R
  for (const h of layout.holes) {
    const dx = h.x - x
    const dy = h.y - y
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = h }
  }
  return best
}

// Hole at a specific (col,row) — used when laying out inline pins.
function holeAt(layout, col, rowIndex) {
  if (col < 1 || col > layout.cfg.cols) return null
  if (rowIndex < 0 || rowIndex > 9) return null
  return layout.holesById[`${layout.bb.id}:c${col}:${ROWS[rowIndex]}`] || null
}

// Default placement of an inline item's pins given an anchor hole (pin[0]).
// Mutates and returns the item with pin.hole assigned where possible.
export function placeInlineItem(layout, item, anchorHole) {
  if (!anchorHole || anchorHole.kind !== 'main') {
    // anchoring on a rail: lay pins along the rail row is awkward — fall back to
    // mapping just the first pin and leaving the rest for the inspector.
    if (item.pins[0]) item.pins[0].hole = anchorHole ? anchorHole.id : null
    item.x = anchorHole?.x ?? item.x
    item.y = anchorHole?.y ?? item.y
    return item
  }
  const tpl = getTemplate(item.kind)
  const col0 = anchorHole.col
  const r0 = ROWS.indexOf(anchorHole.row)

  if (item.kind === 'ic') {
    // DIP straddles the ravine: top pins on row E, bottom on row F.
    const n = item.pins.length
    const perSide = Math.ceil(n / 2)
    for (let i = 0; i < n; i++) {
      let col, rowIndex
      if (i < perSide) { col = col0 + i; rowIndex = 4 }            // E row, left→right
      else { col = col0 + (perSide - 1) - (i - perSide); rowIndex = 5 } // F row, right→left
      item.pins[i].hole = holeAt(layout, col, rowIndex)?.id ?? null
    }
  } else {
    const span = tpl?.span ?? 1
    for (let i = 0; i < item.pins.length; i++) {
      const col = col0 + i * span
      item.pins[i].hole = holeAt(layout, col, r0)?.id ?? null
    }
  }
  item.x = anchorHole.x
  item.y = anchorHole.y
  return item
}

// Coordinate of an inline pin (hole position if mapped, else relative to item).
export function inlinePinXY(layout, item, pin, index) {
  if (pin.hole && layout.holesById[pin.hole]) {
    const h = layout.holesById[pin.hole]
    return { x: h.x, y: h.y }
  }
  return { x: (item.x || 0) + index * PITCH, y: item.y || 0 }
}

// Axis-aligned bounds of a placed item, in scene space. Used for selection
// outlines (sprite) and click hit-testing (canvas) so the two always agree.
export function itemBounds(layout, item, boardLayout) {
  const tpl = getTemplate(item.kind)
  const standalone = (item.placement || tpl?.placement) === 'standalone'
  if (standalone && boardLayout) {
    const r = boardLayout.rect
    return { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }
  }
  const pts = item.pins.map((pin, i) => inlinePinXY(layout, item, pin, i))
  if (!pts.length) return { x: item.x - 10, y: item.y - 10, w: 20, h: 20 }
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const padTop = 30 // body is drawn above the pin row
  return { x: minX - 14, y: minY - padTop, w: maxX - minX + 28, h: maxY - minY + padTop + 14 }
}

// Nearest hole to a point, ignoring the snap radius (used while dragging).
export function nearestHoleUnbounded(layout, x, y) {
  let best = null
  let bestD = Infinity
  for (const h of layout.holes) {
    if (h.kind !== 'main') continue // drag-snap to the main grid; rails via inspector
    const dx = h.x - x
    const dy = h.y - y
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = h }
  }
  return best
}

// ── Standalone board pin layout ──────────────────────────────────────────────
const BOARD_PAD = PITCH * 0.8
const BOARD_PIN_PITCH = PITCH * 0.9
const BOARD_COL_GAP = PITCH * 4.6 // horizontal gap between the two pin columns
const BOARD_HEADER = PITCH * 1.4 // header strip height above the first pin

// Returns { rect:{x,y,w,h}, pins:[{...pin, x, y, side}] } for a standalone board.
export function getBoardLayout(item) {
  const pins = item.pins || []
  const left = pins.filter((p) => p.side === 'L').sort((a, b) => a.order - b.order)
  const right = pins.filter((p) => p.side === 'R').sort((a, b) => a.order - b.order)
  const rows = Math.max(left.length, right.length, 1)
  const x0 = item.x || 0
  const y0 = item.y || 0
  const firstY = y0 + BOARD_HEADER + BOARD_PAD
  const leftX = x0 + BOARD_PAD
  const rightX = leftX + BOARD_COL_GAP
  const out = []
  left.forEach((p, i) => out.push({ ...p, x: leftX, y: firstY + i * BOARD_PIN_PITCH }))
  right.forEach((p, i) => out.push({ ...p, x: rightX, y: firstY + i * BOARD_PIN_PITCH }))
  const w = rightX + BOARD_PAD - x0
  const h = firstY + rows * BOARD_PIN_PITCH + BOARD_PAD - y0
  return { rect: { x: x0, y: y0, w, h }, pins: out, leftX, rightX, firstY }
}

// ── Endpoint helpers (wires reference holes or item pins) ─────────────────────
export function pinEndpointId(item, pin) {
  return `item:${item.id}:${pin.id}`
}
export function isPinEndpoint(id) {
  return typeof id === 'string' && id.startsWith('item:')
}
export function parsePinEndpoint(id) {
  const [, itemId, pinId] = id.split(':')
  return { itemId, pinId }
}

// Resolve any endpoint id (hole or item-pin) to an { x, y } in scene space.
export function endpointXY(id, { layout, itemsById, boardLayouts }) {
  if (isPinEndpoint(id)) {
    const { itemId, pinId } = parsePinEndpoint(id)
    const bl = boardLayouts?.[itemId]
    if (bl) {
      const p = bl.pins.find((pp) => pp.id === pinId)
      if (p) return { x: p.x, y: p.y }
    }
    // inline item pin
    const it = itemsById?.[itemId]
    if (it) {
      const idx = it.pins.findIndex((pp) => pp.id === pinId)
      if (idx !== -1) return inlinePinXY(layout, it, it.pins[idx], idx)
    }
    return null
  }
  const h = layout?.holesById?.[id]
  return h ? { x: h.x, y: h.y } : null
}
