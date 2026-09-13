// Everything a note does that isn't just holding a pitch: the scoop into the
// attack, glissandi, bends, fall-offs, portamenti between slurred notes, and
// the vibrato settings each `vb` level stands for.
//
// A gesture is never only a pitch move. When a player bends a note down the
// tone darkens and loses a little weight, because the bend is made by easing
// off the breath; when they slide between two notes the line dips at the
// join. So each gesture writes to three curves at once:
//
//   pitch   cents, onto the oscillators' detune bus
//   bright  cents, onto the body filter's detune — the tone opening and closing
//   artic   linear gain, a small dip through transitions
//
// Coupling those three is most of the difference between "the frequency
// changed" and "somebody played that".

import { Line, ease, holdParam, rampTo, rand, jitter, clamp } from './params'

// Per `vb` level: pitch depth in cents, rate in Hz, how much of it reaches the
// amplitude, and how much reaches the tone colour. Level 0 is the voice's own
// gentle default — nobody holds a wind note dead still. Level 3 is flutter
// tongue (花舌), which is barely a pitch effect at all: it lives almost
// entirely in the amplitude, where the interrupted airstream actually is.
export const VIB = {
  cents: [18, 34, 58, 10],
  rate: [4.9, 5.3, 5.9, 26],
  amp: [0.05, 0.09, 0.14, 0.75],
  bright: [70, 120, 190, 400],
  // How far the tremolo actually swings ABOVE unity, which is all the output
  // trim needs to know. Levels 0–2 ride a sine and are symmetric; the flutter
  // pulse is lopsided downwards, so it overshoots far less than its depth
  // suggests and trimming by `amp` would leave the rattle too quiet.
  amPeak: [0.05, 0.09, 0.14, 0.36],
}

// How wide a leap a gliss-in is allowed to sweep. Past about a fifth the slide
// stops sounding like an ornament and starts sounding like a siren.
const MAX_SLIDE = 700

// Where the pitch starts, in cents relative to the note. A tongued attack
// always scoops a touch from below — the reed takes a moment to come up to
// speed — and `gi` turns that into an audible 滑音 from wherever the line came
// from, or from below when the note stands alone.
function entryCents(shape) {
  if (shape.gi) {
    const from = shape.fromMidi != null ? (shape.fromMidi - shape.midi) * 100 : -250
    return clamp(from, -MAX_SLIDE, MAX_SLIDE)
  }
  return -rand(30, 48)
}

// Write a whole note's worth of gestures onto the three curves. Called once, at
// note start; a slur arriving later overrides the tail via glideGesture().
export function applyExpression({ pitch, bright, artic }, shape, t0, dur) {
  const tEnd = t0 + dur
  const P = new Line(pitch, t0, entryCents(shape))
  // The filter starts well closed and opens with the breath, which is what a
  // wind attack sounds like: air first, tone a moment later.
  const B = new Line(bright, t0, -1350)
  const A = new Line(artic, t0, 1)

  // ── Attack ────────────────────────────────────────────────────────────────
  const settle = shape.gi
    ? Math.min(0.2, dur * 0.45)
    : jitter(Math.min(0.055, dur * 0.28), 0.22)
  if (shape.gi) {
    P.to(0, t0 + settle, ease.outQuint, 16)
  } else {
    // A hair sharp before it settles — the reed catching hold.
    P.to(5, t0 + settle * 0.62, ease.outCubic, 6)
    P.to(0, t0 + settle, ease.inOutSine, 4)
  }
  B.to(0, t0 + jitter(Math.min(0.1, dur * 0.4), 0.18), ease.outCubic, 8)

  // ── Bend (压音) ───────────────────────────────────────────────────────────
  // Delayed, so the note speaks cleanly first; held at the top; eased both
  // ways. A bend down leans dark and slightly quieter, a bend up brightens.
  if (shape.bd) {
    const c = shape.bd * 100
    const away = t0 + dur * 0.42
    const hold = t0 + dur * 0.6
    const back = t0 + dur * 0.82
    const mag = Math.abs(shape.bd)
    const colour = shape.bd < 0 ? -170 * mag : 100 * mag
    const drop = 1 - 0.05 * mag

    P.hold(t0 + dur * 0.2)
    P.to(c, away, ease.inOutSine, 14).hold(hold).to(0, back, ease.inOutSine, 14)
    B.hold(t0 + dur * 0.2)
    B.to(colour, away, ease.inOutSine, 8).hold(hold).to(0, back, ease.inOutSine, 8)
    A.hold(t0 + dur * 0.2)
    A.to(drop, away, ease.inOutSine, 6).hold(hold).to(1, back, ease.inOutSine, 6)
  }

  // ── Release gesture ───────────────────────────────────────────────────────
  if (shape.go === 'off') {
    // A fall-off accelerates as the breath goes: the pitch drops away faster
    // and faster while the tone shuts down behind it.
    const from = tEnd - Math.min(0.5, dur * 0.34)
    P.hold(from).to(-520, tEnd + 0.03, ease.inCubic, 16)
    B.hold(from).to(-1200, tEnd, ease.inQuad, 10)
    A.hold(from).to(0.82, tEnd, ease.inQuad, 6)
  } else if (shape.go === 'to' && shape.nextMidi != null) {
    // A portamento has to leave before the next note is due. When the two notes
    // are actually joined the player schedules its own glide over the top of
    // this one (see glideGesture); this is the standalone case.
    const to = clamp((shape.nextMidi - shape.midi) * 100, -MAX_SLIDE * 2, MAX_SLIDE * 2)
    const from = tEnd - Math.min(0.45, dur * 0.26)
    P.hold(from).to(to, tEnd, ease.inOutSine, 16)
    B.hold(from).to(-140, tEnd, ease.inOutSine, 6)
  }
}

// Re-aim a note that is already sounding: the slur/tie case, where one breath
// spans several notes. Overrides whatever tail applyExpression() scheduled.
//
// `fromC`/`fromBright` are where those curves were left, so the new ramps start
// from the right place rather than snapping.
export function glideGesture({ pitch, bright, artic }, { fromC, toC, at, span, fromBright = 0 }) {
  const dist = Math.abs(toC - fromC)
  holdParam(pitch, at)

  if (span < 0.02 || dist < 1) {
    // A tie, or a re-articulation at the same pitch: move and get out of the
    // way. No dip — there is no transition to hear. The other two curves are
    // still pulled back to rest, in case the note being tied out of had a tail
    // gesture of its own scheduled on them.
    pitch.linearRampToValueAtTime(toC, at + Math.max(0.004, span))
    holdParam(bright, at)
    bright.linearRampToValueAtTime(fromBright, at + 0.03)
    holdParam(artic, at)
    artic.linearRampToValueAtTime(1, at + 0.03)
    return
  }

  // Anchor over a few milliseconds rather than at `at` exactly: the curve may
  // be caught mid-attack, in which case the value held is not quite where the
  // caller thinks it is, and a zero-length ramp onto the expected value would
  // be a click. A 4 ms slew swallows the difference inaudibly.
  const from = at + 0.004

  // Eased at both ends. A player leaves a note reluctantly and arrives on the
  // next one, rather than travelling at a constant rate between them.
  pitch.linearRampToValueAtTime(fromC, from)
  rampTo(pitch, fromC, toC, from, span, ease.inOutSine, 18)

  // The join itself: the tone pulls back and darkens through the slide and
  // recovers on the far side, in proportion to how far it had to travel.
  const depth = Math.min(1, dist / 500)
  const mid = from + span * 0.45
  const done = from + span + 0.05

  holdParam(bright, at)
  bright.linearRampToValueAtTime(fromBright, from)
  bright.linearRampToValueAtTime(fromBright - 300 * depth, mid)
  bright.linearRampToValueAtTime(fromBright, done)

  holdParam(artic, at)
  artic.linearRampToValueAtTime(1, from)
  artic.linearRampToValueAtTime(1 - 0.16 * depth, mid)
  artic.linearRampToValueAtTime(1, done)
}
