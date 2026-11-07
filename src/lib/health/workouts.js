import { P } from '@/lib/health/theme'
import { EXERCISE_TYPES } from '@/lib/health/metrics'

// Hand-drawn 24×24 stroke icons.
export const ICONS = {
  run: 'M16.9 4.6a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0M14.2 8.4l-3 4.6 3.4 2-1.4 5.8M11.2 13l-4.4 1.2M14.2 8.4l2.9 2.7 3-.7M13.8 8.5l-3.7 1-1.9 2.6',
  walk: 'M14.7 4.5a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0M12.7 8.3l-1.4 6 2.6 3.1.6 4.1M11.3 14.3l-2.4 7.2M12.4 9.7l-2.7 3M12.9 9.2l3 2.7',
  hike: 'M3 19.5l6.5-11 3.5 6 2.5-3.6 5.5 8.6zM9.5 8.5l1.6 2.7',
  bike: 'M9.6 16a3.6 3.6 0 1 1-7.2 0a3.6 3.6 0 1 1 7.2 0M21.6 16a3.6 3.6 0 1 1-7.2 0a3.6 3.6 0 1 1 7.2 0M6 16l3.4-7h5.6l3 7M9.4 9l3.4 7H6M15 9l-1-2.6h2.6',
  weights: 'M6.5 7.5v9M17.5 7.5v9M4 10v4M20 10v4M6.5 12h11',
  swim: 'M17.4 7a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0M5 12.6l5-3.6 3.6 2.6M2.5 16.5c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0 3.2 1.2 4.8 0M2.5 20c1.6-1.2 3.2-1.2 4.8 0s3.2 1.2 4.8 0 3.2-1.2 4.8 0 3.2 1.2 4.8 0',
  yoga: 'M13.7 5a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0M12 8.6v6M6.5 11.6L12 9.6l5.5 2M5.5 19.5l6.5-4.6 6.5 4.6z',
  ball: 'M20 12a8 8 0 1 1-16 0a8 8 0 1 1 16 0M12 4v16M4.6 9c4 1.4 10.8 1.4 14.8 0M4.6 15c4-1.4 10.8-1.4 14.8 0',
  watch: 'M19 13a7 7 0 1 1-14 0a7 7 0 1 1 14 0M12 13V9.5M10 2.5h4M12 2.5V6M17.6 6.6l1.3-1.3',
  chart: 'M4 19.5h16M6 15l4-5 3.2 3.2L18.5 7',
  route: 'M6.5 18.5a1.8 1.8 0 1 0 0-.01M17.5 5.5a1.8 1.8 0 1 0 0-.01M8.3 18.5h6.2a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6h6',
}

// Exercise-type families: icon + accent colour.
const KINDS = [
  { types: [56, 57], icon: ICONS.run, color: P.hr },
  { types: [79], icon: ICONS.walk, color: P.steps },
  { types: [37], icon: ICONS.hike, color: P.distance },
  { types: [8, 9], icon: ICONS.bike, color: P.spo2 },
  { types: [10, 11, 13, 36, 44, 70, 81], icon: ICONS.weights, color: P.kcal },
  { types: [73, 74], icon: ICONS.swim, color: P.resp },
  { types: [33, 48, 71, 83], icon: ICONS.yoga, color: P.hrv },
  { types: [2, 4, 5, 14, 28, 29, 35, 38, 55, 64, 65, 66, 75, 76, 78, 80], icon: ICONS.ball, color: P.vo2 },
]
const OTHER = { icon: ICONS.watch, color: P.text2 }
export const kindOf = (type) => KINDS.find((k) => k.types.includes(type)) || OTHER


export const workoutName = (w) => w.title || EXERCISE_TYPES[w.exercise_type] || 'Workout'
