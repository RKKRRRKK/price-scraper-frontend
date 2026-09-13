// Wavetables and noise buffers, built once and cached for the session.
//
// The tone waves come in a small bank across the instrument's range instead of
// one wave for every note. A real bawu is not spectrally constant: down low the
// reed drives the bore hard and the sound is thick and buzzy, up high it thins
// out towards a whistle. Playing one fixed spectrum across three octaves is a
// large part of why a synth patch reads as "organ" rather than "flute".

import { currentContext } from './context'

const cache = new Map()
let cacheCtx = null

function memo(key, make) {
  const ac = currentContext()
  if (ac !== cacheCtx) {
    cache.clear()
    cacheCtx = ac
  }
  if (!cache.has(key)) cache.set(key, make())
  return cache.get(key)
}

// ── Tone spectra ────────────────────────────────────────────────────────────

const PARTIALS = 26

// `reg` runs 0 (bottom of the range) → 1 (top).
//
// Odd partials lead and even ones sit behind them, which is what gives a
// cylindrical reed pipe its hollow, slightly clarinet-ish core. A broad lift
// over partials 3–6 stands in for the reed-and-bore resonance that makes the
// bawu sound reedy rather than glassy, and the whole thing is rolled off harder
// the higher the note so the top of the range stays sweet instead of shrill.
function reedPartials(reg) {
  const reach = 18 - 11 * reg // how far up the series still carries
  const tilt = 1.15 + 0.55 * reg // 1/n^tilt base slope
  const lift = 0.9 - 0.55 * reg // strength of the reed formant bump
  const out = new Float32Array(PARTIALS)
  for (let n = 1; n < PARTIALS; n++) {
    let a = Math.pow(n, -tilt) * (n % 2 ? 1 : 0.52)
    a *= 1 + lift * Math.exp(-Math.pow((n - 4.2) / 2.4, 2))
    a *= Math.exp(-Math.pow(n / reach, 2.2))
    out[n] = a
  }
  return out
}

// The quiet "edge" layer: the same series but tilted up, mixed in underneath at
// a level that breathes with the airstream so the tone has a living edge rather
// than a fixed amount of buzz.
function edgePartials(reg) {
  const out = new Float32Array(PARTIALS)
  for (let n = 1; n < PARTIALS; n++) {
    out[n] = Math.pow(n, -0.75) * (n % 2 ? 1 : 0.6) * Math.exp(-Math.pow(n / (13 - 6 * reg), 2))
  }
  return out
}

// Normalise to unit RMS, not unit peak. Web Audio's own normalisation equalises
// peaks, which quietly makes the rich low waves sound softer than the pure high
// ones — exactly backwards. Matching RMS keeps perceived loudness even across
// the bank, and the bus compressor deals with the peaks.
function waveOf(ac, partials) {
  let energy = 0
  for (let n = 1; n < partials.length; n++) energy += partials[n] * partials[n]
  const norm = 1 / Math.sqrt(energy || 1)
  const real = new Float32Array(partials.length)
  const imag = new Float32Array(partials.length)
  for (let n = 1; n < partials.length; n++) imag[n] = partials[n] * norm
  return ac.createPeriodicWave(real, imag, { disableNormalization: true })
}

const BANK = 7 // spectra across the range; the nearest one wins
const BANK_LO = 48 // C3
const BANK_HI = 86 // D6

// 0 → bottom of the bawu's range, 1 → top. Also drives filter and formant
// placement in the voice, so it lives here next to the spectra it describes.
export function registerOf(midi) {
  const r = (midi - BANK_LO) / (BANK_HI - BANK_LO)
  return r < 0 ? 0 : r > 1 ? 1 : r
}

function bankSlot(midi) {
  return Math.round(registerOf(midi) * (BANK - 1))
}

export function reedWave(ac, midi) {
  const slot = bankSlot(midi)
  return memo(`reed${slot}`, () => waveOf(ac, reedPartials(slot / (BANK - 1))))
}

export function edgeWave(ac, midi) {
  const slot = bankSlot(midi)
  return memo(`edge${slot}`, () => waveOf(ac, edgePartials(slot / (BANK - 1))))
}

// ── Modulator shapes ────────────────────────────────────────────────────────

// A sine with an arbitrary starting phase. OscillatorNode has no phase control,
// but a one-partial periodic wave does: sin(ωt + φ) = sinφ·cos(ωt) + cosφ·sin(ωt).
//
// This matters more than it sounds like it should. Every note builds its own
// LFOs, so without it every vibrato in a phrase starts at the same point in its
// cycle and the whole line wobbles in lockstep, which is the giveaway that
// nobody is breathing.
export function phaseSine(ac, phase) {
  const slot = Math.round((phase / (Math.PI * 2)) * 16) % 16
  return memo(`sin${slot}`, () => {
    const p = (slot / 16) * Math.PI * 2
    const real = new Float32Array([0, Math.sin(p)])
    const imag = new Float32Array([0, Math.cos(p)])
    return ac.createPeriodicWave(real, imag, { disableNormalization: true })
  })
}

// Flutter tongue (花舌) is not a wobble, it is the airstream being interrupted
// — so its modulator is a lopsided pulse rather than a sine, and it points
// DOWN: mostly open, with a hard narrow dip each cycle. Everything it drives
// (loudness, colour, a little pitch) therefore chokes and recovers, which is
// what reads as a rattle. A positive-going pulse would puff instead.
export function flutterWave(ac) {
  return memo('flutter', () => {
    const imag = Float32Array.from([0, 1, 0.58, 0.32, 0.16, 0.08], (v) => -v)
    const real = new Float32Array(imag.length)
    return ac.createPeriodicWave(real, imag)
  })
}

// ── Noise ───────────────────────────────────────────────────────────────────

// Two seconds, so the loop point never lands twice in the same note.
export function noiseBuffer(ac) {
  return memo('noise', () => {
    const len = ac.sampleRate * 2
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    return buf
  })
}
