<template>
  <div v-if="open" class="tuner-pop" @click.stop>
    <div class="tuner-pop-head">
      <span class="tuner-pop-title"><i class="pi pi-gauge"></i> Tuner</span>
      <span class="tuner-pop-a4">A4 = 440 Hz</span>
      <button class="tuner-pop-close" @click="$emit('close')" title="Close">
        <i class="pi pi-times"></i>
      </button>
    </div>

    <!-- Big note name flanked by its chromatic neighbours -->
    <div class="tuner-notes">
      <span class="side">{{ prevName }}</span>
      <span class="main" :class="{ ok: inTune, live: hasPitch && !inTune, idle: !hasPitch }">{{ hasPitch ? pitch.name : '—' }}</span>
      <span class="side">{{ nextName }}</span>
    </div>

    <!-- Gauge: needle sweeps ±50 cents over ±60° -->
    <div class="gauge">
      <svg viewBox="0 0 300 120" class="gauge-svg">
        <path :d="wedgePath" class="wedge" />
        <g v-for="t in ticks" :key="t.cents">
          <line
            :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2"
            :class="['tick', { major: t.major, zero: t.cents === 0 }]"
          />
        </g>
        <g :style="{ transform: `rotate(${needleDeg}deg)`, transformOrigin: '150px 112px' }" class="needle-g">
          <line x1="150" y1="112" x2="150" y2="18" class="needle" :class="{ live: hasPitch, ok: inTune }" />
          <circle cx="150" cy="112" r="6" class="needle-hub" />
        </g>
      </svg>
    </div>

    <div class="tuner-pop-read">
      <template v-if="hasPitch">
        <b :class="{ ok: inTune }">{{ centsLabel }}</b>
        <span class="hz">{{ pitch.freq.toFixed(1) }} Hz</span>
      </template>
      <template v-else>
        <span class="idle">{{ micOn ? 'Listening… play a note' : 'Mic is off' }}</span>
      </template>
    </div>

    <!-- Target note fed by the player's current note -->
    <div v-if="targetNote" class="tuner-target">
      <span class="tt-label">TARGET</span>
      <span class="tt-note">{{ targetNote.jp }} · {{ targetNote.pitch }} <span class="tt-sub">(current note)</span></span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  // { name, midi, cents, freq } or null while silent
  pitch: { type: Object, default: null },
  micOn: { type: Boolean, default: false },
  // { jp, pitch } for the player's current note, or null when no score is loaded
  targetNote: { type: Object, default: null },
})
defineEmits(['close'])

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
function nameOf(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)
}

const hasPitch = computed(() => !!props.pitch)
const inTune = computed(() => hasPitch.value && Math.abs(props.pitch.cents) <= 8)
const prevName = computed(() => (hasPitch.value ? nameOf(props.pitch.midi - 1) : ''))
const nextName = computed(() => (hasPitch.value ? nameOf(props.pitch.midi + 1) : ''))
const centsLabel = computed(() => {
  if (!hasPitch.value) return ''
  const c = props.pitch.cents
  if (Math.abs(c) <= 2) return 'in tune'
  return (c > 0 ? '+' : '') + c + '¢'
})

// ±50 cents → ±60 degrees; rest position is 0 (straight up).
const needleDeg = computed(() => {
  if (!hasPitch.value) return 0
  const c = Math.max(-50, Math.min(50, props.pitch.cents))
  return (c / 50) * 60
})

// Ticks every 5 cents, majors every 25.
const CX = 150
const CY = 112
const R_OUT = 100
const ticks = computed(() => {
  const arr = []
  for (let c = -50; c <= 50; c += 5) {
    const major = c % 25 === 0
    const a = ((c / 50) * 60 - 90) * (Math.PI / 180)
    const rIn = R_OUT - (major ? 16 : 9)
    arr.push({
      cents: c,
      major,
      x1: CX + Math.cos(a) * rIn,
      y1: CY + Math.sin(a) * rIn,
      x2: CX + Math.cos(a) * R_OUT,
      y2: CY + Math.sin(a) * R_OUT,
    })
  }
  return arr
})

// Shaded ±8¢ "in tune" wedge behind the ticks.
const wedgePath = computed(() => {
  const a1 = ((-8 / 50) * 60 - 90) * (Math.PI / 180)
  const a2 = ((8 / 50) * 60 - 90) * (Math.PI / 180)
  const r1 = 40
  const r2 = R_OUT - 18
  const p = (a, r) => `${CX + Math.cos(a) * r} ${CY + Math.sin(a) * r}`
  return `M ${p(a1, r1)} L ${p(a1, r2)} A ${r2} ${r2} 0 0 1 ${p(a2, r2)} L ${p(a2, r1)} A ${r1} ${r1} 0 0 0 ${p(a1, r1)} Z`
})
</script>

<style scoped>
.tuner-pop {
  position: absolute;
  left: 0.85rem;
  bottom: 3.75rem;
  width: 20rem;
  background: #fff;
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 1rem;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.05);
  padding: 0.875rem 1rem 1rem;
  z-index: 60;
}
.tuner-pop-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.tuner-pop-title {
  font-size: 0.8rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.tuner-pop-title i { font-size: 0.82rem; color: var(--accent-500, #ef4444); }
.tuner-pop-a4 { font-size: 0.66rem; color: var(--text-faint, #9a9a9a); margin-left: auto; }
.tuner-pop-close {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint, #9a9a9a);
  font-size: 0.7rem;
}
.tuner-pop-close:hover { background: var(--bg-sunken, #f3f2f0); color: var(--text, #1a1a1a); }

.tuner-notes {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.8rem;
  margin-top: 0.6rem;
}
.tuner-notes .side { font-size: 0.875rem; color: #c9c7c2; font-weight: 600; min-width: 2rem; text-align: center; }
.tuner-notes .main { font-size: 2.875rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
.tuner-notes .main.ok { color: #16a34a; }
.tuner-notes .main.live { color: var(--accent-500, #ef4444); }
.tuner-notes .main.idle { color: var(--text-faint, #9a9a9a); }

.gauge { position: relative; margin-top: 0.75rem; }
.gauge-svg { width: 100%; height: auto; display: block; }
.tick { stroke: #cfcdc8; stroke-width: 1.5; }
.tick.major { stroke: #8a8781; stroke-width: 2.25; }
.tick.zero { stroke: var(--accent-500, #ef4444); stroke-width: 2.5; }
.wedge { fill: rgba(22, 163, 74, 0.12); }
.needle-g { transition: transform 90ms linear; }
.needle { stroke: #b9b6b0; stroke-width: 4; stroke-linecap: round; }
.needle.live { stroke: var(--accent-500, #ef4444); }
.needle.live.ok { stroke: #16a34a; }
.needle-hub { fill: #44403c; }

.tuner-pop-read {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.75rem;
  margin-top: 0.4rem;
  min-height: 1.4rem;
}
.tuner-pop-read b { font-size: 1.25rem; font-variant-numeric: tabular-nums; color: var(--accent-600, #b91c1c); }
.tuner-pop-read b.ok { color: #16a34a; }
.tuner-pop-read .hz { color: var(--text-faint, #9a9a9a); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.tuner-pop-read .idle { color: var(--text-faint, #9a9a9a); font-size: 0.8rem; }

.tuner-target {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.65rem;
  padding: 0.45rem 0.65rem;
  border-radius: 0.55rem;
  background: var(--accent-050, #fef2f2);
  border: 1px solid var(--accent-100, #fee2e2);
}
.tt-label { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.05em; color: var(--accent-600, #b91c1c); }
.tt-note { font-size: 0.8rem; font-weight: 700; }
.tt-sub { color: var(--text-faint, #9a9a9a); font-weight: 500; }
</style>
