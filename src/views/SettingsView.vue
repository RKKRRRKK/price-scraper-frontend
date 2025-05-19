<template>
  <div class="settings-wrapper">
    <div class="settings-card">
      <h2>Notification Settings</h2>

      <div class="field">
        <label for="chatId">Telegram chat ID</label>
        <InputText
          id="chatId"
          v-model="localChatId"
          placeholder="123456789"
          class="input"
          :disabled="store.loading"
        />
      </div>

      <div class="field">
        <label for="email">E-mail address</label>
        <InputText
          id="email"
          v-model="localEmail"
          placeholder="name@example.com"
          class="input"
          :disabled="store.loading"
        />
      </div>

      <Button
        label="Save"
        icon="pi pi-save"
        class="save-btn"
        :disabled="store.saving || !dirty"
        @click="showConfirm = true"
      />

      <Dialog
        header="Confirm"
        v-model:visible="showConfirm"
        :modal="true"
        :closable="false"
        style="width: 22rem"
      >
        <span>Are you sure you want to save these changes?</span>
        <template #footer>
          <Button label="Cancel" class="p-button-secondary" @click="showConfirm = false" />
          <Button
            label="Save"
            icon="pi pi-check"
            class="p-button-primary"
            :loading="store.saving"
            @click="handleSave"
          />
        </template>
      </Dialog>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'

import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'

const store = useSettingsStore()

const localChatId = ref('')
const localEmail = ref('')

onMounted(() => store.fetchSettings())

watch(
  () => [store.chatId, store.email],
  ([cid, em]) => {
    localChatId.value = cid != null ? String(cid) : ''
    localEmail.value = em != null ? String(em) : ''
  },
  { immediate: true },
)

const dirty = computed(() => localChatId.value !== store.chatId || localEmail.value !== store.email)

const showConfirm = ref(false)

async function handleSave() {
  const chatId = String(localChatId.value ?? '').trim()
  const email = String(localEmail.value ?? '').trim()
  await store.saveSettings({ chatId, email })
  showConfirm.value = false
}
</script>

<style scoped>
.settings-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
  padding: 24px;
}

.settings-card {
  width: 100%;
  max-width: 420px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  padding: 32px;
}

.settings-card h2 {
  text-align: center;
  margin-bottom: 24px;
  font-size: 20px;
  font-weight: 600;
  color: #253858;
}

.field + .field {
  margin-top: 18px;
}

.field label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #4a5568;
}

.input {
  width: 100%;
  height: 44px;
  font-size: 16px;
}

.save-btn {
  width: 100%;
  height: 44px;
  margin-top: 26px;
  font-size: 16px;
}
</style>
