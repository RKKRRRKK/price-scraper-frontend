// The Looper's audio engine: one AudioContext, one input, one clock.
//
// Everything is placed in "scheduled time": the AudioContext time at which a
// sound has to be *scheduled* to be heard at a given moment. A loop, the click
// and a recorded note all live on that one timeline, which is what keeps a new
// layer on the beat of the ones you were listening to while you played it.
//
// The input arrives late against that timeline by the round trip — the output
// buffer on the way to your ears, then the input buffer on the way back in. A
// sample the worklet stamps with context frame c was played along to whatever
// was scheduled at c − round trip. `rtSec` is that round trip; the view owns
// its value (measured, or nudged by ear) and applies it when it builds a layer.
//
// Playback is one looping AudioBufferSourceNode per layer, all started against
// the same `anchor` — the scheduled time of the loop's first sample. A looping
// source wraps on exact sample counts, so layers never drift against each other
// however long they run.
//
//   input → amp ───────────┐
//     │                     ├→ wet (amp on/off) → monitor → out
//     ├────────────────────┘
//     ├→ merger[dry, wet] → capture worklet (always on, see the ring below)
//     └→ onset detector (the "play to start" trigger and the level meter)

import { openInput, selectChannel, closeInput } from '@/lib/groovy/input'
import { BassAmp } from '@/lib/groovy/amp'
import { OnsetDetector, ratioForSensitivity } from '@/lib/groovy/onset'
import { scheduleClick } from '@/lib/groovy/click'
import { setClickLevel } from '@/lib/groovy/bus'
import { LOOPER_CAPTURE_NAME, LOOPER_CAPTURE_SOURCE } from './captureWorkletSource'

// How much input is kept when nothing is recording. Long enough that a tap a
// whole slow bar late still finds its downbeat.
const RING_SEC = 10
// The most a single recording may hold, so a forgotten record button cannot
// eat the machine's memory.
const MAX_HOLD_SEC = 600
// Headroom for anything started "now".
const LEAD = 0.05
// Fade for song on/off changes and stops.
const RAMP = 0.006

let ctx = null

function newContext(sampleRate) {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  // latencyHint 0: the smallest buffer the device will give. See
  // lib/groovy/context.js — the same reasoning applies.
  return sampleRate ? new AC({ latencyHint: 0, sampleRate }) : new AC({ latencyHint: 0 })
}

const captureModules = new WeakMap()

function loadCapture(ac) {
  if (!captureModules.has(ac)) {
    const url = URL.createObjectURL(new Blob([LOOPER_CAPTURE_SOURCE], { type: 'application/javascript' }))
    const p = ac.audioWorklet
      .addModule(url)
      .catch((e) => {
        captureModules.delete(ac)
        throw e
      })
      .finally(() => URL.revokeObjectURL(url))
    captureModules.set(ac, p)
  }
  return captureModules.get(ac)
}

const mod = (a, n) => ((a % n) + n) % n

export class LooperEngine {
  constructor() {
    this.ac = null
    this.out = null
    this.rtSec = 0

    // Input chain
    this.inputOpen = false
    this.mono = null
    this.amp = null
    this.ampTap = null
    this.dryTap = null
    this.wetBus = null
    this.monitor = null
    this.merger = null
    this.capNode = null
    this.capSink = null
    this.detector = new OnsetDetector()
    this.onOnset = null
    this.onLevel = null
    this._ampOn = true
    this._monitorOn = false

    // The capture ring: [{ c, dry, wet }] in context frames, oldest first.
    this.chunks = []
    this.capturedTo = 0
    this.keepFrom = null
    this.waiters = []

    // Playback
    this.players = new Map()
    this.playing = false
    this.anchor = 0
    this.songEnd = null

    this.click = { on: false, bpm: 0, bpb: 4, level: 0.7 }
    this._clickTimer = 0
    // The last beat booked. A restart on the same grid (the first loop
    // re-anchoring on its bar line) must not book it a second time.
    this._lastBeat = -Infinity
  }

  // ── Context ───────────────────────────────────────────────────────────────
  // Created lazily inside a user gesture, and resumed on every call because a
  // backgrounded tab can suspend it.
  ensure() {
    if (!ctx) ctx = newContext()
    if (!ctx) return null
    if (ctx.state === 'suspended') ctx.resume()
    if (this.ac !== ctx) this._bind(ctx)
    return ctx
  }

  _bind(ac) {
    this.ac = ac
    this.out = ac.createGain()
    this.out.connect(ac.destination)
    setClickLevel(ac, this.click.level)
    // Layers belong to whichever context they were made on; carry them over.
    for (const p of this.players.values()) this._makePlayer(p)
    if (this.playing) this.start(this.anchor)
  }

  get sr() {
    return this.ac?.sampleRate || 48000
  }

  // How long after its scheduled time a sound actually leaves the interface.
  get outLatency() {
    return this.ac ? (this.ac.baseLatency || 0) + (this.ac.outputLatency || 0) : 0
  }

  // The scheduled time of what is being heard right now. Taps and the moving
  // playheads are read against this, not currentTime.
  heardNow() {
    return this.ac ? this.ac.currentTime - this.outLatency : 0
  }

  // Context frame at which the input carries what was played along to
  // scheduled time `s`.
  frameOf(s) {
    return Math.round((s + this.rtSec) * this.sr)
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  // matchRate rebuilds the context at the device's own rate (resampling costs
  // latency); only done while there are no layers, since a session keeps the
  // rate it was recorded at.
  // Opens are serialised: one that overlapped another would tear down the
  // first's input halfway and hand it nodes from a context it no longer uses.
  open(opts) {
    const run = () => this._open(opts)
    this._openChain = (this._openChain || Promise.resolve()).then(run, run)
    return this._openChain
  }

  async _open({ deviceId = null, channelIndex = 0, matchRate = false } = {}) {
    let ac = this.ensure()
    if (!ac) throw new Error('This browser has no Web Audio support.')
    if (typeof AudioWorkletNode === 'undefined') throw new Error('This browser cannot run AudioWorklet.')
    this.closeInput()

    let info = await openInput(ac, { deviceId, channelIndex })
    if (matchRate && info.sampleRate && Math.abs(info.sampleRate - ac.sampleRate) > 1) {
      closeInput()
      const was = this.playing
      this.stop()
      try {
        await ctx.close()
      } catch {
        /* already closed */
      }
      ctx = newContext(info.sampleRate)
      ac = this.ensure()
      info = await openInput(ac, { deviceId: info.deviceId, channelIndex })
      if (was) this.start(ac.currentTime + LEAD)
    }

    this.mono = info.mono
    await loadCapture(ac)

    this.amp = new BassAmp(ac)
    this.amp.connectFrom(this.mono)
    this.ampTap = ac.createGain()
    this.dryTap = ac.createGain()
    this.wetBus = ac.createGain()
    this.amp.level.connect(this.ampTap)
    this.mono.connect(this.dryTap)
    this.ampTap.connect(this.wetBus)
    this.dryTap.connect(this.wetBus)
    this.ampTap.gain.value = this._ampOn ? 1 : 0
    this.dryTap.gain.value = this._ampOn ? 0 : 1

    this.monitor = ac.createGain()
    this.monitor.gain.value = this._monitorOn ? 1 : 0
    this.wetBus.connect(this.monitor)
    this.monitor.connect(ac.destination)

    this.merger = ac.createChannelMerger(2)
    this.mono.connect(this.merger, 0, 0)
    this.wetBus.connect(this.merger, 0, 1)
    this.capNode = new AudioWorkletNode(ac, LOOPER_CAPTURE_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    })
    this.chunks = []
    this.capturedTo = 0
    this.capNode.port.onmessage = (e) => this._onChunk(e.data)
    this.merger.connect(this.capNode)
    // A worklet nobody pulls may not run; a muted path to the output keeps it in the graph.
    this.capSink = ac.createGain()
    this.capSink.gain.value = 0
    this.capNode.connect(this.capSink)
    this.capSink.connect(ac.destination)

    await this.detector.attach(ac, this.mono)
    this.detector.onOnset = (d) => this.onOnset?.(d)
    this.detector.onLevel = (d) => this.onLevel?.(d)

    this.inputOpen = true
    return info
  }

  setChannel(i) {
    return selectChannel(i)
  }

  closeInput() {
    this.detector.detach()
    try {
      this.capNode?.port.postMessage({ type: 'stop' })
    } catch {
      /* already gone */
    }
    for (const n of [this.capNode, this.capSink, this.merger, this.monitor, this.wetBus, this.ampTap, this.dryTap]) {
      try {
        n?.disconnect()
      } catch {
        /* already gone */
      }
    }
    if (this.capNode) this.capNode.port.onmessage = null
    this.amp?.dispose()
    this.amp = null
    this.capNode = this.capSink = this.merger = this.monitor = this.wetBus = this.ampTap = this.dryTap = null
    this.mono = null
    closeInput()
    this.inputOpen = false
    this.chunks = []
    this.keepFrom = null
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.resolve(false)
    }
    this.waiters = []
  }

  // ── Amp and detector ──────────────────────────────────────────────────────
  setAmp(params) {
    this.amp?.setParams(params)
  }

  setVoicing(v) {
    this.amp?.setVoicing(v)
  }

  // Off records and monitors the dry signal — for anything that isn't a bass
  // or a guitar, where a cabinet filter would only dull it.
  setAmpOn(on) {
    this._ampOn = !!on
    if (!this.ac || !this.ampTap) return
    const t = this.ac.currentTime
    this.ampTap.gain.setTargetAtTime(on ? 1 : 0, t, 0.01)
    this.dryTap.gain.setTargetAtTime(on ? 0 : 1, t, 0.01)
  }

  setMonitor(on) {
    this._monitorOn = !!on
    if (!this.ac || !this.monitor) return
    // A slower ramp: an instant unmute on a loud input pops.
    this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ac.currentTime, 0.03)
  }

  setDetector({ gate, sensitivity }) {
    // Any instrument, so no requirement for energy in the bass band — that is
    // Groovy's guard against fret noise, and it would ignore a hi-hat.
    this.detector.configure({ gate, ratio: ratioForSensitivity(sensitivity), lowGateFactor: 0, refractoryMs: 60 })
  }

  // ── The capture ring ──────────────────────────────────────────────────────
  _onChunk({ frame, dry, wet }) {
    this.chunks.push({ c: frame, dry, wet })
    this.capturedTo = frame + dry.length
    const sr = this.sr
    let limit = this.keepFrom != null ? this.keepFrom : this.capturedTo - RING_SEC * sr
    limit = Math.max(limit, this.capturedTo - MAX_HOLD_SEC * sr)
    while (this.chunks.length && this.chunks[0].c + this.chunks[0].dry.length <= limit) this.chunks.shift()
    if (this.waiters.length) {
      this.waiters = this.waiters.filter((w) => {
        if (this.capturedTo < w.frame) return true
        clearTimeout(w.timer)
        w.resolve(true)
        return false
      })
    }
  }

  // Keep everything from context frame `c` on until release().
  hold(c) {
    this.keepFrom = Math.floor(c)
  }

  release() {
    this.keepFrom = null
  }

  // Resolves once the input has been captured up to context frame `c` — or,
  // if the stream stalls, a couple of seconds after it should have been.
  captured(c) {
    if (this.capturedTo >= c) return Promise.resolve(true)
    return new Promise((resolve) => {
      const waitSec = Math.max(0, (c - this.capturedTo) / this.sr) + 2
      const w = { frame: c, resolve }
      w.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w)
        resolve(false)
      }, waitSec * 1000)
      this.waiters.push(w)
    })
  }

  // Context frames [from, to) of both channels. Anything no longer (or not
  // yet) in the ring reads as silence.
  read(from, to) {
    from = Math.floor(from)
    to = Math.floor(to)
    const n = Math.max(0, to - from)
    const dry = new Float32Array(n)
    const wet = new Float32Array(n)
    for (const ch of this.chunks) {
      const a = Math.max(from, ch.c)
      const b = Math.min(to, ch.c + ch.dry.length)
      if (b <= a) continue
      dry.set(ch.dry.subarray(a - ch.c, b - ch.c), a - from)
      wet.set(ch.wet.subarray(a - ch.c, b - ch.c), a - from)
    }
    return { dry, wet }
  }

  // ── Layers ────────────────────────────────────────────────────────────────
  // `data` is the layer's (wet) loop, one turn long. Replacing a layer that is
  // playing crossfades the new buffer in over 30 ms: the two versions are
  // sample-aligned, so the swap is inaudible.
  setLayer(id, data, gain = 1) {
    const existing = this.players.get(id)
    if (existing) {
      existing.data = data
      if (!this.ac) return
      existing.buffer = this._buffer(data)
      if (this.playing) this._startSrc(existing, this.ac.currentTime + LEAD, 0.03)
      return
    }
    const p = { id, data, gainValue: gain, src: null, fade: null }
    this.players.set(id, p)
    if (!this.ac) return
    this._makePlayer(p)
    if (this.playing) this._startSrc(p, this.ac.currentTime + LEAD, 0.01)
  }

  _makePlayer(p) {
    const ac = this.ac
    p.vol = ac.createGain()
    p.vol.gain.value = p.gainValue
    p.song = ac.createGain()
    p.song.connect(p.vol)
    p.vol.connect(this.out)
    p.buffer = this._buffer(p.data)
    p.src = null
    p.fade = null
  }

  _buffer(data) {
    const buf = this.ac.createBuffer(1, data.length, this.ac.sampleRate)
    buf.copyToChannel(data, 0)
    return buf
  }

  removeLayer(id) {
    const p = this.players.get(id)
    if (!p) return
    this.players.delete(id)
    if (!this.ac) return
    this._stopSrc(p, 0.015)
    const vol = p.vol
    setTimeout(() => {
      try {
        vol.disconnect()
      } catch {
        /* already gone */
      }
    }, 100)
  }

  clearLayers() {
    for (const id of [...this.players.keys()]) this.removeLayer(id)
  }

  setLayerGain(id, v) {
    const p = this.players.get(id)
    if (!p) return
    p.gainValue = v
    if (p.vol && this.ac) p.vol.gain.setTargetAtTime(v, this.ac.currentTime, 0.015)
  }

  _startSrc(p, when, fade) {
    const ac = this.ac
    if (when < this.anchor) when = this.anchor
    const src = ac.createBufferSource()
    src.buffer = p.buffer
    src.loop = true
    const g = ac.createGain()
    src.connect(g)
    g.connect(p.song)
    src.onended = () => {
      try {
        src.disconnect()
        g.disconnect()
      } catch {
        /* already gone */
      }
    }
    if (fade) {
      g.gain.setValueAtTime(0, when)
      g.gain.linearRampToValueAtTime(1, when + fade)
    }
    src.start(when, mod(when - this.anchor, p.buffer.duration))
    if (p.src) this._stopSrc(p, fade || RAMP, when)
    p.src = src
    p.fade = g
  }

  _stopSrc(p, fade, at = this.ac.currentTime) {
    const { src, fade: g } = p
    if (!src) return
    try {
      g.gain.cancelScheduledValues(at)
      g.gain.setValueAtTime(g.gain.value, at)
      g.gain.linearRampToValueAtTime(0, at + fade)
      src.stop(at + fade + 0.01)
    } catch {
      /* not started */
    }
    p.src = null
    p.fade = null
  }

  // ── Transport ─────────────────────────────────────────────────────────────
  // Play every layer against `anchor`. An anchor in the future starts the
  // loops there from the top, and lets the click count in to it.
  start(anchor) {
    const ac = this.ensure()
    if (!ac) return
    // Re-anchoring on the same beat grid keeps the beats already booked;
    // anything else starts the click afresh.
    const beat = this.click.bpm ? 60 / this.click.bpm : 0
    const shift = beat ? (anchor - this.anchor) / beat : 0.5
    if (!this.playing || Math.abs(shift - Math.round(shift)) > 1e-3) this._lastBeat = -Infinity
    this._halt()
    this.playing = true
    this.anchor = anchor
    const when = Math.max(ac.currentTime + LEAD, anchor)
    for (const p of this.players.values()) {
      p.song.gain.cancelScheduledValues(0)
      p.song.gain.value = 1
      this._startSrc(p, when, 0)
    }
    this._startClick()
  }

  stop() {
    this._halt()
    this.playing = false
    this.songEnd = null
    this._lastBeat = -Infinity
  }

  _halt() {
    clearInterval(this._clickTimer)
    this._clickTimer = 0
    if (!this.ac) return
    for (const p of this.players.values()) {
      this._stopSrc(p, 0.012)
      p.song.gain.cancelScheduledValues(0)
      p.song.gain.setValueAtTime(1, this.ac.currentTime + 0.02)
    }
  }

  // The arrangement: one block per turn of the master loop, each layer on or
  // off per block. Everything is booked up front as gain automation on loops
  // that simply run, so block changes land on the sample.
  playSong({ blockSec, blocks, rows, from = 0 }) {
    const ac = this.ensure()
    if (!ac) return null
    this._halt()
    this._lastBeat = -Infinity
    const t0 = ac.currentTime + 0.08
    const anchor = t0 - from * blockSec
    const end = anchor + blocks * blockSec
    this.playing = true
    this.anchor = anchor
    this.songEnd = end
    for (const p of this.players.values()) {
      const row = rows.get(p.id) || []
      const g = p.song.gain
      g.cancelScheduledValues(0)
      let on = !!row[from]
      g.setValueAtTime(on ? 1 : 0, ac.currentTime)
      for (let b = from + 1; b <= blocks; b++) {
        const next = b < blocks && !!row[b]
        if (next === on) continue
        const t = anchor + b * blockSec
        g.setValueAtTime(on ? 1 : 0, t - RAMP)
        g.linearRampToValueAtTime(next ? 1 : 0, t)
        on = next
      }
      this._startSrc(p, t0, 0)
    }
    this._startClick()
    return { anchor, end }
  }

  // ── Click ─────────────────────────────────────────────────────────────────
  setClick({ on, bpm, bpb, level }) {
    if (typeof on === 'boolean') this.click.on = on
    if (bpm != null) this.click.bpm = bpm
    if (bpb != null) this.click.bpb = bpb
    if (typeof level === 'number') {
      this.click.level = level
      if (this.ac) setClickLevel(this.ac, level)
    }
    if (this.playing) this._startClick()
  }

  // Beats on the grid anchored at `anchor`. An anchor still in the future
  // means negative beats, which is the count-in.
  _startClick() {
    clearInterval(this._clickTimer)
    this._clickTimer = 0
    const { on, bpm, bpb } = this.click
    if (!on || !bpm || !this.ac) return
    const ac = this.ac
    const beat = 60 / bpm
    const anchor = this.anchor
    let k = Math.ceil((ac.currentTime + LEAD - anchor) / beat)
    const tick = () => {
      const horizon = ac.currentTime + 0.15
      while (anchor + k * beat < horizon) {
        const t = anchor + k * beat
        if (t > this._lastBeat + 0.002 && (this.songEnd == null || t < this.songEnd)) {
          scheduleClick(ac, t, mod(k, bpb) === 0 ? 'bar' : 'pulse')
          this._lastBeat = t
        }
        k++
      }
    }
    tick()
    this._clickTimer = setInterval(tick, 25)
  }

  // Context-time phase (0…1) of a loop `lenSec` long at scheduled time `s`.
  phase(lenSec, s = this.heardNow()) {
    return lenSec > 0 ? mod(s - this.anchor, lenSec) / lenSec : 0
  }

  dispose() {
    this.stop()
    this.closeInput()
  }
}
