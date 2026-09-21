// The onset detector, as source text.
//
// It is kept as a string and handed to `audioWorklet.addModule()` through a
// Blob URL rather than imported as a file. A worklet module is loaded by URL at
// runtime, not bundled, so shipping it as a separate file makes correctness
// depend on how the bundler chooses to emit and serve it. A Blob is the same in
// dev and in the built site, with no build configuration at all.
//
// Why a worklet rather than an AnalyserNode on a rAF loop: rAF fires every
// ~16 ms, which is the same order as the timing errors we are trying to
// measure. The worklet sees every 128-sample block, so an attack can be placed
// to within a millisecond or two — and it can be placed on the *same clock*
// the metronome was scheduled against, which is the whole trick.
//
// Detection is an envelope-ratio onset detector on a high-passed band:
//   · a fast envelope (0.5 ms attack) tracks the transient
//   · a slow envelope (80 ms attack, 300 ms release) is the local reference
//   · a hit fires when fast > slow × ratio, above an absolute gate, and only
//     when a low band (~200 Hz) also has energy, which is what tells a plucked
//     note apart from fret buzz, a string squeak or a pop in the cable — all of
//     which are transients with nothing underneath them. It also happens to
//     reject a metronome click leaking in from an open microphone, though on a
//     DI'd instrument there is no path for one to arrive by.
//     Very high playing (past the twelfth fret on the G string) pushes the
//     fundamental toward the corner of that filter; `lowGateFactor` loosens the
//     requirement if that ever starts costing notes.
//   · on firing, the detector walks *back* through a ring of recent envelope
//     values to the real foot of the attack, rather than reporting the moment
//     the threshold happened to be crossed

export const ONSET_PROCESSOR_NAME = 'groovy-onset'

export const ONSET_PROCESSOR_SOURCE = `
function envCoef(tauSec, sr) {
  return 1 - Math.exp(-1 / (Math.max(1e-6, tauSec) * sr))
}

class GroovyOnsetProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const sr = sampleRate
    this.sr = sr

    this.fastAtk = envCoef(0.0005, sr)
    this.fastRel = envCoef(0.030, sr)
    this.slowAtk = envCoef(0.080, sr)
    this.slowRel = envCoef(0.300, sr)
    this.lowAtk = envCoef(0.002, sr)
    this.lowRel = envCoef(0.060, sr)

    // ~200 Hz: the band a bass fundamental lives in, and a click does not.
    this.lpB = 1 - Math.exp((-2 * Math.PI * 200) / sr)
    this.hpPrevIn = 0
    this.hpPrevOut = 0
    this.lpState = 0
    this.fastEnv = 0
    this.slowEnv = 0
    this.lowEnv = 0

    this.ratio = 2.0
    this.gate = 0.006
    this.lowGateFactor = 0.5
    this.refractory = Math.floor(sr * 0.06)
    this.armed = true
    this.lastFire = -1e9

    this.ringLen = 4096
    this.ring = new Float32Array(this.ringLen)
    this.ringPos = 0

    this.blockCount = 0
    this.levelPeak = 0
    this.levelSum = 0
    this.levelN = 0
    this.running = true

    this.setBand(350)
    this.port.onmessage = (e) => {
      const d = e.data || {}
      if (d.type === 'config') this.applyConfig(d)
      else if (d.type === 'stop') this.running = false
    }
  }

  setBand(hz) {
    this.hpA = Math.exp((-2 * Math.PI * hz) / this.sr)
    this.bandHz = hz
  }

  applyConfig(d) {
    if (typeof d.ratio === 'number') this.ratio = Math.max(1.05, Math.min(6, d.ratio))
    if (typeof d.gate === 'number') this.gate = Math.max(0.0005, Math.min(0.3, d.gate))
    if (typeof d.refractoryMs === 'number') {
      this.refractory = Math.floor((this.sr * Math.max(20, Math.min(400, d.refractoryMs))) / 1000)
    }
    if (typeof d.bandHz === 'number') this.setBand(Math.max(80, Math.min(2000, d.bandHz)))
    if (typeof d.lowGateFactor === 'number') this.lowGateFactor = Math.max(0, Math.min(4, d.lowGateFactor))
  }

  // Walk back from the threshold crossing to the foot of the attack, so the
  // reported time is when the note started rather than when it got loud enough
  // to notice. Capped at 25 ms so a slow swell cannot drag it arbitrarily far.
  backtrack(peak) {
    const limit = Math.min(this.ringLen - 1, Math.floor(this.sr * 0.025))
    const floor = peak * 0.12
    let back = 0
    while (back < limit) {
      const v = this.ring[(this.ringPos - 1 - back + this.ringLen) % this.ringLen]
      if (v < floor) break
      back++
    }
    return back
  }

  process(inputs) {
    if (!this.running) return false
    const input = inputs[0]
    if (!input || !input.length || !input[0]) return true
    const ch = input[0]
    const n = ch.length
    const frame = currentFrame

    for (let i = 0; i < n; i++) {
      const x = ch[i]

      // One-pole high pass: the transient band.
      const hp = this.hpA * (this.hpPrevOut + x - this.hpPrevIn)
      this.hpPrevIn = x
      this.hpPrevOut = hp
      const a = hp < 0 ? -hp : hp

      // One-pole low pass: is there actually a bass note here?
      this.lpState += (x - this.lpState) * this.lpB
      const lo = this.lpState < 0 ? -this.lpState : this.lpState

      this.fastEnv += (a - this.fastEnv) * (a > this.fastEnv ? this.fastAtk : this.fastRel)
      this.slowEnv += (a - this.slowEnv) * (a > this.slowEnv ? this.slowAtk : this.slowRel)
      this.lowEnv += (lo - this.lowEnv) * (lo > this.lowEnv ? this.lowAtk : this.lowRel)

      this.ring[this.ringPos] = this.fastEnv
      this.ringPos = (this.ringPos + 1) % this.ringLen

      const here = frame + i
      const loud = this.fastEnv > this.gate
      const rising = this.fastEnv > this.slowEnv * this.ratio
      const hasBody = this.lowEnv > this.gate * this.lowGateFactor

      if (this.armed && loud && rising && hasBody && here - this.lastFire >= this.refractory) {
        const back = this.backtrack(this.fastEnv)
        this.lastFire = here
        this.armed = false
        this.port.postMessage({
          type: 'onset',
          time: currentTime + (i - back) / this.sr,
          strength: this.fastEnv,
          low: this.lowEnv,
        })
      } else if (!this.armed && (!loud || this.fastEnv < this.slowEnv * (this.ratio * 0.6))) {
        this.armed = true
      }

      const ax = x < 0 ? -x : x
      if (ax > this.levelPeak) this.levelPeak = ax
      this.levelSum += x * x
      this.levelN++
    }

    // ~20 ms of level updates for the meters and the gate slider.
    this.blockCount++
    if (this.blockCount >= 8) {
      this.blockCount = 0
      this.port.postMessage({
        type: 'level',
        peak: this.levelPeak,
        rms: this.levelN ? Math.sqrt(this.levelSum / this.levelN) : 0,
        band: this.fastEnv,
        floor: this.slowEnv,
      })
      this.levelPeak = 0
      this.levelSum = 0
      this.levelN = 0
    }

    return true
  }
}

registerProcessor('${ONSET_PROCESSOR_NAME}', GroovyOnsetProcessor)
`
