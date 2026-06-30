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
            Copy a prompt containing the current board (as JSON) plus the schema and rules.
            Ask an assistant to edit the board or review it, then paste its reply below.
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

          <!-- Instruction field (3rd field) -->
          <textarea
            v-model="instruction"
            rows="3"
            class="instruction-area"
            :placeholder="isComment ? 'What should the AI review or focus on?' : 'Describe the change you want…'"
          ></textarea>

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

const props = defineProps({
  open: { type: Boolean, default: false },
  board: { type: Object, default: () => ({}) },
  boardData: { type: Object, default: () => ({}) }, // the currently-viewed (main/branch) data
  scopeIds: { type: Array, default: () => [] },     // selected element ids (for section scope)
  buildError: { type: String, default: '' },
})
const emit = defineEmits(['build', 'close'])

const importText = ref('')
const instruction = ref('')
const copied = ref(false)
const copiedSummary = ref(false)
const selectedPrompt = ref('new') // the enhanced constructive prompt
const useScope = ref(true)

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
      useScope.value = props.scopeIds.length > 0
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
.ai-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
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
</style>
