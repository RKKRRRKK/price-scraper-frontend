<template>
  <div v-if="open" class="modal-back" @click.self="close">
    <div class="modal">
      <div class="modal-h">
        <span><i class="pi pi-sliders-h" style="font-size: 0.9rem; margin-right: 0.4rem;"></i>Adjust jianpu · 1={{ keyLabel }}</span>
        <button class="modal-x" @click="close" aria-label="Close"><i class="pi pi-times"></i></button>
      </div>

      <div class="modal-b">
        <div class="lead">
          Copy the numbers, tweak them however you like, then paste back and press
          play until it sounds right. <b>Save</b> keeps it as <b>1={{ keyLabel }} · adj</b> in
          Key &amp; transpose; nothing is written until you do.
        </div>

        <div class="tools">
          <button class="tool" @click="copy">
            <i :class="copied ? 'pi pi-check' : 'pi pi-copy'"></i> {{ copied ? 'Copied' : 'Copy' }}
          </button>
          <button class="tool" @click="paste">
            <i class="pi pi-clipboard"></i> Paste
          </button>
          <button class="tool" @click="reset" :disabled="text === seeded">
            <i class="pi pi-refresh"></i> Reset
          </button>
          <span class="tool-status">
            <span v-if="error" class="bad"><i class="pi pi-exclamation-circle"></i> {{ error }}</span>
            <span v-else-if="summary" :class="fitBad ? 'warn' : 'ok'">
              <i :class="fitBad ? 'pi pi-exclamation-triangle' : 'pi pi-check-circle'"></i> {{ summary }}
            </span>
          </span>
        </div>

        <textarea
          v-model="text"
          class="editor"
          rows="12"
          spellcheck="false"
          @paste="onNativePaste"
        ></textarea>

        <div class="hint">
          One text line per printed line. <b>1–7</b> notes · <b>0</b> rest ·
          <b>5'</b> octave up · <b>5,</b> down · <b>-</b> holds a beat ·
          <b>5_</b> ½ · <b>5.</b> dotted · <b>#5 b5</b> sharp/flat · <b>|</b> ignored.
        </div>
      </div>

      <div class="modal-f">
        <button class="btn-ghost" @click="close">Cancel</button>
        <button class="btn-primary" :disabled="!result || saving" @click="save">
          <i :class="saving ? 'pi pi-spin pi-spinner' : 'pi pi-check'"></i>
          Save adjusted
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { parseManualJianpu, scoreToJianpuText } from '@/lib/bawu/ai'
import { flattenScore, KEYS } from '@/lib/bawu/notes'

const props = defineProps({
  open: { type: Boolean, default: false },
  // The currently selected transposition's data ({ key, bpm, timeSig, lines }).
  data: { type: Object, default: null },
  saving: { type: Boolean, default: false },
})
const emit = defineEmits(['close', 'save'])

const text = ref('')
const seeded = ref('') // the pristine serialisation, for the Reset button
const copied = ref(false)
let copiedTimer = 0

// Re-seed the textarea from the active transposition each time the modal opens.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    seeded.value = props.data ? scoreToJianpuText(props.data) : ''
    text.value = seeded.value
    copied.value = false
  },
  { immediate: true },
)

const parsed = computed(() => {
  if (!text.value.trim()) return { result: null, error: '' }
  try {
    return { result: parseManualJianpu(text.value), error: '' }
  } catch (e) {
    return { result: null, error: e.message || 'Could not read the jianpu.' }
  }
})
const result = computed(() => parsed.value.result)
const error = computed(() => parsed.value.error)

const keyLabel = computed(() => {
  const k = result.value?.data.key || props.data?.key || 'F'
  return KEYS[k]?.label || k
})

const flat = computed(() => (result.value ? flattenScore(result.value.data) : null))
const fitBad = computed(() => !!flat.value && flat.value.playable.some((n) => n.row === null))
const summary = computed(() => {
  if (!flat.value) return ''
  const d = result.value.data
  const notes = flat.value.playable.length
  const off = flat.value.playable.filter((n) => n.row === null).length
  const lines = d.lines.length
  const base = `${notes} notes · ${lines} ${lines === 1 ? 'line' : 'lines'} · 1=${KEYS[d.key]?.label || d.key}`
  return off ? `${base} · ${off} out of range` : `${base} · fits ✓`
})

async function copy() {
  try {
    await navigator.clipboard.writeText(text.value)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    // Clipboard blocked — select the text so the user can copy manually.
    document.querySelector('.editor')?.select()
  }
}

async function paste() {
  try {
    const t = await navigator.clipboard.readText()
    if (t) text.value = t
  } catch {
    document.querySelector('.editor')?.focus()
  }
}

// A native paste into an already-filled box replaces the whole thing, so the
// user doesn't have to clear it first.
function onNativePaste(e) {
  const t = e.clipboardData?.getData('text')
  if (!t) return
  e.preventDefault()
  text.value = t
}

function reset() {
  text.value = seeded.value
}

function close() {
  emit('close')
}

function save() {
  if (!result.value || props.saving) return
  emit('save', { data: result.value.data })
}
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
.modal-b { padding: 1rem; display: flex; flex-direction: column; gap: 0.7rem; }
.modal-f {
  display: flex; align-items: center; justify-content: flex-end; gap: 0.45rem;
  padding: 0.75rem 1rem; border-top: 1px solid var(--border, #e5e4e1);
}

.lead { font-size: 0.82rem; color: var(--text-dim, #5c5c5c); line-height: 1.5; }
.lead b { color: var(--text, #1a1a1a); font-weight: 700; }

.tools { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.tool {
  display: inline-flex; align-items: center; gap: 0.35rem; height: 2rem; padding: 0 0.7rem;
  border-radius: 0.5rem; border: 1px solid var(--border, #e5e4e1); background: #fff;
  font-size: 0.8rem; font-weight: 600; color: var(--text-dim, #5c5c5c); cursor: pointer;
  transition: border-color 120ms, color 120ms, background 120ms;
}
.tool:hover:not(:disabled) { border-color: var(--accent-400, #f87171); color: var(--accent-600, #b91c1c); background: var(--accent-050, #fef2f2); }
.tool:disabled { opacity: 0.45; cursor: not-allowed; }
.tool i { font-size: 0.78rem; }
.tool-status { margin-left: auto; font-size: 0.76rem; display: inline-flex; align-items: center; }
.tool-status .ok { color: #166534; display: inline-flex; align-items: center; gap: 0.3rem; }
.tool-status .warn { color: #b45309; display: inline-flex; align-items: center; gap: 0.3rem; }
.tool-status .bad { color: #c33; display: inline-flex; align-items: center; gap: 0.3rem; }

.editor {
  width: 100%; border: 1px solid var(--border, #e5e4e1); border-radius: 0.6rem;
  padding: 0.7rem 0.8rem; outline: none; resize: vertical; background: #fffcf7;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.9rem; line-height: 1.9; color: var(--text, #1a1a1a);
}
.editor:focus { border-color: var(--accent-500, #ef4444); box-shadow: 0 0 0 3px var(--accent-050, #fef2f2); }

.hint { font-size: 0.72rem; color: var(--text-faint, #9a9a9a); line-height: 1.6; }
.hint b { color: var(--text-dim, #5c5c5c); font-weight: 700; }

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
  height: 2.25rem; padding: 0 0.9rem; border-radius: 0.6rem; font-size: 0.85rem; font-weight: 500;
  color: var(--text-dim, #5c5c5c); border: 1px solid var(--border, #e5e4e1); background: #fff; cursor: pointer;
}
.btn-ghost:hover { background: var(--bg-sunken, #f3f2f0); color: var(--text, #1a1a1a); }
</style>
