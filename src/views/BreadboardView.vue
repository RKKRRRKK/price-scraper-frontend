<template>
  <div class="bb-app">
    <!-- ── Sheet catalogue rail ── -->
    <aside class="rail" :class="{ open: railOpen }">
      <div class="rail-head">
        <div>
          <div class="eyebrow">Tools</div>
          <h1 class="rail-title">Breadboard</h1>
        </div>
        <button class="icon-btn mobile-only" @click="railOpen = false" title="Close">
          <i class="pi pi-times" style="font-size: 0.85rem"></i>
        </button>
      </div>

      <button class="add-btn rail-new" @click="newOpen = true">
        <i class="pi pi-plus" style="font-size: 0.8rem"></i> New sheet
      </button>

      <div class="rail-list">
        <div v-if="store.loading && !store.sheets.length" class="rail-loading">
          <i class="pi pi-spin pi-spinner" style="font-size: 1.2rem"></i>
        </div>
        <div v-else-if="!store.sheets.length" class="rail-empty">No sheets yet.</div>
        <button
          v-for="s in store.sheets"
          :key="s.id"
          class="rail-item"
          :class="{ active: s.id === store.activeSheetId }"
          @click="selectSheet(s.id)"
        >
          <span class="rail-item-name">{{ s.name }}</span>
          <span class="rail-item-meta">{{ partCount(s) }}</span>
        </button>
      </div>
    </aside>

    <!-- ── Main ── -->
    <main class="main">
      <div v-if="!data" class="empty">
        <i class="pi pi-microchip" style="font-size: 3rem; color: var(--bb-text-faint)"></i>
        <div class="empty-title">No sheet selected</div>
        <div class="empty-sub">Create a sheet to start laying out a breadboard.</div>
        <button class="add-btn add-btn-lg" @click="newOpen = true">
          <i class="pi pi-plus" style="font-size: 0.85rem"></i> New sheet
        </button>
      </div>

      <template v-else>
        <!-- toolbar -->
        <div class="toolbar">
          <button class="btn-ghost btn-sm rail-toggle mobile-only" @click="railOpen = true">
            <i class="pi pi-bars" style="font-size: 0.75rem"></i>
          </button>
          <input class="sheet-name" :value="store.activeSheet?.name" @change="renameSheet($event.target.value)" />

          <select class="sel" :value="boardType" @change="changeSize($event.target.value)">
            <option v-for="b in BREADBOARD_LIST" :key="b.type" :value="b.type">{{ b.label }}</option>
          </select>

          <div class="wire-colors" title="Jumper colour">
            <button
              v-for="c in WIRE_COLORS" :key="c"
              class="wire-swatch" :class="{ on: c === wireColor }"
              :style="{ background: c }" @click="wireColor = c"
            ></button>
          </div>

          <div class="toolbar-spacer"></div>

          <span v-if="store.saving" class="save-dot"><i class="pi pi-spin pi-spinner" style="font-size: 0.7rem"></i> saving…</span>

          <button class="btn-ghost btn-sm" @click="fitView" title="Fit to view"><i class="pi pi-window-maximize" style="font-size: 0.75rem"></i></button>
          <button class="btn-ghost btn-sm" @click="openImport" title="Build from an AI reply"><i class="pi pi-sparkles" style="font-size: 0.75rem"></i> AI build</button>
          <button class="btn-ghost btn-sm" @click="downloadMd" title="Download .md"><i class="pi pi-download" style="font-size: 0.75rem"></i> .md</button>
          <button class="btn-primary btn-sm" @click="copyMd">
            <i :class="copied ? 'pi pi-check' : 'pi pi-copy'" style="font-size: 0.75rem"></i>
            {{ copied ? 'Copied!' : 'Copy as MD' }}
          </button>
          <button class="icon-btn danger" @click="removeSheet" title="Delete sheet"><i class="pi pi-trash" style="font-size: 0.8rem"></i></button>
        </div>

        <!-- workspace -->
        <div class="workspace">
          <ComponentPalette class="pane palette-pane" :tool="tool" @select-tool="tool = $event" @custom="customOpen = true" />

          <div class="canvas-pane">
            <BreadboardCanvas
              ref="canvasRef"
              :data="data"
              :sheet-id="store.activeSheetId"
              :selected-id="selectedId"
              :tool="tool"
              :wire-color="wireColor"
              @add="onAdd"
              @move="onMove"
              @select="selectedId = $event"
              @add-wire="onAddWire"
              @remove-wire="onRemoveWire"
              @placed="tool = null"
              @cancel="tool = null"
            />
            <div class="stat-bar">
              <span>{{ data.items.length }} parts</span>
              <span>·</span>
              <span>{{ netInfo.nets.length }} nets</span>
              <span v-if="netInfo.floating.length">· {{ netInfo.floating.length }} unconnected</span>
            </div>
            <div v-if="importWarnings.length" class="warn-banner">
              <i class="pi pi-exclamation-triangle" style="font-size: 0.75rem"></i>
              <span>Built with {{ importWarnings.length }} note(s):</span>
              <span class="warn-list">{{ importWarnings.slice(0, 4).join(' · ') }}{{ importWarnings.length > 4 ? ' …' : '' }}</span>
              <button class="warn-x" @click="importWarnings = []"><i class="pi pi-times" style="font-size: 0.7rem"></i></button>
            </div>
          </div>

          <Inspector
            class="pane inspector-pane"
            :item="selectedItem"
            :layout="primaryLayout"
            :net-map="netMap"
            @rename="renameItem"
            @update-prop="updateProp"
            @set-pin="setPin"
            @set-pincount="setPinCount"
            @delete="deleteItem"
            @duplicate="duplicateItem"
          />
        </div>
      </template>
    </main>

    <!-- ── New sheet modal ── -->
    <div v-if="newOpen" class="modal-backdrop" @click.self="newOpen = false">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">New breadboard sheet</span>
          <button class="modal-close" @click="newOpen = false"><i class="pi pi-times" style="font-size: 0.85rem"></i></button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Name</label>
            <input v-model="newForm.name" placeholder="e.g. IR remote bench" @keyup.enter="submitNew" />
          </div>
          <div class="field">
            <label>Breadboard size</label>
            <select v-model="newForm.type">
              <option v-for="b in BREADBOARD_LIST" :key="b.type" :value="b.type">{{ b.label }}</option>
            </select>
          </div>
        </div>
        <div class="modal-foot">
          <button class="add-btn" :disabled="!newForm.name.trim() || creating" @click="submitNew">
            {{ creating ? 'Creating…' : 'Create' }}
          </button>
          <button class="btn-ghost" @click="newOpen = false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── AI build (import) modal ── -->
    <div v-if="importOpen" class="modal-backdrop" @click.self="importOpen = false">
      <div class="modal modal-wide">
        <div class="modal-head">
          <span class="modal-title">Build from an AI reply</span>
          <button class="modal-close" @click="importOpen = false"><i class="pi pi-times" style="font-size: 0.85rem"></i></button>
        </div>
        <div class="modal-body">
          <p class="hint">
            Copy this sheet as MD, ask an assistant to design something, then paste its reply
            here. The app reads the <code>json</code> build block and constructs the layout.
          </p>
          <textarea
            v-model="importText"
            rows="10"
            class="import-area"
            placeholder='Paste the assistant&apos;s reply (it should contain a ```json build block)…'
          ></textarea>
          <p v-if="importError" class="import-error">{{ importError }}</p>
        </div>
        <div class="modal-foot">
          <button class="add-btn" :disabled="!importText.trim()" @click="buildFromText">
            <i class="pi pi-bolt" style="font-size: 0.8rem"></i> Build
          </button>
          <button class="btn-ghost" @click="importOpen = false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- ── Custom board modal ── -->
    <CustomBoardModal :open="customOpen" @close="customOpen = false" @create="addCustomBoard" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { v4 as uuid } from 'uuid'
import { useBreadboardStore, blankData } from '@/stores/breadboard'
import BreadboardCanvas from '@/components/breadboard/BreadboardCanvas.vue'
import ComponentPalette from '@/components/breadboard/ComponentPalette.vue'
import Inspector from '@/components/breadboard/Inspector.vue'
import CustomBoardModal from '@/components/breadboard/CustomBoardModal.vue'
import {
  makeItem, resetLabelCounters, BREADBOARD_LIST,
} from '@/lib/breadboard/templates'
import { getBreadboardLayout, PITCH, pinEndpointId } from '@/lib/breadboard/geometry'
import { computeNets } from '@/lib/breadboard/nets'
import { buildSheetMarkdown, copyToClipboard, downloadTextFile, slugify } from '@/lib/breadboard/markdown'
import { parseBuild } from '@/lib/breadboard/importBuild'

const store = useBreadboardStore()

const railOpen = ref(false)
const newOpen = ref(false)
const customOpen = ref(false)
const creating = ref(false)
const copied = ref(false)

const selectedId = ref(null)
const tool = ref(null)
const wireColor = ref('#16a34a')
const canvasRef = ref(null)

const importOpen = ref(false)
const importText = ref('')
const importError = ref('')
const importWarnings = ref([])

const data = ref(null)
const newForm = ref({ name: '', type: 'half' })

const WIRE_COLORS = ['#16a34a', '#dc2626', '#2563eb', '#f59e0b', '#000000', '#9333ea']

// ── working-copy sync ──
function loadActive() {
  const s = store.activeSheet
  if (!s) { data.value = null; return }
  const d = JSON.parse(JSON.stringify(s.data || blankData()))
  d.breadboards = d.breadboards?.length ? d.breadboards : [{ id: 'bb1', type: 'half', x: 24, y: 150 }]
  d.items = d.items || []
  d.wires = d.wires || []
  data.value = d
  selectedId.value = null
  tool.value = null
  resetLabelCounters(d.items)
}
watch(() => store.activeSheetId, loadActive, { immediate: true })

onMounted(async () => {
  await store.fetchSheets()
  if (!data.value) loadActive()
})

function persist() {
  if (store.activeSheetId && data.value) store.updateSheetData(store.activeSheetId, data.value)
}

// ── derived ──
const boardType = computed(() => data.value?.breadboards?.[0]?.type || 'half')
const primaryLayout = computed(() =>
  data.value?.breadboards?.length ? getBreadboardLayout(data.value.breadboards[0]) : null,
)
const selectedItem = computed(() => data.value?.items.find((it) => it.id === selectedId.value) || null)
const netInfo = computed(() => (data.value ? computeNets(data.value) : { nets: [], floating: [], bridges: [] }))
const netMap = computed(() => {
  const m = {}
  for (const net of netInfo.value.nets) for (const p of net.pins) m[p.endpointId] = { id: net.id, label: net.label }
  return m
})

function partCount(s) {
  const n = s.data?.items?.length || 0
  return n ? `${n}` : '·'
}

// ── sheet ops ──
function selectSheet(id) {
  store.selectSheet(id)
  railOpen.value = false
}
async function submitNew() {
  if (!newForm.value.name.trim() || creating.value) return
  creating.value = true
  try {
    await store.createSheet({ name: newForm.value.name, type: newForm.value.type })
    loadActive()
    newOpen.value = false
    newForm.value = { name: '', type: newForm.value.type }
  } finally {
    creating.value = false
  }
}
function renameSheet(name) {
  if (store.activeSheetId) store.renameSheet(store.activeSheetId, name)
}
async function removeSheet() {
  if (!store.activeSheetId) return
  if (!window.confirm('Delete this sheet? This cannot be undone.')) return
  await store.deleteSheet(store.activeSheetId)
  loadActive()
}
function changeSize(type) {
  if (!data.value) return
  data.value.breadboards[0].type = type
  persist()
  nextTick(() => canvasRef.value?.fit())
}
function fitView() {
  canvasRef.value?.fit()
}

// ── canvas ops ──
function onAdd(item) {
  data.value.items.push(item)
  persist()
}
function onMove({ id, x, y, pins }) {
  const it = data.value.items.find((i) => i.id === id)
  if (!it) return
  it.x = x
  it.y = y
  if (pins) it.pins = pins
  persist()
}
function onAddWire(wire) {
  data.value.wires.push(wire)
  persist()
}
function onRemoveWire(id) {
  data.value.wires = data.value.wires.filter((w) => w.id !== id)
  persist()
}

// ── inspector ops ──
function renameItem(label) {
  if (selectedItem.value) { selectedItem.value.label = label; persist() }
}
function updateProp({ key, value }) {
  if (selectedItem.value) { selectedItem.value.props = { ...selectedItem.value.props, [key]: value }; persist() }
}
function setPin({ pinId, hole }) {
  const it = selectedItem.value
  if (!it) return
  const pin = it.pins.find((p) => p.id === pinId)
  if (pin) { pin.hole = hole; persist() }
}
function setPinCount(n) {
  const it = selectedItem.value
  if (!it || it.kind !== 'ic') return
  const count = Math.max(4, Math.min(40, n || 8))
  const old = it.pins
  const pins = []
  for (let i = 1; i <= count; i++) {
    const ex = old[i - 1]
    pins.push({ id: String(i), name: String(i), hole: ex ? ex.hole : null })
  }
  it.pins = pins
  persist()
}
function deleteItem() {
  const it = selectedItem.value
  if (!it) return
  const endpoints = new Set(it.pins.map((p) => pinEndpointId(it, p)))
  data.value.wires = data.value.wires.filter((w) => !endpoints.has(w.from) && !endpoints.has(w.to))
  data.value.items = data.value.items.filter((i) => i.id !== it.id)
  selectedId.value = null
  persist()
}
function duplicateItem() {
  const it = selectedItem.value
  if (!it) return
  const clone = JSON.parse(JSON.stringify(it))
  clone.id = uuid()
  clone.label = `${it.label} copy`
  clone.x = (it.x || 0) + 2 * PITCH
  clone.y = (it.y || 0) + 2 * PITCH
  clone.pins = clone.pins.map((p) => ({ ...p, hole: null })) // re-place to avoid overlap
  data.value.items.push(clone)
  selectedId.value = clone.id
  persist()
}

// ── custom board ──
function addCustomBoard({ name, pinNames }) {
  const bb = data.value.breadboards[0]
  const layout = getBreadboardLayout(bb)
  const x = layout.x0 + layout.width + 50
  const y = layout.y0
  const item = makeItem('custom', {
    label: name,
    x, y,
    customPins: pinNames.map((n, i) => ({ name: n, side: i % 2 === 0 ? 'L' : 'R', order: Math.floor(i / 2) })),
  })
  data.value.items.push(item)
  selectedId.value = item.id
  customOpen.value = false
  persist()
  nextTick(() => canvasRef.value?.fit())
}

// ── markdown ──
function currentSheet() {
  return { name: store.activeSheet?.name, data: data.value, updated_at: store.activeSheet?.updated_at }
}
async function copyMd() {
  const ok = await copyToClipboard(buildSheetMarkdown(currentSheet()))
  if (ok) {
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  }
}
function downloadMd() {
  downloadTextFile(`${slugify(store.activeSheet?.name || 'breadboard')}.md`, buildSheetMarkdown(currentSheet()), 'text/markdown')
}

// ── AI build (import) ──
function openImport() {
  importError.value = ''
  importText.value = ''
  importOpen.value = true
}
function buildFromText() {
  importError.value = ''
  const res = parseBuild(importText.value)
  if (!res.ok) { importError.value = res.error; return }
  if (data.value && data.value.items.length && !window.confirm('Replace the current sheet with this build?')) return
  const d = res.data
  d.breadboards = d.breadboards?.length ? d.breadboards : [{ id: 'bb1', type: 'half', x: 24, y: 150 }]
  d.items = d.items || []
  d.wires = d.wires || []
  data.value = d
  selectedId.value = null
  tool.value = null
  resetLabelCounters(d.items)
  persist()
  importWarnings.value = res.warnings || []
  importOpen.value = false
  importText.value = ''
  nextTick(() => canvasRef.value?.fit())
}
</script>

<style scoped>
.bb-app {
  --bb-text: #1a1a1a;
  --bb-text-dim: #5c5c5c;
  --bb-text-faint: #9a9a9a;
  --bb-border: #e5e4e1;
  --bb-border-soft: #eeede9;
  --bb-sunken: #f3f2f0;
  --bb-canvas-bg: #fbfaf7;
  --bb-card: #ffffff;
  --bb-accent: #14b8a6;
  --bb-accent-600: #0f766e;
  --bb-accent-050: #ccfbf1;

  display: grid;
  grid-template-columns: 15rem 1fr;
  height: calc(100vh - 4rem);
  background: var(--bb-sunken);
  color: var(--bb-text);
}

/* ── rail ── */
.rail {
  background: var(--bb-card);
  border-right: 1px solid var(--bb-border);
  display: flex;
  flex-direction: column;
  padding: 1rem 0.85rem;
  gap: 0.75rem;
  overflow: hidden;
}
.rail-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.eyebrow {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #2dd4bf;
}
.rail-title {
  font-size: 1.25rem;
  font-weight: 800;
  margin: 0.1rem 0 0;
}
.rail-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  overflow-y: auto;
  flex: 1;
}
.rail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 0.55rem;
  padding: 0.5rem 0.6rem;
  cursor: pointer;
  text-align: left;
  font-size: 0.88rem;
  color: var(--bb-text);
}
.rail-item:hover {
  background: var(--bb-sunken);
}
.rail-item.active {
  background: var(--bb-accent-050);
  border-color: var(--bb-accent);
  color: var(--bb-accent-600);
  font-weight: 600;
}
.rail-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-item-meta {
  font-size: 0.72rem;
  color: var(--bb-text-faint);
  flex: none;
}
.rail-empty,
.rail-loading {
  color: var(--bb-text-faint);
  font-size: 0.82rem;
  padding: 0.5rem;
  text-align: center;
}

/* ── main ── */
.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  color: var(--bb-text-dim);
}
.empty-title {
  font-size: 1.1rem;
  font-weight: 700;
}
.empty-sub {
  font-size: 0.85rem;
  color: var(--bb-text-faint);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  background: var(--bb-card);
  border-bottom: 1px solid var(--bb-border);
  flex-wrap: wrap;
}
.sheet-name {
  font-size: 0.95rem;
  font-weight: 700;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  padding: 0.3rem 0.5rem;
  background: transparent;
  color: var(--bb-text);
  min-width: 8rem;
}
.sheet-name:hover,
.sheet-name:focus {
  border-color: var(--bb-border);
  background: #fff;
  outline: none;
}
.sel {
  border: 1px solid var(--bb-border);
  border-radius: 0.5rem;
  padding: 0.32rem 0.5rem;
  font-size: 0.82rem;
  background: #fff;
  color: var(--bb-text);
}
.toolbar-spacer {
  flex: 1;
}
.wire-colors {
  display: flex;
  gap: 0.2rem;
  align-items: center;
}
.wire-swatch {
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
.wire-swatch.on {
  border-color: var(--bb-accent);
}
.save-dot {
  font-size: 0.72rem;
  color: var(--bb-text-faint);
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 13rem 1fr 16.5rem;
  overflow: hidden;
}
.pane {
  background: var(--bb-card);
  overflow-y: auto;
}
.palette-pane {
  border-right: 1px solid var(--bb-border);
}
.inspector-pane {
  border-left: 1px solid var(--bb-border);
}
.canvas-pane {
  position: relative;
  overflow: hidden;
}
.stat-bar {
  position: absolute;
  left: 0.75rem;
  top: 0.6rem;
  display: flex;
  gap: 0.4rem;
  font-size: 0.72rem;
  color: var(--bb-text-dim);
  background: rgba(255, 255, 255, 0.8);
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--bb-border-soft);
  pointer-events: none;
}

/* ── buttons ── */
.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  justify-content: center;
  background: var(--bb-accent);
  color: #fff;
  border: none;
  border-radius: 0.55rem;
  padding: 0.5rem 0.8rem;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
}
.add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.add-btn-lg {
  padding: 0.6rem 1.1rem;
  font-size: 0.95rem;
}
.btn-primary {
  background: var(--bb-accent);
  color: #fff;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: 600;
}
.btn-ghost {
  background: #fff;
  border: 1px solid var(--bb-border);
  border-radius: 0.5rem;
  cursor: pointer;
  color: var(--bb-text);
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.btn-sm {
  padding: 0.35rem 0.6rem;
  font-size: 0.8rem;
}
.icon-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.35rem;
  border-radius: 0.45rem;
  color: var(--bb-text-dim);
}
.icon-btn.danger:hover {
  background: #fee2e2;
  color: #b91c1c;
}

/* ── modal ── */
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
  width: min(26rem, 92vw);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--bb-border-soft);
}
.modal-title {
  font-weight: 700;
}
.modal-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--bb-text-dim);
}
.modal-body {
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.field label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--bb-text-dim);
}
.field input,
.field select {
  border: 1px solid var(--bb-border);
  border-radius: 0.5rem;
  padding: 0.45rem 0.55rem;
  font-size: 0.88rem;
}
.modal-foot {
  display: flex;
  gap: 0.5rem;
  padding: 0.9rem 1.1rem;
  border-top: 1px solid var(--bb-border-soft);
}
.modal-wide {
  width: min(40rem, 94vw);
}
.hint {
  font-size: 0.78rem;
  color: var(--bb-text-dim);
  margin: 0;
}
.hint code {
  background: var(--bb-sunken);
  padding: 0.05rem 0.3rem;
  border-radius: 0.3rem;
  font-size: 0.92em;
}
.import-area {
  width: 100%;
  border: 1px solid var(--bb-border);
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

/* ── import warning banner ── */
.warn-banner {
  position: absolute;
  left: 0.75rem;
  right: 0.75rem;
  bottom: 0.7rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.74rem;
  color: #92400e;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  padding: 0.35rem 0.6rem;
  border-radius: 0.55rem;
}
.warn-list {
  color: #b45309;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.warn-x {
  margin-left: auto;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #92400e;
  flex: none;
}

.mobile-only {
  display: none;
}

/* ── responsive ── */
@media (max-width: 900px) {
  .bb-app {
    grid-template-columns: 1fr;
  }
  .rail {
    position: fixed;
    inset: 4rem auto 0 0;
    width: 15rem;
    z-index: 50;
    transform: translateX(-105%);
    transition: transform 0.2s;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  }
  .rail.open {
    transform: translateX(0);
  }
  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
  }
  .palette-pane {
    border-right: none;
    border-bottom: 1px solid var(--bb-border);
    max-height: 9rem;
  }
  .inspector-pane {
    border-left: none;
    border-top: 1px solid var(--bb-border);
    max-height: 14rem;
  }
  .mobile-only {
    display: inline-flex;
  }
}
</style>
