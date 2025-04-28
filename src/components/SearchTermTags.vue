<template>
  <Dialog
    v-model:visible="localVisible"
    header="Adjust Search Tags"
    modal
    :style="{ width: '35rem' }"
  >
    <div class="p-fluid">
      <label for="tag-input" class="mb-2 font-medium">Tags</label>
      <!-- note the new `chips-below` class -->
      <Chips
        id="tag-input"
        v-model="localTags"
        placeholder="Type a tag and press Enter"
        class="chips-below"
      />
    </div>

    <template #footer>
      <div class="flex justify-content-end gap-2">
        <Button label="Cancel" text @click="onCancel" />
        <Button label="Save" severity="success" @click="onSave" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Chips from 'primevue/chips'
import Button from 'primevue/button'
import { useSearchTags } from '@/stores/searchTags'

// props & emits
const props = defineProps({
  visible: { type: Boolean, required: true },
  termId: { type: [String, Number], required: true },
})
const emit = defineEmits(['update:visible'])

// writable v-model proxy
const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

// tag state
const tagsStore = useSearchTags()
const localTags = ref([])

// When dialog opens, fetch latest tags for this term
watch(
  () => localVisible.value,
  async (visible) => {
    if (visible) {
      await tagsStore.fetchTags(props.termId)
      localTags.value = [...tagsStore.getTags(props.termId)]
    }
  },
)

function onCancel() {
  localVisible.value = false
}

async function onSave() {
  // persist to Supabase and update cache
  await tagsStore.setTags(props.termId, localTags.value)
  localVisible.value = false
}
</script>

<style scoped>
/* flip the Chips flex so input is on top, pills below */
:deep(.chips-below) {
  display: flex !important;
  flex-direction: column-reverse !important;
  align-items: flex-start;
}
/* give a little breathing room between input and pills */
:deep(.chips-below .p-chips-multiple-container) {
  margin-top: 0.5rem;
}
</style>
