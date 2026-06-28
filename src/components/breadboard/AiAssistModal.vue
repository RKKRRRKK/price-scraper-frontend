<template>
  <div v-if="open" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal modal-wide">
      <div class="modal-head">
        <span class="modal-title"><i class="pi pi-sparkles" style="font-size: 0.85rem"></i> AI assist</span>
        <button class="modal-close" @click="$emit('close')">
          <i class="pi pi-times" style="font-size: 0.85rem"></i>
        </button>
      </div>

      <div class="modal-body">
        <!-- ── 1. Send to an assistant ── -->
        <section class="ai-section">
          <h3 class="ai-h">1 · Send this board to an assistant</h3>
          <p class="hint">
            Copy a prompt, ask an assistant to design or modify the circuit, then paste its
            reply below to build it.
          </p>

          <label class="stock-toggle" title="Limit the prompt's part list to parts you have in stock">
            <input type="checkbox" v-model="inStockOnly" />
            Only use parts I have in stock
          </label>

          <div class="ai-actions">
            <button class="add-btn" @click="copyPrompt" title="Full design prompt: wiring + parts + build instructions">
              <i :class="copied ? 'pi pi-check' : 'pi pi-copy'" style="font-size: 0.8rem"></i>
              {{ copied ? 'Copied!' : 'Copy design prompt' }}
            </button>
            <button class="btn-ghost" @click="copyBoard" title="Just the current wiring, no instructions — for asking about the existing circuit">
              <i :class="copiedState ? 'pi pi-check' : 'pi pi-clipboard'" style="font-size: 0.8rem"></i>
              {{ copiedState ? 'Copied!' : 'Copy board only' }}
            </button>
            <button class="btn-ghost" @click="downloadMd" title="Download the full prompt as a .md file">
              <i class="pi pi-download" style="font-size: 0.8rem"></i> Download .md
            </button>
          </div>
        </section>

        <hr class="ai-rule" />

        <!-- ── 2. Build from a reply ── -->
        <section class="ai-section">
          <h3 class="ai-h">2 · Build from a reply</h3>
          <p class="hint">
            Paste the assistant's reply here. The app reads the <code>json</code> build block
            and constructs the layout.
          </p>
          <textarea
            v-model="importText"
            rows="9"
            class="import-area"
            placeholder='Paste the assistant&apos;s reply (it should contain a ```json build block)…'
          ></textarea>
          <p v-if="buildError" class="import-error">{{ buildError }}</p>
        </section>
      </div>

      <div class="modal-foot">
        <button class="add-btn" :disabled="!importText.trim()" @click="submitBuild">
          <i class="pi pi-bolt" style="font-size: 0.8rem"></i> Build
        </button>
        <button class="btn-ghost" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import {
  buildSheetMarkdown, buildStateMarkdown,
  copyToClipboard, downloadTextFile, slugify,
} from '@/lib/breadboard/markdown'

const props = defineProps({
  open: { type: Boolean, default: false },
  // currentSheet() shape: { name, data, updated_at, library }
  sheet: { type: Object, default: () => ({}) },
  buildError: { type: String, default: '' },
})
const emit = defineEmits(['build', 'close'])

const inStockOnly = ref(false)
const importText = ref('')
const copied = ref(false)
const copiedState = ref(false)

// Clear the paste box each time the dialog opens.
watch(
  () => props.open,
  (v) => { if (v) importText.value = '' },
)

function flash(flag) {
  flag.value = true
  setTimeout(() => (flag.value = false), 1600)
}

async function copyPrompt() {
  const ok = await copyToClipboard(buildSheetMarkdown(props.sheet, { inStockOnly: inStockOnly.value }))
  if (ok) flash(copied)
}
async function copyBoard() {
  const ok = await copyToClipboard(buildStateMarkdown(props.sheet))
  if (ok) flash(copiedState)
}
function downloadMd() {
  downloadTextFile(
    `${slugify(props.sheet?.name || 'breadboard')}.md`,
    buildSheetMarkdown(props.sheet, { inStockOnly: inStockOnly.value }),
    'text/markdown',
  )
}
function submitBuild() {
  if (importText.value.trim()) emit('build', importText.value)
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: #fff;
  border-radius: 0.9rem;
  width: min(46rem, 94vw);
  /* nudge the dialog left of centre on wide screens; none on narrow ones */
  margin-right: clamp(0rem, 16vw, 18rem);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--bb-border-soft, #eeede9);
}
.modal-title {
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.modal-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--bb-text-dim, #5c5c5c);
}
.modal-body {
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}
.ai-section {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.ai-h {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--bb-text, #1a1a1a);
}
.ai-rule {
  border: none;
  border-top: 1px solid var(--bb-border-soft, #eeede9);
  margin: 0;
}
.ai-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.stock-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: var(--bb-text-dim, #5c5c5c);
  cursor: pointer;
  user-select: none;
}
.stock-toggle input {
  cursor: pointer;
  margin: 0;
}
.hint {
  font-size: 0.78rem;
  color: var(--bb-text-dim, #5c5c5c);
  margin: 0;
}
.hint code {
  background: var(--bb-sunken, #f3f2f0);
  padding: 0.05rem 0.3rem;
  border-radius: 0.3rem;
  font-size: 0.92em;
}
.import-area {
  width: 100%;
  border: 1px solid var(--bb-border, #e5e4e1);
  border-radius: 0.55rem;
  padding: 0.55rem 0.65rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  resize: vertical;
}
.import-error {
  margin: 0;
  font-size: 0.8rem;
  color: #b91c1c;
}
.modal-foot {
  display: flex;
  gap: 0.5rem;
  padding: 0.9rem 1.1rem;
  border-top: 1px solid var(--bb-border-soft, #eeede9);
}
.add-btn {
  background: var(--bb-accent, #ef4444);
  color: #fff;
  border: none;
  border-radius: 0.55rem;
  padding: 0.5rem 0.9rem;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-ghost {
  background: #fff;
  border: 1px solid var(--bb-border, #e5e4e1);
  border-radius: 0.55rem;
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--bb-text, #1a1a1a);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
</style>
