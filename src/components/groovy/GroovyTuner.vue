<!-- File: src/components/groovy/GroovyTuner.vue -->
<!--
  A chromatic tuner on the same pitch tracker the roll uses, A4 = 440.

  The tracker reports ~35 times a second and wobbles by a few cents between
  reports, which is fine for drawing a note and useless for tuning one. So the
  needle shows the median of the last few readings, the run restarts whenever
  the pitch jumps (a new string, not drift), and the last reading stays up,
  dimmed, after the string stops — you read a tuner after plucking, not during.

  The needle uses the tool's three pocket colours: green within ±5¢, yellow to
  ±15¢, red beyond.
-->
<template>
  <section class="tn">
    <header class="tn-head">
      <span class="tn-title">Tuner</span>
      <span class="tn-ref">A4 = 440 Hz</span>
      <button class="tn-x" title="Close the tuner" @click="$emit('close')">
        <i class="pi pi-times"></i>
      </button>
    </header>

    <div v-if="!enabled" class="tn-off">Enable the audio input to tune.</div>

    <div v-else class="tn-body" :class="{ stale: !shown || stale }">
      <div class="tn-note">
        <template v-if="shown">{{ name }}<sub>{{ octave }}</sub></template>
        <template v-else>—</template>
      </div>

      <div class="tn-right">
        <div class="tn-meter">
          <div class="tn-in"></div>
          <div class="tn-mid"></div>
          <div v-if="shown" class="tn-needle" :class="needleZone" :style="{ left: pct + '%' }"></div>
        </div>
        <div class="tn-scale"><span>−50</span><span>0</span><span>+50</span></div>
        <div class="tn-sub">
          <template v-if="shown">
            {{ cents > 0 ? '+' : '' }}{{ cents }}¢ · {{ shown.freq.toFixed(1) }} Hz<template v-if="stringHint"> · {{ stringHint }}</template>
          </template>
          <template v-else>play one string</template>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { median } from '@/lib/groovy/analysis'
import { stringName } from '@/lib/groovy/scales'

const props = defineProps({
  // The tracker's latest { midiFloat, clarity, ... }, or null on silence.
  reading: { type: Object, default: null },
  enabled: { type: Boolean, default: false },
  // Open-string MIDI notes of the chosen instrument, low to high.
  strings: { type: Array, default: () => [] },
})
defineEmits(['close'])

const shown = ref(null)
const stale = ref(false)
let recent = []
let staleTimer = 0

watch(
  () => props.reading,
  (r) => {
    if (!r) return
    if (recent.length && Math.abs(r.midiFloat - recent[recent.length - 1]) > 0.5) recent = []
    recent.push(r.midiFloat)
    if (recent.length > 6) recent.shift()
    const m = median(recent)
    const midi = Math.round(m)
    shown.value = { midiFloat: m, midi, freq: 440 * Math.pow(2, (m - 69) / 12) }
    stale.value = false
    clearTimeout(staleTimer)
    staleTimer = setTimeout(() => {
      stale.value = true
      recent = []
    }, 1200)
  },
)

onBeforeUnmount(() => clearTimeout(staleTimer))

const name = computed(() => (shown.value ? stringName(shown.value.midi, null) : ''))
const octave = computed(() => (shown.value ? Math.floor(shown.value.midi / 12) - 1 : ''))
const cents = computed(() => (shown.value ? Math.round((shown.value.midiFloat - shown.value.midi) * 100) : 0))
const pct = computed(() => 50 + Math.max(-50, Math.min(50, cents.value)))
const needleZone = computed(() => {
  const a = Math.abs(cents.value)
  if (a <= 5) return 'pocket'
  if (a <= 15) return 'edge'
  return 'out'
})
const stringHint = computed(() => {
  if (!shown.value) return ''
  const i = props.strings.indexOf(shown.value.midi)
  return i === -1 ? '' : `${stringName(shown.value.midi, null)} string`
})
</script>

<style scoped>
.tn {
  flex: 0 0 17rem;
  width: 17rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.5rem 0.75rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
}

.tn-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tn-title {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.tn-ref {
  font-size: 0.64rem;
  color: var(--text-faint);
}

.tn-x {
  margin-left: auto;
  width: 1.3rem;
  height: 1.3rem;
  border-radius: 0.3rem;
  display: grid;
  place-items: center;
  font-size: 0.6rem;
  color: var(--text-faint);
  background: none;
  border: none;
  cursor: pointer;
}

.tn-x:hover {
  background: var(--bg-sunken);
  color: var(--text);
}

.tn-off {
  font-size: 0.74rem;
  color: var(--text-faint);
  padding: 0.6rem 0;
}

.tn-body {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  transition: opacity 200ms;
}

.tn-body.stale {
  opacity: 0.45;
}

.tn-note {
  min-width: 3.2rem;
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}

.tn-note sub {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-faint);
  vertical-align: baseline;
  margin-left: 0.05rem;
}

.tn-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.tn-meter {
  position: relative;
  height: 1.1rem;
  border-radius: 0.3rem;
  background: var(--bg-sunken);
  overflow: hidden;
}

.tn-in {
  position: absolute;
  left: 45%;
  width: 10%;
  top: 0;
  bottom: 0;
  background: rgba(22, 163, 74, 0.16);
}

.tn-mid {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #c3c2b7;
}

.tn-needle {
  position: absolute;
  top: 0.1rem;
  bottom: 0.1rem;
  width: 0.25rem;
  margin-left: -0.125rem;
  border-radius: 999px;
  transition: left 90ms linear;
}

.tn-needle.pocket {
  background: #16a34a;
}

.tn-needle.edge {
  background: #e8a800;
}

.tn-needle.out {
  background: #e34948;
}

.tn-scale {
  display: flex;
  justify-content: space-between;
  font-size: 0.58rem;
  color: var(--text-faint);
  font-family: var(--mono);
}

.tn-sub {
  font-size: 0.7rem;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 860px) {
  .tn {
    flex: 1 1 100%;
    width: auto;
  }
}
</style>
