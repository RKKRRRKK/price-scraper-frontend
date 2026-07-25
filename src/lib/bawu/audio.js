// Bawu audio: synth voice, metronome, mic pitch tracking, take recorder.
//
// One shared AudioContext (created lazily on the first user gesture). The mic
// is opened once and shared by the pitch tracker and the take recorder so the
// browser only prompts once per session.

import { freqOfMidi, midiFloatOfFreq, noteOfFreq } from './notes'

let ctx = null

export function ensureAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// ── Reverb bus ──────────────────────────────────────────────────────────────
// Synth voices play into a shared bus: a dry path plus a convolver (a long,
// dense synthetic hall) fed through a short pre-delay, mixed in hot so the
// reverb reads as a real, spacious room rather than a hint of one. A master
// compressor on the bus soaks up the extra energy so the big wet tail never
// clips. The metronome click stays dry on purpose.
let reverbWet = 1.25 // wet-mix gain when reverb is on — tunable from the UI slider
let reverbOn = false
let reverbBus = null // { input, wet }

export function setReverbEnabled(on) {
  reverbOn = !!on
  if (reverbBus) reverbBus.wet.gain.value = reverbOn ? reverbWet : 0
}

// Set how much reverb is mixed in (0 = dry, ~2.5 = cavernous). Applies live.
export function setReverbLevel(gain) {
  reverbWet = Math.max(0, gain)
  if (reverbBus && reverbOn) reverbBus.wet.gain.value = reverbWet
}

export function isReverbEnabled() {
  return reverbOn
}

// A long, dense impulse = a big room with a long tail. Two decorrelated
// channels give a wide stereo image; a tiny early build-up before the decay
// avoids an unnaturally abrupt onset.
function makeRoomImpulse(ac, seconds = 3.6, decay = 2.1) {
  const rate = ac.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ac.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      const build = Math.min(1, i / (rate * 0.012)) // ~12 ms fade-in
      d[i] = (Math.random() * 2 - 1) * build * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

function toneBus(ac) {
  if (!reverbBus) {
    const input = ac.createGain()

    // Master bus → gentle compressor → speakers, so a strong wet tail stays
    // clean instead of clipping when notes pile up.
    const master = ac.createGain()
    const comp = ac.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 24
    comp.ratio.value = 3
    comp.attack.value = 0.006
    comp.release.value = 0.25
    master.connect(comp)
    comp.connect(ac.destination)

    // Dry path.
    input.connect(master)

    // Wet path: pre-delay → convolver → wet gain, mixed back into the master.
    const pre = ac.createDelay(0.25)
    pre.delayTime.value = 0.025
    const convolver = ac.createConvolver()
    convolver.buffer = makeRoomImpulse(ac)
    const wet = ac.createGain()
    wet.gain.value = reverbOn ? reverbWet : 0
    input.connect(pre)
    pre.connect(convolver)
    convolver.connect(wet)
    wet.connect(master)

    reverbBus = { input, wet }
  }
  return reverbBus.input
}

// ── Synth voices ────────────────────────────────────────────────────────────
// 'real' is the modeled free-reed voice; 'classic' is the original sawtooth,
// kept so the two can be A/B'd from the transport's sound picker. 'mute'
// silences the synth entirely (practice along to just the metronome/mic).
let bawuVoice = 'real'

export function setBawuVoice(name) {
  bawuVoice = name === 'classic' ? 'classic' : name === 'mute' ? 'mute' : 'real'
}

export function playBawuTone(midi, dur = 0.45, gainLevel = 0.18) {
  const ac = ensureAudio()
  if (!ac || midi == null || bawuVoice === 'mute') return
  const freq = freqOfMidi(midi)
  if (bawuVoice === 'classic') playClassicBawu(ac, freq, dur, gainLevel)
  else playRealBawu(ac, freq, dur, gainLevel)
}

// Original voice: a reedy sawtooth with constant vibrato through a lowpass.
function playClassicBawu(ac, freq, dur, gainLevel) {
  const t0 = ac.currentTime
  const osc = ac.createOscillator()
  const filt = ac.createBiquadFilter()
  const gain = ac.createGain()
  const lfo = ac.createOscillator()
  const lfoG = ac.createGain()
  osc.type = 'sawtooth'
  osc.frequency.value = freq
  lfo.frequency.value = 5.2
  lfoG.gain.value = 4.5
  lfo.connect(lfoG)
  lfoG.connect(osc.frequency)
  filt.type = 'lowpass'
  filt.frequency.value = freq * 2.8
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(gainLevel, t0 + 0.04)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(filt)
  filt.connect(gain)
  gain.connect(toneBus(ac))
  osc.start(t0)
  lfo.start(t0)
  osc.stop(t0 + dur + 0.02)
  lfo.stop(t0 + dur + 0.02)
}

// Free-reed harmonic recipe: strong fundamental, both even and odd partials
// (a free reed isn't a closed pipe), a reedy bump around the 5th–7th, then a
// gentle roll-off. Built once per session.
let bawuWave = null
function getBawuWave(ac) {
  if (!bawuWave) {
    const partials = [0, 1, 0.5, 0.62, 0.28, 0.32, 0.24, 0.28, 0.12, 0.08, 0.06, 0.04, 0.03]
    const real = new Float32Array(partials.length)
    const imag = Float32Array.from(partials)
    bawuWave = ac.createPeriodicWave(real, imag)
  }
  return bawuWave
}

// Looped white-noise second for breath. Built once per session.
let noiseBuf = null
function getNoiseBuf(ac) {
  if (!noiseBuf) {
    const len = ac.sampleRate
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

// Modeled voice. What sells it as a bawu rather than an organ patch:
//  - soft ~70 ms attack with a slight pitch scoop up into the note
//  - vibrato that fades in after the onset instead of being always-on
//  - a second oscillator a few cents sharp for the reed's beating shimmer
//  - a nasal formant peak near 1.8 kHz over a dynamic lowpass
//  - a breath-noise transient that settles into faint breathiness
function playRealBawu(ac, freq, dur, gainLevel) {
  const t0 = ac.currentTime
  const tEnd = t0 + dur
  const atk = Math.min(0.07, dur * 0.22)
  const rel = Math.min(0.12, dur * 0.3)
  const wave = getBawuWave(ac)

  const osc1 = ac.createOscillator()
  const osc2 = ac.createOscillator()
  osc1.setPeriodicWave(wave)
  osc2.setPeriodicWave(wave)
  osc2.detune.value = 7

  // Pitch scoop into the note.
  const scoopEnd = t0 + Math.min(0.06, dur * 0.2)
  for (const o of [osc1, osc2]) {
    o.frequency.setValueAtTime(freq * 0.97, t0)
    o.frequency.exponentialRampToValueAtTime(freq, scoopEnd)
  }

  // Delayed vibrato.
  const lfo = ac.createOscillator()
  const lfoG = ac.createGain()
  lfo.frequency.value = 4.8
  lfoG.gain.setValueAtTime(0, t0)
  lfoG.gain.linearRampToValueAtTime(freq * 0.008, t0 + Math.min(0.35, dur * 0.7))
  lfo.connect(lfoG)
  lfoG.connect(osc1.frequency)
  lfoG.connect(osc2.frequency)

  const mix = ac.createGain()
  const osc2G = ac.createGain()
  osc2G.gain.value = 0.35
  osc1.connect(mix)
  osc2.connect(osc2G)
  osc2G.connect(mix)

  // Body: lowpass that opens with the breath, then a nasal formant peak.
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.7
  lp.frequency.setValueAtTime(freq * 2, t0)
  lp.frequency.exponentialRampToValueAtTime(freq * 4.5, t0 + atk)
  lp.frequency.setTargetAtTime(freq * 3.2, tEnd - rel, rel / 3)
  const formant = ac.createBiquadFilter()
  formant.type = 'peaking'
  formant.frequency.value = 1800
  formant.Q.value = 1.2
  formant.gain.value = 5

  // Amplitude: soft attack, slight sag through the sustain, tapered release.
  const amp = ac.createGain()
  amp.gain.setValueAtTime(0.0001, t0)
  amp.gain.exponentialRampToValueAtTime(gainLevel, t0 + atk)
  amp.gain.exponentialRampToValueAtTime(gainLevel * 0.82, Math.max(t0 + atk + 0.01, tEnd - rel))
  amp.gain.exponentialRampToValueAtTime(0.0001, tEnd)

  // Breath: bandpassed noise, chuffy at the attack, faint underneath after.
  const noise = ac.createBufferSource()
  noise.buffer = getNoiseBuf(ac)
  noise.loop = true
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = Math.min(freq * 3, 2400)
  bp.Q.value = 0.8
  const noiseG = ac.createGain()
  noiseG.gain.setValueAtTime(0.0001, t0)
  noiseG.gain.exponentialRampToValueAtTime(gainLevel * 0.22, t0 + atk * 0.6)
  noiseG.gain.exponentialRampToValueAtTime(gainLevel * 0.04, t0 + Math.min(0.2, dur * 0.5))
  noiseG.gain.exponentialRampToValueAtTime(0.0001, tEnd)
  noise.connect(bp)
  bp.connect(noiseG)
  noiseG.connect(amp)

  mix.connect(lp)
  lp.connect(formant)
  formant.connect(amp)
  amp.connect(toneBus(ac))

  const tStop = tEnd + 0.03
  osc1.start(t0); osc1.stop(tStop)
  osc2.start(t0); osc2.stop(tStop)
  lfo.start(t0); lfo.stop(tStop)
  noise.start(t0); noise.stop(tStop)
}

export function playClick(accent = false) {
  const ac = ensureAudio()
  if (!ac) return
  const t0 = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'square'
  osc.frequency.value = accent ? 1600 : 1100
  gain.gain.setValueAtTime(accent ? 0.09 : 0.06, t0)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + 0.05)
}

// ── Shared microphone stream ────────────────────────────────────────────────
let micStream = null
let micUsers = 0

async function acquireMic() {
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  }
  micUsers++
  return micStream
}

function releaseMic() {
  micUsers = Math.max(0, micUsers - 1)
  if (micUsers === 0 && micStream) {
    micStream.getTracks().forEach((t) => t.stop())
    micStream = null
  }
}

// ── Pitch tracking ──────────────────────────────────────────────────────────
// Time-domain autocorrelation (the classic ACF2+ approach): trims silence,
// finds the lag with the best normalized correlation, refines with parabolic
// interpolation. Solid for a monophonic wind instrument.
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

// ── Take recorder ───────────────────────────────────────────────────────────
// MediaRecorder over the shared mic stream. Takes live in memory only — the
// caller offers a download; nothing persists.
export class TakeRecorder {
  constructor() {
    this._rec = null
    this._chunks = []
    this.mimeType = ''
  }

  get recording() {
    return !!this._rec && this._rec.state === 'recording'
  }

  async start() {
    if (this.recording) return
    const stream = await acquireMic()
    const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    this.mimeType = preferred.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || ''
    this._chunks = []
    this._rec = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType } : undefined)
    this._rec.ondataavailable = (e) => { if (e.data?.size) this._chunks.push(e.data) }
    this._rec.start()
  }

  // Resolves with the recorded Blob (or null if nothing was captured).
  stop() {
    return new Promise((resolve) => {
      const rec = this._rec
      if (!rec || rec.state !== 'recording') { resolve(null); return }
      rec.onstop = () => {
        const blob = this._chunks.length
          ? new Blob(this._chunks, { type: this.mimeType || 'audio/webm' })
          : null
        this._chunks = []
        this._rec = null
        releaseMic()
        resolve(blob)
      }
      rec.stop()
    })
  }
}

export function takeExtension(mimeType) {
  if (!mimeType) return 'webm'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}
