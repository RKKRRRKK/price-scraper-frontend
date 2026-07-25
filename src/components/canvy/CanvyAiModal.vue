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

          <!-- Direct run. Edit modes screenshot-review their result; comment mode is a
               single text-only call that adds comments to the current view. -->
          <div class="run-row">
            <button class="add-btn run-btn" :disabled="running" @click="runAi">
              <i :class="running ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'" style="font-size: 0.8rem"></i>
              {{ running ? (isComment ? 'Reviewing…' : 'Building…') : (isComment ? 'Review with AI' : 'Run with AI') }}
            </button>
            <div v-if="!isComment" class="passes" title="Maximum build passes — the AI reasons, builds and fixes across passes and stops early once it's satisfied">
              <span class="passes-label">Max passes</span>
              <input type="range" min="1" max="8" step="1" v-model.number="maxPasses" :disabled="running" class="passes-slider" />
              <span class="passes-val">{{ maxPasses }}×</span>
            </div>
          </div>

          <!-- After a run: push it further. Two explicit modes so the model knows
               whether to EXPAND or to CORRECT — closing the modal to view the board
               doesn't lose these (canResume persists on the parent). -->
          <div v-if="!isComment && canResume" class="run-row run-sub">
            <span class="run-sub-label">Keep going:</span>
            <button class="add-btn more-btn" :disabled="running" @click="runMore('build')" title="Resume and add substantial new content — expansion is required">
              <i class="pi pi-plus-circle" style="font-size: 0.72rem"></i> Build more
            </button>
            <button class="btn-ghost more-btn" :disabled="running" @click="runMore('fix')" title="Resume and correct mistakes — fix overlaps, arrows, wrong connections">
              <i class="pi pi-wrench" style="font-size: 0.72rem"></i> Correct mistakes
            </button>
          </div>

          <p v-if="runStatus" class="run-status" :class="{ err: runError }">
            <i v-if="!runError && !running" class="pi pi-check" style="font-size: 0.72rem"></i>
            {{ runStatus }}
            <span v-if="usageText" class="usage">· {{ usageText }}</span>
          </p>

          <!-- Live reason-act-observe trace: the model's ! note per pass -->
          <div v-if="!isComment && aiThinking.length" class="ai-think">
            <div class="ai-think-head"><i class="pi pi-bolt" style="font-size: 0.72rem"></i> Thinking</div>
            <ol class="ai-think-list">
              <li v-for="(t, i) in aiThinking" :key="i">
                <span v-if="t.pass" class="ai-think-pass">pass {{ t.pass }}</span>{{ t.note }}
              </li>
            </ol>
          </div>

          <!-- What the model says it did. For edit runs the Thinking trace already
               shows each pass's note, so only surface this bubble for comment mode
               (or when there's no trace) to avoid duplicating it. -->
          <div v-if="aiNote && (isComment || !aiThinking.length)" class="ai-note">
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
            <button class="add-btn" @click="copyPrompt" title="Board (compact op-DSL) + rules + your instruction">
              <i :class="copied ? 'pi pi-check' : 'pi pi-copy'" style="font-size: 0.8rem"></i>
              {{ copied ? 'Copied!' : 'Copy prompt' }}
            </button>
            <button class="btn-ghost" @click="copySummary" title="Human-readable summary of the board (no schema)">
              <i :class="copiedSummary ? 'pi pi-check' : 'pi pi-clipboard'" style="font-size: 0.8rem"></i>
              {{ copiedSummary ? 'Copied!' : 'Copy summary only' }}
            </button>
          </div>

          <!-- Debug: inspect what was sent + download the whole run as a .zip -->
          <div class="debug-row">
            <button class="btn-ghost btn-sm" @click="showDebug = !showDebug">
              <i :class="showDebug ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" style="font-size: 0.7rem"></i>
              Debug log{{ debugLog.length ? ` (${debugLog.length})` : '' }}
            </button>
            <button v-if="debugLog.length" class="btn-ghost btn-sm" @click="downloadLog" title="Download the log as a .zip (prompts, replies, screenshots + summary)">
              <i class="pi pi-download" style="font-size: 0.7rem"></i>
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
            Paste the assistant's reply here. The app reads the <code>ops</code> block and
            <template v-if="isComment">merges its comments into the current view.</template>
            <template v-else>applies its edits <strong>into the branch</strong>.</template>
          </p>
          <textarea
            v-model="importText"
            rows="8"
            class="import-area"
            placeholder="Paste the assistant's reply (it should contain a ```ops block)…"
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
import { buildManualPrompt, promptMode, PROMPTS } from '@/lib/canvyPrompts'
import { boardToMarkdown } from '@/lib/canvyExport'
import { debugLog, clearDebugLog } from '@/lib/canvyAiDebug'
import { zipFiles, dataUriToBytes } from '@/lib/canvyZip'

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
  aiThinking: { type: Array, default: () => [] },    // [{ pass, note }] live reason-act-observe trace
  canResume: { type: Boolean, default: false },      // a finished run for THIS board exists to extend
  runUsage: { type: Object, default: null },        // { in, out, cost } totals for the last run
})
const emit = defineEmits(['build', 'run', 'more', 'close'])

const importText = ref('')
const instruction = ref('')
const steering = ref('')
const copied = ref(false)
const copiedSummary = ref(false)
const selectedPrompt = ref('new') // the enhanced constructive prompt
const useScope = ref(true)
const useContext = ref(false)     // scoped edit, but give the rest of the board as context
const maxPasses = ref(5)          // ceiling on build passes; the AI self-stops earlier
const showDebug = ref(false)

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

function manualOpts() {
  return {
    promptKey: selectedPrompt.value,
    instruction: instruction.value,
    steering: steering.value,
    scopeIds: scopeSet.value,
    context: useContext.value,
  }
}

function flash(flag) {
  flag.value = true
  setTimeout(() => (flag.value = false), 1600)
}
async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(buildManualPrompt(props.board, props.boardData, manualOpts()))
    flash(copied)
  } catch (e) { console.error(e) }
}
async function copySummary() {
  try {
    await navigator.clipboard.writeText(boardToMarkdown({ name: props.board?.name, data: props.boardData }))
    flash(copiedSummary)
  } catch (e) { console.error(e) }
}
function boardSlug() {
  return (props.board?.name || 'canvy-board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'canvy-board'
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
// Bundle the whole debug log into a .zip: one .md + .png per call plus a
// summary.md with the model's note, flagged issues and warnings.
// Calls are numbered oldest-first (the panel shows newest-first).
function downloadLog() {
  if (!debugLog.value.length) return
  const files = []
  const entries = [...debugLog.value].reverse()
  const pad = (n) => String(n).padStart(2, '0')

  // summary.md — errors / corrections / extra info the run surfaced.
  files.push({
    name: 'summary.md',
    data: [
      `# Canvy AI run — ${props.board?.name || 'board'}`,
      `_exported ${new Date().toISOString()} · ${entries.length} call(s)_`,
      '',
      '## Instruction', '', instruction.value || '(none)', '',
      '## Result', '', (props.runStatus || '(none)') + (props.runError ? ' [error]' : ''), '',
      '## Model note (what it says it did)', '', props.aiNote || '(none)', '',
      '## Flagged issues', '',
      props.aiIssues.length ? props.aiIssues.map((s) => `- ${s}`).join('\n') : '(none)', '',
      '## Usage', '', usageText.value || '(none)', '',
    ].join('\n'),
  })

  entries.forEach((e, i) => {
    const base = `${pad(i + 1)}-${e.phase || 'call'}${e.round ? `-r${e.round}` : ''}`
    files.push({
      name: `${base}.md`,
      data: [
        `# ${e.phase || 'call'}${e.round ? ` · round ${e.round}` : ''}`,
        '',
        `- tokens: ${e.tokensIn ?? '?'} in / ${e.tokensOut ?? '?'} out${e.cost != null ? ` · $${e.cost.toFixed(4)}` : ''}`,
        e.image ? `- screenshot: ${base}.png` : '',
        '',
        '## Prompt', '', e.prompt || '(none)', '',
        '## Reply', '', e.reply || '(none)', '',
      ].join('\n'),
    })
    if (e.image) {
      try { files.push({ name: `${base}.png`, data: dataUriToBytes(e.image) }) } catch { /* skip bad image */ }
    }
  })

  saveBlob(zipFiles(files), `${boardSlug()}-debug-log.zip`)
}
function submitBuild() {
  if (!importText.value.trim()) return
  emit('build', {
    text: importText.value,
    promptKey: selectedPrompt.value,
    scoped: !!scopeSet.value,
    context: !!scopeSet.value && useContext.value,
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
    maxPasses: maxPasses.value,
  })
}
// Resume the finished build. mode 'build' = add substantial new content (expansion
// required); mode 'fix' = correct mistakes only. The parent reuses the last run's
// scope/instruction and threads its progress notes back in.
function runMore(mode) {
  if (props.running) return
  emit('more', { maxPasses: maxPasses.value, mode })
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
.passes {
  display: inline-flex; align-items: center; gap: 0.4rem;
  border: 1px solid #e5e4e1; border-radius: 0.5rem;
  padding: 0.25rem 0.5rem; background: #faf9f7;
}
.passes-label { font-size: 0.72rem; color: #5c5c5c; }
.passes-slider { width: 6rem; accent-color: #ef4444; cursor: pointer; }
.passes-slider:disabled { cursor: default; opacity: 0.6; }
.passes-val { font-size: 0.76rem; font-weight: 600; color: #b91c1c; min-width: 1.6rem; text-align: right; }
.run-sub { margin-top: 0.15rem; gap: 0.4rem; }
.run-sub-label { font-size: 0.72rem; color: #5c5c5c; }
.more-btn { font-size: 0.75rem; }
.ai-think {
  border: 1px solid #eee7d8; background: #fffdf6; border-radius: 0.5rem;
  padding: 0.5rem 0.65rem;
}
.ai-think-head {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-size: 0.72rem; font-weight: 600; color: #92700f; margin-bottom: 0.35rem;
}
.ai-think-list { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.3rem; }
.ai-think-list li { font-size: 0.78rem; color: #4a4a4a; line-height: 1.35; }
.ai-think-pass {
  display: inline-block; margin-right: 0.4rem; padding: 0.02rem 0.35rem;
  font-size: 0.66rem; font-weight: 600; color: #92700f;
  background: #fbf1d3; border-radius: 0.3rem;
}
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
