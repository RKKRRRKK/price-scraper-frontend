// The helper's input, played into the AudioContext — as source text, loaded
// through a Blob URL for the same reason as the onset detector (see
// onsetWorkletSource.js).
//
// In engine mode (nativeEngine.js) the helper streams its input as blocks
// stamped with the frame they were captured on. This processor writes them
// into a ring addressed by that frame number and plays them out a fixed
// distance behind the newest one. Everything downstream (the amp, the
// detector, the pitch tracker, the take capture) taps its output exactly as it
// tapped the getUserMedia stream.
//
// The point of it is `k`: the helper frame this processor emits at each
// context frame is `currentFrame + k`. That single integer is the whole bridge
// between the two clocks. A note the detector timestamps at context time t was
// captured on helper frame t·sr + k, and a click booked for context time T is
// sent to play on helper frame T·sr + k. So k has to stay put, and the rules
// below exist to keep it that way:
//
//   · a block that arrives late is not played late; what it would have covered
//     was already played as silence
//   · a gap in the stream is filled with silence, never closed up
//   · an empty ring plays silence and keeps counting
//
// The one thing allowed to move k is clock drift. The helper runs on the
// interface's clock and this context on whatever device the browser renders
// to. If they differ by 50 ppm the ring gains or loses a few frames a second,
// and one frame is skipped or repeated to hold it level. That moves k by one
// frame (about 20 µs) at a time.

export const NATIVE_SOURCE_NAME = 'groovy-native-source'

export const NATIVE_SOURCE_SOURCE = `
class GroovyNativeSource extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = (options && options.processorOptions) || {}
    this.prime = Math.max(256, o.primeFrames | 0)
    this.tol = Math.max(64, o.toleranceFrames | 0)
    this.size = 1 << 17
    this.ring = new Float32Array(this.size)
    this.hi = -1
    this.floor = 0
    this.next = 0
    this.k = null
    this.fillAvg = 0
    this.target = null
    this.quanta = 0
    this.sinceNudge = 0
    this.underruns = 0
    this.nudges = 0
    this.jumps = 0
    this.feed = null
    this.running = true
    this.port.onmessage = (e) => {
      const d = e.data || {}
      if (d.type === 'port') {
        this.feed = d.port
        this.feed.onmessage = (m) => this.receive(m.data)
      } else if (d.type === 'stop') {
        this.running = false
        if (this.feed) this.feed.close()
      }
    }
  }

  // [int64 LE start frame][float32 LE × n], straight off the socket.
  receive(buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 12) return
    const start = Number(new DataView(buf).getBigInt64(0, true))
    const data = new Float32Array(buf, 8, (buf.byteLength - 8) >> 2)
    const end = start + data.length
    const size = this.size

    if (this.hi < 0) {
      // First block: start playing prime frames behind the newest sample.
      // Nothing before it exists; those frames play as silence.
      this.hi = start
      this.floor = start
      this.next = end - this.prime
    }
    if (end <= this.hi) return
    if (end - this.next > size - 256) {
      // Far too much buffered: the context stalled, or the stream jumped.
      // Skip ahead. k moves, but only here, and it is reported.
      this.next = end - this.prime
      this.hi = Math.max(this.hi, this.next)
      this.jumps++
    }

    // Frames already played out are written too: nothing plays them again
    // except a drift repeat, and that should repeat the real sample.
    for (let f = this.hi; f < start; f++) this.ring[f % size] = 0
    for (let i = Math.max(0, this.hi - start); i < data.length; i++) {
      this.ring[(start + i) % size] = data[i]
    }
    this.hi = end
  }

  process(inputs, outputs) {
    if (!this.running) return false
    const out = outputs[0][0]
    const n = out.length
    if (this.hi < 0) {
      out.fill(0)
      return true
    }

    const fill = this.hi - this.next
    this.fillAvg += (fill - this.fillAvg) * 0.005
    this.quanta++
    this.sinceNudge++
    // The level the ring settles at depends on how the blocks arrive, so it is
    // learnt over the first two seconds rather than assumed.
    if (this.target === null && this.quanta * n > sampleRate * 2) this.target = this.fillAvg
    if (this.target !== null && this.sinceNudge >= 20) {
      if (this.fillAvg > this.target + this.tol) {
        this.next++
        this.fillAvg--
        this.nudges++
        this.sinceNudge = 0
      } else if (this.fillAvg < this.target - this.tol && fill > 0) {
        this.next--
        this.fillAvg++
        this.nudges++
        this.sinceNudge = 0
      }
    }

    const size = this.size
    const lo = Math.max(this.hi - size, this.floor)
    for (let i = 0; i < n; i++) {
      const f = this.next + i
      out[i] = f < this.hi && f >= lo ? this.ring[f % size] : 0
    }
    if (this.next + n > this.hi) this.underruns++

    const k = this.next - currentFrame
    this.next += n
    if (k !== this.k || this.quanta % 200 === 0) {
      this.k = k
      this.port.postMessage({
        type: 'k',
        k,
        fillMs: (this.fillAvg / sampleRate) * 1000,
        underruns: this.underruns,
        nudges: this.nudges,
        jumps: this.jumps,
      })
    }
    return true
  }
}

registerProcessor('${NATIVE_SOURCE_NAME}', GroovyNativeSource)
`
