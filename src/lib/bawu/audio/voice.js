// The modeled bawu voice: pick of the two, and the one the expression work is
// aimed at.
//
// Signal flow, in one picture:
//
//   pitchBus ──┐                            ┌─→ osc1/2/3 .detune
//   breath   ──┼─→ pitchSum ────────────────┤
//   vibrato  ──┘        │                   └─→ brightSum ──→ lowpass.detune
//                       │   brightBus ──────────↗      ↑
//                       └───────────────────────┘      │
//                           breath / vibrato ──────────┘
//
//   osc1+2+3 → lowpass → body → presence → air ─┐
//   breath noise → bandpass ────────────────────┼→ AM → envelope → artic → out
//   attack chiff ─────────────────────────────────────────────────────────↗
//
// Pitch lives on a single cents bus everything hangs off, so one glide moves
// the oscillators, the body filter and the vibrato depth together and they can
// never drift out of agreement — which is the whole reason bends and slides
// come out sounding like one instrument rather than three things sweeping.

import { freqOfMidi } from '../notes'
import { ensureAudio } from './context'
import { toneBus } from './reverb'
import { reedWave, edgeWave, noiseBuffer, phaseSine, flutterWave, registerOf } from './tables'
import { rand, jitter, clamp } from './params'
import { applyExpression, VIB } from './expression'
import { makeHandle } from './handle'
import { playClassicTone } from './classic'
import { playLegacyTone } from './legacy'

// The transport's voice picker:
//   'real'    the modeled free-reed voice — the one everything here is about
//   'legacy'  the previous modeled voice, kept so the two can be A/B'd
//   'classic' the original sawtooth
//   'mute'    no synth at all (practice along to just the metronome/mic)
const VOICES = new Set(['real', 'legacy', 'classic', 'mute'])
let bawuVoice = 'real'

export function setBawuVoice(name) {
  bawuVoice = VOICES.has(name) ? name : 'real'
}

export function playBawuTone(midi, dur = 0.45, opts = {}) {
  const ac = ensureAudio()
  if (!ac || midi == null || bawuVoice === 'mute') return null
  const shape = {
    midi,
    gi: opts.gi ? 1 : 0,
    go: opts.go || '',
    bd: Number(opts.bd) || 0,
    vb: clamp(Math.round(Number(opts.vb) || 0), 0, 3),
    fromMidi: Number.isFinite(opts.fromMidi) ? opts.fromMidi : null,
    nextMidi: Number.isFinite(opts.nextMidi) ? opts.nextMidi : null,
  }
  const level = Number.isFinite(opts.gain) ? opts.gain : 0.18
  if (bawuVoice === 'classic') return playClassicTone(ac, midi, dur, level, shape)
  if (bawuVoice === 'legacy') return playLegacyTone(ac, midi, dur, level, shape)
  return playReedTone(ac, midi, dur, level, shape)
}

const BLOOM = 1.07 // the small swell as the reed takes the air, before it settles

function playReedTone(ac, midi, dur, level, shape) {
  // A few milliseconds of lead time so the first ramps land in the future even
  // if the audio thread is part-way through a block.
  const t0 = ac.currentTime + 0.003
  const tEnd = t0 + dur
  const f0 = freqOfMidi(midi)
  const reg = registerOf(midi)
  const vb = shape.vb
  const flutter = vb === 3

  // ── Pitch bus, in cents ───────────────────────────────────────────────────
  const pitchBus = ac.createConstantSource()
  pitchBus.offset.value = 0
  const pitchSum = ac.createGain()
  pitchBus.connect(pitchSum)

  // ── Tone-colour bus, also in cents, riding on top of the pitch ────────────
  const brightBus = ac.createConstantSource()
  brightBus.offset.value = 0
  const brightSum = ac.createGain()
  brightBus.connect(brightSum)
  pitchSum.connect(brightSum) // the body follows the note wherever it goes

  // ── Breath ────────────────────────────────────────────────────────────────
  // Two slow, phase-randomised oscillators at unrelated rates stand in for an
  // airstream nobody can hold perfectly steady. Their sum never quite repeats,
  // which matters on the long held notes the fingering axis produces.
  const breath = ac.createOscillator()
  breath.setPeriodicWave(phaseSine(ac, rand(0, Math.PI * 2)))
  breath.frequency.value = rand(0.45, 0.85)
  const drift = ac.createOscillator()
  drift.setPeriodicWave(phaseSine(ac, rand(0, Math.PI * 2)))
  drift.frequency.value = rand(0.17, 0.31)

  const tap = (src, amount, dest) => {
    const g = ac.createGain()
    g.gain.value = amount
    src.connect(g)
    g.connect(dest)
    return g
  }
  tap(breath, rand(3, 6), pitchSum)
  tap(drift, rand(3, 7), pitchSum)
  tap(breath, 115, brightSum)
  tap(drift, 85, brightSum)

  // ── Vibrato ───────────────────────────────────────────────────────────────
  // One LFO, three destinations. Pitch alone is the tell-tale synth vibrato;
  // real vibrato is a breath gesture, so the loudness and the colour move with
  // it. Flutter tongue (vb 3) is the same rig with the balance thrown almost
  // entirely onto the amplitude — the airstream is being interrupted, not bent.
  const vibLfo = ac.createOscillator()
  vibLfo.setPeriodicWave(flutter ? flutterWave(ac) : phaseSine(ac, rand(0, Math.PI * 2)))
  vibLfo.frequency.value = jitter(VIB.rate[vb], 0.07)

  const vibDelay = flutter ? 0.05 : jitter(Math.min(0.3, dur * 0.55), 0.3)
  // Vibrato fades in after the onset instead of being switched on with the note.
  const vibTap = (amount, dest) => {
    const g = ac.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(amount, t0 + vibDelay)
    vibLfo.connect(g)
    g.connect(dest)
    return g
  }
  vibTap(jitter(VIB.cents[vb], 0.12), pitchSum)
  vibTap(VIB.bright[vb], brightSum)

  // ── Oscillators ───────────────────────────────────────────────────────────
  // Two copies of the register's reed spectrum a few cents apart give the slow
  // beating a free reed has, and a third, brighter layer underneath at a level
  // that rises and falls with the breath so the edge of the tone is never
  // static.
  const wave = reedWave(ac, midi)
  const osc1 = ac.createOscillator()
  const osc2 = ac.createOscillator()
  const osc3 = ac.createOscillator()
  osc1.setPeriodicWave(wave)
  osc2.setPeriodicWave(wave)
  osc3.setPeriodicWave(edgeWave(ac, midi))
  for (const o of [osc1, osc2, osc3]) {
    o.frequency.value = f0
    pitchSum.connect(o.detune)
  }
  osc1.detune.value = rand(-3, 3) // no two notes start dead in tune
  osc2.detune.value = rand(5.5, 8)
  osc3.detune.value = rand(-6, -3.5)

  const oscMix = ac.createGain()
  oscMix.gain.value = 0.42
  const osc2G = ac.createGain()
  osc2G.gain.value = 0.4
  const edgeG = ac.createGain()
  edgeG.gain.value = 0.11 * (1 - 0.4 * reg)
  tap(breath, 0.045, edgeG.gain) // the buzz comes and goes with the air
  osc1.connect(oscMix)
  osc2.connect(osc2G).connect(oscMix)
  osc3.connect(edgeG).connect(oscMix)

  // ── Body ──────────────────────────────────────────────────────────────────
  // The lowpass is placed once, in hertz, from the note's own register;
  // everything that moves it afterwards — the attack opening up, the breath,
  // vibrato, a bend darkening the tone, a glide — arrives as cents on its
  // detune, so it tracks pitch for free.
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.85
  lp.frequency.value = Math.min(16000, f0 * (8.5 - 3.2 * reg))
  brightSum.connect(lp.detune)

  // Two fixed resonances: the body's nasal core and the reed's edge above it.
  // These belong to the instrument rather than the note, so they never move —
  // which is exactly what makes a glide sound like one instrument sliding
  // instead of a filter sweep following it around.
  const body = ac.createBiquadFilter()
  body.type = 'peaking'
  body.frequency.value = 1050 + 350 * reg
  body.Q.value = 1.4
  body.gain.value = 6 - 2 * reg
  const presence = ac.createBiquadFilter()
  presence.type = 'peaking'
  presence.frequency.value = 2350 + 450 * reg
  presence.Q.value = 2.4
  presence.gain.value = 4 - 2.5 * reg
  const air = ac.createBiquadFilter()
  air.type = 'highshelf'
  air.frequency.value = 5200
  air.gain.value = -7 + 3 * reg

  // ── Breath noise ──────────────────────────────────────────────────────────
  // Chuffy at the attack, then a faint bed under the tone. Flutter tongue sits
  // on a louder bed, since the rattle is largely air.
  const noise = ac.createBufferSource()
  noise.buffer = noiseBuffer(ac)
  noise.loop = true
  noise.playbackRate.value = rand(0.94, 1.06)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = clamp(f0 * 2.4, 800, 3400)
  bp.Q.value = 0.7
  const noiseG = ac.createGain()
  const bed = flutter ? 0.15 : 0.07
  let ncur = t0
  const nat = (x) => (ncur = Math.max(ncur + 0.005, x))
  noiseG.gain.setValueAtTime(0.0001, t0)
  noiseG.gain.exponentialRampToValueAtTime(shape.gi ? 0.12 : 0.3, nat(t0 + 0.02))
  noiseG.gain.exponentialRampToValueAtTime(bed, nat(t0 + Math.min(0.22, dur * 0.5)))
  noiseG.gain.setValueAtTime(bed, nat(tEnd - 0.09))
  // A note falls away breathier than it started: the tone goes before the air.
  noiseG.gain.exponentialRampToValueAtTime(bed * (shape.go === 'off' ? 2.2 : 0.6), nat(tEnd))

  // ── Amplitude ─────────────────────────────────────────────────────────────
  const am = ac.createGain() // vibrato / flutter tremolo, centred on 1
  am.gain.value = 1
  vibTap(VIB.amp[vb], am.gain)
  tap(breath, 0.05, am.gain)

  const amp = ac.createGain() // the note envelope, normalised to ~1
  const artic = ac.createGain() // transition dips written by expression.js
  artic.gain.value = 1
  const out = ac.createGain() // the one place absolute level is set
  out.gain.value = level / (1 + VIB.amPeak[vb] + 0.05)

  // Attack, a small bloom as the reed takes the air, a gentle sag through the
  // sustain, then the release. A fall-off decays earlier and longer, because
  // the breath is already on its way out.
  const atk = jitter(shape.gi ? Math.min(0.09, dur * 0.3) : Math.min(0.055, dur * 0.26), 0.18)
  const rel = shape.go === 'off' ? Math.min(0.3, dur * 0.45) : Math.min(0.13, dur * 0.32)
  let acur = t0
  const aat = (x) => (acur = Math.max(acur + 0.006, x))
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(BLOOM, aat(t0 + atk))
  amp.gain.exponentialRampToValueAtTime(1, aat(t0 + atk + Math.min(0.1, dur * 0.25)))
  amp.gain.exponentialRampToValueAtTime(0.9, aat(tEnd - rel))
  amp.gain.exponentialRampToValueAtTime(0.0001, aat(tEnd))

  oscMix.connect(lp)
  lp.connect(body)
  body.connect(presence)
  presence.connect(air)
  air.connect(am)
  noise.connect(bp).connect(noiseG).connect(am)
  am.connect(amp)
  amp.connect(artic)
  artic.connect(out)

  // A hair of stereo placement per note. Far too small to hear as movement, but
  // it stops a run of notes stacking in exactly the same spot.
  if (ac.createStereoPanner) {
    const pan = ac.createStereoPanner()
    pan.pan.value = rand(-0.07, 0.07)
    out.connect(pan)
    pan.connect(toneBus(ac))
  } else {
    out.connect(toneBus(ac))
  }

  // ── Attack chiff ──────────────────────────────────────────────────────────
  // The tongued "tuh" ahead of the tone. Skipped on a gliss-in, which is a
  // legato arrival with nothing to tongue, and it bypasses the note envelope
  // because the transient has to be there before the tone is.
  if (!shape.gi) {
    const chiff = ac.createBufferSource()
    chiff.buffer = noiseBuffer(ac)
    chiff.loop = true
    const cbp = ac.createBiquadFilter()
    cbp.type = 'bandpass'
    cbp.frequency.value = rand(2200, 3200)
    cbp.Q.value = 0.7
    const cg = ac.createGain()
    cg.gain.setValueAtTime(0.0001, t0)
    cg.gain.exponentialRampToValueAtTime(jitter(0.35, 0.25) * (1 - 0.35 * reg), t0 + 0.006)
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + jitter(0.05, 0.3))
    chiff.connect(cbp).connect(cg).connect(out)
    chiff.start(t0)
    chiff.stop(t0 + 0.15)
  }

  applyExpression(
    { pitch: pitchBus.offset, bright: brightBus.offset, artic: artic.gain },
    shape, t0, dur,
  )

  const nodes = [osc1, osc2, osc3, breath, drift, vibLfo, noise, pitchBus, brightBus]
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
