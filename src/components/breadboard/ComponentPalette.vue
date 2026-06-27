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
        <button
          v-for="kind in g.kinds" :key="kind"
          class="pal-item"
          :class="{ active: isActive(kind) }"
          :title="labelFor(kind)"
          @click="pick(kind)"
        >
          <img class="pal-icon" :src="iconUrl(kind)" alt="" draggable="false" />
          <span class="pal-label">{{ labelFor(kind) }}</span>
          <i v-if="inStock(kind)" class="pi pi-star-fill stock-star" title="In stock"></i>
        </button>
        <div v-if="g.id === 'active' && !g.kinds.length" class="pal-empty">
          Place a part from the <strong>Library</strong> and it shows up here.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { COMPONENTS, BOARDS, getTemplate, iconUrl } from '@/lib/breadboard/templates'
import { useBreadboardLibraryStore } from '@/stores/breadboardLibrary'

const props = defineProps({
  tool: { type: Object, default: null },
  // distinct kinds placed on the current sheet (drives the "Active devices" group)
  usedKinds: { type: Array, default: () => [] },
})
const emit = defineEmits(['select-tool', 'custom', 'create', 'library'])

const lib = useBreadboardLibraryStore()

// Only the common discrete parts live in the palette permanently. Everything else
// (sensors, boards, custom library parts) lives in the Library — it surfaces under
// "Active devices" once it's placed on the sheet, so re-adding more is one click.
const CORE_KINDS = ['resistor', 'led', 'cap_104', 'button', 'wire']
const ACTIVE_BASE = ['diode', 'transistor', 'potentiometer', 'ic']

const groups = computed(() => {
  const known = new Set([...CORE_KINDS, ...ACTIVE_BASE])
  const placed = []
  for (const k of props.usedKinds) {
    // 'custom' boards are one-offs per sheet — can't be re-added blindly from here
    if (k === 'custom' || known.has(k) || placed.includes(k)) continue
    placed.push(k)
  }
  return [
    { id: 'core', label: 'Core', kinds: CORE_KINDS },
    { id: 'active', label: 'Active devices', kinds: [...ACTIVE_BASE, ...placed] },
  ]
})

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
  color: #0f766e;
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
  border-color: #14b8a6;
  color: #0f766e;
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
  background: #ccfbf1;
  border-color: #14b8a6;
  color: #0f766e;
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
