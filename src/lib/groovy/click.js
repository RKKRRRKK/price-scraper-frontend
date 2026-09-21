// The metronome click, scheduled at an exact AudioContext time.
//
// A woodblock rather than a beep: a short pitched body plus a filtered noise
// tick for the strike, both gone inside 40 ms so the beat lands on a point you
// can actually aim at. Four weights so the bar tells you where you are without
// you having to count.

import { clickBus, noiseBuffer } from './bus'

const VOICES = {
  bar: { body: 2000, drop: 1500, bodyGain: 0.13, tick: 4200, tickGain: 0.07 },
  medium: { body: 1500, drop: 1150, bodyGain: 0.1, tick: 3400, tickGain: 0.05 },
  pulse: { body: 1180, drop: 880, bodyGain: 0.085, tick: 2600, tickGain: 0.042 },
  sub: { body: 880, drop: 720, bodyGain: 0.03, tick: 2000, tickGain: 0.016 },
}

export function scheduleClick(ac, when, kind = 'pulse') {
  const v = VOICES[kind] || VOICES.pulse
  const t0 = Math.max(when, ac.currentTime)
  const out = clickBus(ac)

  const osc = ac.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(v.body, t0)
  osc.frequency.exponentialRampToValueAtTime(v.drop, t0 + 0.03)
  const og = ac.createGain()
  og.gain.setValueAtTime(v.bodyGain, t0)
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035)
  osc.connect(og)
  og.connect(out)

  const tick = ac.createBufferSource()
  tick.buffer = noiseBuffer(ac)
  tick.loop = true
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = v.tick
  bp.Q.value = 1.1
  const tg = ac.createGain()
  tg.gain.setValueAtTime(v.tickGain, t0)
  tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.012)
  tick.connect(bp)
  bp.connect(tg)
  tg.connect(out)

  osc.start(t0)
  osc.stop(t0 + 0.05)
  tick.start(t0)
  tick.stop(t0 + 0.05)
}
