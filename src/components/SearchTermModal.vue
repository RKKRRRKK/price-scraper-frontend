<template>
  <Dialog v-model:visible="visible" header="Add new scrape job" modal>
    <div class="flex flex-column gap-3">
      <!-- main search term -->
      <InputText v-model="form.term" placeholder="Search term" />

      <!-- prime-only toggle -->
      <div class="flex flex-column gap-2">
        <label class="flex align-items-center gap-2">
          <Checkbox v-model="form.primeOnly" :binary="true" />
          <span>Exclude Zooms</span>
        </label>
        <label class="flex align-items-center gap-2">
          <Checkbox v-model="form.lensOnly" :binary="true" />
          <span>Exclude Bodies</span>
        </label>
        <label class="flex align-items-center gap-2">
          <Checkbox v-model="form.excludeAcc" :binary="true" />
          <span>Exclude Accessories</span>
        </label>
      </div>

      <!-- INCLUDE section -->
      <label class="font-medium text-sm">Included keywords</label>

      <!-- one input row per keyword -->
      <div v-for="(word, i) in form.include" :key="'inc' + i" class="flex align-items-center gap-2">
        <InputText v-model="form.include[i]" class="flex-1" />
        <Button icon="pi pi-trash" severity="danger" text @click="form.include.splice(i, 1)" />
      </div>

      <!-- add-include button -->
      <Button
        label="Add inclusion"
        icon="pi pi-plus"
        severity="secondary"
        outlined
        class="align-self-start"
        @click="addInclude"
      />

      <!-- EXCLUDE section -->
      <label class="font-medium text-sm mt-3">Excluded keywords</label>

      <div v-for="(word, i) in form.exclude" :key="'exc' + i" class="flex align-items-center gap-2">
        <InputText v-model="form.exclude[i]" class="flex-1" />
        <Button icon="pi pi-trash" severity="danger" text @click="form.exclude.splice(i, 1)" />
      </div>

      <Button
        label="Add exclusion"
        icon="pi pi-plus"
        severity="secondary"
        outlined
        class="align-self-start"
        @click="addExclude"
      />

      <!-- footer buttons -->
      <div class="flex justify-content-end gap-2 mt-3">
        <Button label="Cancel" severity="secondary" @click="emit('close')" />
        <Button label="Save" icon="pi pi-check" @click="save" />
      </div>
    </div>
  </Dialog>
</template>
<script setup>
import { ref, reactive, watch } from 'vue'
import { useSearchTerms } from '@/stores/searchTerms'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'

const props = defineProps({ show: Boolean, marketplace: String })
const emit = defineEmits(['close'])

const visible = ref(props.show)
watch(
  () => props.show,
  (v) => (visible.value = v),
)
watch(visible, (v) => {
  if (!v) emit('close')
})

const store = useSearchTerms()

const form = reactive({
  term: '',
  primeOnly: false,
  lensOnly: false,
  excludeAcc: true,
  include: [],
  exclude: [],
})

function addInclude() {
  form.include.push('')
}
function addExclude() {
  form.exclude.push('')
}

async function save() {
  const clean = {
    marketplace: props.marketplace,
    term: form.term,
    primeOnly: form.primeOnly,
    lensOnly: form.lensOnly,
    excludeAcc: form.excludeAcc,
    include: form.include.filter((v) => v?.trim().length),
    exclude: form.exclude.filter((v) => v?.trim().length),
  }
  await store.addTerm(clean) // <- use the correct action
  emit('close')
}
</script>

<style scoped>
.checkboxes {
  display: flex;
  gap: 1rem;
}
</style>
