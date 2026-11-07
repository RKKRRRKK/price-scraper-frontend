// The input tap, as source text — shipped through a Blob URL for the same
// reason as Groovy's detector (see lib/groovy/onsetWorkletSource.js): a worklet
// is loaded by URL at runtime, and a Blob is identical in dev and in the build.
//
// It runs for as long as the input is open, not just while recording. Every
// 1024 frames it posts two channels — the dry DI and the amp's output — with
// the context frame of the first sample. The main thread keeps a few seconds of
// that in a ring, which is what lets a recording start before the button was
// pressed: a late tap still gets the downbeat it was late for.
//
// A block with no input is written as zeros rather than skipped, so frame n of
// a chunk is always its first frame + n.

export const LOOPER_CAPTURE_NAME = 'looper-capture'

export const LOOPER_CAPTURE_SOURCE = `
class LooperCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.size = 1024
    this.fresh()
    this.on = true
    this.port.onmessage = (e) => {
      if ((e.data || {}).type === 'stop') this.on = false
    }
  }

  fresh() {
    this.dry = new Float32Array(this.size)
    this.wet = new Float32Array(this.size)
    this.n = 0
    this.first = 0
  }

  process(inputs) {
    if (!this.on) return false
    const input = inputs[0] || []
    const d = input[0]
    const w = input[1] || input[0]
    const len = d ? d.length : 128
    if (this.n === 0) this.first = currentFrame
    for (let i = 0; i < len; i++) {
      this.dry[this.n + i] = d ? d[i] : 0
      this.wet[this.n + i] = w ? w[i] : 0
    }
    this.n += len
    if (this.n >= this.size) {
      this.port.postMessage(
        { frame: this.first, dry: this.dry, wet: this.wet },
        [this.dry.buffer, this.wet.buffer],
      )
      this.fresh()
    }
    return true
  }
}

registerProcessor('${LOOPER_CAPTURE_NAME}', LooperCapture)
`
