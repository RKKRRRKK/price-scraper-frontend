import { P, SLEEP, BODY } from '@/lib/health/theme'

// Display config for what native/health-bridge stores (health_samples.metric).
// `agg: 'sum'` metrics are interval totals (steps, calories) shown per day / hour;
// `agg: 'avg'` metrics are point readings shown as bucketed averages.
export const METRICS = {
  heart_rate: { label: 'Heart rate', unit: 'bpm', agg: 'avg', color: P.hr, decimals: 0 },
  steps: { label: 'Steps', unit: 'steps', agg: 'sum', color: P.steps, decimals: 0 },
  resting_heart_rate: { label: 'Resting heart rate', unit: 'bpm', agg: 'avg', color: P.resting, decimals: 0 },
  spo2: { label: 'Blood oxygen', unit: '%', agg: 'avg', color: P.spo2, decimals: 0 },
  hrv_rmssd: { label: 'HRV (RMSSD)', unit: 'ms', agg: 'avg', color: P.hrv, decimals: 0 },
  respiratory_rate: { label: 'Respiratory rate', unit: '/min', agg: 'avg', color: P.resp, decimals: 1 },
  active_kcal: { label: 'Active calories', unit: 'kcal', agg: 'sum', color: P.kcal, decimals: 0 },
  total_kcal: { label: 'Total calories', unit: 'kcal', agg: 'sum', color: P.kcal, decimals: 0 },
  distance_m: { label: 'Distance', unit: 'km', agg: 'sum', scale: 0.001, color: P.distance, decimals: 2 },
  floors: { label: 'Floors', unit: 'floors', agg: 'sum', color: P.weight, decimals: 0 },
  weight_kg: { label: 'Weight', unit: 'kg', agg: 'avg', color: P.weight, decimals: 1 },
  vo2max: { label: 'VO₂ max', unit: 'ml/kg/min', agg: 'avg', color: P.vo2, decimals: 1 },
  stress: { label: 'Stress', unit: '', agg: 'avg', color: P.hrv, decimals: 0 },
  body_energy: { label: 'Body energy', unit: '', agg: 'avg', color: P.energy, decimals: 0 },
  pai: { label: 'PAI', unit: '', agg: 'avg', color: P.pai, decimals: 0 },
  skin_temp_c: { label: 'Skin temperature', unit: '°C', agg: 'avg', color: P.skin, decimals: 1 },
  body_fat_pct: { label: 'Body fat', unit: '%', agg: 'avg', color: BODY.fat, decimals: 1 },
  muscle_kg: { label: 'Muscle', unit: 'kg', agg: 'avg', color: BODY.muscle, decimals: 1 },
  water_pct: { label: 'Water', unit: '%', agg: 'avg', color: BODY.water, decimals: 1 },
  bone_kg: { label: 'Bone mass', unit: 'kg', agg: 'avg', color: BODY.bone, decimals: 1 },
  visceral_fat: { label: 'Visceral fat', unit: '', agg: 'avg', color: BODY.visceral, decimals: 0 },
  bmr_kcal: { label: 'BMR', unit: 'kcal', agg: 'avg', color: BODY.bmr, decimals: 0 },
  bmi: { label: 'BMI', unit: '', agg: 'avg', color: BODY.bmi, decimals: 1 },
}

// Hypnogram rows, top to bottom. Health Connect's catch-all stages fold into
// the nearest row.
export const SLEEP_ROWS = [
  { key: 'awake', label: 'Awake', color: SLEEP.awake },
  { key: 'rem', label: 'REM', color: SLEEP.rem },
  { key: 'light', label: 'Light', color: SLEEP.light },
  { key: 'deep', label: 'Deep', color: SLEEP.deep },
]

const STAGE_ROW = {
  awake: 'awake',
  awake_in_bed: 'awake',
  out_of_bed: 'awake',
  rem: 'rem',
  light: 'light',
  sleeping: 'light',
  unknown: 'light',
  deep: 'deep',
}

export const stageRow = (stage) => STAGE_ROW[stage] || 'light'

// Health Connect ExerciseSessionRecord.EXERCISE_TYPE_* — every type the watch
// parser (native/health-bridge XiaomiSports.kt) can emit.
export const EXERCISE_TYPES = {
  0: 'Workout',
  2: 'Badminton',
  4: 'Baseball',
  5: 'Basketball',
  8: 'Cycling',
  9: 'Indoor cycling',
  11: 'Boxing',
  13: 'Calisthenics',
  14: 'Cricket',
  16: 'Dancing',
  25: 'Elliptical',
  26: 'Exercise class',
  27: 'Fencing',
  28: 'American football',
  31: 'Frisbee',
  32: 'Golf',
  34: 'Gymnastics',
  35: 'Handball',
  36: 'HIIT',
  37: 'Hiking',
  38: 'Ice hockey',
  39: 'Ice skating',
  44: 'Martial arts',
  46: 'Paddling',
  47: 'Paragliding',
  48: 'Pilates',
  51: 'Rock climbing',
  53: 'Rowing',
  54: 'Rowing machine',
  56: 'Running',
  57: 'Treadmill',
  58: 'Sailing',
  59: 'Scuba diving',
  60: 'Skating',
  61: 'Skiing',
  62: 'Snowboarding',
  64: 'Football',
  65: 'Softball',
  66: 'Squash',
  68: 'Stair climbing',
  69: 'Stair machine',
  70: 'Strength training',
  71: 'Stretching',
  72: 'Surfing',
  73: 'Open-water swim',
  74: 'Pool swim',
  75: 'Table tennis',
  76: 'Tennis',
  78: 'Volleyball',
  79: 'Walking',
  80: 'Water polo',
  81: 'Weightlifting',
  83: 'Yoga',
}

// The same metric can come from several writers: Health Bridge v2 ('healthbridge')
// or Mi Fitness through Health Connect (which can also double steps with the
// phone's own counter). Health Bridge takes over at its first reading and the old
// app's history stays before that, so one source answers each moment, never both.
// `legacySource` picks the old writer: Xiaomi's app, else whichever wrote the most rows.
const XIAOMI = /xiaomi|mi\.health|mifit/i
export const DIRECT_SOURCE = 'healthbridge'

export function legacySource(rows) {
  const old = rows.filter((r) => r.source !== DIRECT_SOURCE)
  if (!old.length) return null
  const xiaomi = old.find((r) => XIAOMI.test(r.source || ''))
  if (xiaomi) return xiaomi.source
  return old.reduce((a, b) => (b.n > a.n ? b : a)).source
}

// The one source to use when no cutover applies: Health Bridge if it has rows, else the old writer.
export function preferredSource(rows) {
  if (!rows.length) return null
  return rows.some((r) => r.source === DIRECT_SOURCE) ? DIRECT_SOURCE : legacySource(rows)
}

// Minutes per hypnogram row for one sleep session (no stages → all "light").
export function stageMinutes(session) {
  const out = { awake: 0, rem: 0, light: 0, deep: 0 }
  const stages = session.stages || []
  if (!stages.length) {
    out.light = (new Date(session.end_time) - new Date(session.start_time)) / 60000
    return out
  }
  for (const s of stages) {
    out[stageRow(s.stage)] += (new Date(s.end) - new Date(s.start)) / 60000
  }
  return out
}

export function formatMinutes(min) {
  if (min == null) return '–'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}
