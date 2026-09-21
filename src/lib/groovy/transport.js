// The clock everything else is measured against.
//
// A lookahead scheduler: a plain setInterval wakes ~40×/s and books every click
// and drum hit that falls inside the next 120 ms at an exact AudioContext time.
// setInterval is allowed to be sloppy because it never decides *when* a sound
// happens — it only decides when we go shopping for the next few.
//
// The grid is kept as a list of *segments*. A segment is a stretch of constant
// tempo/meter/subdivision with an origin, so the time of any slot is exactly
// `origin + index * slotSec` — no accumulated drift, and no array of timestamps
// to run out of. Changing tempo mid-practice opens a new segment on the next
// downbeat rather than lurching mid-bar, and the old one stays around so hits
// played before the change still match against the grid they were played to.

import { ensureAudio } from './context'
import { meterById, slotKind, patternRes, patternById } from './grid'
import { scheduleClick } from './click'
import { scheduleKick, scheduleSnare, scheduleHat } from './drums'
import { setClickLevel, setDrumLevel } from './bus'

const LOOKAHEAD = 0.12 // seconds of audio booked in advance
const TICK_MS = 25 // how often the scheduler wakes up
const SEGMENT_TTL = 30 // seconds of grid history worth keeping

function gcd(a, b) {
  while (b) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

function lcm(a, b) {
  return (a * b) / gcd(a, b)
}

export class Transport {
  constructor() {
    this.running = false
    this.segments = []
    this.config = {
      bpm: 90,
      meterId: '4/4',
      subdiv: 2,
      clickOn: true,
      clickSubdivisions: false,
      drumsOn: false,
      patternId: null,
    }
    this._ac = null
    this._timer = 0
    this._cur = null
    this._fine = 0
    this._cursorTime = 0
  }

  // ── Configuration ─────────────────────────────────────────────────────────
  // While stopped this just records the settings. While running, anything that
  // moves the grid (tempo, meter, subdivision) opens a new segment on the next
  // downbeat; anything that only changes what is *played* (click on/off, the
  // drum pattern) takes effect on the next scheduled event.
  setConfig(patch) {
    const gridKeys = ['bpm', 'meterId', 'subdiv']
    const movesGrid = gridKeys.some((k) => k in patch && patch[k] !== this.config[k])
    Object.assign(this.config, patch)
    if (!this.running) return
    if (movesGrid) this._openSegment(this.nextBarTime(0, 0.25))
    else if (this._cur) this._cur.pattern = this._resolvePattern()
  }

  setLevels({ click, drums } = {}) {
    const ac = this._ac || ensureAudio()
    if (!ac) return
    if (typeof click === 'number') setClickLevel(ac, click)
    if (typeof drums === 'number') setDrumLevel(ac, drums)
  }

  // ── Running ───────────────────────────────────────────────────────────────
  start() {
    if (this.running) return
    const ac = ensureAudio()
    if (!ac) throw new Error('Web Audio is not available in this browser.')
    this._ac = ac
    this.segments = []
    this._openSegment(ac.currentTime + 0.1)
    this.running = true
    this._timer = setInterval(() => this._schedule(), TICK_MS)
    this._schedule()
  }

  stop() {
    if (!this.running) return
    this.running = false
    clearInterval(this._timer)
    this._timer = 0
    this._cur = null
  }

  get startTime() {
    return this.segments.length ? this.segments[0].origin : 0
  }

  // ── The grid ──────────────────────────────────────────────────────────────
  _resolvePattern() {
    const p = patternById(this.config.meterId, this.config.patternId)
    return p || null
  }

  _openSegment(origin) {
    const meter = meterById(this.config.meterId)
    const subdiv = this.config.subdiv
    const pRes = patternRes(meter)
    const pulseSec = 60 / Math.max(20, Math.min(300, this.config.bpm))
    const fineRes = lcm(subdiv, pRes)

    // A change that was queued for the next downbeat but hasn't been reached
    // yet is superseded, not stacked behind. Otherwise dragging the tempo
    // slider would queue one segment per pixel.
    while (
      this.segments.length &&
      this.segments[this.segments.length - 1] !== this._cur &&
      this.segments[this.segments.length - 1].origin >= origin
    ) {
      this.segments.pop()
    }

    const prev = this.segments[this.segments.length - 1]
    let barOffset = 0
    if (prev) {
      const prevBarSec = prev.pulseSec * prev.pulses
      barOffset = prev.barOffset + Math.max(0, Math.round((origin - prev.origin) / prevBarSec))
      prev.until = origin
    }

    const seg = {
      origin,
      until: Infinity,
      bpm: this.config.bpm,
      meterId: meter.id,
      meter,
      subdiv,
      pulses: meter.pulses,
      pulseSec,
      slotSec: pulseSec / subdiv,
      slotsPerBar: meter.pulses * subdiv,
      fineRes,
      fineSec: pulseSec / fineRes,
      patternRes: pRes,
      pattern: this._resolvePattern(),
      barOffset,
    }
    this.segments.push(seg)

    // The scheduler only ever books LOOKAHEAD ahead, and a new segment always
    // starts further out than that, so nothing has been double-booked.
    if (!this._cur) {
      this._cur = seg
      this._fine = 0
      this._cursorTime = seg.origin
    }
    this._trimSegments()
    return seg
  }

  _trimSegments() {
    const ac = this._ac
    if (!ac || this.segments.length < 2) return
    const cutoff = ac.currentTime - SEGMENT_TTL
    while (this.segments.length > 1 && this.segments[0].until < cutoff) {
      if (this.segments[0] === this._cur) break
      this.segments.shift()
    }
  }

  segmentAt(time) {
    const segs = this.segments
    if (!segs.length) return null
    for (let i = segs.length - 1; i >= 0; i--) {
      if (time >= segs[i].origin) return segs[i]
    }
    return segs[0]
  }

  // The grid line closest to `time`, as
  // { time, index, slotInBar, bar, kind, seg, slotSec }. Null before the count
  // has started. Looks across a segment boundary so a hit played a hair before
  // a tempo change still matches the downbeat it was aiming at.
  nearestSlot(time) {
    const seg = this.segmentAt(time)
    if (!seg) return null
    let best = this._slotOf(seg, Math.round((time - seg.origin) / seg.slotSec))
    const next = this.segments[this.segments.indexOf(seg) + 1]
    if (next && Math.abs(next.origin - time) < Math.abs(best.time - time)) {
      best = this._slotOf(next, 0)
    }
    return best
  }

  // The nearest *pulse* — the main click, ignoring subdivision lines.
  //
  // Calibration has to use this rather than nearestSlot(). Matching to the
  // nearest grid line can only ever measure a delay smaller than half a slot:
  // anything larger silently wraps onto the following line and comes back as a
  // small negative number. At 90 bpm in sixteenths that ceiling is 83 ms, which
  // is *less* than a normal browser's round-trip latency — so the measurement
  // would be wrong exactly when it matters most. Half a pulse is four times the
  // room, and is unambiguous at any tempo worth practising at.
  nearestPulse(time) {
    const seg = this.segmentAt(time)
    if (!seg) return null
    const k = Math.round((time - seg.origin) / seg.pulseSec)
    let best = this._slotOf(seg, k * seg.subdiv)
    const next = this.segments[this.segments.indexOf(seg) + 1]
    if (next && Math.abs(next.origin - time) < Math.abs(best.time - time)) {
      best = this._slotOf(next, 0)
    }
    return best
  }

  _slotOf(seg, index) {
    const spb = seg.slotsPerBar
    const slotInBar = ((index % spb) + spb) % spb
    return {
      time: seg.origin + index * seg.slotSec,
      index,
      slotInBar,
      bar: seg.barOffset + Math.floor(index / spb),
      kind: slotKind(index, seg.subdiv, seg.meter),
      slotSec: seg.slotSec,
      pulseSec: seg.pulseSec,
      subdiv: seg.subdiv,
      meterId: seg.meterId,
      seg,
    }
  }

  // Every grid line in [t0, t1], for drawing. The final segment extrapolates
  // forward forever, so the roll can draw lines the scheduler has not booked.
  slotsBetween(t0, t1, limit = 1200) {
    const out = []
    for (let i = 0; i < this.segments.length && out.length < limit; i++) {
      const seg = this.segments[i]
      const lo = Math.max(t0, seg.origin)
      const hi = Math.min(t1, seg.until)
      if (hi < lo) continue
      const first = Math.ceil((lo - seg.origin) / seg.slotSec - 1e-9)
      const last = Math.floor((hi - seg.origin) / seg.slotSec + 1e-9)
      for (let k = first; k <= last && out.length < limit; k++) out.push(this._slotOf(seg, k))
    }
    return out
  }

  positionAt(time) {
    const seg = this.segmentAt(time)
    if (!seg) return null
    const index = Math.floor((time - seg.origin) / seg.slotSec)
    if (index < 0) return null
    return this._slotOf(seg, index)
  }

  // The start of a downbeat at least `minLead` seconds away, skipping
  // `barsAhead` further bars. Used for count-ins and for landing a tempo change
  // on a bar line.
  nextBarTime(barsAhead = 0, minLead = 0.25) {
    const ac = this._ac || ensureAudio()
    const now = ac ? ac.currentTime : 0
    const seg = this.segmentAt(now) || this.segments[this.segments.length - 1]
    if (!seg) return now + minLead
    const barSec = seg.pulseSec * seg.pulses
    const k = Math.ceil((now + minLead - seg.origin) / barSec - 1e-9)
    return seg.origin + (k + barsAhead) * barSec
  }

  barSeconds() {
    const seg = this.segments[this.segments.length - 1]
    if (seg) return seg.pulseSec * seg.pulses
    const meter = meterById(this.config.meterId)
    return (60 / this.config.bpm) * meter.pulses
  }

  // ── Scheduling ────────────────────────────────────────────────────────────
  _schedule() {
    const ac = this._ac
    if (!ac || !this.running || !this._cur) return

    // A backgrounded tab can starve the timer for seconds. Rather than dump a
    // burst of late clicks, skip the cursor forward to now.
    if (this._cursorTime < ac.currentTime - 0.25) {
      const seg = this._cur
      this._fine = Math.max(this._fine, Math.ceil((ac.currentTime - seg.origin) / seg.fineSec))
      this._cursorTime = seg.origin + this._fine * seg.fineSec
    }

    const horizon = ac.currentTime + LOOKAHEAD
    let guard = 0
    while (this._cursorTime < horizon && guard++ < 512) {
      const nextSeg = this.segments[this.segments.indexOf(this._cur) + 1]
      if (nextSeg && this._cursorTime >= nextSeg.origin - 1e-6) {
        this._cur = nextSeg
        this._fine = 0
        this._cursorTime = nextSeg.origin
      }

      const seg = this._cur
      const when = this._cursorTime

      const clickEvery = seg.fineRes / seg.subdiv
      if (this.config.clickOn && this._fine % clickEvery === 0) {
        const kind = slotKind(this._fine / clickEvery, seg.subdiv, seg.meter)
        if (kind !== 'sub' || this.config.clickSubdivisions) scheduleClick(ac, when, kind)
      }

      const pat = seg.pattern
      const drumEvery = seg.fineRes / seg.patternRes
      if (this.config.drumsOn && pat && this._fine % drumEvery === 0) {
        const stepsPerBar = seg.pulses * seg.patternRes
        const step = ((this._fine / drumEvery) % stepsPerBar + stepsPerBar) % stepsPerBar
        if (pat.kick.includes(step)) scheduleKick(ac, when)
        if (pat.snare.includes(step)) scheduleSnare(ac, when)
        if (pat.hat.includes(step)) scheduleHat(ac, when, 1, step % seg.patternRes === 0)
      }

      this._fine++
      this._cursorTime = seg.origin + this._fine * seg.fineSec
    }

    this._trimSegments()
  }
}
