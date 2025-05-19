<!-- File: src/components/SearchTermSection.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import SearchTermModal from './SearchTermModal.vue'
import SearchTermCard from './SearchTermCard.vue'
import ConfigureAlerts from './section_buttons/ConfigureAlerts.vue'
import { useSearchTerms } from '@/stores/searchTerms'
import { useSearchTags } from '@/stores/searchTags'
import { supabase } from '@/lib/supabase'
import Button from 'primevue/button'
import Message from 'primevue/message'
import Chips from 'primevue/chips'

const props = defineProps({
  marketplace: String,
  title: String,
  fileId: {
    type: Number,
    required: true,
  },
})

const store = useSearchTerms()
const tagsStore = useSearchTags()

onMounted(() => {
  tagsStore.fetchTags()
})

const termsForFileAndMarketplace = computed(() => {
  return store.termsByMarketplace(props.fileId, props.marketplace)
})

const filterTags = ref([])

const filteredTerms = computed(() => {
  const list =
    filterTags.value.length === 0
      ? [...termsForFileAndMarketplace.value]
      : termsForFileAndMarketplace.value.filter((term) => {
          const termTags = tagsStore.getTags(term.id)
          return filterTags.value.every((tag) => (termTags || []).includes(tag))
        })

  return list.sort((a, b) => {
    if (a.ageInDays === 0 && b.ageInDays !== 0) return -1
    if (b.ageInDays === 0 && a.ageInDays !== 0) return 1

    const dateA = a.ageInDays ? new Date(a.ageInDays) : 999
    const dateB = b.ageInDays ? new Date(b.ageInDays) : 999
    return dateA - dateB
  })
})

const showModal = ref(false)
const showAlerts = ref(false)

const otherMarketplace = computed(() => {
  const all = [...new Set(store.terms.map((t) => t.marketplace))]
  return all.find((m) => m !== props.marketplace)
})

async function syncFromOther() {
  if (!otherMarketplace.value) {
    console.warn('No other marketplace to sync from')
    return
  }

  const from = otherMarketplace.value
  const to = props.marketplace
  const fromTerms = store.termsByMarketplace(from)
  const toTerms = store.termsByMarketplace(to)

  const missing = fromTerms.filter((o) => !toTerms.some((t) => t.term === o.term))

  for (const o of missing) {
    try {
      const { data: inserted, error } = await supabase
        .from('scrape_jobs')
        .insert({
          source: to,
          search_term: o.term,
          include_terms: o.include,
          exclude_terms: o.exclude,
          exclude_zoom: o.primeOnly,
          exclude_bodies: o.lensOnly,
          exclude_acc: o.excludeAcc,
        })
        .select('*')
        .single()

      if (error) throw error

      store._upsertLocal({
        id: inserted.id,
        marketplace: inserted.source,
        term: inserted.search_term,
        primeOnly: inserted.exclude_zoom,
        lensOnly: inserted.exclude_bodies,
        excludeAcc: inserted.exclude_acc,
        include: inserted.include_terms,
        exclude: inserted.exclude_terms,
        link: null,
        currentPrice: null,
        lowestPrice: null,
        lastChanged: null,
        offersTotal: null,
        offersCurrent: null,
      })

      const tags = tagsStore.getTags(o.id)
      await tagsStore.setTags(inserted.id, tags)
    } catch (err) {
      console.error(`Failed to sync term "${o.term}":`, err)
    }
  }
}
</script>

<template>
  <section class="min-w-section mb-5 p-3 md:p-6 surface-section shadow-1 round">
    <div class="flex justify-content-between align-items-center mb-4 gap-5">
      <div class="flex flex-column md:flex-row gap-2">
        <h2 class="text-xxl font-bold m-0 mr-3">{{ title }}</h2>
        <Chips v-model="filterTags" placeholder="Filter by tags" class="flex-1" />
      </div>
      <div class="flex gap-2 mb-6 md:mb-0">
        <Button
          icon="pi pi-copy"
          rounded
          raised
          class="flex-shrink-0"
          aria-label="Sync Terms"
          :title="`Import missing terms from ${otherMarketplace || 'ΓÇª'}`"
          @click="syncFromOther"
        />
                <Button
          icon="pi pi-bell"
          rounded
          class="flex-shrink-0"
          raised
          aria-label="Configure Alerts"
          title="Configure Telegram/Email Alerts"
          @click="showAlerts = true"
        />
        <Button
          icon="pi pi-plus"
          rounded
          class="flex-shrink-0"
          raised
          aria-label="Add Search Term"
          title="Add a new search term"
          @click="showModal = true"
        />
      </div>
    </div>

    <div class="flex flex-column gap-3">
      <template v-if="filteredTerms.length > 0">
        <SearchTermCard v-for="t in filteredTerms" :key="t.id" :term="t" />
      </template>
      <div
        v-else
        class="text-center text-color-secondary p-3 border-round border-1 border-dashed surface-border"
      >
        No search terms found for selected tags.
      </div>
    </div>

    <SearchTermModal
      :show="showModal"
      :marketplace="props.marketplace"
      :fileId="props.fileId"
      @close="showModal = false"
    />
    <ConfigureAlerts
      :show="showAlerts"
      :marketplace="props.marketplace"
      :fileId="props.fileId"
      @update:show="val => showAlerts = val"
    />
  </section>
</template>

<style scoped>
.surface-section {
  background-color: var(--surface-b);
}

.shadow-1 {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.12),
    0 1px 2px rgba(0, 0, 0, 0.24);
}

@media (min-width: 1024px) {
  .min-w-section {
    min-width: 460px;
  }
}

.round {
  border-radius: 2rem;
}
</style>
