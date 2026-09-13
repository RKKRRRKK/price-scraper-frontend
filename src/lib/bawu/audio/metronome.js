// The metronome click. Deliberately dry — it goes straight to the destination
// rather than through the reverb bus, because a click with a tail on it smears
// the exact thing you are trying to play against.

import { ensureAudio } from './context'
import { noiseBuffer } from './tables'

export function playClick(accent = false) {
  const ac = ensureAudio()
  if (!ac) return
  const t0 = ac.currentTime
  const out = ac.createGain()
  out.gain.value = accent ? 0.9 : 0.62
  out.connect(ac.destination)

  // A woodblock rather than a beep: a short pitched body plus a filtered noise
  // tick for the strike. Both decay inside 40 ms so the beat lands on a point.
  const osc = ac.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(accent ? 1750 : 1180, t0)
  osc.frequency.exponentialRampToValueAtTime(accent ? 1250 : 880, t0 + 0.03)
  const og = ac.createGain()
  og.gain.setValueAtTime(accent ? 0.1 : 0.07, t0)
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035)
  osc.connect(og)
  og.connect(out)

  const tick = ac.createBufferSource()
  tick.buffer = noiseBuffer(ac)
  tick.loop = true
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = accent ? 3600 : 2600
  bp.Q.value = 1.1
  const tg = ac.createGain()
  tg.gain.setValueAtTime(accent ? 0.055 : 0.038, t0)
  tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.012)
  tick.connect(bp)
  bp.connect(tg)
  tg.connect(out)

  osc.start(t0)
  osc.stop(t0 + 0.05)
  tick.start(t0)
  tick.stop(t0 + 0.05)
}
