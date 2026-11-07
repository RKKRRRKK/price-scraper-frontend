<template>
  <div class="workouts">
    <div v-if="!items.length" class="hx-empty">
      <svg class="empty-ico" viewBox="0 0 24 24"><path :d="ICONS.watch" /></svg>
      <span v-if="store.ready">No workouts recorded in the last 90 days.</span>
    </div>

    <template v-else>
      <div class="summary">
        <div class="hx-stat">
          <span class="hx-stat-label">This week</span>
          <span class="hx-stat-value">{{ week.count }}<small>{{ week.count === 1 ? 'workout' : 'workouts' }}</small></span>
        </div>
        <div class="hx-stat">
          <span class="hx-stat-label">Time</span>
          <span class="hx-stat-value">{{ fmt.duration(week.min) }}</span>
        </div>
        <div v-if="avg4 != null" class="hx-stat">
          <span class="hx-stat-label">4-week avg</span>
          <span class="hx-stat-value">{{ fmt.duration(avg4) }}<small>/ wk</small></span>
        </div>
        <div class="weeks" title="Workout time per week, last 8 weeks">
          <span
            v-for="w in weeks"
            :key="w.key"
            :class="{ now: w.current }"
            :style="{ height: `${w.pct}%` }"
            :title="`${w.label}: ${fmt.duration(w.min)}`"
          />
        </div>
      </div>

      <div class="hx-scroll list">
        <template v-for="g in groups" :key="g.key">
          <div class="week-head">
            <span>{{ g.label }}</span>
            <span>{{ g.items.length }} · {{ fmt.duration(g.min) }}</span>
          </div>
          <div
            v-for="w in g.items"
            :key="w.id"
            role="button"
            tabindex="0"
            :class="['card', { inview: w.inView, picked: w.picked }]"
            :style="{ '--c': w.color }"
            title="Show in the heart-rate chart"
            @click="focus(w)"
            @keydown.enter="focus(w)"
          >
            <span class="ico"><svg viewBox="0 0 24 24"><path :d="w.icon" /></svg></span>
            <span class="main">
              <span class="name">{{ w.name }}</span>
              <span class="when">{{ w.when }}</span>
              <span v-if="w.facts" class="facts">{{ w.facts }}</span>
            </span>
            <span class="dur">
              {{ fmt.duration(w.min) }}
              <span class="dur-track"><span :style="{ width: `${w.pct}%` }" /></span>
            </span>
            <button v-if="w.has" type="button" class="open" title="Open workout details" @click.stop="open(w)">
              <svg viewBox="0 0 24 24"><path :d="ICONS.route" /></svg>
            </button>
            <svg v-else class="hint" viewBox="0 0 24 24"><path :d="ICONS.chart" /></svg>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup>
// Workouts from the last 90 days, newest first, grouped by week (Monday
// start). Clicking a card opens it in the minute heart-rate chart.
import { computed } from 'vue'
import dayjs from 'dayjs'
import { fmt } from '@/lib/health/theme'
import { ICONS, kindOf, workoutName } from '@/lib/health/workouts'
import { pace } from '@/lib/health/draw'
import { useHealthStore } from '@/stores/health'

const store = useHealthStore()

const weekStart = (ms) => {
  const d = dayjs(ms).startOf('day')
  return d.subtract((d.day() + 6) % 7, 'day').valueOf()
}

const thisWeek = computed(() => weekStart(store.now))

const factsOf = (d) =>
  [
    d.distance_m ? fmt.km(d.distance_m) : null,
    d.pace ? `${pace(d.pace)} /km` : null,
    d.kcal ? `${Math.round(d.kcal)} kcal` : null,
    d.avg_hr ? `${Math.round(d.avg_hr)} bpm` : null,
  ].filter(Boolean).join(' · ')

function focus(w) {
  store.selectWorkout(w.id)
  store.focusRange(w.start, w.end)
}

// Opens the workout panel below the grid (it is not on the first screen).
function open(w) {
  store.selectWorkout(w.id)
  store.focusRange(w.start, w.end)
  document.getElementById('hx-workout')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

const items = computed(() => {
  const { start: vs, end: ve } = store.detailRange
  const list = store.workouts.map((w) => {
    const start = new Date(w.start_time).getTime()
    const end = new Date(w.end_time).getTime()
    const kind = kindOf(w.exercise_type)
    return {
      id: w.record_id,
      start,
      end,
      min: (end - start) / 60e3,
      name: workoutName(w),
      when: `${dayjs(start).format('ddd D MMM')} · ${dayjs(start).format('HH:mm')}–${dayjs(end).format('HH:mm')}`,
      icon: kind.icon,
      color: kind.color,
      week: weekStart(start),
      inView: start >= vs && end <= ve,
      has: !!w.details,
      facts: w.details ? factsOf(w.details) : '',
      picked: store.workout?.record_id === w.record_id && store.hasWorkoutDetails,
    }
  })
  const longest = Math.max(...list.map((w) => w.min), 1)
  for (const w of list) w.pct = Math.max((w.min / longest) * 100, 4)
  return list
})

const week = computed(() => {
  const list = items.value.filter((w) => w.week === thisWeek.value)
  return { count: list.length, min: list.reduce((a, w) => a + w.min, 0) }
})

// Last 8 weeks of workout time, oldest first, for the mini bars.
const weeks = computed(() => {
  const out = []
  for (let k = 7; k >= 0; k--) {
    const ws = dayjs(thisWeek.value).subtract(k, 'week').valueOf()
    const min = items.value.filter((w) => w.week === ws).reduce((a, w) => a + w.min, 0)
    out.push({ key: ws, min, current: k === 0, label: k === 0 ? 'This week' : `Week of ${dayjs(ws).format('D MMM')}` })
  }
  const max = Math.max(...out.map((w) => w.min), 1)
  for (const w of out) w.pct = w.min ? Math.max((w.min / max) * 100, 8) : 3
  return out
})

// Average of the four complete weeks before this one.
const avg4 = computed(() => {
  const prev = weeks.value.slice(-5, -1)
  if (!items.value.some((w) => w.week <= prev[0].key)) return null
  return prev.reduce((a, w) => a + w.min, 0) / prev.length
})

const groups = computed(() => {
  const lastWeek = dayjs(thisWeek.value).subtract(1, 'week').valueOf()
  const map = new Map()
  for (const w of items.value) {
    let g = map.get(w.week)
    if (!g) {
      const label = w.week === thisWeek.value
        ? 'This week'
        : w.week === lastWeek
          ? 'Last week'
          : `${dayjs(w.week).format('D MMM')} – ${dayjs(w.week).add(6, 'day').format('D MMM')}`
      map.set(w.week, (g = { key: w.week, label, items: [], min: 0 }))
    }
    g.items.push(w)
    g.min += w.min
  }
  return [...map.values()]
})
</script>

<style scoped>
.workouts {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.summary {
  display: flex;
  align-items: flex-end;
  gap: 1.25rem;
  flex-shrink: 0;
  padding: 0.125rem 0.125rem 0.625rem;
  border-bottom: 1px solid var(--hx-border);
}

.weeks {
  display: flex;
  align-items: flex-end;
  gap: 0.1875rem;
  height: 1.75rem;
  margin-left: auto;
}

.weeks span {
  width: 0.4375rem;
  border-radius: 2px 2px 1px 1px;
  background: color-mix(in srgb, var(--hx-kcal) 35%, transparent);
}

.weeks span.now {
  background: var(--hx-kcal);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.3125rem;
  padding-bottom: 0.25rem;
}

.week-head {
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0.125rem 0.25rem;
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--hx-text3);
  background: var(--hx-panel);
}

.week-head span:last-child {
  letter-spacing: 0.02em;
  text-transform: none;
}

.card {
  --c: var(--hx-text2);
  position: relative;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto 1.5rem;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.4375rem 0.625rem 0.4375rem 0.75rem;
  font: inherit;
  text-align: left;
  color: var(--hx-text);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--c) 13%, transparent), transparent 55%),
    var(--hx-panel2);
  border: 1px solid var(--hx-border);
  border-radius: 0.625rem;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
}

.card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.5rem;
  bottom: 0.5rem;
  width: 2px;
  border-radius: 999px;
  background: var(--c);
}

.card:hover {
  border-color: color-mix(in srgb, var(--c) 45%, transparent);
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.06),
    0 0.375rem 1rem rgba(15, 23, 42, 0.1);
  transform: translateY(-1px);
}

.card:focus-visible {
  outline: 1px solid var(--c);
  outline-offset: 1px;
}

/* In the minute chart right now: lifted onto white with a doubled inner
   edge (an outer ring would be clipped by the scrolling list). */
.card.inview {
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--c) 16%, transparent), transparent 60%),
    var(--hx-panel);
  border-color: color-mix(in srgb, var(--c) 70%, transparent);
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--c) 30%, transparent),
    0 2px 6px rgba(15, 23, 42, 0.08);
}

.ico {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  color: var(--c);
  background: radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--c) 30%, transparent), color-mix(in srgb, var(--c) 9%, transparent));
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 32%, transparent);
}

.ico svg,
.hint,
.empty-ico {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ico svg {
  width: 1.125rem;
  height: 1.125rem;
}

.main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}

.name {
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.when {
  font-size: 0.6875rem;
  color: var(--hx-text3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dur {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
}

.dur-track {
  width: 3.25rem;
  height: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--c) 16%, transparent);
  overflow: hidden;
}

.dur-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--c);
}

.open {
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s;
}

.open:hover {
  background: color-mix(in srgb, var(--c) 24%, transparent);
}

.open svg {
  width: 0.875rem;
  height: 0.875rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.facts {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--hx-text2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The workout shown in the details panel. */
.card.picked:not(.inview) {
  border-color: color-mix(in srgb, var(--c) 40%, transparent);
}

.hint {
  width: 1rem;
  height: 1rem;
  color: var(--c);
  opacity: 0;
  transition: opacity 0.15s;
}

.card:hover .hint,
.card.inview .hint {
  opacity: 1;
}

.empty-ico {
  width: 1.5rem;
  height: 1.5rem;
  opacity: 0.6;
}
</style>
