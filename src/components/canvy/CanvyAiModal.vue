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
            Ask an assistant to create or edit the board, then paste its reply below.
          </p>
          <div class="ai-actions">
            <button class="add-btn" @click="copyPrompt" title="Board JSON + schema + editing rules">
              <i :class="copied ? 'pi pi-check' : 'pi pi-copy'" style="font-size: 0.8rem"></i>
              {{ copied ? 'Copied!' : 'Copy edit prompt' }}
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
            rebuilds the board from it.
          </p>
          <textarea
            v-model="importText"
            rows="9"
            class="import-area"
            placeholder="Paste the assistant's reply (it should contain a ```json block)…"
          ></textarea>
          <p v-if="buildError" class="import-error">{{ buildError }}</p>
        </section>
      </div>

      <div class="modal-foot">
        <button class="add-btn" :disabled="!importText.trim()" @click="submitBuild">
          <i class="pi pi-bolt" style="font-size: 0.8rem"></i> Apply to board
        </button>
        <button class="btn-ghost" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { buildPromptMarkdown } from '@/lib/canvyAi'
import { boardToMarkdown } from '@/lib/canvyExport'

const props = defineProps({
  open: { type: Boolean, default: false },
  board: { type: Object, default: () => ({}) },
  buildError: { type: String, default: '' },
})
const emit = defineEmits(['build', 'close'])

const importText = ref('')
const copied = ref(false)
const copiedSummary = ref(false)

watch(
  () => props.open,
  (v) => { if (v) importText.value = '' },
)

function flash(flag) {
  flag.value = true
  setTimeout(() => (flag.value = false), 1600)
}
async function copyPrompt() {
  try { await navigator.clipboard.writeText(buildPromptMarkdown(props.board)); flash(copied) } catch (e) { console.error(e) }
}
async function copySummary() {
  try { await navigator.clipboard.writeText(boardToMarkdown(props.board)); flash(copiedSummary) } catch (e) { console.error(e) }
}
function downloadMd() {
  const name = (props.board?.name || 'canvy-board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'canvy-board'
  const blob = new Blob([buildPromptMarkdown(props.board)], { type: 'text/markdown' })
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
  if (importText.value.trim()) emit('build', importText.value)
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
.ai-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.hint { font-size: 0.78rem; color: #5c5c5c; margin: 0; }
.hint code { background: #f3f2f0; padding: 0.05rem 0.3rem; border-radius: 0.3rem; font-size: 0.92em; }
.import-area {
  width: 100%;
  border: 1px solid #e5e4e1;
  border-radius: 0.55rem;
  padding: 0.55rem 0.65rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  resize: vertical;
  outline: none;
}
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
