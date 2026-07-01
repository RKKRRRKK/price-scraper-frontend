<!-- File: src/components/SearchTermSection.vue -->
<script setup>
import { ref, computed, inject, onMounted } from 'vue'
import SearchTermModal from './SearchTermModal.vue'
import SearchTermCard from './SearchTermCard.vue'
import ConfigureAlerts from './section_buttons/ConfigureAlerts.vue'
import { useSearchTerms } from '@/stores/searchTerms'
import { useSearchTags } from '@/stores/searchTags'
import { useSidebarStore } from '@/stores/sidebar'
import { useIsMobile } from '@/composables/useIsMobile'
import Chips from 'primevue/chips'

const props = defineProps({
  marketplace: { type: String, default: 'kleinanzeigen' },
  title: { type: String, default: 'Kleinanzeigen.de' },
  fileId: { type: Number, required: true },
})

const store = useSearchTerms()
const tagsStore = useSearchTags()
const sidebarStore = useSidebarStore()
const isMobile = useIsMobile()
const openMobileSidebar = inject('openMobileSidebar', () => {})

onMounted(() => {
  tagsStore.fetchTags()
})

const termsForFile = computed(() => store.termsByMarketplace(props.fileId, props.marketplace))

const filterTags = ref([])

const filteredTerms = computed(() => {
  const list =
    filterTags.value.length === 0
      ? [...termsForFile.value]
      : termsForFile.value.filter((term) => {
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

/* subline: "7 scrape jobs · Electronics / PC parts" */
const jobCount = computed(() => termsForFile.value.length)
const folderPath = computed(() => {
  const sel = sidebarStore.selectedFile
  if (!sel) return ''
  const folder = sidebarStore.folders.find((f) => f.id === sel.folderId)
  if (!folder) return ''
  const file = folder.files.find((f) => f.id === sel.fileId)
  return file ? `${folder.name} / ${file.name}` : folder.name
})
const subline = computed(() => {
  const jobs = `${jobCount.value} scrape job${jobCount.value === 1 ? '' : 's'}`
  return folderPath.value ? `${jobs} · ${folderPath.value}` : jobs
})

const showModal = ref(false)
const showAlerts = ref(false)
</script>

<template>
  <section class="scraper-home">
    <div class="home-inner">
      <!-- ───── command bar ───── -->
      <div class="cmd-bar">
        <button
          v-if="isMobile"
          class="icon-btn menu-btn"
          aria-label="Open folders"
          @click="openMobileSidebar"
        >
          ☰
        </button>

        <div class="title-block">
          <h1 class="page-title">{{ title }}</h1>
          <div class="page-sub">{{ subline }}</div>
        </div>

        <Chips
          v-if="!isMobile"
          v-model="filterTags"
          placeholder="Filter by tags…"
          class="tag-filter"
        />

        <button class="ghost-btn" @click="showAlerts = true">Alerts</button>
        <button v-if="!isMobile" class="primary-btn" @click="showModal = true">+ New job</button>
      </div>

      <!-- mobile: full-width tag filter -->
      <Chips
        v-if="isMobile"
        v-model="filterTags"
        placeholder="Filter by tags…"
        class="tag-filter tag-filter-mobile"
      />

      <!-- ───── column header (desktop) ───── -->
      <div v-if="!isMobile && filteredTerms.length" class="col-header">
        <span></span>
        <span>Job</span>
        <span class="r">Current</span>
        <span class="r">All-time</span>
        <span class="r">Age</span>
        <span class="r">Active / Total</span>
        <span></span>
      </div>

      <!-- ───── job list ───── -->
      <div class="job-list">
        <template v-if="filteredTerms.length > 0">
          <SearchTermCard
            v-for="t in filteredTerms"
            :key="t.id"
            :term="t"
            :is-mobile="isMobile"
          />
        </template>
        <div v-else class="empty-state">
          {{
            filterTags.length
              ? 'No scrape jobs match those tags.'
              : 'No scrape jobs yet — add one with “+ New job”.'
          }}
        </div>
      </div>
    </div>

    <!-- ───── mobile FAB ───── -->
    <button
      v-if="isMobile"
      class="fab"
      aria-label="Add scrape job"
      @click="showModal = true"
    >
      +
    </button>

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
      @update:show="(val) => (showAlerts = val)"
    />
  </section>
</template>

<style scoped>
.scraper-home {
  position: relative;
  display: flex;
  justify-content: center;
  padding: 28px 32px;
  min-height: calc(100vh - 4rem);
}
.home-inner {
  width: 100%;
  max-width: 820px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ───── command bar ───── */
.cmd-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.title-block {
  flex: 1;
  min-width: 0;
}
.page-title {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 800;
  color: #3d3226;
  letter-spacing: -0.01em;
}
.page-sub {
  font-size: 0.8125rem;
  color: #a8926f;
  margin-top: 2px;
}

/* buttons */
.ghost-btn {
  border: 1px solid #eadfcf;
  background: #fffdf9;
  color: #8a7a64;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  border-radius: 10px;
  padding: 9px 14px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  flex-shrink: 0;
}
.ghost-btn:hover {
  border-color: #c2540a;
  color: #c2540a;
}
.primary-btn {
  border: none;
  background: #ea6c0a;
  color: #fff;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  border-radius: 10px;
  padding: 9px 16px;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(234, 108, 10, 0.35);
  transition: background-color 0.15s;
  flex-shrink: 0;
}
.primary-btn:hover {
  background: #c2540a;
}
.icon-btn {
  border: 1px solid #eadfcf;
  background: #fffdf9;
  color: #8a7a64;
  font-family: inherit;
  font-size: 0.9375rem;
  border-radius: 10px;
  padding: 9px 12px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

/* ───── tag filter (restyled Chips) ───── */
.tag-filter {
  width: 180px;
  flex-shrink: 0;
}
.tag-filter-mobile {
  width: 100%;
}
.tag-filter :deep(.p-chips),
.tag-filter :deep(.p-chips-multiple-container) {
  width: 100%;
}
.tag-filter :deep(.p-chips-multiple-container) {
  border: 1px solid #eadfcf;
  border-radius: 10px;
  padding: 5px 8px;
  background: #fffdf9;
  font-size: 0.8125rem;
  min-height: 38px;
}
.tag-filter :deep(.p-chips-multiple-container:hover) {
  border-color: #dcc9ab;
}
.tag-filter :deep(.p-chips-token) {
  background: #ffe8d2;
  color: #b3520e;
  border-radius: 8px;
  font-size: 0.75rem;
  font-weight: 600;
}
.tag-filter :deep(input) {
  color: #5a4a35;
  font-family: inherit;
}

/* ───── column header ───── */
.col-header {
  display: grid;
  grid-template-columns: 24px 1fr 110px 110px 60px 90px 30px;
  gap: 10px;
  padding: 0 16px;
  font-size: 0.65625rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #c9a877;
}
.col-header .r {
  text-align: right;
}

/* ───── list ───── */
.job-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.empty-state {
  text-align: center;
  color: #a8926f;
  background: #fffdf9;
  border: 1px dashed #e2b98f;
  border-radius: 12px;
  padding: 28px 16px;
  font-size: 0.875rem;
}

/* ───── mobile FAB ───── */
.fab {
  position: fixed;
  bottom: 22px;
  right: 18px;
  width: 56px;
  height: 56px;
  border: none;
  border-radius: 99px;
  background: #ea6c0a;
  color: #fff;
  font-size: 1.625rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(234, 108, 10, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

@media (max-width: 767px) {
  .scraper-home {
    padding: 18px 16px 90px;
  }
}
</style>
