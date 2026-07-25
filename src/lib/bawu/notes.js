// Bawu note table + jianpu math.
//
// The instrument is a bawu in "Chinese F" (筒音作5 with a 1=F score): the
// all-covered tube note sounds a concert C4 and the scale runs C4–D5 with no
// natural B. Everything here is keyed off that fixed set of eight pitches;
// scores in other jianpu keys are mapped onto it and notes that fall outside
// the set are flagged unplayable.

// Rows ordered high→low, the way the axis renders them.
// holes = [T, 1, 2, 3, 4, 5, 6]; 1 = covered, 0 = open.
export const BAWU_NOTES = [
  { midi: 74, pitch: 'D5', holes: [0, 0, 0, 0, 0, 0, 0] },
  { midi: 72, pitch: 'C5', holes: [1, 0, 0, 0, 0, 0, 0] },
  { midi: 69, pitch: 'A4', holes: [1, 1, 0, 0, 0, 0, 0] },
  { midi: 67, pitch: 'G4', holes: [1, 1, 1, 0, 0, 0, 0] },
  { midi: 65, pitch: 'F4', holes: [1, 1, 1, 1, 0, 0, 0] },
  { midi: 64, pitch: 'E4', holes: [1, 1, 1, 1, 1, 0, 0] },
  { midi: 62, pitch: 'D4', holes: [1, 1, 1, 1, 1, 1, 0] },
  { midi: 60, pitch: 'C4', holes: [1, 1, 1, 1, 1, 1, 1] },
]

export const HOLE_NAMES = ['T', '1', '2', '3', '4', '5', '6']

export const ROW_BY_MIDI = new Map(BAWU_NOTES.map((n, i) => [n.midi, i]))

// Keys a score can be read in. refDo = the MIDI note of the "middle do" (the
// plain, undotted 1) — the tonic inside the Bb3..A4 window, which centers every
// key on the instrument and reproduces the traditional readings for an F bawu:
// 1=F → 筒音作5̣, 1=C → 筒音作1, 1=G → 筒音作4̣, 1=A♯ → 筒音作2.
//
// Sharps are the single canonical spelling: every pitch class has exactly ONE
// canonical name, so keys are compared by pitch, never by string spelling. That
// is what makes enharmonics safe — F♯ and G♭ are the same pitch, so both resolve
// to the one canonical "F#" instead of one of them slipping through unrecognised.
const CANON = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
// Every spelling we accept → pitch class 0..11. Canonical sharps plus flat and
// wrap-around (E#, B#, Cb, Fb) aliases, so any legacy or model-supplied name maps
// in. Reading is by pitch class, so aliases can never be "wrong translations".
const PC_BY_NAME = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4,
  'E#': 5, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10,
  B: 11, Cb: 11,
}
// KEYS is keyed by EVERY accepted spelling (canonical + aliases) so a lookup on a
// stored flat like "Bb" still resolves — always to the canonical sharp label.
export const KEYS = Object.fromEntries(
  Object.entries(PC_BY_NAME).map(([name, pc]) => [
    name,
    { refDo: 58 + ((pc - 10 + 12) % 12), label: CANON[pc].replace('#', '♯') },
  ]),
)

// Fold any key spelling (letter + optional #/b/♯/♭, any case) to its canonical
// sharp name, or null if it isn't a key. Use this before comparing/storing keys.
export function canonicalKey(raw) {
  if (!raw) return null
  const s = String(raw).replace('♯', '#').replace('♭', 'b').trim()
  const m = s.match(/^([A-Ga-g])([#b]?)$/)
  if (!m) return null
  const pc = PC_BY_NAME[m[1].toUpperCase() + m[2]]
  return pc == null ? null : CANON[pc]
}

// The transpose buttons offered in the UI (the practical keys for an F bawu).
export const KEY_CHOICES = ['F', 'G', 'C', 'A#']

// Major-scale semitone offset for jianpu degree 1..7.
const DEG_OFFSET = [null, 0, 2, 4, 5, 7, 9, 11]
// Reverse: semitone-from-do → degree label (accidentals for the cracks).
const SEMITONE_DEG = ['1', '♯1', '2', '♯2', '3', '4', '♯4', '5', '♯5', '6', '♭7', '7']

// {deg, oct, acc} in `key` → concert MIDI. deg 0 (rest) → null. `acc` is the
// printed accidental in semitones (+1 sharp, -1 flat, 0/2 natural).
export function midiOf(deg, oct, key, acc = 0) {
  if (!deg) return null
  const k = KEYS[key] || KEYS.F
  const shift = acc === 1 ? 1 : acc === -1 ? -1 : 0
  return k.refDo + DEG_OFFSET[deg] + shift + 12 * (oct || 0)
}

// Concert MIDI → jianpu label parts in `key`: { deg: '5', dots: -1|0|1 }.
// Degrees off the major scale come back with an accidental mark.
export function jianpuOf(midi, key) {
  const k = KEYS[key] || KEYS.F
  const rel = midi - k.refDo
  const semi = ((rel % 12) + 12) % 12
  const dots = Math.floor(rel / 12)
  return { deg: SEMITONE_DEG[semi], dots }
}

export function rowOfMidi(midi) {
  const row = ROW_BY_MIDI.get(midi)
  return row === undefined ? null : row
}

export function freqOfMidi(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function midiFloatOfFreq(freq) {
  return 69 + 12 * Math.log2(freq / 440)
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

// Frequency → { name: 'A4', midi (nearest), cents (-50..50) } for the tuner.
export function noteOfFreq(freq) {
  const f = midiFloatOfFreq(freq)
  const midi = Math.round(f)
  const cents = Math.round((f - midi) * 100)
  const name = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
  return { name, midi, cents }
}

// Fraction 0..1 of where `midiFloat` sits on the axis (0 = top row, 1 = bottom),
// interpolating between row centers so the mic trace lands between lines when
// the pitch is between notes.
export function rowFloatOfMidi(midiFloat) {
  const n = BAWU_NOTES.length
  if (midiFloat >= BAWU_NOTES[0].midi) return 0
  if (midiFloat <= BAWU_NOTES[n - 1].midi) return n - 1
  for (let i = 0; i < n - 1; i++) {
    const hi = BAWU_NOTES[i].midi
    const lo = BAWU_NOTES[i + 1].midi
    if (midiFloat <= hi && midiFloat >= lo) {
      return i + (hi - midiFloat) / (hi - lo)
    }
  }
  return n - 1
}

// "T 1 2 3" — which holes to cover for a row.
export function coveredLabel(row) {
  const holes = BAWU_NOTES[row].holes
  const parts = holes.map((h, i) => (h ? HOLE_NAMES[i] : null)).filter(Boolean)
  return parts.length ? parts.join(' ') : 'all open'
}

// What to change to get from the heard row to the target row. Both rows are
// indexes into BAWU_NOTES; fingerings are monotonic so the first differing hole
// is the actionable one.
export function coachDelta(targetRow, heardRow) {
  if (heardRow == null || heardRow === targetRow) return 'cover ' + coveredLabel(targetRow)
  const t = BAWU_NOTES[targetRow].holes
  const h = BAWU_NOTES[heardRow].holes
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== h[i]) {
      const name = HOLE_NAMES[i] === 'T' ? 'thumb (T)' : (t[i] ? 'hole ' : 'finger ') + HOLE_NAMES[i]
      return t[i] ? 'cover ' + name : 'lift ' + name
    }
  }
  return heardRow > targetRow ? 'pitch low — open more holes' : 'pitch high — cover more holes'
}

// Render a jianpu label with octave dots as plain text (for pills/labels).
export function jianpuText(midi, key) {
  const { deg, dots } = jianpuOf(midi, key)
  if (dots > 0) return deg + '̇'.repeat(Math.min(dots, 2)) // combining dot above
  if (dots < 0) return deg + '̣'.repeat(Math.min(-dots, 2)) // combining dot below
  return deg
}

// Flatten score data ({key,bpm,timeSig,lines}) into a playable note list.
// Each entry: { idx, lineIdx, deg, oct, acc, art, beats, start, midi, row, label, rest }.
// Rests keep their slot in the timeline but carry rest: true and no row.
export function flattenScore(data, keyOverride) {
  const key = keyOverride || data?.key || 'F'
  const lines = data?.lines || []
  const out = []
  let start = 0
  let idx = 0
  lines.forEach((line, lineIdx) => {
    for (const n of line.notes || []) {
      const beats = Math.max(0.125, Number(n.beats) || 1)
      const acc = Number(n.acc) || 0
      const art = n.art || ''
      if (!n.deg) {
        out.push({ idx: -1, lineIdx, deg: 0, oct: 0, acc: 0, art, beats, start, midi: null, row: null, label: '0', rest: true })
      } else {
        const midi = midiOf(n.deg, n.oct, key, acc)
        const row = rowOfMidi(midi)
        out.push({
          idx: idx++,
          lineIdx,
          deg: n.deg,
          oct: n.oct || 0,
          acc,
          art,
          ly: n.ly || '',
          py: n.py || '',
          beats,
          start,
          midi,
          row,
          label: jianpuText(midi, key),
          rest: false,
        })
      }
      start += beats
    }
  })
  return { key, notes: out, playable: out.filter((n) => !n.rest), totalBeats: start }
}

// Decompose a beat value into jianpu duration decorations for the digital view:
// underlines (beat subdivisions), trailing dashes (held beats), augmentation dot.
export function jianpuDuration(beats) {
  const b = Number(beats) || 1
  if (b >= 1.9) return { underlines: 0, dashes: Math.min(3, Math.round(b) - 1), dot: false }
  if (Math.abs(b - 1.5) < 0.06) return { underlines: 0, dashes: 0, dot: true }
  if (Math.abs(b - 0.75) < 0.04) return { underlines: 1, dashes: 0, dot: true }
  if (b <= 0.6) return { underlines: Math.max(1, Math.min(3, Math.round(Math.log2(1 / b)))), dashes: 0, dot: false }
  return { underlines: 0, dashes: 0, dot: false }
}

// How well a score fits the instrument in a given key: count of sounding notes
// whose pitch the bawu cannot produce.
export function fitInfo(data, key) {
  const { playable } = flattenScore(data, key)
  const missing = playable.filter((n) => n.row === null).length
  return { total: playable.length, missing, fits: missing === 0 }
}

// Semitone-from-do (0..11) → base jianpu degree + printed accidental, matching
// how SEMITONE_DEG spells the out-of-scale cracks (♯1 ♯2 ♯4 ♯5 ♭7).
const SEMITONE_DEGACC = [
  { deg: 1, acc: 0 }, { deg: 1, acc: 1 }, { deg: 2, acc: 0 }, { deg: 2, acc: 1 },
  { deg: 3, acc: 0 }, { deg: 4, acc: 0 }, { deg: 4, acc: 1 }, { deg: 5, acc: 0 },
  { deg: 5, acc: 1 }, { deg: 6, acc: 0 }, { deg: 7, acc: -1 }, { deg: 7, acc: 0 },
]

// Concert MIDI → { deg, oct, acc } jianpu spelling in `key` — the inverse of
// midiOf(). Used to re-express a pitch after a transpose or a hand-edit.
export function degOctAccOfMidi(midi, key) {
  const k = KEYS[key] || KEYS.F
  const rel = midi - k.refDo
  const semi = ((rel % 12) + 12) % 12
  const { deg, acc } = SEMITONE_DEGACC[semi]
  return { deg, oct: Math.floor(rel / 12), acc }
}

// Shift every sounding note by `semitones` (rests keep only their timing),
// re-expressed as jianpu degrees + accidentals in the SAME key. Returns a fresh
// { key, bpm, timeSig, lines } — the basis for an adjusted variant. Chromatic
// steps introduce sharps/flats, and notes pushed past C4–D5 come back as
// unplayable (the fit indicator flags them).
export function transposeData(data, semitones) {
  const key = data?.key || 'F'
  const lines = (data?.lines || []).map((line) => ({
    ...line,
    notes: (line.notes || []).map((n) => {
      if (!n.deg) return { ...n } // rest
      const midi = midiOf(n.deg, n.oct, key, Number(n.acc) || 0) + semitones
      const { deg, oct, acc } = degOctAccOfMidi(midi, key)
      const out = { deg, oct, beats: n.beats }
      if (acc) out.acc = acc
      if (n.art) out.art = n.art
      if (n.ly) out.ly = n.ly
      if (n.py) out.py = n.py
      return out
    }),
  }))
  return { key, bpm: data?.bpm || 80, timeSig: data?.timeSig || '4/4', lines }
}
