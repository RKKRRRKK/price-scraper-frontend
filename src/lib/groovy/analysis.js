// Turning a pile of hits into the two or three numbers that actually tell you
// something.
//
// Sign convention, used everywhere: **negative is early (rushing), positive is
// late (dragging)**. The roll, the readout and the stats all agree on it.
//
// The number worth practising against is the standard deviation, not the mean.
// A consistent 15 ms behind the click is a feel; 15 ms of scatter either side
// of it is a timing problem. The summary reports both and the UI leads with
// spread.

import { meterById, slotLabel, slotsPerBar as slotsPerBarOf } from './grid'

export function mean(xs) {
  if (!xs.length) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

export function stdev(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) * (x - m)
  return Math.sqrt(s / (xs.length - 1))
}

export function median(xs) {
  if (!xs.length) return 0
  const a = [...xs].sort((p, q) => p - q)
  const mid = a.length >> 1
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2
}

export function percentile(xs, p) {
  if (!xs.length) return 0
  const a = [...xs].sort((q, r) => q - r)
  const i = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))))
  return a[i]
}

// A hit is { t, devMs, slotInBar, ... }. `settings` carries the grid it was
// played against so the per-position breakdown can be labelled.
export function summarise(hits, settings = {}) {
  const { meterId = '4/4', subdiv = 2, toleranceMs = 25 } = settings
  const meter = meterById(meterId)
  const spb = slotsPerBarOf(meter, subdiv)
  const devs = hits.map((h) => h.devMs)

  const bySlot = Array.from({ length: spb }, (_, i) => ({
    slotInBar: i,
    label: slotLabel(i, subdiv, meter),
    isPulse: i % subdiv === 0,
    n: 0,
    meanMs: 0,
    sdMs: 0,
    devs: [],
  }))
  for (const h of hits) {
    const b = bySlot[h.slotInBar]
    if (b) b.devs.push(h.devMs)
  }
  for (const b of bySlot) {
    b.n = b.devs.length
    b.meanMs = b.n ? mean(b.devs) : 0
    b.sdMs = b.n ? stdev(b.devs) : 0
    delete b.devs
  }

  const inPocket = devs.filter((d) => Math.abs(d) <= toleranceMs).length
  const rush = devs.filter((d) => d < -toleranceMs).length
  const drag = devs.filter((d) => d > toleranceMs).length

  // The position you are worst at, but only where there is enough of it to
  // mean anything — three hits on one sixteenth is noise, not a habit.
  let worst = null
  for (const b of bySlot) {
    if (b.n < 4) continue
    const score = Math.abs(b.meanMs) + b.sdMs * 0.5
    if (!worst || score > worst.score) worst = { ...b, score }
  }

  return {
    count: devs.length,
    meanMs: mean(devs),
    sdMs: stdev(devs),
    medianMs: median(devs),
    medAbsMs: median(devs.map(Math.abs)),
    maxAbsMs: devs.length ? Math.max(...devs.map(Math.abs)) : 0,
    inPocketPct: devs.length ? (inPocket / devs.length) * 100 : 0,
    rushPct: devs.length ? (rush / devs.length) * 100 : 0,
    dragPct: devs.length ? (drag / devs.length) * 100 : 0,
    toleranceMs,
    slotsPerBar: spb,
    bySlot,
    worst,
  }
}

// A symmetric histogram whose range comes from the data, so a tight take gets a
// close-up and a scrappy one is not clipped into its end bins.
export function histogram(devs, { bins = 24, minRange = 60, maxRange = 300 } = {}) {
  const p98 = devs.length ? percentile(devs.map(Math.abs), 98) : 0
  const range = Math.max(minRange, Math.min(maxRange, Math.ceil((p98 * 1.15) / 10) * 10 || minRange))
  const binMs = (range * 2) / bins
  const counts = new Array(bins).fill(0)
  for (const d of devs) {
    const clamped = Math.max(-range, Math.min(range - 1e-9, d))
    const i = Math.min(bins - 1, Math.max(0, Math.floor((clamped + range) / binMs)))
    counts[i]++
  }
  return {
    range,
    binMs,
    counts,
    // Bin centres, for the axis and the tooltip.
    centres: counts.map((_, i) => -range + binMs * (i + 0.5)),
    max: counts.length ? Math.max(...counts) : 0,
  }
}

// The system's latency, estimated from a handful of notes played along with the
// click. Used by calibration, and deliberately robust rather than clever:
//
//  · the first couple of notes are dropped — nobody's first attempt at playing
//    along with a click they have just started is representative
//  · the centre is the median, so one fumble cannot drag it
//  · outliers are rejected against the median absolute deviation rather than
//    the standard deviation, because sd is itself wrecked by the outliers it is
//    supposed to be finding
//
// Returns { offsetMs, kept, skipped, rejected, spreadMs, values, suspect, ok }.
// `values` is handed back so the panel can show its working instead of asking
// to be trusted, and `suspect` flags a run where rejection did most of the
// work — the answer may well be right, but it was reached by throwing away
// half the evidence, which the player should hear about.
export function estimateLatency(raw, { skip = 2, minKept = 4 } = {}) {
  const values = [...raw]
  const used = values.length > skip + minKept ? values.slice(skip) : values
  if (used.length < minKept) {
    return {
      offsetMs: 0,
      kept: 0,
      skipped: 0,
      rejected: 0,
      spreadMs: 0,
      values,
      suspect: true,
      ok: false,
    }
  }

  const centre = median(used)
  // 1.4826 puts MAD on the same scale as a standard deviation for normal data.
  const mad = median(used.map((d) => Math.abs(d - centre))) * 1.4826
  const window = Math.max(2.5 * mad, 12) // never reject inside ±12 ms; that is just playing
  const kept = used.filter((d) => Math.abs(d - centre) <= window)
  const final = kept.length >= minKept ? kept : used

  const rejected = used.length - final.length
  return {
    offsetMs: Math.round(median(final) * 10) / 10,
    kept: final.length,
    skipped: values.length - used.length,
    rejected,
    spreadMs: stdev(final),
    values,
    suspect: rejected >= final.length,
    ok: true,
  }
}

// A plain-language read on the spread. Thresholds are the usual rehearsal-room
// rule of thumb, not science: under ~12 ms of scatter is inaudible on a bass.
export function grade(sdMs) {
  if (sdMs <= 12) return { label: 'Locked', tone: 'good' }
  if (sdMs <= 22) return { label: 'Tight', tone: 'good' }
  if (sdMs <= 35) return { label: 'Loose', tone: 'warn' }
  return { label: 'Scattered', tone: 'bad' }
}

export function feelLabel(meanMs, toleranceMs = 25) {
  const soft = Math.max(6, toleranceMs * 0.3)
  if (meanMs < -soft) return 'ahead of the beat'
  if (meanMs > soft) return 'behind the beat'
  return 'on the beat'
}
