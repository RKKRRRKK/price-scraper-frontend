<template>
  <!-- Spinner while we're waiting for auth.init() -->
  <div
    v-if="!ready"
    class="flex items-center justify-center h-screen bg-gray-100"
  >
    <i class="pi pi-spin pi-spinner text-4xl"></i>
  </div>

  <!-- Once ready… -->
  <div v-else>
    <!-- Pure login screen (no extra wrappers) -->
    <div
      v-if="route.name === 'login'"
      class="surface-ground flex items-center justify-center min-h-screen"
    >
      <RouterView />
    </div>

    <!-- Protected area with Menubar -->
    <div
      v-else
      class="surface-ground min-h-screen flex flex-column"
    >
      <Menubar
        :model="navItems"
        class="border-none shadow-2 surface-card mb-3"
        style="padding-inline: 1rem"
      >
        <!-- main links -->
        <template #item="{ item, props }">
          <router-link
            v-if="item.to"
            v-slot="{ href, navigate }"
            :to="item.to"
            custom
          >
            <a
              v-ripple
              :href="href"
              v-bind="props.action"
              @click="navigate"
            >
              <i :class="item.icon" class="mr-2" />
              {{ item.label }}
            </a>
          </router-link>
        </template>

        <!-- login / user dropdown -->
        <template #end>
          <div class="flex align-items-center">
            <Button
              v-if="!auth.user"
              icon="pi pi-user"
              class="p-button-text"
              @click="goLogin"
            />
            <div v-else class="relative">
              <Button
                icon="pi pi-user"
                class="p-button-text"
                @click="userMenu.toggle($event)"
              />
              <TieredMenu ref="userMenu" :model="userItems" popup />
            </div>
          </div>
        </template>
      </Menubar>

      <!-- main content -->
      <main class="flex-1 overflow-auto">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import Menubar from 'primevue/menubar'
import Button from 'primevue/button'
import TieredMenu from 'primevue/tieredmenu'

import { useAuthStore } from '@/stores/auth'
import { useSearchTags } from '@/stores/searchTags'
import { useSearchTerms } from '@/stores/searchTerms'

// -- 1) Setup and await auth.init()
const auth = useAuthStore()
const ready = ref(false)
const router = useRouter()
const route = useRoute()

onMounted(async () => {
  await auth.init()

  // if no user and not already on login page, bounce to login
  if (!auth.user && route.name !== 'login') {
    router.replace({ name: 'login' })
  }

  ready.value = true
})

// -- 2) When auth.user appears, fetch your data and redirect off /login
watch(
  () => auth.user,
  async (user) => {
    if (user) {
      // redirect to home if we came from login
      if (route.name === 'login') {
        router.replace({ name: 'home' })
      }
      // fetch your stores
      const tagsStore = useSearchTags()
      const termsStore = useSearchTerms()
      await tagsStore.fetchTags()
      await termsStore.fetchAll()
      termsStore.initRealtime()
    }
  }
)

// -- 3) Navigation items
const navItems = [
  { label: 'Home',      icon: 'pi pi-home',      to: { name: 'home' } },
  { label: 'Dashboard', icon: 'pi pi-chart-bar', to: { name: 'dashboard' } }
]

// -- 4) User dropdown + helpers
const userMenu = ref(null)
const userItems = [
  {
    label: 'Settings',
    icon: 'pi pi-cog',
    command: () => router.push({ name: 'settings' })
  },
  {
    label: 'Log out',
    icon: 'pi pi-sign-out',
    async command() {
      await auth.logout()
      router.replace({ name: 'login' })
    }
  }
]
function goLogin() {
  router.replace({ name: 'login' })
}
</script>
<style scoped>
#app {
  width: 100ww;
  height: 100vh;
  max-width: none;
  margin: 0;
  padding: 0;
}

@media (min-width: 1024px) {
  body {
    display: block !important;
    place-items: initial !important;
  }
}

@media (min-width: 1024px) {
  #app {
    display: block !important;
    grid-template-columns: none !important;
  }
}
</style>