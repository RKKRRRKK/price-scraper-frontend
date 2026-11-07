<template>
  <div class="hx-seg" role="tablist">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="tab"
      :aria-selected="o.value === modelValue"
      :class="{ on: o.value === modelValue }"
      :title="o.title"
      @click="emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<script setup>
// Small pill tab switch: options [{ label, value, title? }].
defineProps({
  modelValue: { type: [String, Number], default: null },
  options: { type: Array, required: true },
})
const emit = defineEmits(['update:modelValue'])
</script>
