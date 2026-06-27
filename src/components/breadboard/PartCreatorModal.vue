<template>
  <div v-if="open" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title">{{ editing ? 'Edit part' : 'Create a part' }}</span>
        <button class="modal-close" @click="$emit('close')">
          <i class="pi pi-times" style="font-size: 0.85rem"></i>
        </button>
      </div>

      <div class="modal-body">
        <div class="grid2">
          <div class="field">
            <label>Name</label>
            <input v-model="name" placeholder="e.g. Relay module" @keyup.enter="create" />
          </div>
          <div class="field">
            <label>Part number <span class="opt">(optional)</span></label>
            <input v-model="partNumber" placeholder="e.g. SRD-05VDC" @keyup.enter="create" />
          </div>
        </div>

        <div class="field">
          <label>Shape</label>
          <select v-model="shape">
            <option v-for="s in PART_SHAPES" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
          <p class="hint">{{ shapeHint }}</p>
        </div>

        <div v-if="legShape" class="field">
          <label class="check">
            <input type="checkbox" v-model="polar" /> Polarised (has a + / − orientation)
          </label>
        </div>

        <div class="field">
          <label>
            Connections / pins — one per line
            <span class="opt">({{ pinNames.length }}{{ expected ? ` / ${expected} expected` : '' }})</span>
          </label>
          <textarea v-model="pinText" rows="6" :placeholder="pinPlaceholder"></textarea>
        </div>

        <div class="field">
          <label>Accent colour</label>
          <div class="swatches">
            <button
              v-for="c in ACCENTS" :key="c"
              class="swatch" :class="{ on: c === accent }"
              :style="{ background: c }" @click="accent = c"
            ></button>
          </div>
        </div>

        <div class="field">
          <label>Icon</label>
          <div class="icon-grid">
            <button
              v-for="f in ICON_FILES" :key="f"
              type="button" class="icon-pick" :class="{ on: f === icon }"
              :title="f.replace('.svg', '').replace(/_/g, ' ')"
              @click="pickIcon(f)"
            >
              <img :src="iconUrl({ icon: f })" alt="" />
            </button>
          </div>
        </div>

        <p v-if="warning" class="warn">{{ warning }}</p>
      </div>

      <div class="modal-foot">
        <button class="add-btn" :disabled="!canCreate" @click="create">
          {{ editing ? 'Save part' : 'Add to library' }}
        </button>
        <button class="btn-ghost" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { PART_SHAPES, ICON_FILES, iconUrl } from '@/lib/breadboard/templates'

// Default icon per shape; applied until the user picks one explicitly.
const DEFAULT_ICON = {
  breakout: 'microchip.svg', to92: 'transistor.svg', resistor: 'resistor.svg',
  led: 'led_display.svg', dip: 'microchip.svg', board: 'circuit_board_general.svg',
}

const props = defineProps({
  open: { type: Boolean, default: false },
  // when set, the modal pre-fills for editing an existing definition
  part: { type: Object, default: null },
})
const emit = defineEmits(['create', 'close'])

const ACCENTS = ['#0ea5e9', '#16a34a', '#e11d48', '#f59e0b', '#8b5cf6', '#64748b', '#0f766e']

const name = ref('')
const partNumber = ref('')
const shape = ref('breakout')
const polar = ref(false)
const pinText = ref('')
const accent = ref(ACCENTS[0])
const icon = ref(DEFAULT_ICON.breakout)
const iconTouched = ref(false)

const editing = computed(() => !!props.part)

function pickIcon(f) {
  icon.value = f
  iconTouched.value = true
}
// Follow the shape's default icon until the user picks one explicitly.
watch(shape, (s) => { if (!iconTouched.value) icon.value = DEFAULT_ICON[s] || DEFAULT_ICON.breakout })

const shapeDef = computed(() => PART_SHAPES.find((s) => s.id === shape.value) || PART_SHAPES[0])
const legShape = computed(() => shape.value === 'resistor' || shape.value === 'led')
const expected = computed(() => (legShape.value ? 2 : shape.value === 'to92' ? 3 : 0))

const pinNames = computed(() =>
  pinText.value.split('\n').map((s) => s.trim()).filter(Boolean),
)

const shapeHint = computed(() => {
  if (shapeDef.value.placement === 'standalone') {
    return 'Sits beside the breadboard; you connect to its pins with jumper wires.'
  }
  return 'Plugs into the breadboard holes; legs snap to consecutive holes.'
})
const pinPlaceholder = computed(() => {
  if (shape.value === 'led') return 'anode (+)\ncathode (−)'
  if (shape.value === 'resistor') return '1\n2'
  if (shape.value === 'to92') return 'pin 1\npin 2\npin 3'
  if (shape.value === 'board') return 'VCC\nGND\nIN1\nIN2'
  return 'VCC\nGND\nSIG'
})

const warning = computed(() => {
  if (expected.value && pinNames.value.length && pinNames.value.length !== expected.value) {
    return `This shape normally has ${expected.value} pins — you entered ${pinNames.value.length}.`
  }
  return ''
})
const canCreate = computed(() => name.value.trim() && pinNames.value.length >= 1)

function fill() {
  const p = props.part
  if (p) {
    name.value = p.label || ''
    partNumber.value = p.partNumber || ''
    shape.value = p.placement === 'standalone' ? 'board' : (p.body || 'breakout')
    polar.value = !!p.polar
    pinText.value = (p.pins || []).map((x) => x.name).join('\n')
    accent.value = p.accent || ACCENTS[0]
    icon.value = p.icon || DEFAULT_ICON[shape.value] || DEFAULT_ICON.breakout
    iconTouched.value = !!p.icon
  } else {
    name.value = ''
    partNumber.value = ''
    shape.value = 'breakout'
    polar.value = false
    pinText.value = ''
    accent.value = ACCENTS[0]
    icon.value = DEFAULT_ICON.breakout
    iconTouched.value = false
  }
}
watch(() => props.open, (v) => { if (v) fill() })

function create() {
  if (!canCreate.value) return
  emit('create', {
    label: name.value.trim(),
    partNumber: partNumber.value.trim(),
    shape: shape.value,
    placement: shapeDef.value.placement,
    polar: legShape.value ? polar.value : false,
    accent: accent.value,
    icon: icon.value,
    pinNames: pinNames.value,
  })
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
  width: min(30rem, 94vw);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid #eeede9;
}
.modal-title {
  font-weight: 700;
  font-size: 1rem;
}
.modal-close {
  border: none;
  background: transparent;
  cursor: pointer;
  color: #5c5c5c;
}
.modal-body {
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  max-height: 70vh;
  overflow-y: auto;
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.field label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #5c5c5c;
}
.opt {
  color: #9a9a9a;
  font-weight: 500;
}
.field input,
.field select,
.field textarea {
  border: 1px solid #e5e4e1;
  border-radius: 0.5rem;
  padding: 0.45rem 0.55rem;
  font-size: 0.88rem;
  font-family: inherit;
  resize: vertical;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-weight: 500;
  color: #1a1a1a;
}
.check input {
  width: auto;
}
.hint {
  font-size: 0.74rem;
  color: #9a9a9a;
  margin: 0;
}
.swatches {
  display: flex;
  gap: 0.35rem;
}
.swatch {
  width: 1.3rem;
  height: 1.3rem;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
.swatch.on {
  border-color: #14b8a6;
}
.icon-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.35rem;
}
.icon-pick {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border: 1.5px solid #e5e4e1;
  border-radius: 0.5rem;
  background: #fff;
  cursor: pointer;
}
.icon-pick img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.icon-pick:hover {
  border-color: #14b8a6;
}
.icon-pick.on {
  border-color: #14b8a6;
  background: #ccfbf1;
}
.warn {
  font-size: 0.76rem;
  color: #b45309;
  margin: 0;
}
.modal-foot {
  display: flex;
  gap: 0.5rem;
  padding: 0.9rem 1.1rem;
  border-top: 1px solid #eeede9;
}
.add-btn {
  background: #14b8a6;
  color: #fff;
  border: none;
  border-radius: 0.55rem;
  padding: 0.5rem 0.9rem;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
}
.add-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-ghost {
  background: transparent;
  border: 1px solid #e5e4e1;
  border-radius: 0.55rem;
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
  cursor: pointer;
  color: #1a1a1a;
}
</style>
