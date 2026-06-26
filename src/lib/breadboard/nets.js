// Electrical-net computation. Union-find over breadboard holes + item pins.
//
// Rules:
//  • Holes that share a strip (column half A–E / F–J, or a power-rail segment)
//    are one net — they share a `group` key from geometry.
//  • A jumper WIRE merges the nets of its two endpoints.
//  • A component pin merely *sits on* the net of the hole it's plugged into — it
//    never merges its two legs' nets (a resistor bridges two nets, it doesn't
//    join them). Standalone board pins only join a net when wired.
//
// Output is structured for the markdown exporter and the canvas overlay.

import { getBreadboardLayout, pinEndpointId, isPinEndpoint } from './geometry'
import { getTemplate } from './templates'

class DSU {
  constructor() { this.parent = new Map() }
  find(x) {
    if (!this.parent.has(x)) { this.parent.set(x, x); return x }
    let root = x
    while (this.parent.get(root) !== root) root = this.parent.get(root)
    while (this.parent.get(x) !== root) { const n = this.parent.get(x); this.parent.set(x, root); x = n }
    return root
  }
  union(a, b) { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb) }
}

function groupDescriptor(hole) {
  if (hole.kind === 'rail') return hole.label // "+ top rail"
  return `col ${hole.col} ${hole.row >= 'F' ? 'F–J' : 'A–E'}`
}

// Classify a name/descriptor as a known power kind for labelling + ordering.
function powerKind(name) {
  const s = String(name).toUpperCase()
  if (/\bGND\b|GROUND|(^|[^A-Z])−|VSS/.test(s)) return 'gnd'
  if (/\b5V\b|VBUS|VIN5/.test(s)) return '5v'
  if (/3V3|3VO|3\.3V/.test(s)) return '3v3'
  if (/VCC|VDD|VIN|\bVS\b/.test(s)) return 'pwr'
  return null
}

// data = { breadboards, items, wires }
export function computeNets(data) {
  const breadboards = data.breadboards || []
  const items = data.items || []
  const wires = data.wires || []

  const layouts = breadboards.map((bb) => getBreadboardLayout(bb))
  const holesById = {}
  const holes = []
  for (const l of layouts) for (const h of l.holes) { holesById[h.id] = h; holes.push(h) }

  const dsu = new DSU()

  // 1. union holes within each strip/rail group
  const byGroup = {}
  for (const h of holes) (byGroup[h.group] ||= []).push(h)
  for (const list of Object.values(byGroup)) {
    for (let i = 1; i < list.length; i++) dsu.union(list[0].id, list[i].id)
  }

  // track which holes are actually used (referenced by a pin or wire)
  const used = new Set()
  // pin endpoint id -> { item, pin }
  const pinInfo = new Map()

  // 2. attach inline pins to their holes
  for (const item of items) {
    const tpl = getTemplate(item.kind)
    const standalone = (item.placement || tpl?.placement) === 'standalone'
    for (const pin of item.pins) {
      const eid = pinEndpointId(item, pin)
      pinInfo.set(eid, { item, pin })
      dsu.find(eid) // materialise node
      if (!standalone && pin.hole && holesById[pin.hole]) {
        dsu.union(eid, pin.hole)
        used.add(pin.hole)
      }
    }
  }

  // 3. wires merge nets
  for (const w of wires) {
    if (!w.from || !w.to) continue
    dsu.union(w.from, w.to)
    for (const ep of [w.from, w.to]) {
      if (isPinEndpoint(ep)) { dsu.find(ep) } else if (holesById[ep]) used.add(ep)
    }
  }

  // ── collect components ──
  const comps = new Map() // root -> { holeIds:Set, pinEndpoints:Set }
  const touch = (node) => {
    const root = dsu.find(node)
    if (!comps.has(root)) comps.set(root, { holeIds: new Set(), pinEndpoints: new Set() })
    return comps.get(root)
  }
  for (const hid of used) touch(hid).holeIds.add(hid)
  for (const eid of pinInfo.keys()) touch(eid).pinEndpoints.add(eid)

  // ── build nets (only those with ≥1 pin or wire, i.e. anything interesting) ──
  const nets = []
  let n = 0
  for (const [root, c] of comps) {
    if (c.pinEndpoints.size === 0 && c.holeIds.size === 0) continue
    // a net is interesting if it has a pin on it, or ≥2 connected holes via a wire
    const pins = [...c.pinEndpoints].map((eid) => {
      const { item, pin } = pinInfo.get(eid)
      return { endpointId: eid, item, pin, name: pin.name, power: powerKind(pin.name) }
    })
    const holeRefs = [...c.holeIds].map((hid) => holesById[hid]).filter(Boolean)
    // a net needs ≥2 connected points: an unwired pin or a lone empty hole is
    // not a net (the pin is "floating" until plugged into a strip or wired).
    if (pins.length + holeRefs.length < 2) continue

    const groups = [...new Set(holeRefs.map(groupDescriptor))]
    const hasMinusRail = holeRefs.some((h) => h.kind === 'rail' && h.polarity === '−')
    const hasPlusRail = holeRefs.some((h) => h.kind === 'rail' && h.polarity === '+')

    // power classification: prefer an explicit pin name, then rails
    let kind = null
    for (const p of pins) { if (p.power) { kind = bestPower(kind, p.power) } }
    if (!kind && hasMinusRail) kind = 'gnd'
    if (!kind && hasPlusRail) kind = 'pwr'

    nets.push({
      id: `N${++n}`, root, pins, holeRefs, groups, kind,
      label: netLabel({ pins, holeRefs, groups, kind }),
    })
  }

  // ordering: GND, 5V, 3V3, other power, then signal nets; stable by id
  const order = { gnd: 0, '5v': 1, '3v3': 2, pwr: 3 }
  nets.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))
  nets.forEach((net, i) => { net.id = `N${i + 1}` })

  // ── components that bridge ≥2 nets (resistors, LEDs, etc.) ──
  const netOfEndpoint = new Map()
  nets.forEach((net) => net.pins.forEach((p) => netOfEndpoint.set(p.endpointId, net.id)))
  const bridges = []
  for (const item of items) {
    const tpl = getTemplate(item.kind)
    if ((item.placement || tpl?.placement) === 'standalone') continue
    const legs = item.pins.map((pin) => ({
      pin, netId: netOfEndpoint.get(pinEndpointId(item, pin)) || null, hole: pin.hole,
    }))
    const distinct = new Set(legs.map((l) => l.netId).filter(Boolean))
    if (distinct.size >= 2) bridges.push({ item, legs })
  }

  // ── floating pins (mapped to nothing) ──
  const floating = []
  for (const item of items) {
    for (const pin of item.pins) {
      const eid = pinEndpointId(item, pin)
      if (!netOfEndpoint.has(eid)) floating.push({ item, pin })
    }
  }

  return { nets, bridges, floating, layouts }
}

function bestPower(cur, next) {
  const rank = { gnd: 4, '5v': 3, '3v3': 2, pwr: 1 }
  if (!cur) return next
  return (rank[next] || 0) > (rank[cur] || 0) ? next : cur
}

function netLabel({ pins, holeRefs, groups, kind }) {
  if (kind === 'gnd') return 'GND'
  if (kind === '5v') return '+5V'
  if (kind === '3v3') return '+3V3'
  // a rail gives a clean name
  const rail = holeRefs.find((h) => h.kind === 'rail')
  if (rail) return rail.label
  // otherwise name by the strip(s)
  if (groups.length) return groups[0]
  if (pins.length) return pins[0].name
  return 'net'
}
