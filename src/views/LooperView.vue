<!-- File: src/views/LooperView.vue -->
<!--
  Looper — record a loop, layer more on top while it plays, lay the loops out
  as a song, and hand the lot to REAPER.

  Built for getting an idea down without stopping to think about the tool. It
  is played from the keyboard, on the focused pad (arrows move the focus):
    Space   record — pressed again while recording, start the take over
    Enter   keep the take and move to the next empty pad (else play/stop)
    M / S   mute / solo        Delete   clear the pad
    T       trim               N        nudge against the others
  Auto on: noodle, find the groove, play it twice, Enter — one pass of it is
  kept (lib/looper/repeat.js). Off, or when nothing repeated: the first note
  to the Enter press. Either way Trim recuts it from the whole take.
  Everything heavier — editing, mixing, effects — is REAPER's job, which is
  why the export is a project with the tempo set and the loops laid out.

  Recording state, in `rec`:
    armed     first loop: waiting for the first note
    counting  the click's one-bar count-in before a first loop
    recording
    closing   kept; finishing to the bar line, then building the loop

  The design notes (timeline, seams, sync) are in components/looper/README.md.
-->
<template>
  <div class="looper-app" @pointerdown="onBackdrop">
    <!-- ── Top bar ── -->
    <header class="top">
      <div class="brand">
        <div class="eyebrow">Tools</div>
        <h1>Looper</h1>
      </div>

      <div class="transport">
        <button class="tb" :disabled="!store.canUndo || !!rec" title="Undo (Ctrl+Z)" @click="doUndo">
          <i class="pi pi-undo"></i>
        </button>
        <button class="tb" :disabled="!store.canRedo || !!rec" title="Redo (Ctrl+Shift+Z)" @click="doRedo">
          <i class="pi pi-undo mirror"></i>
        </button>

        <button
          class="play"
          :class="{ on: playing }"
          :disabled="!canPlay"
          :title="playing ? 'Stop (Enter)' : view === 'arrange' ? 'Play the song (Enter)' : 'Play (Enter)'"
          @click="togglePlay"
        >
          <i :class="playing ? 'pi pi-stop' : 'pi pi-play'"></i>
        </button>

        <button class="tb" :disabled="rec?.phase !== 'recording'" title="Start the take over (Space)" @click="pedal">
          <i class="pi pi-refresh"></i>
        </button>

        <button
          class="rec"
          :class="recButton.cls"
          :disabled="view === 'arrange' || rec?.phase === 'closing' || !!calibrating"
          :title="recButton.title"
          @click="rec ? keep() : pedal()"
        >
          <span class="rec-dot"></span>
          <span class="rec-label">{{ recButton.label }}</span>
        </button>

        <div class="tempo">
          <button
            class="tb click"
            :class="{ on: clickOn }"
            :disabled="!tempoKnown"
            :title="tempoKnown ? (clickOn ? 'Click off' : 'Click on') : 'No tempo yet — this loop was recorded free'"
            @click="toggleClick"
          >
            <i class="pi pi-stopwatch"></i>
          </button>
          <button class="bpm" :title="'Tempo'" @click.stop="tempoMenu = !tempoMenu">
            <b>{{ bpmLabel }}</b>
            <span>{{ meterLabel }}</span>
          </button>

          <div v-if="tempoMenu" class="pop tempo-pop" @pointerdown.stop>
            <template v-if="!store.master">
              <label class="pop-row">
                <span>BPM</span>
                <input
                  v-model="bpmDraft"
                  type="number"
                  min="40"
                  max="240"
                  step="1"
                  @blur="commitBpm"
                  @keydown.enter="commitBpm"
                />
              </label>
              <div class="pop-row">
                <span>Beats</span>
                <div class="seg sm">
                  <button v-for="n in [2, 3, 4, 6]" :key="n" :class="{ on: prefs.bpb === n }" @click="store.savePrefs({ bpb: n })">
                    {{ n }}
                  </button>
                </div>
              </div>
              <p class="pop-note">
                Click on: the first loop counts in a bar and snaps to it. Click off: the tempo is read from
                what you play.
              </p>
            </template>
            <template v-else-if="store.master.bpm">
              <div class="pop-row">
                <span>Read as</span>
                <div class="seg sm">
                  <button :disabled="!canHalve" @click="store.scaleTempo(0.5)">½×</button>
                  <button @click="store.scaleTempo(2)">2×</button>
                </div>
              </div>
              <p class="pop-note">Renames the grid if the tempo came out doubled or halved. The loop itself doesn't change.</p>
            </template>
            <p v-else class="pop-note">No tempo could be read from this loop. Start a session with Auto or the click on to get one.</p>
            <label class="pop-row">
              <span>Click</span>
              <input
                type="range"
                min="0"
                max="1.2"
                step="0.02"
                :value="prefs.clickLevel"
                @input="setClickLevel(+$event.target.value)"
              />
            </label>
          </div>
        </div>

        <button
          class="auto"
          :class="{ on: prefs.auto }"
          title="Auto: noodle, then play the groove twice and press Enter — it keeps one clean pass"
          @click="store.savePrefs({ auto: !prefs.auto })"
        >
          <i class="pi pi-wave-pulse"></i> Auto
        </button>
      </div>

      <div class="tools">
        <button class="tool" :class="{ warn: !inputOpen }" title="Input and sync" @click="sheet = 'input'">
          <i class="pi pi-sliders-h"></i><span>Input</span>
        </button>
        <button class="tool" title="Amp" @click="sheet = 'amp'">
          <i class="pi pi-bolt"></i><span>Amp</span>
        </button>
        <button
          class="tool"
          :class="{ on: prefs.showScale }"
          title="Scale map"
          @click="store.savePrefs({ showScale: !prefs.showScale })"
        >
          <i class="pi pi-th-large"></i><span>Scale</span>
        </button>
        <div class="seg views" role="tablist">
          <button :class="{ on: view === 'loops' }" @click="setView('loops')">Loops</button>
          <button :class="{ on: view === 'arrange' }" @click="setView('arrange')">Arrange</button>
        </div>
        <button class="tool" :disabled="store.isEmpty || !!rec" title="Save the session to a file (Ctrl+S)" @click="saveFile">
          <i class="pi pi-save"></i><span>Save</span>
        </button>
        <button class="tool" :disabled="!!rec" title="Open a saved session (Ctrl+O)" @click="fileEl?.click()">
          <i class="pi pi-folder-open"></i><span>Open</span>
        </button>
        <input ref="fileEl" type="file" accept=".looper,.zip" hidden @change="openFile" />
        <button class="tool" :disabled="store.isEmpty" title="Export" @click="sheet = 'export'">
          <i class="pi pi-download"></i><span>Export</span>
        </button>
      </div>
    </header>

    <!-- ── Stage ── -->
    <main class="stage">
      <section v-if="view === 'loops'" class="pads-wrap">
        <div ref="padsEl" class="pads">
          <LooperPad
            v-for="(l, i) in store.layers"
            :key="i"
            :data-slot="i"
            :index="i"
            :layer="l"
            :color="PAD_COLORS[i]"
            :state="padState(i)"
            :overlay="padOverlay(i)"
            :meta="padMeta(l)"
            :volume="l ? store.mix[l.id]?.volume ?? 1 : 1"
            :focused="focus === i"
            :muted="!!(l && store.mix[l.id]?.muted)"
            :soloed="!!(l && store.mix[l.id]?.solo)"
            :menu-open="menuSlot === i"
            @tap="tapPad(i)"
            @mute="store.toggleMute(l.id)"
            @solo="store.toggleSolo(l.id)"
            @toggle-menu="menuSlot = menuSlot === i ? null : i"
            @volume="store.setVolume(l.id, $event)"
            @rename="store.rename(l.id, $event)"
            @trim="openTrim(i)"
            @nudge="openNudge(i)"
            @download="download(loopWav(l, store.master.sr))"
            @clear="clearPad(i)"
          />
        </div>
        <p v-if="store.isEmpty && !rec" class="first-hint">
          <template v-if="!inputOpen">
            <button class="link" @click="openDevice(null)">Enable your input</button>, then press
            <kbd>Space</kbd> and play.
          </template>
          <template v-else-if="prefs.auto">Press <kbd>Space</kbd> and noodle. Once you've played the groove twice, <kbd>Enter</kbd> keeps it.</template>
          <template v-else>Press <kbd>Space</kbd> and play. <kbd>Enter</kbd> keeps the loop, <kbd>Space</kbd> again starts it over.</template>
        </p>
      </section>

      <div v-else ref="arrWrap" class="arr-wrap">
        <LooperArrange
          :layers="store.filled"
          :song="store.song"
          :block-frames="store.master?.len || 0"
          :sr="store.master?.sr || 48000"
          :bars="store.master?.bpm ? store.master.bars : null"
          @paint-start="store.beginSongEdit()"
          @cell="(id, b, on) => store.setCell(id, b, on)"
          @add-block="store.addBlock()"
          @remove-block="store.removeBlock($event)"
          @play-from="playSong($event)"
        />
      </div>
    </main>

    <section v-if="prefs.showScale" class="scale">
      <GroovyFretboard :value="scaleValue" :scales="ALL_SCALES" @update="onScale" />
    </section>

    <!-- ── Footer ── -->
    <footer class="foot">
      <button class="src" :title="inputOpen ? 'Input settings' : 'Enable input'" @click="inputOpen ? (sheet = 'input') : openDevice(null)">
        <span class="lvl"><span :style="{ width: Math.min(100, Math.sqrt(level / 0.5) * 100) + '%' }"></span></span>
        <span class="src-name">{{ inputOpen ? inputLabel : 'No input' }}</span>
        <span v-if="inputOpen && channelCount > 1" class="src-ch">· In {{ prefs.channelIndex + 1 }}</span>
      </button>
      <span class="status" :class="{ show: !!status }">{{ status }}</span>
      <span class="info">{{ masterInfo }}</span>
      <button
        class="new-sess"
        :class="{ armed: confirmNew }"
        :disabled="store.isEmpty || !!rec"
        :title="confirmNew ? 'Click again to discard everything here' : 'Discard this session and start again — Save first to keep it'"
        @click="newSession"
      >
        <i class="pi pi-trash"></i><span>{{ confirmNew ? 'Discard this session?' : 'New session' }}</span>
      </button>
    </footer>

    <!-- ── Sheets ── -->
    <GroovyModal :open="sheet === 'input'" title="Input" tone="dark" width="34rem" @close="sheet = null">
      <LooperInput
        :opened="inputOpen"
        :error="inputError"
        :devices="devices"
        :device-id="prefs.deviceId"
        :channel-count="channelCount"
        :channel-index="prefs.channelIndex"
        :level="level"
        :gate="prefs.gate"
        :sync-ms="syncMs"
        :sync-note="syncNote"
        :calibrating="calibrating"
        @open="openDevice"
        @channel="setChannel"
        @gate="setGate"
        @sync="(v) => setSync(v, 'set')"
        @calibrate="startCalibration"
        @cancel="cancelCalibration"
      />
    </GroovyModal>

    <GroovyModal :open="sheet === 'amp'" title="Amp" tone="dark" width="40rem" @close="sheet = null">
      <LooperAmp :value="prefs.amp" :instrument="prefs.instrument" @update="onAmp" @instrument="setInstrument" />
    </GroovyModal>

    <GroovyModal :open="sheet === 'export'" title="Export" tone="dark" width="32rem" @close="sheet = null">
      <div class="exp">
        <button class="exp-opt" @click="doExport('reaper')">
          <i class="pi pi-box"></i>
          <span><b>REAPER project</b><small>Each loop, plus a .rpp with the tempo set and the song laid out as looping items. The zip opens in the Looper again too.</small></span>
        </button>
        <button class="exp-opt" @click="doExport('stems')">
          <i class="pi pi-list"></i>
          <span><b>Stems</b><small>One full-length WAV per loop, all starting at zero.</small></span>
        </button>
        <button class="exp-opt" @click="doExport('mix')">
          <i class="pi pi-headphones"></i>
          <span><b>Mix</b><small>The song as a single WAV.</small></span>
        </button>
        <button v-if="lastTake" class="exp-opt" @click="doExport('take')">
          <i class="pi pi-wave-pulse"></i>
          <span><b>Last take</b><small>The whole last recording, unedited, as clean DI.</small></span>
        </button>
        <label class="exp-chk">
          <input type="checkbox" :checked="prefs.includeDi" @change="store.savePrefs({ includeDi: $event.target.checked })" />
          Include each loop's clean DI (muted tracks in REAPER)
        </label>
        <p class="exp-meta">{{ songSummary }} — the order comes from Arrange.</p>
      </div>
    </GroovyModal>

    <GroovyModal :open="sheet === 'trim'" title="Trim" tone="dark" width="60rem" @close="sheet = null">
      <LooperTrim
        v-if="trim"
        :src="trim.src"
        :sr="trim.sr"
        :start="trim.start"
        :end="trim.end"
        :free="trim.free"
        :unit="trim.unit"
        :allowed="trim.allowed"
        :unit-name="trim.unitName"
        :ac="engine.ac"
        @apply="applyTrim"
        @cancel="sheet = null"
      />
    </GroovyModal>

    <GroovyModal :open="sheet === 'nudge'" title="Nudge" tone="dark" width="60rem" @close="sheet = null">
      <LooperNudge
        v-if="nudge"
        :wet="nudge.wet"
        :sr="nudge.sr"
        :reference="nudge.reference"
        :beat="nudge.beat"
        :bar="nudge.bar"
        :division="nudge.division"
        :loop-len="nudge.loopLen"
        :color="nudge.color"
        :phase="nudgePhase"
        @preview="previewNudge"
        @apply="applyNudge"
        @cancel="sheet = null"
      />
    </GroovyModal>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, markRaw } from 'vue'
import { useLooperStore, PAD_COLORS, PADS, makeLayer } from '@/stores/looper'
import { LooperEngine } from '@/lib/looper/engine'
import { markedLoop, readTempo, onsetBoundary, tapBoundary, stopBoundary, layerUnits } from '@/lib/looper/detect'
import { findGroove, findGridGroove } from '@/lib/looper/repeat'
import { reaperZip, stemsZip, mixWav, loopWav, wavFloat, download, stamp } from '@/lib/looper/export'
import { sessionFile, sessionFiles, readSessionFile, atRate } from '@/lib/looper/session'
import { listInputDevices } from '@/lib/groovy/input'
import { CalibrationRun } from '@/lib/groovy/calibration'
import { ALL_SCALES } from '@/lib/groovy/scales'
import LooperPad from '@/components/looper/LooperPad.vue'
import LooperArrange from '@/components/looper/LooperArrange.vue'
import LooperInput from '@/components/looper/LooperInput.vue'
import LooperAmp from '@/components/looper/LooperAmp.vue'
import LooperTrim from '@/components/looper/LooperTrim.vue'
import LooperNudge from '@/components/looper/LooperNudge.vue'
import GroovyModal from '@/components/groovy/GroovyModal.vue'
import GroovyFretboard from '@/components/groovy/GroovyFretboard.vue'

const store = useLooperStore()
const prefs = computed(() => store.prefs)
const engine = markRaw(new LooperEngine())

// Raw capture kept either side of a region: the seam crossfade plus room for
// the sync to move later (before), the ringing tail plus the same (after).
const PRE = 0.4
const POST = 2.4
// How far back the repeat finder looks: the groove is found last, so the
// end of the take is where it is. Less while playing, where it only drives
// the "caught it" mark and runs every second and a half.
const CATCH_SEC = 120
const LIVE_CATCH_SEC = 40
// How much of the last take is kept in memory to trim from.
const TAKE_SEC = 120

const view = ref('loops')
const sheet = ref(null)
const menuSlot = ref(null)
// The pad the keys act on: Space records here, M/S/Delete apply here.
const focus = ref(0)
const tempoMenu = ref(false)
const padsEl = ref(null)
const fileEl = ref(null)
const arrWrap = ref(null)

const inputOpen = ref(false)
const inputError = ref('')
const inputLabel = ref('')
const devices = ref([])
const channelCount = ref(1)
const level = ref(0)

const playing = ref(false)
const songPlaying = ref(false)
const rec = ref(null)
const clock = ref(0)
const calibrating = ref(null)
const syncSource = ref('estimate')

const status = ref('')
let statusTimer = 0
function say(msg) {
  status.value = msg
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => (status.value = ''), 4500)
}

// ── Tempo ───────────────────────────────────────────────────────────────────
const tempoKnown = computed(() => (store.master ? !!store.master.bpm : true))
const clickOn = computed(() => prefs.value.click && tempoKnown.value)
const bpm = computed(() => store.master?.bpm ?? (store.master ? null : prefs.value.bpm))
const bpb = computed(() => store.master?.bpb ?? prefs.value.bpb)
const bpmLabel = computed(() => {
  if (bpm.value) return store.master ? bpm.value.toFixed(1) : String(bpm.value)
  return 'Free'
})
const meterLabel = computed(() => (bpm.value ? `${bpb.value}/4` : ''))
const canHalve = computed(() => {
  const m = store.master
  return !!m?.bpm && m.bars % 2 === 0
})

const bpmDraft = ref(String(prefs.value.bpm))
watch(
  () => prefs.value.bpm,
  (v) => (bpmDraft.value = String(v)),
)
function commitBpm() {
  const v = Math.round(Number(bpmDraft.value))
  if (v >= 40 && v <= 240) store.savePrefs({ bpm: v })
  else bpmDraft.value = String(prefs.value.bpm)
}

function toggleClick() {
  store.savePrefs({ click: !prefs.value.click })
  applyClick()
}

function setClickLevel(v) {
  store.savePrefs({ clickLevel: v })
  engine.setClick({ level: v })
}

function applyClick() {
  engine.setClick({ on: clickOn.value, bpm: bpm.value || 0, bpb: bpb.value, level: prefs.value.clickLevel })
}
watch([clickOn, bpm, bpb], applyClick)

const masterInfo = computed(() => {
  const m = store.master
  if (!m) {
    if (clickOn.value) return `${prefs.value.bpm} BPM · count-in`
    return prefs.value.auto ? 'Auto · catches the part you play twice' : 'Starts on your first note'
  }
  const sec = m.len / m.sr
  const dur = sec >= 60 ? `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}` : `${sec.toFixed(1)} s`
  return m.bpm ? `${m.bars} ${m.bars === 1 ? 'bar' : 'bars'} · ${m.bpm.toFixed(1)} BPM · ${dur}` : `Free · ${dur}`
})

// ── Pads ────────────────────────────────────────────────────────────────────
const canPlay = computed(() => !store.isEmpty && !rec.value)
const soloing = computed(() => store.filled.some((l) => store.mix[l.id]?.solo))

function padState(i) {
  const r = rec.value
  if (r && r.slot === i) return r.phase
  const l = store.layers[i]
  if (!l) return 'empty'
  const m = store.mix[l.id]
  if (m?.muted || (soloing.value && !m?.solo)) return 'muted'
  return playing.value ? 'playing' : 'stopped'
}

function padOverlay(i) {
  const r = rec.value
  if (!r || r.slot !== i) return ''
  void clock.value
  const now = engine.heardNow()
  if (r.phase === 'armed') return 'Play'
  if (r.phase === 'counting') {
    const beat = 60 / r.grid.bpm
    return String(Math.max(1, Math.ceil((r.grid.anchor - now) / beat)))
  }
  if (r.phase === 'closing') return ''
  if (r.found) return `${r.found} ✓`
  const t = Math.max(0, now - (r.onset ?? r.startedAt))
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
}

function padMeta(l) {
  const m = store.master
  if (!l || !m) return ''
  if (m.bpm) {
    const bars = Math.round(l.len / m.unit)
    return `${bars} ${bars === 1 ? 'bar' : 'bars'}`
  }
  const turns = Math.round(l.len / m.len)
  return turns > 1 ? `×${turns}` : `${(l.len / m.sr).toFixed(1)} s`
}

// The song ignores mute and solo (they are for listening while you play);
// a pad being recorded over is silent either way.
function gainOf(id, ignoreMix = false) {
  if (rec.value && store.layers[rec.value.slot]?.id === id) return 0
  const m = store.mix[id]
  if (!m) return 1
  if (!ignoreMix && (m.muted || (soloing.value && !m.solo))) return 0
  return m.volume
}

async function tapPad(i) {
  menuSlot.value = null
  focus.value = i
  const r = rec.value
  if (r) {
    if (r.slot === i) keep()
    return
  }
  const l = store.layers[i]
  if (!l) return beginRec(i)
  store.toggleMute(l.id)
}

function clearPad(i) {
  menuSlot.value = null
  const l = store.layers[i]
  if (!l) return
  store.clearLayer(i)
  say(`${l.name} cleared — Ctrl+Z brings it back.`)
}

// Keep the engine's players matching the store's layers. Called after
// anything that can change them: recording, undo, clearing, a restored
// session, a rebuilt context.
function syncEngine() {
  const want = new Map(store.filled.map((l) => [l.id, l]))
  for (const id of [...engine.players.keys()]) if (!want.has(id)) engine.removeLayer(id)
  for (const l of want.values()) {
    const p = engine.players.get(l.id)
    if (!p || p.data !== l.wet) engine.setLayer(l.id, l.wet, gainOf(l.id, songPlaying.value))
    else engine.setLayerGain(l.id, gainOf(l.id, songPlaying.value))
  }
  if (!want.size && playing.value && !rec.value) stopAll()
}
watch(() => [store.layers, store.mix], syncEngine)

// ── Transport ───────────────────────────────────────────────────────────────
function togglePlay() {
  if (playing.value) return stopAll()
  if (!canPlay.value) return
  if (view.value === 'arrange') return playSong(0)
  const ac = engine.ensure()
  if (!ac) return
  syncEngine()
  applyClick()
  engine.start(ac.currentTime + 0.08)
  playing.value = true
}

function stopAll() {
  if (rec.value) cancelRec()
  engine.stop()
  playing.value = false
  if (songPlaying.value) {
    songPlaying.value = false
    syncEngine()
  }
}

function playSong(from = 0) {
  const m = store.master
  if (!m || rec.value) return
  if (!engine.ensure()) return
  // The song plays every layer its cells switch on; pad mutes are a
  // live-playing thing and don't apply here (nor in the export).
  songPlaying.value = true
  syncEngine()
  applyClick()
  engine.playSong({
    blockSec: m.len / m.sr,
    blocks: store.song.blocks,
    rows: new Map(Object.entries(store.song.rows)),
    from: Math.min(from, store.song.blocks - 1),
  })
  playing.value = true
}

function setView(v) {
  if (view.value === v) return
  if (playing.value) stopAll()
  menuSlot.value = null
  view.value = v
}

// ── Recording ───────────────────────────────────────────────────────────────
const recButton = computed(() => {
  const r = rec.value
  if (!r) {
    const what = store.layers[focus.value] ? 'Record over' : 'Record into'
    return { cls: '', label: 'Rec', title: `${what} pad ${focus.value + 1} (Space)` }
  }
  if (r.phase === 'armed') return { cls: 'armed', label: 'Play…', title: 'Waiting for your first note — press again to cancel' }
  if (r.phase === 'counting') return { cls: 'armed', label: 'Count-in', title: 'Press again to cancel' }
  if (r.phase === 'closing') return { cls: 'closing', label: 'Closing', title: 'Finishing to the bar line' }
  return { cls: 'live', label: 'Keep', title: 'Keep this take (Enter)' }
})

// Space: record on the focused pad, or start the take in progress over.
function pedal() {
  if (view.value !== 'loops') setView('loops')
  const r = rec.value
  if (r?.phase === 'closing') return
  if (r) {
    cancelRec()
    return beginRec(r.slot)
  }
  beginRec(focus.value)
}

// Enter: keep the take and move on to the next empty pad. With nothing
// recording it plays and stops.
function keep() {
  const r = rec.value
  if (!r) return togglePlay()
  if (r.phase === 'closing') return
  if (r.phase === 'armed' || r.phase === 'counting') return cancelRec()
  focus.value = nextEmpty(r.slot)
  stopRec()
}

function nextEmpty(slot) {
  for (let k = 1; k < PADS; k++) {
    const i = (slot + k) % PADS
    if (!store.layers[i]) return i
  }
  return (slot + 1) % PADS
}

async function beginRec(slot) {
  if (calibrating.value) return
  if (!inputOpen.value) {
    await openDevice(null)
    if (!inputOpen.value) return
  }
  const ac = engine.ensure()
  // Recording over the only loop there is starts the session over; over a
  // pad among others, the take is cut to their grid like any overdub.
  const first = !store.filled.some((l) => l.slot !== slot)
  if (first && playing.value) {
    engine.stop()
    playing.value = false
  }
  const now = engine.heardNow()
  const m = first ? null : store.master
  const r = {
    slot,
    id: crypto.randomUUID(),
    first,
    phase: first ? 'armed' : 'recording',
    startedAt: now,
    onset: null,
    grid: null,
    stopS: null,
    startS: null,
    endS: null,
    // What Auto has caught so far, for the pad ("2 bars ✓").
    found: null,
  }

  if (first && clickOn.value) {
    // One bar of count-in, then bar one is where the click says.
    const beat = 60 / bpm.value
    const anchor = ac.currentTime + 0.1 + beat * bpb.value
    r.grid = { anchor, unit: beat * bpb.value, bpm: bpm.value, bpb: bpb.value }
    r.phase = 'counting'
    applyClick()
    engine.start(anchor)
    playing.value = true
  } else if (m) {
    if (!playing.value) {
      syncEngine()
      applyClick()
      engine.start(ac.currentTime + 0.08)
      playing.value = true
    }
    r.grid = { anchor: engine.anchor, unit: m.unit / m.sr }
  }

  // Keep the input from before the press: a late tap still gets its
  // downbeat, and a first note keeps the whole of its attack.
  const back = r.grid ? Math.min(r.grid.unit, 9) : 0
  engine.hold(engine.frameOf(now - PRE - Math.max(0.5, back)))
  rec.value = r
  syncEngine()
  startCatching()
}

function cancelRec() {
  stopCatching()
  const r = rec.value
  rec.value = null
  engine.release()
  if (r?.first) {
    engine.stop()
    playing.value = false
  }
  syncEngine()
}

function onOnset(d) {
  if (calibrating.value) return calOnset(d)
  const r = rec.value
  if (!r || r.onset != null || r.phase === 'closing') return
  const s = d.time - engine.rtSec
  if (r.phase === 'armed') {
    r.onset = s
    r.phase = 'recording'
  } else if (prefs.value.auto && r.grid && s >= r.grid.anchor - 0.15) {
    r.onset = s
  }
}

async function stopRec() {
  const r = rec.value
  if (!r) return
  if (r.phase === 'armed' || r.phase === 'counting') return cancelRec()
  if (r.phase === 'closing') return
  stopCatching()
  r.stopS = engine.heardNow()
  r.phase = 'closing'
  try {
    if (r.first && !r.grid) await finishFree(r)
    else await finishGrid(r)
  } catch (e) {
    console.error('[Looper] could not build the loop', e)
    say('Something went wrong making that loop — try again.')
    if (rec.value === r) cancelRec()
  }
}

function nameFor() {
  const base = !prefs.value.amp.on ? 'Audio' : prefs.value.instrument === 'guitar' ? 'Guitar' : 'Bass'
  const n = store.filled.filter((l) => l.name.startsWith(base)).length + 1
  return `${base} ${n}`
}

// ── Catching a repeat ───────────────────────────────────────────────────────
// With Auto on, the take is searched for a part played twice in a row —
// noodle, find the groove, play it again, Enter — and one pass of it is kept
// (lib/looper/repeat.js). Takes with no repeat fall back to first note → Enter.

// The loop lengths a take may come out as, in grid units.
function gridUnits(r) {
  if (r.first) return [1, 2, 3, 4, 6, 8]
  const m = store.master
  const M = Math.round(m.len / m.unit)
  const out = []
  for (let d = 1; d <= M; d++) if (M % d === 0) out.push(d)
  return [...out, M * 2, M * 4, M * 8]
}

// Search the take up to scheduled time `untilS`. On a grid: { startS, units };
// free: { startC, len, phase, bpm, bars }. Null when nothing was played twice.
function catchRepeat(r, untilS, stopS, maxSec, maxLagSec = 30) {
  const sr = engine.sr
  const endC = engine.frameOf(untilS)
  const c0 = Math.max(engine.frameOf(r.startedAt - PRE), endC - Math.round(maxSec * sr))
  const { dry } = engine.read(c0, endC)
  if (r.grid) {
    const { anchor, unit } = r.grid
    const at = engine.frameOf(anchor) - c0
    const res = findGridGroove(dry, sr, { anchor: at, unit: unit * sr, units: gridUnits(r) })
    if (!res) return null
    const j = Math.round((res.start - at) / (unit * sr))
    if (r.first && j < 0) return null
    return { startS: anchor + j * unit, units: res.units }
  }
  const res = findGroove(dry, sr, {
    stop: stopS != null ? engine.frameOf(stopS) - c0 : null,
    bpb: bpb.value,
    maxLagSec,
  })
  return res && { startC: c0 + res.start, len: res.len, phase: res.phase || 0, bpm: res.bpm, bars: res.bars }
}

function caughtLabel(c, r) {
  if (c.units != null) {
    const bars = r.grid.bpm || store.master?.bpm ? c.units : null
    return bars ? `${bars} ${bars === 1 ? 'bar' : 'bars'}` : `${(c.units * r.grid.unit).toFixed(1)} s`
  }
  return c.bars ? `${c.bars} ${c.bars === 1 ? 'bar' : 'bars'}` : `${(c.len / engine.sr).toFixed(1)} s`
}

// While playing, look every second and a half, so the pad can say when a
// repeat has been caught and Enter now will keep it.
let catchTimer = 0
function startCatching() {
  stopCatching()
  if (!prefs.value.auto) return
  catchTimer = setInterval(() => {
    const r = rec.value
    if (!r || r.phase !== 'recording') return
    const until = engine.capturedTo / engine.sr - engine.rtSec
    if (until - r.startedAt < 2.5) return
    try {
      const c = catchRepeat(r, until, null, LIVE_CATCH_SEC, 16)
      r.found = c ? caughtLabel(c, r) : null
    } catch (e) {
      console.warn('[Looper] live repeat check failed', e)
      stopCatching()
    }
  }, 1500)
}

function stopCatching() {
  clearInterval(catchTimer)
  catchTimer = 0
}

// The first loop with no click. Auto: one pass of the part played twice.
// Otherwise, or when nothing repeated: the first note to the press that kept
// it (markedLoop in lib/looper/detect.js).
async function finishFree(r) {
  const sr = engine.sr
  // A little past the press, for a downbeat played just after it.
  await engine.captured(engine.frameOf(r.stopS + 0.1))
  if (rec.value !== r) return

  let startC
  let len
  // How far into the loop the kept audio starts: a caught pass may begin a
  // beat or two after the downbeat, which stays the loop's first sample.
  let offset = 0
  let tempo = null
  const caught = prefs.value.auto ? catchRepeat(r, r.stopS + 0.1, r.stopS, CATCH_SEC) : null
  if (caught) {
    startC = caught.startC
    len = caught.len
    offset = caught.phase
    if (caught.bpm) tempo = { bpm: caught.bpm, bars: caught.bars }
  } else {
    const begin = r.onset ?? r.startedAt
    const c0 = engine.frameOf(begin - PRE)
    const { dry } = engine.read(c0, engine.frameOf(r.stopS + 0.1))
    const res = markedLoop(dry, sr, {
      startHint: engine.frameOf(begin) - c0,
      stopIdx: engine.frameOf(r.stopS) - c0,
      bpb: bpb.value,
    })
    startC = c0 + res.start
    len = res.len
    if (res.bpm) tempo = { bpm: res.bpm, bars: res.bars }
  }

  const startS = startC / sr - engine.rtSec
  r.startS = startS
  r.endS = startS + len / sr
  await engine.captured(startC + len + Math.round(0.06 * sr))
  if (rec.value !== r) return

  const master = {
    sr,
    len,
    bpm: tempo?.bpm ?? null,
    bpb: bpb.value,
    bars: tempo?.bars ?? null,
    unit: tempo ? len / tempo.bars : len,
  }
  // Played free, against nothing: the loop is its own reference, so it
  // does not move with the sync.
  commitLayer(r, { startC, len, offset, R: len, follow: false }, master, startS - offset / sr)
  const what = tempo ? `${tempo.bars} ${tempo.bars === 1 ? 'bar' : 'bars'} at ${tempo.bpm.toFixed(1)} BPM` : `${(len / sr).toFixed(1)} s`
  if (caught) say(`Caught the repeat · ${what}`)
  else if (prefs.value.auto) say(`No repeat found — kept first note to Enter (${what}). T to trim.`)
  else say(`Loop · ${what}`)
}

// The first loop against the click, or any layer over an existing loop:
// the grid is known, so start and end snap to it.
async function finishGrid(r) {
  const sr = engine.sr
  const { anchor, unit } = r.grid
  let caught = null
  if (prefs.value.auto) {
    await engine.captured(engine.frameOf(r.stopS + 0.06))
    if (rec.value !== r) return
    caught = catchRepeat(r, r.stopS + 0.06, r.stopS, CATCH_SEC)
  }
  let startS
  let endS
  if (caught) {
    startS = caught.startS
    endS = startS + caught.units * unit
  } else {
    if (prefs.value.auto && r.onset != null) startS = onsetBoundary(r.onset, anchor, unit)
    else if (r.first) startS = anchor
    else startS = tapBoundary(r.startedAt, anchor, unit)
    if (r.first) startS = Math.max(startS, anchor)
    endS = stopBoundary(r.stopS, startS, unit)
  }
  r.startS = startS
  r.endS = endS
  await engine.captured(engine.frameOf(endS) + Math.round(0.08 * sr))
  if (rec.value !== r) return

  const k = Math.round((endS - startS) / unit)
  const R = Math.round((endS - startS) * sr)
  let master = null
  let len
  let offset = 0
  if (r.first) {
    len = R
    master = { sr, len, bpm: r.grid.bpm, bpb: r.grid.bpb, bars: k, unit: len / k }
  } else {
    const m = store.master
    const masterUnits = Math.round(m.len / m.unit)
    // A caught repeat is already one of the allowed lengths.
    const units = caught ? k : layerUnits(k, masterUnits)
    // Multiples of the master are exact multiples of its samples, so long
    // layers never creep against it.
    len = units % masterUnits === 0 ? m.len * (units / masterUnits) : Math.round(units * m.unit)
    offset = (((Math.round((startS - anchor) * sr)) % len) + len) % len
  }
  commitLayer(r, { startC: engine.frameOf(startS), len, offset, R, follow: true }, master, r.first ? startS : null)
  const what = `${k} ${k === 1 ? 'bar' : 'bars'}`
  if (caught) say(r.first ? `Caught the repeat · ${what} at ${r.grid.bpm} BPM` : `Caught the repeat · ${caughtLabel({ units: k }, r)}`)
  else if (r.first) say(`Loop · ${what} at ${r.grid.bpm} BPM`)
}

function commitLayer(r, { startC, len, offset, R, follow }, master, newAnchor) {
  const sr = engine.sr
  const rawFrom = startC - Math.round(PRE * sr)
  const rawTo = Math.min(engine.capturedTo, startC + R + Math.round(POST * sr))
  const raw = engine.read(rawFrom, rawTo)
  // `base` is the region's start in raw with no sync applied; startC already
  // carries the sync it was recorded with.
  const syncFrames = Math.round(engine.rtSec * sr)
  const base = startC - rawFrom - (follow ? syncFrames : 0)
  // A take over a filled pad keeps its name and its place in the song order.
  const old = store.layers[r.slot]
  const layer = makeLayer(
    {
      id: r.id,
      slot: r.slot,
      name: old?.name ?? nameFor(),
      instrument: prefs.value.amp.on ? prefs.value.instrument : 'other',
      createdAt: old?.createdAt ?? Date.now(),
      len,
      offset,
      R,
      base,
      follow,
      raw,
    },
    syncFrames,
    sr,
  )
  // The whole take, to trim from (and for the "Last take" export). Read
  // before release(), which lets the ring drop it.
  const takeFrom = Math.max(engine.keepFrom ?? rawFrom, engine.capturedTo - Math.round(TAKE_SEC * sr))
  const take = engine.read(takeFrom, engine.capturedTo)
  lastTake.value = { layerId: layer.id, dry: take.dry, wet: take.wet, sr, regionStart: startC - takeFrom, R }
  rec.value = null
  engine.release()
  store.addLayer(layer, master)
  if (master && store.syncMs == null) store.syncMs = Math.round(engine.rtSec * 1000)
  engine.setLayer(layer.id, layer.wet, gainOf(layer.id))
  if (newAnchor != null) {
    // The loop's first sample is at newAnchor: play on from wherever that
    // puts us now, so the loop carries straight on from the take.
    engine.start(newAnchor)
    playing.value = true
  }
  refineTail(layer.id, rawFrom, startC + R + Math.round(POST * sr))
}

// The tail after a loop's end only exists a couple of seconds later. Once it
// has been captured, rebuild the loop with it — the ring of a held note then
// carries over the seam — and swap it in under the playing one.
function refineTail(id, rawFrom, needTo) {
  const ac = engine.ac
  engine.captured(needTo).then(() => {
    if (engine.ac !== ac) return
    const l = store.filled.find((x) => x.id === id)
    if (!l) return
    const have = rawFrom + l.raw.dry.length
    if (have >= needTo) return
    const ext = engine.read(have, needTo)
    const raw = { dry: concat(l.raw.dry, ext.dry), wet: concat(l.raw.wet, ext.wet) }
    const next = makeLayer({ ...l, raw }, syncFrames(l), store.master?.sr || engine.sr)
    store.replaceLayer(next)
  })
}

function concat(a, b) {
  const out = new Float32Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

function syncFrames() {
  return Math.round(((store.syncMs ?? 0) / 1000) * (store.master?.sr || engine.sr))
}

// ── Trim ────────────────────────────────────────────────────────────────────
// Recut a loop by hand. The source is the whole take while it's still in
// memory (the last one recorded), else what the layer kept: its region plus
// margins. Moving the start by d moves where the audio lands in the loop by
// d, so layers over a grid stay where they were relative to it.
const lastTake = shallowRef(null)
const trim = shallowRef(null)

function openTrim(i) {
  menuSlot.value = null
  const l = store.layers[i]
  if (!l || rec.value) return
  stopAll()
  const m = store.master
  const sr = m.sr
  const take = lastTake.value?.layerId === l.id ? lastTake.value : null
  const regionStart = take ? take.regionStart : l.base + (l.follow ? syncFrames() : 0)
  const src = take ? { dry: take.dry, wet: take.wet } : { dry: l.raw.dry, wet: l.raw.wet }
  // The only loop: any length, and the tempo is read again from the cut.
  // Among others: whole grid units of the lengths the others allow.
  const free = !store.filled.some((x) => x.id !== l.id)
  const M = Math.round(m.len / m.unit)
  const allowed = []
  for (let d = 1; d <= M; d++) if (M % d === 0) allowed.push(d)
  allowed.push(M * 2, M * 4, M * 8)
  trim.value = {
    slot: i,
    layerId: l.id,
    src,
    sr,
    fromTake: !!take,
    start: regionStart,
    start0: regionStart,
    end: Math.min(src.wet.length, regionStart + (free ? l.len : l.R)),
    free,
    unit: Math.round(m.unit),
    allowed,
    unitName: m.bpm ? 'bar' : 'loop',
  }
  sheet.value = 'trim'
}

function applyTrim({ start, end }) {
  const t = trim.value
  const l = store.layers[t?.slot]
  sheet.value = null
  if (!l || l.id !== t.layerId) return
  const m = store.master
  const sr = m.sr
  const sync = l.follow ? syncFrames() : 0
  const R = end - start
  const rawFrom = Math.max(0, start - Math.round(PRE * sr))
  const rawTo = Math.min(t.src.dry.length, end + Math.round(POST * sr))
  const raw = { dry: t.src.dry.slice(rawFrom, rawTo), wet: t.src.wet.slice(rawFrom, rawTo) }
  let master = null
  let len
  let offset
  if (t.free) {
    len = R
    offset = 0
    const tempo = readTempo(t.src.dry, sr, start, len, m.bpb)
    master = { sr, len, bpm: tempo.bpm, bpb: m.bpb, bars: tempo.bars, unit: tempo.bars ? len / tempo.bars : len }
  } else {
    const units = Math.max(1, Math.round(R / m.unit))
    const M = Math.round(m.len / m.unit)
    len = units % M === 0 ? m.len * (units / M) : Math.round(units * m.unit)
    offset = ((Math.round(l.offset + start - t.start0) % len) + len) % len
  }
  const next = makeLayer(
    {
      id: crypto.randomUUID(),
      slot: l.slot,
      name: l.name,
      instrument: l.instrument,
      createdAt: l.createdAt,
      len,
      offset,
      R,
      base: start - rawFrom - sync,
      follow: l.follow,
      raw,
    },
    sync,
    sr,
  )
  store.addLayer(next, master)
  // Trimming the same loop again still works from the whole take.
  if (t.fromTake) lastTake.value = { ...lastTake.value, layerId: next.id, regionStart: start, R }
  say('Trimmed — Ctrl+Z undoes it.')
}

// ── Nudge ───────────────────────────────────────────────────────────────────
// Move a loop in time against the others (LooperNudge.vue). Every layer
// loops from the same anchor, so position k of this loop plays against
// o.wet[k mod o.len] of every other — that sum is the reference lane. The
// shift is heard live as a rotated copy of the buffer; Apply rebuilds the
// layer at offset + shift, which is the same sound, kept in the session.
const nudge = shallowRef(null)

function openNudge(i) {
  menuSlot.value = null
  const l = store.layers[i]
  if (!l || rec.value) return
  if (songPlaying.value || view.value !== 'loops') stopAll()
  const m = store.master
  const others = store.filled.filter((o) => o.id !== l.id && gainOf(o.id) > 0)
  let reference = null
  if (others.length) {
    reference = new Float32Array(l.len)
    for (const o of others) for (let k = 0; k < l.len; k++) reference[k] += o.wet[k % o.len]
  }
  const beat = m.bpm ? m.unit / m.bpb : null
  nudge.value = {
    slot: i,
    layerId: l.id,
    wet: l.wet,
    sr: m.sr,
    reference,
    beat,
    bar: m.bpm ? m.unit : null,
    division: beat ? beat / 4 : m.len / 16,
    loopLen: m.len,
    color: PAD_COLORS[i],
  }
  sheet.value = 'nudge'
  // Judged by ear: the loops play while the sheet is open.
  if (!playing.value) togglePlay()
}

function nudgePhase() {
  const n = nudge.value
  if (!n || !playing.value || !engine.ac) return null
  return engine.phase(n.wet.length / n.sr, engine.heardNow())
}

function rotate(buf, d) {
  const n = buf.length
  const s = ((Math.round(d) % n) + n) % n
  const out = new Float32Array(n)
  out.set(buf.subarray(0, n - s), s)
  out.set(buf.subarray(n - s), 0)
  return out
}

function previewNudge(shift) {
  const n = nudge.value
  const l = n && store.filled.find((x) => x.id === n.layerId)
  if (!l) return
  engine.setLayer(l.id, shift ? rotate(l.wet, shift) : l.wet, gainOf(l.id))
}

function applyNudge(shift) {
  const n = nudge.value
  const l = n && store.filled.find((x) => x.id === n.layerId)
  sheet.value = null
  if (!l || !shift) return
  const offset = (((l.offset + Math.round(shift)) % l.len) + l.len) % l.len
  const next = makeLayer({ ...l, id: crypto.randomUUID(), offset }, l.follow ? syncFrames() : 0, store.master.sr)
  store.addLayer(next)
  if (lastTake.value?.layerId === l.id) lastTake.value = { ...lastTake.value, layerId: next.id }
  const ms = ((shift > l.len / 2 ? shift - l.len : shift) / store.master.sr) * 1000
  say(`Nudged ${ms > 0 ? '+' : '−'}${Math.abs(ms).toFixed(0)} ms — Ctrl+Z undoes it.`)
}

watch(sheet, (v) => {
  if (v !== 'trim') trim.value = null
  if (v !== 'nudge' && nudge.value) {
    // Closed without applying: put the loop back as it was. (After Apply the
    // old layer is gone and syncEngine swaps the new one in.)
    const l = store.filled.find((x) => x.id === nudge.value.layerId)
    if (l) engine.setLayer(l.id, l.wet, gainOf(l.id))
    nudge.value = null
  }
})

// ── Sync ────────────────────────────────────────────────────────────────────
const syncMs = computed(() => store.syncMs ?? 0)

const syncNote = computed(() => {
  if (syncSource.value === 'estimate') return 'That number is the browser’s guess — measure it once for tight overdubs.'
  if (syncSource.value === 'measured') return 'Measured on this input.'
  return ''
})

let rebuildTimer = 0
function setSync(ms, source) {
  store.syncMs = ms
  syncSource.value = source
  engine.rtSec = ms / 1000
  if (prefs.value.deviceId) store.savePrefs({ sync: { ...prefs.value.sync, [prefs.value.deviceId]: ms } })
  // Re-cut every layer that was played along to something, at the new sync.
  clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    const sr = store.master?.sr
    if (!sr) return
    const f = Math.round((ms / 1000) * sr)
    for (const l of store.filled) if (l.follow) store.replaceLayer(makeLayer(l, f, sr))
  }, 150)
}

let calRun = null
let calTimer = 0

function startCalibration() {
  if (!inputOpen.value) return
  stopAll()
  const ac = engine.ensure()
  calRun = new CalibrationRun(ac, { count: 10, intervalSec: 1.0 })
  calRun.start()
  calibrating.value = { heard: 0, target: 10, values: [] }
  calTimer = setTimeout(finishCalibration, (calRun.endsAt - ac.currentTime + 1.0) * 1000)
}

function calOnset(d) {
  const m = calRun?.match(d.time)
  const c = calibrating.value
  if (!m || !c || c.values.some((v) => v.index === m.index)) return
  c.values.push({ index: m.index, ms: m.devMs })
  c.heard = c.values.length
}

function finishCalibration() {
  const c = calibrating.value
  cancelCalibration()
  if (!c) return
  // The first two clicks are for settling in.
  const v = c.values.filter((x) => x.index >= 2).map((x) => x.ms).sort((a, b) => a - b)
  if (v.length < 4) return say('Not enough notes heard — try again, one note per click.')
  const spread = v[Math.floor(v.length * 0.8)] - v[Math.floor(v.length * 0.2)]
  if (spread > 40) return say('Those notes were too scattered to trust — try again.')
  const med = Math.round(v[Math.floor(v.length / 2)])
  setSync(med, 'measured')
  say(`Sync set to ${med} ms.`)
}

function cancelCalibration() {
  calRun?.stop()
  calRun = null
  clearTimeout(calTimer)
  calibrating.value = null
}

// ── Input ───────────────────────────────────────────────────────────────────
// One open at a time. "Enable input" then Space straight away would otherwise
// start a second open over the first, and the two would trade nodes between
// audio contexts.
let opening = null
function openDevice(deviceId) {
  if (!opening) opening = doOpenDevice(deviceId).finally(() => (opening = null))
  return opening
}

async function doOpenDevice(deviceId) {
  inputError.value = ''
  try {
    const info = await engine.open({
      deviceId: deviceId ?? prefs.value.deviceId,
      channelIndex: prefs.value.channelIndex,
      matchRate: store.isEmpty,
    })
    channelCount.value = info.channelCount
    inputLabel.value = info.label
    store.savePrefs({
      deviceId: info.deviceId,
      channelIndex: Math.min(prefs.value.channelIndex, info.channelCount - 1),
    })
    engine.onOnset = onOnset
    engine.onLevel = onLevel
    engine.setDetector({ gate: prefs.value.gate, sensitivity: prefs.value.sensitivity })
    applyAmp()
    applyClick()

    // A new session starts from what this input measured last time, or the
    // browser's own estimate. A session in progress keeps its sync.
    if (store.isEmpty || store.syncMs == null) {
      const saved = prefs.value.sync[info.deviceId]
      const est = Math.round((engine.outLatency + (info.latencyHint || 0)) * 1000)
      store.syncMs = saved ?? est
      syncSource.value = saved != null ? 'saved' : 'estimate'
    }
    engine.rtSec = store.syncMs / 1000
    inputOpen.value = true
    devices.value = await listInputDevices()
    syncEngine()
  } catch (e) {
    console.error('[Looper] input error', e)
    inputError.value =
      e?.name === 'NotAllowedError'
        ? 'Microphone permission was refused. Allow it for this site and try again.'
        : e?.message || 'Could not open that input.'
    inputOpen.value = false
    sheet.value = 'input'
  }
}

function setChannel(i) {
  store.savePrefs({ channelIndex: i })
  engine.setChannel(i)
}

function setGate(v) {
  store.savePrefs({ gate: v })
  engine.setDetector({ gate: v, sensitivity: prefs.value.sensitivity })
}

let pinnedSince = 0
function onLevel(d) {
  level.value = d.rms
  // Runaway guard, as in Groovy: an input pinned at full scale while we drive
  // the output is the output getting back in, not playing.
  if (prefs.value.amp.monitor && d.peak >= 0.99 && d.rms > 0.35) {
    const now = performance.now()
    if (!pinnedSince) pinnedSince = now
    else if (now - pinnedSince > 1000) {
      pinnedSince = 0
      onAmp({ monitor: false })
      say('Monitoring cut — the input was pinned, so the output is getting back in.')
    }
  } else {
    pinnedSince = 0
  }
}

// ── Amp and scale ───────────────────────────────────────────────────────────
function applyAmp() {
  const a = prefs.value.amp
  engine.setAmp({ gain: a.gain, drive: a.drive, compress: a.compress, bass: a.bass, mid: a.mid, treble: a.treble, level: a.level })
  engine.setAmpOn(a.on)
  engine.setMonitor(a.monitor)
  engine.setVoicing(prefs.value.instrument)
}

function onAmp(patch) {
  store.saveAmp(patch)
  applyAmp()
}

function setInstrument(v) {
  store.savePrefs({ instrument: v })
  engine.setVoicing(v)
  const t = prefs.value.scale.tuning
  if (v === 'guitar' && t !== 'guitar') store.saveScale({ tuning: 'guitar' })
  else if (v === 'bass' && t === 'guitar') store.saveScale({ tuning: 'bass4' })
}

const scaleValue = computed(() => ({ ...prefs.value.scale, open: true }))

function onScale(patch) {
  if (patch.open === false) return store.savePrefs({ showScale: false })
  store.saveScale(patch)
}

// ── Undo, sessions, export ──────────────────────────────────────────────────
function doUndo() {
  if (rec.value || !store.undo()) return
  if (!store.master) stopAll()
}

function doRedo() {
  if (rec.value || !store.redo()) return
}

// Two clicks: the first only arms it (the button turns solid red and asks),
// the second within four seconds discards. Undo brings it back, but only
// until the page reloads — the saved copy in this browser is replaced.
const confirmNew = ref(false)
let confirmTimer = 0
function newSession() {
  if (rec.value || store.isEmpty) return
  clearTimeout(confirmTimer)
  if (!confirmNew.value) {
    confirmNew.value = true
    confirmTimer = setTimeout(() => (confirmNew.value = false), 4000)
    return
  }
  confirmNew.value = false
  stopAll()
  store.clearAll()
  lastTake.value = null
  say('Session discarded — Ctrl+Z brings it back until you reload.')
}

// ── Save and open ───────────────────────────────────────────────────────────
// The session as a file (lib/looper/session.js): the raw takes and everything
// that cuts and arranges them, so it opens exactly as it was — trims, nudges
// and all — here or in another browser. This browser also keeps its own copy
// of the current session; a file is how to keep more than one.
function saveFile() {
  if (store.isEmpty || rec.value) return
  try {
    download(sessionFile(store.sessionData(), `Looper ${stamp()}.looper`))
    say('Saved — Open brings it back, here or on another machine.')
  } catch (e) {
    console.error('[Looper] save failed', e)
    say('Saving failed — see the console.')
  }
}

async function openFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || rec.value) return
  say('Opening…')
  try {
    let data = await readSessionFile(file)
    // Loops play at the audio context's rate; a session made at another rate
    // is resampled to it.
    const ac = engine.ensure()
    if (ac) data = await atRate(data, ac.sampleRate)
    // Fresh ids: the same file opened twice, or over its own session, must
    // not share ids with layers undo still holds.
    const ids = new Map(data.layers.map((l) => [l.id, crypto.randomUUID()]))
    const remap = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [ids.get(k) ?? k, v]))
    data = {
      ...data,
      layers: data.layers.map((l) => ({ ...l, id: ids.get(l.id) })),
      mix: remap(data.mix),
      song: data.song && { ...data.song, rows: remap(data.song.rows) },
    }
    stopAll()
    const had = !store.isEmpty
    store.applySession(data, { undoable: had })
    lastTake.value = null
    if (store.syncMs != null) engine.rtSec = store.syncMs / 1000
    syncSource.value = 'saved'
    focus.value = Math.max(0, store.layers.findIndex((l) => !l))
    say(had ? `Opened ${file.name} — Ctrl+Z brings back what was here.` : `Opened ${file.name}.`)
  } catch (err) {
    console.error('[Looper] could not open', err)
    say(err?.message || 'Could not open that file.')
  }
}

const songSummary = computed(() => {
  const m = store.master
  if (!m) return ''
  const sec = (store.song.blocks * m.len) / m.sr
  const dur = `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
  const tempo = m.bpm ? ` · ${m.bpm.toFixed(1)} BPM` : ''
  return `${store.song.blocks} blocks · ${dur}${tempo}`
})

function doExport(kind) {
  if (kind === 'take') {
    const t = lastTake.value
    if (!t) return
    download({ blob: new Blob([wavFloat(t.dry, t.sr)], { type: 'audio/wav' }), name: 'Looper take.wav' })
    sheet.value = null
    return
  }
  const m = store.master
  if (!m) return
  const session = {
    sr: m.sr,
    bpm: m.bpm,
    bpb: m.bpb,
    blockLen: m.len,
    layers: store.filled,
    mix: store.mix,
    song: store.song,
  }
  const opts = { includeDi: prefs.value.includeDi }
  try {
    if (kind === 'reaper') download(reaperZip(session, { ...opts, extra: sessionFiles(store.sessionData(), 'Session/') }))
    else if (kind === 'stems') download(stemsZip(session, opts))
    else download(mixWav(session))
    sheet.value = null
    if (kind === 'reaper') say('Unzip it and open Looper.rpp — the zip itself also opens in the Looper.')
  } catch (e) {
    console.error('[Looper] export failed', e)
    say('Export failed — see the console.')
  }
}

// ── Animation ───────────────────────────────────────────────────────────────
let raf = 0
let lastClock = 0

function tick(ts) {
  raf = requestAnimationFrame(tick)
  if (ts - lastClock > 100) {
    lastClock = ts
    clock.value++
  }
  if (!engine.ac) return
  const now = engine.heardNow()
  const r = rec.value
  if (r?.phase === 'counting' && now >= r.grid.anchor) {
    r.phase = 'recording'
    r.startedAt = r.grid.anchor
  }

  const m = store.master
  if (view.value === 'loops' && padsEl.value) {
    for (const el of padsEl.value.children) {
      const i = Number(el.dataset.slot)
      const l = store.layers[i]
      if (l && playing.value && m) el.style.setProperty('--turn', engine.phase(l.len / m.sr, now))
      if (r && r.slot === i) el.style.setProperty('--rec', recProgress(r, now, m))
      else el.style.setProperty('--rec', 0)
    }
  }

  if (view.value === 'arrange' && arrWrap.value && m) {
    const grid = arrWrap.value.querySelector('.arr-grid')
    if (grid) grid.style.setProperty('--head', songPlaying.value ? Math.max(0, (now - engine.anchor) / (m.len / m.sr)) : -100)
  }

  if (songPlaying.value && engine.songEnd != null && now >= engine.songEnd) stopAll()
}

// How far round the red ring is: the current turn of the loop while layering,
// the current bar on a click take, and the way to the bar line once closing.
function recProgress(r, now, m) {
  if (r.phase === 'closing' && r.endS != null && r.startS != null) {
    return Math.min(1, Math.max(0, (now - r.startS) / (r.endS - r.startS)))
  }
  if (r.phase !== 'recording') return 0
  if (m) return engine.phase(m.len / m.sr, now)
  if (r.grid) return (((now - r.grid.anchor) % r.grid.unit) + r.grid.unit) % r.grid.unit / r.grid.unit
  return 1
}

// ── Keys and clicks ─────────────────────────────────────────────────────────
function onKey(e) {
  if (e.target.closest?.('input, select, textarea')) {
    if (e.key === 'Escape') e.target.blur()
    return
  }
  if (e.key === 'Escape') {
    if (menuSlot.value != null) menuSlot.value = null
    else if (tempoMenu.value) tempoMenu.value = false
    else if (sheet.value) sheet.value = null
    else if (calibrating.value) cancelCalibration()
    else if (rec.value) cancelRec()
    return
  }
  if (sheet.value) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    return e.shiftKey ? doRedo() : doUndo()
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    return doRedo()
  }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault()
    return saveFile()
  }
  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    if (!rec.value) fileEl.value?.click()
    return
  }
  if (mod || e.altKey) return
  // A focused button would also fire on Space/Enter; take the key from it.
  if (e.code === 'Space' || e.key === 'Enter') {
    e.preventDefault()
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur()
    if (e.repeat) return
    return e.code === 'Space' ? pedal() : keep()
  }
  if (view.value !== 'loops') return
  if (/^[1-8]$/.test(e.key)) return tapPad(Number(e.key) - 1)
  if (e.key.startsWith('Arrow')) {
    e.preventDefault()
    return moveFocus(e.key)
  }
  const key = e.key.toLowerCase()
  if ((key === 't' || key === 'n') && !rec.value) {
    // Focus moves on after a take; T or N right after one acts on that take.
    const last = store.layers.findIndex((x) => x && x.id === lastTake.value?.layerId)
    const i = store.layers[focus.value] ? focus.value : last
    if (i >= 0) (key === 't' ? openTrim : openNudge)(i)
    return
  }
  const l = store.layers[focus.value]
  if (!l) return
  if (key === 'm') store.toggleMute(l.id)
  else if (key === 's') store.toggleSolo(l.id)
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !rec.value) {
    e.preventDefault()
    clearPad(focus.value)
  }
}

// Left/right step through the pads in order; up/down move a row, however
// many columns the layout has right now.
function moveFocus(key) {
  const cols = padsEl.value ? getComputedStyle(padsEl.value).gridTemplateColumns.split(' ').length : 4
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[key]
  const i = focus.value + (step || 0)
  if (step && i >= 0 && i < PADS) focus.value = i
  menuSlot.value = null
}

function onBackdrop(e) {
  if (menuSlot.value != null && !e.target.closest('.pad-menu, .more')) menuSlot.value = null
  if (tempoMenu.value && !e.target.closest('.tempo-pop, .bpm')) tempoMenu.value = false
}

watch(
  () => store.ready,
  (ok) => {
    if (!ok) return
    focus.value = Math.max(0, store.layers.findIndex((l) => !l))
    if (!store.isEmpty) {
      syncSource.value = 'saved'
      syncEngine()
    }
  },
  { immediate: true },
)

watch(
  () => store.master,
  (m) => {
    if (!m && playing.value && !rec.value) stopAll()
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKey)
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(raf)
  clearTimeout(statusTimer)
  clearTimeout(rebuildTimer)
  clearTimeout(confirmTimer)
  cancelCalibration()
  stopCatching()
  if (rec.value) cancelRec()
  engine.dispose()
})
</script>

<style scoped>
.looper-app {
  --accent-500: #ef4444;
  --accent-600: #b91c1c;
  --accent-400: #f87171;
  --accent-100: #fee2e2;
  --accent-050: rgba(239, 68, 68, 0.12);

  --bg: #121110;
  --bg-raised: #1f1d1b;
  --bg-card: #1a1817;
  --bg-sunken: #161514;
  --border: #33302d;
  --border-soft: #262422;
  --text: #f4f3ef;
  --text-dim: #aaa59e;
  --text-faint: #6f6b65;
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.4);

  /* GroovyFretboard on a dark board */
  --fb-field: #121110;
  --fb-board: #191716;
  --fb-inlay: #2c2926;
  --fb-wire: #3a3633;
  --fb-nut: #8a857e;
  --fb-string: #6f6a63;
  --fb-fretnum: #5c5853;
  --fb-dot: #e9e6df;
  --fb-dot-ink: #141312;

  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size: 0.9375rem;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  color: var(--text);
  background: var(--bg);
  color-scheme: dark;
  height: calc(100vh - 6.75rem);
  height: calc(100dvh - 6.75rem);
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

/* A blank slate for every button and field in the tool, the child components'
   included (a scoped rule alone stops at this file's own elements). Kept at
   the lowest specificity so any component's own class wins. */
:where(.looper-app) :deep(:where(button)) {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

:where(.looper-app) :deep(:where(button:disabled)) {
  opacity: 0.35;
  cursor: not-allowed;
}

:where(.looper-app) :deep(:where(input, select)) {
  font: inherit;
  color: inherit;
}

kbd {
  font: inherit;
  font-size: 0.8em;
  font-weight: 700;
  padding: 0.05rem 0.4rem;
  border-radius: 0.3rem;
  border: 1px solid var(--border);
  background: var(--bg-raised);
}

/* ── Top bar ── */
.top {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1.25rem 0.5rem;
}

.eyebrow {
  font-size: 0.66rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--accent-500);
}

.brand h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.transport {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem;
  border-radius: 999px;
  background: var(--bg-raised);
  border: 1px solid var(--border-soft);
}

.tb {
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--text-dim);
  font-size: 1.05rem;
}

.tb:hover:not(:disabled) {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.mirror {
  transform: scaleX(-1);
}

.play {
  width: 3.2rem;
  height: 3.2rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 1.15rem;
  background: rgba(34, 197, 94, 0.16);
  color: #4ade80;
  margin: 0 0.15rem;
}

.play:hover:not(:disabled) {
  background: rgba(34, 197, 94, 0.26);
}

.play.on {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text);
}

.rec {
  height: 3.2rem;
  min-width: 7.5rem;
  padding: 0 1.1rem 0 0.9rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  background: rgba(239, 68, 68, 0.14);
  color: var(--accent-400);
  font-weight: 800;
  font-size: 0.88rem;
}

.rec:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.22);
}

.rec-dot {
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  background: var(--accent-500);
  flex-shrink: 0;
}

.rec.armed .rec-dot {
  animation: blink 900ms ease-in-out infinite;
}

.rec.live {
  background: var(--accent-500);
  color: #fff;
}

.rec.live .rec-dot {
  border-radius: 0.2rem;
  background: #fff;
}

.rec.closing .rec-dot {
  animation: blink 400ms ease-in-out infinite;
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}

.tempo {
  position: relative;
  display: flex;
  align-items: center;
  margin-left: 0.2rem;
}

.click.on {
  color: var(--text);
  background: rgba(255, 255, 255, 0.1);
}

.bpm {
  height: 2.6rem;
  padding: 0 0.6rem;
  border-radius: 0.7rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  line-height: 1.1;
}

.bpm b {
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}

.bpm span {
  font-size: 0.66rem;
  color: var(--text-faint);
}

.bpm:hover {
  background: rgba(255, 255, 255, 0.06);
}

.auto {
  height: 2.6rem;
  padding: 0 0.9rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 800;
  font-size: 0.82rem;
  color: var(--text-faint);
  border: 1px solid var(--border);
}

.auto.on {
  color: #fde68a;
  border-color: rgba(234, 179, 8, 0.5);
  background: rgba(234, 179, 8, 0.1);
}

.tools {
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.tool {
  height: 2.4rem;
  padding: 0 0.7rem;
  border-radius: 0.6rem;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--text-dim);
  font-weight: 700;
  font-size: 0.82rem;
}

.tool:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-raised);
}

.tool.on {
  color: var(--text);
  background: var(--bg-raised);
}

.tool.warn .pi {
  color: var(--accent-400);
}

.seg {
  display: inline-flex;
  padding: 0.15rem;
  gap: 0.15rem;
  border-radius: 0.6rem;
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
}

.seg button {
  height: 2rem;
  padding: 0 0.75rem;
  border-radius: 0.45rem;
  font-weight: 700;
  font-size: 0.8rem;
  color: var(--text-faint);
}

.seg button.on {
  background: var(--bg-raised);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}

.seg.sm button {
  height: 1.7rem;
  padding: 0 0.6rem;
}

.views {
  margin: 0 0.3rem;
}

/* ── Popover ── */
.pop {
  position: absolute;
  top: calc(100% + 0.6rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  width: 17rem;
  padding: 0.8rem;
  border-radius: 0.9rem;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.pop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-dim);
}

.pop-row > span {
  font-weight: 700;
}

.pop-row input[type='number'] {
  width: 4.5rem;
  height: 2rem;
  border-radius: 0.45rem;
  border: 1px solid var(--border);
  background: var(--bg);
  padding: 0 0.45rem;
  text-align: right;
}

.pop-row input[type='range'] {
  flex: 1;
  accent-color: var(--accent-500);
}

.pop-note {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-faint);
  line-height: 1.4;
}

/* ── Stage ── */
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.5rem 1.25rem 0.75rem;
}

.pads-wrap {
  flex: 1;
  min-height: 0;
  container-type: size;
  position: relative;
  display: grid;
  place-items: center;
}

.pads {
  --gap: clamp(1rem, 4cqw, 2.75rem);
  --cap: 1.7rem;
  --pad: min(calc((100cqw - 3 * var(--gap)) / 4), calc((100cqh - var(--gap) - 2 * var(--cap)) / 2), 16rem);
  display: grid;
  grid-template-columns: repeat(4, var(--pad));
  gap: var(--gap);
  row-gap: calc(var(--gap) * 0.6);
}

.first-hint {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  margin: 0;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-faint);
}

.link {
  color: var(--accent-400);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 0.2em;
}

.arr-wrap {
  flex: 1;
  min-height: 0;
  padding-top: 0.5rem;
}

.scale {
  flex-shrink: 0;
  padding: 0 1.25rem 0.6rem;
}

/* ── Footer ── */
.foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1.25rem;
  border-top: 1px solid var(--border-soft);
  font-size: 0.8rem;
  color: var(--text-dim);
  min-height: 2.6rem;
}

.src {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  max-width: 40%;
}

.src:hover .src-name {
  color: var(--text);
}

.lvl {
  flex-shrink: 0;
  width: 4.5rem;
  height: 0.4rem;
  border-radius: 999px;
  background: var(--bg-raised);
  overflow: hidden;
}

.lvl span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #16a34a, #84cc16 70%, #eab308);
  transition: width 60ms linear;
}

.src-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.src-ch {
  color: var(--text-faint);
  white-space: nowrap;
}

.status {
  flex: 1;
  text-align: center;
  color: var(--text);
  opacity: 0;
  transition: opacity 200ms ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status.show {
  opacity: 1;
}

.info {
  margin-left: auto;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Destructive, so it lives away from the tools and looks it. */
.new-sess {
  flex-shrink: 0;
  height: 1.9rem;
  padding: 0 0.75rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--accent-400);
  border: 1px solid rgba(239, 68, 68, 0.45);
  white-space: nowrap;
}

.new-sess:hover:not(:disabled) {
  background: var(--accent-050);
}

.new-sess.armed {
  background: var(--accent-500);
  border-color: var(--accent-500);
  color: #fff;
}

/* ── Export ── */
.exp {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.exp-opt {
  display: flex;
  align-items: flex-start;
  gap: 0.85rem;
  padding: 0.85rem 1rem;
  border-radius: 0.8rem;
  border: 1px solid var(--border);
  text-align: left;
}

.exp-opt:hover {
  border-color: var(--accent-500);
  background: var(--accent-050);
}

.exp-opt .pi {
  font-size: 1.1rem;
  color: var(--accent-400);
  margin-top: 0.15rem;
}

.exp-opt span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.exp-opt small {
  font-size: 0.78rem;
  color: var(--text-faint);
  line-height: 1.4;
}

.exp-chk {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.82rem;
  color: var(--text-dim);
  margin-top: 0.2rem;
}

.exp-chk input {
  accent-color: var(--accent-500);
}

.exp-meta {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-faint);
}

/* ── Narrower ── */
@media (max-width: 1280px) {
  .top {
    grid-template-columns: auto 1fr;
  }

  .brand {
    display: none;
  }

  .transport {
    justify-self: start;
  }

  .tool span {
    display: none;
  }

  .tool {
    width: 2.4rem;
    padding: 0;
    justify-content: center;
  }
}

@media (max-width: 767.98px) {
  .looper-app {
    height: calc(100vh - 4.75rem);
    height: calc(100dvh - 4.75rem);
  }

  .top {
    grid-template-columns: 1fr;
    padding: 0.6rem 0.75rem 0.35rem;
    gap: 0.5rem;
  }

  .transport {
    justify-self: stretch;
    justify-content: space-between;
    flex-wrap: wrap;
    border-radius: 1.2rem;
  }

  .tools {
    justify-self: stretch;
    justify-content: space-between;
  }

  .rec {
    min-width: 0;
  }

  .auto {
    padding: 0 0.7rem;
  }

  .stage {
    padding: 0.25rem 0.75rem 0.5rem;
  }

  .pads {
    --pad: min(calc((100cqw - var(--gap)) / 2), calc((100cqh - 3 * var(--gap) - 4 * var(--cap)) / 4), 14rem);
    grid-template-columns: repeat(2, var(--pad));
  }

  .foot {
    padding: 0.4rem 0.75rem;
  }

  .info {
    display: none;
  }

  .scale {
    padding: 0 0.75rem 0.5rem;
  }
}
</style>
