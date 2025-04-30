<template>
  <!-- 1) Loading screen while auth.init() is running -->
  <div
    v-if="!auth.initialized"
    class="flex items-center justify-center h-screen w-screen bg-gray-100"
  >
    <i class="pi pi-spin pi-spinner text-4xl"></i>
  </div>

  <!-- 2) Main app once auth.initialized is true -->
  <div
    v-else
    class="surface-ground min-h-screen flex flex-column"
  >
    <Menubar
      v-if="route.path !== '/login'"
      :model="items"
      class="border-none shadow-2 surface-card mb-3"
      style="padding-inline: 1rem"
    >
      <!-- Primary nav items -->
      <template #item="{ item, props }">
        <router-link
          v-if="item.route"
          v-slot="{ href, navigate }"
          :to="item.route"
          custom
        >
          <a
            v-ripple
            :href="href"
            v-bind="props.action"
            @click="navigate"
          >
            <i :class="item.icon" class="mr-2" />
            <span>{{ item.label }}</span>
          </a>
        </router-link>
      </template>

      <!-- Login / User menu -->
      <template #end>
        <div class="flex align-items-center">
          <!-- not logged in -->
          <Button
            v-if="!auth.user"
            icon="pi pi-user"
            class="p-button-text"
            @click="router.replace({ name: 'login' })"
          />

          <!-- logged in -->
          <div v-else class="relative">
            <Button
              icon="pi pi-user"
              class="p-button-text"
              @click="userMenu.toggle($event)"
            />
            <TieredMenu
              ref="userMenu"
              :model="userItems"
              popup
            />
          </div>
        </div>
      </template>
    </Menubar>

    <main
      :class="[ 'flex-1', route.path === '/login' ? 'flex items-center justify-center' : '' ]"
    >
      <RouterView />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import Menubar from 'primevue/menubar'
import Button from 'primevue/button'
import TieredMenu from 'primevue/tieredmenu'

import { useAuthStore } from '@/stores/auth'
import { useSearchTerms } from '@/stores/searchTerms'
import { useSearchTags } from '@/stores/searchTags'

// 1) Initialize auth store (no await here)
const auth = useAuthStore()
auth.init()

const router = useRouter()
const route = useRoute()

// 2) User dropdown menu
const userMenu = ref(null)
const userItems = [
  {
    label: 'Settings',
    icon: 'pi pi-cog',
    command: () => router.push({ name: 'Settings' })
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

// 3) Top-nav items
const items = [
  { label: 'Home',      icon: 'pi pi-home',      route: '/' },
  { label: 'Dashboard', icon: 'pi pi-chart-bar', route: '/dashboard' }
]

// 4) Fetch your stores once the component is mounted
onMounted(async () => {
  const tagsStore = useSearchTags()
  const termsStore = useSearchTerms()

  await tagsStore.fetchTags()
  await termsStore.fetchAll()
  termsStore.initRealtime()
})
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