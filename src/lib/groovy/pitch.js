// Pitch tracking for the roll, tuned for a bass rather than a voice.
//
// A four-string bass runs from E1 (41 Hz) to roughly G3, and a five-string adds
// B0 at 31 Hz. Autocorrelating that directly means a long window and a lot of
// lags, so the signal is decimated to ~12 kHz first — a bass has nothing worth
// hearing above 400 Hz for pitch purposes, and the whole search then fits in a
// few hundred lags. Normalised correlation lets us reject noise honestly, and
// taking the *shortest* lag that is nearly as good as the best one stops the
// tracker reporting an octave too low, which is the classic failure here.
//
// This is display-only. Timing never depends on it.

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export function midiFloatOfFreq(freq) {
  return 69 + 12 * Math.log2(freq / 440)
}

export function noteNameOfMidi(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}

export function freqOfMidi(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

const MIN_HZ = 28
const MAX_HZ = 420

export class BassPitchTracker {
  constructor() {
    this.running = false
    this._raf = 0
    this._analyser = null
    this._buf = null
    this._dec = null
  }

  // onPitch(null) on silence, otherwise
  // { freq, midiFloat, midi, name, cents, clarity, rms }.
  start(ac, source, onPitch) {
    if (this.running) return
    this._analyser = ac.createAnalyser()
    this._analyser.fftSize = 4096
    this._analyser.smoothingTimeConstant = 0
    source.connect(this._analyser)
    this._buf = new Float32Array(this._analyser.fftSize)

    const factor = Math.max(2, Math.round(ac.sampleRate / 12000))
    const dsr = ac.sampleRate / factor
    this._dec = new Float32Array(Math.floor(this._analyser.fftSize / factor))

    this.running = true
    let last = 0
    const tick = (ts) => {
      if (!this.running) return
      this._raf = requestAnimationFrame(tick)
      if (ts - last < 28) return // ~35 Hz; the roll cannot show more than that
      last = ts
      this._analyser.getFloatTimeDomainData(this._buf)
      onPitch(analyse(this._buf, this._dec, factor, dsr))
    }
    this._raf = requestAnimationFrame(tick)
  }

  stop() {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this._raf)
    try {
      this._analyser?.disconnect()
    } catch {
      /* already gone */
    }
    this._analyser = null
    this._buf = null
    this._dec = null
  }
}

function analyse(buf, dec, factor, dsr) {
  let rms = 0
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / buf.length)
  if (rms < 0.004) return null

  // Decimate with a box average — it doubles as the anti-alias filter, and a
  // crude one is fine when everything above 400 Hz is being thrown away anyway.
  const n = dec.length
  for (let i = 0; i < n; i++) {
    let s = 0
    const base = i * factor
    for (let k = 0; k < factor; k++) s += buf[base + k]
    dec[i] = s / factor
  }

  // Remove any DC the box average left behind; it biases every correlation up.
  let mean = 0
  for (let i = 0; i < n; i++) mean += dec[i]
  mean /= n
  for (let i = 0; i < n; i++) dec[i] -= mean

  const minLag = Math.max(2, Math.floor(dsr / MAX_HZ))
  const maxLag = Math.min(n - 32, Math.ceil(dsr / MIN_HZ))
  if (maxLag <= minLag) return null

  let best = -1
  let bestLag = -1
  const corr = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0
    let e1 = 0
    let e2 = 0
    const len = n - lag
    for (let i = 0; i < len; i++) {
      const a = dec[i]
      const b = dec[i + lag]
      ac += a * b
      e1 += a * a
      e2 += b * b
    }
    const denom = Math.sqrt(e1 * e2)
    const v = denom > 1e-12 ? ac / denom : 0
    corr[lag] = v
    if (v > best) {
      best = v
      bestLag = lag
    }
  }
  if (bestLag < 0 || best < 0.7) return null

  // Prefer the shortest lag that is almost as good — that is the fundamental,
  // not its octave-down shadow.
  let lag = bestLag
  const accept = best * 0.9
  for (let l = minLag; l < bestLag; l++) {
    if (corr[l] >= accept && corr[l] > corr[l - 1] && corr[l] >= corr[l + 1]) {
      lag = l
      break
    }
  }

  const x1 = corr[lag - 1] ?? corr[lag]
  const x2 = corr[lag]
  const x3 = corr[lag + 1] ?? corr[lag]
  const a = (x1 + x3 - 2 * x2) / 2
  const b = (x3 - x1) / 2
  const refined = a ? lag - b / (2 * a) : lag

  const freq = dsr / refined
  if (!Number.isFinite(freq) || freq < MIN_HZ || freq > MAX_HZ) return null

  const midiFloat = midiFloatOfFreq(freq)
  const midi = Math.round(midiFloat)
  return {
    freq,
    midiFloat,
    midi,
    name: noteNameOfMidi(midi),
    cents: Math.round((midiFloat - midi) * 100),
    clarity: best,
    rms,
  }
}
