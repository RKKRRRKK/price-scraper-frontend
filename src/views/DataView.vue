<script setup>
import { ref, computed, onMounted } from 'vue'
import { FilterMatchMode } from '@primevue/core/api'
import { useConfirm } from 'primevue/useconfirm'
import { useListingsExplorer } from '@/stores/listingsExplorer'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import ConfirmDialog from 'primevue/confirmdialog'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'

const explorer = useListingsExplorer()
onMounted(() => explorer.fetchTerms())

// distinct search terms come from a DB-side query (RPC), not from the table
// itself, and the listings table is only ever queried once one is picked
const termOptions = computed(() =>
  [...explorer.terms]
    .sort((a, b) => a.term.localeCompare(b.term))
    .map((t) => ({ label: `${t.term} (${t.count})`, value: t.term })),
)

const onTermChange = (term) => explorer.selectTerm(term)

const filters = ref({
  global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  condition: { value: null, matchMode: FilterMatchMode.EQUALS },
})
const clearFilter = () => {
  filters.value.global.value = null
  filters.value.condition.value = null
}

const confirm = useConfirm()
function askDelete(row) {
  confirm.require({
    message: 'Are you sure you want to permanently delete this record from the database?',
    header: 'Confirm deletion',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Delete',
    rejectLabel: 'Cancel',
    accept: () => explorer.deleteListing(row.id).catch(() => {}),
  })
}
</script>

<template>
  <section class="wrap">
    <!-- search-term picker: options come from a DB-side distinct query, and
         the listings table is only queried once a term is actually chosen -->
    <div class="term-picker">
      <label for="termPicker">Search term</label>
      <Select
        id="termPicker"
        :modelValue="explorer.selectedTerm"
        @update:modelValue="onTermChange"
        :options="termOptions"
        optionLabel="label"
        optionValue="value"
        filter
        placeholder="Choose a search term to load its listings…"
        :loading="explorer.termsLoading"
        :disabled="termOptions.length === 0"
        emptyMessage="No search terms found"
        showClear
        class="term-select"
      />
      <span v-if="explorer.error" class="term-error">{{ explorer.error }}</span>
    </div>

    <div class="card max-w-screen-xl  shadow-md rounded-lg overflow-hidden border">
      <DataTable
        v-if="explorer.selectedTerm"
        :value="explorer.rows"
        :filters="filters"
        dataKey="id"
        :globalFilterFields="[
          'search_term',
          'title',
          'date_inserted',
          'price',
          'condition',
          'link',
        ]"
        scrollable
        scrollHeight="60vh"
        paginator
        paginatorPosition="both"
        :rows="50"
        :rowsPerPageOptions="[50, 100, 200]"
        responsiveLayout="scroll"
        removableSort
        class="p-datatable-sm"
        style="border-radius: 1.5rem; overflow: hidden;"
        :loading="explorer.rowsLoading"
      >
        <!-- coloured header bar -->
        <template #header>
          <div class="flex items-center justify-between bg-primary p-3 gap-2">
            <Button
              type="button"
              icon="pi pi-filter-slash"
              label="Clear"
              severity="secondary"
              @click="clearFilter"
            />
            <IconField>
              <InputIcon><i class="pi pi-search" /></InputIcon>
              <InputText v-model="filters.global.value" placeholder="Keyword Search" />
            </IconField>
          </div>
        </template>

        <Column field="search_term" header="Search Term" sortable filter />
        <Column field="title" header="Title" sortable filter />
        <Column field="date_inserted" header="Date Inserted" sortable filter />
        <Column field="price" header="Price" sortable filter />
        <Column field="condition" header="Condition" sortable filter />
        <Column header="URL" sortable filter>
          <template #body="{ data }">
            <a
              :href="data.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-orange-600 hover:underline break-all font-bold"
            >
              {{ data.source }}
            </a>
          </template>
        </Column>

        <Column headerStyle="width:4rem">
          <template #body="{ data }">
            <Button
              icon="pi pi-trash"
              severity="danger"
              text
              rounded
              @click="askDelete(data)"
              v-tooltip.bottom="'Delete listing'"
            />
          </template>
        </Column>
      </DataTable>

      <div v-else class="empty-state">
        <i class="pi pi-database" />
        <p>Pick a search term above to load its listings.</p>
      </div>
    </div>

    <ConfirmDialog />
  </section>
</template>

<style scoped>
.wrap {
  max-width: 70vw;
  margin: auto;
  margin-top: 5rem;
}

.term-picker {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 1.25rem;
  max-width: 28rem;
}
.term-picker label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #4b5563;
}
.term-select {
  width: 100%;
}
.term-error {
  font-size: 0.8125rem;
  color: #d03b3b;
}

.empty-state {
  height: 40vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: #9ca3af;
}
.empty-state i {
  font-size: 2.5rem;
}
.empty-state p {
  margin: 0;
  font-size: 0.9375rem;
}

:deep(.p-datatable-sm) {
  --p-datatable-header-sm-padding: 0rem;
}

</style>
