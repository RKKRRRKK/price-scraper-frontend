<template>
  <div v-if="open" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title"><i class="pi pi-sparkles" style="font-size: 0.85rem"></i> AI assist</span>
        <button class="modal-close" @click="$emit('close')">
          <i class="pi pi-times" style="font-size: 0.85rem"></i>
        </button>
      </div>

      <div class="modal-body">
        <!-- 1. Send to an assistant -->
        <section class="ai-section">
          <h3 class="ai-h">1 · Send this board to an assistant</h3>
          <p class="hint">
            Run it directly through Gemini — it edits the board, then reviews a screenshot of
            its own result and fixes anything off. Or copy the prompt to use your own chat.
          </p>

          <div class="prompt-select-row">
            <label class="prompt-label" for="prompt-select">Prompt</label>
            <select id="prompt-select" v-model="selectedPrompt" class="prompt-select">
              <option v-for="p in PROMPTS" :key="p.key" :value="p.key">{{ p.label }}</option>
            </select>
          </div>

          <!-- Section scope (only when something is selected) -->
          <label v-if="scopeIds.length" class="scope-row">
            <input type="checkbox" v-model="useScope" />
            <span><i class="pi pi-th-large" style="font-size: 0.75rem"></i>
              Limit to the selected section ({{ scopeIds.length }} element{{ scopeIds.length === 1 ? '' : 's' }})</span>
          </label>

          <!-- Context sub-toggle: edit the selection but see the rest as reference -->
          <label v-if="scopeIds.length && useScope" class="scope-row scope-sub">
            <input type="checkbox" v-model="useContext" />
            <span><i class="pi pi-eye" style="font-size: 0.75rem"></i>
              Include the rest of the board as read-only context</span>
          </label>

          <!-- Instruction field (3rd field) -->
          <textarea
            v-model="instruction"
            rows="3"
            class="instruction-area"
            :placeholder="isComment ? 'What should the AI review or focus on?' : 'Describe the change you want…'"
          ></textarea>

          <!-- Optional steering: a plan pasted from a stronger chat model -->
          <details v-if="!isComment" class="steer" :open="!!steering">
            <summary class="steer-sum"><i class="pi pi-compass" style="font-size: 0.72rem"></i> Steering (optional)</summary>
            <textarea
              v-model="steering"
              rows="4"
              class="instruction-area steer-area"
              placeholder="Paste a plan from another AI here — the model will execute it instead of inventing its own approach…"
            ></textarea>
          </details>

          <!-- Direct run (constructive edits only — the review step is about visual layout) -->
          <div v-if="!isComment" class="run-row">
            <button class="add-btn run-btn" :disabled="running" @click="runAi">
              <i :class="running ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'" style="font-size: 0.8rem"></i>
              {{ running ? 'Running…' : 'Run with AI' }}
            </button>
            <div class="rounds" title="How many times Gemini reviews a screenshot of its result and fixes it">
              <span class="rounds-label">Review</span>
              <button class="round-seg" :class="{ on: verifyRounds === 1 }" :disabled="running" @click="verifyRounds = 1">1×</button>
              <button class="round-seg" :class="{ on: verifyRounds === 2 }" :disabled="running" @click="verifyRounds = 2">2×</button>
            </div>
          </div>
          <p v-if="runStatus" class="run-status" :class="{ err: runError }">
            <i v-if="!runError && !running" class="pi pi-check" style="font-size: 0.72rem"></i>
            {{ runStatus }}
            <span v-if="usageText" class="usage">· {{ usageText }}</span>
          </p>

          <!-- What the model says it did (its own summary / reasoning) -->
          <div v-if="aiNote" class="ai-note">
            <i class="pi pi-comment" style="font-size: 0.72rem"></i>
            <span>{{ aiNote }}</span>
          </div>

          <!-- Real problems the model flagged (broken screenshot, big inference…) -->
          <div v-if="aiIssues.length" class="ai-flags">
            <div class="ai-flags-head">
              <i class="pi pi-exclamation-triangle" style="font-size: 0.72rem"></i>
              <span>The AI flagged {{ aiIssues.length === 1 ? 'an issue' : aiIssues.length + ' issues' }}</span>
            </div>
            <ul class="ai-flags-list">
              <li v-for="(issue, i) in aiIssues" :key="i">{{ issue }}</li>
            </ul>
          </div>

          <div class="ai-actions">
            <button class="add-btn" @click="copyPrompt" title="Board JSON + schema + your instruction">
              <i :class="copied ? 'pi pi-check' : 'pi pi-copy'" style="font-size: 0.8rem"></i>
              {{ copied ? 'Copied!' : 'Copy prompt' }}
            </button>
            <button class="btn-ghost" @click="copySummary" title="Human-readable summary of the board (no schema)">
              <i :class="copiedSummary ? 'pi pi-check' : 'pi pi-clipboard'" style="font-size: 0.8rem"></i>
              {{ copiedSummary ? 'Copied!' : 'Copy summary only' }}
            </button>
            <button class="btn-ghost" @click="downloadMd" title="Download the prompt as a .md file">
              <i class="pi pi-download" style="font-size: 0.8rem"></i> Download .md
            </button>
          </div>

          <!-- Debug: dump each call to a local folder + inspect what was sent -->
          <div class="debug-row" v-if="!isComment">
            <button v-if="supportsFolder" class="btn-ghost btn-sm" @click="chooseFolder"
              :title="debugFolderName ? 'Dumps go to: ' + debugFolderName : 'Pick a folder for prompt/screenshot dumps'">
              <i class="pi pi-folder-open" style="font-size: 0.75rem"></i>
              {{ debugFolderName ? debugFolderName : 'Choose debug folder' }}
            </button>
            <button class="btn-ghost btn-sm" @click="showDebug = !showDebug">
              <i :class="showDebug ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" style="font-size: 0.7rem"></i>
              Debug log{{ debugLog.length ? ` (${debugLog.length})` : '' }}
            </button>
            <button v-if="debugLog.length" class="btn-ghost btn-sm" @click="clearLog" title="Clear the log">
              <i class="pi pi-trash" style="font-size: 0.7rem"></i>
            </button>
          </div>

          <div v-if="showDebug" class="debug-panel">
            <p v-if="!debugLog.length" class="hint">No calls yet. Run the AI and each request/reply shows up here.</p>
            <div v-for="e in debugLog" :key="e.id" class="debug-entry">
              <div class="debug-head">
                <span class="debug-phase">{{ e.phase }}{{ e.round ? ' r' + e.round : '' }}</span>
                <span class="debug-tok">{{ e.tokensIn ?? '?' }} in / {{ e.tokensOut ?? '?' }} out{{ e.cost != null ? ' · $' + e.cost.toFixed(4) : '' }}</span>
              </div>
              <a v-if="e.image" :href="e.image" target="_blank" rel="noopener" class="debug-thumb-link" title="Open full screenshot">
                <img :src="e.image" class="debug-thumb" alt="sent screenshot" />
              </a>
              <details class="debug-det"><summary>prompt</summary><pre>{{ e.prompt }}</pre></details>
              <details class="debug-det"><summary>reply</summary><pre>{{ e.reply }}</pre></details>
            </div>
          </div>
        </section>

        <hr class="ai-rule" />

        <!-- 2. Apply a reply -->
        <section class="ai-section">
          <h3 class="ai-h">2 · Apply a reply</h3>
          <p class="hint">
            Paste the assistant's reply here. The app reads the <code>json</code> block and
            <template v-if="isComment">merges its comments into the current view.</template>
            <template v-else>rebuilds the board <strong>into the branch</strong>.</template>
          </p>
          <textarea
            v-model="importText"
            rows="8"
            class="import-area"
            placeholder="Paste the assistant's reply (it should contain a ```json block)…"
          ></textarea>
          <p v-if="buildError" class="import-error">{{ buildError }}</p>
        </section>
      </div>

      <div class="modal-foot">
        <button class="add-btn" :disabled="!importText.trim()" @click="submitBuild">
          <i class="pi pi-bolt" style="font-size: 0.8rem"></i>
          {{ isComment ? 'Apply comments' : 'Apply to branch' }}
        </button>
        <button class="btn-ghost" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { buildPromptMarkdown, promptMode, PROMPTS } from '@/lib/canvyAi'
import { boardToMarkdown } from '@/lib/canvyExport'
import {
  debugLog, debugFolderName, pickDebugFolder, supportsDebugFolder, clearDebugLog,
} from '@/lib/canvyAiDebug'

const props = defineProps({
  open: { type: Boolean, default: false },
  board: { type: Object, default: () => ({}) },
  boardData: { type: Object, default: () => ({}) }, // the currently-viewed (main/branch) data
  scopeIds: { type: Array, default: () => [] },     // selected element ids (for section scope)
  buildError: { type: String, default: '' },
  running: { type: Boolean, default: false },       // a direct "Run with AI" is in flight
  runStatus: { type: String, default: '' },         // progress / result text for the run
  runError: { type: Boolean, default: false },      // style runStatus as an error
  aiNote: { type: String, default: '' },            // the model's own summary of what it did
  aiIssues: { type: Array, default: () => [] },      // real problems the model flagged
  runUsage: { type: Object, default: null },        // { in, out, cost } totals for the last run
})
const emit = defineEmits(['build', 'run', 'close'])

const importText = ref('')
const instruction = ref('')
const steering = ref('')
const copied = ref(false)
const copiedSummary = ref(false)
const selectedPrompt = ref('new') // the enhanced constructive prompt
const useScope = ref(true)
const useContext = ref(false)     // scoped edit, but give the rest of the board as context
const verifyRounds = ref(1)       // how many screenshot-review rounds after the first edit
const showDebug = ref(false)

const supportsFolder = supportsDebugFolder()
async function chooseFolder() { await pickDebugFolder() }
function clearLog() { clearDebugLog() }

const usageText = computed(() => {
  const u = props.runUsage
  if (!u || (!u.in && !u.out && !u.cost)) return ''
  const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
  const parts = []
  if (u.in || u.out) parts.push(`${k(u.in || 0)} in / ${k(u.out || 0)} out`)
  if (u.cost) parts.push(`$${u.cost.toFixed(u.cost < 0.01 ? 4 : 3)}`)
  return parts.join(' · ')
})

const isComment = computed(() => promptMode(selectedPrompt.value) === 'comment')
const scopeSet = computed(() =>
  useScope.value && props.scopeIds.length ? new Set(props.scopeIds.map(String)) : null,
)

watch(
  () => props.open,
  (v) => {
    if (v) {
      importText.value = ''
      instruction.value = ''
      steering.value = ''
      useScope.value = props.scopeIds.length > 0
      useContext.value = false
    }
  },
)

function buildOpts() {
  return { instruction: instruction.value, scopeIds: scopeSet.value, data: props.boardData }
}

function flash(flag) {
  flag.value = true
  setTimeout(() => (flag.value = false), 1600)
}
async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(buildPromptMarkdown(props.board, selectedPrompt.value, buildOpts()))
    flash(copied)
  } catch (e) { console.error(e) }
}
async function copySummary() {
  try {
    await navigator.clipboard.writeText(boardToMarkdown({ name: props.board?.name, data: props.boardData }))
    flash(copiedSummary)
  } catch (e) { console.error(e) }
}
function downloadMd() {
  const name = (props.board?.name || 'canvy-board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'canvy-board'
  const blob = new Blob([buildPromptMarkdown(props.board, selectedPrompt.value, buildOpts())], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
function submitBuild() {
  if (!importText.value.trim()) return
  emit('build', {
    text: importText.value,
    mode: promptMode(selectedPrompt.value),
    scoped: !!scopeSet.value,
  })
}
function runAi() {
  if (props.running) return
  emit('run', {
    promptKey: selectedPrompt.value,
    instruction: instruction.value,
    steering: steering.value,
    scoped: !!scopeSet.value,
    context: !!scopeSet.value && useContext.value,
    scopeIds: scopeSet.value ? [...scopeSet.value] : [],
    verifyRounds: verifyRounds.value,
  })
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: #fff;
  border-radius: 0.9rem;
  width: min(46rem, 94vw);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 3rem);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid #eeede9;
}
.modal-title { font-weight: 700; display: inline-flex; align-items: center; gap: 0.4rem; }
.modal-close { border: none; background: transparent; cursor: pointer; color: #5c5c5c; }
.modal-body { padding: 1.1rem; display: flex; flex-direction: column; gap: 0.9rem; overflow-y: auto; }
.ai-section { display: flex; flex-direction: column; gap: 0.55rem; }
.ai-h { margin: 0; font-size: 0.82rem; font-weight: 700; color: #1a1a1a; }
.ai-rule { border: none; border-top: 1px solid #eeede9; margin: 0; }
.prompt-select-row { display: flex; align-items: center; gap: 0.5rem; }
.prompt-label { font-size: 0.78rem; color: #5c5c5c; white-space: nowrap; }
.prompt-select {
  flex: 1;
  border: 1px solid #e5e4e1;
  border-radius: 0.45rem;
  padding: 0.3rem 0.55rem;
  font-size: 0.8rem;
  background: #fff;
  color: #1a1a1a;
  cursor: pointer;
  outline: none;
}
.prompt-select:focus { border-color: #f87171; box-shadow: 0 0 0 3px #fef2f2; }
.scope-row {
  display: flex; align-items: center; gap: 0.45rem;
  font-size: 0.78rem; color: #5c5c5c; cursor: pointer;
  background: #fef2f2; border: 1px solid #fee2e2; border-radius: 0.45rem;
  padding: 0.4rem 0.55rem;
}
.scope-row span { display: inline-flex; align-items: center; gap: 0.35rem; }
.scope-sub { margin-left: 1.1rem; background: #fff; }
.ai-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }

.run-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.run-btn { flex: 0 0 auto; }
.run-btn:disabled { opacity: 0.6; cursor: default; }
.rounds {
  display: inline-flex; align-items: center; gap: 0.3rem;
  border: 1px solid #e5e4e1; border-radius: 0.5rem;
  padding: 0.2rem 0.35rem; background: #faf9f7;
}
.rounds-label { font-size: 0.72rem; color: #5c5c5c; padding: 0 0.15rem; }
.round-seg {
  border: none; background: transparent; cursor: pointer;
  padding: 0.2rem 0.5rem; border-radius: 0.35rem;
  font-size: 0.76rem; font-weight: 600; color: #5c5c5c;
}
.round-seg.on { background: #fff; color: #b91c1c; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.round-seg:disabled { cursor: default; opacity: 0.6; }
.run-status {
  margin: 0; font-size: 0.78rem; color: #5c5c5c;
  display: inline-flex; align-items: center; gap: 0.35rem;
}
.run-status .pi-check { color: #16a34a; }
.run-status.err { color: #b91c1c; }
.hint { font-size: 0.78rem; color: #5c5c5c; margin: 0; }
.hint code { background: #f3f2f0; padding: 0.05rem 0.3rem; border-radius: 0.3rem; font-size: 0.92em; }
.instruction-area,
.import-area {
  width: 100%;
  border: 1px solid #e5e4e1;
  border-radius: 0.55rem;
  padding: 0.55rem 0.65rem;
  font-size: 0.82rem;
  resize: vertical;
  outline: none;
}
.instruction-area { font-family: inherit; }
.import-area { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; }
.instruction-area:focus,
.import-area:focus { border-color: #f87171; box-shadow: 0 0 0 3px #fef2f2; }
.import-error { margin: 0; font-size: 0.8rem; color: #b91c1c; }
.modal-foot { display: flex; gap: 0.5rem; padding: 0.9rem 1.1rem; border-top: 1px solid #eeede9; }
.add-btn {
  background: #ef4444; color: #fff; border: none; border-radius: 0.55rem;
  padding: 0.5rem 0.9rem; font-weight: 600; font-size: 0.85rem; cursor: pointer;
  display: inline-flex; align-items: center; gap: 0.4rem;
}
.add-btn:hover:not(:disabled) { background: #b91c1c; }
.add-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost {
  background: #fff; border: 1px solid #e5e4e1; border-radius: 0.55rem;
  padding: 0.5rem 0.9rem; font-size: 0.85rem; cursor: pointer; color: #1a1a1a;
  display: inline-flex; align-items: center; gap: 0.4rem;
}
.btn-ghost:hover { background: #f3f2f0; }

/* Steering */
.steer { border: 1px solid #e5e4e1; border-radius: 0.55rem; padding: 0.4rem 0.55rem; background: #faf9f7; }
.steer-sum {
  cursor: pointer; font-size: 0.76rem; color: #5c5c5c; font-weight: 600;
  display: inline-flex; align-items: center; gap: 0.35rem; user-select: none;
}
.steer-area { margin-top: 0.5rem; }

/* Usage + AI note */
.usage { color: #8a8a8a; font-size: 0.74rem; }
.ai-note {
  display: flex; gap: 0.45rem; align-items: flex-start;
  font-size: 0.8rem; color: #1a1a1a; line-height: 1.4;
  background: #fef2f2; border: 1px solid #fee2e2; border-radius: 0.5rem;
  padding: 0.5rem 0.6rem;
}
.ai-note .pi { color: #b91c1c; margin-top: 0.12rem; }
.ai-flags {
  font-size: 0.8rem; color: #713f12; line-height: 1.4;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 0.5rem;
  padding: 0.5rem 0.6rem;
}
.ai-flags-head {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-weight: 700; color: #92400e;
}
.ai-flags-list { margin: 0.35rem 0 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.25rem; }
.ai-flags-list li { margin: 0; }

/* Debug */
.debug-row { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
.btn-sm { padding: 0.32rem 0.55rem; font-size: 0.76rem; }
.debug-panel {
  display: flex; flex-direction: column; gap: 0.6rem;
  max-height: 20rem; overflow-y: auto;
  border: 1px solid #e5e4e1; border-radius: 0.55rem; padding: 0.6rem; background: #faf9f7;
}
.debug-entry { border-bottom: 1px solid #eeede9; padding-bottom: 0.5rem; }
.debug-entry:last-child { border-bottom: none; padding-bottom: 0; }
.debug-head { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.74rem; margin-bottom: 0.35rem; }
.debug-phase { font-weight: 700; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.02em; }
.debug-tok { color: #8a8a8a; }
.debug-thumb-link { display: block; }
.debug-thumb {
  max-width: 100%; max-height: 9rem; border-radius: 0.4rem;
  border: 1px solid #e5e4e1; display: block; object-fit: contain;
}
.debug-det { margin-top: 0.35rem; }
.debug-det summary { cursor: pointer; font-size: 0.74rem; color: #5c5c5c; font-weight: 600; }
.debug-det pre {
  margin: 0.35rem 0 0; padding: 0.5rem; background: #fff; border: 1px solid #e5e4e1;
  border-radius: 0.4rem; font-size: 0.72rem; line-height: 1.35; overflow-x: auto;
  white-space: pre-wrap; word-break: break-word; max-height: 16rem; overflow-y: auto;
}
</style>
