<script setup>
import { ref, computed, onMounted } from 'vue'
import SearchTermModal from './SearchTermModal.vue'
import SearchTermCard from './SearchTermCard.vue'
import { useSearchTerms } from '@/stores/searchTerms'
import { useSearchTags } from '@/stores/searchTags'
import { supabase } from '@/lib/supabase'
import Button from 'primevue/button'
import Message from 'primevue/message' // Optional: For empty state
import Chips from 'primevue/chips'

const props = defineProps({
  marketplace: String,
  title: String,
})

const store = useSearchTerms()
const tagsStore = useSearchTags()

// Load all tags once so tagsStore.getTags(id) will work
onMounted(() => {
  tagsStore.fetchTags()
})

// Original list of terms
const terms = computed(() => store.termsByMarketplace(props.marketplace))

// Tags used to filter
const filterTags = ref([])

// Computed list of terms matching all selected filter tags
const filteredTerms = computed(() => {
  const list =
    filterTags.value.length === 0
      ? [...terms.value]
      : terms.value.filter((term) => {
          const termTags = tagsStore.getTags(term.id)
          return filterTags.value.every((tag) => termTags.includes(tag))
        })

  return list.sort((a, b) => {
    const dateA = a.lastChanged ? new Date(a.lastChanged) : 0
    const dateB = b.lastChanged ? new Date(b.lastChanged) : 0
    return dateB - dateA
  })
})

const showModal = ref(false)

// Figure out the “other” marketplace
const otherMarketplace = computed(() => {
  const all = [...new Set(store.terms.map((t) => t.marketplace))]
  return all.find((m) => m !== props.marketplace)
})

// Sync missing terms + tags from the other marketplace into this one
async function syncFromOther() {
  if (!otherMarketplace.value) {
    console.warn('No other marketplace to sync from')
    return
  }

  const from = otherMarketplace.value
  const to = props.marketplace
  const fromTerms = store.termsByMarketplace(from)
  const toTerms = store.termsByMarketplace(to)

  // find terms that exist in `from` but not in `to`
  const missing = fromTerms.filter((o) => !toTerms.some((t) => t.term === o.term))

  for (const o of missing) {
    try {
      // insert the scrape_job under this section’s source
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

      // mirror it into the local Pinia store
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

      // copy over all tags
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
      <h2 class="text-xxl font-bold m-0">{{ title }}</h2>
      <Chips v-model="filterTags" placeholder="Filter by tags" class="flex-1" />

      <!-- Sync button -->
      <Button
        icon="pi pi-copy"
        rounded
        raised
        aria-label="Sync Terms"
        :title="`Import missing terms from ${otherMarketplace || '…'}`"
        @click="syncFromOther"
      />

      <!-- Add new term -->
      <Button
        icon="pi pi-plus"
        rounded
        raised
        aria-label="Add Search Term"
        @click="showModal = true"
      />
    </div>

    <div class="flex flex-column gap-3">
      <template v-if="filteredTerms.length > 0">
        <SearchTermCard v-for="t in filteredTerms" :key="t.id" :term="t" class="w-full" />
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
      @close="showModal = false"
    />
  </section>
</template>
<style scoped>
.w-full {
  scale: 0.95;
}
.surface-section {
  background-color: var(--surface-b);
}

.shadow-1 {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.12),
    0 1px 2px rgba(0, 0, 0, 0.24);
}

/* Define the minimum width for the section */
@media (min-width: 1024px) {
  .min-w-section {
    min-width: 460px;
  }
}

.round {
  border-radius: 2rem;
}
</style>
