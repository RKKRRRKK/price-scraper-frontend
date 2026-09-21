// A three-piece synthesised kit — kick, snare, closed hat — scheduled at exact
// AudioContext times by the transport.
//
// Not trying to sound like a real drummer: trying to give the pulse a body so
// you can lock to a groove instead of a naked click. Every voice decays fast
// and stays out of the bass guitar's way above the kick.

import { drumBus, noiseBuffer } from './bus'

export function scheduleKick(ac, when, gain = 1) {
  const t0 = Math.max(when, ac.currentTime)
  const out = drumBus(ac)

  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(132, t0)
  osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.09)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.85 * gain, t0 + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32)
  osc.connect(g)
  g.connect(out)
  osc.start(t0)
  osc.stop(t0 + 0.36)

  // The beater. Without it the kick is a boom with no front edge.
  const clickSrc = ac.createBufferSource()
  clickSrc.buffer = noiseBuffer(ac)
  clickSrc.loop = true
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 1400
  const cg = ac.createGain()
  cg.gain.setValueAtTime(0.09 * gain, t0)
  cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.02)
  clickSrc.connect(hp)
  hp.connect(cg)
  cg.connect(out)
  clickSrc.start(t0)
  clickSrc.stop(t0 + 0.04)
}

export function scheduleSnare(ac, when, gain = 1) {
  const t0 = Math.max(when, ac.currentTime)
  const out = drumBus(ac)

  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  src.loop = true
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1900
  bp.Q.value = 0.7
  const ng = ac.createGain()
  ng.gain.setValueAtTime(0.42 * gain, t0)
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17)
  src.connect(bp)
  bp.connect(ng)
  ng.connect(out)
  src.start(t0)
  src.stop(t0 + 0.2)

  // Two detuned tones give the shell its pitch; without them it is just hiss.
  for (const [f, level] of [
    [186, 0.16],
    [332, 0.1],
  ]) {
    const osc = ac.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = f
    const g = ac.createGain()
    g.gain.setValueAtTime(level * gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1)
    osc.connect(g)
    g.connect(out)
    osc.start(t0)
    osc.stop(t0 + 0.12)
  }
}

export function scheduleHat(ac, when, gain = 1, accent = false) {
  const t0 = Math.max(when, ac.currentTime)
  const out = drumBus(ac)

  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  src.loop = true
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 7200
  const g = ac.createGain()
  g.gain.setValueAtTime((accent ? 0.16 : 0.1) * gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + (accent ? 0.055 : 0.04))
  src.connect(hp)
  hp.connect(g)
  g.connect(out)
  src.start(t0)
  src.stop(t0 + 0.08)
}
