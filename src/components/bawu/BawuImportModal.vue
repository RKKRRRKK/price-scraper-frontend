<template>
  <div v-if="open" class="modal-back" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-h">
        <span><i class="pi pi-plus-circle" style="font-size: 0.9rem; margin-right: 0.4rem;"></i>Add score</span>
        <button class="modal-x" @click="$emit('close')" aria-label="Close"><i class="pi pi-times"></i></button>
      </div>

      <div class="modal-b">
        <!-- Source tabs -->
        <div class="tabs">
          <button class="tab" :class="{ on: tab === 'image' }" @click="tab = 'image'">
            <i class="pi pi-image"></i> Picture <span class="tab-hint">AI convert</span>
          </button>
          <button class="tab" :class="{ on: tab === 'manual' }" @click="tab = 'manual'">
            <i class="pi pi-pencil"></i> Manual <span class="tab-hint">type jianpu</span>
          </button>
        </div>

        <!-- ── Picture → AI (streamed) ── -->
        <template v-if="tab === 'image'">
          <div class="src-toggle">
            <span class="src-label">This picture is</span>
            <div class="src-seg">
              <button :class="{ on: notation === 'jianpu' }" @click="notation = 'jianpu'">
                <i class="pi pi-hashtag"></i> Jianpu <span class="src-hint">1 2 3…</span>
              </button>
              <button :class="{ on: notation === 'western' }" @click="notation = 'western'">
                <i class="pi pi-align-left" style="transform: rotate(90deg);"></i> Western <span class="src-hint">staff</span>
              </button>
            </div>
          </div>
          <div
            v-if="!imagePreview"
            class="drop"
            :class="{ over: dragOver }"
            @click="fileInput?.click()"
            @dragover.prevent="dragOver = true"
            @dragleave="dragOver = false"
            @drop.prevent="onDrop"
          >
            <i class="pi pi-cloud-upload drop-icon"></i>
            <div>Drop a photo or screenshot of {{ notation === 'western' ? 'western staff notation' : 'jianpu' }}<br />
              <b>click to browse</b> · or paste from clipboard</div>
          </div>
          <div v-else class="preview">
            <img :src="imagePreview" alt="Score preview" />
            <button class="preview-x" title="Remove image" @click="clearImage"><i class="pi pi-times"></i></button>
          </div>
          <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="onFilePick" />

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
            <label class="ctl ctl-sm" title="How large the picture is sent. Bigger reads small underlines better but costs the model far more vision tokens.">
              <span>Detail</span>
              <select v-model.number="maxDim">
                <option v-for="d in DETAILS" :key="d.px" :value="d.px">{{ d.label }}</option>
              </select>
            </label>
          </div>
          <div v-if="effortNote" class="split-note warn">
            <i class="pi pi-exclamation-triangle"></i>
            <span>{{ effortNote }}</span>
          </div>
          <label class="opt-toggle">
            <input type="checkbox" v-model="expression" />
            <span class="opt-box"><i class="pi pi-check"></i></span>
            <span class="opt-text">
              <b>Also read slurs, slides &amp; bends</b>
              <span class="opt-sub">Off keeps the model on pitches and rhythms only, which reads clean scores more reliably. You can add the marks yourself in Edit.</span>
            </span>
          </label>
          <div class="split-note">
            <i class="pi pi-comment"></i>
            <span>
              Lyrics and pīnyīn are their own step — open the score and hit <b>Get lyrics</b>.
            </span>
          </div>
          <label class="field">
            <span>Notes for the AI <span class="opt">(optional)</span></span>
            <textarea
              v-model="aiNotes"
              class="ai-notes"
              rows="2"
              placeholder="e.g. “only transcribe the top voice” · “the repeat sign means play lines 1–2 twice” · “ignore the guitar chords”"
            ></textarea>
          </label>
          <span v-if="convertError" class="ai-error">{{ convertError }}</span>
        </template>

        <!-- ── Manual jianpu ── -->
        <template v-else>
          <textarea
            v-model="manualText"
            class="manual-input"
            rows="6"
            spellcheck="false"
            placeholder="1=F 4/4 bpm=80&#10;5, 6, 1 2 | 3 - 5 3&#10;1 2 3 5 | 6' 5 3 1"
          ></textarea>
          <div class="manual-hint">
            One text line per printed line. <b>5'</b> high dot · <b>5,</b> low dot · <b>-</b> extends the
            previous note a beat · <b>5_</b> half beat · <b>5.</b> dotted · <b>0</b> rest · <b>|</b> ignored.
          </div>
          <div class="ai-row">
            <span v-if="manualError" class="ai-error">{{ manualError }}</span>
            <span v-else-if="manualResult" class="ai-ok"><i class="pi pi-check-circle"></i> {{ manualSummary }}</span>
          </div>
        </template>

        <!-- ── Common fields ── -->
        <div class="fields">
          <label class="field">
            <span>Score name <span v-if="tab === 'image'" class="opt">(optional — AI fills it in)</span></span>
            <input v-model="name" type="text" placeholder="e.g. 美丽的金孔雀" @keyup.enter="onPrimary" />
          </label>
          <label class="field field-sm">
            <span>Folder</span>
            <select v-model="folderId">
              <option :value="null">No folder</option>
              <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
          </label>
        </div>
      </div>

      <div class="modal-f">
        <span v-if="createError" class="ai-error" style="margin-right: auto;">{{ createError }}</span>
        <span v-else-if="tab === 'image'" class="foot-hint">
          <i class="pi pi-bolt"></i> Opens as it transcribes — you can start playing before it finishes.
        </span>
        <button class="btn-ghost" @click="$emit('close')">Cancel</button>
        <button v-if="tab === 'image'" class="btn-primary" :disabled="!imageBlob || starting" @click="startStream">
          <i :class="starting ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'"></i>
          Convert &amp; open
        </button>
        <button v-else class="btn-primary" :disabled="!manualResult || creating" @click="create">
          <i :class="creating ? 'pi pi-spin pi-spinner' : 'pi pi-check'"></i>
          Create score
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { parseManualJianpu, MODELS, DEFAULT_MODEL, DEFAULT_EFFORT, effortsFor, clampEffort, effortWarning } from '@/lib/bawu/ai'
import { flattenScore } from '@/lib/bawu/notes'
import { toDataUri } from '@/lib/bawu/image'

const props = defineProps({
  open: { type: Boolean, default: false },
  folders: { type: Array, default: () => [] },
  creating: { type: Boolean, default: false },
  createError: { type: String, default: '' },
})
const emit = defineEmits(['close', 'create', 'stream'])

const tab = ref('image')
const name = ref('')
const folderId = ref(null)
const fileInput = ref(null)
const dragOver = ref(false)

const imageBlob = ref(null)
const imagePreview = ref('')
const starting = ref(false)
const convertError = ref('')

// Model + effort + source notation: persisted so choices stick. Lyrics are no
// longer chosen here — they are a separate pass on an already-transcribed score.
const LS_MODEL = 'bawu.model'
const LS_EFFORT = 'bawu.effort'
const LS_NOTATION = 'bawu.notation'
const LS_EXPRESSION = 'bawu.expression'
const LS_MAXDIM = 'bawu.maxDim'

// How large the picture goes over the wire. A score photo is mostly white space,
// so the extra pixels buy less than they cost: vision tokens scale with area,
// and a reasoning model re-reads the image as it thinks. Worth dropping first
// when a run is slow.
const DETAILS = [
  { px: 1600, label: 'High · 1600px' },
  { px: 1200, label: 'Medium · 1200px' },
  { px: 900, label: 'Low · 900px' },
]
const savedModel = localStorage.getItem(LS_MODEL)
const savedEffort = localStorage.getItem(LS_EFFORT)
const model = ref(MODELS.some((m) => m.id === savedModel) ? savedModel : DEFAULT_MODEL)
const effort = ref(clampEffort(model.value, savedEffort || DEFAULT_EFFORT))
// Not every model is offered every setting — grok is capped because higher
// efforts stop it answering at all. Switching model snaps to a legal choice.
const availableEfforts = computed(() => effortsFor(model.value))
const effortNote = computed(() => effortWarning(model.value, effort.value))
watch(model, (m) => { effort.value = clampEffort(m, effort.value) })
const notation = ref(localStorage.getItem(LS_NOTATION) === 'western' ? 'western' : 'jianpu')
// Off by default: asking for expression marks costs attention that is better
// spent reading the notes right, and it widened the spread between models.
const expression = ref(localStorage.getItem(LS_EXPRESSION) === '1')
const savedDim = Number(localStorage.getItem(LS_MAXDIM))
const maxDim = ref(DETAILS.some((d) => d.px === savedDim) ? savedDim : 1600)
watch(maxDim, (v) => localStorage.setItem(LS_MAXDIM, String(v)))
const aiNotes = ref('') // free-text guidance for the model — not persisted
watch(model, (v) => localStorage.setItem(LS_MODEL, v))
watch(effort, (v) => localStorage.setItem(LS_EFFORT, v))
watch(notation, (v) => localStorage.setItem(LS_NOTATION, v))
watch(expression, (v) => localStorage.setItem(LS_EXPRESSION, v ? '1' : '0'))

const manualText = ref('')
const manualError = ref('')
const manualResult = ref(null) // { data }

watch(
  () => props.open,
  (open) => {
    if (!open) return
    // Fresh modal each time (model/effort persist).
    tab.value = 'image'
    name.value = ''
    folderId.value = null
    starting.value = false
    clearImage()
    manualText.value = ''
    manualError.value = ''
    manualResult.value = null
    convertError.value = ''
    aiNotes.value = ''
  },
)

// Live-parse the manual tab.
watch(manualText, (text) => {
  manualError.value = ''
  manualResult.value = null
  if (!text.trim()) return
  try {
    manualResult.value = parseManualJianpu(text)
  } catch (e) {
    manualError.value = e.message
  }
})

const manualSummary = computed(() => {
  const p = manualResult.value
  if (!p) return ''
  const { playable } = flattenScore(p.data)
  const lines = p.data.lines.length
  return `${playable.length} notes · ${lines} ${lines === 1 ? 'line' : 'lines'} · 1=${p.data.key} · ${p.data.bpm} BPM`
})

function setImage(file) {
  if (!file || !file.type.startsWith('image/')) return
  clearImage()
  imageBlob.value = file
  imagePreview.value = URL.createObjectURL(file)
}

function clearImage() {
  if (imagePreview.value) URL.revokeObjectURL(imagePreview.value)
  imageBlob.value = null
  imagePreview.value = ''
  convertError.value = ''
}

function onFilePick(e) {
  setImage(e.target.files?.[0])
  e.target.value = ''
}

function onDrop(e) {
  dragOver.value = false
  setImage(e.dataTransfer?.files?.[0])
}

// Paste lands on whatever is focused, so listen globally while the modal is up.
function onPaste(e) {
  if (!props.open || tab.value !== 'image') return
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
  if (item) setImage(item.getAsFile())
}

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('paste', onPaste)
    else window.removeEventListener('paste', onPaste)
  },
)
onBeforeUnmount(() => window.removeEventListener('paste', onPaste))

// Image path: prepare the data URI and hand the streaming job to the player,
// which opens the score and fills it in as lines arrive.
async function startStream() {
  if (!imageBlob.value || starting.value) return
  starting.value = true
  convertError.value = ''
  try {
    const dataUri = await toDataUri(imageBlob.value, maxDim.value)
    emit('stream', {
      name: name.value.trim(),
      folderId: folderId.value,
      imageBlob: imageBlob.value,
      dataUri,
      model: model.value,
      effort: effort.value,
      mode: notation.value,
      expression: expression.value,
      notes: aiNotes.value.trim(),
    })
    // Parent closes the modal.
  } catch (e) {
    console.error('[Bawu] could not read image:', e)
    convertError.value = e.message || 'Could not read the image.'
    starting.value = false
  }
}

// Manual path: immediate create.
function create() {
  const p = manualResult.value
  if (!p || props.creating) return
  emit('create', {
    name: name.value.trim() || 'Untitled score',
    folderId: folderId.value,
    source: 'manual',
    data: p.data,
    imageBlob: null,
    aiMeta: null,
  })
}

function onPrimary() {
  if (tab.value === 'image') startStream()
  else create()
}
</script>

<style scoped>
.modal-back {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 26, 0.35);
  z-index: 130;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.modal {
  width: min(30rem, 100%);
  max-height: calc(100vh - 3rem);
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 1rem;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
}
.modal-h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1rem;
  border-bottom: 1px solid var(--border, #e5e4e1);
  font-weight: 700;
}
.modal-x {
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.4rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint, #9a9a9a);
  font-size: 0.8rem;
}
.modal-x:hover { background: var(--bg-sunken, #f3f2f0); color: var(--text, #1a1a1a); }
.modal-b { padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
.modal-f {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.45rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--border, #e5e4e1);
}

.tabs {
  display: inline-flex;
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 0.55rem;
  background: var(--bg-sunken, #f3f2f0);
  padding: 0.15rem;
  gap: 0.1rem;
  align-self: flex-start;
}
.tab {
  padding: 0.35rem 0.8rem;
  border-radius: 0.4rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-dim, #5c5c5c);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.tab i { font-size: 0.78rem; }
.tab .tab-hint { font-size: 0.66rem; font-weight: 500; color: var(--text-faint, #9a9a9a); }
.tab.on { background: #fff; color: var(--accent-600, #b91c1c); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.tab.on .tab-hint { color: var(--accent-400, #f87171); }

.drop {
  border: 1.5px dashed var(--border, #e5e4e1);
  border-radius: 0.7rem;
  padding: 1.6rem 1rem;
  text-align: center;
  background: var(--bg-sunken, #f3f2f0);
  color: var(--text-dim, #5c5c5c);
  font-size: 0.85rem;
  line-height: 1.55;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}
.drop:hover, .drop.over { border-color: var(--accent-400, #f87171); background: var(--accent-050, #fef2f2); }
.drop-icon { font-size: 1.4rem; color: var(--text-faint, #9a9a9a); }

.preview { position: relative; border: 1px solid var(--border, #e5e4e1); border-radius: 0.7rem; overflow: hidden; }
.preview img { display: block; width: 100%; max-height: 14rem; object-fit: contain; background: var(--bg-sunken, #f3f2f0); }
.preview-x {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  width: 1.8rem;
  height: 1.8rem;
  border-radius: 999px;
  background: rgba(26, 26, 26, 0.65);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
}
.preview-x:hover { background: rgba(26, 26, 26, 0.85); }

.src-toggle { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.src-label { font-size: 0.78rem; font-weight: 600; color: var(--text-dim, #5c5c5c); }
.src-seg {
  display: inline-flex; flex: 1; min-width: 0;
  border: 1px solid var(--border, #e5e4e1); border-radius: 0.55rem;
  background: var(--bg-sunken, #f3f2f0); padding: 0.18rem; gap: 0.15rem;
}
.src-seg button {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
  padding: 0.4rem 0.6rem; border-radius: 0.4rem; font-size: 0.82rem; font-weight: 600;
  color: var(--text-dim, #5c5c5c); background: none; border: none; cursor: pointer;
  transition: background 120ms, color 120ms;
}
.src-seg button i { font-size: 0.75rem; }
.src-seg button .src-hint { font-size: 0.66rem; font-weight: 500; color: var(--text-faint, #9a9a9a); }
.src-seg button.on { background: #fff; color: var(--accent-600, #b91c1c); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.src-seg button.on .src-hint { color: var(--accent-400, #f87171); }

.opt-toggle { display: flex; align-items: flex-start; gap: 0.55rem; cursor: pointer; user-select: none; }
.opt-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.opt-box {
  flex: none; width: 1.2rem; height: 1.2rem; margin-top: 0.1rem; border-radius: 0.35rem;
  border: 1.5px solid var(--border, #e5e4e1); background: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  color: #fff; font-size: 0.62rem; transition: background 120ms, border-color 120ms;
}
.opt-box i { opacity: 0; }
.opt-toggle input:checked + .opt-box { background: var(--accent-500, #ef4444); border-color: var(--accent-500, #ef4444); }
.opt-toggle input:checked + .opt-box i { opacity: 1; }
.opt-text { display: flex; flex-direction: column; gap: 0.15rem; line-height: 1.4; }
.opt-text b { font-size: 0.82rem; font-weight: 600; color: var(--text, #1a1a1a); }
.opt-sub { font-size: 0.72rem; color: var(--text-faint, #9a9a9a); }

.split-note {
  display: flex; align-items: flex-start; gap: 0.5rem;
  font-size: 0.75rem; line-height: 1.5; color: var(--text-dim, #5c5c5c);
  background: var(--bg-sunken, #f3f2f0); border-radius: 0.55rem; padding: 0.5rem 0.65rem;
}
.split-note i { font-size: 0.75rem; margin-top: 0.15rem; color: var(--text-faint, #9a9a9a); flex: none; }
.split-note b { color: var(--text, #1a1a1a); font-weight: 700; }
.split-note.warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
.split-note.warn i { color: #b45309; }

.ai-controls { display: flex; gap: 0.6rem; }
.ctl { flex: 1; display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.ctl-sm { flex: 0 0 8rem; }
.ctl span { font-size: 0.75rem; font-weight: 600; color: var(--text-dim, #5c5c5c); }
.ctl select {
  height: 2.3rem; border: 1px solid var(--border, #e5e4e1); border-radius: 0.5rem;
  padding: 0 0.6rem; outline: none; background: #fff; min-width: 0;
}
.ctl select:focus { border-color: var(--accent-500, #ef4444); box-shadow: 0 0 0 3px var(--accent-050, #fef2f2); }

.ai-notes {
  width: 100%;
  border: 1px solid var(--accent-100, #fee2e2);
  border-radius: 0.5rem;
  padding: 0.5rem 0.65rem;
  background: #fffcf7;
  font-family: inherit;
  font-size: 0.82rem;
  line-height: 1.5;
  color: inherit;
  outline: none;
  resize: vertical;
}
.ai-notes:focus { border-color: var(--accent-500, #ef4444); box-shadow: 0 0 0 3px var(--accent-050, #fef2f2); }
.ai-notes::placeholder { color: var(--text-faint, #9a9a9a); }

.foot-hint {
  margin-right: auto;
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-size: 0.72rem; color: var(--text-dim, #5c5c5c);
  min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.foot-hint i { color: var(--accent-600, #b91c1c); font-size: 0.75rem; }

.ai-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; min-height: 1.4rem; }
.ai-error { font-size: 0.78rem; color: #c33; }
.ai-ok { font-size: 0.78rem; color: #166534; display: inline-flex; align-items: center; gap: 0.35rem; }
.ai-ok i { font-size: 0.8rem; }

.manual-input {
  width: 100%;
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 0.6rem;
  padding: 0.6rem 0.7rem;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.85rem;
  line-height: 1.7;
  outline: none;
  resize: vertical;
  background: #fffcf7;
}
.manual-input:focus { border-color: var(--accent-500, #ef4444); box-shadow: 0 0 0 3px var(--accent-050, #fef2f2); }
.manual-hint { font-size: 0.72rem; color: var(--text-faint, #9a9a9a); line-height: 1.5; }

.fields { display: flex; gap: 0.6rem; }
.field { flex: 1; display: flex; flex-direction: column; gap: 0.3rem; }
.field-sm { flex: 0 0 40%; }
.field span { font-size: 0.75rem; font-weight: 600; color: var(--text-dim, #5c5c5c); }
.field .opt { font-weight: 500; color: var(--text-faint, #9a9a9a); }
.field input, .field select {
  height: 2.3rem;
  border: 1px solid var(--border, #e5e4e1);
  border-radius: 0.5rem;
  padding: 0 0.7rem;
  outline: none;
  background: #fff;
  min-width: 0;
}
.field input:focus, .field select:focus { border-color: var(--accent-500, #ef4444); box-shadow: 0 0 0 3px var(--accent-050, #fef2f2); }

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  height: 2.25rem;
  padding: 0 1rem;
  border-radius: 0.6rem;
  background: var(--accent-500, #ef4444);
  color: #fff;
  font-size: 0.85rem;
  font-weight: 600;
  box-shadow: 0 0.125rem 0.5rem rgba(239, 68, 68, 0.25);
}
.btn-primary:hover:not(:disabled) { background: var(--accent-600, #b91c1c); }
.btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary i { font-size: 0.8rem; }
.btn-ghost {
  height: 2.25rem;
  padding: 0 0.9rem;
  border-radius: 0.6rem;
  font-size: 0.85rem;
  color: var(--text-dim, #5c5c5c);
  border: 1px solid var(--border, #e5e4e1);
  background: #fff;
  font-weight: 500;
}
.btn-ghost:hover { background: var(--bg-sunken, #f3f2f0); color: var(--text, #1a1a1a); }
</style>
