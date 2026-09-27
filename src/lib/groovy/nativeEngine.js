// Engine mode: the Windows helper as the whole sound card (ASIO only).
//
// In monitor mode the helper only carries the amp, and the browser's own WDM
// streams carry the click and the detector — which on a vendor driver means a
// few hundred milliseconds of input delay that moves on every load and has to
// be calibrated away each session. In engine mode the helper carries all of it:
//
//   · input — the helper streams its input, frame-stamped, into a source
//     worklet (nativeSourceWorkletSource.js) whose output replaces the
//     getUserMedia tap. Detector, pitch tracker, amp and take capture hang off
//     it unchanged.
//   · output — the click, drums and probe pulse are rendered once with the
//     existing voice code into buffers, uploaded, and booked on exact helper
//     frames through a voice sink the transport uses (voices.js).
//
// Nothing about timing moves out of the browser. The transport, the detector
// and the roll all still speak AudioContext time; the source worklet's `k` maps
// that onto helper frames exactly. Because input and output share one ASIO
// callback, the latency offset is the driver's own input + output figure, and
// there is nothing to calibrate.
//
// The input stream has its own socket, opened in a Worker, so the audio goes
// socket → worker → audio thread and never waits behind the main thread, which
// re-renders the input panel ~50× a second. The main thread keeps the control
// socket (nativeMonitor.js) for everything else.

import { NATIVE_SOURCE_NAME, NATIVE_SOURCE_SOURCE } from './nativeSourceWorkletSource'
import { webVoices } from './voices'
import { clickBus, drumBus } from './bus'

// Voice ids on the wire. The helper only knows the numbers.
export const VOICE_IDS = {
  'click-bar': 0,
  'click-medium': 1,
  'click-pulse': 2,
  'click-sub': 3,
  kick: 4,
  snare: 5,
  hat: 6,
  'hat-accent': 7,
  probe: 8,
}

const RENDER = {
  'click-bar': (ac) => webVoices.click(ac, 0, 'bar'),
  'click-medium': (ac) => webVoices.click(ac, 0, 'medium'),
  'click-pulse': (ac) => webVoices.click(ac, 0, 'pulse'),
  'click-sub': (ac) => webVoices.click(ac, 0, 'sub'),
  kick: (ac) => webVoices.kick(ac, 0),
  snare: (ac) => webVoices.snare(ac, 0),
  hat: (ac) => webVoices.hat(ac, 0, 1, false),
  'hat-accent': (ac) => webVoices.hat(ac, 0, 1, true),
  probe: (ac) => webVoices.probe(ac, 0),
}

// How far behind the newest streamed sample the source worklet plays. Covers
// the helper's block size and the socket's delivery jitter; this is most of
// the delay between playing a note and seeing it.
const PRIME_SEC = 0.02
const OPEN_TIMEOUT_MS = 3000

const WORKER_SOURCE = `
let ws = null
onmessage = (e) => {
  const d = e.data || {}
  if (d.type !== 'start') return
  const feed = d.port
  ws = new WebSocket(d.url)
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => ws.send(JSON.stringify({ type: 'stream', on: true }))
  ws.onmessage = (m) => {
    if (m.data instanceof ArrayBuffer) feed.postMessage(m.data, [m.data])
  }
  ws.onclose = () => postMessage({ type: 'closed' })
}
`

const modules = new WeakMap()

function loadSourceModule(ac) {
  if (!modules.has(ac)) {
    const url = URL.createObjectURL(new Blob([NATIVE_SOURCE_SOURCE], { type: 'application/javascript' }))
    const p = ac.audioWorklet
      .addModule(url)
      .catch((e) => {
        modules.delete(ac)
        throw e
      })
      .finally(() => URL.revokeObjectURL(url))
    modules.set(ac, p)
  }
  return modules.get(ac)
}

// Every voice, rendered at `sampleRate` through the real voice code with the
// buses at unity. Levels are applied per play instead.
export async function renderVoices(sampleRate) {
  const out = {}
  for (const [name, fn] of Object.entries(RENDER)) {
    const oac = new OfflineAudioContext(1, Math.ceil(sampleRate * 0.4), sampleRate)
    clickBus(oac).gain.value = 1
    drumBus(oac).gain.value = 1
    fn(oac)
    const buf = await oac.startRendering()
    const d = buf.getChannelData(0)
    let end = d.length
    while (end > 0 && Math.abs(d[end - 1]) < 1e-5) end--
    out[name] = d.slice(0, Math.max(1, end))
  }
  return out
}

export class NativeEngine {
  constructor(monitor) {
    this.monitor = monitor
    this.node = null
    this.worker = null
    this.sink = null
    this.k = null
    this.sampleRate = 0
    this.stats = null
    // () => ({ click, drums }): the current levels, read at each play.
    this.getLevels = () => ({ click: 0.8, drums: 0.7 })
    // Called if the stream socket drops while open.
    this.onClosed = null
    this._kWaiters = []

    const lv = () => this.getLevels()
    this.voices = {
      click: (ac, when, kind = 'pulse') =>
        this.play(`click-${kind}` in VOICE_IDS ? `click-${kind}` : 'click-pulse', when, lv().click),
      kick: (ac, when) => this.play('kick', when, lv().drums),
      snare: (ac, when) => this.play('snare', when, lv().drums),
      hat: (ac, when, gain = 1, accent = false) =>
        this.play(accent ? 'hat-accent' : 'hat', when, lv().drums * gain),
      probe: (ac, when) => this.play('probe', when, lv().click),
    }
  }

  get isOpen() {
    return !!this.node
  }

  // Starts the stream and resolves with the node to use as the input tap, once
  // audio is actually arriving. `ac` must already run at the helper's rate: a
  // resampler in between would make one helper frame not one context frame.
  async open(ac, info) {
    this.close()
    if (Math.abs(ac.sampleRate - info.sampleRate) > 1) {
      throw new Error(`The page runs at ${ac.sampleRate} Hz and the helper at ${info.sampleRate} Hz.`)
    }
    this.sampleRate = ac.sampleRate

    await loadSourceModule(ac)
    const node = new AudioWorkletNode(ac, NATIVE_SOURCE_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        primeFrames: Math.max(Math.round(ac.sampleRate * PRIME_SEC), (info.bufferFrames || 256) * 2 + 256),
        toleranceFrames: Math.round(ac.sampleRate * 0.002),
      },
    })
    node.port.onmessage = (e) => {
      const d = e.data || {}
      if (d.type !== 'k') return
      this.k = d.k
      this.stats = d
      const waiters = this._kWaiters
      this._kWaiters = []
      waiters.forEach((r) => r())
    }
    // A source nobody pulls may not run; keep it in the graph, silently.
    const sink = ac.createGain()
    sink.gain.value = 0
    node.connect(sink)
    sink.connect(ac.destination)

    const channel = new MessageChannel()
    node.port.postMessage({ type: 'port', port: channel.port1 }, [channel.port1])
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }))
    const worker = new Worker(url)
    URL.revokeObjectURL(url)
    worker.onmessage = (e) => {
      if (e.data?.type === 'closed' && this.worker === worker) this.onClosed?.()
    }
    worker.postMessage({ type: 'start', url: this.monitor.url, port: channel.port2 }, [channel.port2])

    this.node = node
    this.sink = sink
    this.worker = worker

    const voices = await renderVoices(this.sampleRate)
    for (const [name, pcm] of Object.entries(voices)) this.monitor.uploadVoice(VOICE_IDS[name], pcm)

    const arrived = await Promise.race([
      new Promise((r) => this._kWaiters.push(() => r(true))),
      new Promise((r) => setTimeout(() => r(false), OPEN_TIMEOUT_MS)),
    ])
    if (!arrived || this.node !== node) {
      this.close()
      throw new Error('The helper is connected but no audio is arriving from it.')
    }
    return node
  }

  close() {
    this._kWaiters = []
    if (this.worker) this.worker.terminate()
    if (this.node) {
      try {
        this.node.port.postMessage({ type: 'stop' })
        this.node.port.onmessage = null
        this.node.disconnect()
      } catch {
        /* already gone */
      }
    }
    try {
      this.sink?.disconnect()
    } catch {
      /* already gone */
    }
    this.worker = null
    this.node = null
    this.sink = null
    this.k = null
    this.stats = null
  }

  // Book a voice at context time `when`, on the helper frame that maps to it.
  play(name, when, gain = 1) {
    if (this.k == null) return false
    const v = VOICE_IDS[name]
    if (v == null) return false
    return this.monitor.play(v, Math.round(when * this.sampleRate) + this.k, gain)
  }
}
