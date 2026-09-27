// Scales on a fretted neck: which frets belong to a key, and what to call them.
//
// Every scale is written as (semitones above the root, degree number) pairs.
// The degree number does two jobs. It gives the degree label — "♭3" is degree 3
// sitting a semitone below where the major scale puts it — and it gives the
// spelling, because degree n always takes the letter n−1 steps above the root's.
// That is what makes A♭ major read A♭ B♭ C D♭ rather than G♯ A♯ C C♯, and it
// works unchanged for the pentatonics, which are spelled like their parents.

export const SCALES = [
  { id: 'major', label: 'Major', steps: [[0, 1], [2, 2], [4, 3], [5, 4], [7, 5], [9, 6], [11, 7]] },
  { id: 'minor', label: 'Minor', steps: [[0, 1], [2, 2], [3, 3], [5, 4], [7, 5], [8, 6], [10, 7]] },
  { id: 'majorPent', label: 'Major pent.', name: 'major pentatonic', parent: 'major', steps: [[0, 1], [2, 2], [4, 3], [7, 5], [9, 6]] },
  { id: 'minorPent', label: 'Minor pent.', name: 'minor pentatonic', parent: 'minor', steps: [[0, 1], [3, 3], [5, 4], [7, 5], [10, 7]] },
]

// Strings listed low to high, as MIDI note numbers of the open strings.
export const TUNINGS = [
  { id: 'bass4', label: '4-string bass', strings: [28, 33, 38, 43] },
  { id: 'bass5', label: '5-string bass', strings: [23, 28, 33, 38, 43] },
  { id: 'guitar', label: 'Guitar', strings: [40, 45, 50, 55, 59, 64] },
]

export const MAX_FRET = 24

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]
const MAJOR_SEMIS = [0, 2, 4, 5, 7, 9, 11]
const ACC = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' }

// The twelve roots, each with the letter spellings it can take. Which one is
// used is decided per scale, below.
export const ROOTS = Array.from({ length: 12 }, (_, pc) => {
  let spellings = []
  for (let l = 0; l < 7; l++) {
    const acc = wrap(pc - LETTER_PC[l])
    if (Math.abs(acc) <= 1) spellings.push({ letter: l, acc })
  }
  // A white key is only ever its natural name — nobody wants a B♯ root.
  if (spellings.some((s) => s.acc === 0)) spellings = spellings.filter((s) => s.acc === 0)
  // Sharp before flat, so F♯ wins the F♯/G♭ major tie.
  spellings.sort((a, b) => b.acc - a.acc)
  return {
    pc,
    label: spellings.map((s) => LETTERS[s.letter] + ACC[s.acc]).join(' / '),
    spellings,
  }
})

function wrap(semis) {
  return ((((semis + 6) % 12) + 12) % 12) - 6
}

export function scaleById(id) {
  return SCALES.find((s) => s.id === id) || SCALES[0]
}

export function tuningById(id) {
  return TUNINGS.find((t) => t.id === id) || TUNINGS[0]
}

function spell(rootSpelling, rootPc, semis, degree) {
  const letter = (rootSpelling.letter + degree - 1) % 7
  const acc = wrap((rootPc + semis) % 12 - LETTER_PC[letter])
  return { letter, acc }
}

// The root spelling that reads with the fewest accidentals across the whole
// parent scale: D♭ major (5 flats) over C♯ major (7 sharps), C♯ minor over D♭
// minor.
function bestRootSpelling(rootPc, scale) {
  const parent = scaleById(scale.parent || scale.id)
  let best = null
  let bestCost = Infinity
  for (const sp of ROOTS[rootPc].spellings) {
    const cost = parent.steps.reduce((n, [semis, deg]) => {
      const a = Math.abs(spell(sp, rootPc, semis, deg).acc)
      return n + a + (a > 1 ? 10 : 0)
    }, 0)
    if (cost < bestCost) {
      best = sp
      bestCost = cost
    }
  }
  return best
}

// Everything the fretboard needs about one key: which pitch classes are in it
// and, for each, its note name and degree label.
export function buildScale(rootPc, scaleId) {
  const scale = scaleById(scaleId)
  const rootSp = bestRootSpelling(rootPc, scale)
  const tones = new Map()
  for (const [semis, deg] of scale.steps) {
    const sp = spell(rootSp, rootPc, semis, deg)
    tones.set((rootPc + semis) % 12, {
      degree: deg,
      degreeLabel: ACC[semis - MAJOR_SEMIS[deg - 1]] + deg,
      note: LETTERS[sp.letter] + ACC[sp.acc],
      root: deg === 1,
    })
  }
  return {
    name: `${LETTERS[rootSp.letter]}${ACC[rootSp.acc]} ${scale.name || scale.label.toLowerCase()}`,
    root: rootPc,
    tones,
  }
}

// Chromatic degree names above the root, for notes the key does not contain.
const CHROMATIC_DEGREES = ['1', '♭2', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7']

// What a played note is called on the roll, by the same Degrees / Notes toggle
// the fretboard uses. A note outside the key still gets a degree — its
// distance from the root — so the toggle never leaves a mark blank.
export function markLabel(midi, scale, mode = 'degrees') {
  const pc = ((midi % 12) + 12) % 12
  const t = scale?.tones.get(pc)
  if (mode === 'notes') return t ? t.note : LOOSE_NAMES[pc]
  if (t) return t.degreeLabel
  return CHROMATIC_DEGREES[(pc - (scale?.root ?? 0) + 12) % 12]
}

// Names for pitch classes the key does not spell: the usual mix of sharps and
// flats rather than all of one kind.
const LOOSE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

// Open-string names for the label column, spelled the way the key spells them
// when the string's note is in the key (an E♭ tuning would read E♭, not D♯).
export function stringName(midi, scale) {
  const t = scale?.tones.get(midi % 12)
  if (t) return t.note
  return LOOSE_NAMES[midi % 12]
}

// A played note's name with its octave, spelled by the key when it is in the
// key. The octave follows the letter, so a C♭ belongs to the octave above the
// B it sounds as, and a B♯ to the one below.
export function noteLabel(midi, scale) {
  const pc = ((midi % 12) + 12) % 12
  let oct = Math.floor(midi / 12) - 1
  const t = scale?.tones.get(pc)
  if (!t) return LOOSE_NAMES[pc] + oct
  if (t.note[0] === 'C' && pc === 11) oct += 1
  if (t.note[0] === 'B' && pc === 0) oct -= 1
  return t.note + oct
}

// Every place a pitch can be fretted, as { string, fret }, lowest string first.
// A detected note never says which string it was played on, so the fretboard
// lights all of them.
export function positionsOf(midi, strings, maxFret = MAX_FRET) {
  const out = []
  strings.forEach((open, string) => {
    const fret = midi - open
    if (fret >= 0 && fret <= maxFret) out.push({ string, fret })
  })
  return out
}
