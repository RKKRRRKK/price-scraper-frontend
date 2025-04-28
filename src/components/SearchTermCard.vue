<template>
  <Card :class="['surface-card border-round-xl shadow-2', { 'footer-expanded': footerVisible }]">
    <!-- title -->
    <template #title>
      <div class="flex justify-content-between align-items-start gap-2 -ml-2">
        <div class="flex align-items-center gap-2">
          <Button
            :icon="footerVisible ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
            text
            rounded
            aria-label="Toggle details"
            @click="toggleFooter"
            class="flex-shrink-0 !w-10 !h-10"
          />
          <span class="font-bold text-xl line-height-2" :title="term.term">
            {{ term.term }}
            <Tag
              v-if="term.condition"
              :value="term.condition"
              :severity="conditionSeverity"
              class="ml-1"
            />
            <span class="text-sm text-color-secondary ml-4">
              (last price change: {{ lastChangedHuman }})
            </span>
          </span>
        </div>
        <Button
          icon="pi pi-times"
          severity="danger"
          text
          rounded
          aria-label="Remove search term"
          @click="confirmVisible = true"
          class="flex-shrink-0 !w-8 !h-8"
        />
      </div>
      <Divider class="mb-2" />
    </template>

    <!-- content -->
    <template #content>
      <div class="mb-3 flex flex-wrap justify-content-between align-items-start">
        <!-- Prices -->
        <div class="flex gap-6 mb-4 md:mb-0 text-500">
          <div>
            <div class="text-base text-color-secondary mb-1">Current price</div>
            <div :class="deal">{{ formattedCurrent }}</div>
          </div>
          <div>
            <div class="text-base text-color-secondary mb-1">Lowest price</div>
            <div class="font-bold text-4xl">{{ formattedLowest }}</div>
          </div>
        </div>

        <!-- Divider + Offers -->
        <div class="flex gap-6 w-full md:w-auto md:pl-6 md:border-left-2 surface-border text-300">
          <div>
            <div class="text-base text-color-secondary mb-1 text-primary">Active Offers</div>
            <div class="font-bold text-4xl text-secondary text-500">{{ offersCurrent }}</div>
          </div>
          <div>
            <div class="text-base text-color-secondary mb-1">Total Offers</div>
            <div class="font-bold text-4xl">{{ offersTotal }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- footer -->
    <template #footer>
      <Transition name="slide-fade">
        <div v-show="footerVisible">
          <Divider class="mb-2 margin-top" />

          <div class="flex flex-column gap-2">
            <a
              v-if="hasItemUrl"
              :href="term.link"
              target="_blank"
              rel="noopener noreferrer"
              class="text-xl font-medium hover:underline"
            >
              View item
              <i class="pi pi-external-link ml-1" style="font-size: 1rem" />
            </a>
            <span v-else class="text-sm text-color-secondary italic">
              (No item link available)
            </span>

            <div class="flex flex-col gap-2 text-m">
              <span>Exclusions/Inclusions: </span>
              <span :class="includeClass">{{ includeText }}</span>
              <span :class="excludeClass">{{ excludeText }}</span>
            </div>

            <span class="condi">Conditionals:</span>

            <div class="flex justify-content-between align-items-center w-full">
              <!-- tags display -->
              <div>
                <template v-if="tagsList.length">
                  <Tag
                    v-for="tag in tagsList"
                    :key="tag"
                    :value="tag"
                    severity="secondary"
                    class="mr-2"
                  />
                </template>
              </div>

              <!-- Adjust Tags button -->
              <Button
                label="Adjust Search Tags"
                icon="pi pi-tags"
                text
                @click="tagsVisible = true"
              />
            </div>
          </div>
        </div>
      </Transition>
    </template>
  </Card>

  <!-- delete confirmation dialog -->
  <Dialog
    v-model:visible="confirmVisible"
    header="Delete search term"
    modal
    :style="{ width: '35rem' }"
  >
    <p>
      Are you sure you want to remove
      <span class="font-bold px-1">{{ term.term.toUpperCase() }}</span>
      from scheduled runs?
    </p>

    <template #footer>
      <div class="flex justify-content-end gap-2">
        <Button label="Cancel" text @click="confirmVisible = false" />
        <Button label="Delete" severity="danger" @click="removeConfirmed" />
      </div>
    </template>
  </Dialog>

  <!-- tags modal -->
  <SearchTermTags v-model:visible="tagsVisible" :term-id="term.id" />
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
delete relativeTime.$i

import Card from 'primevue/card'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import Dialog from 'primevue/dialog'
import Tag from 'primevue/tag'

import { useSearchTerms } from '@/stores/searchTerms'
import { useSearchTags } from '@/stores/searchTags'
import SearchTermTags from '@/components/SearchTermTags.vue'

dayjs.extend(relativeTime, {
  rounding: Math.floor,
  thresholds: [
    { l: 's', r: 44 },
    { l: 'm', r: 89 },
    { l: 'mm', r: 44, d: 'minute' },
    { l: 'h', r: 89, d: 'minute' },
    { l: 'hh', r: 23, d: 'hour' },
    { l: 'd', r: 48, d: 'hour' },
    { l: 'dd', r: 25, d: 'day' },
    { l: 'M', r: 45, d: 'day' },
    { l: 'MM', r: 10, d: 'month' },
    { l: 'y', r: 17, d: 'month' },
    { l: 'yy', d: 'year' },
  ],
})

const props = defineProps({
  term: {
    type: Object,
    required: true,
  },
})

const store = useSearchTerms()
const tagsStore = useSearchTags()

onMounted(async () => {
  if (!tagsStore.tagsByJob[props.term.id]) {
    await tagsStore.fetchTags(props.term.id)
  }
})

const confirmVisible = ref(false)
const tagsVisible = ref(false)
const footerVisible = ref(false)

function toggleFooter() {
  footerVisible.value = !footerVisible.value
}

const lastChangedHuman = computed(() =>
  props.term.lastChanged ? dayjs(props.term.lastChanged).fromNow() : 'never',
)

const includeText = computed(() =>
  props.term.include?.length ? props.term.include.join(', ') : '',
)
const excludeText = computed(() =>
  props.term.exclude?.length ? props.term.exclude.join(', ') : '',
)
const includeClass = computed(() =>
  props.term.include?.length ? 'text-green-600 font-large' : 'text-color-secondary',
)
const excludeClass = computed(() =>
  props.term.exclude?.length ? 'text-red-600 font-medium' : 'text-color-secondary',
)

const formattedCurrent = computed(() =>
  props.term.currentPrice == null ? '--.--' : `€${props.term.currentPrice.toFixed(2)}`,
)
const formattedLowest = computed(() =>
  props.term.lowestPrice == null ? '--.--' : `€${props.term.lowestPrice.toFixed(2)}`,
)

const deal = computed(() =>
  props.term.currentPrice === props.term.lowestPrice
    ? 'font-bold text-4xl text-primary'
    : 'font-bold text-4xl',
)

const offersCurrent = computed(() =>
  props.term.offersCurrent == null ? '0' : props.term.offersCurrent,
)
const offersTotal = computed(() => (props.term.offersTotal == null ? '0' : props.term.offersTotal))

const tagsList = computed(() => {
  const list = [...(props.term.tags || [])]
  if (props.term.primeOnly) list.unshift('Exclude Zooms')
  if (props.term.lensOnly) list.unshift('Exclude Bodies')
  if (props.term.excludeAcc) list.unshift('Exclude Accessories')
  return list
})

// map the condition string to PrimeVue Tag severities
const severityMap = {
  Neu: 'success',
  'Sehr Gut': 'info',
  Gut: 'warn',
  'In Ordnung': 'danger',
  Defekt: 'contrast',
  NULL: 'primary',
}
const conditionSeverity = computed(() => severityMap[props.term.condition] || 'primary')

function removeConfirmed() {
  if (props.term.id) store.removeTerm(props.term.id)
  confirmVisible.value = false
}

const hasItemUrl = computed(() => !!props.term.link)
</script>

<style scoped>
:deep(.p-card-footer) {
  padding-top: 0rem;
}
.p-button.p-button-icon-only.p-button-rounded {
  width: 2.5rem;
  height: 2.5rem;
}
.p-button.p-button-icon-only.p-button-rounded.flex-shrink-0 {
  width: 2.5rem !important;
  height: 2.5rem !important;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

:deep(.p-card-content) {
  padding-bottom: 0 !important;
}

:deep(.p-card-body) {
  padding-top: 0.5rem;
  padding-bottom: 0 !important;
  margin-bottom: -1rem;
}

.footer-expanded :deep(.p-card-body) {
  padding-top: 0.5rem;
  padding-bottom: 1 !important;
  margin-bottom: 1rem !important;
}

.condi {
  margin-bottom: -0.66rem;
}

.margin-top {
  margin-top: -0.5rem;
}
</style>
