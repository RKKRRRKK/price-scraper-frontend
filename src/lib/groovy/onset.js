// Main-thread side of the onset detector.
//
// Loads the worklet from a Blob (see onsetWorkletSource.js for why), wires it
// to a source node, and turns its messages into two callbacks: one per detected
// attack, one for the level meters.

import { ONSET_PROCESSOR_NAME, ONSET_PROCESSOR_SOURCE } from './onsetWorkletSource'

const modules = new WeakMap()

export function loadOnsetModule(ac) {
  if (!modules.has(ac)) {
    const url = URL.createObjectURL(
      new Blob([ONSET_PROCESSOR_SOURCE], { type: 'application/javascript' }),
    )
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

export function isWorkletSupported() {
  return typeof AudioWorkletNode !== 'undefined'
}

export class OnsetDetector {
  constructor() {
    this.node = null
    this.onOnset = null
    this.onLevel = null
    this._sink = null
    this._ac = null
  }

  async attach(ac, source, config = null) {
    if (!isWorkletSupported()) throw new Error('AudioWorklet is not available in this browser.')
    await loadOnsetModule(ac)
    this._ac = ac
    this.node = new AudioWorkletNode(ac, ONSET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
    })
    this.node.port.onmessage = (e) => {
      const d = e.data
      if (!d) return
      if (d.type === 'onset') this.onOnset?.(d)
      else if (d.type === 'level') this.onLevel?.(d)
    }
    source.connect(this.node)

    // A worklet with a dangling output is not guaranteed to be pulled. A muted
    // tap to the destination keeps it in the render graph and adds no sound.
    this._sink = ac.createGain()
    this._sink.gain.value = 0
    this.node.connect(this._sink)
    this._sink.connect(ac.destination)

    if (config) this.configure(config)
  }

  configure(cfg) {
    this.node?.port.postMessage({ type: 'config', ...cfg })
  }

  detach() {
    try {
      this.node?.port.postMessage({ type: 'stop' })
    } catch {
      /* already gone */
    }
    try {
      this.node?.disconnect()
    } catch {
      /* already gone */
    }
    try {
      this._sink?.disconnect()
    } catch {
      /* already gone */
    }
    if (this.node) this.node.port.onmessage = null
    this.node = null
    this._sink = null
    this._ac = null
  }
}

// The UI thinks in "sensitivity 0…1"; the worklet thinks in an envelope ratio.
// High sensitivity means a smaller jump counts as an attack.
export function ratioForSensitivity(s) {
  const t = Math.max(0, Math.min(1, s))
  return 1.18 + (1 - t) * 1.9
}
