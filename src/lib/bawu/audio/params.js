// AudioParam plumbing shared by every voice.
//
// The big idea the rest of the synth is built on: pitch is automated in CENTS
// on a `detune` bus, never in hertz on `frequency`. Cents are linear in the way
// we actually hear pitch, so a straight ramp is already a musically even glide,
// the value is allowed to sit at or cross zero (an exponential hertz ramp
// cannot), and one automation curve can drive the oscillators AND the body
// filter at once — `BiquadFilterNode.detune` speaks the same units.
//
// Everything here is therefore linear-ramp based. Amplitude is the exception
// and keeps exponential ramps, because loudness is where exponentials belong.

// Freeze an AudioParam at whatever it is right now so fresh automation can pick
// up from there. cancelAndHoldAtTime is the right tool; older engines get a
// manual read-and-pin, which is close enough for a note-length envelope.
export function holdParam(param, at) {
  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(at)
  } else {
    const v = param.value
    param.cancelScheduledValues(at)
    param.setValueAtTime(v, at)
  }
}

// Same, for a gain being driven exponentially — the pinned value has to stay
// above zero or the next exponential ramp throws.
export function holdGain(param, at) {
  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(at)
  } else {
    const v = Math.max(0.0001, param.value)
    param.cancelScheduledValues(at)
    param.setValueAtTime(v, at)
  }
}

// Easing curves. A straight ramp between two pitches is the sound of a machine
// sliding; a player's finger and breath both accelerate and settle, so every
// gesture in expression.js picks a shape from here.
export const ease = {
  linear: (x) => x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  outQuint: (x) => 1 - Math.pow(1 - x, 5),
  inQuad: (x) => x * x,
  inCubic: (x) => x * x * x,
  inOutSine: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
}

// Approximate an eased ramp with a short chain of linear ones. Web Audio's
// setValueCurveAtTime would be exact but it refuses to overlap other
// automation, and a live voice gets re-scheduled constantly (a slur arriving,
// a note being extended), so it is the wrong tool. A dozen segments is well
// past the point where the joins are audible.
export function rampTo(param, from, to, t0, dur, easing = ease.inOutSine, steps = 12) {
  if (!(dur > 0)) {
    param.setValueAtTime(to, t0)
    return
  }
  const n = easing === ease.linear ? 1 : Math.max(2, steps)
  for (let i = 1; i <= n; i++) {
    const x = i / n
    param.linearRampToValueAtTime(from + (to - from) * easing(x), t0 + dur * x)
  }
}

// An automation cursor over one param. It remembers where and when it left off,
// which is what keeps a note's gestures from ever scheduling out of order: a
// bend followed by a release glide simply cannot cross over itself, and a
// gesture whose slot has already elapsed quietly does nothing instead of
// throwing the timeline into reverse.
export class Line {
  constructor(param, t0, v0) {
    this.p = param
    this.t = t0
    this.v = v0
    param.setValueAtTime(v0, t0)
  }

  get time() { return this.t }
  get value() { return this.v }

  // Ease to `v`, arriving at `at`. Ignored if that moment has already passed.
  to(v, at, easing = ease.inOutSine, steps = 12) {
    if (at <= this.t + 0.001) return this
    rampTo(this.p, this.v, v, this.t, at - this.t, easing, steps)
    this.t = at
    this.v = v
    return this
  }

  // Sit still until `at`, so the next gesture starts from a settled value.
  hold(at) {
    if (at > this.t + 0.001) {
      this.p.linearRampToValueAtTime(this.v, at)
      this.t = at
    }
    return this
  }
}

export function rand(a, b) {
  return a + Math.random() * (b - a)
}

// Scale `v` by ±`frac`. Sprinkled over attack times, vibrato rates and levels
// so no two notes are bit-identical — the single cheapest thing that stops a
// phrase sounding like a sequencer.
export function jitter(v, frac) {
  return v * (1 + (Math.random() * 2 - 1) * frac)
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}
