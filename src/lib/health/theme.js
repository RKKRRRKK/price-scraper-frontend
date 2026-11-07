// Health dashboard look: one palette feeds both the CSS (as --hx-* custom
// properties on the view root) and every ECharts option, so a panel can never
// drift from the rest. Light, like the rest of the app; accents are the
// saturated -500/-600 shades so lines and text hold up on white.
import dayjs from 'dayjs'

export const FONT = "Inter, -apple-system, 'Segoe UI', Roboto, sans-serif"

export const P = {
  bg: '#f3f5f8',
  panel: '#ffffff',
  panel2: '#f4f6f9',          // insets, tracks, hover
  border: 'rgba(15, 23, 42, 0.08)',
  border2: 'rgba(15, 23, 42, 0.15)',
  text: '#0f172a',
  text2: '#475569',
  text3: '#8590a2',
  grid: 'rgba(15, 23, 42, 0.06)',
  axis: 'rgba(15, 23, 42, 0.14)',

  hr: '#e11d48',
  resting: '#be123c',
  steps: '#10b981',
  kcal: '#f97316',
  distance: '#65a30d',
  spo2: '#0ea5e9',
  hrv: '#8b5cf6',
  resp: '#14b8a6',
  weight: '#64748b',
  vo2: '#db2777',
  energy: '#ca8a04',
  pai: '#4f46e5',
  skin: '#c2410c',
  sync: '#16a34a',
  warn: '#d97706',
  bad: '#dc2626',
}

// Sleep rows, top (awake) to bottom (deep) — same order as metrics.js SLEEP_ROWS.
export const SLEEP = {
  awake: '#f59e0b',
  rem: '#06b6d4',
  light: '#818cf8',
  deep: '#4338ca',
}

// Xiaomi's stress levels (0–100): relaxed 1–25, mild 26–50, moderate 51–80, high 81–100.
// `lo` inclusive, `hi` exclusive.
export const STRESS = [
  { key: 'relaxed', label: 'Relaxed', lo: 0, hi: 26, color: '#3b9ede' },
  { key: 'mild', label: 'Mild', lo: 26, hi: 51, color: '#4fae3a' },
  { key: 'moderate', label: 'Moderate', lo: 51, hi: 81, color: '#f59e0b' },
  { key: 'high', label: 'High', lo: 81, hi: 101, color: '#c0392b' },
]

export const stressBand = (v) => STRESS.find((b) => v >= b.lo && v < b.hi) || STRESS[3]

// Scale readings.
export const BODY = {
  weight: '#64748b',
  fat: '#f97316',
  muscle: '#10b981',
  water: '#0ea5e9',
  bone: '#a16207',
  visceral: '#e11d48',
  bmr: '#8b5cf6',
  bmi: '#0d9488',
}

// Heart-rate zones as fractions of max HR (the five zones Xiaomi uses,
// plus everything below 50 % as "Relaxed").
export const ZONES = [
  { key: 'rest', label: 'Relaxed', from: 0, to: 0.5, color: '#64748b' },
  { key: 'warmup', label: 'Warm-up', from: 0.5, to: 0.6, color: '#0ea5e9' },
  { key: 'fatburn', label: 'Fat burn', from: 0.6, to: 0.7, color: '#10b981' },
  { key: 'aerobic', label: 'Aerobic', from: 0.7, to: 0.8, color: '#eab308' },
  { key: 'anaerobic', label: 'Anaerobic', from: 0.8, to: 0.9, color: '#f97316' },
  { key: 'max', label: 'Max', from: 0.9, to: Infinity, color: '#e11d48' },
]

// Zones in bpm for a given max HR: [{ ...zone, lo, hi }] (hi exclusive, last = Infinity).
export function zoneBounds(maxHr) {
  return ZONES.map((z) => ({
    ...z,
    lo: Math.round(z.from * maxHr),
    hi: z.to === Infinity ? Infinity : Math.round(z.to * maxHr),
  }))
}

export function zoneOf(bpm, bounds) {
  return bounds.find((z) => bpm >= z.lo && bpm < z.hi) || bounds[0]
}

export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

// The palette as CSS custom properties on the view root: --hx-panel2,
// --hx-text3, --hx-hr, --hx-sleep-deep, ...
export const cssVars = {
  ...Object.fromEntries(Object.entries(P).map(([k, v]) => [`--hx-${k}`, v])),
  ...Object.fromEntries(Object.entries(SLEEP).map(([k, v]) => [`--hx-sleep-${k}`, v])),
}

// ── ECharts building blocks ───────────────────────────────────────────────

export const axisLabel = { color: P.text3, fontSize: 11, fontFamily: FONT }
export const axisLine = { show: true, lineStyle: { color: P.axis } }
export const splitLine = { show: true, lineStyle: { color: P.grid } }

export function tooltip(extra = {}) {
  return {
    trigger: 'axis',
    confine: true,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderColor: P.border2,
    borderWidth: 1,
    padding: [8, 11],
    textStyle: { color: P.text, fontSize: 12, fontFamily: FONT },
    extraCssText: 'box-shadow: 0 8px 24px rgba(15,23,42,0.12); border-radius: 8px;',
    axisPointer: { type: 'line', lineStyle: { color: P.text3, type: 'dashed', width: 1 } },
    ...extra,
  }
}

export function timeAxis(format = 'HH:mm', extra = {}) {
  return {
    type: 'time',
    axisLabel: { ...axisLabel, hideOverlap: true, formatter: (v) => dayjs(v).format(format) },
    axisLine,
    axisTick: { show: false },
    splitLine: { show: false },
    ...extra,
  }
}

export function valueAxis(extra = {}) {
  return {
    type: 'value',
    axisLabel,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine,
    ...extra,
  }
}

// Bare chart frame: transparent background, theme font, no animation lag on refresh.
export function base(extra = {}) {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: FONT },
    animationDuration: 400,
    animationDurationUpdate: 250,
    ...extra,
  }
}

// One tooltip row: coloured dot, label, right-aligned value.
export function tipRow(color, label, value) {
  return `<div style="display:flex;align-items:center;gap:8px;min-width:150px">`
    + `<span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>`
    + `<span style="color:${P.text2}">${label}</span>`
    + `<span style="margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums">${value}</span></div>`
}

export function tipTitle(text) {
  return `<div style="color:${P.text3};font-size:11px;margin-bottom:4px">${text}</div>`
}

// ── Number / time formatting ─────────────────────────────────────────────

export const fmt = {
  int: (v) => (v == null ? '–' : Math.round(v).toLocaleString()),
  dec: (v, d = 1) => (v == null ? '–' : Number(v).toFixed(d)),
  bpm: (v) => (v == null ? '–' : `${Math.round(v)} bpm`),
  time: (ms) => dayjs(ms).format('HH:mm'),
  dayTime: (ms) => dayjs(ms).format('ddd D MMM, HH:mm'),
  day: (d) => dayjs(d).format('ddd D MMM'),
  km: (m) => (m == null ? '–' : `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km`),
  // "7h 05m" / "42m"
  duration(min) {
    if (min == null) return '–'
    const h = Math.floor(min / 60)
    const m = Math.round(min % 60)
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
  },
  // "just now" / "12 min ago" / "3 h ago" / "2 days ago"
  ago(ms) {
    const min = Math.round((Date.now() - ms) / 60000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min} min ago`
    if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
    return `${Math.round(min / 1440)} days ago`
  },
}
