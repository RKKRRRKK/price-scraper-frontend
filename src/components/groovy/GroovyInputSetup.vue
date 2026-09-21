<!-- File: src/components/groovy/GroovyInputSetup.vue -->
<!--
  Everything between the bass and the numbers: which input, which channel, how
  eagerly to call something an attack, and how much latency to subtract.

  The detector settings are shown against a live level bar rather than as bare
  numbers, because "0.008" means nothing but "the gate marker sits just under
  where my playing reaches" means everything.

  The offset is the honest part of this panel. Between the interface, the OS and
  the browser there is a fixed delay that would otherwise show up as a constant
  "you drag by 20 ms". Calibration measures it by having you play along with the
  click and taking the median — which also absorbs your own resting bias, so the
  panel says so rather than pretending it is pure physics.
-->
<template>
  <div class="setup">
    <div class="setup-head">
      <span class="setup-title"><i class="pi pi-sliders-h"></i> Input</span>
      <span v-if="opened" class="setup-state ok"><i class="pi pi-check-circle"></i> Open</span>
      <span v-else class="setup-state"><i class="pi pi-circle"></i> Closed</span>
    </div>

    <p v-if="error" class="setup-error"><i class="pi pi-times-circle"></i> {{ error }}</p>

    <button v-if="!opened" class="primary-btn" @click="$emit('open', null)">
      <i class="pi pi-microphone"></i> Enable audio input
    </button>

    <template v-else>
      <label class="field">
        <span class="f-label">Device</span>
        <select :value="deviceId" @change="$emit('open', $event.target.value)">
          <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">{{ d.label }}</option>
        </select>
      </label>

      <label v-if="channelCount > 1" class="field">
        <span class="f-label">Channel</span>
        <select :value="channelIndex" @change="$emit('channel', +$event.target.value)">
          <option v-for="n in channelCount" :key="n" :value="n - 1">Input {{ n }}</option>
        </select>
      </label>
      <p v-else class="f-hint">Mono input — nothing to choose.</p>

      <!-- Live level with the gate drawn on it. -->
      <div class="gate-wrap">
        <div class="gate-bar">
          <div class="gate-fill" :style="{ width: pos(level) + '%' }"></div>
          <div class="gate-floor" :style="{ width: pos(floor) + '%' }"></div>
          <div class="gate-mark" :style="{ left: pos(gate) + '%' }"></div>
        </div>
        <div class="gate-legend">
          <span><i class="sw sw-level"></i> playing</span>
          <span><i class="sw sw-floor"></i> background</span>
          <span><i class="sw sw-gate"></i> gate</span>
        </div>
      </div>

      <label class="knob">
        <span class="k-name">Gate</span>
        <input
          type="range"
          min="0.001"
          max="0.06"
          step="0.001"
          :value="gate"
          @input="$emit('update', { gate: +$event.target.value })"
        />
        <span class="k-val">{{ gate.toFixed(3) }}</span>
      </label>

      <label class="knob">
        <span class="k-name">Sensitivity</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="sensitivity"
          @input="$emit('update', { sensitivity: +$event.target.value })"
        />
        <span class="k-val">{{ Math.round(sensitivity * 100) }}%</span>
      </label>

      <label class="knob">
        <span class="k-name">Min gap</span>
        <input
          type="range"
          min="30"
          max="200"
          step="5"
          :value="refractoryMs"
          @input="$emit('update', { refractoryMs: +$event.target.value })"
        />
        <span class="k-val">{{ refractoryMs }} ms</span>
      </label>
      <p class="f-hint">
        Two notes closer together than the minimum gap read as one. Drop it for fast
        sixteenths; raise it if one note registers twice.
      </p>

      <!-- Offset / calibration -->
      <div class="offset">
        <!-- Typed, not just dragged. The number that belongs here is a measured
             one, and no slider lands on a tenth of a millisecond by hand. -->
        <div class="offset-row">
          <span class="k-name">Offset</span>
          <span class="offset-field">
            <input
              v-model="offsetDraft"
              type="number"
              inputmode="decimal"
              min="-100"
              max="1200"
              step="0.1"
              aria-label="Latency offset in milliseconds"
              @blur="commitOffset"
              @keydown.enter="commitOffset"
            />
            <span class="offset-unit">ms</span>
          </span>
        </div>

        <!-- The coarse control, for feeling out a value rather than entering
             one. It reaches 600 ms because browser round trips genuinely do on
             Windows — and stretches further when the current offset is already
             past that, so dragging it can never silently truncate a measured
             number the field accepted. -->
        <input
          type="range"
          min="-100"
          :max="sliderMax"
          step="0.5"
          :value="offsetMs"
          aria-label="Latency offset, coarse"
          @input="$emit('update', { offsetMs: +$event.target.value })"
        />

        <button
          class="cal-btn"
          :class="{ busy: calibrating }"
          @click="$emit(calibrating ? 'cancel-calibrate' : 'calibrate')"
        >
          <i :class="calibrating ? 'pi pi-times' : 'pi pi-compass'"></i>
          {{ calibrating ? `Stop (${calibrationCount}/${calibrationTarget})` : 'Calibrate' }}
        </button>

        <p v-if="calibrating" class="f-hint">
          The metronome is paused. Play one note on each slow click —
          {{ calibrationTarget - calibrationCount }} to go.
        </p>

        <template v-else-if="lastCalibration">
          <p class="f-hint">
            Last run: {{ lastCalibration.n }} notes kept<template
              v-if="lastCalibration.skipped || lastCalibration.rejected"
            >
              ({{ lastCalibration.skipped }} settling in<template v-if="lastCalibration.rejected"
                >, {{ lastCalibration.rejected }} rejected</template
              >)</template
            >, median {{ lastCalibration.medianMs.toFixed(1) }} ms, spread ±{{
              lastCalibration.sdMs.toFixed(1)
            }} ms.
          </p>

          <!-- The individual readings. A tight cluster means the offset is
               trustworthy; a scattered one means it is not, whatever the
               median says, and that is worth seeing rather than being told. -->
          <div v-if="lastCalibration.values?.length" class="cal-dots">
            <span
              v-for="(v, i) in lastCalibration.values"
              :key="i"
              class="cal-dot"
              :class="{ off: Math.abs(v - lastCalibration.medianMs) > 30 }"
              :style="{ left: dotPos(v) + '%' }"
              :title="`Note ${i + 1}: ${v.toFixed(1)} ms`"
            ></span>
            <span class="cal-centre" :style="{ left: dotPos(lastCalibration.medianMs) + '%' }"></span>
          </div>
          <p v-if="lastCalibration.nearLimit" class="cal-warn">
            <i class="pi pi-exclamation-triangle"></i>
            {{ lastCalibration.medianMs.toFixed(0) }} ms is close to the
            {{ lastCalibration.measurableMs.toFixed(0) }} ms this run can resolve, so the true
            delay may be larger still. Worth fixing at the source — see the notes below.
          </p>
          <p v-else-if="lastCalibration.suspect || lastCalibration.sdMs > 30" class="cal-warn">
            <i class="pi pi-exclamation-triangle"></i>
            <template v-if="lastCalibration.suspect">
              That offset came out of fewer than half the notes you played — the rest were too
              far off to use. Worth running again.
            </template>
            <template v-else>
              Those readings are too scattered to trust. Run it again, slower, and play right on
              the click.
            </template>
          </p>
        </template>

        <p v-else class="f-hint">
          Subtracted from every hit. Calibration plays {{ calibrationTarget }} clicks, asks you
          to land on each one, and takes a robust median — so it removes your own resting bias
          along with the system's latency. Nudge it by hand if you'd rather keep your feel.
        </p>
      </div>

      <!-- Measuring the machine on its own, with no player in the loop. -->
      <div class="loop">
        <div class="offset-row">
          <span class="k-name">Loopback test</span>
          <button
            class="cal-btn"
            :class="{ busy: probeRunning }"
            @click="$emit(probeRunning ? 'loopback-stop' : 'loopback-start')"
          >
            <i :class="probeRunning ? 'pi pi-times' : 'pi pi-sync'"></i>
            {{ probeRunning ? `Stop (${probeCount}/${probeTarget})` : 'Run' }}
          </button>
        </div>

        <p v-if="probeRunning" class="f-hint">
          Playing {{ probeTarget }} pulses and listening for them coming back. Don't play.
        </p>

        <template v-else-if="probeResult && !probeResult.failed">
          <p v-if="probeResult.ghosts" class="cal-warn">
            <i class="pi pi-exclamation-triangle"></i>
            <b>Unverified.</b> {{ probeResult.ghosts }} detection<template
              v-if="probeResult.ghosts > 1"
              >s</template
            >
            landed in slots where the test deliberately played nothing, so something other than
            these pulses is reaching the detector. Treat the number below as unproven.
          </p>
          <div class="diag-row">
            <span>Round trip</span>
            <b>{{ probeResult.roundTripMs.toFixed(1) }} ms</b>
          </div>
          <div class="diag-row">
            <span>Jitter</span>
            <b :class="{ mismatch: probeResult.jitterMs > 8 }">
              ±{{ probeResult.jitterMs.toFixed(1) }} ms
            </b>
          </div>
          <p class="f-hint">
            From {{ probeResult.n }} pulses, with the silent control slots
            {{ probeResult.ghosts ? 'CONTAMINATED' : 'clean' }}.
            <b>Jitter is the number that matters</b>, and under ~5 ms is clean.
          </p>

          <button class="primary-btn small" @click="$emit('loopback-apply')">
            <i class="pi pi-check"></i> Use {{ probeResult.roundTripMs.toFixed(0) }} ms as the offset
          </button>
          <p class="f-hint">Then set the input back to your instrument channel.</p>
        </template>

        <p v-else-if="probeResult?.failed" class="cal-warn">
          <i class="pi pi-exclamation-triangle"></i>
          Nothing came back. Check the routing below.
        </p>

        <!-- Every measurement this session, so drift between runs is something
             you can see rather than something you have to remember. -->
        <div v-if="measureLog.length > 1" class="log">
          <div class="log-head">Recent measurements</div>
          <div v-for="(m, i) in measureLog" :key="m.at" class="log-row">
            <span class="log-kind">{{ m.kind }}</span>
            <span class="log-ms">{{ m.ms.toFixed(1) }} ms</span>
            <span class="log-jit">±{{ m.jitterMs.toFixed(1) }}</span>
            <span v-if="i === 0" class="log-tag">latest</span>
          </div>
        </div>

        <details class="latency-help">
          <summary>How to set this up</summary>
          <p>
            This plays a pulse and listens for the app's own pulse returning through the
            interface, so it measures the round trip with no ears and no hands in the loop —
            far more precise than tapping along, and it gives you the jitter too.
          </p>
          <p>
            <b>Chrome only exposes the first two channels</b> of a multichannel interface, so a
            loopback sitting on channel 5 cannot be selected there at any price. <b>Firefox lists
            every channel</b> — run the test there and pick the loopback input directly. In Chrome
            it has to be routed onto inputs 1–2, or come in on a cable (below).
          </p>
          <ol>
            <li>Route the output mix to <b>Loopback</b> (mixer destinations).</li>
            <li>
              On the interface's <b>routing</b> page, point recording inputs <b>1–2 at
              Loopback</b> instead of the analogue inputs.
            </li>
            <li>Reopen the device above so the app re-reads the stream, then run the test. The
              level bar should twitch once per pulse.</li>
            <li>Apply the offset.</li>
            <li>
              Put the routing back to the analogue inputs, and re-enable whichever output
              carries your speakers or headphones — the click lives on that path too.
            </li>
          </ol>
          <p>
            Digital loopback cannot see the converters either side of the analogue world, worth
            a millisecond or two. Everything else is the path a real note takes.
          </p>
          <p>
            <b>No reachable loopback?</b> Many interfaces put it on a channel a browser can't
            get to, and some have no input routing to move it. A cable does the same job and
            does it better, because it goes through the converters too: send a mix to a physical
            output, patch that output into input 1, set that input to <b>line level</b> (not
            instrument), and run the test with the gain low. Bring it up until the pulses
            register without pinning the meter.
          </p>
        </details>
      </div>

      <!-- What is actually knowable about the round trip. -->
      <div v-if="diagnostics" class="diag">
        <!-- Split, because the two mean different things. baseLatency is the
             buffer the browser chose for its own graph; outputLatency is
             everything past it, down through Windows to the device. A fat
             baseLatency is the browser's doing; a fat outputLatency is not. -->
        <div class="diag-row">
          <span>Graph buffer</span>
          <b v-if="diagnostics.outputKnown">{{ diagnostics.baseMs.toFixed(1) }} ms</b>
          <b v-else class="unknown">not reported</b>
        </div>
        <div class="diag-row">
          <span>Output device</span>
          <b v-if="diagnostics.outputKnown">{{ diagnostics.outputMs.toFixed(1) }} ms</b>
          <b v-else class="unknown">not reported</b>
        </div>
        <div class="diag-row">
          <span>Measured total</span>
          <b v-if="measured">
            {{ measured.ms.toFixed(1) }} ms
            <span class="from">{{ measured.from }}</span>
          </b>
          <b v-else class="unknown">not measured yet</b>
        </div>
        <div class="diag-row">
          <span>Input path</span>
          <b v-if="inputPathMs != null">{{ inputPathMs.toFixed(1) }} ms</b>
          <b v-else class="unknown">needs both of the above</b>
        </div>
        <div class="diag-row">
          <span>Sample rate</span>
          <b :class="{ mismatch: rateMismatch }">
            {{ (diagnostics.ctxSampleRate / 1000).toFixed(1) }}k<template v-if="rateMismatch">
              vs {{ (diagnostics.deviceSampleRate / 1000).toFixed(1) }}k</template>
          </b>
        </div>
        <p v-if="rateMismatch" class="cal-warn">
          <i class="pi pi-exclamation-triangle"></i>
          The interface and the browser are running at different rates, so everything is being
          resampled. Set both to the same rate in Windows sound settings.
        </p>

        <details class="latency-help">
          <summary>Why is it this slow?</summary>
          <p>
            A browser reaches the sound card through WASAPI, <b>not ASIO</b> — so the
            interface's ASIO buffer size has no effect here at all. 60–120 ms round trip is
            normal for a browser, and normal is fine: it's constant, so the offset removes it.
          </p>
          <p>Past about 200 ms something is wrong. In order of likelihood:</p>
          <ol>
            <li>
              <b>Windows is playing back through something else.</b> The browser renders to the
              <i>default playback device</i>, whatever you're recording from. If that's the
              laptop speakers, HDMI or anything Bluetooth, you get its latency plus a drift
              buffer, because capture and playback are then on two clocks. Make the interface
              the default for <b>both</b> playback and recording.
            </li>
            <li>
              <b>Mismatched sample rates</b>, shown above — same rate on both sides of Windows'
              device properties.
            </li>
            <li>
              <b>Bluetooth headphones.</b> They add 150–300 ms on their own and cannot be
              calibrated away in any useful sense. Wired, for this.
            </li>
            <li>
              <b>The interface's own Windows driver</b> — the biggest effect measured so far. A
              vendor driver that offers no low-latency shared-mode period makes the browser fall
              back to a padded buffer: on a Scarlett 4i4, Focusrite's driver measured ~290 ms and
              Microsoft's built-in USB Audio 2.0 class driver ~70–90 ms, same cable, same
              settings. Swapping costs the vendor's mixer, loopback and ASIO; hardware direct
              monitoring still works.
            </li>
          </ol>
          <p>
            Monitoring through the interface's own direct-monitor knob is always instant — but
            then you're not hearing the amp, and the offset still applies to the measurements.
          </p>
        </details>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  devices: { type: Array, default: () => [] },
  deviceId: { type: String, default: null },
  channelCount: { type: Number, default: 1 },
  channelIndex: { type: Number, default: 0 },
  opened: { type: Boolean, default: false },
  error: { type: String, default: '' },
  level: { type: Number, default: 0 },
  floor: { type: Number, default: 0 },
  gate: { type: Number, default: 0.008 },
  sensitivity: { type: Number, default: 0.55 },
  refractoryMs: { type: Number, default: 60 },
  offsetMs: { type: Number, default: 0 },
  calibrating: { type: Boolean, default: false },
  calibrationCount: { type: Number, default: 0 },
  calibrationTarget: { type: Number, default: 8 },
  lastCalibration: { type: Object, default: null },
  // { ctxSampleRate, deviceSampleRate, baseMs, outputMs, inputHintMs }
  diagnostics: { type: Object, default: null },
  probeRunning: { type: Boolean, default: false },
  probeCount: { type: Number, default: 0 },
  probeTarget: { type: Number, default: 8 },
  // { roundTripMs, jitterMs, n, rejected, nearLimit, failed }
  probeResult: { type: Object, default: null },
  // { ms, from } — the best round trip actually measured, or null.
  measured: { type: Object, default: null },
  // [{ ms, jitterMs, kind, at }], newest first.
  measureLog: { type: Array, default: () => [] },
})
const emit = defineEmits([
  'open',
  'channel',
  'update',
  'calibrate',
  'cancel-calibrate',
  'loopback-start',
  'loopback-stop',
  'loopback-apply',
])

// ── The typed offset ────────────────────────────────────────────────────────
// The field owns a draft string and `v-model` keeps that draft in step with
// every keystroke. That is load-bearing, not ceremony: this panel re-renders
// about fifty times a second because the level meter is a live prop, and Vue
// re-syncs an input's DOM value from its binding on every one of those
// renders. A binding that did not track what is being typed would wipe each
// character roughly 20 ms after it was pressed, which is exactly what it did.
//
// Parsing waits for Enter or for the field to lose focus. "269.1" passes
// through 2 and 26 on the way, and applying those as offsets would be noise.
const offsetDraft = ref(props.offsetMs.toFixed(1))

// A change from elsewhere — calibration, the loopback test's apply button, the
// slider — is the one thing allowed to overwrite the draft.
watch(
  () => props.offsetMs,
  (v) => {
    offsetDraft.value = v.toFixed(1)
  },
)

function commitOffset() {
  const v = parseFloat(offsetDraft.value)
  // Unparseable, an emptied field most likely, puts the old number back rather
  // than silently becoming zero: zero is a plausible-looking offset and a
  // wrong one.
  if (!Number.isFinite(v)) {
    offsetDraft.value = props.offsetMs.toFixed(1)
    return
  }
  const clamped = Math.max(-100, Math.min(1200, Math.round(v * 10) / 10))
  offsetDraft.value = clamped.toFixed(1)
  if (clamped !== props.offsetMs) emit('update', { offsetMs: clamped })
}

// Keeps the slider's right-hand end past whatever the field currently holds.
const sliderMax = computed(() => Math.max(600, Math.ceil(props.offsetMs / 100) * 100))

// Square-root scaling: the interesting part of a bass signal is all down at the
// bottom of a linear scale.
function pos(v) {
  return Math.min(100, Math.sqrt(Math.max(0, v) / 0.08) * 100)
}

// Where a single calibration reading sits on the strip, on a ±100 ms scale
// around the median it produced.
function dotPos(v) {
  const centre = props.lastCalibration?.medianMs ?? 0
  return Math.max(1, Math.min(99, 50 + ((v - centre) / 200) * 100))
}

// Only derivable when the browser reported its output path *and* something has
// actually been measured. Guessing either one would make this line fiction.
const inputPathMs = computed(() => {
  const d = props.diagnostics
  if (!d?.outputKnown || !props.measured) return null
  return Math.max(0, props.measured.ms - d.baseMs - d.outputMs)
})

const rateMismatch = computed(() => {
  const d = props.diagnostics
  if (!d?.deviceSampleRate || !d?.ctxSampleRate) return false
  return Math.abs(d.deviceSampleRate - d.ctxSampleRate) > 1
})
</script>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.85rem;
  background: var(--bg-card, #fff);
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.04));
}

.setup-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.setup-title {
  font-size: 0.8rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.setup-title i {
  color: var(--accent-500, #ef4444);
  font-size: 0.82rem;
}

.setup-state {
  margin-left: auto;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-faint, #9a9a9a);
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.setup-state.ok {
  color: #166534;
}

.setup-error {
  margin: 0;
  display: flex;
  gap: 0.4rem;
  font-size: 0.7rem;
  line-height: 1.45;
  color: #991b1b;
  background: var(--accent-050, #fef2f2);
  border: 1px solid var(--accent-100, #fee2e2);
  border-radius: 0.5rem;
  padding: 0.4rem 0.5rem;
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  height: 2.2rem;
  border-radius: 0.5rem;
  background: var(--accent-500, #ef4444);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
}

.primary-btn:hover {
  background: var(--accent-600, #b91c1c);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.f-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint, #9a9a9a);
}

.field select {
  height: 1.9rem;
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 0.4rem;
  background: #fff;
  padding: 0 0.4rem;
  font-size: 0.76rem;
  max-width: 100%;
}

.f-hint {
  margin: 0;
  font-size: 0.66rem;
  line-height: 1.5;
  color: var(--text-faint, #9a9a9a);
}

.gate-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.gate-bar {
  position: relative;
  height: 0.6rem;
  border-radius: 999px;
  background: var(--bg-sunken, #f3f2f0);
  overflow: hidden;
}

.gate-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: #2a78d6;
  transition: width 60ms linear;
}

.gate-floor {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgba(26, 26, 26, 0.25);
}

.gate-mark {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--accent-500, #ef4444);
}

.gate-legend {
  display: flex;
  gap: 0.6rem;
  font-size: 0.62rem;
  color: var(--text-faint, #9a9a9a);
}

.gate-legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
}

.sw {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 2px;
  display: inline-block;
}

.sw-level {
  background: #2a78d6;
}

.sw-floor {
  background: rgba(26, 26, 26, 0.25);
}

.sw-gate {
  background: var(--accent-500, #ef4444);
}

.knob {
  display: grid;
  grid-template-columns: 4.6rem 1fr 3.2rem;
  align-items: center;
  gap: 0.45rem;
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

.knob input[type='range'],
.offset input[type='range'] {
  width: 100%;
  accent-color: var(--accent-500, #ef4444);
  cursor: pointer;
}

.offset {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-soft, #eeede9);
}

.offset-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.offset-field {
  margin-left: auto;
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
}

.offset-field input {
  width: 4.6rem;
  height: 1.7rem;
  padding: 0 0.35rem;
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 0.35rem;
  background: #fff;
  text-align: right;
  font-size: 0.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text, #1a1a1a);
}

.offset-field input:focus {
  outline: none;
  border-color: var(--accent-400, #f87171);
  box-shadow: 0 0 0 2px var(--accent-050, #fef2f2);
}

.offset-unit {
  font-size: 0.68rem;
  color: var(--text-faint, #9a9a9a);
}


.log {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.4rem 0.5rem;
  border-radius: 0.5rem;
  background: var(--bg-sunken, #f3f2f0);
}

.log-head {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint, #9a9a9a);
}

.log-row {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  font-size: 0.66rem;
  font-variant-numeric: tabular-nums;
}

.log-kind {
  color: var(--text-faint, #9a9a9a);
  min-width: 7.5rem;
}

.log-ms {
  font-weight: 700;
  color: var(--text-dim, #5c5c5c);
}

.log-jit {
  color: var(--text-faint, #9a9a9a);
}

.log-tag {
  margin-left: auto;
  font-size: 0.6rem;
  color: var(--text-faint, #9a9a9a);
}

.cal-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 1.8rem;
  padding: 0 0.7rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border, #e5e4e1);
  background: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-dim, #5c5c5c);
}

.cal-btn:hover {
  border-color: var(--accent-400, #f87171);
  color: var(--accent-600, #b91c1c);
}

.cal-btn.busy {
  background: var(--accent-050, #fef2f2);
  border-color: var(--accent-500, #ef4444);
  color: var(--accent-600, #b91c1c);
}

/* Each calibration reading as a dot on a ±100 ms strip. Tight cluster = a
   trustworthy offset; scattered = the median is meaningless. */
.cal-dots {
  position: relative;
  height: 1.1rem;
  border-radius: 0.3rem;
  background: var(--bg-sunken, #f3f2f0);
}

.cal-dot {
  position: absolute;
  top: 50%;
  width: 0.4rem;
  height: 0.4rem;
  margin: -0.2rem 0 0 -0.2rem;
  border-radius: 999px;
  background: #2a78d6;
  box-shadow: 0 0 0 2px var(--bg-sunken, #f3f2f0);
}

.cal-dot.off {
  background: #e34948;
}

.cal-centre {
  position: absolute;
  top: 0.1rem;
  bottom: 0.1rem;
  width: 2px;
  margin-left: -1px;
  background: var(--text, #1a1a1a);
  opacity: 0.4;
}

.cal-warn {
  margin: 0;
  display: flex;
  gap: 0.35rem;
  font-size: 0.66rem;
  line-height: 1.45;
  color: #92400e;
  background: var(--warn-soft, #fffbeb);
  border: 1px solid #fde68a;
  border-radius: 0.45rem;
  padding: 0.35rem 0.45rem;
}

.cal-warn i {
  flex: none;
  margin-top: 0.1rem;
}

/* ── Latency breakdown ── */
.diag {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-soft, #eeede9);
}

.diag-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.68rem;
  color: var(--text-faint, #9a9a9a);
}

.diag-row b {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim, #5c5c5c);
}

.diag-row b.mismatch {
  color: #92400e;
}

.diag-row b.unknown {
  font-style: italic;
  font-weight: 500;
  color: var(--text-faint, #9a9a9a);
}

.diag-row .from {
  font-weight: 500;
  color: var(--text-faint, #9a9a9a);
  font-size: 0.62rem;
  margin-left: 0.3rem;
}

.loop {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-soft, #eeede9);
}

.loop .offset-row {
  align-items: center;
}

.loop .cal-btn {
  margin-left: auto;
}

.primary-btn.small {
  height: 1.9rem;
  font-size: 0.72rem;
}

.latency-help {
  font-size: 0.66rem;
  line-height: 1.5;
  color: var(--text-faint, #9a9a9a);
}

.latency-help summary {
  cursor: pointer;
  font-weight: 700;
  color: var(--text-dim, #5c5c5c);
  padding: 0.15rem 0;
}

.latency-help summary:hover {
  color: var(--accent-600, #b91c1c);
}

.latency-help p {
  margin: 0.35rem 0;
}

.latency-help ol {
  margin: 0.35rem 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.latency-help b {
  color: var(--text-dim, #5c5c5c);
}
</style>
