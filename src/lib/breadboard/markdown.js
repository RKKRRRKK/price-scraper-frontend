// Serialise a breadboard sheet into LLM-friendly Markdown. The goal: an
// assistant reading this should understand the whole circuit — every part, where
// each pin is plugged, and what is electrically connected to what — without
// seeing the illustration. Reuses Squell's file-download + slug helpers.

import { computeNets } from './nets'
import { pinEndpointId } from './geometry'
import { getTemplate, valueToBands, formatOhms, BREADBOARDS, PALETTE_GROUPS } from './templates'
import { downloadTextFile, slugify } from '@/lib/squellExport'

export { downloadTextFile, slugify }

function fmtDate(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  } catch {
    return String(ts)
  }
}

// One-line human description of a placed item (without its pin mapping).
export function describeItem(item) {
  const p = item.props || {}
  switch (item.kind) {
    case 'resistor':
      return `Resistor ${formatOhms(p.ohms)} (${valueToBands(p.ohms).join('-')})`
    case 'led':
      return `LED (${p.color || 'red'})`
    case 'cap_104':
      return 'Ceramic capacitor 100 nF (104)'
    case 'button':
      return 'Push-button (open until pressed; side 1 ↔ side 2 when down)'
    case 'diode':
      return `Diode ${p.part || ''}`.trim()
    case 'transistor':
      return `Transistor ${p.part || ''} (TO-92, E-B-C)`.replace('  ', ' ')
    case 'potentiometer':
      return `Potentiometer ${formatOhms(p.ohms)}`
    case 'ic':
      return `IC ${p.part || 'DIP'} (${item.pins.length}-pin)`
    case 'ir_led_tsal6400':
      return `TSAL6400 IR emitter (${p.wavelength || '940nm'})`
    case 'tsop38238':
      return 'TSOP38238 IR receiver module (38 kHz)'
    case 'ds18b20':
      return 'DS18B20 temperature sensor (TO-92, 1-Wire)'
    case 'veml7700':
      return `VEML7700 ambient-light sensor (I²C ${p.addr || '0x10'})`
    case 'bme280':
      return `BME280 temp/humidity/pressure sensor (3.3 V, I²C ${p.addr || '0x76'})`
    case 'raspi40':
      return 'Raspberry Pi (40-pin GPIO header)'
    case 'esp32devkit':
      return 'ESP32 DevKitC (38-pin)'
    case 'custom':
      return `${item.label} (custom board, ${item.pins.length}-pin)`
    default:
      return getTemplate(item.kind)?.label || item.kind
  }
}

export function buildSheetMarkdown(sheet) {
  const data = sheet?.data || {}
  const items = data.items || []
  const breadboards = data.breadboards || []
  const { nets, bridges, floating, layouts } = computeNets(data)

  const holesById = {}
  for (const l of layouts) for (const h of l.holes) holesById[h.id] = h

  // endpoint -> net label
  const netByEndpoint = new Map()
  nets.forEach((net) => net.pins.forEach((pp) => netByEndpoint.set(pp.endpointId, net)))

  const holeLabel = (id) => holesById[id]?.label || id
  const pinLoc = (item, pin) => {
    const net = netByEndpoint.get(pinEndpointId(item, pin))
    const where = pin.hole ? `@${holeLabel(pin.hole)}` : net ? '(wired)' : '(unconnected)'
    const onNet = net ? ` → ${net.label}` : ''
    return `${pin.name} ${where}${onNet}`
  }

  const L = []
  L.push(`# Breadboard: ${sheet.name || 'Untitled'}`)
  L.push('')
  const sizes = breadboards.map((b) => BREADBOARDS[b.type]?.label || b.type).join(', ') || '—'
  L.push(`- **Breadboard:** ${sizes}`)
  L.push(`- **Parts:** ${items.length}`)
  L.push(`- **Nets:** ${nets.length}`)
  if (sheet.updated_at) L.push(`- **Updated:** ${fmtDate(sheet.updated_at)}`)
  L.push('')
  L.push('> This document describes a physical breadboard layout. "Nets" are sets of')
  L.push('> points that are electrically connected (via breadboard strips, power rails')
  L.push('> and jumper wires). Pin notation `name@12A` means that pin is plugged into')
  L.push('> breadboard hole column 12, row A.')
  L.push('')

  // ── Boards (standalone) ──
  const boards = items.filter((it) => (it.placement || getTemplate(it.kind)?.placement) === 'standalone')
  if (boards.length) {
    L.push('## Boards')
    L.push('')
    for (const b of boards) {
      L.push(`### ${b.label} — ${describeItem(b)}`)
      const wired = b.pins.filter((pin) => netByEndpoint.has(pinEndpointId(b, pin)))
      if (wired.length) {
        for (const pin of wired) {
          const net = netByEndpoint.get(pinEndpointId(b, pin))
          L.push(`- ${pin.name} → ${net.label}`)
        }
      } else {
        L.push('- _(no pins wired yet)_')
      }
      L.push('')
    }
  }

  // ── Components (inline) ──
  const comps = items.filter((it) => (it.placement || getTemplate(it.kind)?.placement) !== 'standalone')
  if (comps.length) {
    L.push('## Components')
    L.push('')
    for (const it of comps) {
      const legs = it.pins.map((pin) => pinLoc(it, pin)).join(', ')
      L.push(`- **${it.label}** — ${describeItem(it)} — ${legs}`)
    }
    L.push('')
  }

  // ── Nets ──
  L.push('## Nets (electrically connected points)')
  L.push('')
  if (!nets.length) {
    L.push('_No connections yet._')
    L.push('')
  }
  for (const net of nets) {
    const members = []
    for (const pp of net.pins) members.push(`${pp.item.label}.${pp.name}`)
    const holeList = net.holeRefs
      .filter((h) => h.kind === 'main')
      .map((h) => h.label)
      .sort()
    const railList = [...new Set(net.holeRefs.filter((h) => h.kind === 'rail').map((h) => h.label))]
    const loc = [...railList, ...(holeList.length ? [`holes ${holeList.join(', ')}`] : [])].join('; ')
    L.push(`- **${net.id} — ${net.label}**: ${members.join(', ') || '(no parts)'}${loc ? ` · ${loc}` : ''}`)
  }
  L.push('')

  // ── Bridges (what each 2-terminal part connects) ──
  if (bridges.length) {
    L.push('## What components bridge')
    L.push('')
    for (const br of bridges) {
      const spans = br.legs
        .map((l) => (l.netId ? netLabelById(nets, l.netId) : '?'))
        .join(' ↔ ')
      L.push(`- **${br.item.label}** (${describeItem(br.item)}): ${spans}`)
    }
    L.push('')
  }

  // ── Unconnected pins (inline parts only; boards list their wiring above) ──
  const floatingInline = floating.filter(
    (f) => (f.item.placement || getTemplate(f.item.kind)?.placement) !== 'standalone',
  )
  if (floatingInline.length) {
    L.push('## Unconnected pins')
    L.push('')
    for (const f of floatingInline) L.push(`- ${f.item.label}.${f.pin.name}`)
    L.push('')
  }

  L.push(buildSpecSection())

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// ── Build spec ───────────────────────────────────────────────────────────────
// Appended to every export so an assistant can return a layout this app will
// construct automatically (see parseBuild in importBuild.js).
const PROP_HINT = {
  resistor: 'ohms (e.g. 220 or "4.7k")',
  potentiometer: 'ohms',
  led: 'color (red/green/blue/yellow/white/orange)',
  ic: 'pinCount',
}
function specPartLine(kind) {
  const tpl = getTemplate(kind)
  if (!tpl) return null
  if (kind === 'ic') return '- `ic` — pins `1`..`N` — prop `pinCount`'
  const names = tpl.pins.map((p) => p.name.replace(/\s*\(.*?\)/g, '')).join(', ')
  const prop = PROP_HINT[kind] ? ` — prop \`${PROP_HINT[kind]}\`` : ''
  return `- \`${kind}\` — pins: ${names}${prop}`
}

export function buildSpecSection() {
  const L = []
  L.push('---')
  L.push('')
  L.push('## For an AI assistant: design or modify this breadboard')
  L.push('')
  L.push('To have this app build your design automatically, reply with **one fenced ```json')
  L.push('block** containing a `BreadboardBuild` object. Example:')
  L.push('')
  L.push('```json')
  L.push('{')
  L.push('  "breadboard": "half",')
  L.push('  "parts": [')
  L.push('    { "id": "R1", "type": "resistor", "ohms": 330, "pins": { "1": "10B", "2": "15B" } },')
  L.push('    { "id": "LED1", "type": "led", "color": "red", "pins": { "anode": "15D", "cathode": "20D" } },')
  L.push('    { "id": "Pi1", "type": "raspi40" }')
  L.push('  ],')
  L.push('  "wires": [')
  L.push('    { "from": "Pi1:GPIO17", "to": "10A" },')
  L.push('    { "from": "20A", "to": "-T" },')
  L.push('    { "from": "Pi1:GND", "to": "-T" }')
  L.push('  ]')
  L.push('}')
  L.push('```')
  L.push('')
  L.push('**Holes** are `<column><row>`, e.g. `10A`, `30J`. Rows A–E are the top block, F–J the')
  L.push('bottom; within a column A–E form one electrical strip and F–J another. **Power rails:**')
  L.push('`+T`/`-T` (top +/−) and `+B`/`-B` (bottom). **Sizes:** `full` (63 cols), `half` (30), `mini` (17, no rails).')
  L.push('')
  L.push('**Wires** connect two points — each is a hole (`10A`, `-T`) or a board pin')
  L.push('`<id>:<pin>` (e.g. `Pi1:GPIO17`). Components only join nets through shared strips or')
  L.push('wires, so use wires to reach the rails and boards. Give a part `"pins"` to plug its')
  L.push('legs into holes; give a board pins only via wires.')
  L.push('')
  L.push('**Part types** (use these pin names):')
  for (const g of PALETTE_GROUPS) {
    for (const kind of g.kinds) {
      if (kind === 'wire') continue
      if (kind === 'raspi40') { L.push('- `raspi40` — Raspberry Pi 40-pin; wire by GPIO name or pin number (`Pi1:GPIO17`, `Pi1:6`)'); continue }
      if (kind === 'esp32devkit') { L.push('- `esp32devkit` — ESP32 DevKitC; wire by GPIO name (`ESP1:GPIO23`)'); continue }
      if (kind === 'custom') { L.push('- `custom` — your own board: give `"pinNames": ["VCC","GND",…]` (wire by those names)'); continue }
      const line = specPartLine(kind)
      if (line) L.push(line)
    }
  }
  L.push('')
  L.push('Use short unique `id`s (they become part labels). After writing the JSON, paste the')
  L.push('whole reply into the app’s **AI build** dialog.')
  L.push('')
  return L.join('\n')
}

function netLabelById(nets, id) {
  const n = nets.find((x) => x.id === id)
  return n ? `${n.id} ${n.label}` : id
}

// Copy text to the clipboard. Returns a promise<boolean>. Falls back to a hidden
// textarea + execCommand for non-secure contexts (no clipboard util existed yet).
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
