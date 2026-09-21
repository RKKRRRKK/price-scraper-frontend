// Meters, subdivisions, slot naming and the drum-pattern grid.
//
// A *pulse* is what the main click lands on: the quarter in simple meters, the
// dotted quarter in compound ones. `bpm` always counts pulses per minute, so
// 6/8 at 60 is one dotted quarter a second — the way you'd set a hardware
// metronome, not one eighth a second.
//
// A *slot* is the finest line on the grid: one pulse divided by `subdiv`. The
// click, the roll's gridlines and the onset matcher all speak in slots, so the
// three can never quietly disagree about where a beat is.
//
// Drum patterns sit on their own grid (`patternRes` steps per pulse) so
// changing the click from eighths to sixteenths doesn't rewrite the groove.

export const METERS = [
  { id: '4/4', label: '4/4', pulses: 4, div: 2, pulseName: 'quarter', medium: [2] },
  { id: '3/4', label: '3/4', pulses: 3, div: 2, pulseName: 'quarter', medium: [] },
  { id: '2/4', label: '2/4', pulses: 2, div: 2, pulseName: 'quarter', medium: [] },
  { id: '6/8', label: '6/8', pulses: 2, div: 3, pulseName: 'dotted quarter', medium: [] },
  { id: '12/8', label: '12/8', pulses: 4, div: 3, pulseName: 'dotted quarter', medium: [2] },
]

export function meterById(id) {
  return METERS.find((m) => m.id === id) || METERS[0]
}

const SIMPLE_SUBDIVS = [
  { n: 1, label: 'Quarters', glyph: '♩' },
  { n: 2, label: 'Eighths', glyph: '♪' },
  { n: 3, label: 'Triplets', glyph: '♪³' },
  { n: 4, label: 'Sixteenths', glyph: '♬' },
  { n: 6, label: 'Sextuplets', glyph: '♬⁶' },
]

const COMPOUND_SUBDIVS = [
  { n: 1, label: 'Dotted pulse', glyph: '♩.' },
  { n: 3, label: 'Eighths', glyph: '♪' },
  { n: 6, label: 'Sixteenths', glyph: '♬' },
]

export function subdivisionsFor(meter) {
  return meter.div === 3 ? COMPOUND_SUBDIVS : SIMPLE_SUBDIVS
}

// The nearest legal subdivision when the meter changes under a chosen one
// (3/4 at triplets → 6/8 has no triplets, so fall to eighths).
export function coerceSubdiv(meter, subdiv) {
  const opts = subdivisionsFor(meter)
  if (opts.some((o) => o.n === subdiv)) return subdiv
  let best = opts[0].n
  for (const o of opts) if (Math.abs(o.n - subdiv) < Math.abs(best - subdiv)) best = o.n
  return best
}

// How the click (and the roll) weights a slot.
//   bar    the downbeat
//   medium a secondary strong pulse (beat 3 of 4/4)
//   pulse  any other main pulse
//   sub    a subdivision between pulses
export function slotKind(index, subdiv, meter) {
  const spb = meter.pulses * subdiv
  const inBar = ((index % spb) + spb) % spb
  if (inBar === 0) return 'bar'
  if (inBar % subdiv !== 0) return 'sub'
  return meter.medium.includes(inBar / subdiv) ? 'medium' : 'pulse'
}

// How players actually count the grid out loud. Used to label the roll and to
// name the worst position in a take ("you drag the 'a' of 3").
//
// Compound meters get their own syllables: dividing a dotted quarter into three
// is the *normal* division there, not a triplet borrowed against duple time, so
// "1 la li" is what gets counted rather than "1 trip let".
const COUNTS = {
  1: [''],
  2: ['', '&'],
  3: ['', 'trip', 'let'],
  4: ['', 'e', '&', 'a'],
  6: ['', 'la', 'li', '&', 'la', 'li'],
}

const COMPOUND_COUNTS = {
  1: [''],
  3: ['', 'la', 'li'],
  6: ['', 'ta', 'la', 'ta', 'li', 'ta'],
}

export function slotLabel(inBarIndex, subdiv, meter) {
  const spb = meter.pulses * subdiv
  const inBar = ((inBarIndex % spb) + spb) % spb
  const pulse = Math.floor(inBar / subdiv) + 1
  const offset = inBar % subdiv
  const table = meter.div === 3 ? COMPOUND_COUNTS : COUNTS
  const names = table[subdiv] || table[1]
  return offset === 0 ? String(pulse) : `${pulse} ${names[offset] || '·'}`
}

export function slotsPerBar(meter, subdiv) {
  return meter.pulses * subdiv
}

// ── Drums ────────────────────────────────────────────────────────────────────
// Steps per pulse on the pattern grid: sixteenths in simple meters, and the
// compound equivalent (six per dotted quarter) in 6/8 and 12/8. Eighths
// therefore land on even steps in both families.
export function patternRes(meter) {
  return meter.div === 3 ? 6 : 4
}

const EIGHTHS = (steps) => Array.from({ length: steps / 2 }, (_, i) => i * 2)
const ALL = (steps) => Array.from({ length: steps }, (_, i) => i)

export const DRUM_PATTERNS = {
  '4/4': [
    { id: 'rock', label: 'Straight rock', kick: [0, 8], snare: [4, 12], hat: EIGHTHS(16) },
    { id: 'driving', label: 'Driving 8s', kick: [0, 6, 8, 14], snare: [4, 12], hat: EIGHTHS(16) },
    { id: 'halftime', label: 'Half time', kick: [0], snare: [8], hat: EIGHTHS(16) },
    { id: 'funk16', label: 'Funk 16ths', kick: [0, 3, 10], snare: [4, 12], hat: ALL(16) },
  ],
  '3/4': [
    { id: 'waltz', label: 'Waltz', kick: [0], snare: [4, 8], hat: EIGHTHS(12) },
    { id: 'threefeel', label: 'Three feel', kick: [0, 6], snare: [4, 8], hat: ALL(12) },
  ],
  '2/4': [
    { id: 'twofeel', label: 'Two feel', kick: [0], snare: [4], hat: EIGHTHS(8) },
    { id: 'march', label: 'March', kick: [0, 4], snare: [2, 6], hat: EIGHTHS(8) },
  ],
  '6/8': [
    { id: 'compound', label: 'Compound groove', kick: [0], snare: [6], hat: EIGHTHS(12) },
    { id: 'ballad68', label: '6/8 ballad', kick: [0, 9], snare: [6], hat: EIGHTHS(12) },
  ],
  '12/8': [
    { id: 'slowblues', label: 'Slow blues', kick: [0, 12], snare: [6, 18], hat: EIGHTHS(24) },
    { id: 'shuffle', label: '12/8 shuffle', kick: [0, 10, 12], snare: [6, 18], hat: EIGHTHS(24) },
  ],
}

export function patternsFor(meterId) {
  return DRUM_PATTERNS[meterId] || []
}

export function patternById(meterId, id) {
  const list = patternsFor(meterId)
  return list.find((p) => p.id === id) || list[0] || null
}
