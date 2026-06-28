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
      return `Ceramic capacitor ${p.value || '100nF'}`
    case 'electrolytic_cap':
      return `Electrolytic capacitor ${p.value || '10µF'} (polarised)`
    case 'inductor':
      return `Inductor ${p.value || ''}`.trim()
    case 'fuse':
      return `Fuse ${p.rating || ''}`.trim()
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
    default: {
      const t = getTemplate(item.kind)
      if (t?.custom) {
        const pn = item.props?.partNumber || t.partNumber
        return `${t.label}${pn ? ` (${pn})` : ''} — custom part, ${item.pins.length}-pin`
      }
      return t?.label || item.kind
    }
  }
}

// Build the "what's on the board" portion (header, boards, components, nets,
// bridges, unconnected pins) as an array of lines. Shared by the state-only
// export and the full instruction export.
function buildStateLines(sheet) {
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

  return L
}

const finish = (L) => L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'

// State only — a paste-ready snapshot of how the board is currently wired, with
// no instructions, inventory or build spec. Useful for asking an assistant
// questions about the existing circuit.
export function buildStateMarkdown(sheet) {
  return finish(buildStateLines(sheet))
}

// Full instruction export: board state + parts inventory + AI build spec.
// `inStockOnly` limits the inventory and the listed part types to parts the user
// has marked as in stock, so the assistant designs only with parts on hand.
export function buildSheetMarkdown(sheet, { inStockOnly = false } = {}) {
  const L = buildStateLines(sheet)
  L.push(buildInventorySection(sheet.library, { inStockOnly }))
  L.push(buildSpecSection(sheet.library, { inStockOnly }))
  return finish(L)
}

// ── Parts inventory ──────────────────────────────────────────────────────────
// Tells the assistant which parts the user has configured and which they
// physically have in stock, so a design prefers parts on hand. `library` is
// { parts: [{ kind, label, partNumber, placement, pins:[names], inStock, custom }] }.
export function buildInventorySection(library, { inStockOnly = false } = {}) {
  const parts = library?.parts || []
  if (!parts.length) return ''
  const fmt = (p) => {
    const pn = p.partNumber ? ` [${p.partNumber}]` : ''
    const pins = p.pins?.length ? ` — pins: ${p.pins.join(', ')}` : ''
    const tag = p.placement === 'standalone' ? ' (board)' : ''
    const cust = p.custom ? ' (custom)' : ''
    return `- ${p.label}${pn}${tag}${cust}${pins}`
  }
  const inStock = parts.filter((p) => p.inStock)
  const notStock = parts.filter((p) => !p.inStock)

  const L = []
  L.push('---')
  L.push('')
  L.push('## Parts inventory & library')
  L.push('')
  if (inStockOnly) {
    L.push('These are the parts the user currently has in stock. **Design only with these')
    L.push('parts** — do not use anything not listed here.')
  } else {
    L.push('The user maintains a parts library. **Prefer parts that are in stock.** Parts not')
    L.push('in stock are known/configured but not currently owned — use them only if needed,')
    L.push('and call out anything the user would have to buy.')
  }
  L.push('')
  L.push(`### In stock (${inStock.length})`)
  if (inStock.length) inStock.forEach((p) => L.push(fmt(p)))
  else L.push('_Nothing marked in stock._')
  L.push('')
  if (!inStockOnly && notStock.length) {
    L.push(`### Configured but not in stock (${notStock.length})`)
    notStock.forEach((p) => L.push(fmt(p)))
    L.push('')
  }
  return L.join('\n')
}

// ── Build spec ───────────────────────────────────────────────────────────────
// Appended to every export so an assistant can return a layout this app will
// construct automatically (see parseBuild in importBuild.js).
const PROP_HINT = {
  resistor: 'ohms (e.g. 220 or "4.7k")',
  potentiometer: 'ohms',
  led: 'color (red/green/blue/yellow/white/orange)',
  cap_104: 'value (e.g. "100nF")',
  electrolytic_cap: 'value (e.g. "10µF")',
  inductor: 'value (e.g. "100µH")',
  diode: 'part (e.g. "1N4007")',
  fuse: 'rating (e.g. "500mA")',
  ic: 'pinCount',
}
function specPartLine(kind) {
  const tpl = getTemplate(kind)
  if (!tpl) return null
  if (kind === 'ic') return '- `ic` — pins `1`..`N` — prop `pinCount`'
  const names = tpl.pins.map((p) => p.name.replace(/\s*\(.*?\)/g, '')).join(', ')
  const prop = PROP_HINT[kind] ? ` — prop \`${PROP_HINT[kind]}\`` : ''
  const offBoard = tpl.placement === 'standalone' ? ' — *off-board module, wire to its pins*' : ''
  return `- \`${kind}\` — pins: ${names}${prop}${offBoard}`
}

export function buildSpecSection(library = {}, { inStockOnly = false } = {}) {
  const customParts = library?.customParts || []
  // Kinds the user has in stock (built-in kinds plus `lib_`-prefixed customs).
  const inStockKinds = new Set((library?.parts || []).filter((p) => p.inStock).map((p) => p.kind))
  // `custom` is the board-builder capability, not a physical part — always keep it.
  const keepKind = (kind) => !inStockOnly || kind === 'custom' || inStockKinds.has(kind)
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
  L.push('    { "from": "Pi1:GPIO17", "to": "10A", "color": "#16a34a" },')
  L.push('    { "from": "20A", "to": "-T", "color": "#000000" },')
  L.push('    { "from": "Pi1:5V", "to": "+T", "color": "#dc2626", "arc": -1 }')
  L.push('  ]')
  L.push('}')
  L.push('```')
  L.push('')
  L.push('**Holes** are `<column><row>`, e.g. `10A`, `30J`. Rows A–E are the top block, F–J the')
  L.push('bottom; within a column A–E form one electrical strip and F–J another. **Power rails:**')
  L.push('`+T`/`-T` (top +/−) and `+B`/`-B` (bottom). **Sizes:** `full` (63 cols), `half` (30), `mini` (17, no rails).')
  L.push('')
  L.push('**Wires** connect two points — each is a hole (`10A`, `-T`) or a board/module pin')
  L.push('`<id>:<pin>` (e.g. `Pi1:GPIO17`, `ENV1:SDA`). Components only join nets through shared')
  L.push('strips or wires, so use wires to reach the rails, boards and modules.')
  L.push('')
  L.push('**Inline parts vs off-board modules.** Discrete parts (resistor, LED, diode, TO-92')
  L.push('transistor/sensor, DIP IC, pot…) plug into the grid — give them `"pins"` mapping each')
  L.push('leg to a hole. **Breakout modules** (sensors like BME280, displays, relays, drivers,')
  L.push('radios — any line marked *off-board*) sit beside the board and are reached with jumpers:')
  L.push('reference their pins from `"wires"`, or map a module pin straight to a hole in `"pins"`')
  L.push('(it becomes a jumper automatically). Standalone boards (Pi/ESP32) work the same way.')
  L.push('')
  L.push('**Wire colors** — set `"color"` (hex). Follow this convention so the board reads')
  L.push('clearly:')
  L.push('- `#dc2626` **RED** → positive power only (5V / 3.3V / VCC).')
  L.push('- `#000000` **BLACK** → ground / − (GND, the `-T`/`-B` rails).')
  L.push('- Give **each component or sensor its own distinct color** for its signal/logic wiring,')
  L.push('  chosen from: `#16a34a` green, `#2563eb` blue, `#f59e0b` amber, `#9333ea` purple')
  L.push('  (reuse a color only after these run out). Never use red/black for signal wires.')
  L.push('')
  L.push('**Wire arc** — each wire draws as an arc. `"arc": 1` bends one way (default); `"arc": -1`')
  L.push('bends it the opposite way. Use `-1` to route a wire around others and keep a crowded')
  L.push('board uncluttered — e.g. alternate arcs for wires that share endpoints or cross.')
  L.push('')
  L.push('**Part types** (use these pin names):')
  for (const g of PALETTE_GROUPS) {
    for (const kind of g.kinds) {
      if (kind === 'wire') continue
      if (!keepKind(kind)) continue
      if (kind === 'raspi40') { L.push('- `raspi40` — Raspberry Pi 40-pin; wire by GPIO name or pin number (`Pi1:GPIO17`, `Pi1:6`)'); continue }
      if (kind === 'esp32devkit') { L.push('- `esp32devkit` — ESP32 DevKitC; wire by GPIO name (`ESP1:GPIO23`)'); continue }
      if (kind === 'custom') { L.push('- `custom` — your own board: give `"pinNames": ["VCC","GND",…]` (wire by those names)'); continue }
      const line = specPartLine(kind)
      if (line) L.push(line)
    }
  }
  const customsToList = customParts.filter((p) => keepKind(p.kind))
  if (customsToList.length) {
    L.push('')
    L.push('**Custom library parts** (use the `type` shown; pin names as listed):')
    for (const p of customsToList) {
      const type = String(p.kind || '').replace(/^lib_/, '')
      const names = (p.pins || []).join(', ')
      const tag = p.placement === 'standalone' ? ' (standalone board — wire to its pins)' : ''
      const pn = p.partNumber ? ` [${p.partNumber}]` : ''
      L.push(`- \`${type}\`${pn} — ${p.label} — pins: ${names}${tag}`)
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
