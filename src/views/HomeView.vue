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
    <SearchTermSection
      v-else
      marketplace="kleinanzeigen"
      title="Kleinanzeigen.de"
      :fileId="selectedFile"
    />
  </ResponsiveSidebar>
</template>

<style scoped>
.welcome {
  font-size: 1.5rem;
  width: 65vw;
  height: 65vh;
  margin: 0 auto;
}
</style>
