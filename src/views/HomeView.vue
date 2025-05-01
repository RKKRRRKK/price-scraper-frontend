<script setup>
import { computed } from 'vue' // Removed onMounted if only used for fetching
import SidebarNavigation from '@/components/SidebarNavigation.vue'
import TheWelcome         from '@/components/TheWelcome.vue'
import SearchTermSection  from '@/components/SearchTermSection.vue'
import { useSidebarStore } from '@/stores/sidebar'
// Removed unused store imports if they were only for fetching
// import { useSearchTerms }  from '@/stores/searchTerms'
// import { useSearchTags }   from '@/stores/searchTags'

const sidebarStore = useSidebarStore()
// const searchStore  = useSearchTerms() // Only needed if directly used in template/logic below
// const tagsStore    = useSearchTags()  // Only needed if directly used in template/logic below

// derive the selected file ID from the persisted store state
const selectedFile = computed(() => sidebarStore.selectedFile?.fileId ?? null)

// REMOVED onMounted hook that was fetching data

// when a file is clicked in the sidebar, record it in the store
function onFileSelected(fileId) {
  // find which folder contains this file
  const folder = sidebarStore.folders.find(f =>
    f.files.some(file => file.id === fileId)
  )
  if (folder) {
    sidebarStore.selectFile(folder.id, fileId)
  } else {
    console.warn(`Folder not found for fileId: ${fileId}`);
    // Handle case where file might be orphaned or data is inconsistent
  }
}
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <SidebarNavigation @file-selected="onFileSelected" />
    </aside>
    <main class="main-content">
      <!-- show welcome if no file selected -->
      <TheWelcome  class='welcome' v-if="selectedFile === null" />

      <!-- otherwise render each marketplace section scoped to that file -->
      <div v-else class="sections">
        <SearchTermSection
          marketplace="kleinanzeigen"
          title="Kleinanzeigen.de"
          :fileId="selectedFile"
        />
        <SearchTermSection
          marketplace="bazos"
          title="Bazos.sk"
          :fileId="selectedFile"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.layout { display: flex; }
.sidebar { 
  min-width: 11vw;
  margin-left: 1.25rem;
  margin-top: 1.25rem;




}
.sections {
  display: grid;
  gap: 1rem; /* space between cards */
  justify-content: center; /* this does the horizontal centring */
  grid-template-columns: 1fr; /* mobile default */
  transform-origin: top center;
  transform: scale(0.8);
  grid-template-columns: repeat(auto-fill, minmax(300px,1fr));
  gap: 1rem;
}


.welcome {
  font-size: 1.5rem;
}

 

@media (min-width: 768px) {
  .sections {
    grid-template-columns: repeat(2, minmax(300px, 1fr));
    gap: 10rem;
    margin: 5rem;
    margin-top: 1rem;
  }
}
</style>
