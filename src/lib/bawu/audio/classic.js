// The original voice: a reedy sawtooth with vibrato through a lowpass. Kept as
// it was so the two can still be A/B'd from the transport's sound picker, but
// rebuilt on the same cents bus as the modeled voice so slurs, bends and slides
// behave identically — the difference between the two should be the tone, not
// whether the expression marks work.

import { freqOfMidi } from '../notes'
import { toneBus } from './reverb'
import { phaseSine } from './tables'
import { rand } from './params'
import { applyExpression, VIB } from './expression'
import { makeHandle } from './handle'

export function playClassicTone(ac, midi, dur, level, shape) {
  const t0 = ac.currentTime + 0.003
  const tEnd = t0 + dur
  const f0 = freqOfMidi(midi)
  const vb = shape.vb

  const pitchBus = ac.createConstantSource()
  pitchBus.offset.value = 0
  const pitchSum = ac.createGain()
  pitchBus.connect(pitchSum)

  const brightBus = ac.createConstantSource()
  brightBus.offset.value = 0
  const brightSum = ac.createGain()
  brightBus.connect(brightSum)
  pitchSum.connect(brightSum)

  const lfo = ac.createOscillator()
  lfo.setPeriodicWave(phaseSine(ac, rand(0, Math.PI * 2)))
  lfo.frequency.value = VIB.rate[vb]
  const lfoG = ac.createGain()
  lfoG.gain.value = VIB.cents[vb]
  lfo.connect(lfoG)
  lfoG.connect(pitchSum)

  const osc = ac.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = f0
  pitchSum.connect(osc.detune)

  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  // A touch above the original 2.8×, because the shared attack gesture now
  // opens this filter up into the note instead of leaving it parked.
  lp.frequency.value = f0 * 3.2
  brightSum.connect(lp.detune)

  const amp = ac.createGain()
  const artic = ac.createGain()
  artic.gain.value = 1
  const out = ac.createGain()
  out.gain.value = level
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(1, t0 + Math.min(0.04, dur * 0.25))
  amp.gain.exponentialRampToValueAtTime(0.0001, tEnd)

  osc.connect(lp)
  lp.connect(amp)
  amp.connect(artic)
  artic.connect(out)
  out.connect(toneBus(ac))

  applyExpression(
    { pitch: pitchBus.offset, bright: brightBus.offset, artic: artic.gain },
    shape, t0, dur,
  )

  const nodes = [osc, lfo, pitchBus, brightBus]
  for (const n of nodes) n.start(t0)

  return makeHandle({
    ac,
    nodes,
    midi,
    endsAt: tEnd,
    pitch: pitchBus.offset,
    bright: brightBus.offset,
    artic: artic.gain,
    amp: amp.gain,
  })
}
