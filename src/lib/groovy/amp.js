// A small bass amp: enough to make a DI'd bass pleasant to play through the
// interface's outputs — speakers or headphones — and nothing more.
//
//   in → rumble filter → compressor → [ clean | drive ] → bass / mid / treble
//      → cabinet → level → monitor → out
//
// The drive stage is a parallel blend rather than a switch, which is how bass
// distortion actually gets used: the clean low end stays underneath while the
// grit sits on top. The "cabinet" is a gentle low pass with a presence bump —
// not a real impulse response, just the missing bit of realism that stops a DI
// sounding like a buzzing wire.
//
// Monitoring is off until asked for. Speakers plus an open input is a feedback
// loop, and worse for this app, it feeds the metronome back into the detector.

function driveCurve(amount) {
  // amount 0…1 → tanh hardness. 4096 points is plenty for a smooth knee.
  const k = 1 + amount * 24
  const n = 4096
  const curve = new Float32Array(n)
  const norm = Math.tanh(k)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  return curve
}

export class BassAmp {
  constructor(ac) {
    this.ac = ac

    this.input = ac.createGain()
    this.input.gain.value = 1

    this.rumble = ac.createBiquadFilter()
    this.rumble.type = 'highpass'
    this.rumble.frequency.value = 32
    this.rumble.Q.value = 0.7

    this.comp = ac.createDynamicsCompressor()
    this.comp.threshold.value = -20
    this.comp.knee.value = 12
    this.comp.ratio.value = 3
    this.comp.attack.value = 0.008
    this.comp.release.value = 0.16

    // Two routes around the compressor, but a switch rather than a crossfade.
    // A DynamicsCompressorNode has a look-ahead (6 ms in Chromium and Gecko),
    // so its output is 6 ms behind its input; blending that with an undelayed
    // copy comb-filters, hollowest at exactly the settings a slider spends
    // most of its time at. At 0 the signal goes around it; above 0 it goes
    // through it entirely and the *amount* lives in threshold and ratio.
    this.compWet = ac.createGain()
    this.compWet.gain.value = 0
    this.compBypass = ac.createGain()
    this.compBypass.gain.value = 1
    this.postComp = ac.createGain()

    this.shaper = ac.createWaveShaper()
    this.shaper.curve = driveCurve(0.3)
    // No oversampling, on purpose. '2x' and '4x' push the signal through FIR
    // up- and down-samplers, and those have group delay: the driven copy comes
    // out a few milliseconds behind the clean copy it is summed with, and two
    // copies of a signal a few milliseconds apart are a comb filter with its
    // first notch inside the bass range. Mild aliasing from a tanh on a bass at
    // 48 kHz is far less audible than that notch.
    this.shaper.oversample = 'none'
    this.preDrive = ac.createGain()
    this.preDrive.gain.value = 1
    this.wet = ac.createGain()
    this.wet.gain.value = 0
    this.dry = ac.createGain()
    this.dry.gain.value = 1
    this.postDrive = ac.createGain()

    this.bass = ac.createBiquadFilter()
    this.bass.type = 'lowshelf'
    this.bass.frequency.value = 110
    this.bass.gain.value = 0

    this.mid = ac.createBiquadFilter()
    this.mid.type = 'peaking'
    this.mid.frequency.value = 700
    this.mid.Q.value = 0.8
    this.mid.gain.value = 0

    this.treble = ac.createBiquadFilter()
    this.treble.type = 'highshelf'
    this.treble.frequency.value = 2800
    this.treble.gain.value = 0

    this.cab = ac.createBiquadFilter()
    this.cab.type = 'lowpass'
    this.cab.frequency.value = 4500
    this.cab.Q.value = 0.6

    this.presence = ac.createBiquadFilter()
    this.presence.type = 'peaking'
    this.presence.frequency.value = 2200
    this.presence.Q.value = 1.1
    this.presence.gain.value = 2

    this.level = ac.createGain()
    this.level.gain.value = 0.8

    this.monitor = ac.createGain()
    this.monitor.gain.value = 0

    this.input.connect(this.rumble)
    this.rumble.connect(this.comp)
    this.rumble.connect(this.compBypass)
    this.comp.connect(this.compWet)
    this.compWet.connect(this.postComp)
    this.compBypass.connect(this.postComp)

    this.postComp.connect(this.dry)
    this.postComp.connect(this.preDrive)
    this.preDrive.connect(this.shaper)
    this.shaper.connect(this.wet)

    this.dry.connect(this.postDrive)
    this.wet.connect(this.postDrive)

    this.postDrive.connect(this.bass)
    this.bass.connect(this.mid)
    this.mid.connect(this.treble)
    this.treble.connect(this.cab)
    this.cab.connect(this.presence)
    this.presence.connect(this.level)
    this.level.connect(this.monitor)
    this.monitor.connect(ac.destination)

    this._driveAmount = 0
  }

  connectFrom(node) {
    node.connect(this.input)
  }

  _ramp(param, value, time = 0.02) {
    param.setTargetAtTime(value, this.ac.currentTime, time)
  }

  // gain/level 0…2, bass/mid/treble −12…+12 dB, drive 0…1, compress 0…1.
  setParams(p = {}) {
    if (typeof p.gain === 'number') this._ramp(this.input.gain, p.gain)
    if (typeof p.bass === 'number') this._ramp(this.bass.gain, p.bass, 0.01)
    if (typeof p.mid === 'number') this._ramp(this.mid.gain, p.mid, 0.01)
    if (typeof p.treble === 'number') this._ramp(this.treble.gain, p.treble, 0.01)
    if (typeof p.level === 'number') this._ramp(this.level.gain, p.level)

    if (typeof p.drive === 'number') {
      const d = Math.max(0, Math.min(1, p.drive))
      // Redrawing the curve on every slider step would be wasteful; a few
      // discrete hardnesses are indistinguishable by ear.
      const step = Math.round(d * 8) / 8
      if (step !== this._driveAmount) {
        this._driveAmount = step
        this.shaper.curve = driveCurve(step)
      }
      this._ramp(this.preDrive.gain, 1 + d * 6)
      this._ramp(this.wet.gain, d)
      this._ramp(this.dry.gain, 1 - d * 0.55)
    }

    if (typeof p.compress === 'number') {
      const c = Math.max(0, Math.min(1, p.compress))
      // In or out, never half of each — see the constructor.
      const through = c > 0 ? 1 : 0
      this._ramp(this.compWet.gain, through)
      this._ramp(this.compBypass.gain, 1 - through)
      // The curve is flat at the bottom of the slider (threshold 0 dB, ratio
      // 1:1), so switching the compressor in there does not step the level.
      this.comp.threshold.value = -c * 32
      this.comp.ratio.value = 1 + c * 6.5
    }

    if (typeof p.monitor === 'boolean') {
      // A slower ramp here: an instant unmute on a loud input pops.
      this._ramp(this.monitor.gain, p.monitor ? 1 : 0, 0.03)
    }
  }

  dispose() {
    try {
      this.monitor.disconnect()
      this.input.disconnect()
    } catch {
      /* already gone */
    }
  }
}
