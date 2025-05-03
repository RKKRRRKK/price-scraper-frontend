<template>
  <Dialog v-model:visible="visible" header="Add new scrape job" modal>
    <div class="flex flex-column gap-3" style="max-width: 15rem;">
      <!-- main search term -->
      <InputText v-model="form.term" placeholder="Search term" />
      

      <!-- LENS SEARCH OPTIONS -->
      <Accordion  >
        <AccordionTab header="Lens Search Filters">
          <div class="flex flex-column gap-2">
            <label class="flex align-items-center gap-2">
              <Checkbox v-model="form.primeOnly" :binary="true" />
              <span>Exclude Zooms</span>
              <i
   class="pi pi-info-circle text-yellow-500  hover:text-yellow-800 opacity-50 text-xs pb-2"
          v-tooltip.top="'Will filter out Zoom lenses (when searching for 50mm, you will not get results for 18-50mm)'"
          style="cursor: help;"
        />
            </label>
            <label class="flex align-items-center gap-2">
              <Checkbox v-model="form.lensOnly" :binary="true" />
              <span>Exclude Bodies</span>
              <i
     class="pi pi-info-circle text-yellow-500  hover:text-yellow-800 opacity-50 text-xs pb-2"
          v-tooltip.top="'Will filter out listings where the lens comes included with a camera body'"
          style="cursor: help;"
        />
            </label>
            <label class="flex align-items-center gap-2">
              <Checkbox v-model="form.excludeAcc" :binary="true" />
              <span>Exclude Accessories</span>
              <i
      class="pi pi-info-circle text-yellow-500  hover:text-yellow-800 opacity-50 text-xs pb-2"
          v-tooltip.top="'Will filter out listings with common camera or lens accessories (hoods, covers)'"
          style="cursor: help;"
        />
            </label>
          </div>
        </AccordionTab>
      </Accordion>

      <!-- SMART FILTERING toggle -->
      <div class="flex align-items-center gap-2 m-1 mt-3 mb-3">
        <InputSwitch v-model="form.smart_filter" />
        <span>Smart Filtering</span>
        <i
          class="pi pi-info-circle text-yellow-500  hover:text-yellow-800 opacity-50 text-xs pb-2"
          v-tooltip.top="'Uses AI to filter out any listings for accessories to a given search term, or different versions etc. Costs $$ and slows down the scraping process a lot, so only use when needed.'"
          style="cursor: help;"
        />
      </div>

      <!-- INCLUDE section -->
       <div class="gap-2 flex">
      <label class="font-medium text-sm">Include keywords</label>
      <i
      class="pi pi-info-circle text-yellow-500  hover:text-yellow-800 opacity-50 text-xs pb-2"
          v-tooltip.top="'Words from the Search Term which absolutely need to be included in the listing for it to be valid'"
          style="cursor: help;"
        />
      </div>

      <!-- one input row per keyword -->
      <div v-for="(word, i) in form.include" :key="'inc' + i" class="flex align-items-center gap-2">
        <InputText v-model="form.include[i]" class="keyword-input" />
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
      <div class="gap-2 flex">
      <label class="font-medium text-sm mt-3">Exclude keywords</label>
      <i
           class="pi pi-info-circle text-yellow-500  hover:text-yellow-800 opacity-50 text-xs"
          v-tooltip.top="'Words which when present in the title, will invalidate a listing.'"
          style="cursor: help;"
        />
      </div>

      <div v-for="(word, i) in form.exclude" :key="'exc' + i" class="flex align-items-center gap-2">
        <InputText v-model="form.exclude[i]" class="keyword-input" />
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
import InputSwitch from 'primevue/inputswitch'
import Accordion from 'primevue/accordion'
import AccordionTab from 'primevue/accordiontab'
import Button from 'primevue/button'

const props = defineProps({
  show: Boolean,
  marketplace: String,
  fileId: { type: Number, required: true },
})
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
  smart_filter: false,
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
    smart_filter: form.smart_filter,
    include: form.include.filter((v) => v?.trim().length),
    exclude: form.exclude.filter((v) => v?.trim().length),
    fileId: props.fileId,
  }
  console.log('clean:  ', clean)
  await store.addTerm(clean) // <- use the correct action
  emit('close')
}
</script>

<style scoped>
:deep(.keyword-input) {
  /* let it grow but also allow it to shrink */
  flex: 1 1 0 !important; /* occupy free space in the row        */
  min-width: 0 !important; /* may shrink below its content width  */
  max-width: 100%; /* never exceed the row                */
  box-sizing: border-box; /* include padding/border in the width */
}
</style>
