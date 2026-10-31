// The metronome click, scheduled at an exact AudioContext time.
//
// Five sounds, all synthesised, all gone inside ~60 ms except the cowbell, so
// the beat lands on a point you can actually aim at. Each takes the same four
// weights — bar, medium, pulse, sub — which the beat editor maps to Accent,
// Normal and Soft (see BEAT_KIND in grid.js). The weights change level and,
// for the pitched sounds, pitch, so an accent is heard as "higher" as well as
// "louder" — the part that survives a loud band.
//
// The chosen sound is module state (setClickSound) rather than an argument
// threaded through the transport, the voice sinks and the native renderer: all
// of them already call scheduleClick(ac, when, kind), and all of them should
// follow the same choice.

import { clickBus, noiseBuffer } from './bus'

export const CLICK_SOUNDS = [
  { id: 'wood', label: 'Woodblock' },
  { id: 'beep', label: 'Beep' },
  { id: 'clave', label: 'Clave' },
  { id: 'cowbell', label: 'Cowbell' },
  { id: 'stick', label: 'Stick' },
]

const LEVEL = { bar: 1, medium: 0.82, pulse: 0.68, sub: 0.3 }
const PITCH = { bar: 1.26, medium: 1.12, pulse: 1, sub: 0.84 }

let current = 'wood'

export function setClickSound(id) {
  if (CLICK_SOUNDS.some((s) => s.id === id)) current = id
}

export function clickSound() {
  return current
}

export function scheduleClick(ac, when, kind = 'pulse', sound = current) {
  const t0 = Math.max(when, ac.currentTime)
  const out = clickBus(ac)
  const play = SOUNDS[sound] || SOUNDS.wood
  play(ac, out, t0, kind in LEVEL ? kind : 'pulse')
}

// ── Building blocks ──────────────────────────────────────────────────────────
function tone(ac, out, t0, { type, freq, drop, gain, decay, attack = 0.0008 }) {
  const osc = ac.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (drop) osc.frequency.exponentialRampToValueAtTime(drop, t0 + decay * 0.85)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
  osc.connect(g)
  g.connect(out)
  osc.start(t0)
  osc.stop(t0 + decay + 0.02)
  return g
}

function noise(ac, out, t0, { type = 'bandpass', freq, q = 1.1, gain, decay }) {
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  src.loop = true
  const f = ac.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
  src.connect(f)
  f.connect(g)
  g.connect(out)
  src.start(t0)
  src.stop(t0 + decay + 0.02)
}

// ── The sounds ───────────────────────────────────────────────────────────────
// The original woodblock keeps its hand-tuned table: a pitched body plus a
// filtered noise strike.
const WOOD = {
  bar: { body: 2000, drop: 1500, bodyGain: 0.13, tick: 4200, tickGain: 0.07 },
  medium: { body: 1500, drop: 1150, bodyGain: 0.1, tick: 3400, tickGain: 0.05 },
  pulse: { body: 1180, drop: 880, bodyGain: 0.085, tick: 2600, tickGain: 0.042 },
  sub: { body: 880, drop: 720, bodyGain: 0.03, tick: 2000, tickGain: 0.016 },
}

const SOUNDS = {
  wood(ac, out, t0, kind) {
    const v = WOOD[kind]
    tone(ac, out, t0, { type: 'triangle', freq: v.body, drop: v.drop, gain: v.bodyGain, decay: 0.035 })
    noise(ac, out, t0, { freq: v.tick, gain: v.tickGain, decay: 0.012 })
  },

  // The hardware-metronome blip: a pure tone, an octave-ish jump on the one.
  beep(ac, out, t0, kind) {
    const f = { bar: 1760, medium: 1480, pulse: 1320, sub: 990 }[kind]
    tone(ac, out, t0, { type: 'sine', freq: f, gain: 0.17 * LEVEL[kind], decay: 0.055, attack: 0.002 })
  },

  // A hard, high resonance with almost no strike — cuts through a bass amp.
  clave(ac, out, t0, kind) {
    const f = 2500 * PITCH[kind]
    tone(ac, out, t0, { type: 'sine', freq: f, drop: f * 0.97, gain: 0.2 * LEVEL[kind], decay: 0.045 })
    noise(ac, out, t0, { type: 'highpass', freq: 5000, gain: 0.03 * LEVEL[kind], decay: 0.006 })
  },

  // Two detuned squares through a band-pass: the 808 recipe.
  cowbell(ac, out, t0, kind) {
    const p = PITCH[kind]
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 900 * p
    bp.Q.value = 1.4
    const g = ac.createGain()
    const peak = 0.15 * LEVEL[kind]
    const decay = kind === 'sub' ? 0.07 : 0.16
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + 0.001)
    g.gain.exponentialRampToValueAtTime(peak * 0.3, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
    bp.connect(g)
    g.connect(out)
    for (const f of [587, 845]) {
      const o = ac.createOscillator()
      o.type = 'square'
      o.frequency.value = f * p
      o.connect(bp)
      o.start(t0)
      o.stop(t0 + decay + 0.02)
    }
  },

  // A side-stick: a sharp noise crack over a falling body.
  stick(ac, out, t0, kind) {
    const l = LEVEL[kind]
    noise(ac, out, t0, { type: 'highpass', freq: 1800 * PITCH[kind], q: 0.7, gain: 0.16 * l, decay: 0.018 })
    tone(ac, out, t0, { type: 'triangle', freq: 1700 * PITCH[kind], drop: 380, gain: 0.12 * l, decay: 0.028 })
  },
}
