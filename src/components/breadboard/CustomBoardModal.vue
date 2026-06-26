<template>
  <div v-if="open" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title">Custom board</span>
        <button class="modal-close" @click="$emit('close')">
          <i class="pi pi-times" style="font-size: 0.85rem"></i>
        </button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Board name</label>
          <input v-model="name" placeholder="e.g. Relay module" />
        </div>
        <div class="field">
          <label>Pins — one per line (order = top to bottom, alternating sides)</label>
          <textarea v-model="pinText" rows="8" placeholder="VCC&#10;GND&#10;IN1&#10;IN2&#10;…"></textarea>
        </div>
        <p class="hint">{{ pinNames.length }} pins · split into two columns automatically.</p>
      </div>
      <div class="modal-foot">
        <button class="add-btn" :disabled="!canCreate" @click="create">Add board</button>
        <button class="btn-ghost" @click="$emit('close')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['create', 'close'])

const name = ref('')
const pinText = ref('')

const pinNames = computed(() =>
  pinText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean),
)
const canCreate = computed(() => name.value.trim() && pinNames.value.length >= 1)

watch(
  () => props.open,
  (v) => {
    if (v) { name.value = ''; pinText.value = '' }
  },
)

function create() {
  if (!canCreate.value) return
  emit('create', { name: name.value.trim(), pinNames: pinNames.value })
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
  width: min(28rem, 92vw);
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
.field input,
.field textarea {
  border: 1px solid #e5e4e1;
  border-radius: 0.5rem;
  padding: 0.45rem 0.55rem;
  font-size: 0.88rem;
  font-family: inherit;
  resize: vertical;
}
.hint {
  font-size: 0.74rem;
  color: #9a9a9a;
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
