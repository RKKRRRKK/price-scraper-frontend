// Finding the loop in what was played.
//
// Pure functions over Float32Arrays — no Web Audio — so they behave the same in
// the browser and in a Node test. Detection always runs on the dry DI channel:
// the amp's compressor and drive smear exactly the attacks all of this hangs
// off.
//
//   onsets()         where notes start, from a log-energy flux
//   attackFoot()     the sample a note really starts on, not where it got loud
//   markedLoop()     the first take as marked: first note → the press that kept it
//   readTempo()      a loop of known length, read as bars at a tempo
//   findFirstLoop()  the first take: its start, its tempo, a length in whole bars
//   buildLayer()     a take folded into a seamless circular buffer
//   *Boundary()      snapping taps and first notes onto the loop's grid
//   radialPeaks() / linePeaks()   waveforms for the pads and the timeline

const HOP_SEC = 0.005

function db(v, floor) {
  return 10 * Math.log10(v + floor)
}

// ── Onsets ───────────────────────────────────────────────────────────────────
// Energy and high-frequency energy (the first difference, which is what a pick
// or a stick adds), stepped every 5 ms and compared with 10 ms earlier in dB. A
// rise in either is an attack. Working in dB is what lets a re-plucked note
// inside a ringing one register — its absolute energy barely moves, its log
// does.
//
// Each step measures the trailing 20 ms, not just its own 5 ms: one cycle of a
// low E is 24 ms, and a window shorter than that rises and falls with the
// waveform itself, which reads as a stream of attacks that were never played.
//
// Returns [{ i, w }]: the approximate sample index and the strength in dB.
const WIN_HOPS = 4

export function onsets(x, sr, from = 0, to = x.length) {
  from = Math.max(0, Math.floor(from))
  to = Math.min(x.length, Math.floor(to))
  const hop = Math.max(32, Math.round(sr * HOP_SEC))
  const n = Math.floor((to - from) / hop)
  if (n < 6) return []

  const he = new Float64Array(n)
  const hh = new Float64Array(n)
  let prev = from > 0 ? x[from - 1] : 0
  for (let f = 0; f < n; f++) {
    let se = 0
    let sh = 0
    const a = from + f * hop
    for (let i = a; i < a + hop; i++) {
      const v = x[i]
      se += v * v
      const d = v - prev
      sh += d * d
      prev = v
    }
    he[f] = se
    hh[f] = sh
  }
  const e = new Float64Array(n)
  const h = new Float64Array(n)
  let ae = 0
  let ah = 0
  for (let f = 0; f < n; f++) {
    ae += he[f]
    ah += hh[f]
    if (f >= WIN_HOPS) {
      ae -= he[f - WIN_HOPS]
      ah -= hh[f - WIN_HOPS]
    }
    const w = Math.min(f + 1, WIN_HOPS) * hop
    e[f] = Math.max(0, ae) / w
    h[f] = Math.max(0, ah) / w
  }

  // The quietest frames are the noise floor — but in dense playing the
  // quietest frames are decaying notes, not silence, so the floor is also
  // held 40 dB under the loudest frame. Everything below a few times it is
  // treated as silence, so hiss never reads as a rise.
  let maxE = 0
  let maxH = 0
  for (let f = 0; f < n; f++) {
    if (e[f] > maxE) maxE = e[f]
    if (h[f] > maxH) maxH = h[f]
  }
  const noiseE = Math.max(1e-10, Math.min(quantile(e, 0.05), maxE * 1e-4))
  const noiseH = Math.max(1e-11, Math.min(quantile(h, 0.05), maxH * 1e-4))
  const flE = noiseE * 4
  const flH = noiseH * 4
  // A note has to clear the floor by 15 dB, sit within 40 dB of the loudest
  // note, and reach an absolute −64 dB, to count.
  const gate = Math.max(noiseE * 30, maxE * 1e-4, 4e-7)

  const odf = new Float64Array(n)
  for (let f = 2; f < n; f++) {
    const re = db(e[f], flE) - db(e[f - 2], flE)
    const rh = db(h[f], flH) - db(h[f - 2], flH)
    odf[f] = Math.max(0, re) + 0.5 * Math.max(0, rh)
  }

  const out = []
  const minGap = Math.round(0.05 / HOP_SEC)
  let last = -1e9
  for (let f = 2; f < n; f++) {
    const v = odf[f]
    if (v < 6) continue
    let peak = true
    for (let k = Math.max(0, f - 3); k <= Math.min(n - 1, f + 3); k++) {
      if (odf[k] > v || (odf[k] === v && k < f)) {
        peak = false
        break
      }
    }
    if (!peak) continue
    const loud = Math.max(e[f], f + 1 < n ? e[f + 1] : 0, f + 2 < n ? e[f + 2] : 0)
    if (loud < gate) continue
    if (f - last < minGap) continue
    last = f
    out.push({ i: from + (f - 1) * hop, w: v })
  }
  return out
}

function quantile(arr, q) {
  const s = Float64Array.from(arr).sort()
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}

// Walk an approximate onset back to its foot: the first sample that reaches a
// tenth of the attack's peak, less a millisecond so the very first cycle is
// kept whole.
export function attackFoot(x, sr, approx) {
  const a = Math.max(0, Math.floor(approx - 0.015 * sr))
  const b = Math.min(x.length, Math.floor(approx + 0.025 * sr))
  let peak = 0
  for (let i = a; i < b; i++) {
    const v = Math.abs(x[i])
    if (v > peak) peak = v
  }
  if (!peak) return Math.max(0, Math.floor(approx))
  // The level just before the window stands in for the noise.
  let noise = 0
  for (let i = Math.max(0, a - Math.floor(0.01 * sr)); i < a; i++) noise = Math.max(noise, Math.abs(x[i]))
  const thr = Math.max(peak * 0.1, noise * 1.5)
  for (let i = a; i < b; i++) {
    if (Math.abs(x[i]) >= thr) return Math.max(0, i - Math.round(0.001 * sr))
  }
  return Math.max(0, Math.floor(approx))
}

// ── Tempo ────────────────────────────────────────────────────────────────────
// How well onsets (seconds after the first, which sits on beat one) sit on a
// beat grid of period P. Eighths and sixteenths count for less than beats, so
// the score prefers the grid the notes actually lean on.
const LEVELS = [
  [1, 1],
  [2, 0.75],
  [4, 0.5],
]

export function gridScore(ts, ws, P) {
  const sigma = 0.012
  const k2 = 2 * sigma * sigma
  let s = 0
  let tot = 0
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k]
    let best = 0
    for (const [div, weight] of LEVELS) {
      const g = P / div
      const off = t - Math.round(t / g) * g
      const v = weight * Math.exp(-(off * off) / k2)
      if (v > best) best = v
    }
    s += ws[k] * best
    tot += ws[k]
  }
  return tot ? s / tot : 0
}

export function fitPeriod(ts, ws, P0, span = 0.035) {
  const steps = 280
  let bestP = P0
  let best = -1
  for (let k = 0; k <= steps; k++) {
    const P = P0 * (1 - span + (2 * span * k) / steps)
    const sc = gridScore(ts, ws, P)
    if (sc > best) {
      best = sc
      bestP = P
    }
  }
  // Golden-section polish inside the winning step.
  let lo = bestP - (P0 * 2 * span) / steps
  let hi = bestP + (P0 * 2 * span) / steps
  const g = (Math.sqrt(5) - 1) / 2
  let c = hi - g * (hi - lo)
  let d = lo + g * (hi - lo)
  for (let it = 0; it < 30; it++) {
    if (gridScore(ts, ws, c) > gridScore(ts, ws, d)) hi = d
    else lo = c
    c = hi - g * (hi - lo)
    d = lo + g * (hi - lo)
  }
  const P = (lo + hi) / 2
  const sc = gridScore(ts, ws, P)
  return sc >= best ? { P, score: sc } : { P: bestP, score: best }
}

// Candidate beat periods: peaks of the autocorrelation of a smoothed onset
// pulse train, between 40 and 240 bpm.
function periodCandidates(ts, ws) {
  const res = 0.005
  const dur = ts[ts.length - 1] + 0.1
  const n = Math.ceil(dur / res) + 4
  const p = new Float64Array(n)
  const ker = [0.2, 0.6, 1, 0.6, 0.2]
  for (let k = 0; k < ts.length; k++) {
    const c = Math.round(ts[k] / res)
    for (let j = -2; j <= 2; j++) if (c + j >= 0 && c + j < n) p[c + j] += ws[k] * ker[j + 2]
  }
  const minLag = Math.round(0.25 / res)
  const maxLag = Math.min(Math.round(1.5 / res), n - 1)
  const acf = new Float64Array(maxLag + 2)
  for (let L = minLag; L <= maxLag; L++) {
    let s = 0
    for (let i = 0; i + L < n; i++) s += p[i] * p[i + L]
    // Unbiased: long lags have fewer overlapping pairs.
    acf[L] = s / (n - L)
  }
  const peaks = []
  for (let L = minLag + 1; L < maxLag; L++) {
    if (acf[L] > 0 && acf[L] >= acf[L - 1] && acf[L] >= acf[L + 1]) peaks.push({ P: L * res, v: acf[L] })
  }
  peaks.sort((a, b) => b.v - a.v)
  return peaks.slice(0, 8)
}

// How close a length is to a whole number of bars: 1 at a whole number, never
// below 0.3. It ranks tempo candidates against each other; it must not veto
// one, because a stop pressed half a bar late is normal.
function wholeness(bars) {
  const f = Math.abs(bars - Math.round(bars))
  return 0.3 + 0.7 * Math.exp(-0.5 * (f / 0.18) ** 2)
}

// ── The first loop ───────────────────────────────────────────────────────────
// x: dry samples. startHint: the live detector's first note (index into x).
// stopIdx: where the stop was pressed (index into x). bpb: beats per bar.
//
// The stop press is the strongest cue there is about the length — the player
// meant "about here" — and the onsets are the strongest cue about the period.
// Tempo candidates are scored on both: how well the notes sit on the grid, a
// gentle preference for 120 bpm to settle octave ties, and how close the stop
// press lands to a whole number of bars at that tempo. That last term is what
// separates a beat from a dotted eighth in an even run of sixteenths.
//
// Returns { start, len, bpm, bars } with indices into x; bpm and bars are null
// when the playing gave too little to go on, and the loop is then exactly
// first note → stop.
export function findFirstLoop(x, sr, { startHint, stopIdx, bpb = 4 }) {
  const all = onsets(x, sr, Math.max(0, startHint - 0.25 * sr), Math.min(x.length, stopIdx + 0.05 * sr))
  // The first note: the detected onset nearest the live hint.
  let first = null
  for (const o of all) {
    if (Math.abs(o.i - startHint) < 0.08 * sr && (!first || Math.abs(o.i - startHint) < Math.abs(first.i - startHint))) first = o
  }
  const start = attackFoot(x, sr, first ? first.i : startHint)
  const D = (stopIdx - start) / sr
  const raw = { start, len: Math.max(Math.round(0.25 * sr), stopIdx - start), bpm: null, bars: null }

  const notes = all.filter((o) => o.i >= start - 0.01 * sr && o.i <= stopIdx)
  if (notes.length < 4 || D < 1) return raw
  // Every note at its foot, like the first: the detector's own positions lag
  // by up to a hop, and unevenly, which is the same order as the grid's tolerance.
  const ts = notes.map((o, k) => (k === 0 ? 0 : Math.max(0, (attackFoot(x, sr, o.i) - start) / sr)))
  const ws = notes.map((o) => Math.min(30, o.w))

  // Every candidate is read in 60–180 bpm first. Octave twins (110 and 220)
  // then compete on equal terms; left unfolded, the faster one always fits a
  // stop pressed half a bar early as "a whole number of bars".
  const fits = periodCandidates(ts, ws).map((c) => {
    let P0 = c.P
    while (P0 < 60 / 180) P0 *= 2
    while (P0 >= 1) P0 /= 2
    return fitPeriod(ts, ws, P0)
  })
  // Only grids that hold the notes about as well as the best one compete;
  // among those, the stop press and the tempo prior decide.
  const top = Math.max(0, ...fits.map((f) => f.score))
  let best = null
  for (const fit of fits) {
    if (fit.score < 0.85 * top) continue
    const prior = Math.exp(-0.5 * (Math.log2(fit.P / 0.5) / 1.1) ** 2)
    const bars = D / (bpb * fit.P)
    const rank = fit.score * prior * (bars >= 0.5 ? wholeness(bars) : 0.2)
    if (!best || rank > best.rank) best = { ...fit, rank }
  }
  // Confidence is the grid fit alone: how much of the playing sits on it.
  if (!best || best.score < 0.5) return raw

  const P = best.P
  const nb = chooseBars(D / (bpb * P), notes, start, bpb * P, sr)
  return { start, len: Math.round(nb * bpb * P * sr), bpm: 60 / P, bars: nb }
}

// ── A marked loop ────────────────────────────────────────────────────────────
// The first loop exactly as the player marked it: from the first note to the
// press that kept it. The start goes to the note's foot. The end goes to the
// foot of a note within 60 ms of the press, if there is one — keeping a loop
// means pressing on the next pass's downbeat, and a key press is about that
// far off either way. Nothing else moves: the length is the player's.
//
// The tempo only names the grid (readTempo). bpm and bars are null when no
// bar count fits well.
export function markedLoop(x, sr, { startHint, stopIdx, bpb = 4 }) {
  const all = onsets(x, sr, Math.max(0, startHint - 0.25 * sr), Math.min(x.length, stopIdx + 0.1 * sr))
  const nearest = (at, tol) => {
    let best = null
    for (const o of all) {
      const d = Math.abs(o.i - at)
      if (d < tol * sr && (!best || d < Math.abs(best.i - at))) best = o
    }
    return best
  }
  const first = nearest(startHint, 0.08)
  const start = attackFoot(x, sr, first ? first.i : startHint)
  const next = nearest(stopIdx, 0.06)
  const end = next && next !== first ? attackFoot(x, sr, next.i) : stopIdx
  const len = Math.max(Math.round(0.25 * sr), end - start)
  return { start, len, ...readTempo(x, sr, start, len, bpb, all) }
}

// A loop whose length is already decided, read as a tempo: the whole number
// of bars that puts the notes best on the beat, 60–180 bpm, the first note on
// one. { bpm, bars }, both null when no bar count fits well.
export function readTempo(x, sr, start, len, bpb = 4, all = null) {
  const none = { bpm: null, bars: null }
  all = all || onsets(x, sr, Math.max(0, start - 0.05 * sr), Math.min(x.length, start + len))
  const notes = all.filter((o) => o.i >= start - 0.01 * sr && o.i < start + len - 0.03 * sr)
  if (notes.length < 4) return none
  const ts = notes.map((o, k) => (k === 0 ? 0 : Math.max(0, (attackFoot(x, sr, o.i) - start) / sr)))
  const ws = notes.map((o) => Math.min(30, o.w))
  const D = len / sr
  let best = null
  for (let bars = 1; bars <= 32; bars++) {
    const P = D / (bars * bpb)
    if (P > 1 || P < 60 / 180) continue
    const score = gridScore(ts, ws, P)
    const rank = score * Math.exp(-0.5 * (Math.log2(P / 0.5) / 1.1) ** 2)
    if (!best || rank > best.rank) best = { bars, P, score, rank }
  }
  if (!best || best.score < 0.5) return none
  return { bpm: 60 / best.P, bars: best.bars }
}

// Where the loop ends, in bars, given where the stop landed (in bars).
// Round to the nearest bar line, except that a stop pressed late over a phrase
// that had already finished — nothing new played after the earlier bar line —
// belongs to that earlier line.
export function chooseBars(Dbars, notes, start, bar, sr) {
  if (Dbars < 1) return 1
  const lo = Math.floor(Dbars)
  if (Dbars - lo < 0.5) return lo
  const after = start + (lo + 0.1) * bar * sr
  const played = notes.some((o) => o.i > after)
  return played ? lo + 1 : lo
}

// ── Grid snapping ────────────────────────────────────────────────────────────
// All times in seconds, boundaries at anchor + k·unit.

// A first note: the boundary at or before it, or the next one when the note
// rushed it by a hair.
export function onsetBoundary(t, anchor, unit) {
  const tol = Math.min(0.1 * unit, 0.15)
  return anchor + Math.floor((t - anchor + tol) / unit) * unit
}

// A tap on the record button: the next boundary, or the one just passed when
// the tap was a little late.
export function tapBoundary(t, anchor, unit) {
  const tol = Math.min(0.25 * unit, 0.5)
  return anchor + Math.ceil((t - anchor - tol) / unit) * unit
}

// A stop: the nearest boundary, but never less than one unit after the start.
export function stopBoundary(t, start, unit) {
  return start + Math.max(1, Math.round((t - start) / unit)) * unit
}

// How long a new layer loops for, in units, given how many it recorded and how
// many the master loop is. Shorter takes round up to a length the master
// divides into, so a one-bar shaker over a four-bar loop repeats every bar.
// Longer ones round to a multiple of the master; the overhang folds back over
// the start, which is what an overdub is.
export function layerUnits(k, masterUnits) {
  if (k <= masterUnits) {
    for (let d = k; d <= masterUnits; d++) if (masterUnits % d === 0) return d
    return masterUnits
  }
  let best = masterUnits
  for (const m of [1, 2, 4, 8]) {
    const len = masterUnits * m
    if (Math.abs(k - len) <= Math.abs(k - best)) best = len
  }
  return best
}

// ── Building a layer ─────────────────────────────────────────────────────────
// Folds a recorded region into a circular buffer of `len` samples, starting at
// `offset`. raw.dry / raw.wet are the capture with margins either side;
// `start` indexes raw at the region's first sample and the region runs `R`
// samples.
//
// The seam is the whole game. Two cases, told apart by whether a note starts
// right at the region's end:
//
//  · continued — the player went on into the next pass, so the next downbeat
//    is sitting on the seam. The end is crossfaded into the audio from just
//    before the start (20 ms), which carries the downbeat in once instead of
//    twice and leaves no step at the wrap.
//  · ring — the last note was still sounding. Its tail, up to the next note or
//    two seconds, is added over the start of the loop, exactly as it would
//    have rung if the phrase really repeated.
export function buildLayer(raw, { len, offset = 0, start, R }, sr) {
  const X = Math.round(0.02 * sr)
  const n = raw.dry.length
  const end = start + R
  const near = onsets(raw.dry, sr, end - 3 * X, Math.min(n, end + 2 * sr))
  const continued = near.some((o) => Math.abs(o.i - end) <= 2 * X)

  let F = 0
  if (!continued) {
    const next = near.find((o) => o.i > end + 2 * X)
    let limit = Math.min(n, end + Math.round(2 * sr))
    if (next) limit = Math.min(limit, next.i - Math.round(0.01 * sr))
    F = Math.max(0, Math.min(limit - end, len))
  }
  const fadeLen = Math.max(1, Math.min(F, F >= 1.9 * sr ? Math.round(0.4 * sr) : Math.round(0.05 * sr)))

  const mod = (i) => ((i % len) + len) % len
  const fold = (ch) => {
    const buf = new Float32Array(len)
    const at = (i) => (i >= 0 && i < n ? ch[i] : 0)
    for (let i = 0; i < R; i++) buf[mod(offset + i)] += at(start + i)
    for (let i = 0; i < X; i++) buf[mod(offset - X + i)] += (i / X) * at(start - X + i)
    if (continued) {
      for (let i = 0; i < X; i++) buf[mod(offset + R - X + i)] -= (i / X) * at(end - X + i)
    } else {
      for (let i = 0; i < F; i++) {
        const left = F - i
        const g = left < fadeLen ? left / fadeLen : 1
        buf[mod(offset + R + i)] += g * at(end + i)
      }
    }
    return buf
  }
  return { dry: fold(raw.dry), wet: fold(raw.wet), seam: continued ? 'continued' : 'ring' }
}

// ── Waveforms ────────────────────────────────────────────────────────────────
// Peak level per angular bin around a circular buffer, normalised to the
// loudest bin so a quiet layer still draws a readable shape.
export function radialPeaks(buf, bins = 160) {
  const out = new Float32Array(bins)
  if (!buf?.length) return out
  const per = buf.length / bins
  let max = 0
  for (let b = 0; b < bins; b++) {
    const a = Math.floor(b * per)
    const z = Math.floor((b + 1) * per)
    let p = 0
    for (let i = a; i < z; i++) {
      const v = Math.abs(buf[i])
      if (v > p) p = v
    }
    out[b] = p
    if (p > max) max = p
  }
  if (max > 0) for (let b = 0; b < bins; b++) out[b] = Math.sqrt(out[b] / max)
  return out
}

// Peak level per bin over `frames` samples from `from`, wrapping around the
// buffer. `norm` is the level drawn full height (the layer's own peak).
export function linePeaks(buf, from, frames, bins, norm) {
  const out = new Float32Array(bins)
  if (!buf?.length || !norm) return out
  const len = buf.length
  const per = frames / bins
  // Stride through long bins; a timeline cell is a few dozen pixels wide.
  const stride = Math.max(1, Math.floor(per / 64))
  for (let b = 0; b < bins; b++) {
    const a = Math.floor(b * per)
    const z = Math.floor((b + 1) * per)
    let p = 0
    for (let i = a; i < z; i += stride) {
      const v = Math.abs(buf[(((from + i) % len) + len) % len])
      if (v > p) p = v
    }
    out[b] = Math.min(1, Math.sqrt(p / norm))
  }
  return out
}

export function peakOf(buf) {
  let p = 0
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i])
    if (v > p) p = v
  }
  return p
}
