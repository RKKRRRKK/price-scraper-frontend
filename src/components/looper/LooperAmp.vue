<!-- File: src/components/looper/LooperAmp.vue -->
<!--
  Groovy's amp (lib/groovy/amp.js) with a guitar voicing beside the bass one,
  and an off switch for anything that is neither — drums, a voice — where the
  cabinet would only dull it. Whatever this is set to when a loop is recorded
  is what the loop sounds like; the clean DI is kept underneath either way and
  goes out with the REAPER export.
-->
<template>
  <div class="amp">
    <div class="row">
      <div class="seg" role="group" aria-label="Instrument">
        <button :class="{ on: value.on && instrument === 'bass' }" @click="pick('bass')">Bass</button>
        <button :class="{ on: value.on && instrument === 'guitar' }" @click="pick('guitar')">Guitar</button>
        <button :class="{ on: !value.on }" title="Record and monitor the input untouched" @click="$emit('update', { on: false })">
          Off
        </button>
      </div>
      <button class="mon" :class="{ on: value.monitor }" @click="$emit('update', { monitor: !value.monitor })">
        <i :class="value.monitor ? 'pi pi-volume-up' : 'pi pi-volume-off'"></i>
        {{ value.monitor ? 'Monitoring' : 'Monitor off' }}
      </button>
    </div>
    <p v-if="value.monitor" class="hint">Hearing each note twice? Your interface's direct monitor is on too — turn one of them off.</p>

    <div class="knobs" :class="{ dim: !value.on }">
      <label v-for="k in KNOBS" :key="k.key" class="knob">
        <span class="k-name">{{ k.label }}</span>
        <input
          type="range"
          :min="k.min"
          :max="k.max"
          :step="k.step"
          :value="value[k.key]"
          :disabled="!value.on"
          @input="$emit('update', { [k.key]: +$event.target.value })"
        />
        <span class="k-val">{{ k.fmt(value[k.key]) }}</span>
      </label>
    </div>

    <button class="flat" :disabled="!value.on" @click="$emit('update', FLAT)"><i class="pi pi-refresh"></i> Flat</button>
  </div>
</template>

<script setup>
defineProps({
  value: { type: Object, required: true },
  instrument: { type: String, default: 'bass' },
})
const emit = defineEmits(['update', 'instrument'])

const pct = (v) => `${Math.round(v * 100)}%`
const dbf = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`

const KNOBS = [
  { key: 'gain', label: 'Gain', min: 0, max: 2, step: 0.02, fmt: (v) => `${v.toFixed(2)}×` },
  { key: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'compress', label: 'Comp', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'bass', label: 'Bass', min: -12, max: 12, step: 0.5, fmt: dbf },
  { key: 'mid', label: 'Mid', min: -12, max: 12, step: 0.5, fmt: dbf },
  { key: 'treble', label: 'Treble', min: -12, max: 12, step: 0.5, fmt: dbf },
  { key: 'level', label: 'Level', min: 0, max: 1.6, step: 0.02, fmt: pct },
]

const FLAT = { gain: 1, drive: 0, compress: 0, bass: 0, mid: 0, treble: 0, level: 0.8 }

function pick(inst) {
  emit('instrument', inst)
  emit('update', { on: true })
}
</script>

<style scoped>
.amp {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.seg {
  display: inline-flex;
  padding: 0.15rem;
  gap: 0.15rem;
  border-radius: 0.6rem;
  background: var(--bg);
  border: 1px solid var(--border);
}

.seg button {
  height: 2rem;
  padding: 0 0.85rem;
  border-radius: 0.45rem;
  font-weight: 700;
  font-size: 0.82rem;
  color: var(--text-dim);
}

.seg button.on {
  background: var(--bg-raised);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.mon {
  margin-left: auto;
  height: 2.2rem;
  padding: 0 0.85rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-weight: 700;
  font-size: 0.82rem;
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.mon.on {
  border-color: #16a34a;
  color: #4ade80;
}

.hint {
  margin: -0.4rem 0 0;
  font-size: 0.78rem;
  color: var(--text-faint);
}

.knobs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: 0.55rem 1.2rem;
}

.knobs.dim {
  opacity: 0.4;
}

.knob {
  display: grid;
  grid-template-columns: 3.4rem 1fr 3.6rem;
  align-items: center;
  gap: 0.5rem;
}

.k-name {
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.knob input {
  width: 100%;
  accent-color: var(--accent-500);
}

.k-val {
  text-align: right;
  font-size: 0.76rem;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.flat {
  align-self: flex-start;
  height: 2rem;
  padding: 0 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.flat:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-dim);
}
</style>
