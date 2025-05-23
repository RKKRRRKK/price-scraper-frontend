<template>
  <Card
    :class="[
      'surface-card border-round-xl',
      { 'shadow-2': !isDeal },
      { 'footer-expanded': footerVisible, 'rotating-border': isDeal },
    ]"
  >
    <!-- ─── title ────────────────────────────────────────────────────────── -->
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

          <span class="font-bold text-sm xxl:text-base line-height-2" :title="term.term">
            {{ term.term }}
            <Tag
              v-if="term.condition"
              :value="term.condition"
              :severity="conditionSeverity"
              class="ml-1"
            />
            <span class="text-sm xxl:text-base text-color-secondary ml-4">
              (job added: {{ lastChangedHuman }})
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

    <!-- ─── content ──────────────────────────────────────────────────────── -->
    <template #content>
      <div class="mb-3 flex flex-wrap justify-content-between align-items-start">
        <!-- Prices + Age -->
        <div class="flex gap-3 xxl:gap-6 text-center mb-4 md:mb-0 text-500">
          <div>
            <div class="text-sm xxl:text-base text-color-secondary mb-1">Current Low</div>
            <div :class="deal">{{ formattedCurrent }}</div>
          </div>
          <div>
            <div class="text-sm xxl:text-base text-color-secondary mb-1">All-Time Low</div>
            <div class="font-bold text-base xxl:text-xl">{{ formattedLowest }}</div>
          </div>
          <div>
            <div class="text-sm xxl:text-base text-color-secondary mb-1">Age</div>
            <div class="font-bold text-base xxl:text-xl">{{ formattedAge }}d</div>
          </div>
        </div>

        <!-- Divider + Offers -->
        <div
          class="flex gap-3 xxl:gap-6 text-center w-full md:w-auto md:pl-4 md:border-left-2 surface-border text-300"
        >
          <div>
            <div class="text-sm xxl:text-base text-color-secondary mb-1 text-primary">Active</div>
            <div class="font-bold text-base xxl:text-lg text-secondary text-500">
              {{ offersCurrent }}
            </div>
          </div>
          <div>
            <div class="text-sm xxl:text-base text-color-secondary mb-1">Total</div>
            <div class="font-bold text-base xxl:text-lg">{{ offersTotal }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- ─── footer ───────────────────────────────────────────────────────── -->
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
              class="text-sm xxl:text-base font-medium hover:underline  text-orange-500"
            >
              View item <i class="pi pi-external-link ml-1" style="font-size: 1rem" />
            </a>
            <span v-else class="text-xs xxl:text-sm text-color-secondary italic">
              (No item link available)
            </span>

            <div class="flex flex-col gap-5 text-xs xxl:text-sm">
              <span :class="includeClass">{{ includeText }}</span>
              <span :class="excludeClass">{{ excludeText }}</span>
            </div>
            <div class="flex justify-content-between align-items-center w-full">
              <!-- tags display -->
              <div>
                <template v-if="tagsList.length">
                  <Tag
                    v-for="tag in tagsList"
                    :key="tag"
                    :value="tag"
                    :severity="tagSeverity(tag)"
                    class="mr-2 text-xs xxl:text-sm"
                  />
                </template>
              </div>

              <!-- Adjust Tags button -->
              <Button
                label="Adjust Search Tags"
                icon="pi pi-tags"
                text
                class="text-sm xxl:text-base"
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
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Divider from 'primevue/divider'
import Dialog from 'primevue/dialog'
import Tag from 'primevue/tag'
import { useSearchTerms } from '@/stores/searchTerms'
import { useSearchTags } from '@/stores/searchTags'
import SearchTermTags from '@/components/SearchTermTags.vue'

dayjs.extend(relativeTime, { rounding: Math.floor })

const props = defineProps({
  term: { type: Object, required: true },
})

const store = useSearchTerms()
const tagsStore = useSearchTags()
const confirmVisible = ref(false)
const tagsVisible = ref(false)
const footerVisible = ref(false)

function toggleFooter() {
  footerVisible.value = !footerVisible.value
}

//rewriting logic to job added
const lastChangedHuman = computed(() =>
  props.term.created_at ? dayjs(props.term.created_at).fromNow() : 'idk lol',
)

const includeText = computed(() => props.term.include?.join(', ') || '')
const excludeText = computed(() => props.term.exclude?.join(', ') || '')

const includeClass = computed(() =>
  props.term.include?.length
    ? 'text-green-600 text-xs xxl:text-sm'
    : 'text-color-secondary text-xs xxl:text-sm',
)

const excludeClass = computed(() =>
  props.term.exclude?.length
    ? 'text-red-600 text-xs xxl:text-sm'
    : 'text-color-secondary text-xs xxl:text-sm',
)

const formattedCurrent = computed(() =>
  props.term.currentPrice == null ? '--.--' : `€${props.term.currentPrice.toFixed(2)}`,
)

const formattedLowest = computed(() =>
  props.term.alltime_lowest == null ? '--.--' : `€${props.term.alltime_lowest.toFixed(2)}`,
)

const formattedAge = computed(() => props.term.ageInDays ?? '--')

const deal = computed(() =>
  props.term.currentPrice === props.term.alltime_lowest &&
  props.term.ageInDays < 7 &&
  props.term.currentPrice !== null
    ? 'font-bold text-base xxl:text-xl text-primary'
    : 'font-bold text-base xxl:text-xl',
)

const offersCurrent = computed(() => props.term.offersCurrent ?? '0')
const offersTotal = computed(() => props.term.offersTotal ?? '0')

const tagsList = computed(() => {
  const list = [...(props.term.tags || [])]
  if (props.term.primeOnly) list.unshift('Exclude Zooms')
  if (props.term.lensOnly) list.unshift('Exclude Bodies')
  if (props.term.excludeAcc) list.unshift('Exclude Accessories')
  if (props.term.smart_filter) list.unshift('Smart Filter')
  return list
})

const tagSeverity = (tag) => (tag === 'Smart Filter' ? 'primary' : 'secondary')

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

// only add rotating border class when it's a deal
const isDeal = computed(
  () =>
    props.term.currentPrice === props.term.alltime_lowest &&
    props.term.ageInDays < 7 &&
    props.term.currentPrice !== null,
)
</script>

<style scoped lang="scss">
:deep(.p-card-footer) {
  padding-top: 0;
}
.p-button.p-button-icon-only {
  width: 2.5rem;
  height: 2.5rem;
}
.p-button.p-button-icon-only.flex-shrink-0 {
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
  margin-bottom: 1rem !important;
}

.condi {
  margin-bottom: -0.66rem;
}
.margin-top {
  margin-top: -0.5rem;
}

/* ─── rotating‐border + float animation ───────────────────────────────── */

@property --bg-angle {
  inherits: false;
  initial-value: 0deg;
  syntax: '<angle>';
}

/* spin the angle from 0 to 360 */
@keyframes spin {
  to {
    --bg-angle: 360deg;
  }
}

/* float up/down + tweak shadow */
@keyframes float {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.1),
      0 1px 2px rgba(0, 0, 0, 0.06);
  }
  50% {
    transform: translate3d(0, -8px, 0);
    scale: 1.01;
    box-shadow:
      0 12px 16px rgba(0, 0, 0, 0.2),
      0 6px 8px rgba(0, 0, 0, 0.1);
  }
}

/* this is the only scoped-looking rule—PrimeVue will scope it for you */
.rotating-border {
  border: 4px solid transparent;
  border-radius: 2rem; /* match border-round-xl */
  will-change: transform, box-shadow;
  animation:
    spin 3s linear infinite,
    float 3.5s ease-in-out infinite;

  /* two-layer bg: white padding-box + spinning rainbow border-box */
  background:
    linear-gradient(to bottom, rgba(255, 255, 255, 1), rgba(255, 255, 255, 1)) padding-box,
    conic-gradient(
        from var(--bg-angle) in oklch longer hue,
        oklch(0.85 0.37 0 / 0.25) 0deg,
        oklch(0.85 0.37 120deg / 0.25) 120deg,
        oklch(0.85 0.37 240deg / 0.25) 240deg,
        oklch(0.85 0.37 360deg / 0.25) 360deg
      )
      border-box;
}
</style>
