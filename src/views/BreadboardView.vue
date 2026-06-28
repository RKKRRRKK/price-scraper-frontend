<template>
  <div class="bb-app">
    <!-- ── Sheet catalogue rail ── -->
    <aside class="rail" :class="{ open: railOpen }">
      <div class="rail-head">
        <div class="rail-head-text">
          <div class="eyebrow">Tools</div>
          <h1 class="rail-title">Breadly</h1>
          <div class="rail-sub">{{ store.sheets.length }} {{ store.sheets.length === 1 ? 'sheet' : 'sheets' }}</div>
        </div>
        <button class="icon-btn mobile-only" @click="railOpen = false" title="Close">
          <i class="pi pi-times" style="font-size: 0.85rem"></i>
        </button>
      </div>

      <button class="add-btn rail-new" @click="newOpen = true">
        <i class="pi pi-plus" style="font-size: 0.8rem"></i> New sheet
      </button>

      <div class="rail-search">
        <i class="pi pi-search"></i>
        <input v-model="railQuery" type="text" placeholder="Filter sheets…" />
        <button v-if="railQuery" class="rail-search-clear" @click="railQuery = ''" title="Clear">
          <i class="pi pi-times"></i>
        </button>
      </div>

      <div class="rail-list">
        <div v-if="store.loading && !store.sheets.length" class="rail-state">
          <i class="pi pi-spin pi-spinner" style="font-size: 1.2rem"></i>
        </div>
        <div v-else-if="!store.sheets.length" class="rail-state">
          <i class="pi pi-microchip rail-state-icon"></i>
          <span>No sheets yet.</span>
        </div>
        <div v-else-if="!filteredSheets.length" class="rail-state">
          <i class="pi pi-search rail-state-icon"></i>
          <span>No matches for “{{ railQuery }}”.</span>
        </div>
        <button
          v-for="s in filteredSheets"
          :key="s.id"
          class="rail-item"
          :class="{ active: s.id === store.activeSheetId }"
          @click="selectSheet(s.id)"
        >
          <span class="rail-item-icon"><i class="pi pi-microchip"></i></span>
          <span class="rail-item-body">
            <span class="rail-item-name">{{ s.name }}</span>
            <span class="rail-meta">
              <span class="stat stat-board">{{ sheetBoard(s) }}</span>
              <span class="stat" title="Parts"><i class="pi pi-box"></i>{{ sheetParts(s) }}</span>
              <span class="stat" title="Wires"><i class="pi pi-share-alt"></i>{{ sheetWires(s) }}</span>
              <span v-if="s.updated_at" class="stat stat-time" :title="'Updated ' + relTime(s.updated_at)">{{ shortAgo(s.updated_at) }}</span>
            </span>
          </span>
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

          <button
            class="btn-ghost btn-sm lock-btn"
            :class="{ on: locked }"
            @click="toggleLock"
            :title="locked ? 'Board locked — parts can\'t be moved. Click to unlock.' : 'Lock the board so parts can\'t be moved by accident'"
          >
            <i :class="locked ? 'pi pi-lock' : 'pi pi-lock-open'" style="font-size: 0.75rem"></i>
            {{ locked ? 'Locked' : 'Lock' }}
          </button>

          <div class="depth-ctrl" title="On hover, how many connections out from a part to highlight">
            <i class="pi pi-sitemap" style="font-size: 0.72rem"></i>
            <button class="step" :disabled="highlightDepth <= 0" @click="highlightDepth = Math.max(0, highlightDepth - 1)">−</button>
            <span class="depth-val">{{ highlightDepth }}</span>
            <button class="step" :disabled="highlightDepth >= 6" @click="highlightDepth = Math.min(6, highlightDepth + 1)">+</button>
          </div>

          <div class="toolbar-spacer"></div>

          <span v-if="store.saving" class="save-dot"><i class="pi pi-spin pi-spinner" style="font-size: 0.7rem"></i> saving…</span>

          <button class="btn-ghost btn-sm" @click="fitView" title="Fit to view"><i class="pi pi-window-maximize" style="font-size: 0.75rem"></i></button>
          <button class="btn-primary btn-sm" @click="openAi" title="Copy a prompt for an AI assistant, or build the board from its reply">
            <i class="pi pi-sparkles" style="font-size: 0.75rem"></i> AI assist
          </button>
          <button class="icon-btn danger" @click="removeSheet" title="Delete sheet"><i class="pi pi-trash" style="font-size: 0.8rem"></i></button>
        </div>

        <!-- workspace -->
        <div class="workspace">
          <ComponentPalette
            class="pane palette-pane"
            :tool="tool"
            :used-kinds="usedKinds"
            @select-tool="tool = $event"
            @custom="customOpen = true"
            @create="openCreator()"
            @library="libraryOpen = true"
          />

          <div class="canvas-pane">
            <BreadboardCanvas
              ref="canvasRef"
              :data="data"
              :sheet-id="store.activeSheetId"
              :selected-id="selectedId"
              :selected-wire-id="selectedWire"
              :tool="tool"
              :wire-color="wireColor"
              :wire-gauge="wireGauge"
              :wire-type="wireType"
              :locked="locked"
              :highlight-depth="highlightDepth"
              @add="onAdd"
              @move="onMove"
              @select="onSelect"
              @add-wire="onAddWire"
              @remove-wire="onRemoveWire"
              @delete-selected="onDeleteSelected"
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
            :wire="selectedWireObj"
            :wire-colors="WIRE_COLORS"
            :layout="primaryLayout"
            :net-map="netMap"
            @rename="renameItem"
            @update-prop="updateProp"
            @set-pin="setPin"
            @set-pincount="setPinCount"
            @delete="deleteItem"
            @duplicate="duplicateItem"
            @set-placement="setPlacement"
            @set-wire-color="setWireColor"
            @set-wire-type="setWireType"
            @set-wire-gauge="setWireGauge"
            @flip-wire-arc="flipWireArc"
            @delete-wire="deleteWire"
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

    <!-- ── AI assist modal (copy prompt / build from reply) ── -->
    <AiAssistModal
      :open="aiOpen"
      :sheet="aiSheet"
      :build-error="importError"
      @build="buildFromText"
      @close="aiOpen = false"
    />

    <!-- ── Custom board modal ── -->
    <CustomBoardModal :open="customOpen" @close="customOpen = false" @create="addCustomBoard" />

    <!-- ── Part creator modal ── -->
    <PartCreatorModal
      :open="creatorOpen"
      :part="editingPart"
      @close="closeCreator"
      @create="savePart"
    />

    <!-- ── Parts library modal ── -->
    <PartLibraryModal
      :open="libraryOpen"
      :used-kinds="usedKinds"
      @close="libraryOpen = false"
      @create="openCreator()"
      @edit="openCreator"
      @place="placeFromLibrary"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { v4 as uuid } from 'uuid'
import { useBreadboardStore, blankData } from '@/stores/breadboard'
import { useBreadboardLibraryStore } from '@/stores/breadboardLibrary'
import BreadboardCanvas from '@/components/breadboard/BreadboardCanvas.vue'
import ComponentPalette from '@/components/breadboard/ComponentPalette.vue'
import Inspector from '@/components/breadboard/Inspector.vue'
import CustomBoardModal from '@/components/breadboard/CustomBoardModal.vue'
import PartCreatorModal from '@/components/breadboard/PartCreatorModal.vue'
import PartLibraryModal from '@/components/breadboard/PartLibraryModal.vue'
import AiAssistModal from '@/components/breadboard/AiAssistModal.vue'
import {
  makeItem, resetLabelCounters, BREADBOARD_LIST,
  listBuiltinParts, listCustomParts, getTemplate,
} from '@/lib/breadboard/templates'
import { getBreadboardLayout, PITCH, pinEndpointId } from '@/lib/breadboard/geometry'
import { computeNets } from '@/lib/breadboard/nets'
import { parseBuild } from '@/lib/breadboard/importBuild'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime, { rounding: Math.floor })

const store = useBreadboardStore()
const library = useBreadboardLibraryStore()

const railOpen = ref(false)
const railQuery = ref('')

const filteredSheets = computed(() => {
  const q = railQuery.value.trim().toLowerCase()
  if (!q) return store.sheets
  return store.sheets.filter((s) => (s.name || '').toLowerCase().includes(q))
})

const newOpen = ref(false)
const customOpen = ref(false)
const creatorOpen = ref(false)
const libraryOpen = ref(false)
const editingPart = ref(null)
const creating = ref(false)

const selectedId = ref(null)
const selectedWire = ref(null)
const tool = ref(null)
const wireColor = ref('#16a34a')
const wireGauge = ref(22)
const wireType = ref('M-M')
const locked = ref(false)
const highlightDepth = ref(1) // hover-highlight reach, in wire hops
const canvasRef = ref(null)

const aiOpen = ref(false)
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
  selectedWire.value = null
  tool.value = null
  resetLabelCounters(d.items)
}
watch(() => store.activeSheetId, loadActive, { immediate: true })

onMounted(async () => {
  await Promise.all([store.fetchSheets(), library.fetchLibrary()])
  if (!data.value) loadActive()
})

// kinds present on the current sheet — surfaced in the library as "on sheet".
const usedKinds = computed(() => [...new Set((data.value?.items || []).map((i) => i.kind))])

function persist() {
  if (store.activeSheetId && data.value) store.updateSheetData(store.activeSheetId, data.value)
}

// ── derived ──
const boardType = computed(() => data.value?.breadboards?.[0]?.type || 'half')
const primaryLayout = computed(() =>
  data.value?.breadboards?.length ? getBreadboardLayout(data.value.breadboards[0]) : null,
)
const selectedItem = computed(() => data.value?.items.find((it) => it.id === selectedId.value) || null)
const selectedWireObj = computed(() => data.value?.wires.find((w) => w.id === selectedWire.value) || null)
const netInfo = computed(() => (data.value ? computeNets(data.value) : { nets: [], floating: [], bridges: [] }))
const netMap = computed(() => {
  const m = {}
  for (const net of netInfo.value.nets) for (const p of net.pins) m[p.endpointId] = { id: net.id, label: net.label }
  return m
})

function sheetParts(s) {
  return s.data?.items?.length || 0
}
function sheetWires(s) {
  return s.data?.wires?.length || 0
}
function sheetBoard(s) {
  const t = s.data?.breadboards?.[0]?.type
  const label = BREADBOARD_LIST.find((b) => b.type === t)?.label || t || '—'
  return String(label).split('(')[0].trim() // drop the "(830 pts)" detail for the rail
}
function relTime(ts) {
  return ts ? dayjs(ts).fromNow() : ''
}
function shortAgo(ts) {
  if (!ts) return ''
  const s = Math.max(0, dayjs().diff(dayjs(ts), 'second'))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 2592000) return `${Math.floor(s / 86400)}d`
  if (s < 31536000) return `${Math.floor(s / 2592000)}mo`
  return `${Math.floor(s / 31536000)}y`
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
function toggleLock() {
  locked.value = !locked.value
  if (locked.value) tool.value = null // drop any place/wire tool while locked
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
  if (selectedWire.value === id) selectedWire.value = null
  persist()
}

// ── selection (items + wires share one entry point) ──
function onSelect(payload) {
  if (!payload) { selectedId.value = null; selectedWire.value = null; return }
  if (payload.type === 'wire') { selectedWire.value = payload.id; selectedId.value = null }
  else { selectedId.value = payload.id; selectedWire.value = null }
}
function onDeleteSelected() {
  if (selectedWire.value) onRemoveWire(selectedWire.value)
  else if (selectedId.value) deleteItem()
}

// ── wire inspector ops ──
function setWireColor(color) {
  const w = selectedWireObj.value
  if (w) { w.color = color; persist() }
}
function setWireType(type) {
  const w = selectedWireObj.value
  if (w) { w.type = type; wireType.value = type; persist() }
}
function setWireGauge(gauge) {
  const w = selectedWireObj.value
  if (w) { w.gauge = gauge; wireGauge.value = gauge; persist() }
}
function flipWireArc() {
  const w = selectedWireObj.value
  if (w) { w.arc = w.arc === -1 ? 1 : -1; persist() }
}
function deleteWire() {
  if (selectedWire.value) onRemoveWire(selectedWire.value)
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
// Switch a part between plugging into the grid and sitting off-board (wired to
// its pins). Existing wires reference stable pin endpoints, so they survive.
function setPlacement(mode) {
  const it = selectedItem.value
  if (!it) return
  const current = it.placement || getTemplate(it.kind)?.placement || 'inline'
  if (mode === current) return
  it.pins = it.pins.map((p) => ({ ...p, hole: null })) // unplug; pins become wire endpoints
  it.placement = mode
  if (mode === 'standalone') {
    const lay = primaryLayout.value
    if (lay) {
      const others = data.value.items.filter(
        (i) => i.id !== it.id && (i.placement || getTemplate(i.kind)?.placement) === 'standalone',
      ).length
      it.x = lay.x0 + lay.width + 60
      it.y = lay.y0 + others * 120
    }
  }
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

// ── part library / creator ──
function openCreator(kind) {
  editingPart.value = kind ? library.customParts.find((p) => p.kind === kind) || null : null
  libraryOpen.value = false
  creatorOpen.value = true
}
function closeCreator() {
  creatorOpen.value = false
  editingPart.value = null
}
function partSlug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'part'
}
function uniqueKind(label) {
  const base = `lib_${partSlug(label)}`
  const existing = new Set(library.customParts.map((p) => p.kind))
  if (!existing.has(base)) return base
  let i = 2
  while (existing.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}
function defFromPayload(payload, kind) {
  return {
    kind,
    label: payload.label,
    partNumber: payload.partNumber || '',
    placement: payload.placement,
    body: payload.shape === 'board' ? 'board' : payload.shape,
    polar: !!payload.polar,
    accent: payload.accent,
    icon: payload.icon || '',
    pins: payload.pinNames.map((name, i) => ({ id: `p${i + 1}`, name })),
  }
}
function savePart(payload) {
  if (editingPart.value) {
    library.updateCustomPart(editingPart.value.kind, defFromPayload(payload, editingPart.value.kind))
  } else {
    const kind = uniqueKind(payload.label)
    library.addCustomPart(defFromPayload(payload, kind))
    tool.value = { type: 'place', kind } // ready to drop the new part
  }
  closeCreator()
}
function placeFromLibrary(kind) {
  tool.value = { type: 'place', kind }
  libraryOpen.value = false
}

// ── AI assist ──
// Catalogue passed to the exporter: every library part plus what's in stock, so
// the assistant designs with parts the user actually has.
function libraryCatalog() {
  const customs = listCustomParts()
  const parts = [...customs, ...listBuiltinParts()].map((p) => ({
    ...p,
    inStock: library.isInStock(p.kind),
  }))
  return { parts, customParts: customs }
}
// Snapshot handed to AiAssistModal for building the markdown prompt/export.
const aiSheet = computed(() => ({
  name: store.activeSheet?.name,
  data: data.value,
  updated_at: store.activeSheet?.updated_at,
  library: libraryCatalog(),
}))
function openAi() {
  importError.value = ''
  aiOpen.value = true
}
// Build the board from an assistant's reply (the modal emits the pasted text).
function buildFromText(text) {
  importError.value = ''
  const res = parseBuild(text)
  if (!res.ok) { importError.value = res.error; return }
  if (data.value && data.value.items.length && !window.confirm('Replace the current sheet with this build?')) return
  const d = res.data
  d.breadboards = d.breadboards?.length ? d.breadboards : [{ id: 'bb1', type: 'half', x: 24, y: 150 }]
  d.items = d.items || []
  d.wires = d.wires || []
  data.value = d
  selectedId.value = null
  selectedWire.value = null
  tool.value = null
  resetLabelCounters(d.items)
  persist()
  importWarnings.value = res.warnings || []
  aiOpen.value = false
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
  --bb-accent: #ef4444;
  --bb-accent-600: #b91c1c;
  --bb-accent-050: #fee2e2;

  display: grid;
  grid-template-columns: 17rem 1fr;
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
  padding: 1.25rem 0.85rem 1rem;
  gap: 0.85rem;
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
  letter-spacing: 0.09em;
  color: var(--bb-accent);
}
.rail-title {
  font-size: 1.4rem;
  font-weight: 800;
  margin: 0.1rem 0 0;
  letter-spacing: -0.01em;
}
.rail-sub {
  margin-top: 0.15rem;
  font-size: 0.75rem;
  color: var(--bb-text-faint);
}

/* primary "new" button — shared spec across both tools */
.add-btn.rail-new {
  width: 100%;
  height: 2.6rem;
  padding: 0 1rem;
  border-radius: 0.6rem;
  font-size: 0.9375rem;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(20, 184, 166, 0.25);
}

/* search */
.rail-search {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--bb-border);
  border-radius: 0.6rem;
  padding: 0 0.6rem;
  background: var(--bb-sunken);
  transition: border-color 0.12s, background 0.12s, box-shadow 0.12s;
}
.rail-search:focus-within {
  border-color: var(--bb-accent);
  background: #fff;
  box-shadow: 0 0 0 3px var(--bb-accent-050);
}
.rail-search .pi-search {
  font-size: 0.8rem;
  color: var(--bb-text-faint);
}
.rail-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  padding: 0.5rem 0;
  font-size: 0.85rem;
  color: var(--bb-text);
}
.rail-search input::placeholder { color: var(--bb-text-faint); }
.rail-search-clear {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--bb-text-faint);
  padding: 0.15rem;
  font-size: 0.72rem;
  display: inline-flex;
}
.rail-search-clear:hover { color: var(--bb-text-dim); }

/* list */
.rail-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  overflow-y: auto;
  flex: 1;
  padding: 0.15rem 0.15rem 0.4rem;
}
.rail-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  border: 1px solid var(--bb-border);
  background: var(--bb-card);
  border-radius: 0.65rem;
  padding: 0.65rem 0.7rem;
  cursor: pointer;
  text-align: left;
  color: var(--bb-text);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
}
.rail-item:hover {
  border-color: #f87171;
  box-shadow: 0 2px 7px rgba(0, 0, 0, 0.07);
}
.rail-item.active {
  background: #fef2f2;
  border-color: var(--bb-accent);
  box-shadow: 0 1px 3px rgba(239, 68, 68, 0.18);
}
.rail-item-icon {
  flex: none;
  width: 1.85rem;
  height: 1.85rem;
  border-radius: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bb-sunken);
  color: var(--bb-text-dim);
  font-size: 0.9rem;
}
.rail-item.active .rail-item-icon {
  background: #fff;
  color: var(--bb-accent-600);
}
.rail-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.rail-item-name {
  font-size: 0.9rem;
  font-weight: 700;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-item.active .rail-item-name { color: var(--bb-accent-600); }

/* meta stat row */
.rail-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.05rem;
  font-size: 0.72rem;
  color: var(--bb-text-dim);
}
.rail-meta .stat {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.rail-meta .stat i { font-size: 0.68rem; color: var(--bb-text-faint); }
.rail-meta .stat-board {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--bb-sunken);
  color: var(--bb-text-dim);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  font-size: 0.66rem;
}
.rail-item.active .rail-meta .stat-board {
  background: #fff;
  color: var(--bb-accent-600);
}
.rail-meta .stat-time {
  margin-left: auto;
  color: var(--bb-text-faint);
  font-size: 0.7rem;
}

/* empty / loading / no-match */
.rail-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  color: var(--bb-text-faint);
  font-size: 0.85rem;
  padding: 1.75rem 0.5rem;
  text-align: center;
}
.rail-state-icon {
  font-size: 1.5rem;
  opacity: 0.55;
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
.lock-btn.on {
  background: var(--bb-accent-050);
  border-color: var(--bb-accent);
  color: var(--bb-accent-600);
  font-weight: 600;
}
.depth-ctrl {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  border: 1px solid var(--bb-border);
  border-radius: 0.5rem;
  padding: 0.15rem 0.3rem;
  background: #fff;
  color: var(--bb-text-faint);
}
.depth-ctrl .step {
  border: none;
  background: transparent;
  cursor: pointer;
  width: 1.15rem;
  height: 1.15rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  line-height: 1;
  border-radius: 0.3rem;
  color: var(--bb-text-dim);
}
.depth-ctrl .step:hover:not(:disabled) {
  background: var(--bb-sunken);
}
.depth-ctrl .step:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.depth-val {
  min-width: 0.9rem;
  text-align: center;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--bb-text);
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
    width: 17rem;
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
