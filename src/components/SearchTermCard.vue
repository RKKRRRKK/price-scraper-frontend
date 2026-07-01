<template>
  <!-- ═══════════════ DESKTOP: dense grid row ═══════════════ -->
  <div
    v-if="!isMobile"
    class="job-row"
    :class="{ 'deal-border': isDeal, expanded: footerVisible }"
  >
    <div class="row-grid">
      <button
        class="chev"
        :class="{ open: footerVisible }"
        aria-label="Toggle details"
        @click="toggleFooter"
      >
        {{ footerVisible ? '▴' : '▾' }}
      </button>

      <span class="term-cell">
        <span class="term-text" :title="term.term">{{ term.term }}</span>
        <span v-if="term.condition" class="cond" :style="condStyle">{{ term.condition }}</span>
      </span>

      <span class="cell price-current" :class="{ deal: isDeal }">{{ formattedCurrent }}</span>
      <span class="cell muted">{{ formattedLowest }}</span>
      <span class="cell muted">{{ formattedAge }}</span>
      <span class="cell muted">
        {{ offersCurrent }} <span class="faint">/ {{ offersTotal }}</span>
      </span>

      <span class="del" role="button" aria-label="Remove job" @click="confirmVisible = true">×</span>
    </div>

    <Transition name="slide-fade">
      <div v-show="footerVisible" class="row-footer">
        <a
          v-if="hasItemUrl"
          :href="term.link"
          target="_blank"
          rel="noopener noreferrer"
          class="view-link"
        >
          View cheapest item ↗
        </a>
        <span v-else class="no-link">(no item link available)</span>

        <div class="kw-line">
          <span v-if="includeText" class="kw-inc">includes: {{ includeText }}</span>
          <span v-if="excludeText" class="kw-exc">excludes: {{ excludeText }}</span>
        </div>

        <div class="tag-row">
          <span v-for="tag in tagsList" :key="tag" class="chip">{{ tag }}</span>
          <button class="adjust-btn" @click="tagsVisible = true">Adjust tags</button>
        </div>
      </div>
    </Transition>
  </div>

  <!-- ═══════════════ MOBILE: card ═══════════════ -->
  <div v-else class="m-card" :class="{ 'deal-border': isDeal }">
    <!-- tap anywhere on head to expand -->
    <div class="m-head" @click="toggleFooter">
      <span class="m-chev" :class="{ open: footerVisible }">{{ footerVisible ? '▴' : '▾' }}</span>
      <span class="m-term">{{ term.term }}</span>
      <span v-if="term.condition" class="cond" :style="condStyle">{{ term.condition }}</span>
      <span class="m-del" role="button" aria-label="Remove job" @click.stop="confirmVisible = true">×</span>
    </div>

    <!-- deal: 2×2 stat tiles -->
    <template v-if="isDeal">
      <div class="m-tiles">
        <div class="tile tile-current">
          <div class="tile-label">Current low</div>
          <div class="tile-val orange">{{ formattedCurrent }}</div>
        </div>
        <div class="tile">
          <div class="tile-label">All-time low</div>
          <div class="tile-val">{{ formattedLowest }}</div>
        </div>
        <div class="tile">
          <div class="tile-label">Age</div>
          <div class="tile-val">{{ formattedAge }}</div>
        </div>
        <div class="tile">
          <div class="tile-label">Active / Total</div>
          <div class="tile-val">
            {{ offersCurrent }} <span class="faint">/ {{ offersTotal }}</span>
          </div>
        </div>
      </div>
      <button v-if="hasItemUrl" class="m-view" @click="openLink">View cheapest item ↗</button>
    </template>

    <!-- normal: single stat line -->
    <div v-else class="m-line2">
      <span class="m-price">{{ formattedCurrent }}</span>
      <span class="m-meta">low {{ formattedLowest }}</span>
      <span class="m-meta">{{ formattedAge }}</span>
      <span class="m-meta right">{{ offersCurrent }} / {{ offersTotal }}</span>
    </div>

    <!-- expandable footer (same info as desktop) -->
    <Transition name="slide-fade">
      <div v-show="footerVisible" class="m-footer">
        <a
          v-if="hasItemUrl"
          :href="term.link"
          target="_blank"
          rel="noopener noreferrer"
          class="view-link"
        >
          View cheapest item ↗
        </a>
        <span v-else class="no-link">(no item link available)</span>

        <div v-if="includeText || excludeText" class="kw-line">
          <span v-if="includeText" class="kw-inc">includes: {{ includeText }}</span>
          <span v-if="excludeText" class="kw-exc">excludes: {{ excludeText }}</span>
        </div>

        <div v-if="tagsList.length" class="tag-row">
          <span v-for="tag in tagsList" :key="tag" class="chip">{{ tag }}</span>
          <button class="adjust-btn" @click.stop="tagsVisible = true">Adjust tags</button>
        </div>
        <button v-else class="adjust-btn" style="align-self:flex-end" @click.stop="tagsVisible = true">Adjust tags</button>
      </div>
    </Transition>
  </div>

  <!-- ───── delete confirmation ───── -->
  <Dialog
    v-model:visible="confirmVisible"
    header="Delete scrape job"
    modal
    class="warm-dialog"
    :style="{ width: '32rem' }"
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

  <!-- ───── tags modal ───── -->
  <SearchTermTags v-model:visible="tagsVisible" :term-id="term.id" />
</template>

<script setup>
import { ref, computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { useSearchTerms } from '@/stores/searchTerms'
import SearchTermTags from '@/components/SearchTermTags.vue'

const props = defineProps({
  term: { type: Object, required: true },
  isMobile: { type: Boolean, default: false },
})

const store = useSearchTerms()
const confirmVisible = ref(false)
const tagsVisible = ref(false)
const footerVisible = ref(false)

function toggleFooter() {
  footerVisible.value = !footerVisible.value
}
function openLink() {
  if (props.term.link) window.open(props.term.link, '_blank', 'noopener')
}

const includeText = computed(() => props.term.include?.join(', ') || '')
const excludeText = computed(() => props.term.exclude?.join(', ') || '')

const formattedCurrent = computed(() =>
  props.term.currentPrice == null ? '--.--' : `€${props.term.currentPrice.toFixed(2)}`,
)
const formattedLowest = computed(() =>
  props.term.alltime_lowest == null ? '€--.--' : `€${props.term.alltime_lowest.toFixed(2)}`,
)
const formattedAge = computed(() =>
  props.term.ageInDays == null ? '--' : `${props.term.ageInDays}d`,
)

const offersCurrent = computed(() => props.term.offersCurrent ?? '0')
const offersTotal = computed(() => props.term.offersTotal ?? '0')

const isDeal = computed(
  () =>
    props.term.currentPrice === props.term.alltime_lowest &&
    props.term.ageInDays < 7 &&
    props.term.currentPrice !== null,
)

const tagsList = computed(() => {
  const list = [...(props.term.tags || [])]
  if (props.term.primeOnly) list.unshift('Exclude Zooms')
  if (props.term.lensOnly) list.unshift('Exclude Bodies')
  if (props.term.excludeAcc) list.unshift('Exclude Accessories')
  if (props.term.smart_filter) list.unshift('Smart Filter')
  return list
})

/* condition tag colors (design tokens) */
const condColors = {
  Neu: { background: '#dcf3e4', color: '#177a41' },
  'Sehr Gut': { background: '#e2edf9', color: '#2563ab' },
  Gut: { background: '#fbeccb', color: '#9a6a00' },
  'In Ordnung': { background: '#fbe3e0', color: '#b23a30' },
  Defekt: { background: '#e8e0d4', color: '#5a4a35' },
}
const condStyle = computed(
  () => condColors[props.term.condition] || { background: '#f8f0e4', color: '#8a7a64' },
)

const hasItemUrl = computed(() => !!props.term.link)

function removeConfirmed() {
  if (props.term.id) store.removeTerm(props.term.id)
  confirmVisible.value = false
}
</script>

<style scoped>
/* ═══════════════ DESKTOP ROW ═══════════════ */
.job-row {
  background: #fffdf9;
  border: 1px solid #eadfcf;
  border-radius: 12px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.job-row:hover {
  border-color: #dcc9ab;
  box-shadow: 0 2px 8px rgba(120, 80, 30, 0.08);
}
.job-row.expanded {
  border-color: #dcc9ab;
  box-shadow: 0 4px 14px rgba(120, 80, 30, 0.1);
}

.row-grid {
  display: grid;
  grid-template-columns: 24px 1fr 110px 110px 60px 90px 30px;
  gap: 10px;
  align-items: center;
  padding: 13px 16px;
}

.chev {
  border: none;
  background: transparent;
  color: #c9a877;
  font-size: 1rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  width: 24px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chev.open {
  color: #c2540a;
}

.term-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.term-text {
  font-size: 0.875rem;
  font-weight: 700;
  color: #3d3226;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cond {
  font-size: 0.65625rem;
  font-weight: 700;
  border-radius: 5px;
  padding: 2px 7px;
  flex-shrink: 0;
  white-space: nowrap;
}

.cell {
  text-align: right;
}
.price-current {
  font-size: 0.9375rem;
  font-weight: 800;
  color: #3d3226;
}
.price-current.deal {
  color: #ea6c0a;
}
.muted {
  font-size: 0.875rem;
  font-weight: 600;
  color: #8a7a64;
}
.faint {
  color: #c4ad8a;
}

.del {
  text-align: center;
  color: #d8c8ae;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
.del:hover {
  color: #dc2626;
}

/* footer */
.row-footer {
  border-top: 1px solid #f0e4d0;
  padding: 12px 16px 14px 50px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.view-link {
  font-size: 0.78125rem;
  font-weight: 700;
  color: #ea6c0a;
  text-decoration: none;
  width: fit-content;
}
.view-link:hover {
  text-decoration: underline;
}
.no-link {
  font-size: 0.78125rem;
  color: #a8926f;
  font-style: italic;
}
.kw-line {
  display: flex;
  gap: 14px;
  font-size: 0.75rem;
  flex-wrap: wrap;
}
.kw-inc {
  color: #1a7f45;
}
.kw-exc {
  color: #c2453a;
}
.tag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.chip {
  font-size: 0.65625rem;
  font-weight: 600;
  background: #f8f0e4;
  color: #8a7a64;
  border-radius: 5px;
  padding: 2px 8px;
}
.adjust-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  color: #c4ad8a;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}
.adjust-btn:hover {
  color: #c2540a;
}

/* ═══════════════ MOBILE CARD ═══════════════ */
.m-card {
  background: #fffdf9;
  border: 1px solid #eadfcf;
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(120, 80, 30, 0.06);
}
.m-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  cursor: pointer;
  user-select: none;
}
.m-chev {
  color: #c9a877;
  font-size: 0.875rem;
  flex-shrink: 0;
}
.m-chev.open {
  color: #c2540a;
}
.m-term {
  font-size: 0.9375rem;
  font-weight: 800;
  color: #3d3226;
}
.m-del {
  color: #d8c8ae;
  font-size: 1rem;
  margin-left: auto;
  padding: 4px;
  cursor: pointer;
  line-height: 1;
}
.m-del:hover {
  color: #dc2626;
}
.m-line2 {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.m-price {
  font-size: 1.25rem;
  font-weight: 800;
  color: #3d3226;
}
.m-meta {
  font-size: 0.8125rem;
  color: #a8926f;
}
.m-meta.right {
  margin-left: auto;
}

.m-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
}
.tile {
  background: #f8f0e4;
  border-radius: 12px;
  padding: 10px 12px;
}
.tile-current {
  background: #fff4e8;
}
.tile-label {
  font-size: 0.65625rem;
  font-weight: 700;
  color: #c4ad8a;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.tile-current .tile-label {
  color: #c9a877;
}
.tile-val {
  font-size: 1.375rem;
  font-weight: 800;
  color: #3d3226;
  margin-top: 2px;
}
.tile-val.orange {
  color: #ea6c0a;
}
.m-view {
  width: 100%;
  margin-top: 12px;
  border: none;
  background: #ffe8d2;
  color: #b3520e;
  font-family: inherit;
  font-size: 0.84375rem;
  font-weight: 700;
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
}

/* mobile footer */
.m-footer {
  border-top: 1px solid #f0e4d0;
  margin-top: 12px;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ═══════════════ deal rainbow border + float ═══════════════ */
@property --bg-angle {
  inherits: false;
  initial-value: 0deg;
  syntax: '<angle>';
}
@keyframes spin {
  to {
    --bg-angle: 360deg;
  }
}
@keyframes floaty {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5px);
  }
}
.deal-border {
  border: 2.5px solid transparent;
  background:
    linear-gradient(#fffdf9, #fffdf9) padding-box,
    conic-gradient(
        from var(--bg-angle) in oklch longer hue,
        oklch(0.85 0.3 0 / 0.55) 0deg,
        oklch(0.85 0.3 120 / 0.55) 120deg,
        oklch(0.85 0.3 240 / 0.55) 240deg,
        oklch(0.85 0.3 360 / 0.55) 360deg
      )
      border-box;
  box-shadow: 0 8px 18px rgba(120, 80, 30, 0.14);
  animation:
    spin 3s linear infinite,
    floaty 3.5s ease-in-out infinite;
}
.m-card.deal-border {
  border-width: 3px;
  box-shadow: 0 6px 16px rgba(120, 80, 30, 0.13);
}

@media (prefers-reduced-motion: reduce) {
  .deal-border {
    animation: none;
  }
}

/* slide-fade for footer */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
