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
  return { group: 'core', placement: 'inline', polar: false, span: 4, defaultProps: {}, icon: 'circuit_board_general.svg', ...t }
}
// Breakout/module helper: pins sit in a single row, plugs in inline.
function mod(t) {
  return comp({ body: 'breakout', span: 1, ...t })
}
// DIP chip helper: straddles the ravine, pins down both sides.
function dip(t) {
  return comp({ body: 'dip', straddle: true, span: 1, group: 'ics', icon: 'microchip.svg', ...t })
}
function pinsFrom(names) {
  return names.map((n, i) => ({ id: String(n).toLowerCase().replace(/[^a-z0-9]+/g, '') || `p${i + 1}`, name: n }))
}

export const COMPONENTS = {
  resistor: comp({
    kind: 'resistor', label: 'Resistor', group: 'core', icon: 'resistor.svg',
    pins: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }],
    span: 5, defaultProps: { ohms: 220 },
    body: 'resistor',
  }),
  led: comp({
    kind: 'led', label: 'LED', group: 'core', polar: true, icon: 'led_display.svg',
    pins: [{ id: 'a', name: 'anode (+)' }, { id: 'k', name: 'cathode (−)' }],
    span: 2, defaultProps: { color: 'red' },
    body: 'led',
  }),
  cap_104: comp({
    kind: 'cap_104', label: 'Ceramic cap 100nF (104)', group: 'core', icon: 'resistor.svg',
    pins: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }],
    span: 2, defaultProps: { value: '100nF', code: '104' },
    body: 'ceramic-cap',
  }),
  button: comp({
    kind: 'button', label: 'Push-button', group: 'core', icon: 'push_button.svg',
    pins: [{ id: 's1', name: 'side 1' }, { id: 's2', name: 'side 2' }],
    span: 5, body: 'button',
  }),
  wire: comp({
    kind: 'wire', label: 'Jumper wire', group: 'core', icon: 'electric_wire.svg',
    pins: [], body: 'wire', isWire: true,
  }),

  // ── Active devices ──
  diode: comp({
    kind: 'diode', label: 'Diode', group: 'active', polar: true, icon: 'diode.svg',
    pins: [{ id: 'a', name: 'anode (+)' }, { id: 'k', name: 'cathode (−)' }],
    span: 3, defaultProps: { part: '1N4148' }, body: 'diode',
  }),
  transistor: comp({
    kind: 'transistor', label: 'Transistor (TO-92)', group: 'active', icon: 'transistor.svg',
    pins: [{ id: 'e', name: 'E' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    span: 1, defaultProps: { part: '2N2222' }, body: 'to92',
  }),
  potentiometer: comp({
    kind: 'potentiometer', label: 'Potentiometer', group: 'active', icon: 'dial_knob.svg',
    pins: [{ id: '1', name: '1' }, { id: 'w', name: 'wiper' }, { id: '3', name: '3' }],
    span: 2, defaultProps: { ohms: 10000 }, body: 'pot',
  }),
  ic: comp({
    kind: 'ic', label: 'IC / DIP chip', group: 'active', icon: 'microchip.svg',
    pins: [], // generated from pinCount
    defaultProps: { pinCount: 8, part: '' }, body: 'dip', straddle: true,
  }),

  // ── User's go-to parts ──
  ir_led_tsal6400: comp({
    kind: 'ir_led_tsal6400', label: 'TSAL6400 IR emitter', group: 'mine', polar: true, icon: 'led_display.svg',
    pins: [{ id: 'a', name: 'anode (+)' }, { id: 'k', name: 'cathode (−)' }],
    span: 2, defaultProps: { wavelength: '940nm' }, body: 'led', irEmitter: true,
  }),
  tsop38238: comp({
    kind: 'tsop38238', label: 'TSOP38238 IR receiver', group: 'mine', icon: 'light_sensor.svg',
    pins: [{ id: 'out', name: 'OUT' }, { id: 'gnd', name: 'GND' }, { id: 'vs', name: 'VS' }],
    span: 1, body: 'irrx',
  }),
  ds18b20: comp({
    kind: 'ds18b20', label: 'DS18B20 (TO-92)', group: 'mine', icon: 'environment_sensor.svg',
    pins: [{ id: 'gnd', name: 'GND' }, { id: 'dq', name: 'DQ' }, { id: 'vdd', name: 'VDD' }],
    span: 1, defaultProps: { iface: '1-Wire' }, body: 'to92',
  }),
  veml7700: comp({
    kind: 'veml7700', label: 'VEML7700 light sensor', group: 'mine', icon: 'light_sensor.svg',
    pins: [
      { id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
      { id: 'scl', name: 'SCL' }, { id: 'sda', name: 'SDA' }, { id: 'int', name: 'INT' },
    ],
    span: 1, defaultProps: { iface: 'I²C', addr: '0x10' }, body: 'breakout', accent: '#1e8f6e',
  }),
  bme280: comp({
    kind: 'bme280', label: 'BME280 3.3V', group: 'mine', icon: 'environment_sensor.svg',
    pins: [
      { id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
      { id: 'scl', name: 'SCL' }, { id: 'sda', name: 'SDA' },
      { id: 'csb', name: 'CSB' }, { id: 'sdo', name: 'SDO' },
    ],
    span: 1, defaultProps: { iface: 'I²C/SPI', addr: '0x76' }, body: 'breakout', accent: '#5a4fb0',
  }),

  // ── Semiconductors & ICs ──
  ne555: dip({
    kind: 'ne555', label: 'NE555 timer', partNumber: 'NE555', labelPrefix: 'U',
    pins: pinsFrom(['GND', 'TRIG', 'OUT', 'RST', 'CTRL', 'THR', 'DIS', 'VCC']),
  }),
  lm358: dip({
    kind: 'lm358', label: 'LM358 dual op-amp', partNumber: 'LM358', labelPrefix: 'U',
    pins: pinsFrom(['OUT1', 'IN1-', 'IN1+', 'GND', 'IN2+', 'IN2-', 'OUT2', 'VCC']),
  }),
  lm324: dip({
    kind: 'lm324', label: 'LM324 quad op-amp', partNumber: 'LM324', labelPrefix: 'U',
    pins: pinsFrom(['OUT1', 'IN1-', 'IN1+', 'VCC', 'IN2+', 'IN2-', 'OUT2', 'OUT3', 'IN3-', 'IN3+', 'GND', 'IN4+', 'IN4-', 'OUT4']),
  }),
  lm393: dip({
    kind: 'lm393', label: 'LM393 comparator', partNumber: 'LM393', labelPrefix: 'U',
    pins: pinsFrom(['OUT1', 'IN1-', 'IN1+', 'GND', 'IN2+', 'IN2-', 'OUT2', 'VCC']),
  }),
  hc595: dip({
    kind: 'hc595', label: '74HC595 shift register', partNumber: '74HC595', labelPrefix: 'U',
    pins: pinsFrom(['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'GND', 'Q7S', 'MR', 'SHCP', 'STCP', 'OE', 'DS', 'Q0', 'VCC']),
  }),
  hc04: dip({
    kind: 'hc04', label: '74HC04 hex inverter', partNumber: '74HC04', labelPrefix: 'U',
    pins: pinsFrom(['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC']),
  }),
  hc08: dip({
    kind: 'hc08', label: '74HC08 quad AND', partNumber: '74HC08', labelPrefix: 'U',
    pins: pinsFrom(['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC']),
  }),
  hc32: dip({
    kind: 'hc32', label: '74HC32 quad OR', partNumber: '74HC32', labelPrefix: 'U',
    pins: pinsFrom(['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC']),
  }),
  mcp23017: dip({
    kind: 'mcp23017', label: 'MCP23017 I/O expander', partNumber: 'MCP23017', labelPrefix: 'U',
    pins: pinsFrom(['GPB0', 'GPB1', 'GPB2', 'GPB3', 'GPB4', 'GPB5', 'GPB6', 'GPB7', 'VDD', 'VSS', 'NC', 'SCL', 'SDA', 'NC2', 'A0', 'A1', 'A2', 'RST', 'INTB', 'INTA', 'GPA0', 'GPA1', 'GPA2', 'GPA3', 'GPA4', 'GPA5', 'GPA6', 'GPA7']),
    defaultProps: { iface: 'I²C' },
  }),
  pcf8574: dip({
    kind: 'pcf8574', label: 'PCF8574 I/O expander', partNumber: 'PCF8574', labelPrefix: 'U',
    pins: pinsFrom(['A0', 'A1', 'A2', 'P0', 'P1', 'P2', 'P3', 'VSS', 'P4', 'P5', 'P6', 'P7', 'INT', 'SCL', 'SDA', 'VDD']),
    defaultProps: { iface: 'I²C' },
  }),
  mcp3008: dip({
    kind: 'mcp3008', label: 'MCP3008 8-ch ADC', partNumber: 'MCP3008', labelPrefix: 'U',
    pins: pinsFrom(['CH0', 'CH1', 'CH2', 'CH3', 'CH4', 'CH5', 'CH6', 'CH7', 'DGND', 'CS', 'DIN', 'DOUT', 'CLK', 'AGND', 'VREF', 'VDD']),
    defaultProps: { iface: 'SPI' },
  }),
  ads1115: mod({
    kind: 'ads1115', label: 'ADS1115 16-bit ADC', group: 'ics', icon: 'microchip.svg', labelPrefix: 'ADC',
    partNumber: 'ADS1115', accent: '#475569',
    pins: pinsFrom(['VDD', 'GND', 'SCL', 'SDA', 'ADDR', 'ALRT', 'A0', 'A1', 'A2', 'A3']),
    defaultProps: { iface: 'I²C', addr: '0x48' },
  }),
  ds3231: mod({
    kind: 'ds3231', label: 'DS3231 RTC', group: 'ics', icon: 'microchip.svg', labelPrefix: 'RTC',
    partNumber: 'DS3231', accent: '#475569',
    pins: pinsFrom(['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND']),
    defaultProps: { iface: 'I²C', addr: '0x68' },
  }),
  pc817: dip({
    kind: 'pc817', label: 'PC817 optocoupler', partNumber: 'PC817', labelPrefix: 'U',
    pins: pinsFrom(['anode', 'cathode', 'emitter', 'collector']),
  }),
  mosfet_irlz44n: comp({
    kind: 'mosfet_irlz44n', label: 'IRLZ44N N-MOSFET', group: 'ics', icon: 'transistor.svg', labelPrefix: 'Q',
    partNumber: 'IRLZ44N', body: 'to92', span: 1,
    pins: [{ id: 'g', name: 'G' }, { id: 'd', name: 'D' }, { id: 's', name: 'S' }],
  }),
  lm7805: comp({
    kind: 'lm7805', label: 'LM7805 5V regulator', group: 'ics', icon: 'power_supply_plug.svg', labelPrefix: 'VR',
    partNumber: 'LM7805', body: 'to92', span: 1,
    pins: [{ id: 'in', name: 'IN' }, { id: 'gnd', name: 'GND' }, { id: 'out', name: 'OUT' }],
  }),
  ams1117: mod({
    kind: 'ams1117', label: 'AMS1117-3.3 regulator', group: 'ics', icon: 'power_supply_plug.svg', labelPrefix: 'VR',
    partNumber: 'AMS1117-3.3', accent: '#475569',
    pins: pinsFrom(['VIN', 'GND', 'VOUT']),
  }),

  // ── Environment sensors ──
  dht22: mod({
    kind: 'dht22', label: 'DHT22 temp/humidity', group: 'env', icon: 'environment_sensor.svg', labelPrefix: 'SENS',
    partNumber: 'DHT22', accent: '#1e8f6e',
    pins: pinsFrom(['VCC', 'DATA', 'NC', 'GND']),
  }),
  sht31: mod({
    kind: 'sht31', label: 'SHT31 temp/humidity', group: 'env', icon: 'environment_sensor.svg', labelPrefix: 'SENS',
    partNumber: 'SHT31', accent: '#1e8f6e',
    pins: pinsFrom(['VIN', 'GND', 'SCL', 'SDA']),
    defaultProps: { iface: 'I²C', addr: '0x44' },
  }),
  aht20: mod({
    kind: 'aht20', label: 'AHT20 temp/humidity', group: 'env', icon: 'environment_sensor.svg', labelPrefix: 'SENS',
    partNumber: 'AHT20', accent: '#1e8f6e',
    pins: pinsFrom(['VIN', 'GND', 'SCL', 'SDA']),
    defaultProps: { iface: 'I²C', addr: '0x38' },
  }),
  bmp280: mod({
    kind: 'bmp280', label: 'BMP280 pressure', group: 'env', icon: 'environment_sensor.svg', labelPrefix: 'SENS',
    partNumber: 'BMP280', accent: '#5a4fb0',
    pins: pinsFrom(['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO']),
    defaultProps: { iface: 'I²C/SPI', addr: '0x76' },
  }),
  bme680: mod({
    kind: 'bme680', label: 'BME680 air quality', group: 'env', icon: 'environment_sensor.svg', labelPrefix: 'SENS',
    partNumber: 'BME680', accent: '#5a4fb0',
    pins: pinsFrom(['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO']),
    defaultProps: { iface: 'I²C/SPI', addr: '0x76' },
  }),
  mq2: mod({
    kind: 'mq2', label: 'MQ-2 gas sensor', group: 'env', icon: 'environment_sensor.svg', labelPrefix: 'GAS',
    partNumber: 'MQ-2', accent: '#b45309',
    pins: pinsFrom(['VCC', 'GND', 'DO', 'AO']),
  }),
  mq135: mod({
    kind: 'mq135', label: 'MQ-135 air quality', group: 'env', icon: 'environment_sensor.svg', labelPrefix: 'GAS',
    partNumber: 'MQ-135', accent: '#b45309',
    pins: pinsFrom(['VCC', 'GND', 'DO', 'AO']),
  }),
  soil_moisture: mod({
    kind: 'soil_moisture', label: 'Soil moisture sensor', group: 'env', icon: 'environment_sensor.svg', labelPrefix: 'SENS',
    accent: '#1e8f6e',
    pins: pinsFrom(['VCC', 'GND', 'AO', 'DO']),
  }),

  // ── Spatial & motion ──
  hc_sr04: mod({
    kind: 'hc_sr04', label: 'HC-SR04 ultrasonic', group: 'motion', icon: 'radar_distance_waves.svg', labelPrefix: 'DIST',
    partNumber: 'HC-SR04', accent: '#2563eb',
    pins: pinsFrom(['VCC', 'TRIG', 'ECHO', 'GND']),
  }),
  vl53l0x: mod({
    kind: 'vl53l0x', label: 'VL53L0X ToF distance', group: 'motion', icon: 'radar_distance_waves.svg', labelPrefix: 'DIST',
    partNumber: 'VL53L0X', accent: '#2563eb',
    pins: pinsFrom(['VIN', 'GND', 'SCL', 'SDA', 'GPIO1', 'XSHUT']),
    defaultProps: { iface: 'I²C', addr: '0x29' },
  }),
  pir_hcsr501: mod({
    kind: 'pir_hcsr501', label: 'PIR motion (HC-SR501)', group: 'motion', icon: 'radar_distance_waves.svg', labelPrefix: 'PIR',
    partNumber: 'HC-SR501', accent: '#2563eb',
    pins: pinsFrom(['VCC', 'OUT', 'GND']),
  }),
  mpu6050: mod({
    kind: 'mpu6050', label: 'MPU6050 IMU', group: 'motion', icon: 'radar_distance_waves.svg', labelPrefix: 'IMU',
    partNumber: 'MPU6050', accent: '#2563eb',
    pins: pinsFrom(['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT']),
    defaultProps: { iface: 'I²C', addr: '0x68' },
  }),

  // ── Optical & bio sensors ──
  ldr: comp({
    kind: 'ldr', label: 'LDR photoresistor', group: 'optical', icon: 'light_sensor.svg', labelPrefix: 'LDR',
    body: 'resistor', span: 3,
    pins: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }],
  }),
  tsl2591: mod({
    kind: 'tsl2591', label: 'TSL2591 light sensor', group: 'optical', icon: 'light_sensor.svg', labelPrefix: 'LUX',
    partNumber: 'TSL2591', accent: '#1e8f6e',
    pins: pinsFrom(['VIN', 'GND', 'SCL', 'SDA', 'INT']),
    defaultProps: { iface: 'I²C', addr: '0x29' },
  }),
  tcs34725: mod({
    kind: 'tcs34725', label: 'TCS34725 colour sensor', group: 'optical', icon: 'light_sensor.svg', labelPrefix: 'COL',
    partNumber: 'TCS34725', accent: '#1e8f6e',
    pins: pinsFrom(['VIN', 'GND', 'SCL', 'SDA', 'INT', 'LED']),
    defaultProps: { iface: 'I²C', addr: '0x29' },
  }),
  max30102: mod({
    kind: 'max30102', label: 'MAX30102 heart rate', group: 'optical', icon: 'heart_soundwave.svg', labelPrefix: 'BIO',
    partNumber: 'MAX30102', accent: '#e11d48',
    pins: pinsFrom(['VIN', 'GND', 'SCL', 'SDA', 'INT', 'IRD', 'RD']),
    defaultProps: { iface: 'I²C', addr: '0x57' },
  }),
  hx711: mod({
    kind: 'hx711', label: 'HX711 load cell amp', group: 'optical', icon: 'heart_soundwave.svg', labelPrefix: 'AMP',
    partNumber: 'HX711', accent: '#475569',
    pins: pinsFrom(['VCC', 'GND', 'DT', 'SCK', 'E+', 'E-', 'A+', 'A-']),
  }),
  max4466: mod({
    kind: 'max4466', label: 'MAX4466 microphone', group: 'optical', icon: 'heart_soundwave.svg', labelPrefix: 'MIC',
    partNumber: 'MAX4466', accent: '#475569',
    pins: pinsFrom(['VCC', 'GND', 'OUT']),
  }),
  rc522: mod({
    kind: 'rc522', label: 'RC522 RFID reader', group: 'optical', icon: 'rfid_card.svg', labelPrefix: 'RFID',
    partNumber: 'RC522', accent: '#0ea5e9',
    pins: pinsFrom(['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3V3']),
    defaultProps: { iface: 'SPI' },
  }),
  pn532: mod({
    kind: 'pn532', label: 'PN532 NFC reader', group: 'optical', icon: 'rfid_card.svg', labelPrefix: 'NFC',
    partNumber: 'PN532', accent: '#0ea5e9',
    pins: pinsFrom(['VCC', 'GND', 'SDA', 'SCL']),
    defaultProps: { iface: 'I²C' },
  }),

  // ── Displays & indicators ──
  ssd1306: mod({
    kind: 'ssd1306', label: 'SSD1306 OLED', group: 'displays', icon: 'led_display.svg', labelPrefix: 'DISP',
    partNumber: 'SSD1306', accent: '#1f2937',
    pins: pinsFrom(['GND', 'VCC', 'SCL', 'SDA']),
    defaultProps: { iface: 'I²C', addr: '0x3C' },
  }),
  lcd1602: mod({
    kind: 'lcd1602', label: 'LCD 16×2 (I²C)', group: 'displays', icon: 'led_display.svg', labelPrefix: 'DISP',
    partNumber: '1602A', accent: '#1f2937',
    pins: pinsFrom(['GND', 'VCC', 'SDA', 'SCL']),
    defaultProps: { iface: 'I²C', addr: '0x27' },
  }),
  ws2812b: mod({
    kind: 'ws2812b', label: 'WS2812B NeoPixel', group: 'displays', icon: 'led_display.svg', labelPrefix: 'LED',
    partNumber: 'WS2812B', accent: '#8b5cf6',
    pins: pinsFrom(['VCC', 'DIN', 'GND']),
  }),
  max7219: mod({
    kind: 'max7219', label: 'MAX7219 LED matrix', group: 'displays', icon: 'led_display.svg', labelPrefix: 'DISP',
    partNumber: 'MAX7219', accent: '#1f2937',
    pins: pinsFrom(['VCC', 'GND', 'DIN', 'CS', 'CLK']),
    defaultProps: { iface: 'SPI' },
  }),
  seg7: dip({
    kind: 'seg7', label: '7-segment display', group: 'displays', icon: 'led_display.svg', labelPrefix: 'DISP',
    pins: pinsFrom(['G', 'F', 'COM1', 'A', 'B', 'E', 'D', 'COM2', 'C', 'DP']),
  }),
  rgb_led: mod({
    kind: 'rgb_led', label: 'RGB LED', group: 'displays', icon: 'led_display.svg', labelPrefix: 'LED',
    accent: '#8b5cf6',
    pins: [{ id: 'r', name: 'R' }, { id: 'com', name: 'common' }, { id: 'g', name: 'G' }, { id: 'b', name: 'B' }],
    defaultProps: { color: 'rgb' },
  }),

  // ── Actuators & motors ──
  servo_sg90: mod({
    kind: 'servo_sg90', label: 'SG90 micro servo', group: 'actuators', icon: 'motor_shaft.svg', labelPrefix: 'M',
    partNumber: 'SG90', accent: '#0f766e',
    pins: pinsFrom(['GND', 'VCC', 'SIG']),
  }),
  dc_motor: comp({
    kind: 'dc_motor', label: 'DC motor', group: 'actuators', icon: 'motor_shaft.svg', labelPrefix: 'M',
    body: 'led', span: 4, polar: true,
    pins: [{ id: 'a', name: '+' }, { id: 'b', name: '−' }],
  }),
  stepper_28byj48: mod({
    kind: 'stepper_28byj48', label: '28BYJ-48 + ULN2003', group: 'actuators', icon: 'motor_shaft.svg', labelPrefix: 'M',
    partNumber: '28BYJ-48', accent: '#0f766e',
    pins: pinsFrom(['IN1', 'IN2', 'IN3', 'IN4', 'VCC', 'GND']),
  }),
  a4988: mod({
    kind: 'a4988', label: 'A4988 stepper driver', group: 'actuators', icon: 'motor_shaft.svg', labelPrefix: 'DRV',
    partNumber: 'A4988', accent: '#0f766e',
    pins: pinsFrom(['EN', 'MS1', 'MS2', 'MS3', 'RST', 'SLP', 'STEP', 'DIR', 'VMOT', 'GND', '2B', '2A', '1A', '1B', 'VDD', 'GND2']),
  }),
  drv8825: mod({
    kind: 'drv8825', label: 'DRV8825 stepper driver', group: 'actuators', icon: 'motor_shaft.svg', labelPrefix: 'DRV',
    partNumber: 'DRV8825', accent: '#0f766e',
    pins: pinsFrom(['EN', 'M0', 'M1', 'M2', 'RST', 'SLP', 'STEP', 'DIR', 'VMOT', 'GND', 'B2', 'B1', 'A1', 'A2', 'FAULT', 'GND2']),
  }),
  tmc2209: mod({
    kind: 'tmc2209', label: 'TMC2209 stepper driver', group: 'actuators', icon: 'motor_shaft.svg', labelPrefix: 'DRV',
    partNumber: 'TMC2209', accent: '#0f766e',
    pins: pinsFrom(['EN', 'MS1', 'MS2', 'PDN', 'CLK', 'RX', 'TX', 'STEP', 'DIR', 'VMOT', 'GND', 'B2', 'B1', 'A1', 'A2', 'VDD']),
  }),
  relay_1ch: mod({
    kind: 'relay_1ch', label: 'Relay module (1-ch)', group: 'actuators', icon: 'relay_switch.svg', labelPrefix: 'K',
    accent: '#dc2626',
    pins: pinsFrom(['VCC', 'GND', 'IN', 'COM', 'NO', 'NC']),
  }),
  ssr: mod({
    kind: 'ssr', label: 'Solid-state relay', group: 'actuators', icon: 'relay_switch.svg', labelPrefix: 'K',
    accent: '#dc2626',
    pins: pinsFrom(['IN+', 'IN-', 'L', 'N']),
  }),
  buzzer: comp({
    kind: 'buzzer', label: 'Buzzer', group: 'actuators', icon: 'heart_soundwave.svg', labelPrefix: 'BZ',
    body: 'led', span: 2, polar: true,
    pins: [{ id: 'a', name: '+' }, { id: 'b', name: '−' }],
  }),

  // ── Communications ──
  hc05: mod({
    kind: 'hc05', label: 'HC-05 Bluetooth', group: 'comms', icon: 'wireless_antenna.svg', labelPrefix: 'COMM',
    partNumber: 'HC-05', accent: '#1d4ed8',
    pins: pinsFrom(['EN', 'VCC', 'GND', 'TXD', 'RXD', 'STATE']),
    defaultProps: { iface: 'UART' },
  }),
  hm10: mod({
    kind: 'hm10', label: 'HM-10 BLE', group: 'comms', icon: 'wireless_antenna.svg', labelPrefix: 'COMM',
    partNumber: 'HM-10', accent: '#1d4ed8',
    pins: pinsFrom(['VCC', 'GND', 'TXD', 'RXD']),
    defaultProps: { iface: 'UART' },
  }),
  nrf24l01: mod({
    kind: 'nrf24l01', label: 'nRF24L01+ transceiver', group: 'comms', icon: 'wireless_antenna.svg', labelPrefix: 'RF',
    partNumber: 'nRF24L01+', accent: '#1d4ed8',
    pins: pinsFrom(['GND', 'VCC', 'CE', 'CSN', 'SCK', 'MOSI', 'MISO', 'IRQ']),
    defaultProps: { iface: 'SPI' },
  }),
  rf433: mod({
    kind: 'rf433', label: '433MHz RF module', group: 'comms', icon: 'wireless_antenna.svg', labelPrefix: 'RF',
    accent: '#1d4ed8',
    pins: pinsFrom(['VCC', 'DATA', 'GND', 'ANT']),
  }),
  lora: mod({
    kind: 'lora', label: 'LoRa module (SX1278)', group: 'comms', icon: 'wireless_antenna.svg', labelPrefix: 'RF',
    partNumber: 'SX1278', accent: '#1d4ed8',
    pins: pinsFrom(['VCC', 'GND', 'SCK', 'MISO', 'MOSI', 'NSS', 'DIO0', 'RST']),
    defaultProps: { iface: 'SPI' },
  }),
  mcp2515: mod({
    kind: 'mcp2515', label: 'MCP2515 CAN bus', group: 'comms', icon: 'wireless_antenna.svg', labelPrefix: 'COMM',
    partNumber: 'MCP2515', accent: '#1d4ed8',
    pins: pinsFrom(['VCC', 'GND', 'CS', 'SO', 'SI', 'SCK', 'INT']),
    defaultProps: { iface: 'SPI' },
  }),
  rs485_ttl: mod({
    kind: 'rs485_ttl', label: 'RS485 to TTL', group: 'comms', icon: 'wireless_antenna.svg', labelPrefix: 'COMM',
    accent: '#1d4ed8',
    pins: pinsFrom(['VCC', 'A', 'B', 'GND', 'RO', 'RE', 'DE', 'DI']),
  }),
  w5500: mod({
    kind: 'w5500', label: 'W5500 Ethernet', group: 'comms', icon: 'wireless_antenna.svg', labelPrefix: 'COMM',
    partNumber: 'W5500', accent: '#1d4ed8',
    pins: pinsFrom(['NC', 'INT', 'RST', 'MISO', 'MOSI', 'SCS', 'SCLK', 'GND', '3V3']),
    defaultProps: { iface: 'SPI' },
  }),

  // ── Switches & buttons ──
  rotary_encoder_ky040: mod({
    kind: 'rotary_encoder_ky040', label: 'Rotary encoder (KY-040)', group: 'switches', icon: 'dial_knob.svg', labelPrefix: 'ENC',
    partNumber: 'KY-040', accent: '#3a4252',
    pins: pinsFrom(['CLK', 'DT', 'SW', 'VCC', 'GND']),
  }),
  dip_switch: comp({
    kind: 'dip_switch', label: 'DIP switch', group: 'switches', icon: 'push_button.svg', labelPrefix: 'SW',
    body: 'button', span: 5,
    pins: [{ id: 's1', name: 'side 1' }, { id: 's2', name: 'side 2' }],
  }),
  reed_switch: comp({
    kind: 'reed_switch', label: 'Reed switch', group: 'switches', icon: 'push_button.svg', labelPrefix: 'SW',
    body: 'resistor', span: 4,
    pins: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }],
  }),
  limit_switch: mod({
    kind: 'limit_switch', label: 'Limit / micro switch', group: 'switches', icon: 'push_button.svg', labelPrefix: 'SW',
    accent: '#3a4252',
    pins: pinsFrom(['COM', 'NO', 'NC']),
  }),

  // ── Power & prototyping (placeable) ──
  buck_lm2596: mod({
    kind: 'buck_lm2596', label: 'Buck converter (LM2596)', group: 'power', icon: 'power_supply_plug.svg', labelPrefix: 'PWR',
    partNumber: 'LM2596', accent: '#ca8a04',
    pins: pinsFrom(['IN+', 'IN-', 'OUT+', 'OUT-']),
  }),
  boost_mt3608: mod({
    kind: 'boost_mt3608', label: 'Boost converter (MT3608)', group: 'power', icon: 'power_supply_plug.svg', labelPrefix: 'PWR',
    partNumber: 'MT3608', accent: '#ca8a04',
    pins: pinsFrom(['IN+', 'IN-', 'OUT+', 'OUT-']),
  }),
  level_shifter: mod({
    kind: 'level_shifter', label: 'Logic level shifter', group: 'power', icon: 'power_supply_plug.svg', labelPrefix: 'LS',
    accent: '#ca8a04',
    pins: pinsFrom(['LV', 'GND', 'LV1', 'LV2', 'HV', 'GND2', 'HV1', 'HV2']),
  }),
  usb_breakout: mod({
    kind: 'usb_breakout', label: 'USB breakout', group: 'power', icon: 'power_supply_plug.svg', labelPrefix: 'USB',
    accent: '#ca8a04',
    pins: pinsFrom(['VBUS', 'D-', 'D+', 'ID', 'GND']),
  }),

  // ── Passives & protection (placeable) ──
  inductor: comp({
    kind: 'inductor', label: 'Inductor', group: 'passives', icon: 'resistor.svg', labelPrefix: 'L',
    body: 'resistor', span: 4,
    pins: [{ id: 'a', name: '1' }, { id: 'b', name: '2' }],
  }),
  electrolytic_cap: comp({
    kind: 'electrolytic_cap', label: 'Electrolytic capacitor', group: 'passives', icon: 'resistor.svg', labelPrefix: 'C',
    body: 'led', span: 2, polar: true,
    pins: [{ id: 'a', name: '+' }, { id: 'k', name: '−' }],
    defaultProps: { value: '10µF' },
  }),
  trimpot: comp({
    kind: 'trimpot', label: 'Trimpot', group: 'passives', icon: 'dial_knob.svg', labelPrefix: 'RV',
    body: 'pot', span: 2,
    pins: [{ id: '1', name: '1' }, { id: 'w', name: 'wiper' }, { id: '3', name: '3' }],
    defaultProps: { ohms: 10000 },
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

// ESP32 DOIT DevKit V1, 30-pin (15 per side). Flash pins (GPIO6–11) not exposed.
function esp32_30Pins() {
  const left = ['VIN', 'GND', 'GPIO13', 'GPIO12', 'GPIO14', 'GPIO27', 'GPIO26', 'GPIO25',
    'GPIO33', 'GPIO32', 'GPIO35', 'GPIO34', 'GPIO39 (VN)', 'GPIO36 (VP)', 'EN']
  const right = ['3V3', 'GPIO23', 'GPIO22', 'GPIO1 (TX0)', 'GPIO3 (RX0)', 'GPIO21', 'GPIO19',
    'GPIO18', 'GPIO5', 'GPIO17 (TX2)', 'GPIO16 (RX2)', 'GPIO4', 'GPIO0', 'GPIO2', 'GPIO15']
  const pins = []
  left.forEach((name, i) => pins.push({ id: `L${i + 1}`, name, side: 'L', order: i }))
  right.forEach((name, i) => pins.push({ id: `R${i + 1}`, name, side: 'R', order: i }))
  return pins
}

// Two-column standalone pin map from a left/right name list (top→bottom each side).
function twoColPins(left, right) {
  const pins = []
  left.forEach((name, i) => pins.push({ id: `L${i + 1}`, name, side: 'L', order: i }))
  right.forEach((name, i) => pins.push({ id: `R${i + 1}`, name, side: 'R', order: i }))
  return pins
}

// Arduino Nano: 15 pins per side (D13..D0/etc left, D12..VIN right — illustrative order).
function nanoPins() {
  const left = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN']
  const right = ['D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND', 'RST', 'D0 (RX)', 'D1 (TX)']
  return twoColPins(left, right)
}

// Raspberry Pi Pico: 20 pins per side.
function picoPins() {
  const left = ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15']
  const right = ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_REF', 'GP28', 'GND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16']
  return twoColPins(left, right)
}

// Pi T-Cobbler: same 40 GPIO names as the Pi header, broken out two-column.
function tCobblerPins() {
  return piPins()
}

export const BOARDS = {
  raspi40: {
    kind: 'raspi40', label: 'Raspberry Pi (40-pin)', group: 'boards', placement: 'standalone',
    accent: '#2bb673', board: '#0b5d3a', pins: piPins(), rows: 20, icon: 'circuit_board_general.svg',
  },
  esp32devkit: {
    kind: 'esp32devkit', label: 'ESP32 DevKitC (38-pin)', group: 'boards', placement: 'standalone',
    accent: '#d34b3b', board: '#222831', pins: esp32Pins(), rows: 19, icon: 'circuit_board_general.svg',
  },
  esp32_30: {
    kind: 'esp32_30', label: 'ESP32 DevKit (30-pin)', group: 'boards', placement: 'standalone',
    accent: '#d34b3b', board: '#222831', pins: esp32_30Pins(), rows: 15, icon: 'circuit_board_general.svg',
  },
  arduino_nano: {
    kind: 'arduino_nano', label: 'Arduino Nano', group: 'boards', placement: 'standalone',
    accent: '#00979d', board: '#1f2937', pins: nanoPins(), rows: 15, icon: 'circuit_board_general.svg',
  },
  pico: {
    kind: 'pico', label: 'Raspberry Pi Pico', group: 'boards', placement: 'standalone',
    accent: '#8a1a3a', board: '#111827', pins: picoPins(), rows: 20, icon: 'circuit_board_general.svg',
  },
  t_cobbler: {
    kind: 't_cobbler', label: 'Pi T-Cobbler', group: 'boards', placement: 'standalone',
    accent: '#2bb673', board: '#0b5d3a', pins: tCobblerPins(), rows: 20, icon: 'circuit_board_general.svg',
  },
}
export const BOARD_LIST = Object.values(BOARDS)

// ── Stock-only consumables ───────────────────────────────────────────────────
// Catalogue entries the user can mark in stock (so the AI inventory is complete)
// but which have no meaningful breadboard pin layout — never placed on a sheet.
export const CONSUMABLES = [
  { kind: 'breadboard_830', label: 'Breadboard 830-pt', group: 'power', icon: 'breadboard.svg' },
  { kind: 'breadboard_400', label: 'Breadboard 400-pt', group: 'power', icon: 'breadboard.svg' },
  { kind: 'breadboard_170', label: 'Breadboard 170-pt', group: 'power', icon: 'breadboard.svg' },
  { kind: 'jumper_wires', label: 'Jumper wires (M-M/M-F/F-F)', group: 'power', icon: 'electric_wire.svg' },
  { kind: 'solid_core_wire', label: 'Solid core wire (22 AWG)', group: 'power', icon: 'electric_wire.svg' },
  { kind: 'test_leads', label: 'Alligator test leads', group: 'power', icon: 'electric_wire.svg' },
  { kind: 'ribbon_cable', label: '40-pin ribbon cable', group: 'power', icon: 'dupont_header.svg' },
  { kind: 'pin_headers', label: 'Pin headers (2.54mm)', group: 'power', icon: 'dupont_header.svg' },
  { kind: 'screw_terminals', label: 'Screw terminals', group: 'power', icon: 'dupont_header.svg' },
  { kind: 'jst_connectors', label: 'JST connectors', group: 'power', icon: 'dupont_header.svg' },
  { kind: 'breadboard_psu', label: 'Breadboard PSU (3.3V/5V)', group: 'power', icon: 'power_supply_plug.svg' },
  { kind: 'battery_holder', label: 'Battery holders (AA/18650/CR2032)', group: 'power', icon: 'aa_battery.svg' },
  { kind: 'resistor_kit', label: 'Resistor assortment (1/4W)', group: 'passives', icon: 'resistor.svg' },
  { kind: 'ceramic_cap_kit', label: 'Ceramic capacitor kit', group: 'passives', icon: 'resistor.svg' },
  { kind: 'electrolytic_cap_kit', label: 'Electrolytic capacitor kit', group: 'passives', icon: 'resistor.svg' },
  { kind: 'inductor_kit', label: 'Inductor assortment', group: 'passives', icon: 'resistor.svg' },
  { kind: 'diode_kit', label: 'Diode kit (1N4007/4148/Schottky/Zener)', group: 'passives', icon: 'diode.svg' },
  { kind: 'fuses', label: 'Fuses (PTC / glass)', group: 'passives', icon: 'diode.svg' },
].map((c) => ({ ...c, partNumber: c.partNumber || '', placement: 'inline', pins: [], stockOnly: true }))

// ── Palette / library grouping ───────────────────────────────────────────────
// Single source of truth for group labels + order, shared by the library modal
// and the AI build-spec. Built from the template data so new parts appear
// automatically under their `group`.
export const GROUP_LABELS = {
  core: 'Core', active: 'Active devices', mine: 'My parts',
  ics: 'Semiconductors & ICs', env: 'Environment sensors', motion: 'Spatial & motion',
  optical: 'Optical & bio sensors', displays: 'Displays & indicators',
  actuators: 'Actuators & motors', comms: 'Communications', switches: 'Switches & buttons',
  power: 'Power & prototyping', passives: 'Passives & protection',
  boards: 'Boards', library: 'My library parts',
}
export const GROUP_ORDER = [
  'library', 'core', 'active', 'mine', 'ics', 'env', 'motion', 'optical',
  'displays', 'actuators', 'comms', 'switches', 'power', 'passives', 'boards',
]

export const PALETTE_GROUPS = (() => {
  const byGroup = {}
  for (const c of COMPONENT_LIST) (byGroup[c.group] ||= []).push(c.kind)
  for (const b of BOARD_LIST) (byGroup[b.group] ||= []).push(b.kind)
  if (byGroup.boards) byGroup.boards.push('custom')
  return GROUP_ORDER.filter((id) => byGroup[id]?.length).map((id) => ({
    id, label: GROUP_LABELS[id] || id, kinds: byGroup[id],
  }))
})()

// The icon set bundled in public/icons (offered in the part creator's picker).
export const ICON_FILES = [
  'circuit_board_general.svg', 'microchip.svg', 'resistor.svg', 'diode.svg', 'transistor.svg',
  'led_display.svg', 'push_button.svg', 'dial_knob.svg', 'relay_switch.svg', 'motor_shaft.svg',
  'environment_sensor.svg', 'light_sensor.svg', 'radar_distance_waves.svg', 'heart_soundwave.svg',
  'rfid_card.svg', 'wireless_antenna.svg', 'power_supply_plug.svg', 'aa_battery.svg',
  'breadboard.svg', 'electric_wire.svg', 'dupont_header.svg',
]

// Resolve a part's icon to a served URL. Falls back to a generic board icon.
const ICON_BASE = import.meta.env.BASE_URL + 'icons/'
export function iconUrl(kindOrTpl) {
  const tpl = typeof kindOrTpl === 'string'
    ? (getTemplate(kindOrTpl) || CONSUMABLES.find((c) => c.kind === kindOrTpl))
    : kindOrTpl
  return ICON_BASE + (tpl?.icon || 'circuit_board_general.svg')
}

// Shapes the part creator can choose from. Each maps to a ComponentSprite body.
export const PART_SHAPES = [
  { id: 'breakout', label: 'Module / breakout (pins in a row)', placement: 'inline' },
  { id: 'to92', label: 'TO-92 (3-pin transistor/sensor)', placement: 'inline' },
  { id: 'resistor', label: '2-leg axial (resistor style)', placement: 'inline' },
  { id: 'led', label: '2-leg LED / diode (polar)', placement: 'inline' },
  { id: 'dip', label: 'DIP chip (straddles the ravine)', placement: 'inline' },
  { id: 'board', label: 'Standalone board (wire to its pins)', placement: 'standalone' },
]

// ── Custom-part library (user-defined parts) ─────────────────────────────────
// User parts live in Supabase via the breadboardLibrary store. On load the store
// calls registerCustomParts() so getTemplate / makeItem resolve them like
// built-ins. Their `kind` is `lib_<slug>`. Placed items also embed body/span/etc
// (see makeItem) so they still render if the registry hasn't loaded yet.
const CUSTOM_TEMPLATES = {}

function labelPrefixFromName(name) {
  const s = String(name || '').trim()
  if (!s) return 'P'
  const initials = s.match(/[A-Za-z0-9]+/g)?.map((w) => w[0]).join('').toUpperCase()
  return (initials || 'P').slice(0, 3)
}

// Turn a stored custom-part definition into a template (the shape getTemplate
// returns). `def` carries { kind, label, partNumber, shape/body, placement, span,
// polar, accent, pins:[{id?,name}] }.
export function buildCustomTemplate(def) {
  const placement = (def.placement || (def.body === 'board' ? 'standalone' : 'inline')) === 'standalone'
    ? 'standalone' : 'inline'
  const body = placement === 'standalone' ? 'board' : (def.body || 'breakout')
  const rawPins = (def.pins || []).filter((p) => p && (p.name || p.id))
  const pins = rawPins.map((p, i) => {
    const base = { id: p.id || `p${i + 1}`, name: p.name || `pin ${i + 1}` }
    if (placement === 'standalone') {
      base.side = p.side || (i % 2 === 0 ? 'L' : 'R')
      base.order = p.order ?? Math.floor(i / 2)
    }
    return base
  })
  return {
    kind: def.kind,
    label: def.label || 'Custom part',
    partNumber: def.partNumber || '',
    group: 'library',
    placement,
    body,
    span: Number(def.span) || (placement === 'standalone' ? 1 : 2),
    polar: !!def.polar,
    straddle: body === 'dip',
    accent: def.accent || '#0ea5e9',
    icon: def.icon || DEFAULT_ICON_FOR_SHAPE[body] || 'circuit_board_general.svg',
    labelPrefix: def.labelPrefix || labelPrefixFromName(def.label),
    pins,
    defaultProps: { partNumber: def.partNumber || '', accent: def.accent || '#0ea5e9' },
    custom: true,
  }
}

// Sensible default icon when a custom part doesn't specify one, keyed by body.
const DEFAULT_ICON_FOR_SHAPE = {
  breakout: 'microchip.svg', to92: 'transistor.svg', resistor: 'resistor.svg',
  led: 'led_display.svg', dip: 'microchip.svg', board: 'circuit_board_general.svg',
}

// Replace the whole custom registry from the store's stored definitions.
export function registerCustomParts(defs = []) {
  for (const k of Object.keys(CUSTOM_TEMPLATES)) delete CUSTOM_TEMPLATES[k]
  for (const def of defs) {
    const tpl = def && def.custom && def.pins?.[0]?.id ? def : buildCustomTemplate(def || {})
    if (tpl.kind) CUSTOM_TEMPLATES[tpl.kind] = tpl
  }
}
export function getCustomTemplates() {
  return Object.values(CUSTOM_TEMPLATES)
}

// Resolve a friendly token (kind / slug / label / part number) to a custom kind.
export function findCustomKind(token) {
  if (!token) return null
  const raw = String(token).toLowerCase().trim()
  const norm = raw.replace(/[\s-]+/g, '_')
  for (const t of Object.values(CUSTOM_TEMPLATES)) {
    const kind = t.kind.toLowerCase()
    const slug = kind.replace(/^lib_/, '')
    if (kind === norm || slug === norm || `lib_${norm}` === kind) return t.kind
    if ((t.label || '').toLowerCase() === raw) return t.kind
    if (t.partNumber && t.partNumber.toLowerCase() === raw) return t.kind
  }
  return null
}

// ── Lookup + item factory ────────────────────────────────────────────────────
export function getTemplate(kind) {
  return COMPONENTS[kind] || BOARDS[kind] || CUSTOM_TEMPLATES[kind] || null
}

// Catalogue of built-in electronic parts (excludes the jumper wire) for the
// library UI and the AI export. Each entry: { kind, label, group, partNumber,
// placement, pins:[names], custom }.
function partMeta(tpl) {
  return {
    kind: tpl.kind,
    label: tpl.label,
    group: tpl.group || 'core',
    partNumber: tpl.partNumber || '',
    placement: tpl.placement || 'inline',
    pins: (tpl.pins || []).map((p) => (typeof p === 'string' ? p : p.name)),
    icon: tpl.icon || '',
    stockOnly: !!tpl.stockOnly,
    custom: !!tpl.custom,
  }
}
export function listBuiltinParts() {
  const out = []
  for (const c of COMPONENT_LIST) if (c.kind !== 'wire') out.push(partMeta(c))
  for (const b of BOARD_LIST) out.push(partMeta(b))
  for (const c of CONSUMABLES) out.push(partMeta(c))
  return out
}
export function listCustomParts() {
  return getCustomTemplates().map(partMeta)
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

  const item = {
    id: uuid(),
    kind,
    label: label || autoLabel(kind),
    x, y, rotation: 0,
    placement: tpl.placement,
    props: { ...tpl.defaultProps, ...props },
    pins,
  }
  // Custom parts embed their render metadata so they survive even if the library
  // registry hasn't loaded (mirrors how the per-sheet custom board self-describes).
  if (tpl.custom) {
    item.body = tpl.body
    item.span = tpl.span
    item.polar = tpl.polar
    item.straddle = tpl.straddle
    if (item.props.accent == null && tpl.accent) item.props.accent = tpl.accent
  }
  return item
}

const LABEL_PREFIX = {
  resistor: 'R', led: 'LED', cap_104: 'C', button: 'SW', diode: 'D',
  transistor: 'Q', potentiometer: 'POT', ic: 'U', ir_led_tsal6400: 'IR',
  tsop38238: 'RX', ds18b20: 'TEMP', veml7700: 'LUX', bme280: 'ENV',
  raspi40: 'Pi', esp32devkit: 'ESP', esp32_30: 'ESP', custom: 'BRD',
  arduino_nano: 'NANO', pico: 'PICO', t_cobbler: 'COB',
}
let labelCounters = {}
function prefixFor(kind) {
  return LABEL_PREFIX[kind] || getTemplate(kind)?.labelPrefix || 'X'
}
function autoLabel(kind) {
  labelCounters[kind] = (labelCounters[kind] || 0) + 1
  return `${prefixFor(kind)}${labelCounters[kind]}`
}
// Reset counters when loading a sheet so labels feel fresh per session view.
export function resetLabelCounters(items = []) {
  labelCounters = {}
  for (const it of items) {
    const pref = prefixFor(it.kind)
    if (!pref || !it.label) continue
    const m = String(it.label).match(new RegExp(`^${pref}(\\d+)$`))
    if (m) labelCounters[it.kind] = Math.max(labelCounters[it.kind] || 0, Number(m[1]))
  }
}
