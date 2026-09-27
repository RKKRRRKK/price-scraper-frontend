// Playing a recorded take back: its audio if it kept any, a plucked tone per
// note if it did not, and the click on the take's own grid — with a playhead
// the roll and the fretboard follow.
//
// Everything is booked on the AudioContext clock, the same lookahead way the
// transport books the metronome, so the click, the audio and the playhead agree
// to the sample. Take time 0 is the take's first downbeat. `audioLeadSec` in the
// take's settings says where the audio's first sample sits on that axis (see
// capture.js); takes recorded before it existed play their audio from 0, which
// is close but not exact.

import { ensureAudio, currentContext, outputLatencySec } from './context'
import { scheduleClick } from './click'
import { slotKind } from './grid'
import { freqOfMidi } from './pitch'
import { Transport } from './transport'

const LOOKAHEAD = 0.15
const TICK_MS = 25

export class TakeReplay {
  constructor() {
    this.take = null
    this.grid = null
    this.buffer = null
    this.duration = 0
    this.playing = false
    this.onEnd = null
    this._origin = 0 // context time of take time 0
    this._pausedAt = 0
    this._click = true
    this._src = null
    this._out = null
    this._timer = 0
    this._slot = 0
    this._note = 0
  }

  // `audio` is an ArrayBuffer of the take's recording, or null.
  async load(take, audio = null) {
    this.stop()
    this.take = take
    this.buffer = null
    const s = take.settings || {}
    this.grid = Transport.fixed({ bpm: s.bpm || 90, meterId: s.meterId || '4/4', subdiv: s.subdiv || 2 })
    const ac = ensureAudio()
    if (audio && ac) {
      try {
        this.buffer = await ac.decodeAudioData(audio)
      } catch (e) {
        console.warn('[Groovy] take audio would not decode:', e)
      }
    }
    const hits = take.hits || []
    const lastNote = hits.length ? hits[hits.length - 1].t : 0
    const audioEnd = this.buffer ? (s.audioLeadSec || 0) + this.buffer.duration : 0
    this.duration = Math.max(lastNote + 0.8, audioEnd, (take.duration_ms || 0) / 1000)
  }

  get hasAudio() {
    return !!this.buffer
  }

  // The take time being heard right now, or where playback is parked.
  position() {
    const ac = currentContext()
    if (!this.playing || !ac) return this._pausedAt
    return Math.max(0, ac.currentTime - outputLatencySec() - this._origin)
  }

  play({ from = this._pausedAt, click = true } = {}) {
    const ac = ensureAudio()
    if (!ac || !this.take) return
    this._halt()
    if (from >= this.duration - 0.05) from = 0
    const start = ac.currentTime + 0.08
    this._origin = start - from
    this._click = click

    this._out = ac.createGain()
    this._out.gain.value = 0.9
    this._out.connect(ac.destination)

    if (this.buffer) {
      const src = ac.createBufferSource()
      src.buffer = this.buffer
      src.connect(this._out)
      const at = this._origin + (this.take.settings?.audioLeadSec || 0)
      if (at >= start) src.start(at)
      else if (start - at < this.buffer.duration) src.start(start, start - at)
      this._src = src
    }

    const seg = this.grid.segments[0]
    this._slot = Math.max(0, Math.ceil((from - seg.origin) / seg.slotSec - 1e-9))
    const hits = this.take.hits || []
    this._note = hits.findIndex((h) => h.t >= from - 0.01)
    if (this._note < 0) this._note = hits.length

    this.playing = true
    this._timer = setInterval(() => this._schedule(), TICK_MS)
    this._schedule()
  }

  pause() {
    if (!this.playing) return
    this._pausedAt = this.position()
    this._halt()
  }

  // Park the playhead somewhere else; if playing, carry on from there.
  seek(t) {
    const at = Math.max(0, Math.min(this.duration, t))
    if (this.playing) this.play({ from: at, click: this._click })
    else this._pausedAt = at
  }

  stop() {
    this._halt()
    this._pausedAt = 0
  }

  _halt() {
    this.playing = false
    clearInterval(this._timer)
    this._timer = 0
    try {
      this._src?.stop()
    } catch {
      /* never started */
    }
    // Disconnecting the output silences anything already booked ahead.
    try {
      this._out?.disconnect()
    } catch {
      /* already gone */
    }
    this._src = null
    this._out = null
  }

  _schedule() {
    const ac = currentContext()
    if (!ac || !this.playing) return
    const horizon = Math.min(ac.currentTime + LOOKAHEAD - this._origin, this.duration)

    const seg = this.grid.segments[0]
    const subs = !!this.take.settings?.clickSubdivisions
    while (seg.origin + this._slot * seg.slotSec < horizon) {
      const kind = slotKind(this._slot, seg.subdiv, seg.meter)
      const t = seg.origin + this._slot * seg.slotSec
      if (this._click && (kind !== 'sub' || subs)) scheduleClick(ac, this._origin + t, kind)
      this._slot++
    }

    if (!this.buffer) {
      const hits = this.take.hits || []
      while (this._note < hits.length && hits[this._note].t < horizon) {
        const h = hits[this._note]
        const next = hits[this._note + 1]
        const freq = h.freq || (h.midi ? freqOfMidi(h.midi) : 0)
        pluck(ac, this._out, this._origin + h.t, freq, next ? next.t - h.t : 0.8)
        this._note++
      }
    }

    if (ac.currentTime - this._origin > this.duration + 0.1) {
      this._halt()
      this._pausedAt = 0
      this.onEnd?.()
    }
  }
}

// Stand-in for a take without audio: a filtered saw at the detected pitch, so
// the line can be heard as well as seen. A note the tracker could not name
// gets a short low thump — the rhythm still matters.
function pluck(ac, out, when, freq, gap) {
  const t0 = Math.max(when, ac.currentTime)
  const pitched = freq > 0
  const f = pitched ? freq : 55
  const dur = pitched ? Math.max(0.12, Math.min(0.9, gap * 0.95)) : 0.08

  const osc = ac.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = f
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(Math.min(4000, f * 8), t0)
  lp.frequency.exponentialRampToValueAtTime(Math.max(80, f * 1.5), t0 + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(lp)
  lp.connect(g)
  g.connect(out)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}
