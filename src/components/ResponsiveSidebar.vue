<template>
  <!-- ───── top bar / header ───── -->
  <header class="app-header">
    <Button
      v-if="isMobile"
      icon="pi pi-bars"
      class="p-button-text p-button-lg hamburger-btn"
      aria-label="Open navigation"
      @click="mobileVisible = true"
    />
    <slot name="header" />
  </header>

  <div class="app-shell">
    <!-- ───── desktop fixed sidebar (card style) ───── -->
    <aside class="sidebar-wrapper desktop-only">
      <SidebarContent @file-selected="$emit('file-selected', $event)" />
    </aside>

    <!-- ───── mobile slide-in (plain style) ───── -->
    <Sidebar
      v-model:visible="mobileVisible"
      position="left"
      class="mobile-only"
      :dismissable="true"
      :modal="true"
      :showCloseIcon="false"
    >
      <SidebarContent
        variant="plain"
        @file-selected="
          (id) => {
            mobileVisible = false
            $emit('file-selected', id)
          }
        "
      />
    </Sidebar>

    <!-- ───── main area ───── -->
    <main class="flex-1">
      <slot />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Sidebar from 'primevue/sidebar'
import Button from 'primevue/button'
import SidebarContent from './SidebarContent.vue'

defineEmits(['file-selected'])

/* responsive media query */
const mq = window.matchMedia('(max-width: 767px)')
const isMobile = ref(mq.matches)
const update = () => {
  isMobile.value = mq.matches
}
onMounted(() => mq.addEventListener('change', update))
onUnmounted(() => mq.removeEventListener('change', update))

const mobileVisible = ref(false)
</script>

<style scoped>
/* layout shell */
.app-shell {
  display: flex;
  height: calc(100vh - 3rem);
}
.sidebar-wrapper {
  width: 18rem;
  flex-shrink: 0;
}

/* header line */
.app-header {
  height: 3rem;
  display: flex;
  align-items: center;
  padding: 0 1rem;
  gap: 0.5rem;
  background: var(--surface-0);
  border-bottom: 1px solid var(--surface-border);
}

/* hide / show depending on breakpoint */
@media (max-width: 767px) {
  .desktop-only {
    display: none !important;
  }
}
@media (min-width: 768px) {
  .mobile-only,
  .hamburger-btn {
    display: none !important;
  }
}
</style>
