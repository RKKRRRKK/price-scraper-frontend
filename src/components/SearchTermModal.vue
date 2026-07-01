<template>
  <Dialog
    v-model:visible="visible"
    modal
    :showHeader="false"
    :dismissableMask="true"
    :position="isMobile ? 'bottom' : 'center'"
    :class="['new-job-dialog', { 'nj-sheet': isMobile }]"
    :style="isMobile ? { width: '100%', maxWidth: '100%', margin: '0' } : { width: '440px' }"
  >
    <div class="nj-body">
      <!-- drag handle (mobile sheet) -->
      <div v-if="isMobile" class="nj-handle"></div>

      <!-- title -->
      <div class="nj-titlebar">
        <h2 class="nj-title">New scrape job</h2>
        <span class="nj-close" role="button" aria-label="Close" @click="visible = false">×</span>
      </div>

      <!-- search term -->
      <div class="nj-field">
        <label class="nj-label">Search term</label>
        <input
          v-model="form.term"
          class="nj-input"
          placeholder="e.g. GeForce RTX 5070"
          @keydown.enter.prevent
        />
      </div>

      <!-- lens filters -->
      <div class="nj-field">
        <label class="nj-label">Lens search filters</label>
        <div class="nj-pills">
          <span
            class="nj-pill"
            :class="{ on: form.primeOnly }"
            :title="tips.zoom"
            @click="form.primeOnly = !form.primeOnly"
          >
            <span v-if="form.primeOnly">✓ </span>Exclude zooms
          </span>
          <span
            class="nj-pill"
            :class="{ on: form.lensOnly }"
            :title="tips.bodies"
            @click="form.lensOnly = !form.lensOnly"
          >
            <span v-if="form.lensOnly">✓ </span>Exclude bodies
          </span>
          <span
            class="nj-pill"
            :class="{ on: form.excludeAcc }"
            :title="tips.acc"
            @click="form.excludeAcc = !form.excludeAcc"
          >
            <span v-if="form.excludeAcc">✓ </span>Exclude accessories
          </span>
        </div>
      </div>

      <!-- must include -->
      <div class="nj-field">
        <div class="nj-label-row">
          <label class="nj-label">Must include</label>
          <span class="nj-hint">words a listing needs to be valid</span>
        </div>
        <div class="nj-chips" @click="focusRef('incInput')">
          <span v-for="(w, i) in form.include" :key="'inc' + i" class="nj-chip inc">
            {{ w }} <span class="nj-chip-x" @click.stop="form.include.splice(i, 1)">×</span>
          </span>
          <input
            ref="incInput"
            v-model="incDraft"
            class="nj-chip-input"
            placeholder="type &amp; press enter…"
            @keydown.enter.prevent="addChip('include', 'incDraft')"
            @keydown.backspace="onBackspace('include', 'incDraft')"
          />
        </div>
      </div>

      <!-- must not include -->
      <div class="nj-field">
        <div class="nj-label-row">
          <label class="nj-label">Must not include</label>
          <span class="nj-hint">words that invalidate a listing</span>
        </div>
        <div class="nj-chips" @click="focusRef('excInput')">
          <span v-for="(w, i) in form.exclude" :key="'exc' + i" class="nj-chip exc">
            {{ w }} <span class="nj-chip-x" @click.stop="form.exclude.splice(i, 1)">×</span>
          </span>
          <input
            ref="excInput"
            v-model="excDraft"
            class="nj-chip-input"
            placeholder="type &amp; press enter…"
            @keydown.enter.prevent="addChip('exclude', 'excDraft')"
            @keydown.backspace="onBackspace('exclude', 'excDraft')"
          />
        </div>
      </div>

      <!-- smart filtering -->
      <div class="nj-smart">
        <div class="nj-smart-head">
          <span
            class="nj-switch"
            :class="{ on: form.smart_filter }"
            role="switch"
            :aria-checked="form.smart_filter"
            @click="form.smart_filter = !form.smart_filter"
          >
            <span class="nj-knob"></span>
          </span>
          <span class="nj-smart-label">Smart filtering</span>
          <span class="nj-smart-note">uses AI — costs $$ and slows scraping, only when needed</span>
        </div>
        <textarea
          v-show="form.smart_filter"
          v-model="form.instructions"
          class="nj-textarea"
          placeholder="Extra instructions for the AI, e.g. 'only the Founders Edition, no water-blocked cards'…"
        ></textarea>
      </div>

      <!-- footer -->
      <div class="nj-footer">
        <button v-if="!isMobile" class="nj-cancel" @click="visible = false">Cancel</button>
        <button class="nj-save" :class="{ full: isMobile }" @click="save">Save job</button>
      </div>
    </div>
  </Dialog>
</template>

<script setup>
import { ref, reactive, watch, nextTick } from 'vue'
import Dialog from 'primevue/dialog'
import { useSearchTerms } from '@/stores/searchTerms'
import { useIsMobile } from '@/composables/useIsMobile'

const props = defineProps({
  show: Boolean,
  marketplace: String,
  fileId: { type: Number, required: true },
})
const emit = defineEmits(['close'])

const isMobile = useIsMobile()
const store = useSearchTerms()

const visible = ref(props.show)
watch(
  () => props.show,
  (v) => {
    visible.value = v
    if (v) resetForm()
  },
)
watch(visible, (v) => {
  if (!v) emit('close')
})

const tips = {
  zoom: 'When searching for 50mm, you won’t get results for 18-50mm zooms',
  bodies: 'Filters out listings where the lens comes bundled with a camera body',
  acc: 'Filters out hoods, covers and other common accessories',
}

const form = reactive({
  term: '',
  primeOnly: false,
  lensOnly: false,
  excludeAcc: false,
  smart_filter: false,
  include: [],
  exclude: [],
  instructions: '',
})

const incDraft = ref('')
const excDraft = ref('')
const incInput = ref(null)
const excInput = ref(null)

function resetForm() {
  form.term = ''
  form.primeOnly = false
  form.lensOnly = false
  form.excludeAcc = false
  form.smart_filter = false
  form.include = []
  form.exclude = []
  form.instructions = ''
  incDraft.value = ''
  excDraft.value = ''
}

const draftRefs = { incDraft, excDraft }
function addChip(field, draftKey) {
  const val = draftRefs[draftKey].value.trim()
  if (val && !form[field].includes(val)) form[field].push(val)
  draftRefs[draftKey].value = ''
}
function onBackspace(field, draftKey) {
  if (draftRefs[draftKey].value === '' && form[field].length) form[field].pop()
}
function focusRef(name) {
  const map = { incInput, excInput }
  map[name]?.value?.focus()
}

async function save() {
  // flush any pending draft text into chips
  if (incDraft.value.trim()) addChip('include', 'incDraft')
  if (excDraft.value.trim()) addChip('exclude', 'excDraft')

  const clean = {
    marketplace: props.marketplace,
    term: form.term,
    primeOnly: form.primeOnly,
    lensOnly: form.lensOnly,
    excludeAcc: form.excludeAcc,
    smart_filter: form.smart_filter,
    instructions: form.instructions,
    include: form.include.filter((v) => v?.trim().length),
    exclude: form.exclude.filter((v) => v?.trim().length),
    fileId: props.fileId,
  }
  await store.addTerm(clean)
  emit('close')
  await nextTick()
}
</script>

<!-- Dialog chrome is teleported to <body>; style unscoped, keyed by .new-job-dialog -->
<style>
.new-job-dialog.p-dialog {
  border-radius: 20px;
  background: #fffdf9;
  box-shadow: 0 24px 60px rgba(61, 50, 38, 0.35);
  overflow: hidden;
}
.new-job-dialog .p-dialog-content {
  background: #fffdf9;
  padding: 0;
  border-radius: 20px;
}
.new-job-dialog.nj-sheet.p-dialog {
  border-radius: 24px 24px 0 0;
}
.new-job-dialog.nj-sheet .p-dialog-content {
  border-radius: 24px 24px 0 0;
}
.p-dialog-mask:has(.new-job-dialog) {
  background: rgba(61, 50, 38, 0.35);
}

.new-job-dialog .nj-body {
  font-family: 'Outfit', system-ui, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px 26px;
}
.nj-sheet .nj-body {
  gap: 14px;
  padding: 12px 18px 22px;
}

.nj-handle {
  width: 40px;
  height: 4px;
  border-radius: 99px;
  background: #e0d2ba;
  margin: 0 auto;
}

.nj-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.nj-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  color: #3d3226;
  letter-spacing: -0.01em;
}
.nj-close {
  color: #c4ad8a;
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  line-height: 1;
}
.nj-close:hover {
  color: #3d3226;
}

.nj-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.nj-label {
  font-size: 11.5px;
  font-weight: 700;
  color: #c9a877;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.nj-label-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.nj-hint {
  font-size: 11.5px;
  color: #c4ad8a;
}

.nj-input {
  border: 1.5px solid #eadfcf;
  border-radius: 12px;
  padding: 12px 14px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  background: #fff;
  color: #3d3226;
  outline: none;
}
.nj-input:focus {
  border-color: #ea6c0a;
}
.nj-sheet .nj-input {
  font-size: 16px;
}

/* toggle pills */
.nj-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.nj-pill {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  border-radius: 99px;
  padding: 8px 14px;
  background: #f8f0e4;
  color: #8a7a64;
  user-select: none;
  transition: background-color 0.15s;
}
.nj-pill:hover {
  background: #f0e4d0;
}
.nj-pill.on {
  font-weight: 700;
  background: #ffe8d2;
  color: #b3520e;
  box-shadow: inset 0 0 0 1.5px #f5c89a;
}

/* chip inputs */
.nj-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  border: 1.5px solid #eadfcf;
  border-radius: 12px;
  padding: 9px 12px;
  background: #fff;
  cursor: text;
}
.nj-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  border-radius: 8px;
  padding: 5px 10px;
}
.nj-chip.inc {
  background: #dcf3e4;
  color: #177a41;
}
.nj-chip.exc {
  background: #fbe3e0;
  color: #b23a30;
}
.nj-chip-x {
  opacity: 0.5;
  cursor: pointer;
}
.nj-chip-x:hover {
  opacity: 1;
}
.nj-chip-input {
  flex: 1;
  min-width: 120px;
  border: none;
  outline: none;
  background: transparent;
  font-family: inherit;
  font-size: 13.5px;
  color: #3d3226;
}
.nj-chip-input::placeholder {
  color: #c4ad8a;
}
.nj-sheet .nj-chip-input {
  font-size: 16px;
}

/* smart filtering */
.nj-smart {
  background: #f8f0e4;
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.nj-smart-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.nj-switch {
  width: 40px;
  height: 23px;
  border-radius: 99px;
  background: #e0d2ba;
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
  transition: background-color 0.15s;
}
.nj-switch.on {
  background: #ea6c0a;
}
.nj-knob {
  position: absolute;
  top: 2.5px;
  left: 2.5px;
  width: 18px;
  height: 18px;
  border-radius: 99px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: left 0.15s;
}
.nj-switch.on .nj-knob {
  left: 19.5px;
}
.nj-smart-label {
  font-size: 14px;
  font-weight: 700;
  color: #3d3226;
}
.nj-smart-note {
  font-size: 11.5px;
  color: #a8926f;
  margin-left: auto;
  text-align: right;
  max-width: 160px;
}
.nj-textarea {
  border: 1.5px solid #eadfcf;
  border-radius: 10px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 13px;
  background: #fff;
  color: #3d3226;
  outline: none;
  resize: none;
  min-height: 60px;
}
.nj-textarea:focus {
  border-color: #ea6c0a;
}

/* footer */
.nj-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 2px;
}
.nj-cancel {
  border: none;
  background: transparent;
  color: #8a7a64;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  border-radius: 12px;
  padding: 11px 16px;
  cursor: pointer;
}
.nj-cancel:hover {
  color: #3d3226;
}
.nj-save {
  border: none;
  background: #ea6c0a;
  color: #fff;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  border-radius: 12px;
  padding: 11px 22px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(234, 108, 10, 0.35);
  transition: background-color 0.15s;
}
.nj-save:hover {
  background: #c2540a;
}
.nj-save.full {
  width: 100%;
  font-size: 15px;
  border-radius: 14px;
  padding: 15px;
}
</style>
