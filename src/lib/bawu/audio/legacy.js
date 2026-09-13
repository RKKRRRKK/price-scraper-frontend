// The previous modeled bawu voice, kept verbatim so the rewrite can be A/B'd
// against what it replaced from the transport's voice picker.
//
// Deliberately NOT refactored onto the shared cents bus / expression module —
// the whole point of keeping it is to hear the old behaviour, including the
// things the rewrite set out to fix: pitch gestures written straight onto
// `frequency` as bare exponential ramps with no easing, vibrato added in hertz
// so its depth drifts as a glide moves, one fixed spectrum across the whole
// range, a static body filter and no breath movement at all.
//
// It plays into the same reverb bus as the new voice, so switching between them
// compares the instrument and nothing else. Delete this file and its entry in
// the picker once the comparison has served its purpose.

import { freqOfMidi } from '../notes'
import { toneBus } from './reverb'

const SEMI = (n) => Math.pow(2, n / 12)

const VIB_DEPTH = [0.008, 0.014, 0.024, 0.010]
const VIB_RATE = [4.8, 5.2, 5.8, 22]

function holdParam(param, at) {
  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(at)
  } else {
    const v = param.value
    param.cancelScheduledValues(at)
    param.setValueAtTime(Math.max(0.0001, v), at)
  }
}

// Write one note's pitch gestures onto a set of frequency params. A time cursor
// keeps every ramp strictly increasing, so a bend and a release glide on the
// same note can never schedule out of order.
function schedulePitch(params, freq, t0, dur, { gi = 0, go = '', bd = 0, fromFreq = 0, nextFreq = 0 }) {
  const tEnd = t0 + dur
  let cur = t0
  const ramp = (v, at) => {
    if (at <= cur + 0.002) return
    for (const p of params) p.exponentialRampToValueAtTime(Math.max(1, v), at)
    cur = at
  }

  let from = freq * 0.97
  if (gi) {
    from = fromFreq
      ? Math.min(freq * SEMI(5), Math.max(freq * SEMI(-5), fromFreq))
      : freq * SEMI(-2)
  }
  for (const p of params) p.setValueAtTime(Math.max(1, from), t0)
  ramp(freq, t0 + (gi ? Math.min(0.16, dur * 0.35) : Math.min(0.06, dur * 0.2)))

  if (bd) {
    ramp(freq * SEMI(bd), t0 + dur * 0.35)
    ramp(freq, t0 + dur * 0.7)
  }

  if (go === 'off') {
    ramp(freq, tEnd - dur * 0.25)
    ramp(freq * SEMI(-3), tEnd)
  } else if (go === 'to' && nextFreq) {
    ramp(freq, tEnd - dur * 0.3)
    ramp(nextFreq, tEnd)
  }
}

function makeLegacyHandle({ ac, nodes, freqParams, amp, lp, lfoG, gain, vb, dur, freq }) {
  let end = ac.currentTime + dur
  let base = freq
  let dead = false

  const stopAt = (at) => {
    for (const n of nodes) {
      try { n.stop(at) } catch { /* already past its stop time */ }
    }
  }
  stopAt(end + 0.08)

  return {
    get dead() { return dead },
    get endsAt() { return end },
    get midiFreq() { return base },

    glideTo(midi, glideSec = 0, delaySec = 0) {
      if (dead) return
      const at = ac.currentTime + Math.max(0, delaySec)
      const to = freqOfMidi(midi)
      const span = Math.max(0.005, glideSec)
      for (const p of freqParams) {
        holdParam(p, at)
        p.exponentialRampToValueAtTime(Math.max(1, to), at + span)
      }
      holdParam(lp.frequency, at)
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, to * 3.6), at + span)
      if (lfoG) lfoG.gain.setTargetAtTime(to * VIB_DEPTH[vb], at, 0.08)
      base = to
    },

    extendTo(durSec) {
      if (dead) return
      const now = ac.currentTime
      const tEnd = now + Math.max(0.06, durSec)
      const rel = Math.min(0.12, durSec * 0.3)
      holdParam(amp.gain, now)
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.82), Math.max(now + 0.01, tEnd - rel))
      amp.gain.exponentialRampToValueAtTime(0.0001, tEnd)
      end = tEnd
      stopAt(end + 0.08)
    },

    release(fade = 0.09) {
      if (dead) return
      dead = true
      const now = ac.currentTime
      const f = Math.max(0.02, fade)
      holdParam(amp.gain, now)
      amp.gain.exponentialRampToValueAtTime(0.0001, now + f)
      end = now + f
      stopAt(end + 0.05)
    },
  }
}

let bawuWave = null
function getBawuWave(ac) {
  if (!bawuWave) {
    const partials = [0, 1, 0.5, 0.62, 0.28, 0.32, 0.24, 0.28, 0.12, 0.08, 0.06, 0.04, 0.03]
    const real = new Float32Array(partials.length)
    const imag = Float32Array.from(partials)
    bawuWave = ac.createPeriodicWave(real, imag)
  }
  return bawuWave
}

let noiseBuf = null
function getNoiseBuf(ac) {
  if (!noiseBuf) {
    const len = ac.sampleRate
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

export function playLegacyTone(ac, midi, dur, gainLevel, shape) {
  const t0 = ac.currentTime
  const freq = freqOfMidi(midi)
  const tEnd = t0 + dur
  const atk = Math.min(0.07, dur * 0.22)
  const rel = Math.min(0.12, dur * 0.3)
  const wave = getBawuWave(ac)
  const vb = shape.vb
  const pitch = {
    gi: shape.gi,
    go: shape.go,
    bd: shape.bd,
    fromFreq: shape.fromMidi != null ? freqOfMidi(shape.fromMidi) : 0,
    nextFreq: shape.nextMidi != null ? freqOfMidi(shape.nextMidi) : 0,
  }

  const osc1 = ac.createOscillator()
  const osc2 = ac.createOscillator()
  osc1.setPeriodicWave(wave)
  osc2.setPeriodicWave(wave)
  osc2.detune.value = 7

  const freqParams = [osc1.frequency, osc2.frequency]
  schedulePitch(freqParams, freq, t0, dur, pitch)

  const lfo = ac.createOscillator()
  const lfoG = ac.createGain()
  lfo.frequency.value = VIB_RATE[vb]
  lfoG.gain.setValueAtTime(0, t0)
  lfoG.gain.linearRampToValueAtTime(freq * VIB_DEPTH[vb], t0 + Math.min(0.35, dur * 0.7))
  lfo.connect(lfoG)
  lfoG.connect(osc1.frequency)
  lfoG.connect(osc2.frequency)

  const mix = ac.createGain()
  const osc2G = ac.createGain()
  osc2G.gain.value = 0.35
  osc1.connect(mix)
  osc2.connect(osc2G)
  osc2G.connect(mix)

  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.7
  lp.frequency.setValueAtTime(freq * 2, t0)
  lp.frequency.exponentialRampToValueAtTime(freq * 4.5, t0 + atk)
  lp.frequency.setTargetAtTime(freq * 3.2, tEnd - rel, rel / 3)
  const formant = ac.createBiquadFilter()
  formant.type = 'peaking'
  formant.frequency.value = 1800
  formant.Q.value = 1.2
  formant.gain.value = 5

  const amp = ac.createGain()
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(gainLevel, t0 + atk)
  amp.gain.exponentialRampToValueAtTime(gainLevel * 0.82, Math.max(t0 + atk + 0.01, tEnd - rel))
  amp.gain.exponentialRampToValueAtTime(0.0001, tEnd)

  const noise = ac.createBufferSource()
  noise.buffer = getNoiseBuf(ac)
  noise.loop = true
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = Math.min(freq * 3, 2400)
  bp.Q.value = 0.8
  const noiseG = ac.createGain()
  noiseG.gain.setValueAtTime(0.0001, t0)
  noiseG.gain.exponentialRampToValueAtTime(gainLevel * 0.22, t0 + atk * 0.6)
  noiseG.gain.exponentialRampToValueAtTime(gainLevel * 0.04, t0 + Math.min(0.2, dur * 0.5))
  noiseG.gain.exponentialRampToValueAtTime(0.0001, tEnd)
  noise.connect(bp)
  bp.connect(noiseG)
  noiseG.connect(amp)

  mix.connect(lp)
  lp.connect(formant)
  formant.connect(amp)
  amp.connect(toneBus(ac))

  osc1.start(t0)
  osc2.start(t0)
  lfo.start(t0)
  noise.start(t0)

  return makeLegacyHandle({
    ac, nodes: [osc1, osc2, lfo, noise], freqParams, amp, lp,
    lfoG, gain: gainLevel, vb, dur, freq,
  })
}
