<template>
  <div class="palette">
    <div class="palette-head">
      <span class="palette-title">Add parts</span>
      <span v-if="tool" class="palette-hint">{{ hintText }}</span>
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
          <span class="pal-dot" :style="dotStyle(kind)"></span>
          <span class="pal-label">{{ labelFor(kind) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { PALETTE_GROUPS, COMPONENTS, BOARDS } from '@/lib/breadboard/templates'

const props = defineProps({
  tool: { type: Object, default: null },
})
const emit = defineEmits(['select-tool', 'custom'])

const groups = PALETTE_GROUPS

function labelFor(kind) {
  if (kind === 'custom') return 'Custom board'
  return COMPONENTS[kind]?.label || BOARDS[kind]?.label || kind
}

const DOT = {
  resistor: '#e3c79b', led: '#e8403a', cap_104: '#2f6fae', button: '#3a4252', wire: '#16a34a',
  diode: '#2a2a2a', transistor: '#232323', potentiometer: '#d8dde4', ic: '#1f1f1f',
  ir_led_tsal6400: '#9ec3e0', tsop38238: '#1b1b1b', ds18b20: '#232323',
  veml7700: '#1e8f6e', bme280: '#5a4fb0', raspi40: '#2bb673', esp32devkit: '#d34b3b', custom: '#6b7280',
}
function dotStyle(kind) {
  return { background: DOT[kind] || '#888' }
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
.pal-dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 3px;
  flex: none;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
.pal-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
