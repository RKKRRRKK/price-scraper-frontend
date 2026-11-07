// Helpers shared by the sleep panel's views (hypnogram, history, clock).
import dayjs from 'dayjs'
import { SLEEP_ROWS, stageRow } from '@/lib/health/metrics'

export const MIN = 60e3
export const HOUR = 60 * MIN

// Hypnogram rows bottom → top (ECharts category index = depth order).
export const ROWS = [...SLEEP_ROWS].reverse()
export const ROW_INDEX = Object.fromEntries(ROWS.map((r, i) => [r.key, i]))
export const STAGE = Object.fromEntries(ROWS.map((r) => [r.key, r]))

// Legend order: what people look for first.
export const KEY_ORDER = ['deep', 'rem', 'light', 'awake']

// Stage blocks of one session folded onto the four rows, oldest first.
// Neighbours that land on the same row (awake_in_bed → awake) merge into one.
export function blocks(session) {
  const stages = session.stages?.length
    ? session.stages
    : [{ stage: 'sleeping', start: session.start_time, end: session.end_time }]
  const out = []
  const sorted = [...stages].sort((a, b) => new Date(a.start) - new Date(b.start))
  for (const s of sorted) {
    const row = stageRow(s.stage)
    const start = new Date(s.start).getTime()
    const end = new Date(s.end).getTime()
    if (!(end > start)) continue
    const last = out.at(-1)
    if (last && last.row === row && start - last.end <= MIN) last.end = Math.max(last.end, end)
    else out.push({ row, start, end })
  }
  return out
}

// Noon on the day before a wake date: the zero point for "hours since noon",
// which keeps bedtimes either side of midnight on one straight scale
// (23:30 → 11.5, 00:30 → 12.5, 07:15 → 19.25).
export function noonBefore(key) {
  return dayjs(key).subtract(1, 'day').hour(12).minute(0).second(0).millisecond(0).valueOf()
}

// Hours since noon → "HH:mm".
export function clock(h) {
  const m = (((Math.round(h * 60) + 12 * 60) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

export function spread(a) {
  if (a.length < 2) return null
  const m = mean(a)
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)))
}

// Nearest [ms, value] within maxGap of t (points sorted by time).
export function nearest(points, t, maxGap) {
  if (!points?.length) return null
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid][0] < t) lo = mid + 1
    else hi = mid
  }
  let best = lo
  if (lo > 0 && Math.abs(points[lo - 1][0] - t) < Math.abs(points[lo][0] - t)) best = lo - 1
  return Math.abs(points[best][0] - t) <= maxGap ? points[best] : null
}

// Asleep ÷ in bed, never rounded up to 100 % while there was time awake.
export function efficiency(n) {
  if (!n.inBed) return null
  const pct = Math.round((n.asleep / n.inBed) * 100)
  return n.asleep < n.inBed ? Math.min(pct, 99) : pct
}

// Share of a total as a label: "18", or "<1" for a sliver that rounds to 0.
export function share(part, total) {
  const pct = Math.round((part / (total || 1)) * 100)
  return part > 0 && pct < 1 ? '<1' : String(pct)
}

export const isWeekend = (key) => [0, 6].includes(dayjs(key).day())

// Pointer that can hover and scroll-zoom (mouse/trackpad) — touch screens get
// fixed windows instead so a swipe still scrolls the page.
export const finePointer = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches
