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

// ── Expression marks ─────────────────────────────────────────────────────────
// Beyond pitch and duration a note can carry articulation and expression. These
// are all optional and omitted when unset, so older scores stay valid:
//
//   art  'T'|'TK'|'tr'|'grace'   point articulation (tongue, trill, grace note)
//   ti   1                       TIED into the next note (same pitch) — one sound
//   sl   1                       SLURRED into the next note (different pitch) —
//                                legato, no re-articulation
//   gi   1                       glissando INTO this note (上/下滑音 at the attack)
//   go   'off'|'to'              release glide: fall away, or portamento into the
//                                next note's pitch
//   bd   -2..2                   bend in semitones during the note, and back
//   vb   0..3                    vibrato depth (3 = flutter tongue 花舌)
//
// `ti` and `sl` print as the same arc; the pitch decides which one it is. The
// single place that rule (and every range clamp) lives is readExpr().
export const ART_TAGS = ['T', 'TK', 'tr', 'grace']
export const GLIDE_OUT = ['off', 'to']
export const MAX_BEND = 2
export const MAX_VIBRATO = 3

// Pull the decoration fields off a note (stored note, or an editor event),
// clamped to their legal ranges. Only fields that are actually set come back,
// so `Object.assign(note, readExpr(src))` never writes a default.
export function readExpr(n) {
  const e = {}
  if (!n) return e
  if (ART_TAGS.includes(n.art)) e.art = n.art
  if (n.ti) e.ti = 1
  if (n.sl) e.sl = 1
  if (n.gi) e.gi = 1
  if (GLIDE_OUT.includes(n.go)) e.go = n.go
  const bd = Number(n.bd)
  if (Number.isFinite(bd) && bd) {
    const q = Math.round(bd * 2) / 2 // half-semitone resolution
    if (q) e.bd = Math.max(-MAX_BEND, Math.min(MAX_BEND, q))
  }
  const vb = Math.round(Number(n.vb) || 0)
  if (vb > 0) e.vb = Math.min(MAX_VIBRATO, vb)
  return e
}

// Flatten score data ({key,bpm,timeSig,lines}) into a playable note list.
// Each entry: { idx, lineIdx, deg, oct, acc, art, beats, start, midi, row, label,
// rest, ly, py } plus the expression fields above and two derived ones:
//   noAttack   the previous sounding note tied or slurred into this one, so it
//              must not be re-struck — the playing voice glides instead
//   tiedIn     narrower: the previous note TIED into this one, so this is not a
//              new pitch at all, just the rest of the one before it
//   soundBeats this note's beats plus the following tie chain: how long the one
//              sound it starts actually lasts
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
      if (!n.deg) {
        out.push({
          idx: -1, lineIdx, deg: 0, oct: 0, acc: 0, art: n.art || '',
          beats, start, midi: null, row: null, label: '0', rest: true,
          ti: 0, sl: 0, gi: 0, go: '', bd: 0, vb: 0, noAttack: false, tiedIn: false, soundBeats: beats,
        })
      } else {
        const midi = midiOf(n.deg, n.oct, key, acc)
        const row = rowOfMidi(midi)
        const e = readExpr(n)
        out.push({
          idx: idx++,
          lineIdx,
          deg: n.deg,
          oct: n.oct || 0,
          acc,
          art: e.art || '',
          ly: n.ly || '',
          py: n.py || '',
          beats,
          start,
          midi,
          row,
          label: jianpuText(midi, key),
          rest: false,
          ti: e.ti || 0,
          sl: e.sl || 0,
          gi: e.gi || 0,
          go: e.go || '',
          bd: e.bd || 0,
          vb: e.vb || 0,
          noAttack: false,
          tiedIn: false,
          soundBeats: beats,
        })
      }
      start += beats
    }
  })
  resolveLinks(out)
  return { key, notes: out, playable: out.filter((n) => !n.rest), totalBeats: start }
}

// Second pass over a flattened list: settle every tie/slur against its actual
// neighbour, then accumulate tie chains into soundBeats. Done here rather than
// at ingest so the roll, the sheet, the editor and the synth all see the same
// answer no matter where the data came from.
function resolveLinks(out) {
  for (let i = 0; i < out.length; i++) {
    const n = out[i]
    if (n.rest) continue
    const next = out[i + 1]
    // The end of the piece or a rest in between breaks the link.
    if (!next || next.rest) {
      n.ti = 0
      n.sl = 0
      continue
    }
    // An arc to a different pitch is a slur, not a tie — however it was stored.
    if (n.ti && next.midi !== n.midi) {
      n.ti = 0
      n.sl = 1
    }
    if (n.ti) n.sl = 0
    if (n.ti || n.sl) next.noAttack = true
    if (n.ti) next.tiedIn = true
  }
  // Backwards, so a chain of ties sums in one sweep.
  for (let i = out.length - 1; i >= 0; i--) {
    const n = out[i]
    if (n.rest) continue
    const next = out[i + 1]
    n.soundBeats = n.ti && next ? n.beats + next.soundBeats : n.beats
  }
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
      if (n.ly) out.ly = n.ly
      if (n.py) out.py = n.py
      // Every note moves by the same interval, so ties stay same-pitch ties.
      Object.assign(out, readExpr(n))
      return out
    }),
  }))
  return { key, bpm: data?.bpm || 80, timeSig: data?.timeSig || '4/4', lines }
}

// Write a lyrics pass's result back onto score data. `rows` is what the AI
// returned — one entry per melody row, { i, ly: [], py: [] }, with the arrays
// aligned to that row's SOUNDING notes (rests skipped). Rows the model didn't
// return are left exactly as they were.
//
// overwrite:false only fills notes that have no syllable yet, so a second pass
// can top up a partial result instead of clearing it.
export function mergeLyrics(data, rows, { overwrite = true } = {}) {
  const byRow = new Map()
  for (const r of rows || []) if (Number.isInteger(r?.i)) byRow.set(r.i, r)
  const lines = (data?.lines || []).map((line, li) => {
    const row = byRow.get(li)
    if (!row) return line
    let k = 0
    const notes = (line.notes || []).map((n) => {
      if (!n.deg) return n // rests never carry a syllable
      const ly = String(row.ly?.[k] || '').trim()
      const py = String(row.py?.[k] || '').trim()
      k++
      const out = { ...n }
      if (overwrite || !out.ly) {
        if (ly) out.ly = ly
        else if (overwrite) delete out.ly
      }
      if (overwrite || !out.py) {
        if (py) out.py = py
        else if (overwrite) delete out.py
      }
      return out
    })
    return { ...line, notes }
  })
  return { ...data, lines }
}
