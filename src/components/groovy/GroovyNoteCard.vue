<!-- File: src/components/groovy/GroovyNoteCard.vue -->
<!--
  One note, read out: what pitch it was and how far it sat from its grid line.
  Follows the latest note (or the one a replay is sounding) until a note is
  clicked on the roll, then holds that one until it is let go.

  The running numbers for the session — or for the take being replayed — sit on
  the right, as they did in the old readout.
-->
<template>
  <section class="nc">
    <div class="nc-focus">
      <div class="nc-eyebrow">
        {{ pinned ? 'Selected note' : mode === 'review' ? 'Playing' : 'Last note' }}
        <button v-if="pinned" class="nc-x" title="Let go (Esc)" @click="$emit('unpin')">
          <i class="pi pi-times"></i>
        </button>
      </div>

      <div class="nc-row">
        <div class="nc-block">
          <span class="nc-big" :class="{ faint: !note }">{{ note || (hit ? '?' : '—') }}</span>
          <span class="nc-sub">
            <template v-if="note">{{ cents > 0 ? '+' : '' }}{{ cents }}¢ · {{ freq }} Hz</template>
            <template v-else-if="hit">pitch unclear</template>
            <template v-else>play a note</template>
          </span>
          <span v-if="note" class="nc-tag" :class="{ off: !tone }" :title="scale?.name">
            {{ tone ? `${tone.degreeLabel} · in key` : 'not in key' }}
          </span>
        </div>

        <div class="nc-block">
          <span class="nc-big" :class="zone || 'faint'">
            <template v-if="hit">{{ hit.devMs > 0 ? '+' : '' }}{{ Math.round(hit.devMs) }}</template>
            <template v-else>—</template>
            <small>ms</small>
          </span>
          <span class="nc-sub">
            <template v-if="hit">{{ direction }} · beat {{ hit.label }}</template>
            <template v-else>from the nearest grid line</template>
          </span>
          <span v-if="zone" class="nc-tag" :class="zone">{{ ZONE_WORDS[zone] }}</span>
        </div>
      </div>
    </div>

    <div class="nc-stats">
      <div class="nc-stat">
        <span class="nc-k">Spread</span>
        <span class="nc-v">{{ fmt1(stats.sdMs) }} ms</span>
      </div>
      <div class="nc-stat">
        <span class="nc-k">Feel</span>
        <span class="nc-v">{{ stats.meanMs > 0 ? '+' : '' }}{{ fmt1(stats.meanMs) }} ms</span>
      </div>
      <div class="nc-stat">
        <span class="nc-k">In pocket</span>
        <span class="nc-v">{{ Math.round(stats.inPocketPct || 0) }}%</span>
      </div>
      <div class="nc-stat">
        <span class="nc-k">Notes</span>
        <span class="nc-v">{{ stats.count || 0 }}</span>
      </div>
      <div v-if="position" class="nc-stat">
        <span class="nc-k">Bar</span>
        <span class="nc-v">{{ position }}</span>
      </div>
      <button v-if="mode === 'live'" class="nc-reset" title="Clear the notes and the running numbers" @click="$emit('reset')">
        <i class="pi pi-refresh"></i>
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { pocketZone } from '@/lib/groovy/analysis'
import { noteLabel } from '@/lib/groovy/scales'

const props = defineProps({
  // { devMs, label, midi, midiFloat, freq } or null
  hit: { type: Object, default: null },
  pinned: { type: Boolean, default: false },
  mode: { type: String, default: 'live' }, // 'live' | 'review'
  toleranceMs: { type: Number, default: 25 },
  scale: { type: Object, default: null },
  stats: { type: Object, default: () => ({}) },
  position: { type: String, default: '' },
})
defineEmits(['unpin', 'reset'])

const ZONE_WORDS = { pocket: 'In the pocket', edge: 'On the edge', out: 'Outside' }

const zone = computed(() => (props.hit ? pocketZone(props.hit.devMs, props.toleranceMs) : null))
const note = computed(() => (props.hit?.midi != null ? noteLabel(props.hit.midi, props.scale) : ''))
const tone = computed(() =>
  props.hit?.midi != null ? props.scale?.tones.get(((props.hit.midi % 12) + 12) % 12) || null : null,
)
const cents = computed(() =>
  props.hit?.midiFloat != null ? Math.round((props.hit.midiFloat - props.hit.midi) * 100) : 0,
)
const freq = computed(() => (props.hit?.freq ? props.hit.freq.toFixed(1) : '—'))
const direction = computed(() => {
  const d = props.hit?.devMs || 0
  if (Math.abs(d) < 0.5) return 'on the line'
  return d < 0 ? 'early' : 'late'
})

function fmt1(v) {
  return (Math.round((v || 0) * 10) / 10).toFixed(1)
}
</script>

<style scoped>
.nc {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.5rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
}

:where(.nc button) {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

.nc-focus {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.nc-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.nc-x {
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 0.25rem;
  display: grid;
  place-items: center;
  font-size: 0.55rem;
  color: var(--text-dim);
  background: var(--bg-sunken) !important;
}

.nc-x:hover {
  color: var(--text);
}

.nc-row {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.nc-block {
  display: grid;
  grid-template-columns: auto;
  align-content: start;
  gap: 0.1rem;
  min-width: 8.5rem;
}

.nc-big {
  font-size: 1.9rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.nc-big small {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-faint);
  margin-left: 0.2rem;
  letter-spacing: 0;
}

.nc-big.faint {
  color: var(--text-faint);
}

.nc-big.pocket {
  color: #15803d;
}

.nc-big.edge {
  color: #a16207;
}

.nc-big.out {
  color: #c62828;
}

.nc-sub {
  font-size: 0.72rem;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.nc-tag {
  justify-self: start;
  margin-top: 0.1rem;
  font-size: 0.64rem;
  font-weight: 700;
  padding: 0.08rem 0.45rem;
  border-radius: 999px;
  background: var(--bg-sunken);
  color: var(--text-dim);
  white-space: nowrap;
}

.nc-tag.off {
  background: #fff;
  color: var(--text);
  border: 1px dashed var(--text);
}

.nc-tag.pocket {
  background: #dcfce7;
  color: #166534;
}

.nc-tag.edge {
  background: #fef3c7;
  color: #854d0e;
}

.nc-tag.out {
  background: #fee2e2;
  color: #991b1b;
}

.nc-stats {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  flex-wrap: wrap;
  margin-left: auto;
}

.nc-stat {
  display: flex;
  flex-direction: column;
}

.nc-k {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.nc-v {
  font-size: 0.95rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.nc-reset {
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border) !important;
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: 0.72rem;
}

.nc-reset:hover {
  color: var(--text);
  border-color: var(--accent-400) !important;
}

@media (max-width: 860px) {
  .nc {
    gap: 0.6rem;
  }

  .nc-stats {
    gap: 0.75rem;
  }
}
</style>
