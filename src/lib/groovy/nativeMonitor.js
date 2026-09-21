// The web side of the native monitoring path (Windows only).
//
// `native/groovy-monitor` is a small process that runs the same amp chain as
// amp.js on ASIO or low-latency WASAPI and listens on a WebSocket at
// 127.0.0.1. When it is there, the amp panel becomes its remote control: the
// browser mutes its own Web Audio monitor path and sends the knob values over
// the socket instead. When it is not there — every Mac, and any Windows
// machine without the helper — nothing changes.
//
// Timing never goes near this. The click, the detector and the takes stay on
// the AudioContext clock; the helper only carries what you hear.
//
// Protocol: see ControlServer.cs. Text frames of JSON both ways.

export const NATIVE_PORT = 47391
const RETRY_MS = 6000

export function isWindows() {
  if (typeof navigator === 'undefined') return false
  const p = navigator.userAgentData?.platform || navigator.platform || ''
  return /win/i.test(p)
}

export class NativeMonitor {
  constructor({ port = NATIVE_PORT } = {}) {
    this.url = `ws://127.0.0.1:${port}`
    this.ws = null
    this.info = null
    this.onHello = null
    this.onStatus = null
    this.onClose = null
    this.onLoopback = null
    this._timer = 0
    this._wanted = false
  }

  get connected() {
    return !!this.info && this.ws?.readyState === WebSocket.OPEN
  }

  // Keep trying, quietly, until told to stop. A refused connection to loopback
  // fails in a millisecond, so the retry loop costs nothing but a console line.
  start() {
    if (this._wanted) return
    this._wanted = true
    this._connect()
  }

  stop() {
    this._wanted = false
    clearTimeout(this._timer)
    this._timer = 0
    const ws = this.ws
    this.ws = null
    if (ws) {
      try {
        ws.close()
      } catch {
        /* already closed */
      }
    }
    if (this.info) {
      this.info = null
      this.onClose?.()
    }
  }

  _connect() {
    if (!this._wanted || this.ws) return
    let ws
    try {
      ws = new WebSocket(this.url)
    } catch {
      this._retry()
      return
    }
    this.ws = ws
    ws.onmessage = (e) => {
      let m
      try {
        m = JSON.parse(e.data)
      } catch {
        return
      }
      if (m.type === 'hello') {
        this.info = m
        this.onHello?.(m)
      } else if (m.type === 'status') {
        this.onStatus?.(m)
      } else if (m.type === 'loopback') {
        this.onLoopback?.(m)
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      const had = !!this.info
      this.info = null
      if (had) this.onClose?.()
      this._retry()
    }
    ws.onerror = () => {
      /* onclose follows and handles it */
    }
  }

  _retry() {
    clearTimeout(this._timer)
    if (!this._wanted) return
    this._timer = setTimeout(() => {
      this._timer = 0
      this._connect()
    }, RETRY_MS)
  }

  _send(obj) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(obj))
    return true
  }

  // Ask the helper to play a short tone from its own output. Hearing it is the
  // proof that the native path, not the browser, is what reaches the speakers.
  test() {
    return this._send({ type: 'test' })
  }

  // Measure the round trip through the helper. Needs the interface's output
  // looped back to its input, exactly like the browser's own loopback test.
  // The result arrives on onLoopback: { ok, ms, jitterMs, n, misses }.
  loopback() {
    return this._send({ type: 'loopback' })
  }

  // Any subset of { gain, drive, compress, bass, mid, treble, level, monitor }.
  setParams(p) {
    const out = { type: 'params' }
    for (const k of ['gain', 'drive', 'compress', 'bass', 'mid', 'treble', 'level']) {
      if (typeof p[k] === 'number') out[k] = p[k]
    }
    if (typeof p.monitor === 'boolean') out.monitor = p.monitor
    return this._send(out)
  }
}
