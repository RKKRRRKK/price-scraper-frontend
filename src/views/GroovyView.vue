<!-- File: src/views/GroovyView.vue -->
<!--
  Groovy — metronome, timing trainer and a small bass amp.

  The whole tool rests on one idea: the click is scheduled at an exact
  AudioContext time, and the attack detector reports your notes on that same
  clock. Subtracting one from the other is therefore a real measurement rather
  than a guess, and everything on screen is a view of that one number.

  Layout is three columns — takes on the left, the practice surface in the
  middle, input and amp on the right — with the outer two collapsible so the
  roll can have the screen when you are actually playing.
-->
<template>
  <div class="groovy-app">
    <!-- ── Takes rail ── -->
    <aside class="rail" :class="{ open: railOpen }">
      <div class="rail-head">
        <div>
          <div class="eyebrow">Tools</div>
          <h1 class="rail-title">Groovy</h1>
          <div class="rail-sub">
            {{ store.takes.length }} {{ store.takes.length === 1 ? 'take' : 'takes' }}
          </div>
        </div>
        <button class="icon-btn mobile-only" @click="railOpen = false" title="Close">
          <i class="pi pi-times"></i>
        </button>
      </div>

      <div class="rail-list">
        <div v-if="store.loading && !store.takes.length" class="rail-state">
          <i class="pi pi-spin pi-spinner"></i>
        </div>
        <div v-else-if="!store.takes.length" class="rail-state">
          <i class="pi pi-bookmark rail-state-icon"></i>
          <span>No takes yet. Hit record while you play and the numbers get kept.</span>
        </div>

        <button
          v-for="t in store.takes"
          :key="t.id"
          class="take"
          :class="{ picked: store.compareIds.includes(t.id) }"
          @click="pickTake(t.id)"
        >
          <span class="take-chip" :style="chipStyle(t.id)"></span>
          <span class="take-body">
            <span class="take-name">{{ t.name }}</span>
            <span class="take-meta">
              {{ t.settings?.bpm }} bpm · {{ t.settings?.meterId }} ·
              {{ t.stats?.count || 0 }} notes
            </span>
            <span class="take-nums">
              <b>{{ fmt1(t.stats?.sdMs) }} ms</b> spread ·
              {{ Math.round(t.stats?.inPocketPct || 0) }}% in pocket
            </span>
          </span>
          <span class="take-actions">
            <span
              class="mini"
              title="Rename"
              @click.stop="startRename(t)"
            ><i class="pi pi-pencil"></i></span>
            <span
              class="mini danger"
              title="Delete"
              @click.stop="confirmDelete(t)"
            ><i class="pi pi-trash"></i></span>
          </span>
        </button>
      </div>

      <button v-if="store.compareCount" class="rail-clear" @click="store.clearCompare()">
        <i class="pi pi-times"></i> Clear selection ({{ store.compareCount }})
      </button>
    </aside>

    <!-- ── Stage ── -->
    <main class="stage">
      <!-- Transport -->
      <div class="tbar">
        <button class="rail-fab mobile-only" @click="railOpen = true" title="Takes">
          <i class="pi pi-bars"></i>
        </button>

        <button class="play" :class="{ on: running }" @click="toggleRun">
          <i :class="running ? 'pi pi-pause' : 'pi pi-play'"></i>
          {{ running ? 'Stop' : 'Start' }}
        </button>

        <div class="tempo">
          <button class="step" @click="nudgeBpm(-1)" title="Slower"><i class="pi pi-minus"></i></button>
          <input
            class="bpm"
            type="number"
            min="20"
            max="300"
            :value="p.bpm"
            @change="setPref({ bpm: clampBpm(+$event.target.value) })"
          />
          <button class="step" @click="nudgeBpm(1)" title="Faster"><i class="pi pi-plus"></i></button>
          <span class="tempo-unit">bpm</span>
          <button class="tap" @click="tap">Tap</button>
        </div>

        <input
          class="bpm-slider"
          type="range"
          min="40"
          max="220"
          step="1"
          :value="p.bpm"
          @input="setPref({ bpm: +$event.target.value })"
        />

        <label class="sel">
          <span class="sel-label">Meter</span>
          <select :value="p.meterId" @change="setMeter($event.target.value)">
            <option v-for="m in METERS" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </label>

        <div class="seg" role="group" aria-label="Grid subdivision">
          <button
            v-for="s in subdivOptions"
            :key="s.n"
            :class="{ on: p.subdiv === s.n }"
            :title="s.label"
            @click="setPref({ subdiv: s.n })"
          >
            {{ s.glyph }}
          </button>
        </div>

        <div class="tbar-spacer"></div>

        <button
          class="rec"
          :class="{ armed: armed, on: recording }"
          :disabled="!inputOpen"
          :title="inputOpen ? 'Record a take' : 'Enable the audio input first'"
          @click="toggleRecord"
        >
          <i class="pi pi-circle-fill"></i>
          <template v-if="recording">Stop · {{ takeHitCount }}</template>
          <template v-else-if="armed">Count-in {{ countInLeft }}</template>
          <template v-else>Record</template>
        </button>

        <button class="side-fab" @click="sideOpen = !sideOpen" title="Input & amp">
          <i class="pi pi-sliders-h"></i>
        </button>
      </div>

      <!-- Second row: what you hear -->
      <div class="tbar tbar-sub">
        <button class="chip" :class="{ on: p.clickOn }" @click="setPref({ clickOn: !p.clickOn })">
          <i class="pi pi-bell"></i> Click
        </button>
        <button
          class="chip"
          :class="{ on: p.clickSubdivisions }"
          :disabled="!p.clickOn || p.subdiv === 1"
          @click="setPref({ clickSubdivisions: !p.clickSubdivisions })"
        >
          Subdivisions
        </button>
        <input
          class="mini-slider"
          type="range"
          min="0"
          max="1.4"
          step="0.02"
          :value="p.clickLevel"
          :disabled="!p.clickOn"
          title="Click level"
          @input="setPref({ clickLevel: +$event.target.value })"
        />

        <span class="tb-div"></span>

        <button class="chip" :class="{ on: p.drumsOn }" @click="setPref({ drumsOn: !p.drumsOn })">
          <i class="pi pi-headphones"></i> Drums
        </button>
        <label class="sel" v-if="p.drumsOn">
          <select :value="patternId" @change="setPref({ patternId: $event.target.value })">
            <option v-for="pt in patterns" :key="pt.id" :value="pt.id">{{ pt.label }}</option>
          </select>
        </label>
        <input
          class="mini-slider"
          type="range"
          min="0"
          max="1.4"
          step="0.02"
          :value="p.drumLevel"
          :disabled="!p.drumsOn"
          title="Drum level"
          @input="setPref({ drumLevel: +$event.target.value })"
        />

        <span class="tb-div"></span>

        <label class="sel">
          <span class="sel-label">Tolerance</span>
          <select
            :value="p.toleranceMs"
            @change="setPref({ toleranceMs: +$event.target.value })"
          >
            <option :value="15">±15 ms — tight</option>
            <option :value="25">±25 ms — normal</option>
            <option :value="40">±40 ms — forgiving</option>
          </select>
        </label>

        <label class="sel">
          <span class="sel-label">Window</span>
          <select :value="p.windowBars" @change="setPref({ windowBars: +$event.target.value })">
            <option :value="1">1 bar</option>
            <option :value="2">2 bars</option>
            <option :value="4">4 bars</option>
          </select>
        </label>

        <label class="sel">
          <span class="sel-label">Count-in</span>
          <select :value="p.countInBars" @change="setPref({ countInBars: +$event.target.value })">
            <option :value="0">None</option>
            <option :value="1">1 bar</option>
            <option :value="2">2 bars</option>
          </select>
        </label>

        <button
          class="chip"
          :class="{ on: p.keepAudio }"
          :disabled="!canRecordAudio"
          title="Also keep the audio of each take"
          @click="setPref({ keepAudio: !p.keepAudio })"
        >
          <i class="pi pi-volume-up"></i> Keep audio
        </button>

        <div class="tbar-spacer"></div>

        <div class="modes">
          <button :class="{ on: view === 'practice' }" @click="view = 'practice'">Practice</button>
          <button :class="{ on: view === 'analysis' }" @click="view = 'analysis'">
            Analysis
            <span v-if="store.compareCount" class="badge">{{ store.compareCount }}</span>
          </button>
        </div>
      </div>

      <!-- Surface -->
      <div class="surface">
        <template v-if="view === 'practice'">
          <div class="roll-holder">
            <GroovyRoll
              :transport="transport"
              :hits="liveHits"
              :trace="trace"
              :tolerance-ms="p.toleranceMs"
              :window-bars="p.windowBars"
              :running="running"
              :recording="recording"
              :count-in-until="countInUntil"
            />
          </div>

          <!-- Live readout -->
          <div class="readout">
            <div class="ro-last" :class="lastClass">
              <span class="ro-num">
                <template v-if="last">{{ last.devMs > 0 ? '+' : '' }}{{ Math.round(last.devMs) }}</template>
                <template v-else>—</template>
              </span>
              <span class="ro-unit">ms</span>
              <span class="ro-word">{{ lastWord }}</span>
            </div>

            <div class="ro-stats">
              <div class="ro-stat">
                <span class="ro-k">Spread</span>
                <span class="ro-v">{{ fmt1(live.sdMs) }} ms</span>
              </div>
              <div class="ro-stat">
                <span class="ro-k">Feel</span>
                <span class="ro-v">
                  {{ live.meanMs > 0 ? '+' : '' }}{{ fmt1(live.meanMs) }} ms
                </span>
              </div>
              <div class="ro-stat">
                <span class="ro-k">In pocket</span>
                <span class="ro-v">{{ Math.round(live.inPocketPct) }}%</span>
              </div>
              <div class="ro-stat">
                <span class="ro-k">Notes</span>
                <span class="ro-v">{{ live.count }}</span>
              </div>
              <div class="ro-stat">
                <span class="ro-k">Bar</span>
                <span class="ro-v">{{ position }}</span>
              </div>
              <button class="ro-reset" @click="resetLive" title="Clear the running numbers">
                <i class="pi pi-refresh"></i>
              </button>
            </div>
          </div>
        </template>

        <GroovyTakeCompare v-else :slots="store.compared" @clear="store.clearCompare()" />
      </div>
    </main>

    <!-- ── Input & amp ── -->
    <aside class="side" :class="{ open: sideOpen }">
      <div class="side-head mobile-only">
        <span>Input &amp; amp</span>
        <button class="icon-btn" @click="sideOpen = false"><i class="pi pi-times"></i></button>
      </div>

      <GroovyInputSetup
        :devices="devices"
        :device-id="p.deviceId"
        :channel-count="channelCount"
        :channel-index="p.channelIndex"
        :opened="inputOpen"
        :error="inputError"
        :level="bandLevel"
        :floor="floorLevel"
        :gate="p.gate"
        :sensitivity="p.sensitivity"
        :refractory-ms="p.refractoryMs"
        :offset-ms="p.offsetMs"
        :calibrating="calibrating"
        :calibration-count="calDevs.length"
        :calibration-target="CAL_TARGET"
        :last-calibration="lastCalibration"
        :diagnostics="diag"
        :probe-running="probeRunning"
        :probe-count="probeDevs.length"
        :probe-target="PROBE_COUNT"
        :probe-result="probeResult"
        :measured="measured"
        :measure-log="measureLog"
        @loopback-start="startLoopbackTest"
        @loopback-stop="stopLoopbackTest(false)"
        @loopback-apply="applyLoopbackOffset"
        @open="openDevice"
        @channel="setChannel"
        @update="onDetectorUpdate"
        @calibrate="startCalibration"
        @cancel-calibrate="stopCalibration(false)"
      />

      <GroovyAmp
        :value="p.amp"
        :out-level="outLevel"
        :risky="inputRisky"
        :monitor-delay-ms="monitorDelayMs"
        :native-available="nativeAvailable"
        :native-enabled="p.nativeHelper"
        :native-info="nativeInfo"
        :native-level="nativeLevel"
        :native-xruns="nativeXruns"
        :native-probing="nativeProbing"
        :native-loopback="nativeLoopback"
        @update="onAmpUpdate"
        @native="setNativeHelper"
        @test="testNative"
        @loopback="measureNative"
      />
    </aside>

    <!-- Rename -->
    <Dialog v-model:visible="renameDlg.open" header="Rename take" modal :style="{ width: '22rem' }">
      <InputText v-model="renameDlg.name" class="w-full" autofocus @keydown.enter="commitRename" />
      <template #footer>
        <Button label="Cancel" text @click="renameDlg.open = false" />
        <Button label="Save" @click="commitRename" />
      </template>
    </Dialog>

    <ConfirmDialog />

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ConfirmDialog from 'primevue/confirmdialog'
import { useConfirm } from 'primevue/useconfirm'
import dayjs from 'dayjs'

import GroovyRoll from '@/components/groovy/GroovyRoll.vue'
import GroovyAmp from '@/components/groovy/GroovyAmp.vue'
import GroovyInputSetup from '@/components/groovy/GroovyInputSetup.vue'
import GroovyTakeCompare from '@/components/groovy/GroovyTakeCompare.vue'

import { useGroovyStore } from '@/stores/groovy'
import { ensureAudio, currentContext, resetAudio, outputLatencySec } from '@/lib/groovy/context'
import { setClickLevel, setDrumLevel } from '@/lib/groovy/bus'
import {
  METERS,
  meterById,
  subdivisionsFor,
  coerceSubdiv,
  slotLabel,
  patternsFor,
  patternById,
} from '@/lib/groovy/grid'
import { Transport } from '@/lib/groovy/transport'
import { CalibrationRun } from '@/lib/groovy/calibration'
import { scheduleProbe, PROBE_DETECTOR_CONFIG } from '@/lib/groovy/probe'
import {
  openInput,
  selectChannel,
  closeInput,
  listInputDevices,
  looksLikeBuiltInMic,
} from '@/lib/groovy/input'
import { BassAmp } from '@/lib/groovy/amp'
import { NativeMonitor, isWindows } from '@/lib/groovy/nativeMonitor'
import { OnsetDetector, ratioForSensitivity, isWorkletSupported } from '@/lib/groovy/onset'
import { BassPitchTracker } from '@/lib/groovy/pitch'
import { TakeRecorder } from '@/lib/groovy/recorder'
import { summarise, estimateLatency, mean, stdev, median } from '@/lib/groovy/analysis'

const store = useGroovyStore()
const confirm = useConfirm()

const p = computed(() => store.prefs)

// Audio objects live outside reactivity — they hold graph nodes, and wrapping
// them in proxies buys nothing but trouble.
const transport = new Transport()
const detector = new OnsetDetector()
const tracker = new BassPitchTracker()
const recorder = new TakeRecorder()
let amp = null
let mono = null

// The Windows helper (native/groovy-monitor), when it is running. It carries
// the monitor path at ASIO or low-latency WASAPI speed; the browser's own amp
// goes quiet while it is connected and the knobs are mirrored over the socket.
// Timing is untouched either way — see lib/groovy/nativeMonitor.js.
const native = new NativeMonitor()
const nativeAvailable = isWindows()
const nativeInfo = ref(null)
const nativeLevel = ref(0)
const nativeXruns = ref(0)
const nativeProbing = ref(false)
const nativeLoopback = ref(null)

// Plain arrays: the roll reads them 60×/s from its own rAF loop, so making
// every push a reactive trigger would be pure overhead.
const liveHits = []
const trace = []

const railOpen = ref(false)
const sideOpen = ref(false)
const view = ref('practice')
const running = ref(false)
const toast = ref('')
let toastTimer = 0

const inputOpen = ref(false)
const inputError = ref('')
const inputLabel = ref('')
const devices = ref([])
const channelCount = ref(1)
const bandLevel = ref(0)
const floorLevel = ref(0)
const outLevel = ref(0)

const last = ref(null)
const live = ref({ count: 0, meanMs: 0, sdMs: 0, inPocketPct: 0 })
const liveDevs = []
const position = ref('—')

const recording = ref(false)
const armed = ref(false)
const countInUntil = ref(0)
const countInLeft = ref(0)
const takeHitCount = ref(0)
let takeHits = []
let takeStartTime = 0
let armTimer = 0

// Twelve rather than eight: estimateLatency() throws the first two away, and
// robust outlier rejection needs something left to be robust about.
const CAL_TARGET = 12
const calibrating = ref(false)
const calDevs = ref([])
const lastCalibration = ref(null)
const diag = ref(null)

// Ten slots, of which two sound nothing. Those two are the control: if the
// detector fires where we played silence, whatever it is hearing is not us, and
// the run is reported as unverified rather than as a number.
// The round trip is negotiated when the input stream opens and is then rock
// steady, but a *different* stream open can land tens of milliseconds away. So
// the offset belongs to one session and is never carried into the next: it
// starts at zero on every load and is measured again. That is cheaper than
// explaining to someone why a remembered number is now a lie.
const measureLog = ref([])

function logMeasurement(ms, jitterMs, kind) {
  measureLog.value = [{ ms, jitterMs, kind, at: Date.now() }, ...measureLog.value].slice(0, 6)
}

const PROBE_COUNT = 10
const PROBE_SILENT = [3, 7]
const probeRunning = ref(false)
const probeDevs = ref([])
const probeGhosts = ref(0)
const probeResult = ref(null)
let probeRun = null
let probeEndTimer = 0

const renameDlg = reactive({ open: false, id: null, name: '' })

const canRecordAudio = computed(() => TakeRecorder.supported)
const inputRisky = computed(() => looksLikeBuiltInMic(inputLabel.value))
const subdivOptions = computed(() => subdivisionsFor(meterById(p.value.meterId)))
const patterns = computed(() => patternsFor(p.value.meterId))
const patternId = computed(() => patternById(p.value.meterId, p.value.patternId)?.id ?? null)

// The best round-trip figure we actually have, and where it came from. Prefers
// a real measurement over the saved offset: the offset can be a hand-typed
// guess, or simply zero in a browser profile that has never been calibrated.
const measured = computed(() => {
  const r = probeResult.value
  if (r && !r.failed) return { ms: r.roundTripMs, from: 'loopback test' }
  if (lastCalibration.value) return { ms: lastCalibration.value.medianMs, from: 'calibration' }
  return null
})

// What the amp panel says about its own delay. Only figures measured in this
// session count: the saved offset can be a hand-typed number, or the
// output-half seed written when the input first opened, and neither describes
// the path the monitor actually takes.
const monitorDelayMs = computed(() => {
  if (nativeInfo.value) return nativeInfo.value.roundTripMs
  const r = probeResult.value
  if (r && !r.failed) return r.roundTripMs
  if (lastCalibration.value) return lastCalibration.value.medianMs
  return null
})

const lastClass = computed(() => {
  if (!last.value) return 'idle'
  if (Math.abs(last.value.devMs) <= p.value.toleranceMs) return 'ok'
  return last.value.devMs < 0 ? 'early' : 'late'
})

const lastWord = computed(() => {
  if (!last.value) return 'waiting'
  if (Math.abs(last.value.devMs) <= p.value.toleranceMs) return 'in the pocket'
  return last.value.devMs < 0 ? 'early' : 'late'
})

// ── Preferences → engine ────────────────────────────────────────────────────
function setPref(patch) {
  store.savePrefs(patch)
}

function setMeter(id) {
  const meter = meterById(id)
  store.savePrefs({
    meterId: id,
    subdiv: coerceSubdiv(meter, p.value.subdiv),
    patternId: patternsFor(id)[0]?.id ?? null,
  })
}

function clampBpm(v) {
  if (!Number.isFinite(v)) return p.value.bpm
  return Math.max(20, Math.min(300, Math.round(v)))
}

function nudgeBpm(d) {
  setPref({ bpm: clampBpm(p.value.bpm + d) })
}

let taps = []
function tap() {
  const now = performance.now()
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = []
  taps.push(now)
  if (taps.length > 5) taps.shift()
  if (taps.length < 2) return
  const gaps = []
  for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1])
  setPref({ bpm: clampBpm(60000 / median(gaps)) })
}

watch(
  () => [p.value.bpm, p.value.meterId, p.value.subdiv, p.value.clickOn, p.value.clickSubdivisions, p.value.drumsOn, patternId.value],
  () => {
    transport.setConfig({
      bpm: p.value.bpm,
      meterId: p.value.meterId,
      subdiv: p.value.subdiv,
      clickOn: p.value.clickOn,
      clickSubdivisions: p.value.clickSubdivisions,
      drumsOn: p.value.drumsOn,
      patternId: patternId.value,
    })
  },
)

watch(
  () => [p.value.clickLevel, p.value.drumLevel],
  () => {
    const ac = currentContext()
    if (!ac) return
    setClickLevel(ac, p.value.clickLevel)
    setDrumLevel(ac, p.value.drumLevel)
  },
)

function detectorConfig() {
  return {
    ratio: ratioForSensitivity(p.value.sensitivity),
    gate: p.value.gate,
    refractoryMs: p.value.refractoryMs,
  }
}

function onDetectorUpdate(patch) {
  store.savePrefs(patch)
  detector.configure(detectorConfig())
}

function onAmpUpdate(patch) {
  store.saveAmpPrefs(patch)
  applyAmp()
}

// One place decides who is monitoring. With the helper connected the browser's
// path stays muted whatever the switch says, or the note arrives twice.
function applyAmp() {
  if (nativeInfo.value) {
    native.setParams(p.value.amp)
    amp?.setParams({ ...p.value.amp, monitor: false })
  } else {
    amp?.setParams(p.value.amp)
  }
}

function measureNative() {
  if (!native.loopback()) {
    say('The helper is not connected.')
    return
  }
  nativeProbing.value = true
  say('Measuring — the helper is sending pulses. Don’t play for a couple of seconds.')
}

function testNative() {
  if (native.test()) say('The helper is playing a tone from its own output. Hear it? Then the native path is live.')
  else say('The helper is not connected.')
}

function setNativeHelper(on) {
  store.savePrefs({ nativeHelper: on })
  if (on && nativeAvailable) native.start()
  else native.stop()
}

native.onHello = (info) => {
  nativeInfo.value = info
  nativeXruns.value = 0
  applyAmp()
  say(`Native monitor connected — ${String(info.backend).toUpperCase()}, about ${Math.round(info.roundTripMs)} ms.`)
}
native.onStatus = (s) => {
  nativeLevel.value = s.inRms || 0
  nativeXruns.value = s.xruns || 0
  nativeProbing.value = !!s.probing
}
native.onLoopback = (r) => {
  nativeProbing.value = false
  nativeLoopback.value = r
  if (r.ok) {
    say(`Native round trip ${r.ms.toFixed(1)} ms, jitter ±${r.jitterMs.toFixed(1)} ms (${r.n} pulses).`)
    logMeasurement(r.ms, r.jitterMs, 'helper loopback')
  } else {
    say(
      r.n === 0
        ? 'Nothing came back to the helper. Loop a Scarlett output into input 1 (or select the loopback channel) and try again.'
        : `Only ${r.n} of ${r.n + r.misses} pulses came back — check the loop and try again.`,
    )
  }
}
native.onClose = () => {
  nativeInfo.value = null
  nativeLevel.value = 0
  nativeProbing.value = false
  nativeLoopback.value = null
  applyAmp()
  say('Native monitor gone — back to the browser amp.')
}

// ── Transport ───────────────────────────────────────────────────────────────
function toggleRun() {
  if (running.value) {
    transport.stop()
    running.value = false
    if (recording.value || armed.value) stopTake(true)
    return
  }
  const ac = ensureAudio()
  if (!ac) {
    say('This browser has no Web Audio support.')
    return
  }
  setClickLevel(ac, p.value.clickLevel)
  setDrumLevel(ac, p.value.drumLevel)
  transport.setConfig({
    bpm: p.value.bpm,
    meterId: p.value.meterId,
    subdiv: p.value.subdiv,
    clickOn: p.value.clickOn,
    clickSubdivisions: p.value.clickSubdivisions,
    drumsOn: p.value.drumsOn,
    patternId: patternId.value,
  })
  transport.start()
  running.value = true
  view.value = 'practice'
}

// ── Input ───────────────────────────────────────────────────────────────────
async function openDevice(deviceId) {
  inputError.value = ''
  let ac = ensureAudio()
  if (!ac) {
    inputError.value = 'This browser has no Web Audio support.'
    return
  }
  if (!isWorkletSupported()) {
    inputError.value = 'This browser cannot run AudioWorklet, which the timing detector needs.'
    return
  }

  teardownInput()
  try {
    let info = await openInput(ac, {
      deviceId: deviceId ?? p.value.deviceId,
      channelIndex: p.value.channelIndex,
    })

    // If the interface captures at a different rate than the context renders
    // at, the browser resamples between them — latency we can simply decline to
    // pay. Rebuild the context at the device's rate and open again. Once only:
    // if the rate still disagrees after that, the browser is overriding us and
    // retrying would loop.
    if (info.sampleRate && Math.abs(info.sampleRate - ac.sampleRate) > 1) {
      console.info(
        `[Groovy] context ${ac.sampleRate} Hz vs device ${info.sampleRate} Hz — rebuilding to match.`,
      )
      const wanted = info.sampleRate
      closeInput()
      transport.stop()
      running.value = false
      const fresh = await resetAudio(wanted)
      if (fresh) {
        ac = fresh
        info = await openInput(ac, {
          deviceId: info.deviceId,
          channelIndex: p.value.channelIndex,
        })
      }
    }

    mono = info.mono
    channelCount.value = info.channelCount
    inputLabel.value = info.label
    store.savePrefs({
      deviceId: info.deviceId,
      channelIndex: Math.min(p.value.channelIndex, info.channelCount - 1),
    })

    amp = new BassAmp(ac)
    amp.connectFrom(mono)
    applyAmp()

    await detector.attach(ac, mono, detectorConfig())
    detector.onOnset = onOnset
    detector.onLevel = onLevel

    tracker.start(ac, mono, onPitch)

    devices.value = await listInputDevices()
    inputOpen.value = true

    // What we can actually know about the round trip, so the offset is a
    // reading rather than a mystery number. Only the output half is knowable
    // from the browser; calibration supplies the total, and the input half is
    // whatever is left over.
    // baseLatency/outputLatency are not implemented everywhere — Firefox
    // reports neither. Record whether the browser actually told us anything,
    // so the panel can say "not reported" instead of printing a confident 0.0
    // and inviting arithmetic on it.
    const baseMs = (ac.baseLatency || 0) * 1000
    const outputMs = (ac.outputLatency || 0) * 1000
    diag.value = {
      ctxSampleRate: ac.sampleRate,
      deviceSampleRate: info.sampleRate,
      baseMs,
      outputMs,
      outputKnown: baseMs + outputMs > 0,
      inputHintMs: info.latencyHint != null ? info.latencyHint * 1000 : null,
    }

    // A first guess at the offset, so the very first take is not wildly out.
    // Only the output half is knowable without playing a note; calibration or
    // the loopback test finds the rest.
    if (!p.value.offsetMs) {
      store.savePrefs({ offsetMs: Math.round(outputLatencySec() * 1000 * 10) / 10 })
    }
  } catch (e) {
    console.error('[Groovy] openDevice error:', e)
    inputError.value =
      e?.name === 'NotAllowedError'
        ? 'Microphone permission was refused. Allow it for this site and try again.'
        : e?.message || 'Could not open that input.'
    inputOpen.value = false
  }
}

function setChannel(idx) {
  store.savePrefs({ channelIndex: idx })
  selectChannel(idx)
}

function teardownInput() {
  tracker.stop()
  detector.detach()
  amp?.dispose()
  amp = null
  mono = null
  closeInput()
  inputOpen.value = false
}

// ── Detection ───────────────────────────────────────────────────────────────
let pinnedSince = 0

function onLevel(msg) {
  bandLevel.value = msg.band
  floorLevel.value = msg.floor
  outLevel.value = msg.rms

  // Runaway guard. A pinned input that *stays* pinned while we are also driving
  // the output is a feedback loop, not playing — no bass sustains at full scale.
  // It happens when the output finds a way back to the input: a loopback
  // channel selected as the input, an interface routed back on itself, or a
  // microphone in front of a speaker. Cut the monitor rather than let it climb;
  // whatever the cause, nobody wants to sit through the ramp to find out.
  if (p.value.amp.monitor && msg.peak >= 0.99 && msg.rms > 0.35) {
    const now = performance.now()
    if (!pinnedSince) pinnedSince = now
    else if (now - pinnedSince > 1000) {
      pinnedSince = 0
      onAmpUpdate({ monitor: false })
      say('Monitoring cut — the input was pinned, which means the output is getting back in.')
    }
  } else {
    pinnedSince = 0
  }
}

function onPitch(res) {
  const ac = currentContext()
  if (!ac || !res || res.clarity < 0.78) return
  // The analysis window looks backwards, so the reading describes a moment
  // roughly half a window ago. Stamping it there keeps the trace under the note.
  trace.push({ t: ac.currentTime - 0.04, midiFloat: res.midiFloat, midi: res.midi, freq: res.freq })
  const cutoff = ac.currentTime - 30
  while (trace.length && trace[0].t < cutoff) trace.shift()
}

function onOnset(msg) {
  // The loopback test outranks everything: it is the app listening to itself,
  // with no transport and no player involved.
  if (probeRun) {
    const m = probeRun.match(msg.time)
    if (m) {
      // A detection in a silent slot cannot have been caused by us.
      if (probeRun.silent.has(m.index)) probeGhosts.value += 1
      else probeDevs.value = [...probeDevs.value, m.devMs]
    }
    return
  }

  // Calibration next, and before any transport check. It runs on its own
  // sparse click train with the metronome *stopped* (see calibration.js), so
  // there is no transport running and no grid to match against — anything that
  // asks the transport a question here would drop every note.
  if (calibrating.value) {
    const m = calRun?.match(msg.time)
    if (!m) return
    calDevs.value = [...calDevs.value, m.devMs]
    if (calDevs.value.length >= CAL_TARGET) stopCalibration(true)
    return
  }

  if (!running.value) return
  const corrected = msg.time - p.value.offsetMs / 1000
  const slot = transport.nearestSlot(corrected)
  if (!slot) return
  const devMs = (corrected - slot.time) * 1000

  const meter = meterById(slot.meterId)
  const hit = {
    time: corrected,
    slotTime: slot.time,
    devMs,
    slot: slot.index,
    slotInBar: slot.slotInBar,
    bar: slot.bar,
    label: slotLabel(slot.slotInBar, slot.subdiv, meter),
    midi: null,
    midiFloat: null,
    freq: null,
    str: msg.strength,
  }

  liveHits.push(hit)
  while (liveHits.length > 600) liveHits.shift()

  // The pitch tracker needs a moment of steady note before it can say anything,
  // so the dot's vertical position is filled in shortly after the tick appears.
  setTimeout(() => fillPitch(hit), 130)

  last.value = hit
  liveDevs.push(devMs)
  if (liveDevs.length > 400) liveDevs.shift()
  live.value = {
    count: liveDevs.length,
    meanMs: mean(liveDevs),
    sdMs: stdev(liveDevs),
    inPocketPct:
      (liveDevs.filter((d) => Math.abs(d) <= p.value.toleranceMs).length / liveDevs.length) * 100,
  }

  // Membership is decided by the grid line the note belongs to, not by when it
  // arrived: a downbeat played 20 ms early is still the take's first note.
  if (recording.value && slot.time >= takeStartTime - 1e-6) {
    takeHits.push({
      t: +(corrected - takeStartTime).toFixed(4),
      devMs: +devMs.toFixed(2),
      slot: hit.slot,
      slotInBar: hit.slotInBar,
      bar: hit.bar,
      midi: null,
      freq: null,
      str: +(msg.strength || 0).toFixed(4),
      _ref: hit,
    })
    takeHitCount.value = takeHits.length
  }
}

function fillPitch(hit) {
  const want = hit.time + 0.07
  let best = null
  let bestD = 0.07
  for (let i = trace.length - 1; i >= 0; i--) {
    const d = Math.abs(trace[i].t - want)
    if (d < bestD) {
      bestD = d
      best = trace[i]
    }
    if (trace[i].t < want - 0.2) break
  }
  if (!best) return
  hit.midi = best.midi
  hit.midiFloat = best.midiFloat
  hit.freq = best.freq
}

function resetLive() {
  liveDevs.length = 0
  liveHits.length = 0
  last.value = null
  live.value = { count: 0, meanMs: 0, sdMs: 0, inPocketPct: 0 }
}

// ── Takes ───────────────────────────────────────────────────────────────────
function toggleRecord() {
  if (recording.value || armed.value) {
    stopTake(false)
    return
  }
  if (!running.value) toggleRun()
  if (!running.value) return

  takeHits = []
  takeHitCount.value = 0
  takeStartTime = transport.nextBarTime(p.value.countInBars, 0.3)
  countInUntil.value = takeStartTime
  armed.value = true
  view.value = 'practice'

  // Arm slightly early so a rushed first note is not lost to setTimeout jitter;
  // the grid-line test above decides what actually counts.
  const ac = currentContext()
  const waitMs = Math.max(0, (takeStartTime - ac.currentTime) * 1000 - 60)
  tickCountIn()
  armTimer = setTimeout(() => {
    armed.value = false
    recording.value = true
    if (p.value.keepAudio && canRecordAudio.value) recorder.start()
  }, waitMs)
}

let countInRaf = 0
function tickCountIn() {
  cancelAnimationFrame(countInRaf)
  const step = () => {
    const ac = currentContext()
    if (!ac || !armed.value) return
    const barSec = transport.barSeconds()
    countInLeft.value = Math.max(0, Math.ceil((takeStartTime - ac.currentTime) / barSec))
    countInRaf = requestAnimationFrame(step)
  }
  countInRaf = requestAnimationFrame(step)
}

async function stopTake(silent) {
  clearTimeout(armTimer)
  cancelAnimationFrame(countInRaf)
  const wasRecording = recording.value
  const hits = takeHits
  armed.value = false
  recording.value = false
  countInUntil.value = 0

  // Always stop the recorder if it is running — "keep audio" may have been
  // switched off mid-take, and a live MediaRecorder left behind holds the
  // stream open. Whether the result is kept is a separate question.
  const captured = recorder.recording ? await recorder.stop() : null
  const blob = p.value.keepAudio ? captured : null
  if (!wasRecording || !hits.length) {
    recorder.cancel()
    if (!silent) say(hits.length ? 'Take discarded.' : 'Nothing was played — no take saved.')
    takeHits = []
    return
  }

  // The pitch fill lands ~130 ms after each hit, so copy it over now rather
  // than storing nulls for the last note or two.
  for (const h of hits) {
    if (h._ref) {
      h.midi = h._ref.midi
      h.freq = h._ref.freq ? +h._ref.freq.toFixed(2) : null
    }
    delete h._ref
  }

  const settings = {
    bpm: p.value.bpm,
    meterId: p.value.meterId,
    subdiv: p.value.subdiv,
    toleranceMs: p.value.toleranceMs,
    offsetMs: p.value.offsetMs,
    clickSubdivisions: p.value.clickSubdivisions,
    drumsOn: p.value.drumsOn,
    patternId: patternId.value,
    countInBars: p.value.countInBars,
  }
  const stats = summarise(hits, settings)
  const durationMs = hits.length ? hits[hits.length - 1].t * 1000 : 0

  try {
    await store.createTake({
      name: `${p.value.bpm} bpm ${p.value.meterId} · ${dayjs().format('D MMM HH:mm')}`,
      settings,
      hits,
      stats,
      durationMs,
      audioBlob: blob,
    })
    say(`Take saved — ${hits.length} notes, ${stats.sdMs.toFixed(1)} ms spread.`)
  } catch {
    say('Could not save that take.')
  }
  takeHits = []
}

function pickTake(id) {
  store.toggleCompare(id)
  if (store.compareCount) view.value = 'analysis'
}

function chipStyle(id) {
  const slot = store.compareIds.indexOf(id)
  const SERIES = ['#2a78d6', '#eb6834', '#1baf7a']
  return slot === -1 ? { background: 'transparent' } : { background: SERIES[slot] }
}

function startRename(t) {
  renameDlg.id = t.id
  renameDlg.name = t.name
  renameDlg.open = true
}

async function commitRename() {
  const name = renameDlg.name.trim()
  if (!name) return
  renameDlg.open = false
  try {
    await store.renameTake(renameDlg.id, name)
  } catch {
    say('Rename failed.')
  }
}

function confirmDelete(t) {
  confirm.require({
    message: `Delete “${t.name}”? The timing data${t.audio_path ? ' and its audio' : ''} goes with it.`,
    header: 'Delete take',
    icon: 'pi pi-exclamation-triangle',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        await store.deleteTake(t.id)
      } catch {
        say('Delete failed.')
      }
    },
  })
}

// ── Calibration ─────────────────────────────────────────────────────────────
let calRun = null
let calEndTimer = 0
let calWasRunning = false

function startCalibration() {
  if (!inputOpen.value) {
    say('Enable the audio input first.')
    return
  }
  const ac = ensureAudio()
  if (!ac) return

  // The metronome stops for the duration. Calibration has its own click train
  // (see calibration.js) and two unrelated click streams would be impossible to
  // play along with.
  calWasRunning = running.value
  if (running.value) {
    transport.stop()
    running.value = false
  }

  calDevs.value = []
  calibrating.value = true
  calRun = new CalibrationRun(ac, { count: CAL_TARGET, intervalSec: 1.2 })
  calRun.start()

  // Finish on its own when the train runs out, however many notes landed.
  clearTimeout(calEndTimer)
  calEndTimer = setTimeout(
    () => stopCalibration(true),
    Math.max(0, (calRun.endsAt - ac.currentTime + 0.9) * 1000),
  )

  say(`Play one note on each click — ${CAL_TARGET} of them, slowly.`)
}

function stopCalibration(commit) {
  if (!calibrating.value) return
  calibrating.value = false
  clearTimeout(calEndTimer)
  const measurableMs = calRun?.maxMeasurableMs ?? 600
  calRun?.stop()
  calRun = null

  const devs = calDevs.value
  // Put the metronome back the way it was found.
  if (calWasRunning) {
    calWasRunning = false
    toggleRun()
  }
  if (!commit) return

  const est = estimateLatency(devs)
  if (!est.ok) {
    // "Not enough notes" is useless when the answer was *no* notes — that is a
    // detector problem, not a playing problem, and it has a specific cure.
    say(
      devs.length === 0
        ? 'No notes were detected at all. Lower the Gate until your playing crosses the marker on the level bar, then try again.'
        : `Only ${devs.length} notes landed — play through the whole count and try again.`,
    )
    return
  }

  lastCalibration.value = {
    n: est.kept,
    skipped: est.skipped,
    rejected: est.rejected,
    medianMs: est.offsetMs,
    sdMs: est.spreadMs,
    values: est.values,
    suspect: est.suspect,
    measurableMs,
    // A result close to the edge of what the train can resolve is exactly the
    // case that used to come back wrong, so flag it rather than trust it.
    nearLimit: Math.abs(est.offsetMs) > measurableMs * 0.8,
  }
  store.savePrefs({ offsetMs: est.offsetMs })
  logMeasurement(est.offsetMs, est.spreadMs, 'calibration')

  // A wide spread, or an answer that only emerged after throwing away half the
  // notes, means the number is not trustworthy whatever its median says — so
  // say so rather than quietly writing a bad offset and moving on.
  if (est.suspect) {
    say(`Offset set to ${est.offsetMs} ms, but ${est.rejected} of ${est.kept + est.rejected} notes were rejected — worth rerunning.`)
  } else if (est.spreadMs > 30) {
    say(`Offset set to ${est.offsetMs} ms, but the notes were ±${est.spreadMs.toFixed(0)} ms apart — worth rerunning.`)
  } else {
    say(`Offset set to ${est.offsetMs} ms.`)
  }
}

// ── Loopback test ───────────────────────────────────────────────────────────
// The app plays a pulse and listens for that same pulse coming back through the
// interface's loopback. No ears and no hands in the loop, so what comes out is
// the machine's round trip on its own — and, across repeats, its jitter, which
// is the number that actually decides whether a measurement can be trusted.
//
// What it cannot see is the DAC and ADC either side of the analogue world,
// worth a millisecond or two. Everything else is the same path a real note
// takes.
function startLoopbackTest() {
  if (!inputOpen.value) {
    say('Enable the audio input first.')
    return
  }
  const ac = ensureAudio()
  if (!ac) return

  if (running.value) {
    transport.stop()
    running.value = false
  }

  // Monitoring off, without asking. A loopback test deliberately connects our
  // output to our input; leaving the amp live on top of that closes the loop
  // properly and it howls. The runaway guard in onLevel() would catch it a
  // second later, but a second of that is a second too long.
  let mutedForTest = false
  if (p.value.amp.monitor) {
    onAmpUpdate({ monitor: false })
    mutedForTest = true
  }

  probeDevs.value = []
  probeGhosts.value = 0
  probeResult.value = null
  probeRunning.value = true
  // The probe is loud and synthetic; the detector is retuned for it and put
  // back afterwards. Deliberately not saved to prefs — it is not a preference.
  detector.configure(PROBE_DETECTOR_CONFIG)

  probeRun = new CalibrationRun(ac, {
    count: PROBE_COUNT,
    intervalSec: 1.2,
    silent: PROBE_SILENT,
    voice: (c, when) => scheduleProbe(c, when),
  })

  // Run the direct-capture detector against the same pulses.
  probeRun.start()

  clearTimeout(probeEndTimer)
  probeEndTimer = setTimeout(
    () => stopLoopbackTest(true),
    Math.max(0, (probeRun.endsAt - ac.currentTime + 1.3) * 1000),
  )
  say(
    mutedForTest
      ? 'Amp muted for the test — a cabled loopback plus live monitoring is a feedback loop.'
      : 'Listening for the app’s own pulses coming back…',
  )
}

function stopLoopbackTest(commit) {
  if (!probeRunning.value) return
  probeRunning.value = false
  clearTimeout(probeEndTimer)
  const maxMs = probeRun?.maxMeasurableMs ?? 1120
  probeRun?.stop()
  probeRun = null
  detector.configure(detectorConfig())

  if (!commit) return
  const devs = probeDevs.value
  if (devs.length < 3) {
    probeResult.value = { n: devs.length, failed: true }
    say(
      devs.length === 0
        ? 'Nothing came back. Check that a mix is routed to Loopback and that Loopback is the selected input.'
        : `Only ${devs.length} pulses returned — check the loopback routing and try again.`,
    )
    return
  }

  // No human in this loop, so there is no settling-in to discard.
  const est = estimateLatency(devs, { skip: 0, minKept: 3 })
  const ghosts = probeGhosts.value
  probeResult.value = {
    n: est.kept,
    rejected: est.rejected,
    ghosts,
    roundTripMs: est.offsetMs,
    jitterMs: est.spreadMs,
    nearLimit: Math.abs(est.offsetMs) > maxMs * 0.8,
    failed: false,
  }
  if (!ghosts) logMeasurement(est.offsetMs, est.spreadMs, 'loopback')
  if (ghosts) {
    say(
      `Unverified: ${ghosts} detection${ghosts > 1 ? 's' : ''} landed where nothing was played.`,
    )
  } else {
    say(`Round trip ${est.offsetMs.toFixed(1)} ms, jitter ±${est.spreadMs.toFixed(1)} ms.`)
  }
}

function applyLoopbackOffset() {
  const r = probeResult.value
  if (!r || r.failed) return
  store.savePrefs({ offsetMs: r.roundTripMs })
  lastCalibration.value = null
  say(`Offset set to ${r.roundTripMs.toFixed(1)} ms from the loopback measurement.`)
}

// ── Chrome ──────────────────────────────────────────────────────────────────
function say(msg) {
  toast.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3200)
}

function fmt1(v) {
  return (Math.round((v || 0) * 10) / 10).toFixed(1)
}

let posRaf = 0
function tickPosition() {
  const ac = currentContext()
  if (ac && running.value) {
    const pos = transport.positionAt(ac.currentTime)
    position.value = pos ? `${pos.bar + 1} · ${slotLabel(pos.slotInBar, pos.subdiv, meterById(pos.meterId))}` : '—'
  } else {
    position.value = '—'
  }
  posRaf = requestAnimationFrame(tickPosition)
}

function onKey(e) {
  const el = document.activeElement
  if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return
  if (e.code === 'Space') {
    e.preventDefault()
    toggleRun()
  } else if (e.key === 'r' || e.key === 'R') {
    if (inputOpen.value) toggleRecord()
  }
}

onMounted(() => {
  store.fetchTakes()
  if (!p.value.patternId) store.savePrefs({ patternId: patternsFor(p.value.meterId)[0]?.id ?? null })
  window.addEventListener('keydown', onKey)
  posRaf = requestAnimationFrame(tickPosition)
  if (p.value.nativeHelper && nativeAvailable) native.start()
})

onBeforeUnmount(() => {
  native.stop()
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(posRaf)
  cancelAnimationFrame(countInRaf)
  clearTimeout(armTimer)
  clearTimeout(calEndTimer)
  clearTimeout(probeEndTimer)
  clearTimeout(toastTimer)
  calRun?.stop()
  probeRun?.stop()
  recorder.cancel()
  transport.stop()
  teardownInput()
})
</script>

<style scoped>
.groovy-app {
  --accent-500: #ef4444;
  --accent-600: #b91c1c;
  --accent-400: #f87171;
  --accent-100: #fee2e2;
  --accent-050: #fef2f2;

  --bg-card: #ffffff;
  --bg-sunken: #f3f2f0;
  --border: #e5e4e1;
  --border-soft: #eeede9;
  --text: #1a1a1a;
  --text-dim: #5c5c5c;
  --text-faint: #9a9a9a;

  --ok: #16a34a;
  --ok-soft: #dcfce7;
  --ok-ink: #166534;
  --warn-soft: #fffbeb;

  --early: #2a78d6;
  --late: #e34948;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 8px 30px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
  --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;

  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial,
    sans-serif;
  color: var(--text);
  font-size: 0.9375rem;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  height: calc(100vh - 6.75rem);
  height: calc(100dvh - 6.75rem);
  overflow: hidden;
  /* The rail and the side panel become overlays at narrower widths and are
     positioned against this box. Without it they anchor to the page instead:
     under the navbar, and off-screen whenever the navbar is wider than the
     viewport. */
  position: relative;
  display: flex;
  align-items: stretch;
  background: var(--bg-sunken);
}

:where(.groovy-app button) {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

.groovy-app button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.groovy-app input,
.groovy-app select {
  font: inherit;
  color: inherit;
}

/* ── Rail ── */
.rail {
  flex: 0 0 17.5rem;
  width: 17.5rem;
  background: var(--bg-card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.9rem 0.7rem;
  min-height: 0;
}

.rail-head {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0 0.2rem;
}

.eyebrow {
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--accent-500);
}

.rail-title {
  margin: 0.05rem 0 0;
  font-size: 1.2rem;
  font-weight: 800;
  line-height: 1.1;
}

.rail-sub {
  font-size: 0.7rem;
  color: var(--text-faint);
}

.rail-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.rail-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
  padding: 2.5rem 1rem;
  color: var(--text-faint);
  font-size: 0.76rem;
  line-height: 1.5;
}

.rail-state-icon {
  font-size: 1.4rem;
}

.take {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.55rem;
  border-radius: 0.55rem;
  border: 1px solid var(--border);
  background: var(--bg-card);
  transition: border-color 120ms, background 120ms;
}

.take:hover {
  background: var(--bg-sunken);
}

.take.picked {
  border-color: var(--text-dim);
  background: var(--bg-sunken);
}

.take-chip {
  flex: none;
  width: 0.45rem;
  align-self: stretch;
  border-radius: 999px;
  border: 1px solid var(--border);
}

.take.picked .take-chip {
  border-color: transparent;
}

.take-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.take-name {
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.take-meta,
.take-nums {
  font-size: 0.66rem;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.take-nums b {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.take-actions {
  display: none;
  flex-direction: column;
  gap: 0.15rem;
}

.take:hover .take-actions {
  display: flex;
}

.mini {
  width: 1.3rem;
  height: 1.3rem;
  border-radius: 0.3rem;
  display: grid;
  place-items: center;
  font-size: 0.62rem;
  color: var(--text-faint);
}

.mini:hover {
  background: var(--border-soft);
  color: var(--text);
}

.mini.danger:hover {
  color: var(--accent-600);
}

.rail-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  height: 1.8rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-dim);
}

/* ── Stage ── */
.stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-soft);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.tbar-sub {
  background: #fcfcfb;
  padding-top: 0.4rem;
  padding-bottom: 0.4rem;
}

.tbar-spacer {
  flex: 1;
  min-width: 0.5rem;
}

.tb-div {
  width: 1px;
  height: 1.3rem;
  background: var(--border-soft);
}

.play {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 2.1rem;
  padding: 0 0.95rem;
  border-radius: 0.5rem;
  background: var(--text);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
}

.play.on {
  background: var(--accent-500);
}

.tempo {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.step {
  width: 1.6rem;
  height: 1.8rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-dim);
  font-size: 0.6rem;
  display: grid;
  place-items: center;
}

.bpm {
  width: 3.4rem;
  height: 1.8rem;
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  text-align: center;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: #fff;
}

.tempo-unit {
  font-size: 0.66rem;
  color: var(--text-faint);
}

.tap {
  height: 1.8rem;
  padding: 0 0.55rem;
  border-radius: 0.35rem;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-dim);
}

.tap:hover {
  border-color: var(--accent-400);
  color: var(--accent-600);
}

.bpm-slider,
.mini-slider {
  accent-color: var(--accent-500);
  cursor: pointer;
}

.bpm-slider {
  width: 8rem;
}

.mini-slider {
  width: 4.5rem;
}

.sel {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.sel-label {
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
}

.sel select {
  height: 1.8rem;
  border: 1px solid var(--border);
  border-radius: 0.35rem;
  background: #fff;
  padding: 0 0.35rem;
  font-size: 0.74rem;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  background: var(--bg-sunken);
  padding: 0.1rem;
  gap: 0.1rem;
}

.seg button {
  min-width: 2rem;
  height: 1.55rem;
  border-radius: 0.3rem;
  font-size: 0.82rem;
  color: var(--text-dim);
}

.seg button.on {
  background: #fff;
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  height: 1.8rem;
  padding: 0 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-dim);
  white-space: nowrap;
}

.chip.on {
  background: var(--accent-050);
  border-color: var(--accent-400);
  color: var(--accent-600);
}

.rec {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  height: 2.1rem;
  padding: 0 0.85rem;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: #fff;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--text-dim);
}

.rec i {
  font-size: 0.55rem;
  color: var(--accent-500);
}

.rec.armed {
  border-color: var(--accent-400);
  color: var(--accent-600);
  background: var(--accent-050);
}

.rec.on {
  background: var(--accent-500);
  border-color: var(--accent-500);
  color: #fff;
}

.rec.on i {
  color: #fff;
  animation: pulse 1.1s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}

.modes {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 0.45rem;
  background: var(--bg-sunken);
  padding: 0.1rem;
  gap: 0.1rem;
}

.modes button {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  height: 1.55rem;
  padding: 0 0.6rem;
  border-radius: 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-dim);
}

.modes button.on {
  background: #fff;
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.badge {
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: var(--accent-500);
  color: #fff;
  font-size: 0.6rem;
  display: grid;
  place-items: center;
}

.surface {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.7rem;
  gap: 0.6rem;
}

.roll-holder {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  overflow: hidden;
  background: #fff;
  box-shadow: var(--shadow-sm);
}

/* ── Readout ── */
.readout {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
}

.ro-last {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 11rem;
}

.ro-num {
  font-size: 2.4rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}

.ro-unit {
  font-size: 0.8rem;
  color: var(--text-faint);
}

.ro-word {
  font-size: 0.74rem;
  font-weight: 700;
  margin-left: 0.25rem;
}

.ro-last.idle .ro-num,
.ro-last.idle .ro-word {
  color: var(--text-faint);
}

.ro-last.ok .ro-num,
.ro-last.ok .ro-word {
  color: var(--ok-ink);
}

.ro-last.early .ro-num,
.ro-last.early .ro-word {
  color: var(--early);
}

.ro-last.late .ro-num,
.ro-last.late .ro-word {
  color: var(--late);
}

.ro-stats {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  flex-wrap: wrap;
  margin-left: auto;
}

.ro-stat {
  display: flex;
  flex-direction: column;
}

.ro-k {
  font-size: 0.62rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.ro-v {
  font-size: 0.95rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ro-reset {
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  color: var(--text-faint);
  font-size: 0.72rem;
}

.ro-reset:hover {
  color: var(--text);
  border-color: var(--accent-400);
}

/* ── Side panel ── */
.side {
  flex: 0 0 19rem;
  width: 19rem;
  background: var(--bg-sunken);
  border-left: 1px solid var(--border);
  padding: 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  overflow-y: auto;
}

.side-head {
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  font-weight: 800;
}

.side-head .icon-btn {
  margin-left: auto;
}

.icon-btn,
.rail-fab,
.side-fab {
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.45rem;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-dim);
  font-size: 0.78rem;
}

.side-fab {
  display: none;
}

.icon-btn:hover,
.rail-fab:hover,
.side-fab:hover {
  border-color: var(--accent-400);
  color: var(--accent-600);
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 1.5rem;
  transform: translateX(-50%);
  background: var(--text);
  color: #fff;
  font-size: 0.78rem;
  padding: 0.5rem 0.9rem;
  border-radius: 999px;
  box-shadow: var(--shadow-lg);
  z-index: 200;
}

.mobile-only {
  display: none;
}

/* ── Narrow screens ── */
@media (max-width: 1180px) {
  .side {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 40;
    transform: translateX(100%);
    transition: transform 160ms ease;
    box-shadow: var(--shadow-lg);
  }

  .side.open {
    transform: none;
  }

  .side-fab,
  .side-head {
    display: grid;
  }

  .side-head {
    display: flex;
  }
}

/* The app shell's navbar drops to its compact height below 768px (App.vue's
   own breakpoint), so the height budget has to switch at exactly that width.
   Switching at 860 left a 2rem page-scroll sliver in the band between. */
@media (max-width: 767.98px) {
  .groovy-app {
    height: calc(100vh - 4.75rem);
    height: calc(100dvh - 4.75rem);
  }
}

@media (max-width: 860px) {
  .rail {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 41;
    transform: translateX(-100%);
    transition: transform 160ms ease;
    box-shadow: var(--shadow-lg);
  }

  .rail.open {
    transform: none;
  }

  .mobile-only {
    display: grid;
  }

  .bpm-slider {
    display: none;
  }

  .readout {
    gap: 0.6rem;
  }

  .ro-stats {
    gap: 0.75rem;
  }
}
</style>
