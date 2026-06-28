// Parse a `BreadboardBuild` JSON spec (produced by an LLM following the spec
// embedded in the markdown export) into a full sheet `data` object the app can
// render. Forgiving: tolerant pin/kind matching, collects warnings rather than
// throwing on minor issues.

import { v4 as uuid } from 'uuid'
import { getBreadboardLayout, pinEndpointId } from './geometry'
import { getTemplate, makeItem, BREADBOARDS, findCustomKind } from './templates'

// Pull the first JSON object out of a pasted reply (fenced ```json block first,
// then any ```block, then the first balanced {…}).
function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json|breadboard[a-z-]*)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1].trim().startsWith('{')) return fenced[1].trim()
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

const KIND_ALIASES = {
  resistor: 'resistor', res: 'resistor', r: 'resistor',
  led: 'led', diode_led: 'led',
  cap: 'cap_104', capacitor: 'cap_104', cap_104: 'cap_104', ceramic_capacitor: 'cap_104', ceramiccap: 'cap_104',
  electrolytic_cap: 'electrolytic_cap', electrolytic: 'electrolytic_cap', ecap: 'electrolytic_cap',
  inductor: 'inductor', coil: 'inductor', choke: 'inductor',
  fuse: 'fuse',
  button: 'button', pushbutton: 'button', switch: 'button',
  diode: 'diode',
  transistor: 'transistor', npn: 'transistor', pnp: 'transistor', bjt: 'transistor',
  potentiometer: 'potentiometer', pot: 'potentiometer',
  ic: 'ic', dip: 'ic', chip: 'ic',
  ir_led_tsal6400: 'ir_led_tsal6400', tsal6400: 'ir_led_tsal6400', ir_led: 'ir_led_tsal6400', iremitter: 'ir_led_tsal6400',
  tsop38238: 'tsop38238', ir_receiver: 'tsop38238', irrx: 'tsop38238', ir_rx: 'tsop38238',
  ds18b20: 'ds18b20', ds18b: 'ds18b20',
  veml7700: 'veml7700',
  bme280: 'bme280',
  raspi40: 'raspi40', raspberrypi: 'raspi40', raspberry_pi: 'raspi40', pi: 'raspi40', rpi: 'raspi40',
  esp32devkit: 'esp32devkit', esp32: 'esp32devkit', esp: 'esp32devkit',
  custom: 'custom', board: 'custom', module: 'custom',
}
function normalizeKind(type) {
  if (!type) return null
  const k = String(type).toLowerCase().replace(/[\s-]+/g, '_')
  if (getTemplate(k)) return k
  return KIND_ALIASES[k] || KIND_ALIASES[k.replace(/_/g, '')] || findCustomKind(type) || null
}

function parseOhms(v) {
  if (typeof v === 'number') return v
  if (v == null) return undefined
  const s = String(v).trim().toLowerCase().replace(/ω|ohms?/g, '').trim()
  const m = s.match(/^([\d.]+)\s*([kmg]?)$/)
  if (!m) return undefined
  let n = parseFloat(m[1])
  if (m[2] === 'k') n *= 1e3
  else if (m[2] === 'm' || m[2] === 'g') n *= 1e6
  return n
}

function extractProps(kind, part) {
  const p = {}
  if (kind === 'resistor' || kind === 'potentiometer') {
    const o = parseOhms(part.ohms ?? part.value ?? part.resistance)
    if (o != null) p.ohms = o
  }
  if (kind === 'led' && part.color) p.color = String(part.color)
  if ((kind === 'diode' || kind === 'transistor' || kind === 'ic') && part.part) p.part = String(part.part)
  if ((kind === 'cap_104' || kind === 'electrolytic_cap' || kind === 'inductor') && (part.value ?? part.capacitance ?? part.inductance) != null) {
    p.value = String(part.value ?? part.capacitance ?? part.inductance)
  }
  if (kind === 'fuse' && (part.rating ?? part.value) != null) p.rating = String(part.rating ?? part.value)
  return p
}

const stripParen = (s) => String(s).toLowerCase().replace(/\s*\(.*?\)\s*/g, '').replace(/[()]/g, '').trim()

function resolvePin(item, ref, usedPins) {
  const r = String(ref).trim().toLowerCase()
  let m = item.pins.filter((p) => p.id.toLowerCase() === r)
  if (!m.length) m = item.pins.filter((p) => p.name.toLowerCase() === r)
  if (!m.length) m = item.pins.filter((p) => stripParen(p.name) === r)
  if (!m.length) {
    if (['+', 'vcc', '+ve', 'pos'].includes(r)) m = item.pins.filter((p) => /^a$/i.test(p.id) || /anode/i.test(p.name))
    else if (['-', '-ve', 'k', 'neg'].includes(r)) m = item.pins.filter((p) => /^k$/i.test(p.id) || /cathode/i.test(p.name))
  }
  if (!m.length) return null
  if (usedPins) { const free = m.find((p) => !usedPins.has(p.id)); return free || m[0] }
  return m[0]
}

export function parseBuild(text) {
  const json = extractJson(text)
  if (!json) return { ok: false, error: 'No JSON build block found. Paste the assistant’s reply (it should contain a ```json block).' }
  let spec
  try { spec = JSON.parse(json) } catch (e) { return { ok: false, error: 'Could not parse JSON: ' + e.message } }
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'The JSON is not a build object.' }

  const warnings = []
  const type = BREADBOARDS[spec.breadboard] ? spec.breadboard : 'half'
  const bb = { id: 'bb1', type, x: 24, y: 150 }
  const layout = getBreadboardLayout(bb)

  // ── hole-token resolution ──
  const railMap = { '+T': 'TP', '-T': 'TM', '+B': 'BP', '-B': 'BM', 'T+': 'TP', 'T-': 'TM', 'B+': 'BP', 'B-': 'BM' }
  const railCursor = {}
  function nextRailHole(key) {
    const holes = layout.holes.filter((h) => h.kind === 'rail' && h.railKey === key)
    if (!holes.length) return null
    const i = (railCursor[key] || 0) % holes.length
    railCursor[key] = (railCursor[key] || 0) + 1
    return holes[i].id
  }
  function resolveHole(token) {
    if (token == null) return null
    const t = String(token).trim().toUpperCase().replace(/\s+/g, '')
    if (railMap[t]) return nextRailHole(railMap[t])
    const m = t.match(/^(\d+)([A-J])$/)
    if (m) { const id = `${bb.id}:c${Number(m[1])}:${m[2]}`; return layout.holesById[id] ? id : null }
    return null
  }

  // ── parts ──
  const items = []
  const byId = {}
  let boardStack = 0
  function positionBoard(item) {
    item.x = layout.x0 + layout.width + 60
    item.y = layout.y0 + boardStack
    boardStack += 220
  }

  for (const part of spec.parts || []) {
    const kind = normalizeKind(part.type)
    if (!kind) { warnings.push(`Skipped unknown part type "${part.type}"`); continue }
    const label = String(part.id || part.label || kind)

    if (kind === 'custom') {
      const names = part.pins ? Object.keys(part.pins) : part.pinNames || []
      const item = makeItem('custom', {
        label,
        customPins: names.map((n, i) => ({ name: n, side: i % 2 === 0 ? 'L' : 'R', order: Math.floor(i / 2) })),
      })
      positionBoard(item)
      items.push(item)
      byId[label] = item
      // also wire any pins that were given holes
      if (part.pins) wirePinsToHoles(item, part.pins)
      continue
    }

    const props = extractProps(kind, part)
    if (kind === 'ic') props.pinCount = Math.max(4, part.pinCount || (part.pins ? Object.keys(part.pins).length : 8))
    const item = makeItem(kind, { label, props })
    const standalone = getTemplate(kind).placement === 'standalone'

    if (standalone) {
      positionBoard(item)
      if (part.pins) wirePinsToHoles(item, part.pins) // boards: pin->hole becomes a wire
    } else {
      const used = new Set()
      let firstHole = null
      for (const [ref, token] of Object.entries(part.pins || {})) {
        const pin = resolvePin(item, ref, used)
        if (!pin) { warnings.push(`${label}: no pin "${ref}"`); continue }
        const hole = resolveHole(token)
        if (!hole) { warnings.push(`${label}.${ref}: unknown hole "${token}"`); continue }
        pin.hole = hole
        used.add(pin.id)
        if (!firstHole) firstHole = layout.holesById[hole]
      }
      if (firstHole) { item.x = firstHole.x; item.y = firstHole.y }
    }
    items.push(item)
    byId[label] = item
  }

  // ── wires ──
  const wires = []
  const boardUsed = {}
  function resolveEndpoint(token) {
    if (token == null) return null
    const s = String(token).trim()
    if (s.includes(':')) {
      const idx = s.indexOf(':')
      const pid = s.slice(0, idx)
      const pinRef = s.slice(idx + 1)
      const item = byId[pid]
      if (!item) return null
      const used = (boardUsed[item.id] ||= new Set())
      const pin = resolvePin(item, pinRef, used)
      if (!pin) return null
      used.add(pin.id)
      return pinEndpointId(item, pin)
    }
    return resolveHole(s)
  }
  // a board/module pin mapped directly to a hole → emit a wire
  function wirePinsToHoles(item, pins) {
    const used = (boardUsed[item.id] ||= new Set())
    for (const [ref, token] of Object.entries(pins)) {
      const pin = resolvePin(item, ref, used)
      const hole = resolveHole(token)
      if (!pin || !hole) continue
      used.add(pin.id)
      wires.push({ id: uuid(), from: pinEndpointId(item, pin), to: hole, color: '#16a34a' })
    }
  }

  for (const w of spec.wires || []) {
    const from = resolveEndpoint(w.from)
    const to = resolveEndpoint(w.to)
    if (!from) { warnings.push(`Wire skipped: bad point "${w.from}"`); continue }
    if (!to) { warnings.push(`Wire skipped: bad point "${w.to}"`); continue }
    wires.push({ id: uuid(), from, to, color: w.color || '#16a34a', arc: w.arc === -1 ? -1 : 1 })
  }

  return { ok: true, data: { breadboards: [bb], items, wires }, warnings }
}
