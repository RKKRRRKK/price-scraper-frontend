<!-- File: src/components/looper/LooperInput.vue -->
<!--
  Which input, which channel, where a note starts, and the sync.

  The sync is the round trip from the Looper's output to its input. Layers are
  kept raw, so moving it re-cuts every layer already recorded against the
  loop — it can be set by ear after the fact, and a stale value never costs a
  take.

  The level meter re-renders this panel ~50 times a second, so the one text
  field here is v-model-bound to a draft; binding it to the prop would wipe a
  number mid-typing (see Groovy's input panel for the same trap).
-->
<template>
  <div class="inp">
    <p v-if="error" class="err"><i class="pi pi-times-circle"></i> {{ error }}</p>

    <button v-if="!opened" class="primary" @click="$emit('open', null)">
      <i class="pi pi-microphone"></i> Enable audio input
    </button>

    <template v-else>
      <label class="field">
        <span class="lab">Device</span>
        <select :value="deviceId" @change="$emit('open', $event.target.value)">
          <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">{{ d.label }}</option>
        </select>
      </label>

      <label v-if="channelCount > 1" class="field">
        <span class="lab">Channel</span>
        <select :value="channelIndex" @change="$emit('channel', +$event.target.value)">
          <option v-for="n in channelCount" :key="n" :value="n - 1">Input {{ n }}</option>
        </select>
      </label>

      <div class="field">
        <span class="lab">Trigger</span>
        <div class="trig">
          <div class="meter">
            <div class="fill" :style="{ width: pos(level) + '%' }"></div>
            <div class="mark" :style="{ left: pos(gate) + '%' }"></div>
          </div>
          <input
            type="range"
            min="0.001"
            max="0.08"
            step="0.001"
            :value="gate"
            aria-label="Trigger level"
            @input="$emit('gate', +$event.target.value)"
          />
        </div>
      </div>
      <p class="hint">With Auto on, recording starts on the first note above the line.</p>

      <div class="field sync">
        <span class="lab">Sync</span>
        <div class="sync-row">
          <input
            type="range"
            min="0"
            max="600"
            step="1"
            :value="syncMs"
            aria-label="Sync in milliseconds"
            @input="$emit('sync', +$event.target.value)"
          />
          <span class="num">
            <input
              v-model="draft"
              type="number"
              min="0"
              max="1000"
              step="1"
              inputmode="numeric"
              @blur="commit"
              @keydown.enter="commit"
            />
            ms
          </span>
        </div>
      </div>
      <p class="hint">
        If overdubs land late, raise it until they sit on the beat — recorded layers move with it.
      </p>

      <button class="cal" :class="{ busy: calibrating }" @click="$emit(calibrating ? 'cancel' : 'calibrate')">
        <i :class="calibrating ? 'pi pi-times' : 'pi pi-compass'"></i>
        <template v-if="calibrating">Stop · {{ calibrating.heard }}/{{ calibrating.target }}</template>
        <template v-else>Measure it</template>
      </button>
      <p v-if="calibrating" class="hint">Play one short note on each click.</p>
      <p v-else-if="syncNote" class="hint">{{ syncNote }}</p>
    </template>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  opened: { type: Boolean, default: false },
  error: { type: String, default: '' },
  devices: { type: Array, default: () => [] },
  deviceId: { type: String, default: null },
  channelCount: { type: Number, default: 1 },
  channelIndex: { type: Number, default: 0 },
  level: { type: Number, default: 0 },
  gate: { type: Number, default: 0.008 },
  syncMs: { type: Number, default: 0 },
  syncNote: { type: String, default: '' },
  // { heard, target } while a measurement runs
  calibrating: { type: Object, default: null },
})
const emit = defineEmits(['open', 'channel', 'gate', 'sync', 'calibrate', 'cancel'])

// Meter scale: square-root, so quiet playing still moves the bar.
const pos = (v) => Math.min(100, Math.sqrt(Math.max(0, v) / 0.5) * 100)

const draft = ref(String(Math.round(props.syncMs)))
watch(
  () => props.syncMs,
  (v) => {
    draft.value = String(Math.round(v))
  },
)

function commit() {
  const v = Number(draft.value)
  if (Number.isFinite(v) && v >= 0 && v <= 1000) emit('sync', v)
  else draft.value = String(Math.round(props.syncMs))
}
</script>

<style scoped>
.inp {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.err {
  margin: 0;
  color: var(--accent-400);
  font-size: 0.85rem;
}

.primary {
  height: 2.75rem;
  border-radius: 0.7rem;
  background: var(--accent-500);
  color: #fff;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.field {
  display: grid;
  grid-template-columns: 4.5rem 1fr;
  align-items: center;
  gap: 0.75rem;
}

.lab {
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}

select {
  height: 2.2rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--bg);
  padding: 0 0.5rem;
  min-width: 0;
}

input[type='range'] {
  width: 100%;
  accent-color: var(--accent-500);
}

.trig {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.meter {
  position: relative;
  height: 0.6rem;
  border-radius: 999px;
  background: var(--bg);
  overflow: hidden;
}

.fill {
  height: 100%;
  background: linear-gradient(90deg, #16a34a, #84cc16 70%, #eab308);
  transition: width 60ms linear;
}

.mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent-400);
}

.hint {
  margin: -0.35rem 0 0 5.25rem;
  font-size: 0.78rem;
  color: var(--text-faint);
  line-height: 1.4;
}

.sync-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.num {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: var(--text-dim);
}

.num input {
  width: 4.2rem;
  height: 2rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border);
  background: var(--bg);
  padding: 0 0.4rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cal {
  align-self: flex-start;
  margin-left: 5.25rem;
  height: 2.2rem;
  padding: 0 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-weight: 700;
  font-size: 0.82rem;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.cal:hover {
  border-color: var(--text-dim);
}

.cal.busy {
  border-color: var(--accent-500);
  color: var(--accent-400);
}

@media (max-width: 767.98px) {
  .field {
    grid-template-columns: 1fr;
    gap: 0.35rem;
  }

  .hint,
  .cal {
    margin-left: 0;
  }
}
</style>
