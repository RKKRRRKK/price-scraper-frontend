<template>
  <div class="schedule">
    <div class="sched">
      <div class="clock-wrap">
        <svg class="clock" viewBox="0 0 200 200" @mouseleave="hover = null">
          <defs>
            <!-- hovered ring: lifted on a soft shadow -->
            <filter :id="liftId" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="0.6" stdDeviation="0.9" :flood-color="P.text" flood-opacity="0.28" />
            </filter>
            <!-- face: white centre shading to a faint slate rim, like a dish -->
            <radialGradient :id="faceId" cx="50%" cy="50%" r="50%">
              <stop offset="0.4" :stop-color="P.text" stop-opacity="0" />
              <stop offset="1" :stop-color="P.text" stop-opacity="0.035" />
            </radialGradient>
          </defs>

          <!-- Face, hour ring, ticks -->
          <circle cx="100" cy="100" :r="R_TICK" :fill="`url(#${faceId})`" />
          <circle cx="100" cy="100" :r="R_TICK" fill="none" :stroke="P.border2" stroke-width="0.5" />
          <circle cx="100" cy="100" :r="R_IN - 3" fill="none" :stroke="P.border" stroke-width="0.5" />
          <line
            v-for="t in ticks" :key="t.h"
            :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2"
            :stroke="t.major ? P.text3 : P.border2" :stroke-width="t.major ? 0.9 : 0.6" stroke-linecap="round"
          />
          <text
            v-for="l in labels" :key="l.h"
            :x="l.x" :y="l.y" text-anchor="middle" dominant-baseline="central"
            :font-size="l.cardinal ? 8 : 6.5" :font-weight="l.cardinal ? 600 : 500"
            :fill="l.cardinal ? P.text2 : P.text3" class="hour"
          >{{ l.text }}</text>

          <!-- Usual window: average bedtime → average wake, as a wedge and on the bezel -->
          <template v-if="usual">
            <path :d="usual.wedge" :fill="alpha(SLEEP.light, 0.07)" />
            <path :d="usual.bezel" fill="none" :stroke="SLEEP.light" stroke-width="2.2" stroke-linecap="round" opacity="0.75" />
          </template>

          <!-- One ring per night, newest outermost -->
          <g
            v-for="ring in rings" :key="ring.key"
            class="ring" :class="{ dim: hover && hover !== ring.key }"
            :filter="hover === ring.key ? `url(#${liftId})` : null"
            @mouseenter="hover = ring.key"
            @click="emit('select', ring.key)"
          >
            <path :d="ring.track" fill="none" stroke="transparent" :stroke-width="ring.pitch" />
            <path
              v-for="(s, i) in ring.segs" :key="i"
              :d="s.d" fill="none" :stroke="s.color" :stroke-width="ring.width" :stroke-linecap="s.cap"
            />
          </g>

          <!-- Average bedtime / wake hands -->
          <template v-if="usual">
            <g v-for="hand in usual.hands" :key="hand.key">
              <line
                :x1="hand.x1" :y1="hand.y1" :x2="hand.x2" :y2="hand.y2"
                :stroke="hand.color" stroke-width="0.9" stroke-dasharray="2 2" stroke-linecap="round" opacity="0.9"
              />
              <circle :cx="hand.x2" :cy="hand.y2" r="1.8" :fill="hand.color" />
            </g>
          </template>
        </svg>

        <div class="center">
          <span class="c-label">{{ center.label }}</span>
          <span class="c-main">{{ center.main }}</span>
          <span class="c-sub">{{ center.sub }}</span>
        </div>
      </div>

      <ol class="list hx-scroll" @mouseleave="hover = null">
        <li
          v-for="row in list" :key="row.key"
          :class="{ on: hover === row.key, dim: hover && hover !== row.key }"
          @mouseenter="hover = row.key"
          @click="emit('select', row.key)"
        >
          <span class="l-date" :class="{ we: row.weekend }">{{ row.date }}</span>
          <span class="l-track">
            <i
              v-for="(s, i) in row.segs" :key="i"
              :style="{ left: `${s.left}%`, width: `${s.width}%`, background: s.color }"
            />
          </span>
          <span class="l-time">{{ row.bed }}–{{ row.wake }}</span>
          <span class="l-dur">{{ row.asleep }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<script setup>
// Sleep schedule as a 24-hour clock: each recent night is a ring from bedtime
// to wake (stage-coloured, newest outermost) over the usual window, with the
// same nights as aligned timelines beside it. Hover either side to link them.
import { ref, computed, useId } from 'vue'
import dayjs from 'dayjs'
import { P, SLEEP, alpha, fmt } from '@/lib/health/theme'
import { STAGE, blocks, noonBefore, clock, mean, isWeekend } from './SleepShared'

const props = defineProps({
  nights: { type: Array, required: true },   // store.nights, oldest first
  count: { type: Number, default: 14 },
})
const emit = defineEmits(['select'])

const uid = useId()
const liftId = `sleep-lift-${uid}`
const faceId = `sleep-face-${uid}`

const R_IN = 36
const R_OUT = 80
const R_TICK = 84
const R_LABEL = 93.5
const HOUR = 3600e3

const hover = ref(null)

// Clock angle in degrees (midnight at the top, clockwise) for a timestamp.
function angle(ms) {
  const d = new Date(ms)
  return (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600) * 15
}

function point(r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)]
}

function arc(r, a0, a1) {
  const [x0, y0] = point(r, a0)
  const [x1, y1] = point(r, a1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

const recent = computed(() => props.nights.slice(-props.count))

const rings = computed(() => {
  const ns = recent.value
  const pitch = (R_OUT - R_IN) / Math.max(ns.length, 1)
  return ns.map((n, i) => {
    const r = R_IN + (i + 0.5) * pitch
    const bed = angle(n.start)
    // Unwrap past midnight so every angle in the night runs on from bedtime.
    const unwrap = (a) => (a < bed - 0.01 ? a + 360 : a)
    const wake = unwrap(angle(n.end))
    const bs = blocks(n.main)
    const segs = bs.map((b, j) => ({
      d: arc(r, unwrap(angle(b.start)), Math.max(unwrap(angle(b.end)), unwrap(angle(b.start)) + 0.2)),
      color: STAGE[b.row].color,
      cap: j === 0 || j === bs.length - 1 ? 'round' : 'butt',
    }))
    // Draw the last block first so its rounded start tucks under its neighbour.
    if (segs.length > 1) segs.unshift(segs.pop())
    return {
      key: n.key,
      pitch,
      width: Math.max(1.4, pitch * 0.68),
      track: arc(r, bed, wake),
      segs,
    }
  })
})

const ticks = computed(() =>
  Array.from({ length: 24 }, (_, h) => {
    const major = h % 3 === 0
    const [x1, y1] = point(R_TICK - (major ? 2.6 : 1.4), h * 15)
    const [x2, y2] = point(R_TICK + (major ? 1.2 : 0), h * 15)
    return { h, major, x1, y1, x2, y2 }
  }),
)

const labels = computed(() =>
  [0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
    const [x, y] = point(R_LABEL, h * 15)
    return { h, x, y, text: String(h).padStart(2, '0'), cardinal: h % 6 === 0 }
  }),
)

// Average bedtime / wake over the nights shown, on the hours-since-noon scale
// (so 23:30 and 00:30 average to midnight, not noon).
const usual = computed(() => {
  const ns = recent.value
  if (ns.length < 2) return null
  const bed = mean(ns.map((n) => (n.start - noonBefore(n.key)) / HOUR))
  const wake = mean(ns.map((n) => (n.end - noonBefore(n.key)) / HOUR))
  const a0 = ((bed + 12) % 24) * 15
  let a1 = ((wake + 12) % 24) * 15
  if (a1 < a0) a1 += 360
  const [ox0, oy0] = point(R_OUT + 1.5, a0)
  const [ox1, oy1] = point(R_OUT + 1.5, a1)
  const [ix1, iy1] = point(R_IN - 1.5, a1)
  const [ix0, iy0] = point(R_IN - 1.5, a0)
  const large = a1 - a0 > 180 ? 1 : 0
  const wedge = `M${ox0} ${oy0} A${R_OUT + 1.5} ${R_OUT + 1.5} 0 ${large} 1 ${ox1} ${oy1} `
    + `L${ix1} ${iy1} A${R_IN - 1.5} ${R_IN - 1.5} 0 ${large} 0 ${ix0} ${iy0} Z`
  const hand = (key, a, color) => {
    const [x1, y1] = point(R_IN - 3, a)
    const [x2, y2] = point(R_TICK + 0.5, a)
    return { key, x1, y1, x2, y2, color }
  }
  return {
    bed,
    wake,
    asleep: mean(ns.map((n) => n.asleep)),
    wedge,
    bezel: arc(R_TICK, a0, a1),
    hands: [hand('bed', a0, SLEEP.light), hand('wake', a1, SLEEP.awake)],
  }
})

const center = computed(() => {
  const n = hover.value && props.nights.find((x) => x.key === hover.value)
  if (n) {
    return {
      label: dayjs(n.key).format('ddd D MMM'),
      main: fmt.duration(n.asleep),
      sub: `${fmt.time(n.start)}–${fmt.time(n.end)}`,
    }
  }
  const u = usual.value
  if (u) return { label: 'Usual night', main: fmt.duration(u.asleep), sub: `${clock(u.bed)}–${clock(u.wake)}` }
  const last = recent.value.at(-1)
  return last
    ? { label: dayjs(last.key).format('ddd D MMM'), main: fmt.duration(last.asleep), sub: `${fmt.time(last.start)}–${fmt.time(last.end)}` }
    : { label: '', main: '–', sub: '' }
})

// Timelines on one shared window, newest first.
const list = computed(() => {
  const ns = recent.value
  if (!ns.length) return []
  const rel = ns.map((n) => {
    const noon = noonBefore(n.key)
    return { n, noon, bed: (n.start - noon) / HOUR, wake: (n.end - noon) / HOUR }
  })
  const w0 = Math.floor(Math.min(...rel.map((r) => r.bed)) - 0.25)
  const w1 = Math.ceil(Math.max(...rel.map((r) => r.wake)) + 0.25)
  const pct = (h) => ((h - w0) / (w1 - w0)) * 100
  return rel
    .map(({ n, noon }) => ({
      key: n.key,
      date: dayjs(n.key).format('ddd D'),
      weekend: isWeekend(n.key),
      bed: fmt.time(n.start),
      wake: fmt.time(n.end),
      asleep: fmt.duration(n.asleep),
      segs: blocks(n.main).map((b) => {
        const left = pct((b.start - noon) / HOUR)
        return { left, width: Math.max(pct((b.end - noon) / HOUR) - left, 0.4), color: STAGE[b.row].color }
      }),
    }))
    .reverse()
})
</script>

<style scoped>
.schedule {
  flex: 1;
  min-height: 0;
  display: flex;
  container-type: size;
}

.sched {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 1rem;
}

.clock-wrap {
  position: relative;
  height: 100%;
  aspect-ratio: 1 / 1;
  flex: 0 0 auto;
  container-type: size;
}

.clock {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.hour {
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}

.ring {
  cursor: pointer;
  transition: opacity 0.15s;
}

.ring.dim {
  opacity: 0.22;
}

.center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.0625rem;
  pointer-events: none;
  text-align: center;
  line-height: 1.15;
}

.c-label {
  font-size: clamp(0.5rem, 4.2cqh, 0.6875rem);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--hx-text3);
}

.c-main {
  font-size: clamp(0.8125rem, 8.4cqh, 1.5rem);
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--hx-text);
}

.c-sub {
  font-size: clamp(0.5625rem, 4.6cqh, 0.75rem);
  color: var(--hx-text2);
}

.list {
  flex: 1;
  min-width: 0;
  min-height: 0;
  container: night-list / inline-size;
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
}

.list li {
  display: grid;
  grid-template-columns: 2.75rem minmax(2.5rem, 1fr) auto 3.25rem;
  align-items: center;
  gap: 0.625rem;
  min-height: 1.375rem;
  padding: 0.125rem 0.5rem;
  font-size: 0.75rem;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}

.list li.on {
  background: var(--hx-panel2);
}

.list li.dim {
  opacity: 0.55;
}

.l-date {
  color: var(--hx-text3);
  white-space: nowrap;
}

.l-date.we {
  color: var(--hx-text2);
  font-weight: 600;
}

.l-track {
  position: relative;
  height: 0.375rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--hx-text) 5%, transparent);
}

.l-track i {
  position: absolute;
  top: 0;
  bottom: 0;
}

.l-track i:first-child,
.l-track i:last-child {
  border-radius: 999px;
}

.l-time {
  color: var(--hx-text2);
  white-space: nowrap;
}

.l-dur {
  color: var(--hx-text);
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
}

/* Narrow list: drop the bed–wake times (the track still shows them). */
@container night-list (max-width: 17rem) {
  .l-time {
    display: none;
  }

  .list li {
    grid-template-columns: 2.75rem minmax(2.5rem, 1fr) 3.25rem;
  }
}

/* Not wide enough for clock + list side by side (phones): stack them. */
@container (max-aspect-ratio: 8 / 5) {
  .sched {
    flex-direction: column;
    gap: 0.5rem;
  }

  .clock-wrap {
    height: 58%;
    align-self: center;
  }
}
</style>
