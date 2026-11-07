// Catching the groove: find the part that was played twice in a row, and keep
// one pass of it.
//
// The way it is meant to be used: hit record, noodle until the groove turns
// up, play it again, stop. Everything before the repeat is thrown away.
//
// How: the take is compared with itself shifted by every candidate loop
// length (a "lag"). Where the playing repeats at lag L, each moment sounds
// like the moment L later, so the similarity at that lag stays high for a
// whole pass — something noodling never does, even in the same rhythm,
// because the notes differ.
//
// What "sounds like" means matters more than anything else here. Noodling
// uses the groove's own notes, often an octave apart, so a chroma (which has
// no octaves) rates noodling as nearly repeating and the groove's start
// smears back into it. So a single clear note — a bass line — is compared by
// its pitch (an NSDF pitch track, octave-exact), and only frames without one
// (drums, chords) fall back to chroma and spectral shape.
//
// That frame comparison is now the second choice. It wants the second pass to
// *sound* like the first, and real playing doesn't — see "Notes that repeat"
// below, which runs first.
//
// Then:
//   · the lag: the strongest one, or the shortest that is nearly as strong —
//     a one-bar groove played four times also repeats at two bars, and the
//     shorter loop is the groove — among repeats that end near the stop, since
//     the groove is found last
//   · where the repeat starts: the strongest step from not-repeating to
//     repeating, i.e. where the groove came in
//   · the beat grid: fitted to every note in the repeat, which gives the
//     tempo, a length exact to the sample (human timing averages out across
//     the notes), and the beat the downbeat must sit on
//   · the pass kept: the last complete one — the second time is the one that
//     was played knowing the part
//
// Pure functions over Float32Arrays, like detect.js, and tested the same way.

import { onsets, attackFoot, gridScore, fitPeriod } from './detect'

const TARGET_SR = 6000
const FFT_N = 512 // ~85 ms at the analysis rate
const HOP = 256 // ~42 ms
const BAND_EDGES = [40, 80, 160, 320, 640, 1280, 2400]
const NB = BAND_EDGES.length // six FFT bands plus one full-rate HF band

// ── FFT ──────────────────────────────────────────────────────────────────────
const tableCache = new Map()

function tablesFor(n) {
  let t = tableCache.get(n)
  if (t) return t
  const levels = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b)
    rev[i] = r
  }
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = Math.sin((2 * Math.PI * i) / n)
  }
  t = { rev, cos, sin }
  tableCache.set(n, t)
  return t
}

function fft(re, im) {
  const n = re.length
  const { rev, cos, sin } = tablesFor(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let i = 0; i < n; i += size) {
      for (let j = i, k = 0; j < i + half; j++, k += step) {
        const l = j + half
        const tr = re[l] * cos[k] + im[l] * sin[k]
        const ti = im[l] * cos[k] - re[l] * sin[k]
        re[l] = re[j] - tr
        im[l] = im[j] - ti
        re[j] += tr
        im[j] += ti
      }
    }
  }
}

const HANN = (() => {
  const w = new Float64Array(FFT_N)
  for (let i = 0; i < FFT_N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1))
  return w
})()

// Two RBJ low-pass biquads in series (4th-order Butterworth) ahead of the
// decimation, so the analysis band isn't full of folded-down treble.
function lowpass(x, from, to, sr, f0) {
  const out = new Float32Array(to - from)
  out.set(x.subarray(from, to))
  for (const Q of [0.5412, 1.3066]) {
    const w = (2 * Math.PI * f0) / sr
    const a = Math.sin(w) / (2 * Q)
    const c = Math.cos(w)
    const a0 = 1 + a
    const b0 = (1 - c) / 2 / a0
    const b1 = (1 - c) / a0
    const a1 = (-2 * c) / a0
    const a2 = (1 - a) / a0
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    for (let i = 0; i < out.length; i++) {
      const v = out[i]
      const y = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = v
      y2 = y1
      y1 = y
      out[i] = y
    }
  }
  return out
}

// ── Pitch ────────────────────────────────────────────────────────────────────
// McLeod's normalised square difference over one frame, autocorrelation done
// by FFT. Returns a MIDI note number, or NaN when the frame has no clear
// single pitch (a chord, a drum, a breath between notes). 28–1000 Hz.
const ACF_N = FFT_N * 2
const acfRe = new Float64Array(ACF_N)
const acfIm = new Float64Array(ACF_N)
const sq = new Float64Array(FFT_N + 1)

function framePitch(y, at, dsr) {
  for (let i = 0; i < ACF_N; i++) {
    acfRe[i] = i < FFT_N ? y[at + i] : 0
    acfIm[i] = 0
  }
  sq[0] = 0
  for (let i = 0; i < FFT_N; i++) sq[i + 1] = sq[i] + acfRe[i] * acfRe[i]
  fft(acfRe, acfIm)
  for (let i = 0; i < ACF_N; i++) {
    acfRe[i] = acfRe[i] * acfRe[i] + acfIm[i] * acfIm[i]
    acfIm[i] = 0
  }
  fft(acfRe, acfIm) // the power spectrum is real and even: a forward FFT inverts it
  const minT = Math.max(2, Math.floor(dsr / 1000))
  const maxT = Math.min(FFT_N - 32, Math.ceil(dsr / 28))
  const nsdf = (t) => {
    const m = sq[FFT_N - t] + (sq[FFT_N] - sq[t])
    return m > 0 ? (2 * (acfRe[t] / ACF_N)) / m : 0
  }
  // Key maxima: the highest point of each positive lobe after the first dip.
  let t = minT
  while (t < maxT && nsdf(t) > 0) t++
  const keys = []
  let lobe = null
  for (; t <= maxT; t++) {
    const v = nsdf(t)
    if (v > 0) {
      if (!lobe || v > lobe.v) lobe = { t, v }
    } else if (lobe) {
      keys.push(lobe)
      lobe = null
    }
  }
  if (lobe) keys.push(lobe)
  if (!keys.length) return NaN
  const top = Math.max(...keys.map((k) => k.v))
  if (top < 0.8) return NaN
  const k = keys.find((q) => q.v >= 0.9 * top)
  const a = nsdf(k.t - 1)
  const b = nsdf(k.t)
  const c = nsdf(k.t + 1)
  const den = a - 2 * b + c
  const tau = den ? k.t + (0.5 * (a - c)) / den : k.t
  return 69 + 12 * Math.log2(dsr / tau / 440)
}

// ── Features ─────────────────────────────────────────────────────────────────
// Per ~42 ms frame: the pitch (or NaN), a 12-bin chroma (unit length), the
// spectral shape across seven bands (dB, each frame's mean removed, so playing
// a little softer the second time still matches), the loudness, and whether
// the frame is silent.
export function features(x, sr, from = 0, to = x.length) {
  from = Math.max(0, Math.floor(from))
  to = Math.min(x.length, Math.floor(to))
  const factor = Math.max(1, Math.round(sr / TARGET_SR))
  const dsr = sr / factor
  const filt = lowpass(x, from, to, sr, Math.min(2000, dsr * 0.4))
  const m = Math.floor(filt.length / factor)
  const y = new Float32Array(m)
  for (let i = 0; i < m; i++) y[i] = filt[i * factor]

  const n = m >= FFT_N ? Math.floor((m - FFT_N) / HOP) + 1 : 0
  const pitch = new Float32Array(n)
  const chroma = new Float32Array(n * 12)
  const bands = new Float32Array(n * NB)
  const loud = new Float32Array(n)
  const silent = new Uint8Array(n)

  const binHz = dsr / FFT_N
  const pcA = new Int8Array(FFT_N / 2).fill(-1)
  const pcW = new Float32Array(FFT_N / 2)
  const band = new Int8Array(FFT_N / 2).fill(-1)
  for (let k = 1; k < FFT_N / 2; k++) {
    const f = k * binHz
    if (f >= 70 && f <= 1600) {
      const midi = 69 + 12 * Math.log2(f / 440)
      const lo = Math.floor(midi)
      pcA[k] = ((lo % 12) + 12) % 12
      pcW[k] = 1 - (midi - lo)
    }
    for (let b = 0; b < BAND_EDGES.length - 1; b++) if (f >= BAND_EDGES[b] && f < BAND_EDGES[b + 1]) band[k] = b
  }

  const re = new Float64Array(FFT_N)
  const im = new Float64Array(FFT_N)
  const hopFull = HOP * factor
  const winFull = FFT_N * factor
  const be = new Float64Array(NB)
  const bc = new Int32Array(NB)
  for (let f = 0; f < n; f++) {
    const at = f * HOP
    for (let i = 0; i < FFT_N; i++) {
      re[i] = y[at + i] * HANN[i]
      im[i] = 0
    }
    fft(re, im)
    be.fill(0)
    bc.fill(0)
    const c = chroma.subarray(f * 12, f * 12 + 12)
    for (let k = 1; k < FFT_N / 2; k++) {
      const p = re[k] * re[k] + im[k] * im[k]
      const mag = Math.sqrt(p)
      if (pcA[k] >= 0) {
        c[pcA[k]] += mag * pcW[k]
        c[(pcA[k] + 1) % 12] += mag * (1 - pcW[k])
      }
      if (band[k] >= 0) {
        be[band[k]] += p
        bc[band[k]]++
      }
    }
    // The top band is the full-rate first difference: the pick, the stick,
    // the hat — everything the decimation threw away.
    const a0 = from + at * factor
    let hf = 0
    let prev = x[a0 - 1] || 0
    for (let i = a0; i < Math.min(to, a0 + winFull); i++) {
      const d = x[i] - prev
      hf += d * d
      prev = x[i]
    }
    be[NB - 1] = hf / winFull
    bc[NB - 1] = 1

    let mean = 0
    for (let b = 0; b < NB; b++) {
      const v = 10 * Math.log10(be[b] / Math.max(1, bc[b]) + 1e-12)
      bands[f * NB + b] = v
      mean += v
    }
    mean /= NB
    loud[f] = mean
    for (let b = 0; b < NB; b++) bands[f * NB + b] -= mean
    let norm = 0
    for (let k = 0; k < 12; k++) {
      c[k] = Math.sqrt(c[k])
      norm += c[k] * c[k]
    }
    norm = Math.sqrt(norm)
    if (norm > 0) for (let k = 0; k < 12; k++) c[k] /= norm
  }

  let maxLoud = -Infinity
  for (let f = 0; f < n; f++) maxLoud = Math.max(maxLoud, loud[f])
  for (let f = 0; f < n; f++) {
    silent[f] = loud[f] < Math.max(maxLoud - 45, -100) ? 1 : 0
    pitch[f] = silent[f] ? NaN : framePitch(y, f * HOP, dsr)
  }
  // A pitch only counts if it holds for two frames. A kick drum's sweep reads
  // as a clear pitch in any one frame, but a different one in each, and two
  // identical kicks 10 ms apart would then disagree about their note.
  const raw = pitch.slice()
  for (let f = 0; f < n; f++) {
    const p = raw[f]
    if (p !== p) continue
    const steady = (f > 0 && Math.abs(raw[f - 1] - p) < 1) || (f < n - 1 && Math.abs(raw[f + 1] - p) < 1)
    if (!steady) pitch[f] = NaN
  }

  // A frame of slack either side, so a note played 20 ms off still matches.
  smooth(chroma, n, 12)
  smooth(bands, n, NB)

  return {
    n,
    from,
    hop: hopFull,
    // Sample index of a frame's centre.
    time: (f) => from + f * hopFull + winFull / 2,
    pitch,
    chroma,
    bands,
    loud,
    silent,
  }
}

function smooth(a, n, d) {
  const src = a.slice()
  for (let f = 0; f < n; f++) {
    for (let k = 0; k < d; k++) {
      const c = src[f * d + k]
      const l = f > 0 ? src[(f - 1) * d + k] : c
      const r = f < n - 1 ? src[(f + 1) * d + k] : c
      a[f * d + k] = 0.25 * l + 0.5 * c + 0.25 * r
    }
  }
}

// How alike two frames sound, 0…1.
function sim(F, i, j) {
  const si = F.silent[i]
  const sj = F.silent[j]
  if (si && sj) return 1
  if (si || sj) return 0
  let c = 0
  for (let k = 0; k < 12; k++) c += F.chroma[i * 12 + k] * F.chroma[j * 12 + k]
  let b = 0
  for (let k = 0; k < NB; k++) b += Math.abs(F.bands[i * NB + k] - F.bands[j * NB + k])
  b /= NB
  const l = Math.abs(F.loud[i] - F.loud[j])
  const timbre = 0.6 * c + 0.4 * Math.exp(-(b / 4 + l / 12))

  const pi = F.pitch[i]
  // The nearest pitch within a frame either way: a note played a little
  // early or late is the same note.
  let d = Infinity
  for (let u = Math.max(0, j - 1); u <= Math.min(F.n - 1, j + 1); u++) {
    const pj = F.pitch[u]
    if (pi === pi && pj === pj) d = Math.min(d, Math.abs(pi - pj))
  }
  if (d < Infinity) return 0.65 * Math.exp(-(d * d) / 0.5) + 0.35 * timbre
  const vi = pi === pi
  const vj = F.pitch[j] === F.pitch[j]
  return vi !== vj ? 0.8 * timbre : timbre
}

function lagCurve(F, L) {
  const m = Math.max(0, F.n - L)
  const d = new Float32Array(m)
  for (let t = 0; t < m; t++) d[t] = sim(F, t, t + L)
  const P = new Float64Array(m + 1)
  for (let t = 0; t < m; t++) P[t + 1] = P[t] + d[t]
  return { d, P, m }
}

// Prefix count of sounding frames. Two stretches of silence match perfectly,
// so a pass has to be mostly playing to count as a repeat.
function soundingPrefix(F) {
  if (!F.sounding) {
    const S = new Int32Array(F.n + 1)
    for (let t = 0; t < F.n; t++) S[t + 1] = S[t] + (F.silent[t] ? 0 : 1)
    F.sounding = S
  }
  return F.sounding
}

function mostlyPlayed(F, a, b) {
  const S = soundingPrefix(F)
  return S[b] - S[a] >= 0.5 * (b - a)
}

// ── The search ───────────────────────────────────────────────────────────────
// A window of `L` frames from s that matches the next L frames. Up to a
// quarter of the second pass may be missing — a stop pressed a beat early.
const MIN_COVER = 0.75
// How strong a repeat has to be: mean similarity over a whole pass.
const THRESHOLD = 0.8
// How much stronger than the take's typical self-similarity.
const CONTRAST = 0.08
// How long after a repeat the stop may come and it still counts as the one
// that was found last.
const SLACK_SEC = 4

// `minEnd`: the repeat's second pass has to reach at least this frame. The
// groove is found last, so a repeat that ended long before the stop is a
// coincidence in the noodling, not the groove.
function bestWindow(F, curve, L, minEnd) {
  const { P, m } = curve
  let best = null
  for (let s = 0; s < m; s++) {
    const b = Math.min(s + L, m)
    if (b - s < MIN_COVER * L || s + 2 * L < minEnd || !mostlyPlayed(F, s, b)) continue
    const R = (P[b] - P[s]) / (b - s)
    // A slight lean towards the end of the take, for the same reason.
    const score = R + 0.03 * ((s + 2 * L) / F.n)
    if (!best || score > best.score) best = { s, R, score }
  }
  return best
}

function chooseLag(F, lags, slack) {
  const rows = []
  for (const L of lags) {
    if (L < 2 || L >= F.n) continue
    const best = bestWindow(F, lagCurve(F, L), L, F.n - Math.max(slack, L))
    if (best) rows.push({ L, ...best })
  }
  if (!rows.length) return null
  const sorted = rows.map((r) => r.R).sort((a, b) => a - b)
  const typical = sorted[Math.floor(sorted.length / 2)]
  const top = Math.max(...rows.map((r) => r.R))
  if (top < THRESHOLD || top - typical < CONTRAST) return null
  // Peaks only — the lags either side of the true one score nearly as well
  // and must not count as shorter loops.
  const peaks = rows.filter((r, i) => (i === 0 || r.R >= rows[i - 1].R) && (i === rows.length - 1 || r.R >= rows[i + 1].R))
  const near = peaks.filter((r) => r.R >= top - 0.035 && r.R >= THRESHOLD)
  near.sort((a, b) => a.L - b.L)
  return near[0] || null
}

// The run of repeated playing around the chosen window, in frames: where the
// repeat began, and where it stopped repeating.
//
// Both ends are found as the strongest step in similarity — repeating on one
// side, not on the other — over a window of a second or so either side. A
// frame-by-frame walk stopped at the first noisy frame inside the groove
// and put the loop's start mid-phrase.
function repeatRun(F, L, s, top) {
  const { P, m } = lagCurve(F, L)
  const W = Math.max(4, Math.min(Math.round(L / 3), 36))
  // Outside the take counts as neutral, not as "not repeating": a groove
  // played from the first note has nothing before it to step up from.
  const NEUTRAL = 0.6
  const mean = (a, b) => {
    const lo = Math.max(0, a)
    const hi = Math.min(m, b)
    const inside = Math.max(0, hi - lo)
    const sum = inside ? P[hi] - P[lo] : 0
    return (sum + NEUTRAL * (b - a - inside)) / (b - a)
  }
  const level = Math.max(0.75, top - 0.1)

  // Where it began must repeat from there on through the window: a lucky
  // stretch of noodling further back is not the start.
  let t1 = s
  let best = -Infinity
  for (let a = 0; a <= Math.min(m - 1, s + Math.round(L / 4)); a++) {
    const after = mean(a, a + W)
    if (after < level || mean(a, s + L) < level - 0.05 || !mostlyPlayed(F, a, Math.min(F.n, a + W))) continue
    const step = after - mean(a - W, a)
    if (step > best + 1e-9) {
      best = step
      t1 = a
    }
  }

  let t2 = m - 1
  best = -Infinity
  for (let b = Math.max(t1 + 1, s); b <= m; b++) {
    const before = mean(b - W, b)
    if (before < level || mean(s, b) < level - 0.05) continue
    const step = before - mean(b, b + W)
    if (step > best + 1e-9 || (step >= best - 1e-9 && b - 1 > t2)) {
      best = Math.max(best, step)
      t2 = b - 1
    }
  }
  return { t1, end: t2 + L }
}

// ── Notes and the grid ───────────────────────────────────────────────────────
function feet(x, sr, a, b) {
  return onsets(x, sr, a, b).map((o) => ({ i: attackFoot(x, sr, o.i), w: o.w }))
}

function nearestNote(notes, at, tol) {
  let best = null
  for (const o of notes) if (Math.abs(o.i - at) <= tol && (!best || Math.abs(o.i - at) < Math.abs(best.i - at))) best = o
  return best
}

// Where the repeat began, to the note. The similarity run gets within a few
// hundred milliseconds; this walks back from a note inside the repeat while
// each note has a note of the same sound one loop later, and stops at the
// first that doesn't — forgiving a miss let it wander into noodling that
// happened to land one matching note.
function repeatStart(F, notes, len, sr, runStart, runEnd) {
  const frameOf = (i) => Math.round((i - F.time(0)) / F.hop)
  // The best of the frames on and just after the attack, compared in step:
  // a hi-hat is gone a frame later, a bass note's pitch settles a frame in.
  const matches = (o) => {
    const q = nearestNote(notes, o.i + len, 0.05 * sr)
    if (!q || q === o) return false
    const fa = frameOf(o.i)
    const fb = frameOf(q.i)
    let best = 0
    for (let d = 0; d <= 2; d++) {
      if (fa + d < 0 || fb + d >= F.n) continue
      best = Math.max(best, sim(F, fa + d, fb + d))
    }
    const voiced = F.pitch[Math.min(F.n - 1, fa + 1)] === F.pitch[Math.min(F.n - 1, fa + 1)]
    return best >= (voiced ? 0.75 : 0.7)
  }
  const k0 = notes.findIndex((o) => o.i >= runStart && o.i + len <= runEnd + 0.05 * sr && matches(o))
  if (k0 < 0) return runStart
  let start = notes[k0].i
  for (let j = k0 - 1; j >= 0; j--) {
    const o = notes[j]
    if (o.i < runStart - 0.5 * sr || !matches(o)) break
    start = o.i
  }
  return start
}

// The loop length from the notes alone: each onset matched with the one a
// loop later, two loops later and so on, every gap divided down to one loop
// and weighted by how many loops it spans. Used when there is no beat grid.
function pairedLength(notes, Lc, sr, end) {
  const tol = 0.06 * sr
  const gaps = []
  for (const o of notes) {
    for (let k = 1; k <= 8; k++) {
      const want = o.i + k * Lc
      if (want > end + tol) break
      const q = nearestNote(notes, want, tol)
      if (q && q !== o) gaps.push({ v: (q.i - o.i) / k, w: k })
    }
  }
  if (gaps.length < 3) return null
  gaps.sort((a, b) => a.v - b.v)
  const half = gaps.reduce((n, g) => n + g.w, 0) / 2
  let acc = 0
  for (const g of gaps) {
    acc += g.w
    if (acc >= half) return Math.round(g.v)
  }
  return Math.round(gaps[gaps.length - 1].v)
}

// A beat grid for the repeat: a tempo that puts a whole number of bars in the
// loop, and a phase — whichever note, taken as a beat, puts the most playing
// on the grid. Then the period fitted finely over every note, which is what
// makes the length exact: one note is off by human timing, forty are not.
//
// Some playing fits two phases equally: hats on every eighth with kick and
// snare between read the same shifted half a beat. Those ties go to the phase
// that puts `hint` — where the groove came in — on a beat.
// Returns { P (samples), bpm, bars, phase (a sample on a beat) } or null.
function beatGrid(notes, len, sr, bpb, hint) {
  if (notes.length < 4) return null
  const ws = notes.map((o) => Math.min(30, o.w))
  const options = (lo, hi) =>
    [1, 2, 3, 4, 6, 8, 12, 16].filter((bars) => {
      const bpm = (60 * sr * bars * bpb) / len
      return bpm >= lo && bpm <= hi
    })
  // 60–180 bpm first, like the first-loop finder: an even run of eighths
  // otherwise reads as double time.
  const bars = options(60, 180).length ? options(60, 180) : options(45, 220)
  const cands = []
  for (const nb of bars) {
    const P = len / sr / (nb * bpb)
    const prior = Math.exp(-0.5 * (Math.log2(P / 0.5) / 1.1) ** 2)
    const plain = [1, 2, 4, 8, 16].includes(nb) ? 1 : 0.85
    for (const ref of notes) {
      const fit = gridScore(notes.map((o) => (o.i - ref.i) / sr), ws, P)
      cands.push({ bars: nb, P, fit, rank: fit * prior * plain, phase: ref.i })
    }
  }
  if (!cands.length) return null
  // The tempo is the best-ranked bar count; the phase, of that tempo's
  // near-best phases, the one nearest the hint.
  const lead = cands.reduce((a, c) => (c.rank > a.rank ? c : a))
  const off = (c) => {
    const beats = (hint - c.phase) / (c.P * sr)
    return Math.abs(beats - Math.round(beats))
  }
  let best = null
  for (const c of cands) {
    if (c.bars !== lead.bars || c.rank < 0.985 * lead.rank) continue
    if (!best || off(c) < off(best) - 1e-9) best = c
  }
  if (!best || best.fit < 0.5) return null
  const fine = fitPeriod(
    notes.map((o) => (o.i - best.phase) / sr),
    ws,
    best.P,
    0.01,
  )
  const P = fine.score >= best.fit - 0.05 ? fine.P : best.P
  return { P: P * sr, bpm: 60 / P, bars: best.bars, phase: best.phase }
}

// ── Notes that repeat (first choice) ─────────────────────────────────────────
// The frame comparison wants every 42 ms of the second pass to sound like the
// first, and real playing doesn't: a note dug in harder, one left ringing, a
// ghost note added. On synthetic takes with that variation it caught 4 in 24,
// which is what the user saw ("I only ever get the full recording"). What
// survives a second pass is the notes — when each one starts and which note
// it is. So lag L repeats from s when nearly every note in [s, s+L) has the
// same note about L later, and every note of the pass after has one L earlier.
// A ghost or dropped note is one miss, not a failed match.

const NOTE_TOL_SEC = 0.06
const NOTE_THRESHOLD = 0.7
// How specific the lag has to be: a real repeat holds at its own length and
// falls apart a sixteenth either side. In-tempo noodling with two sounds (a
// cajon's bass and slap) lines up with anything at ~85% by chance — but just
// as well at the shifted lags, which is what gives it away. The baseline is
// the second best of these shifts, so one that lands on the groove's own
// subdivision doesn't count against it.
const SHIFTS_SEC = [-0.4, -0.36, -0.32, -0.28, -0.24, -0.2, -0.16, -0.12, -0.08, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4]
const MIN_CONTRAST = 0.2

// Each note: its foot, its weight (peak level against the take's loud hits,
// so ghost taps count for little), its pitch (median over the frames just
// after the attack, where a bass note has settled; NaN for a drum or a dead
// note) and its spectral shape for matching the unpitched ones.
function noteList(x, sr, F, from, to) {
  if (!F.n) return []
  const frameOf = (i) => Math.round((i - F.time(0)) / F.hop)
  const notes = feet(x, sr, from, to).map((o) => {
    const f = frameOf(o.i)
    const ps = []
    for (let g = f + 1; g <= f + 3; g++) if (g >= 0 && g < F.n && F.pitch[g] === F.pitch[g]) ps.push(F.pitch[g])
    ps.sort((p, q) => p - q)
    const fb = Math.min(F.n - 1, Math.max(0, f + 1))
    let peak = 0
    for (let i = o.i; i < Math.min(to, o.i + 0.03 * sr); i++) peak = Math.max(peak, Math.abs(x[i]))
    return { i: o.i, w: o.w, peak, pitch: ps.length ? ps[ps.length >> 1] : NaN, shape: F.bands.subarray(fb * NB, fb * NB + NB) }
  })
  const loud = notes.map((o) => o.peak).sort((p, q) => p - q)[Math.floor(notes.length * 0.9)] || 1
  for (const o of notes) o.wt = Math.min(1, Math.max(0.1, o.peak / (0.5 * loud)))
  return notes
}

// Same pitch class (pitch trackers slip octaves on low strings, and timing has
// to match too, so octaves don't let noodling through), or, when either has
// no pitch, the same spectral shape.
function sameNote(a, b) {
  if (a.pitch === a.pitch && b.pitch === b.pitch) {
    const d = Math.abs(a.pitch - b.pitch) % 12
    return Math.min(d, 12 - d) < 0.6
  }
  let s = 0
  for (let k = 0; k < NB; k++) s += Math.abs(a.shape[k] - b.shape[k])
  return s / NB < 6
}

function lowerBound(notes, at) {
  let a = 0
  let b = notes.length
  while (a < b) {
    const m = (a + b) >> 1
    if (notes[m].i < at) a = m + 1
    else b = m
  }
  return a
}

// The same note as `o` within `tol` of `at`, nearest first.
function partner(notes, o, at, tol) {
  let best = null
  for (let k = lowerBound(notes, at - tol); k < notes.length && notes[k].i <= at + tol; k++) {
    const q = notes[k]
    if (q !== o && sameNote(o, q) && (!best || Math.abs(q.i - at) < Math.abs(best.i - at))) best = q
  }
  return best
}

// No onset where a note should be isn't yet a miss: a soft note, or one
// re-struck under its own ring, doesn't always register as an onset. If the
// same pitch is sounding there, it counts for most of a hit. Pitched notes
// only — drum hits always register, and a drum's decay looks like anything.
const SOUNDING_CREDIT = 0.8

function sounding(F, o, at) {
  if (o.pitch !== o.pitch) return false
  const f = Math.round((at - F.time(0)) / F.hop)
  for (let g = f; g <= f + 2; g++) {
    if (g < 0 || g >= F.n) continue
    const p = F.pitch[g]
    if (p !== p) continue
    const d = Math.abs(p - o.pitch) % 12
    if (Math.min(d, 12 - d) < 0.6) return true
  }
  return false
}

// How much of the playing in [s, s+L) and the pass after it repeats at L,
// each note weighted by how hard it was hit: ghost taps on a cajon change
// every pass, the bass and slaps don't. Notes of the first pass whose partner
// would fall after `end` (a stop pressed a little early) don't count.
function repeatScore(notes, F, s, L, end, tol) {
  const edge = tol / 2
  let n = 0
  let nA = 0
  let tot = 0
  let hit = 0
  for (let k = lowerBound(notes, s - edge); k < notes.length; k++) {
    const o = notes[k]
    if (o.i >= s + 2 * L - edge || o.i > end) break
    const inA = o.i < s + L - edge
    const at = inA ? o.i + L : o.i - L
    if (inA && at > end - tol) continue
    n++
    if (inA) nA++
    tot += o.wt
    hit += o.wt * credit(notes, F, o, at, tol)
  }
  // `rank` shrinks R towards nothing when there is little playing behind it:
  // six notes that happen to line up are not a groove.
  return { R: tot ? hit / tot : 0, rank: hit / (tot + 2), tot, n, nA }
}

// F null: onsets only (the baselines, where a long note ringing across the
// shift would otherwise count).
function credit(notes, F, o, at, tol) {
  if (partner(notes, o, at, tol)) return 1
  return F && sounding(F, o, at) ? SOUNDING_CREDIT : 0
}

// The same, over one fixed stretch of playing [a, b): each note checked
// against the note L later if that is inside, else L earlier. Used to ask
// whether a shorter lag explains the very same playing as well.
function spanScore(notes, F, a, b, L, tol) {
  const edge = tol / 2
  let tot = 0
  let hit = 0
  for (let k = lowerBound(notes, a - edge); k < notes.length && notes[k].i < b - edge; k++) {
    const o = notes[k]
    const at = o.i + L < b - edge ? o.i + L : o.i - L
    if (at < a - edge) continue
    tot += o.wt
    hit += o.wt * credit(notes, F, o, at, tol)
  }
  return tot ? hit / tot : 0
}

// The loop length measured straight off the playing: the median gap between
// each solid note and its note one loop later, then the mean of the gaps
// within 25 ms of that (a wide window lets a neighbouring sixteenth of the
// same sound pair up, and one such pair moves a mean a lot).
function matchedLength(notes, L, a, b, tol, sr) {
  const gapsAt = (len, w) => {
    const out = []
    for (const o of notes) {
      if (o.i < a - w || o.i + len > b + w || o.wt < 0.5) continue
      const q = partner(notes, o, o.i + len, w)
      if (q) out.push(q.i - o.i)
    }
    return out
  }
  const wide = gapsAt(L, tol).sort((p, q) => p - q)
  if (wide.length < 3) return null
  const med = wide[wide.length >> 1]
  const near = gapsAt(med, 0.025 * sr)
  if (near.length < 3) return Math.round(med)
  return Math.round(near.reduce((p, q) => p + q, 0) / near.length)
}

// Candidate lags: how often the same note comes back after each gap, in 10 ms
// bins; the busiest bins are the ones worth scoring.
function lagCandidates(notes, minL, maxL, sr) {
  const bin = 0.01 * sr
  const counts = new Map()
  for (let a = 0; a < notes.length; a++) {
    for (let b = a + 1; b < notes.length; b++) {
      const d = notes[b].i - notes[a].i
      if (d < minL) continue
      if (d > maxL) break
      if (!sameNote(notes[a], notes[b])) continue
      const k = Math.round(d / bin)
      counts.set(k, (counts.get(k) || 0) + 1)
    }
  }
  const smooth = (k) => (counts.get(k - 1) || 0) + 2 * (counts.get(k) || 0) + (counts.get(k + 1) || 0)
  const peaks = [...counts.keys()].filter((k) => smooth(k) >= smooth(k - 1) && smooth(k) >= smooth(k + 1))
  peaks.sort((p, q) => smooth(q) - smooth(p))
  return peaks.slice(0, 80).map((k) => k * bin)
}

function findNoteRepeat(x, sr, F, { from, to, stop, maxLagSec }) {
  const end = stop ?? to
  const tol = NOTE_TOL_SEC * sr
  const slack = SLACK_SEC * sr
  const notes = noteList(x, sr, F, from, to).filter((o) => o.i <= end + tol)
  if (notes.length < 6) return null
  const minL = 1.0 * sr
  const maxL = Math.min(maxLagSec * sr, (end - from) / (1 + MIN_COVER))
  if (maxL < minL) return null

  const rows = []
  for (const L of lagCandidates(notes, minL, maxL, sr)) {
    let best = null
    for (const o of notes) {
      const s = o.i
      if (s + 2 * L < end - Math.max(slack, L)) continue
      if (s + (1 + MIN_COVER) * L > end + tol) break
      const r = repeatScore(notes, F, s, L, end, tol)
      if (r.nA < 3 || r.n < 6 || r.R < NOTE_THRESHOLD) continue
      // A slight lean towards the end of the take: the groove is found last.
      const lean = 0.02 * ((s + 2 * L - from) / (end - from))
      if (!best || r.rank + lean > best.pre) best = { L, s, R: r.R, tot: r.tot, nA: r.nA, pre: r.rank + lean, lean }
    }
    if (!best) continue
    const shifted = SHIFTS_SEC.map((d) => repeatScore(notes, null, best.s, L + d * sr, end, tol).R).sort((p, q) => q - p)
    const contrast = best.R - shifted[1]
    if (contrast < MIN_CONTRAST) continue
    // Ranked on contrast, shrunk when there is little playing behind it, and
    // docked for every second it finished before the stop.
    const gap = Math.max(0, end - (best.s + 2 * L)) / sr
    rows.push({ ...best, contrast, score: contrast * (best.tot / (best.tot + 2)) + best.lean - 0.05 * gap })
  }
  if (!rows.length) return null
  let pick = rows.reduce((p, q) => (q.score > p.score ? q : p))
  const strong = rows.filter((r) => r.score >= 0.6 * pick.score)
  const span = (r) => [r.s, Math.min(end, r.s + 2 * r.L)]
  const divides = (a, b) => {
    const m = Math.round(b / a)
    return m >= 1 && Math.abs(b - m * a) < tol
  }

  // Found last: a clearly strong repeat played twice inside the chosen one's
  // second pass, at a length that doesn't divide it, and explaining that
  // whole pass, is the newer part. Practising half the groove while noodling
  // otherwise makes "noodling, then the groove" read as one long repeat.
  const latest = pick.s + pick.L
  for (const r of rows.slice().sort((p, q) => q.s - p.s)) {
    if (r.L >= pick.L || divides(r.L, pick.L) || r.s < latest - tol) continue
    if (r.R >= 0.85 && r.contrast >= 0.8 * pick.contrast && r.nA >= 4 && spanScore(notes, F, latest, end, r.L, tol) >= 0.8) {
      pick = r
      break
    }
  }
  // A two-bar groove whose bars nearly match also repeats at one bar. A
  // multiple of the lag that explains its own two passes clearly better
  // keeps the bars that differ.
  for (const r of strong) {
    if (r.L <= pick.L + tol || !divides(pick.L, r.L)) continue
    const [a, b] = span(r)
    if (spanScore(notes, F, a, b, r.L, tol) - spanScore(notes, F, a, b, pick.L, tol) >= 0.03) pick = r
  }
  // A one-bar groove played four times also repeats at two bars, so a shorter
  // lag that explains the same playing just as well is the groove. Only just
  // as well, though: drums half-repeat at half a bar (bass on one, slaps on
  // two and four), and a loop twice too long still sounds right where one
  // half too short doesn't.
  const [a, b] = span(pick)
  const own = spanScore(notes, F, a, b, pick.L, tol)
  const chosen = pick
  for (const r of rows) {
    if (r.L < pick.L - tol && spanScore(notes, F, a, b, r.L, tol) >= own - 0.015) pick = { ...r, s: chosen.s }
  }
  // The length measured on the match itself, then everything after works to
  // it with a tight window: at ±60 ms, in-tempo noodling with two sounds
  // keeps finding partners by chance, walks the start back into it and
  // drags the length with it.
  const L = matchedLength(notes, pick.L, pick.s, Math.min(end, pick.s + 2 * pick.L), tol, sr) ?? pick.L
  const near = 0.03 * sr

  // Where the groove came in: walk back from the window while each note has
  // its note one loop later. Quiet hits (ghost taps, dead notes) are stepped
  // over; the first solid note without a partner is noodling.
  const k0 = lowerBound(notes, pick.s - tol / 2)
  let cameIn = notes[k0].i
  for (let k = k0; k >= 0; k--) {
    const o = notes[k]
    if (partner(notes, o, o.i + L, near)) cameIn = o.i
    else if (o.wt >= 0.5) break
  }
  // Where it stopped repeating: the last note with its note one loop back,
  // plus the gap its partner had to the next hit after it — a separate hit,
  // not the same one detected twice, or a groove ending on a rest loses
  // that rest.
  let runEnd = null
  for (let k = notes.length - 1; k >= 0 && runEnd == null; k--) {
    const o = notes[k]
    if (o.i < cameIn + L) break
    // The usual window here: this is inside the groove, and the last hit
    // being 35 ms off its partner shouldn't lose the end of the loop.
    const q = partner(notes, o, o.i - L, tol)
    if (!q) continue
    const after = notes[lowerBound(notes, q.i + 0.05 * sr)]
    runEnd = o.i + Math.min(after ? after.i - q.i : 0.2 * sr, L)
  }
  if (runEnd == null) return null
  runEnd = Math.min(to, runEnd)
  return { notes, L: matchedLength(notes, L, cameIn, runEnd, near, sr) ?? Math.round(L), cameIn, runEnd }
}

// ── Free: the first loop, no click ───────────────────────────────────────────
// x: dry take; from/to: the stretch to search; stop: where the stop was
// pressed (sample index). Returns { start, len, phase, bpm, bars, passes } in
// samples — phase: how far past the downbeat `start` is — or null when
// nothing was played twice.
export function findGroove(x, sr, { from = 0, to = x.length, stop = null, bpb = 4, maxLagSec = 30 } = {}) {
  const F = features(x, sr, from, to)
  const byNotes = findNoteRepeat(x, sr, F, { from, to, stop, maxLagSec })
  if (byNotes) {
    const { notes, L, cameIn, runEnd } = byNotes
    const res = keepPass(notes, sr, { len: L, exact: true, cameIn, runStart: cameIn, runEnd, stop, bpb, to })
    if (res) return res
  }
  return findFrameGroove(x, sr, F, { from, to, stop, bpb, maxLagSec })
}

function findFrameGroove(x, sr, F, { from, to, stop, bpb, maxLagSec }) {
  const secPerFrame = F.hop / sr
  const minL = Math.ceil(1.0 / secPerFrame)
  const maxL = Math.min(Math.floor(maxLagSec / secPerFrame), Math.floor(F.n / (1 + MIN_COVER)))
  if (maxL < minL) return null
  const lags = []
  for (let L = minL; L <= maxL; L++) lags.push(L)
  const pick = chooseLag(F, lags, Math.round(SLACK_SEC / secPerFrame))
  if (!pick) return null

  const run = repeatRun(F, pick.L, pick.s, pick.R)
  const Lc = pick.L * F.hop
  const runStart = F.time(run.t1) - F.hop / 2
  const runEnd = Math.min(to, F.time(run.end) + F.hop / 2)
  // Notes from a second before the run: the run's start can be that late.
  const notes = feet(x, sr, Math.max(from, runStart - 1.2 * sr), Math.min(to, runEnd + 0.1 * sr))
  const within = (a) => notes.filter((o) => o.i >= a - 0.02 * sr && o.i <= runEnd)

  const len = pairedLength(within(runStart), Lc, sr, runEnd) ?? Lc
  const cameIn = repeatStart(F, notes, len, sr, runStart, runEnd)
  return keepPass(notes, sr, { len, cameIn, runStart, runEnd, stop, bpb, to })
}

// Given the loop length and where the repeat ran: the beat grid, where "one"
// is, and the last whole pass. An `exact` length (measured from matched
// notes) is kept unless the grid's fit agrees with it closely; otherwise the
// grid's fitted period sets it.
function keepPass(notes, sr, { len, exact = false, cameIn, runStart, runEnd, stop, bpb, to }) {
  const inRun = notes.filter((o) => o.i >= Math.min(runStart, cameIn) - 0.02 * sr && o.i <= runEnd)
  const grid = beatGrid(inRun, len, sr, bpb, cameIn)
  let first
  if (grid) {
    // A measured length stands unless the grid, fitted over every note of
    // the repeat rather than a handful of matched pairs, agrees with it to
    // half a percent — then the grid is the finer of the two.
    const fitted = Math.round(grid.bars * bpb * grid.P)
    if (!exact || Math.abs(fitted - len) < 0.005 * len) len = fitted
    const beat = len / (grid.bars * bpb)
    // The downbeat: where the groove came in. Found from notes that is known
    // to the note and is the phase; from frames it is only near, and the
    // beat of the fitted grid nearest it is.
    const phase = exact ? cameIn : grid.phase
    const onGrid = (t) => phase + Math.round((t - phase) / beat) * beat
    first = onGrid(cameIn)
    // Unless the stop was pressed on a beat exactly one beat off it. That
    // happens when the noodling ended with the groove's own last beat, which
    // makes the repeat seem to begin a beat early. Any cyclic shift inside the
    // repeat is the same loop, so this only decides which beat is "one".
    if (stop != null && Math.abs(stop - onGrid(stop)) <= 0.3 * beat) {
      const beats = grid.bars * bpb
      let k = Math.round(((((onGrid(stop) - first) % len) + len) % len) / beat)
      if (k > beats / 2) k -= beats
      // Later is always inside the repeat; earlier only if the repeat reaches
      // (to the note, when the run was found from notes).
      const reach = exact ? cameIn - 0.05 * sr : Math.min(runStart, cameIn) - 0.5 * beat
      if (k === 1 || (k === -1 && first - beat >= reach)) first += k * beat
    }
    first = nearestNote(notes, first, 0.04 * sr)?.i ?? Math.round(first)
  } else {
    first = cameIn
  }

  // The last whole pass. From frames it may come up a little short of the
  // run's end — they straddle whatever followed it; from notes the end is
  // known, and a pass running past it would trade its downbeat for whatever
  // came after. Never past what was captured.
  const grace = exact ? 0.03 * sr : Math.min(0.3 * sr, 0.12 * len)
  const limit = Math.min(runEnd + grace, to + 0.03 * sr)
  const passes = Math.floor((limit - first) / len)
  if (passes < 1) return null
  let start = first + (passes - 1) * len
  if (exact && grid) {
    // Any error in where the repeat began is at its start (a noodled hit
    // that happened to match), so the latest stretch that fits, stepped by
    // whole beats from the downbeat, is the safest audio to keep. `phase`
    // says how far into the loop it begins, so "one" stays at the start.
    const beat = len / (grid.bars * bpb)
    start = first + Math.floor((limit - len - first) / beat) * beat
  }
  const landed = nearestNote(notes, start, 0.03 * sr)
  if (landed) start = landed.i
  const phase = Math.round((((start - first) % len) + len) % len)

  return {
    start,
    len,
    phase,
    passes: Math.max(passes, 2),
    bpm: grid ? (60 * sr * grid.bars * bpb) / len : null,
    bars: grid ? grid.bars : null,
  }
}

// ── On a grid: the first loop against the click, or a layer over the loop ────
// Boundaries at anchor + j·unit (samples); units: the loop lengths allowed,
// in units. The grid already knows the length and where "one" is, so only
// the lag and the pass are searched. Returns { start, units, passes } in
// samples, or null.
export function findGridGroove(x, sr, { from = 0, to = x.length, anchor, unit, units }) {
  const F = features(x, sr, from, to)
  if (!F.n) return null
  const toFrame = (sample) => Math.round((sample - F.time(0)) / F.hop)
  const j0 = Math.ceil((from - anchor) / unit)
  const j1 = Math.floor((to - anchor) / unit)
  const bounds = []
  for (let j = j0; j <= j1; j++) {
    const f = toFrame(anchor + j * unit)
    if (f >= 0 && f < F.n) bounds.push({ j, f })
  }
  const slack = Math.round((SLACK_SEC * sr) / F.hop)
  const rows = []
  for (const k of units) {
    const L = Math.round((k * unit) / F.hop)
    if (L < 2 || 2 * k > bounds.length + 1) continue
    const curve = lagCurve(F, L)
    for (const b of bounds) {
      const e = Math.min(b.f + L, curve.m)
      if (e - b.f < MIN_COVER * L || b.f + 2 * L < F.n - Math.max(slack, L) || !mostlyPlayed(F, b.f, e)) continue
      rows.push({ k, j: b.j, R: (curve.P[e] - curve.P[b.f]) / (e - b.f) })
    }
  }
  if (!rows.length) return null
  const top = Math.max(...rows.map((r) => r.R))
  if (top < THRESHOLD) return null
  // The shortest allowed length that repeats nearly as well as the best.
  const k = Math.min(...rows.filter((r) => r.R >= top - 0.035).map((r) => r.k))
  const ok = rows.filter((r) => r.k === k && r.R >= Math.max(THRESHOLD, top - 0.12)).map((r) => r.j)
  // The run of boundaries that repeat, nearest the end; the last whole pass.
  const last = Math.max(...ok)
  let first = last
  while (ok.includes(first - 1)) first--
  const passes = Math.floor((last + 2 * k - first) / k)
  let startJ = first + (passes - 1) * k
  if (anchor + (startJ + k) * unit > to + 0.05 * sr) startJ -= k
  return { start: anchor + startJ * unit, units: k, passes }
}
