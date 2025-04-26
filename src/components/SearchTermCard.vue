<template>
  <Card class="surface-card border-round-xl shadow-2 w-full">
    <!-- title -->
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
          @click="confirmVisible = true"
          class="flex-shrink-0 !w-8 !h-8"
        />
      </div>
    </template>

    <!-- content -->
    <template #content>
      <div class="mb-3 flex gap-6">
        <div>
          <div class="text-base text-color-secondary mb-1">Current price</div>
          <div class="font-bold text-5xl">{{ formattedCurrent }}</div>
        </div>
        <div>
          <div class="text-base text-color-secondary mb-1">Lowest price</div>
          <div class="font-bold text-5xl">{{ formattedLowest }}</div>
        </div>
      </div>
    </template>

    <!-- footer -->
    <template #footer>
      <Divider class="mb-3 mt-0" />

      <div class="flex flex-column gap-2">
        <span class="text-sm text-color-secondary">
          Last updated: {{ lastChangedHuman }}
        </span>

        <a
          v-if="hasItemUrl"
          :href="term.link"
          target="_blank"
          rel="noopener noreferrer"
          class="text-2xl font-medium hover:underline"
        >
          View item
          <i class="pi pi-external-link ml-1" style="font-size: 1rem" />
        </a>
        <span v-else class="text-sm text-color-secondary italic">
          (No item link available)
        </span>

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
            term.primeOnly
              ? 'pi-check-circle text-green-500'
              : 'pi-times-circle text-red-500'
          ]"
          style="vertical-align: middle"
          :aria-label="term.primeOnly ? 'Yes' : 'No'"
        />
        <span class="ml-1">{{ term.primeOnly ? 'Yes' : 'No' }}</span>
      </div>
    </template>
  </Card>

  <!-- confirmation dialog -->
  <Dialog
    v-model:visible="confirmVisible"
    header="Delete search term"
    modal
    :style="{ width: '35rem' }"
  >
  <p>Are you sure you want to remove <span class="font-bold px-1">{{ term.term.toUpperCase() }}</span> from scheduled runs?</p>

    <template #footer>
      <div class="flex justify-content-end gap-2">
        <Button label="Cancel" text @click="confirmVisible = false" />
        <Button label="Delete" severity="danger" @click="removeConfirmed" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import Dialog from 'primevue/dialog'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useSearchTerms } from '@/stores/searchTerms'

dayjs.extend(relativeTime)

const props = defineProps({
  term: {
    type: Object,
    required: true
  }
})

const store = useSearchTerms()
const confirmVisible = ref(false)

const lastChangedHuman = computed(() =>
  props.term.lastChanged ? dayjs(props.term.lastChanged).fromNow() : 'never'
)

const includeText = computed(() =>
  props.term.include?.length ? props.term.include.join(', ') : 'no required'
)

const excludeText = computed(() =>
  props.term.exclude?.length ? props.term.exclude.join(', ') : 'no exclusions'
)

const includeClass = computed(() =>
  props.term.include?.length ? 'text-green-600 font-medium' : 'text-color-secondary'
)

const excludeClass = computed(() =>
  props.term.exclude?.length ? 'text-red-600 font-medium' : 'text-color-secondary'
)

const formattedCurrent = computed(() =>
  props.term.currentPrice == null ? '--.--' : `€${props.term.currentPrice.toFixed(2)}`
)

const formattedLowest = computed(() =>
  props.term.lowestPrice == null ? '--.--' : `€${props.term.lowestPrice.toFixed(2)}`
)

function removeConfirmed () {
  if (props.term.id) store.removeTerm(props.term.id)
  confirmVisible.value = false
}

const hasItemUrl = computed(() => !!props.term.link)
</script>

<style scoped>
:deep(.p-card-content) {
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}
:deep(.p-card-footer) {
  padding-top: 0.5rem;
  padding-bottom: 1rem;
}
.p-button.p-button-icon-only.p-button-rounded {
  width: 2rem;
  height: 2rem;
}
.p-button.p-button-icon-only.p-button-rounded.flex-shrink-0 {
  width: 2rem !important;
  height: 2rem !important;
}
</style>
