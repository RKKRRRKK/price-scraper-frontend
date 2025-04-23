<template>
  <!-- Use larger padding inside the card (e.g., p-4) -->
  <!-- Using border-round-xl for more pronounced rounding like the example -->
  <Card class="surface-card border-round-xl shadow-2 w-full">
    <template #title>
      <div class="flex justify-content-between align-items-start gap-2">
        <span class="font-bold text-xl line-height-2" :title="term.term">
          {{ term.term }}
        </span>
        <Button
          icon="pi pi-times"
          severity="primary"
          text
          rounded
          aria-label="Remove search term"
          @click="remove"
          class="flex-shrink-0 !w-8 !h-8"
        />
      </div>
    </template>

    <template #content>
      <!-- Price Section -->
      <div class="mb-3">
        <div class="text-base text-color-secondary mb-1">Lowest price</div>
        <!-- Very large, bold price -->
        <div class="font-bold text-5xl">
          {{ formattedPrice }}
        </div>
      </div>
    </template>

    <template #footer>
      <Divider class="mb-3 mt-0" />

      <div class="flex flex-column gap-2">
        <span class="text-sm text-color-secondary">Last updated: {{ lastChangedHuman }}</span>

        <a
          v-if="hasItemUrl"
          :href="term.url"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary font-medium hover:underline text-base"
        >
          View item
          <i class="pi pi-external-link ml-1" style="font-size: 0.8rem"></i>
        </a>
        <span v-else class="text-sm text-color-secondary italic">(No item link available)</span>

        <div class="flex flex-col gap-2 text-sm">
          <span :class="includeClass">{{ includeText }}</span>
          <span :class="excludeClass">{{ excludeText }}</span>
        </div>
      </div>
      <div>
        <span class="font-medium mr-2">Prime only:</span>
        <i
          :class="[
            'pi',
            term.primeOnly ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500',
          ]"
          style="vertical-align: middle"
          :aria-label="term.primeOnly ? 'Yes' : 'No'"
        >
        </i>
        <span class="ml-1">{{ term.primeOnly ? 'Yes' : 'No' }}</span>
      </div>
    </template>
  </Card>
</template>
<script setup>
import { computed } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useSearchTerms } from '@/stores/searchTerms'

dayjs.extend(relativeTime)

const props = defineProps({
  term: {
    type: Object,
    required: true,
    default: () => ({
      id: null,
      term: 'Unknown Item',
      lowestPrice: null,
      lastChanged: null,
      url: null,
      primeOnly: false,
      include: [],
      exclude: [],
    }),
  },
})

const store = useSearchTerms()

const lastChangedHuman = computed(() =>
  props.term.lastChanged ? dayjs(props.term.lastChanged).fromNow() : 'never',
)

const includeText = computed(() =>
  props.term.include?.length ? props.term.include.join(', ') : 'no required',
)

const excludeText = computed(() =>
  props.term.exclude?.length ? props.term.exclude.join(', ') : 'no exclusions',
)

const includeClass = computed(() =>
  props.term.include?.length ? 'text-green-600 font-medium' : 'text-color-secondary',
)

const excludeClass = computed(() =>
  props.term.exclude?.length ? 'text-red-600 font-medium' : 'text-color-secondary',
)

const formattedPrice = computed(() => {
  if (props.term.lowestPrice == null) return '--.--'
  return `€${props.term.lowestPrice.toFixed(2)}`
})

function remove() {
  if (props.term.id) store.removeTerm(props.term.id)
}

const hasItemUrl = computed(() => !!props.term.url)
</script>

<style scoped>
/* Tighten up default card padding slightly if needed */
:deep(.p-card-content) {
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}
:deep(.p-card-footer) {
  padding-top: 0.5rem;
  padding-bottom: 1rem; /* Add more padding at the very bottom */
}

/* Ensure button size override works */
.p-button.p-button-icon-only.p-button-rounded {
  width: 2rem; /* Default */
  height: 2rem; /* Default */
}
.p-button.p-button-icon-only.p-button-rounded.flex-shrink-0 {
  width: 2rem !important; /* Adjust if !w-8 doesn't work as expected */
  height: 2rem !important; /* Adjust if !h-8 doesn't work as expected */
  /* PrimeFlex !w-8 translates to width: 2rem, so it might already be correct */
}

/* Style for the link to resemble the image */
a.text-primary {
  /* Assuming your PrimeVue theme primary color is suitable */
  /* color: var(--primary-color); */
  text-decoration: none;
}
a.text-primary:hover {
  text-decoration: underline;
}
</style>
