<!-- File: src/components/groovy/GroovyAmp.vue -->
<!--
  The amp panel. Deliberately small: a gain stage, a parallel drive, a three-band
  tone stack and a level, which is everything a DI'd bass needs to be pleasant to
  practise through and nothing it doesn't.

  Monitoring is the one control that can bite, so it is the one control that
  isn't a slider: a switch that says what it does, with a warning when the input
  looks like a built-in microphone (speakers + open mic means the metronome
  feeds straight back into the detector and scores itself as perfect playing).
-->
<template>
  <div class="amp">
    <div class="amp-head">
      <span class="amp-title"><i class="pi pi-volume-up"></i> Amp</span>
      <button
        class="monitor-btn"
        :class="{ on: value.monitor }"
        @click="set('monitor', !value.monitor)"
      >
        <i :class="value.monitor ? 'pi pi-volume-up' : 'pi pi-volume-off'"></i>
        {{ value.monitor ? 'Monitoring' : 'Muted' }}
      </button>
    </div>

    <!-- The interface's own direct monitor and this amp are two separate paths
         to the same ears. Direct monitor is instant; this one has been round
         the browser first. Both on at once sounds like a delay but is really a
         doubling, and it is the single most confusing thing about the tool.
         Once the round trip has actually been measured, say the number:
         "70 ms behind your hands" is a decision, "some latency" is a shrug. -->
    <!-- The Windows helper. Three states: connected (and carrying the monitor),
         wanted but not running, or switched off. Only shown on Windows, since
         it has nothing to offer a Mac. -->
    <div v-if="nativeAvailable" class="native" :class="{ on: !!nativeInfo }">
      <span class="native-dot"></span>
      <span class="native-text">
        <template v-if="nativeInfo">
          <b>Native</b> · {{ String(nativeInfo.backend).toUpperCase() }} ·
          {{ nativeInfo.bufferFrames }} frames ·
          <template v-if="nativeLoopback?.ok">
            <b>{{ nativeLoopback.ms.toFixed(1) }} ms</b> measured ±{{ nativeLoopback.jitterMs.toFixed(1) }}
          </template>
          <template v-else>~{{ Math.round(nativeInfo.roundTripMs) }} ms est.</template>
          <template v-if="nativeXruns"> · {{ nativeXruns }} dropouts</template>
        </template>
        <template v-else-if="nativeEnabled">
          Native helper not running. Start <code>groovy-monitor</code> to monitor through
          ASIO or low-latency WASAPI.
        </template>
        <template v-else>Native helper off.</template>
      </span>
      <button
        v-if="nativeInfo"
        class="native-btn"
        title="Play a short tone from the helper's own output — if you hear it, the native path is live"
        @click="$emit('test')"
      >
        Test
      </button>
      <button
        v-if="nativeInfo"
        class="native-btn"
        :disabled="nativeProbing"
        title="Measure the round trip through the helper. Loop an output back into the input first (a cable, or the interface's loopback channel), and don't play."
        @click="$emit('loopback')"
      >
        {{ nativeProbing ? '…' : 'Measure' }}
      </button>
      <button class="native-btn" :title="nativeEnabled ? 'Stop looking for the helper' : 'Look for the helper'" @click="$emit('native', !nativeEnabled)">
        {{ nativeEnabled ? 'Off' : 'On' }}
      </button>
    </div>

    <p v-if="value.monitor" class="amp-note">
      <i class="pi pi-info-circle"></i>
      <span>
        <template v-if="monitorDelayMs != null">
          <template v-if="nativeInfo">Through the native helper, this</template
          ><template v-else>This</template>
          path is about <b>{{ Math.round(monitorDelayMs) }} ms</b> behind your hands<template
            v-if="monitorDelayMs > LATE_MS"
            >, which is enough to pull your timing. For playing, mute this and use the interface's
            <b>direct monitor</b> — the timing numbers don't care which one you listen to. Both on
            at once is the same note twice, not lag.</template
          ><template v-else
            >, close enough to play through. If you hear the note twice, the interface's
            <b>direct monitor</b> is on as well.</template
          >
        </template>
        <template v-else>
          Hearing the bass twice? That's the interface's <b>direct monitor</b> alongside this amp.
          Turn direct monitor off to hear only the amp — or leave it on, mute this, and let Groovy
          just do the timing. Direct monitor is always going to be the faster of the two.
        </template>
      </span>
    </p>

    <p v-if="value.monitor && risky" class="amp-warn">
      <i class="pi pi-exclamation-triangle"></i>
      That input looks like a microphone rather than an instrument on a cable. Monitoring
      through speakers would let the click back into the detector, which then scores itself as
      perfect timing — use headphones for this one.
    </p>

    <div class="meter" :title="`Input ${Math.round(meterLevel * 100)}%`">
      <div class="meter-fill" :style="{ width: Math.min(100, meterLevel * 140) + '%' }"></div>
      <div class="meter-peak" :style="{ left: Math.min(100, peakHold * 140) + '%' }"></div>
    </div>

    <div class="knobs">
      <label class="knob">
        <span class="k-name">Gain</span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.02"
          :value="value.gain"
          @input="set('gain', +$event.target.value)"
        />
        <span class="k-val">{{ value.gain.toFixed(2) }}×</span>
      </label>

      <label class="knob">
        <span class="k-name">Drive</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="value.drive"
          @input="set('drive', +$event.target.value)"
        />
        <span class="k-val">{{ Math.round(value.drive * 100) }}%</span>
      </label>

      <label class="knob">
        <span class="k-name">Comp</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="value.compress"
          @input="set('compress', +$event.target.value)"
        />
        <span class="k-val">{{ Math.round(value.compress * 100) }}%</span>
      </label>
    </div>

    <div class="tone">
      <label v-for="b in BANDS" :key="b.key" class="knob">
        <span class="k-name">{{ b.label }}</span>
        <input
          type="range"
          min="-12"
          max="12"
          step="0.5"
          :value="value[b.key]"
          @input="set(b.key, +$event.target.value)"
        />
        <span class="k-val">{{ value[b.key] > 0 ? '+' : '' }}{{ value[b.key].toFixed(1) }} dB</span>
      </label>
    </div>

    <label class="knob knob-wide">
      <span class="k-name">Level</span>
      <input
        type="range"
        min="0"
        max="1.6"
        step="0.02"
        :value="value.level"
        @input="set('level', +$event.target.value)"
      />
      <span class="k-val">{{ Math.round(value.level * 100) }}%</span>
    </label>

    <button class="flat-btn" @click="reset">
      <i class="pi pi-refresh"></i> Flat
    </button>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  value: { type: Object, required: true },
  outLevel: { type: Number, default: 0 },
  risky: { type: Boolean, default: false },
  // The measured round trip through this amp, or null when nothing has been
  // measured this session. The loopback test and the amp monitor path go
  // through the same input and output buffers, so the one number is the other.
  monitorDelayMs: { type: Number, default: null },
  // The Windows native helper: is it relevant here, wanted, connected, and
  // what is it hearing. See lib/groovy/nativeMonitor.js.
  nativeAvailable: { type: Boolean, default: false },
  nativeEnabled: { type: Boolean, default: true },
  nativeInfo: { type: Object, default: null },
  nativeLevel: { type: Number, default: 0 },
  nativeXruns: { type: Number, default: 0 },
  nativeProbing: { type: Boolean, default: false },
  // { ok, ms, jitterMs, n, misses } from the helper's own loopback test.
  nativeLoopback: { type: Object, default: null },
})
const emit = defineEmits(['update', 'native', 'test', 'loopback'])

// Whoever is monitoring feeds the meter.
const meterLevel = computed(() => (props.nativeInfo ? props.nativeLevel : props.outLevel))

// Where hearing yourself late starts to pull your timing. Delayed auditory
// feedback is disruptive from roughly 20 ms; direct-monitor paths are ~0.
const LATE_MS = 20

const BANDS = [
  { key: 'bass', label: 'Bass' },
  { key: 'mid', label: 'Mid' },
  { key: 'treble', label: 'Treble' },
]

function set(key, v) {
  emit('update', { [key]: v })
}

function reset() {
  emit('update', { bass: 0, mid: 0, treble: 0, drive: 0, compress: 0, gain: 1, level: 0.8 })
}

// A peak that falls back slowly, so a transient is visible for long enough to
// see that it clipped.
const peakHold = ref(0)
let decay = 0
watch(
  meterLevel,
  (v) => {
    if (v > peakHold.value) {
      peakHold.value = v
      clearTimeout(decay)
      decay = setTimeout(() => {
        peakHold.value = 0
      }, 900)
    }
  },
)
</script>

<style scoped>
.amp {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.85rem;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.04));
}

.amp-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.amp-title {
  font-size: 0.8rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.amp-title i {
  color: var(--accent-500, #ef4444);
  font-size: 0.82rem;
}

.monitor-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 1.8rem;
  padding: 0 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border, #e5e4e1);
  background: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-dim, #5c5c5c);
}

.monitor-btn.on {
  background: var(--accent-050, #fef2f2);
  border-color: var(--accent-500, #ef4444);
  color: var(--accent-600, #b91c1c);
}

.amp-warn {
  margin: 0;
  display: flex;
  gap: 0.4rem;
  font-size: 0.7rem;
  line-height: 1.45;
  color: #92400e;
  background: var(--warn-soft, #fffbeb);
  border: 1px solid #fde68a;
  border-radius: 0.5rem;
  padding: 0.4rem 0.5rem;
}

.amp-warn i {
  flex: none;
  margin-top: 0.1rem;
}

.amp-note {
  margin: 0;
  display: flex;
  gap: 0.4rem;
  font-size: 0.68rem;
  line-height: 1.45;
  color: var(--text-dim, #5c5c5c);
  background: var(--bg-sunken, #f3f2f0);
  border-radius: 0.5rem;
  padding: 0.4rem 0.5rem;
}

.amp-note i {
  flex: none;
  margin-top: 0.15rem;
  color: var(--text-faint, #9a9a9a);
}

.amp-note b {
  color: var(--text, #1a1a1a);
}

.native {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.66rem;
  line-height: 1.45;
  color: var(--text-faint, #9a9a9a);
  padding: 0.35rem 0.5rem;
  border-radius: 0.5rem;
  background: var(--bg-sunken, #f3f2f0);
}

.native.on {
  color: var(--text-dim, #5c5c5c);
  background: var(--ok-soft, #dcfce7);
}

.native-dot {
  flex: none;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 999px;
  background: var(--text-faint, #9a9a9a);
  opacity: 0.5;
}

.native.on .native-dot {
  background: var(--ok, #16a34a);
  opacity: 1;
}

.native-text {
  flex: 1;
  min-width: 0;
}

.native-text b {
  color: var(--ok-ink, #166534);
}

.native-text code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.62rem;
}

.native-btn {
  flex: none;
  height: 1.4rem;
  padding: 0 0.5rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border, #e5e4e1);
  background: #fff;
  font-size: 0.64rem;
  font-weight: 700;
  color: var(--text-dim, #5c5c5c);
}

.native-btn:hover {
  border-color: var(--accent-400, #f87171);
  color: var(--accent-600, #b91c1c);
}

.meter {
  position: relative;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--bg-sunken, #f3f2f0);
  overflow: hidden;
}

.meter-fill {
  height: 100%;
  background: linear-gradient(90deg, #16a34a 0%, #16a34a 62%, #d97706 82%, #dc2626 100%);
  background-size: 14.5rem 100%;
  transition: width 60ms linear;
}

.meter-peak {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--text, #1a1a1a);
  opacity: 0.45;
}

.knobs,
.tone {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tone {
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-soft, #eeede9);
}

.knob {
  display: grid;
  grid-template-columns: 3.1rem 1fr 3.4rem;
  align-items: center;
  gap: 0.5rem;
}

.k-name {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-dim, #5c5c5c);
}

.k-val {
  font-size: 0.68rem;
  color: var(--text-faint, #9a9a9a);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.knob input[type='range'] {
  width: 100%;
  accent-color: var(--accent-500, #ef4444);
  cursor: pointer;
}

.knob-wide {
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-soft, #eeede9);
}

.flat-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  height: 1.6rem;
  padding: 0 0.55rem;
  border-radius: 0.4rem;
  border: 1px solid var(--border, #e5e4e1);
  background: #fff;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-dim, #5c5c5c);
}

.flat-btn:hover {
  border-color: var(--accent-400, #f87171);
  color: var(--accent-600, #b91c1c);
}
</style>
