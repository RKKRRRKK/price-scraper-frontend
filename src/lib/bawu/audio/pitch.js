// Mic pitch tracking.
//
// Normalized square-difference autocorrelation (McLeod's NSDF): the curve is
// scaled by the window's own energy, so a soft breath reads the same as a loud
// one — the old fixed-amplitude silence trim threw away every window whose
// peak stayed under 0.2, which is most of a quiet bawu note. The height of the
// chosen peak doubles as a clarity score (1 = perfectly periodic, breath noise
// sits well below), which is what separates a note from hiss.

import { midiFloatOfFreq, noteOfFreq } from '../notes'
import { ensureAudio } from './context'
import { acquireMic, releaseMic } from './mic'

const MIN_RMS = 0.003 // below this it's the room, not the instrument
const MIN_CLARITY = 0.5 // NSDF peak a window needs to count as pitched
const PEAK_K = 0.9 // first key peak within this much of the best wins (avoids octave-down)
const F_MIN = 150
const F_MAX = 1600

function detectPitch(buf, sampleRate) {
  const N = buf.length
  let rms = 0
  for (let i = 0; i < N; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / N)
  if (rms < MIN_RMS) return { freq: -1, rms, clarity: 0 }

  const minLag = Math.floor(sampleRate / F_MAX)
  const maxLag = Math.min(N >> 1, Math.ceil(sampleRate / F_MIN))
  const nsdf = new Float32Array(maxLag + 2)
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let acf = 0
    let m = 0
    for (let i = 0; i < N - lag; i++) {
      const a = buf[i]
      const b = buf[i + lag]
      acf += a * b
      m += a * a + b * b
    }
    nsdf[lag] = m > 0 ? (2 * acf) / m : 0
  }

  // Key maxima: the highest point of each positive lobe after the curve first
  // dips below zero (the lobe at lag 0 is the signal matching itself).
  const peaks = []
  let lag = 1
  while (lag <= maxLag && nsdf[lag] > 0) lag++
  let best = -1
  let bestPos = -1
  for (; lag <= maxLag; lag++) {
    if (nsdf[lag] > 0) {
      if (nsdf[lag] > best) { best = nsdf[lag]; bestPos = lag }
    } else if (bestPos > 0) {
      peaks.push(bestPos)
      best = -1
      bestPos = -1
    }
  }
  if (bestPos > 0) peaks.push(bestPos)
  const usable = peaks.filter((p) => p >= minLag)
  if (!usable.length) return { freq: -1, rms, clarity: 0 }

  let top = 0
  for (const p of usable) top = Math.max(top, nsdf[p])
  const T = usable.find((p) => nsdf[p] >= PEAK_K * top)
  const clarity = nsdf[T]
  if (clarity < MIN_CLARITY) return { freq: -1, rms, clarity }

  // Parabolic refinement around the integer lag.
  const x1 = nsdf[T - 1]
  const x2 = nsdf[T]
  const x3 = nsdf[T + 1]
  const a = (x1 + x3 - 2 * x2) / 2
  const shift = a ? (x1 - x3) / (4 * a) : 0
  const freq = sampleRate / (T + shift)
  if (freq < F_MIN || freq > F_MAX) return { freq: -1, rms, clarity }
  return { freq, rms, clarity }
}

// Starts the mic and calls onPitch(~30/s) with either null (silence) or
// { freq, midiFloat, midi, name, cents, rms, clarity }.
export class PitchTracker {
  constructor() {
    this.running = false
    this._raf = 0
    this._analyser = null
    this._source = null
  }

  async start(onPitch) {
    if (this.running) return
    const ac = ensureAudio()
    if (!ac) throw new Error('Web Audio is not available in this browser.')
    const stream = await acquireMic()
    this.running = true
    this._analyser = ac.createAnalyser()
    this._analyser.fftSize = 2048
    this._source = ac.createMediaStreamSource(stream)
    this._source.connect(this._analyser)
    const buf = new Float32Array(this._analyser.fftSize)
    let last = 0
    const tick = (ts) => {
      if (!this.running) return
      this._raf = requestAnimationFrame(tick)
      if (ts - last < 33) return // ~30 Hz is plenty
      last = ts
      this._analyser.getFloatTimeDomainData(buf)
      const { freq, rms, clarity } = detectPitch(buf, ac.sampleRate)
      if (freq <= 0) {
        onPitch(null, rms)
      } else {
        const midiFloat = midiFloatOfFreq(freq)
        const info = noteOfFreq(freq)
        onPitch({ freq, midiFloat, midi: info.midi, name: info.name, cents: info.cents, rms, clarity })
      }
    }
    this._raf = requestAnimationFrame(tick)
  }

  stop() {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this._raf)
    try { this._source?.disconnect() } catch { /* already gone */ }
    this._source = null
    this._analyser = null
    releaseMic()
  }
}
