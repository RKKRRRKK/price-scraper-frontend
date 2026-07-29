<template>
  <div v-if="open" class="modal-back" @click.self="close">
    <div class="modal">
      <div class="modal-h">
        <span><i class="pi pi-comment" style="font-size: 0.9rem; margin-right: 0.4rem;"></i>Lyrics &amp; pīnyīn</span>
        <button class="modal-x" @click="close" aria-label="Close"><i class="pi pi-times"></i></button>
      </div>

      <div class="modal-b">
        <!-- ── 1. Confirm ── -->
        <template v-if="stage === 'confirm'">
          <div class="lead">
            This reads the sung words off <b>{{ scoreName || 'this score' }}</b>'s original picture in a
            second pass, separate from the note transcription — the model is handed the melody it
            already knows and only has to line the syllables up against it.
          </div>
          <div class="stat">
            <span><b>{{ rowTotal }}</b> {{ rowTotal === 1 ? 'line' : 'lines' }}</span>
            <span class="dot">·</span>
            <span><b>{{ noteTotal }}</b> notes to align</span>
            <span v-if="hasExisting" class="dot">·</span>
            <span v-if="hasExisting" class="warn-txt">already has lyrics</span>
          </div>

          <div class="checks">
            <label class="check">
              <input type="checkbox" v-model="pinyin" />
              <span class="check-box"><i class="pi pi-check"></i></span>
              <span class="check-text"><b>+ Pīnyīn</b><span class="check-sub">tone-marked romanization alongside each syllable</span></span>
            </label>
            <label class="check" :class="{ off: !hasExisting }">
              <input type="checkbox" v-model="overwrite" :disabled="!hasExisting" />
              <span class="check-box"><i class="pi pi-check"></i></span>
              <span class="check-text"><b>Replace what's there</b><span class="check-sub">off = only fill notes with no syllable yet</span></span>
            </label>
          </div>

          <div class="ai-controls">
            <label class="ctl">
              <span>Model</span>
              <select v-model="model">
                <option v-for="m in MODELS" :key="m.id" :value="m.id">{{ m.label }}{{ m.note ? ' · ' + m.note : '' }}</option>
              </select>
            </label>
            <label class="ctl ctl-sm">
              <span>Thinking</span>
              <select v-model="effort">
                <option v-for="e in availableEfforts" :key="e.id" :value="e.id">{{ e.label }}</option>
              </select>
            </label>
          </div>

          <label class="field">
            <span>Notes for the AI <span class="opt">(optional)</span></span>
            <textarea
              v-model="guidance"
              rows="2"
              placeholder="e.g. “the second verse is printed under the first — use verse 1” · “skip the bracketed 啊 syllables”"
            ></textarea>
          </label>

          <span v-if="error" class="bad-line"><i class="pi pi-exclamation-circle"></i> {{ error }}</span>
        </template>

        <!-- ── 2. Running ── -->
        <template v-else-if="stage === 'running'">
          <div class="run">
            <i class="pi pi-spin pi-spinner run-spin"></i>
            <div class="run-text">
              {{ progress.reasoning && !progress.rows ? 'Reading the words…' : 'Transcribing lyrics…' }}
              <b v-if="progress.rows">line {{ progress.rows }} / ~{{ rowTotal }}</b>
            </div>
          </div>
          <div class="bar"><div class="bar-fill" :class="{ indet: !progress.rows }" :style="progress.rows ? { width: pct + '%' } : {}"></div></div>
          <div class="hint">Nothing is written to the score until you press Apply.</div>
        </template>

        <!-- ── 3. Review ── -->
        <template v-else>
          <div class="stat">
            <span><b>{{ filledNotes }}</b> of {{ coveredNotes }} notes got a syllable</span>
            <span class="dot">·</span>
            <span><b>{{ rows.length }}</b> {{ rows.length === 1 ? 'line' : 'lines' }}</span>
            <span v-if="truncated" class="dot">·</span>
            <span v-if="truncated" class="warn-txt">stopped early</span>
          </div>
          <div v-if="fittedRows" class="warn-line">
            <i class="pi pi-exclamation-triangle"></i>
            {{ fittedRows }} {{ fittedRows === 1 ? 'line' : 'lines' }} came back with the wrong number of
            syllables and had to be trimmed or padded — check those before applying.
          </div>

          <div class="preview">
            <div v-for="row in preview" :key="row.i" class="pv-row" :class="{ fitted: row.fitted }">
              <span class="pv-i">{{ row.i + 1 }}</span>
              <div class="pv-cells">
                <span v-for="(c, k) in row.cells" :key="k" class="pv-cell">
                  <b class="pv-deg">{{ c.deg }}</b>
                  <span class="pv-main">{{ c.main || '·' }}</span>
                  <span v-if="c.sub" class="pv-sub">{{ c.sub }}</span>
                </span>
              </div>
            </div>
            <div v-if="rows.length > preview.length" class="pv-more">
              + {{ rows.length - preview.length }} more {{ rows.length - preview.length === 1 ? 'line' : 'lines' }}
            </div>
          </div>
        </template>
      </div>

      <div class="modal-f">
        <template v-if="stage === 'confirm'">
          <button class="btn-ghost" @click="close">Cancel</button>
          <button class="btn-primary" :disabled="!noteTotal" @click="run">
            <i class="pi pi-sparkles"></i> Get lyrics
          </button>
        </template>
        <template v-else-if="stage === 'running'">
          <button class="btn-ghost" @click="cancel">Cancel</button>
        </template>
        <template v-else>
          <button class="btn-ghost" style="margin-right: auto;" @click="stage = 'confirm'">
            <i class="pi pi-refresh"></i> Run again
          </button>
          <button class="btn-ghost" @click="close">Discard</button>
          <button class="btn-primary" :disabled="applying" @click="apply">
            <i :class="applying ? 'pi pi-spin pi-spinner' : 'pi pi-check'"></i> Apply
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { convertLyricsStream, MODELS, DEFAULT_MODEL, DEFAULT_EFFORT, effortsFor, clampEffort } from '@/lib/bawu/ai'

// The lyrics pass, start to finish: confirm what will run, watch it stream, then
// review the alignment before anything touches the score. Kept separate from the
// note transcription because reading pitches and reading words at the same time
// was timing out on long scores and costing accuracy on both.
const props = defineProps({
  open: { type: Boolean, default: false },
  // The transposition currently on screen ({ key, bpm, timeSig, lines }).
  data: { type: Object, default: null },
  scoreName: { type: String, default: '' },
  applying: { type: Boolean, default: false },
  // Async () => data-URI of the score's original picture. The parent owns the
  // signed URL and the per-score cache; the modal just asks when it needs it.
  resolveImage: { type: Function, required: true },
})
const emit = defineEmits(['close', 'apply', 'trace', 'running'])

const LS_MODEL = 'bawu.lyricsModel'
const LS_EFFORT = 'bawu.lyricsEffort'
const LS_PINYIN = 'bawu.lyricsPinyin'

const savedModel = localStorage.getItem(LS_MODEL)
const savedEffort = localStorage.getItem(LS_EFFORT)
const model = ref(MODELS.some((m) => m.id === savedModel) ? savedModel : DEFAULT_MODEL)
const effort = ref(clampEffort(model.value, savedEffort || DEFAULT_EFFORT))
const availableEfforts = computed(() => effortsFor(model.value))
watch(model, (m) => { effort.value = clampEffort(m, effort.value) })
const pinyin = ref(localStorage.getItem(LS_PINYIN) !== '0')
watch(model, (v) => localStorage.setItem(LS_MODEL, v))
watch(effort, (v) => localStorage.setItem(LS_EFFORT, v))
watch(pinyin, (v) => localStorage.setItem(LS_PINYIN, v ? '1' : '0'))

const stage = ref('confirm') // 'confirm' | 'running' | 'review'
const overwrite = ref(true)
const guidance = ref('')
const error = ref('')
const rows = ref([])
const truncated = ref(false)
const progress = ref({ rows: 0, reasoning: false })
let abort = null

const soundingLines = computed(() =>
  (props.data?.lines || []).map((l) => (l.notes || []).filter((n) => n.deg)).filter((l) => l.length),
)
const rowTotal = computed(() => soundingLines.value.length)
const noteTotal = computed(() => soundingLines.value.reduce((a, l) => a + l.length, 0))
const hasExisting = computed(() =>
  (props.data?.lines || []).some((l) => (l.notes || []).some((n) => n.ly || n.py)),
)
const pct = computed(() => Math.max(5, Math.min(100, (progress.value.rows / Math.max(1, rowTotal.value)) * 100)))

// Reset to a clean confirm screen every time the modal opens.
watch(
  () => props.open,
  (open) => {
    if (open) {
      stage.value = 'confirm'
      error.value = ''
      rows.value = []
      truncated.value = false
      guidance.value = ''
      overwrite.value = true
      progress.value = { rows: 0, reasoning: false }
    } else {
      stopStream()
    }
  },
)

const fittedRows = computed(() => rows.value.filter((r) => r.fitted).length)
const coveredNotes = computed(() => rows.value.reduce((a, r) => a + r.ly.length, 0))
const filledNotes = computed(() =>
  rows.value.reduce((a, r) => a + r.ly.reduce((c, v, k) => c + (v || r.py[k] ? 1 : 0), 0), 0),
)

// The first few rows, digit by digit with the syllable under each — enough to
// see at a glance whether the words landed on the right notes.
const preview = computed(() => {
  const byRow = new Map(rows.value.map((r) => [r.i, r]))
  const out = []
  const lines = props.data?.lines || []
  for (let i = 0; i < lines.length && out.length < 8; i++) {
    const r = byRow.get(i)
    if (!r) continue
    const sounding = (lines[i].notes || []).filter((n) => n.deg)
    out.push({
      i,
      fitted: r.fitted,
      cells: sounding.map((n, k) => ({
        deg: n.deg,
        main: pinyin.value ? r.py[k] || r.ly[k] || '' : r.ly[k] || '',
        sub: pinyin.value ? (r.py[k] ? r.ly[k] || '' : '') : '',
      })),
    })
  }
  return out
})

async function run() {
  if (!noteTotal.value) return
  error.value = ''
  rows.value = []
  truncated.value = false
  progress.value = { rows: 0, reasoning: false }
  stage.value = 'running'
  emit('running', true)
  abort = new AbortController()
  try {
    const dataUri = await props.resolveImage()
    if (!dataUri) throw new Error('Could not read the original picture for this score.')
    const res = await convertLyricsStream(dataUri, props.data, {
      model: model.value,
      effort: effort.value,
      pinyin: pinyin.value,
      notes: guidance.value.trim(),
      signal: abort.signal,
      onRow: (row, n) => { progress.value = { ...progress.value, rows: n } },
      onReasoning: () => { progress.value = { ...progress.value, reasoning: true } },
      onTrace: (e) => emit('trace', e),
    })
    rows.value = res.rows
    truncated.value = res.truncated
    stage.value = 'review'
  } catch (e) {
    if (e?.name === 'AbortError') return
    console.error('[Bawu] lyrics pass failed:', e)
    error.value = e.message || 'The lyrics pass failed.'
    stage.value = 'confirm'
  } finally {
    abort = null
    emit('running', false)
  }
}

function stopStream() {
  if (abort) {
    try { abort.abort() } catch { /* already gone */ }
    abort = null
  }
}

function cancel() {
  stopStream()
  stage.value = 'confirm'
}

function apply() {
  if (props.applying || !rows.value.length) return
  emit('apply', { rows: rows.value, pinyin: pinyin.value, overwrite: overwrite.value })
}

function close() {
  stopStream()
  emit('close')
}

onBeforeUnmount(stopStream)
</script>

<style scoped>
.modal-back {
  position: fixed; inset: 0; z-index: 130;
  background: rgba(26, 26, 26, 0.35);
  display: flex; align-items: center; justify-content: center; padding: 1.5rem;
}
.modal {
  width: min(34rem, 100%); max-height: calc(100vh - 3rem); overflow-y: auto;
  background: #fff; border: 1px solid var(--border, #e5e4e1);
  border-radius: 1rem; box-shadow: 0 0.5rem 1.875rem rgba(0, 0, 0, 0.12);
}
.modal-h {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.9rem 1rem; border-bottom: 1px solid var(--border, #e5e4e1); font-weight: 700;
}
.modal-x {
  width: 1.9rem; height: 1.9rem; border-radius: 0.4rem;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-faint, #9a9a9a); font-size: 0.8rem; background: none; border: none; cursor: pointer;
}
.modal-x:hover { background: var(--bg-sunken, #f3f2f0); color: var(--text, #1a1a1a); }
.modal-b { padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
.modal-f {
  display: flex; align-items: center; justify-content: flex-end; gap: 0.45rem;
  padding: 0.75rem 1rem; border-top: 1px solid var(--border, #e5e4e1);
}

.lead { font-size: 0.82rem; color: var(--text-dim, #5c5c5c); line-height: 1.55; }
.lead b { color: var(--text, #1a1a1a); font-weight: 700; }

.stat {
  display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;
  font-size: 0.78rem; color: var(--text-dim, #5c5c5c);
  background: var(--bg-sunken, #f3f2f0); border-radius: 0.5rem; padding: 0.45rem 0.65rem;
}
.stat b { color: var(--text, #1a1a1a); font-weight: 700; }
.stat .dot { color: var(--text-faint, #9a9a9a); }
.warn-txt { color: #b45309; font-weight: 600; }

.checks { display: flex; flex-direction: column; gap: 0.4rem; }
.check { display: flex; align-items: flex-start; gap: 0.5rem; cursor: pointer; }
.check.off { opacity: 0.45; cursor: not-allowed; }
.check input { position: absolute; opacity: 0; width: 0; height: 0; }
.check-box {
  width: 1.1rem; height: 1.1rem; flex-shrink: 0; margin-top: 0.1rem;
  border: 1.5px solid var(--border, #e5e4e1); border-radius: 0.3rem; background: #fff;
  display: inline-flex; align-items: center; justify-content: center; color: transparent; font-size: 0.6rem;
}
.check input:checked + .check-box { background: var(--accent-500, #ef4444); border-color: var(--accent-500, #ef4444); color: #fff; }
.check-text { display: flex; flex-direction: column; font-size: 0.82rem; line-height: 1.35; }
.check-text b { font-weight: 700; }
.check-sub { font-size: 0.72rem; color: var(--text-faint, #9a9a9a); }

.ai-controls { display: flex; gap: 0.5rem; }
.ctl { flex: 1; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem; color: var(--text-dim, #5c5c5c); font-weight: 600; }
.ctl-sm { max-width: 8rem; }
.ctl select, .field textarea {
  border: 1px solid var(--border, #e5e4e1); border-radius: 0.5rem; padding: 0.45rem 0.55rem;
  font-size: 0.82rem; color: var(--text, #1a1a1a); background: #fff; outline: none; width: 100%;
  font-family: inherit;
}
.ctl select:focus, .field textarea:focus { border-color: var(--accent-500, #ef4444); box-shadow: 0 0 0 3px var(--accent-050, #fef2f2); }
.field { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.72rem; color: var(--text-dim, #5c5c5c); font-weight: 600; }
.field textarea { resize: vertical; line-height: 1.5; }
.field .opt { font-weight: 400; color: var(--text-faint, #9a9a9a); }

.run { display: flex; align-items: center; gap: 0.6rem; }
.run-spin { color: var(--accent-500, #ef4444); font-size: 1rem; }
.run-text { font-size: 0.85rem; color: var(--text-dim, #5c5c5c); }
.run-text b { color: var(--text, #1a1a1a); font-weight: 700; margin-left: 0.25rem; }
.bar { height: 0.35rem; border-radius: 999px; background: var(--bg-sunken, #f3f2f0); overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent-500, #ef4444); border-radius: 999px; transition: width 220ms; }
.bar-fill.indet { width: 35%; animation: slide 1.1s ease-in-out infinite; }
@keyframes slide { 0% { margin-left: -35%; } 100% { margin-left: 100%; } }
.hint { font-size: 0.72rem; color: var(--text-faint, #9a9a9a); }

.bad-line { font-size: 0.78rem; color: #c33; display: inline-flex; align-items: center; gap: 0.35rem; }
.warn-line {
  font-size: 0.76rem; color: #b45309; line-height: 1.5;
  background: var(--warn-soft, #fffbeb); border: 1px solid #fde68a; border-radius: 0.5rem; padding: 0.45rem 0.6rem;
}

.preview { display: flex; flex-direction: column; gap: 0.5rem; max-height: 20rem; overflow-y: auto; }
.pv-row { display: flex; align-items: flex-start; gap: 0.5rem; border-radius: 0.45rem; padding: 0.35rem 0.4rem; }
.pv-row.fitted { background: var(--warn-soft, #fffbeb); outline: 1px solid #fde68a; }
.pv-i { font-size: 0.68rem; font-weight: 700; color: var(--text-faint, #9a9a9a); width: 1.2rem; flex-shrink: 0; text-align: right; padding-top: 0.15rem; }
.pv-cells { display: flex; flex-wrap: wrap; gap: 0.3rem 0.45rem; }
.pv-cell { display: inline-flex; flex-direction: column; align-items: center; min-width: 1.4rem; }
.pv-deg { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 0.85rem; font-weight: 700; line-height: 1.1; }
.pv-main { font-size: 0.75rem; color: var(--text-dim, #5c5c5c); line-height: 1.2; white-space: nowrap; }
.pv-sub { font-size: 0.66rem; color: var(--text-faint, #9a9a9a); line-height: 1.2; white-space: nowrap; }
.pv-more { font-size: 0.72rem; color: var(--text-faint, #9a9a9a); padding-left: 1.7rem; }

.btn-primary {
  display: inline-flex; align-items: center; gap: 0.45rem; height: 2.25rem; padding: 0 1rem;
  border-radius: 0.6rem; background: var(--accent-500, #ef4444); color: #fff;
  font-size: 0.85rem; font-weight: 600; border: none; cursor: pointer;
  box-shadow: 0 0.125rem 0.5rem rgba(239, 68, 68, 0.25);
}
.btn-primary:hover:not(:disabled) { background: var(--accent-600, #b91c1c); }
.btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary i { font-size: 0.8rem; }
.btn-ghost {
  display: inline-flex; align-items: center; gap: 0.4rem;
  height: 2.25rem; padding: 0 0.9rem; border-radius: 0.6rem; font-size: 0.85rem; font-weight: 500;
  color: var(--text-dim, #5c5c5c); border: 1px solid var(--border, #e5e4e1); background: #fff; cursor: pointer;
}
.btn-ghost:hover { background: var(--bg-sunken, #f3f2f0); color: var(--text, #1a1a1a); }
.btn-ghost i { font-size: 0.75rem; }
</style>
