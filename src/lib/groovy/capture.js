// Optional audio for a take, captured on the AudioContext clock.
//
// This replaced a MediaRecorder. A MediaRecorder starts when it gets round to
// it and never says when, so its audio could only be lined up with the notes to
// within its own start-up delay — tens of milliseconds, the size of the errors
// this tool exists to show. The worklet tap reports the context time of its
// first sample instead, which puts the recording on the same clock as the click
// and the detector. Replay depends on that: it lights each note's fret as the
// note is heard, not somewhere near it.
//
// The result is a 16-bit mono WAV. Bigger than Opus (~5.6 MB a minute at
// 48 kHz), but it decodes identically everywhere and nothing is lost to a codec
// whose frame boundaries would blur the attacks.

import { loadOnsetModule } from './onset'
import { CAPTURE_PROCESSOR_NAME } from './onsetWorkletSource'

export class TakeCapture {
  constructor() {
    this._node = null
    this._sink = null
    this._chunks = []
    this._frames = 0
    this._startTime = null
    this._sampleRate = 0
    this._done = null
    this._gen = 0
  }

  get recording() {
    return !!this._node
  }

  // Taps `source` from now until stop(). Resolves once the tap is in the graph.
  async start(ac, source) {
    if (this._node || !ac || !source) return false
    const gen = ++this._gen
    await loadOnsetModule(ac)
    // Stopped or cancelled while the module was loading: never start.
    if (gen !== this._gen) return false
    this._chunks = []
    this._frames = 0
    this._startTime = null
    this._sampleRate = ac.sampleRate

    const node = new AudioWorkletNode(ac, CAPTURE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    })
    let finish
    this._done = new Promise((r) => (finish = r))
    node.port.onmessage = (e) => {
      const d = e.data || {}
      if (d.type === 'start') this._startTime = d.time
      else if (d.type === 'chunk') {
        this._chunks.push(d.data)
        this._frames += d.data.length
      } else if (d.type === 'done') finish()
    }
    source.connect(node)
    // Same reason as the detector's: a worklet nobody pulls may not run.
    this._sink = ac.createGain()
    this._sink.gain.value = 0
    node.connect(this._sink)
    this._sink.connect(ac.destination)
    this._node = node
    return true
  }

  // Resolves with { blob, startTime, sampleRate }, or null if nothing arrived.
  // `startTime` is the raw context time of the first sample — before the
  // latency offset, exactly like the detector's onset times.
  async stop() {
    this._gen++
    const node = this._node
    if (!node) return null
    node.port.postMessage({ type: 'stop' })
    // The worklet answers within a render quantum; the timeout only matters if
    // the context was closed underneath us.
    await Promise.race([this._done, new Promise((r) => setTimeout(r, 1000))])
    this._teardown()
    if (!this._frames || this._startTime == null) return null
    const blob = encodeWav(this._chunks, this._frames, this._sampleRate)
    this._chunks = []
    return { blob, startTime: this._startTime, sampleRate: this._sampleRate }
  }

  cancel() {
    this._gen++
    try {
      this._node?.port.postMessage({ type: 'stop' })
    } catch {
      /* already gone */
    }
    this._teardown()
    this._chunks = []
  }

  _teardown() {
    for (const n of [this._node, this._sink]) {
      try {
        n?.disconnect()
      } catch {
        /* already gone */
      }
    }
    if (this._node) this._node.port.onmessage = null
    this._node = null
    this._sink = null
  }
}

function encodeWav(chunks, frames, sampleRate) {
  const bytes = 44 + frames * 2
  const view = new DataView(new ArrayBuffer(bytes))
  const text = (at, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, bytes - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, frames * 2, true)
  let at = 44
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]))
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      at += 2
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' })
}
