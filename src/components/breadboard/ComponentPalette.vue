<template>
  <div class="palette">
    <div class="palette-head">
      <span class="palette-title">Add parts</span>
      <span v-if="tool" class="palette-hint">{{ hintText }}</span>
    </div>

    <div class="palette-actions">
      <button class="pal-action" title="Create a new part" @click="$emit('create')">
        <i class="pi pi-plus" style="font-size: 0.7rem"></i> Create
      </button>
      <button class="pal-action" title="Open the parts library" @click="$emit('library')">
        <i class="pi pi-box" style="font-size: 0.7rem"></i> Library
      </button>
    </div>

    <div v-for="g in groups" :key="g.id" class="pal-group">
      <div class="pal-group-label">{{ g.label }}</div>
      <div class="pal-items">
        <template v-for="kind in g.kinds" :key="kind">
          <div class="pal-row" :class="{ 'layer-off': g.id === 'active' && kindHidden(kind) }">
            <button
              class="pal-item"
              :class="{ active: isActive(kind) }"
              :title="labelFor(kind)"
              @click="pick(kind)"
            >
              <img class="pal-icon" :src="iconUrl(kind)" alt="" draggable="false" />
              <span class="pal-label">{{ labelFor(kind) }}</span>
              <i v-if="inStock(kind)" class="pi pi-star-fill stock-star" title="In stock"></i>
            </button>
            <!-- layer controls: only for things actually on the sheet -->
            <template v-if="g.id === 'active' && countOf(kind)">
              <button
                v-if="kind !== 'wire'"
                class="layer-btn layer-count"
                :class="{ open: expanded.has(kind) }"
                :title="expanded.has(kind) ? 'Hide the list' : 'List each one'"
                @click="toggleExpand(kind)"
              >
                {{ countOf(kind) }}<i class="pi pi-chevron-down"></i>
              </button>
              <span v-else class="layer-btn layer-count static">{{ countOf(kind) }}</span>
              <button
                class="layer-btn layer-eye"
                :title="kindHidden(kind) ? 'Show' : 'Hide'"
                @click="kind === 'wire' ? $emit('toggle-wires') : $emit('toggle-kind', kind)"
              >
                <i :class="kindHidden(kind) ? 'pi pi-eye-slash' : 'pi pi-eye'"></i>
              </button>
            </template>
          </div>
          <!-- per-instance layers -->
          <div v-if="g.id === 'active' && expanded.has(kind) && countOf(kind)" class="layer-list">
            <div
              v-for="it in itemsOf(kind)" :key="it.id"
              class="layer-item"
              :class="{ sel: it.id === selectedId, 'layer-off': itemHidden(it) }"
            >
              <button class="layer-name" :title="`Select ${it.label}`" @click="$emit('select-item', it.id)">
                {{ it.label || labelFor(kind) }}
              </button>
              <button
                class="layer-btn layer-eye"
                :disabled="hiddenKinds.includes(kind)"
                :title="hiddenItems.includes(it.id) ? 'Show' : 'Hide'"
                @click="$emit('toggle-item', it.id)"
              >
                <i :class="hiddenItems.includes(it.id) ? 'pi pi-eye-slash' : 'pi pi-eye'"></i>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { COMPONENTS, BOARDS, getTemplate, iconUrl } from '@/lib/breadboard/templates'
import { useBreadboardLibraryStore } from '@/stores/breadboardLibrary'

const props = defineProps({
  tool: { type: Object, default: null },
  // parts on the current sheet (drive the "Active devices" group + its layers)
  items: { type: Array, default: () => [] },
  wireCount: { type: Number, default: 0 },
  selectedId: { type: String, default: null },
  // layer visibility, owned by the view
  hiddenKinds: { type: Array, default: () => [] },
  hiddenItems: { type: Array, default: () => [] },
  wiresHidden: { type: Boolean, default: false },
})
const emit = defineEmits(['select-tool', 'custom', 'create', 'library', 'toggle-kind', 'toggle-item', 'toggle-wires', 'select-item'])

const lib = useBreadboardLibraryStore()

// Only the common discrete parts live in the palette permanently. Everything else
// (sensors, boards, custom library parts) lives in the Library. "Active devices"
// doubles as the sheet's layer list: every kind that's placed (core parts and
// jumper wires included) shows up there with a visibility toggle.
const CORE_KINDS = ['resistor', 'led', 'cap_104', 'button', 'wire']
const ACTIVE_BASE = ['diode', 'transistor', 'potentiometer', 'ic']

const groups = computed(() => {
  const placed = []
  for (const it of props.items) {
    if (ACTIVE_BASE.includes(it.kind) || placed.includes(it.kind)) continue
    placed.push(it.kind)
  }
  if (props.wireCount) placed.push('wire')
  return [
    { id: 'core', label: 'Core', kinds: CORE_KINDS },
    { id: 'active', label: 'Active devices', kinds: [...ACTIVE_BASE, ...placed] },
  ]
})

const expanded = ref(new Set())
function toggleExpand(kind) {
  const s = new Set(expanded.value)
  if (s.has(kind)) s.delete(kind)
  else s.add(kind)
  expanded.value = s
}
function itemsOf(kind) {
  return props.items.filter((it) => it.kind === kind)
}
function countOf(kind) {
  return kind === 'wire' ? props.wireCount : itemsOf(kind).length
}
function kindHidden(kind) {
  return kind === 'wire' ? props.wiresHidden : props.hiddenKinds.includes(kind)
}
function itemHidden(it) {
  return props.hiddenKinds.includes(it.kind) || props.hiddenItems.includes(it.id)
}

function inStock(kind) {
  return lib.isInStock(kind)
}

function labelFor(kind) {
  if (kind === 'custom') return 'Custom board'
  return COMPONENTS[kind]?.label || BOARDS[kind]?.label || getTemplate(kind)?.label || kind
}

function isActive(kind) {
  if (!props.tool) return false
  if (kind === 'wire') return props.tool.type === 'wire'
  return props.tool.type === 'place' && props.tool.kind === kind
}

function pick(kind) {
  if (kind === 'custom') { emit('custom'); return }
  if (kind === 'wire') {
    emit('select-tool', isActive('wire') ? null : { type: 'wire' })
    return
  }
  emit('select-tool', isActive(kind) ? null : { type: 'place', kind })
}

const hintText = computed(() => {
  if (!props.tool) return ''
  if (props.tool.type === 'wire') return 'Click two points to wire · Esc to stop'
  return 'Click a hole to place · Esc to cancel'
})
</script>

<style scoped>
.palette {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem;
}
.palette-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.palette-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--bb-text-dim, #5c5c5c);
}
.palette-hint {
  font-size: 0.7rem;
  color: #b91c1c;
  font-weight: 600;
}
.palette-actions {
  display: flex;
  gap: 0.35rem;
}
.pal-action {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 0.38rem 0.4rem;
  border: 1px solid var(--bb-border, #e5e4e1);
  border-radius: 0.5rem;
  background: #fff;
  cursor: pointer;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--bb-text, #1a1a1a);
}
.pal-action:hover {
  background: var(--bb-sunken, #f3f2f0);
  border-color: #ef4444;
  color: #b91c1c;
}
.pal-empty {
  font-size: 0.72rem;
  color: var(--bb-text-faint, #9a9a9a);
  padding: 0.2rem 0.1rem;
}
.stock-star {
  font-size: 0.6rem;
  color: #f59e0b;
  margin-left: auto;
}
.pal-group-label {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--bb-text-faint, #9a9a9a);
  margin-bottom: 0.3rem;
}
.pal-items {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.pal-row {
  display: flex;
  align-items: center;
  gap: 0.1rem;
}
.pal-row .pal-item {
  flex: 1;
  min-width: 0;
}
.pal-row.layer-off .pal-item {
  opacity: 0.45;
}
/* ── layer controls (count/expand + eye) ── */
.layer-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  height: 1.5rem;
  min-width: 1.5rem;
  padding: 0 0.3rem;
  border: none;
  border-radius: 0.4rem;
  background: transparent;
  cursor: pointer;
  color: var(--bb-text-faint, #9a9a9a);
  font-size: 0.7rem;
  font-weight: 700;
}
.layer-btn i {
  font-size: 0.75rem;
}
.layer-btn:hover:not(:disabled):not(.static) {
  background: var(--bb-sunken, #f3f2f0);
  color: var(--bb-text, #1a1a1a);
}
.layer-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.layer-count i {
  font-size: 0.55rem;
  transition: transform 0.12s;
}
.layer-count.open i {
  transform: rotate(180deg);
}
.layer-count.static {
  cursor: default;
}
.layer-off .layer-eye {
  color: #b91c1c;
}
.layer-list {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  margin: 0 0 0.25rem 1.4rem;
  padding-left: 0.4rem;
  border-left: 1px solid var(--bb-border, #e5e4e1);
}
.layer-item {
  display: flex;
  align-items: center;
  border-radius: 0.4rem;
}
.layer-item.sel {
  background: #fee2e2;
}
.layer-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0.25rem 0.4rem;
  font-size: 0.76rem;
  color: var(--bb-text, #1a1a1a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.layer-item.sel .layer-name {
  color: #b91c1c;
  font-weight: 600;
}
.layer-item.layer-off .layer-name {
  opacity: 0.45;
}
.pal-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  background: transparent;
  cursor: pointer;
  font-size: 0.82rem;
  color: var(--bb-text, #1a1a1a);
  text-align: left;
  transition: background 0.12s, border-color 0.12s;
}
.pal-item:hover {
  background: var(--bb-sunken, #f3f2f0);
}
.pal-item.active {
  background: #fee2e2;
  border-color: #ef4444;
  color: #b91c1c;
  font-weight: 600;
}
.pal-icon {
  width: 1.95rem;
  height: 1.95rem;
  flex: none;
  padding: 2px;
  border-radius: 5px;
  background: var(--bb-sunken, #f3f2f0);
  object-fit: contain;
}
.pal-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
