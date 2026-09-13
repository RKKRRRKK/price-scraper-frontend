// The shared output bus: a dry path plus a convolution hall, into a master
// compressor. Synth voices play into `toneBus()`; the metronome click stays dry
// on purpose so it never smears the beat.

let reverbWet = 1.25 // wet-mix gain when reverb is on — tunable from the UI slider
let reverbOn = false
let bus = null // { input, wet }

export function setReverbEnabled(on) {
  reverbOn = !!on
  if (bus) bus.wet.gain.value = reverbOn ? reverbWet : 0
}

// Set how much reverb is mixed in (0 = dry, ~2.5 = cavernous). Applies live.
export function setReverbLevel(gain) {
  reverbWet = Math.max(0, gain)
  if (bus && reverbOn) bus.wet.gain.value = reverbWet
}

export function isReverbEnabled() {
  return reverbOn
}

// Discrete early reflections: millisecond offset and (signed) strength. These
// few taps in the first 60 ms are what tell the ear how big the room is —
// without them a noise tail alone sounds like a effect rather than a space.
const EARLY = [
  [11, 0.44], [17, -0.36], [23, 0.3], [29, -0.25],
  [37, 0.21], [43, -0.18], [53, 0.15], [61, 0.12],
]

// A hall impulse with frequency-dependent decay: the noise is run through a
// one-pole lowpass whose damping deepens as the tail goes on, so highs die away
// first the way they do in a real room with real surfaces in it. Flat white
// noise decaying at one rate across the spectrum is the classic tinny
// convolution-reverb sound, and this is the fix.
//
// The two channels are generated independently, which gives the tail a wide
// stereo image from a mono source.
function makeHallImpulse(ac, seconds = 3.4, decay = 2.3) {
  const rate = ac.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ac.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let y = 0
    for (let i = 0; i < len; i++) {
      const p = i / len
      const k = 0.86 - 0.73 * p // lowpass coefficient: opens bright, closes dark
      y += k * (Math.random() * 2 - 1 - y)
      // A one-pole eats level as it closes; undo that so `decay` alone shapes
      // the tail and the damping only changes its colour.
      const makeup = Math.sqrt((2 - k) / k)
      const build = Math.min(1, i / (rate * 0.008)) // ~8 ms, so the onset isn't a click
      d[i] = y * makeup * build * Math.pow(1 - p, decay)
    }
    // Early reflections, spread slightly differently per channel and each a few
    // samples wide so they read as reflections rather than digital clicks.
    for (const [ms, g] of EARLY) {
      const at = Math.floor(rate * (ms / 1000) * (ch ? 1.07 : 0.94))
      for (let j = 0; j < 4 && at + j < len; j++) {
        d[at + j] += g * (ch ? -1 : 1) * (1 - j / 4) * (Math.random() * 0.4 + 0.8)
      }
    }
  }
  return buf
}

export function toneBus(ac) {
  if (!bus) {
    const input = ac.createGain()

    // Master bus → gentle compressor → speakers, so a strong wet tail stays
    // clean instead of clipping when notes pile up.
    const master = ac.createGain()
    const comp = ac.createDynamicsCompressor()
    comp.threshold.value = -15
    comp.knee.value = 26
    comp.ratio.value = 3
    comp.attack.value = 0.008
    comp.release.value = 0.28
    master.connect(comp)
    comp.connect(ac.destination)

    // Dry path.
    input.connect(master)

    // Wet path. The send is trimmed before the convolver — bass out of the
    // reverb turns to mud, and the very top only adds hiss — then pre-delayed
    // so the direct sound arrives on its own first and the room answers.
    const send = ac.createBiquadFilter()
    send.type = 'highpass'
    send.frequency.value = 190
    send.Q.value = 0.6
    const damp = ac.createBiquadFilter()
    damp.type = 'lowpass'
    damp.frequency.value = 7200
    damp.Q.value = 0.5
    const pre = ac.createDelay(0.25)
    pre.delayTime.value = 0.028
    const convolver = ac.createConvolver()
    convolver.buffer = makeHallImpulse(ac)
    const wet = ac.createGain()
    wet.gain.value = reverbOn ? reverbWet : 0

    input.connect(send)
    send.connect(damp)
    damp.connect(pre)
    pre.connect(convolver)
    convolver.connect(wet)
    wet.connect(master)

    bus = { input, wet }
  }
  return bus.input
}
