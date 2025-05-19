<!-- File: src/components/section_buttons/ConfigureAlerts.vue -->
<template>
  <Dialog
    :visible="show"
    header="Configure Alerts"
    modal
    :style="{ width: '500px' }"
    @update:visible="onDialogVisibilityChange"
  >
    <div class=" bg-white rounded-lg">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-4 py-2 text-left text-sm font-medium text-gray-700">Term</th>
            <th class="px-4 py-2 text-center">
        
              <i
                class="pi pi-send text-xl cursor-pointer"
                @click="allTelegramSelected = !allTelegramSelected"
              />
            </th>
            <th class="px-4 py-2 text-center">
              <!-- big email icon -->
              <i
                class="pi pi-envelope text-xl cursor-pointer"
                @click="allEmailSelected = !allEmailSelected"
              />
            </th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="s in localSettings" :key="s.id">
            <td class="px-4 py-2 text-sm text-gray-800">{{ s.term }}</td>
            <td class="px-4 py-2 text-center">
              <!-- binary mode makes PrimeVue Checkbox render as a toggle switch -->
              <Checkbox v-model="s.telegramAlert" binary />
            </td>
            <td class="px-4 py-2 text-center">
              <Checkbox v-model="s.alertEmail" binary />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <Button label="Cancel" text @click="cancel" />
        <Button label="Save" icon="pi pi-check" @click="save" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useAlertsStore } from '@/stores/alerts'
import Dialog from 'primevue/dialog'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'

// props & emits
const props = defineProps({
  show: Boolean,
  fileId: Number,
  marketplace: String,
})
const emit = defineEmits(['update:show'])

// load + keep a local copy of the store’s alerts
const alertsStore = useAlertsStore()
const localSettings = ref([])

watch(
  () => props.show,
  async (visible) => {
    if (visible) {
      await alertsStore.fetchAlerts(props.fileId, props.marketplace)
      localSettings.value = alertsStore.alerts.map((a) => ({
        id: a.id,
        term: a.term,
        alertEmail: !!a.alertEmail,
        telegramAlert: a.telegramAlert ?? true,
      }))
    }
  },
  { immediate: true }
)

function toggleAll(type, value) {
  localSettings.value.forEach((s) => {
    if (type === 'telegram') s.telegramAlert = value
    if (type === 'email') s.alertEmail = value
  })
}

// these computed props drive both the header‐icon toggles and the store
const allTelegramSelected = computed({
  get: () =>
    localSettings.value.length > 0 &&
    localSettings.value.every((s) => s.telegramAlert),
  set: (val) => toggleAll('telegram', val),
})
const allEmailSelected = computed({
  get: () =>
    localSettings.value.length > 0 &&
    localSettings.value.every((s) => s.alertEmail),
  set: (val) => toggleAll('email', val),
})

function save() {
  alertsStore.updateAll(localSettings.value)
  emit('update:show', false)
}
function cancel() {
  emit('update:show', false)
}
function onDialogVisibilityChange(val) {
  emit('update:show', val)
}
</script>



<style scoped>
 
</style>
