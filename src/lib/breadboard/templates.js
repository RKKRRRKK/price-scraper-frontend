// Pure-data definitions for the Breadboard tool. Consumed by the SVG renderer
// (ComponentSprite / BreadboardSurface), the geometry helpers, the net engine
// and the markdown exporter. No Vue / DOM here — just data + small helpers.

import { v4 as uuid } from 'uuid'

// ── Resistor colour code ─────────────────────────────────────────────────────
// name + hex for each band colour. Hex is tuned to read well on the cream body.
export const BAND_COLORS = {
  black: '#23262b',
  brown: '#7c4a24',
  red: '#e23b2e',
  orange: '#f0810f',
  yellow: '#f3c91d',
  green: '#2fae57',
  blue: '#2f6fdb',
  violet: '#8a4fd0',
  grey: '#9aa0a6',
  white: '#eceff3',
  gold: '#c9a23b',
  silver: '#b8bcc2',
}

const DIGIT_COLORS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white']
// multiplier exponent (10^n) → colour, for n in -2..9
const MULT_COLORS = {
  '-2': 'silver', '-1': 'gold', 0: 'black', 1: 'brown', 2: 'red', 3: 'orange',
  4: 'yellow', 5: 'green', 6: 'blue', 7: 'violet', 8: 'grey', 9: 'white',
}

// Ohms → array of 4 band colour names (2 significant figures + multiplier + 5% gold tolerance).
export function valueToBands(ohms) {
  const v = Number(ohms)
  if (!Number.isFinite(v) || v <= 0) return ['black', 'black', 'black', 'gold']
  const exp = Math.floor(Math.log10(v))
  let sig = Math.round(v / Math.pow(10, exp - 1)) // 10..99 (two significant figures)
  let multExp = exp - 1
  if (sig >= 100) { sig = Math.round(sig / 10); multExp += 1 }
  const d1 = Math.floor(sig / 10)
  const d2 = sig % 10
  const mult = MULT_COLORS[String(multExp)] || 'black'
  return [DIGIT_COLORS[d1], DIGIT_COLORS[d2], mult, 'gold']
}

// Human-readable resistance, e.g. 220 → "220 Ω", 4700 → "4.7 kΩ", 1000000 → "1 MΩ".
export function formatOhms(ohms) {
  const v = Number(ohms)
  if (!Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1e6) return trimNum(v / 1e6) + ' MΩ'
  if (v >= 1e3) return trimNum(v / 1e3) + ' kΩ'
  return trimNum(v) + ' Ω'
}
function trimNum(n) {
  return String(Number(n.toFixed(2)))
}

// ── Breadboard sizes ─────────────────────────────────────────────────────────
// rows are the 10 main rows (A–E top half, F–J bottom half). `rails` boards have
// + / − power rails top and bottom; `railSegments` = how many independent
// segments each rail is split into (full boards split in the middle).
export const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

export const BREADBOARDS = {
  full: { type: 'full', label: 'Full+ (830 pts)', cols: 63, rows: ROWS, rails: true, railSegments: 2 },
  half: { type: 'half', label: 'Half+ (400 pts)', cols: 30, rows: ROWS, rails: true, railSegments: 1 },
  mini: { type: 'mini', label: 'Mini (170 pts)', cols: 17, rows: ROWS, rails: false, railSegments: 1 },
}
export const BREADBOARD_LIST = Object.values(BREADBOARDS)

// ── Component / module templates ─────────────────────────────────────────────
// placement: 'inline'  = legs/pins drop into breadboard holes (snap on place/drag)
//            'standalone' = sits beside the board; pins are wire endpoints (boards)
// pins: ordered list of { id, name }. For inline 2-leg parts the first pin is the
// anchor and `span` is the default hole distance to the next pin.
function comp(t) {
  return { group: 'core', placement: 'inline', polar: false, span: 4, defaultProps: {}, ...t }
}

export const COMPONENTS = {
  resistor: comp({
    kind: 'resistor', label: 'Resistor', group: 'core', icon: 'pi pi-minus',
    pins: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }],
    span: 5, defaultProps: { ohms: 220 },
    body: 'resistor',
  }),
  led: comp({
    kind: 'led', label: 'LED', group: 'core', polar: true, icon: 'pi pi-circle-fill',
    pins: [{ id: 'a', name: 'anode (+)' }, { id: 'k', name: 'cathode (−)' }],
    span: 2, defaultProps: { color: 'red' },
    body: 'led',
  }),
  cap_104: comp({
    kind: 'cap_104', label: 'Ceramic cap 100nF (104)', group: 'core',
    pins: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }],
    span: 2, defaultProps: { value: '100nF', code: '104' },
    body: 'ceramic-cap',
  }),
  button: comp({
    kind: 'button', label: 'Push-button', group: 'core', icon: 'pi pi-stop',
    pins: [{ id: 's1', name: 'side 1' }, { id: 's2', name: 'side 2' }],
    span: 5, body: 'button',
  }),
  wire: comp({
    kind: 'wire', label: 'Jumper wire', group: 'core', icon: 'pi pi-link',
    pins: [], body: 'wire', isWire: true,
  }),

  // ── Active devices ──
  diode: comp({
    kind: 'diode', label: 'Diode', group: 'active', polar: true,
    pins: [{ id: 'a', name: 'anode (+)' }, { id: 'k', name: 'cathode (−)' }],
    span: 3, defaultProps: { part: '1N4148' }, body: 'diode',
  }),
  transistor: comp({
    kind: 'transistor', label: 'Transistor (TO-92)', group: 'active',
    pins: [{ id: 'e', name: 'E' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    span: 1, defaultProps: { part: '2N2222' }, body: 'to92',
  }),
  potentiometer: comp({
    kind: 'potentiometer', label: 'Potentiometer', group: 'active',
    pins: [{ id: '1', name: '1' }, { id: 'w', name: 'wiper' }, { id: '3', name: '3' }],
    span: 2, defaultProps: { ohms: 10000 }, body: 'pot',
  }),
  ic: comp({
    kind: 'ic', label: 'IC / DIP chip', group: 'active',
    pins: [], // generated from pinCount
    defaultProps: { pinCount: 8, part: '' }, body: 'dip', straddle: true,
  }),

  // ── User's go-to parts ──
  ir_led_tsal6400: comp({
    kind: 'ir_led_tsal6400', label: 'TSAL6400 IR emitter', group: 'mine', polar: true,
    pins: [{ id: 'a', name: 'anode (+)' }, { id: 'k', name: 'cathode (−)' }],
    span: 2, defaultProps: { wavelength: '940nm' }, body: 'led', irEmitter: true,
  }),
  tsop38238: comp({
    kind: 'tsop38238', label: 'TSOP38238 IR receiver', group: 'mine',
    pins: [{ id: 'out', name: 'OUT' }, { id: 'gnd', name: 'GND' }, { id: 'vs', name: 'VS' }],
    span: 1, body: 'irrx',
  }),
  ds18b20: comp({
    kind: 'ds18b20', label: 'DS18B20 (TO-92)', group: 'mine',
    pins: [{ id: 'gnd', name: 'GND' }, { id: 'dq', name: 'DQ' }, { id: 'vdd', name: 'VDD' }],
    span: 1, defaultProps: { iface: '1-Wire' }, body: 'to92',
  }),
  veml7700: comp({
    kind: 'veml7700', label: 'VEML7700 light sensor', group: 'mine',
    pins: [
      { id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
      { id: 'scl', name: 'SCL' }, { id: 'sda', name: 'SDA' }, { id: 'int', name: 'INT' },
    ],
    span: 1, defaultProps: { iface: 'I²C', addr: '0x10' }, body: 'breakout', accent: '#1e8f6e',
  }),
  bme280: comp({
    kind: 'bme280', label: 'BME280 3.3V', group: 'mine',
    pins: [
      { id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
      { id: 'scl', name: 'SCL' }, { id: 'sda', name: 'SDA' },
      { id: 'csb', name: 'CSB' }, { id: 'sdo', name: 'SDO' },
    ],
    span: 1, defaultProps: { iface: 'I²C/SPI', addr: '0x76' }, body: 'breakout', accent: '#5a4fb0',
  }),
}

export const COMPONENT_LIST = Object.values(COMPONENTS)

// ── Board templates (standalone — wired to the breadboard) ───────────────────
// Pi physical-pin map. side 'L' = odd pins (1,3,5…), 'R' = even pins (2,4,6…).
function piPins() {
  const map = [
    '3V3', '5V', 'GPIO2 (SDA1)', '5V', 'GPIO3 (SCL1)', 'GND', 'GPIO4', 'GPIO14 (TXD)',
    'GND', 'GPIO15 (RXD)', 'GPIO17', 'GPIO18 (PWM)', 'GPIO27', 'GND', 'GPIO22', 'GPIO23',
    '3V3', 'GPIO24', 'GPIO10 (MOSI)', 'GND', 'GPIO9 (MISO)', 'GPIO25', 'GPIO11 (SCLK)', 'GPIO8 (CE0)',
    'GND', 'GPIO7 (CE1)', 'GPIO0 (ID_SD)', 'GPIO1 (ID_SC)', 'GPIO5', 'GND', 'GPIO6', 'GPIO12',
    'GPIO13', 'GND', 'GPIO19', 'GPIO16', 'GPIO26', 'GPIO20', 'GND', 'GPIO21',
  ]
  return map.map((name, i) => ({
    id: String(i + 1), name, side: i % 2 === 0 ? 'L' : 'R', order: Math.floor(i / 2),
  }))
}

// ESP32 DevKitC 38-pin, left column top→bottom then right column top→bottom.
function esp32Pins() {
  const left = ['3V3', 'EN', 'GPIO36 (VP)', 'GPIO39 (VN)', 'GPIO34', 'GPIO35', 'GPIO32', 'GPIO33',
    'GPIO25', 'GPIO26', 'GPIO27', 'GPIO14', 'GPIO12', 'GND', 'GPIO13', 'GPIO9', 'GPIO10', 'GPIO11', '5V']
  const right = ['GND', 'GPIO23', 'GPIO22', 'GPIO1 (TX0)', 'GPIO3 (RX0)', 'GPIO21', 'GND', 'GPIO19',
    'GPIO18', 'GPIO5', 'GPIO17 (TX2)', 'GPIO16 (RX2)', 'GPIO4', 'GPIO0', 'GPIO2', 'GPIO15', 'GPIO8', 'GPIO7', 'GPIO6']
  const pins = []
  left.forEach((name, i) => pins.push({ id: `L${i + 1}`, name, side: 'L', order: i }))
  right.forEach((name, i) => pins.push({ id: `R${i + 1}`, name, side: 'R', order: i }))
  return pins
}

export const BOARDS = {
  raspi40: {
    kind: 'raspi40', label: 'Raspberry Pi (40-pin)', group: 'boards', placement: 'standalone',
    accent: '#2bb673', board: '#0b5d3a', pins: piPins(), rows: 20,
  },
  esp32devkit: {
    kind: 'esp32devkit', label: 'ESP32 DevKitC (38-pin)', group: 'boards', placement: 'standalone',
    accent: '#d34b3b', board: '#222831', pins: esp32Pins(), rows: 19,
  },
}
export const BOARD_LIST = Object.values(BOARDS)

// ── Palette grouping for the UI ──────────────────────────────────────────────
export const PALETTE_GROUPS = [
  { id: 'core', label: 'Core', kinds: ['resistor', 'led', 'cap_104', 'button', 'wire'] },
  { id: 'active', label: 'Active devices', kinds: ['diode', 'transistor', 'potentiometer', 'ic'] },
  { id: 'mine', label: 'My parts', kinds: ['ir_led_tsal6400', 'tsop38238', 'ds18b20', 'veml7700', 'bme280'] },
  { id: 'boards', label: 'Boards', kinds: ['raspi40', 'esp32devkit', 'custom'] },
]

// ── Lookup + item factory ────────────────────────────────────────────────────
export function getTemplate(kind) {
  return COMPONENTS[kind] || BOARDS[kind] || null
}

function icPins(count) {
  const pins = []
  for (let i = 1; i <= count; i++) pins.push({ id: String(i), name: String(i) })
  return pins
}

// Build a fresh placed-item object. `extra` lets the caller seed props/pins
// (used by the custom-board builder).
export function makeItem(kind, { x = 0, y = 0, props = {}, label, customPins, customBoard } = {}) {
  if (kind === 'custom') {
    const pins = (customPins || []).map((p, i) => ({
      id: p.id || `p${i + 1}`, name: p.name || `pin ${i + 1}`,
      side: p.side || (i % 2 === 0 ? 'L' : 'R'),
      order: p.order ?? Math.floor(i / 2),
      hole: null,
    }))
    return {
      id: uuid(), kind: 'custom', label: label || customBoard?.name || 'Custom board',
      x, y, rotation: 0, placement: 'standalone',
      props: { accent: '#6b7280', board: '#374151', rows: Math.ceil(pins.length / 2), ...props },
      pins,
    }
  }

  const tpl = getTemplate(kind)
  if (!tpl) throw new Error(`Unknown template kind: ${kind}`)

  let pins
  if (kind === 'ic') {
    pins = icPins((props.pinCount ?? tpl.defaultProps.pinCount) || 8)
  } else {
    pins = tpl.pins.map((p) => ({ ...p }))
  }
  pins = pins.map((p) => ({ ...p, hole: null }))

  return {
    id: uuid(),
    kind,
    label: label || autoLabel(kind),
    x, y, rotation: 0,
    placement: tpl.placement,
    props: { ...tpl.defaultProps, ...props },
    pins,
  }
}

const LABEL_PREFIX = {
  resistor: 'R', led: 'LED', cap_104: 'C', button: 'SW', diode: 'D',
  transistor: 'Q', potentiometer: 'POT', ic: 'U', ir_led_tsal6400: 'IR',
  tsop38238: 'RX', ds18b20: 'TEMP', veml7700: 'LUX', bme280: 'ENV',
  raspi40: 'Pi', esp32devkit: 'ESP', custom: 'BRD',
}
let labelCounters = {}
function autoLabel(kind) {
  labelCounters[kind] = (labelCounters[kind] || 0) + 1
  return `${LABEL_PREFIX[kind] || 'X'}${labelCounters[kind]}`
}
// Reset counters when loading a sheet so labels feel fresh per session view.
export function resetLabelCounters(items = []) {
  labelCounters = {}
  for (const it of items) {
    const pref = LABEL_PREFIX[it.kind]
    if (!pref || !it.label) continue
    const m = String(it.label).match(new RegExp(`^${pref}(\\d+)$`))
    if (m) labelCounters[it.kind] = Math.max(labelCounters[it.kind] || 0, Number(m[1]))
  }
}
