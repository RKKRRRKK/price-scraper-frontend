// The measurement pulse used by the loopback test.
//
// It has to satisfy both halves of the onset detector at once, which rules out
// the metronome click. The detector fires on a transient in a band *above*
// 350 Hz, but only when a band *below* ~200 Hz also has energy — that low-band
// requirement is what stops fret buzz and stray clicks counting as notes. The
// click is all high frequency and would be rejected; a plain low sine has no
// transient to detect.
//
// So the probe is deliberately built like a plucked bass note: a low body for
// the detector's low-band gate, and a short bright tick on top for its
// transient detector. Both start at exactly the same instant, and the attack is
// as close to a step as an oscillator can manage, so the detector's backtracking
// has a sharp foot to find. Nothing here is meant to sound nice — it is a ruler.

import { clickBus, noiseBuffer } from './bus'

export function scheduleProbe(ac, when) {
  const t0 = Math.max(when, ac.currentTime)
  const out = clickBus(ac)

  // Body: a low tone, loud and brief. This is what the low-band gate sees.
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(140, t0)
  osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.05)
  const og = ac.createGain()
  og.gain.setValueAtTime(0.0001, t0)
  og.gain.exponentialRampToValueAtTime(0.5, t0 + 0.001)
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09)
  osc.connect(og)
  og.connect(out)

  // Tick: broadband noise through a band-pass, gone in 8 ms. This is what the
  // transient detector sees, and what gives the pulse its sharp edge.
  const tick = ac.createBufferSource()
  tick.buffer = noiseBuffer(ac)
  tick.loop = true
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1200
  bp.Q.value = 0.8
  const tg = ac.createGain()
  tg.gain.setValueAtTime(0.3, t0)
  tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.008)
  tick.connect(bp)
  bp.connect(tg)
  tg.connect(out)

  osc.start(t0)
  osc.stop(t0 + 0.12)
  tick.start(t0)
  tick.stop(t0 + 0.02)
}

// Detector settings for the duration of a loopback test. The probe is loud and
// clean, so the gate can come down; the long refractory stops the body's decay
// registering as a second hit.
export const PROBE_DETECTOR_CONFIG = {
  ratio: 1.6,
  gate: 0.004,
  refractoryMs: 350,
}
