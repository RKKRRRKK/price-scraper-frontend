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

/* main-area grids. auto-fit + min() means the two marketplace columns pair up
   as soon as there is room for both and fall back to one column when there
   isn't, instead of being forced side by side from 768px up and overflowing;
   the gutters and page margins shrink with the viewport rather than staying
   at their full 10rem/5rem. */
.sections {
  display: grid;
  gap: clamp(1rem, 6vw, 10rem);
  justify-content: center;
  transform: scale(0.9);
  transform-origin: top center;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18.75rem), 1fr));
  margin: clamp(0.5rem, 3.5vw, 5rem);
  margin-top: 1rem;
}

.welcome {
  font-size: 1.5rem;
  width: 100%;
  height: 65vh;
}
</style>
