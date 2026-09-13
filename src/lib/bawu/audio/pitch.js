// Mic pitch tracking.
//
// Time-domain autocorrelation (the classic ACF2+ approach): trims silence,
// finds the lag with the best correlation, refines with parabolic
// interpolation. Solid for a monophonic wind instrument.

import { midiFloatOfFreq, noteOfFreq } from '../notes'
import { ensureAudio } from './context'
import { acquireMic, releaseMic } from './mic'

function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length
  let rms = 0
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / SIZE)
  if (rms < 0.008) return { freq: -1, rms }

  let r1 = 0
  let r2 = SIZE - 1
  const thres = 0.2
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i } else break
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i } else break
  const b = buf.slice(r1, r2)
  const N = b.length
  if (N < 32) return { freq: -1, rms }

  const c = new Float32Array(N)
  for (let lag = 0; lag < N; lag++) {
    let sum = 0
    for (let i = 0; i < N - lag; i++) sum += b[i] * b[i + lag]
    c[lag] = sum
  }

  let d = 0
  while (d < N - 1 && c[d] > c[d + 1]) d++
  let maxval = -1
  let maxpos = -1
  for (let i = d; i < N; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i }
  }
  if (maxpos <= 0) return { freq: -1, rms }
  let T0 = maxpos

  const x1 = c[T0 - 1] ?? c[T0]
  const x2 = c[T0]
  const x3 = c[T0 + 1] ?? c[T0]
  const a = (x1 + x3 - 2 * x2) / 2
  const bb = (x3 - x1) / 2
  if (a) T0 = T0 - bb / (2 * a)

  const freq = sampleRate / T0
  if (freq < 60 || freq > 2000) return { freq: -1, rms }
  return { freq, rms }
}

// Starts the mic and calls onPitch(~30/s) with either null (silence) or
// { freq, midiFloat, midi, name, cents, rms }.
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
      const { freq, rms } = autoCorrelate(buf, ac.sampleRate)
      if (freq <= 0) {
        onPitch(null)
      } else {
        const midiFloat = midiFloatOfFreq(freq)
        const info = noteOfFreq(freq)
        onPitch({ freq, midiFloat, midi: info.midi, name: info.name, cents: info.cents, rms })
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
