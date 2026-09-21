// Measuring the round trip, on a click train of its own.
//
// Calibration cannot borrow the practice grid. Matching a note to the nearest
// grid line can only ever measure a delay smaller than half the gap between
// lines — anything larger silently wraps onto the next line and comes back as a
// small number. At 90 bpm in eighths that ceiling is 167 ms, so a real 430 ms
// round trip is reported as a tidy, entirely fictional 96 ms. The number looks
// plausible, which is what makes it dangerous.
//
// So this runs its own train: one click every `intervalSec`, scheduled far
// enough apart that any latency a browser can plausibly produce still lands
// nearer its own click than the next one. The measurable window is
// ±intervalSec/2, and at the default 1.2 s that is ±600 ms — comfortably past
// the worst case.
//
// The click train is also why calibration stops the metronome first: two
// unrelated click streams would be impossible to play along with.

// The same train serves two jobs. Played as clicks it measures the round trip
// *including you* — the loop through your ears and hands. Played as probes into
// the interface's loopback it measures the machine alone, which is the same
// number minus the human. The matching below is the fiddly part and is shared
// by both rather than written twice.

import { scheduleClick } from './click'

export class CalibrationRun {
  constructor(
    ac,
    {
      count = 10,
      intervalSec = 1.2,
      leadSec = 1.0,
      earlySec = 0.08,
      voice = null,
      silent = [],
    } = {},
  ) {
    this.ac = ac
    this.count = count
    this.intervalSec = intervalSec
    this.leadSec = leadSec
    // (ac, when, index, count) => void. Defaults to the metronome click.
    this.voice = voice
    // Slots that are scheduled but never sounded — the control group. Anything
    // detected in one of these did not come from us, which is the difference
    // between a measurement and a coincidence. See `ghosts` in the view.
    this.silent = new Set(silent)
    // How far *before* a click a note may still belong to it. Small on purpose
    // — see match().
    this.earlySec = earlySec
    this.clickTimes = []
    this.running = false
  }

  // Books the whole train up front — it is only a dozen clicks, and scheduling
  // them in one go means the spacing is exact rather than at the mercy of a
  // timer.
  start() {
    if (this.running) return
    this.running = true
    const t0 = this.ac.currentTime + this.leadSec
    this.clickTimes = []
    for (let i = 0; i < this.count; i++) {
      const when = t0 + i * this.intervalSec
      this.clickTimes.push(when)
      if (this.silent.has(i)) {
        // Scheduled, deliberately not sounded.
      } else if (this.voice) {
        this.voice(this.ac, when, i, this.count)
      } else {
        // The last two are accented so you can hear the run ending rather than
        // being left wondering whether it is still going.
        scheduleClick(this.ac, when, i >= this.count - 2 ? 'bar' : 'pulse')
      }
    }
    return t0
  }

  // Seconds until the train finishes, for the progress readout.
  get endsAt() {
    return this.clickTimes.length ? this.clickTimes[this.clickTimes.length - 1] : 0
  }

  // How many clicks have already sounded.
  soundedBy(time) {
    let n = 0
    for (const t of this.clickTimes) if (t <= time) n++
    return n
  }

  // Match an attack to the click it was aiming at.
  //
  // The window is deliberately *asymmetric*. Round-trip latency is physically
  // positive — you cannot react to a click before it has sounded — so a note
  // arriving long after its click is the expected case, while one arriving
  // meaningfully before it is not a very fast player but an alias from the next
  // click. Allowing only a little anticipation and giving the rest of the
  // interval to the late side turns a ±600 ms window into −80…+1120 ms at the
  // default spacing, which is past anything a browser can do.
  //
  // The window is exactly one interval long, so at most one click can claim any
  // given note and "nearest" never has to break a tie.
  match(time) {
    if (!this.clickTimes.length) return null
    for (let i = 0; i < this.clickTimes.length; i++) {
      const d = time - this.clickTimes[i]
      if (d >= -this.earlySec && d < this.intervalSec - this.earlySec) {
        return { index: i, clickTime: this.clickTimes[i], devMs: d * 1000 }
      }
    }
    return null
  }

  get maxMeasurableMs() {
    return (this.intervalSec - this.earlySec) * 1000
  }

  stop() {
    this.running = false
    // Clicks already booked will still sound; there is no way to unschedule
    // them, and a couple of stray ticks is better than a stuck run.
    this.clickTimes = []
  }
}
