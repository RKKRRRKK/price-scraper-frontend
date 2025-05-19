<script setup>
import { computed } from 'vue'
import ResponsiveSidebar from '@/components/ResponsiveSidebar.vue'
import TheWelcome from '@/components/TheWelcome.vue'
import SearchTermSection from '@/components/SearchTermSection.vue'
import { useSidebarStore } from '@/stores/sidebar'

/* ───────── store & derived state ───────── */
const sidebarStore = useSidebarStore()
const selectedFile = computed(() => sidebarStore.selectedFile?.fileId ?? null)

/* ───────── callbacks ───────── */
function onFileSelected(fileId) {
  const folder = sidebarStore.folders.find((f) => f.files.some((file) => file.id === fileId))
  if (folder) {
    sidebarStore.selectFile(folder.id, fileId)
  } else {
    console.warn(`Folder not found for fileId: ${fileId}`)
  }
}
</script>

<template>
  <ResponsiveSidebar @file-selected="onFileSelected">
    <TheWelcome v-if="selectedFile === null" class="welcome" />
    <div v-else class="sections">
      <SearchTermSection
        marketplace="kleinanzeigen"
        title="Kleinanzeigen.de"
        :fileId="selectedFile"
      />
      <SearchTermSection marketplace="bazos" title="Bazos.sk" :fileId="selectedFile" />
    </div>
  </ResponsiveSidebar>
</template>

<style scoped>
/* header text in the bar */
.app-title {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1;
  user-select: none;
}

/* main-area grids (copied from your old file) */
.sections {
  display: grid;
  gap: 1rem;
  justify-content: center;
  transform: scale(0.85);
  transform-origin: top center;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}

.welcome {
  font-size: 1.5rem;
  width: 65vw;
  height: 65vh;
}

/* breakpoints unchanged */
@media (min-width: 768px) {
  .sections {
    grid-template-columns: repeat(2, minmax(300px, 1fr));
    gap: 10rem;
    margin: 5rem;
    margin-top: 1rem;
    transform: scale(0.9);
  }
}
</style>
