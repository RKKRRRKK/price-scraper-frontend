<template>
  <div class="app-shell">
    <!-- ───── desktop fixed sidebar ───── -->
    <aside class="sidebar-wrapper desktop-only">
      <SidebarContent @file-selected="$emit('file-selected', $event)" />
    </aside>

    <!-- ───── mobile slide-in drawer ───── -->
    <Sidebar
      v-model:visible="mobileVisible"
      position="left"
      class="scraper-drawer mobile-only"
      :dismissable="true"
      :modal="true"
      :showCloseIcon="false"
    >
      <SidebarContent
        variant="plain"
        @close="mobileVisible = false"
        @file-selected="
          (id) => {
            mobileVisible = false
            $emit('file-selected', id)
          }
        "
      />
    </Sidebar>

    <!-- ───── main area ───── -->
    <main class="shell-main">
      <slot />
    </main>
  </div>
</template>

<script setup>
import { ref, provide } from 'vue'
import Sidebar from 'primevue/sidebar'
import SidebarContent from './SidebarContent.vue'

defineEmits(['file-selected'])

const mobileVisible = ref(false)

/* let descendants (the section header ☰ button) open the drawer */
provide('openMobileSidebar', () => {
  mobileVisible.value = true
})
</script>

<style scoped>
.app-shell {
  display: flex;
  min-height: calc(100vh - 4rem);
  background: linear-gradient(180deg, #f8f1e7, #f5ede1);
  font-family: 'Outfit', system-ui, sans-serif;
}
.sidebar-wrapper {
  width: 248px;
  flex-shrink: 0;
}
.shell-main {
  flex: 1;
  min-width: 0;
}

/* hide / show depending on breakpoint */
@media (max-width: 767px) {
  .desktop-only {
    display: none !important;
  }
}
@media (min-width: 768px) {
  .mobile-only {
    display: none !important;
  }
}
</style>

<!-- Drawer chrome is teleported to <body>, so it must be styled unscoped -->
<style>
.scraper-drawer.p-sidebar {
  width: 300px !important;
  background: #fffdf9;
  border-radius: 0 20px 20px 0;
  box-shadow: 8px 0 30px rgba(61, 50, 38, 0.3);
}
.scraper-drawer .p-sidebar-header {
  display: none;
}
.scraper-drawer .p-sidebar-content {
  padding: 0;
}
.p-sidebar-mask:has(.scraper-drawer) {
  background: rgba(61, 50, 38, 0.35);
}
</style>
