<script setup>
import { ref, onMounted } from 'vue'
import { FilterMatchMode } from '@primevue/core/api'
import { useConfirm } from 'primevue/useconfirm'
import { useListingsTable } from '@/stores/listingsTable'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import ConfirmDialog from 'primevue/confirmdialog'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'

const listingsStore = useListingsTable()
onMounted(() => listingsStore.fetchAll())

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
    accept: () => listingsStore.deleteListing(row.id).catch(() => {}),
  })
}
</script>

<template>
  <section class="wrap">
    <div class="card max-w-screen-xl  shadow-md rounded-lg overflow-hidden border">
      <DataTable
        :value="listingsStore.rows"
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
        :loading="listingsStore.loading"
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

:deep(.p-datatable-sm) {
  --p-datatable-header-sm-padding: 0rem;
}
 
</style>
