<script setup>
import { ref, computed } from 'vue'
import SearchTermModal from './SearchTermModal.vue'
import SearchTermCard from './SearchTermCard.vue'
import { useSearchTerms } from '@/stores/searchTerms'
import Button from 'primevue/button'
import Message from 'primevue/message' // Optional: For empty state

const props = defineProps({ marketplace: String, title: String })
const store = useSearchTerms()
const terms = computed(() => store.termsByMarketplace(props.marketplace)) // Make it computed for reactivity

const showModal = ref(false)
</script>

<template>
  <!-- Add the custom class 'min-w-section' to the root section -->
  <section class="min-w-section mb-5 p-3 md:p-4 border-round surface-section shadow-1">
    <div class="flex justify-content-between align-items-center mb-4">
      <h2 class="text-xxl font-bold m-0">{{ title }}</h2>
      <Button
        icon="pi pi-plus"
        rounded
        raised
        aria-label="Add Search Term"
        @click="showModal = true"
      />
    </div>

    <!-- Container for cards - this will stretch to the section width -->
    <div class="flex flex-column gap-3">
      <template v-if="terms.length > 0">
        <!-- SearchTermCard still uses w-full to fill its container -->
        <SearchTermCard v-for="t in terms" :key="t.id" :term="t" class="w-full" />
      </template>
      <div
        v-else
        class="text-center text-color-secondary p-3 border-round border-1 border-dashed surface-border"
      >
        No search terms added yet for {{ title }}.
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
</style>
