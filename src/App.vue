<template>
  <!-- Spinner while we're waiting for auth.init() -->
  <div v-if="!ready" class="flex items-center justify-center h-screen bg-gray-100">
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
    <div v-else class="surface-ground min-h-screen flex flex-column">
<Menubar
  :model="navItems"
  class="border-none shadow-2 surface-card mb-3"
  style="padding-inline: 1rem"
>
  <!-- main links -->
<template #item="{ item, props }">
  <router-link
    v-if="item.to"
    :to="item.to"
    custom
    v-slot="{ href, navigate, isActive, isExactActive }"
  >
    <a  :href="href"
    style="margin-top: 0.33rem;"
        @click="navigate"
        v-bind="props.action"
        :class="[
          { 'router-link-active': isActive,
            'router-link-exact-active': isExactActive }
        ]">
      <i :class="item.icon" class="mr-2" />
      {{ item.label }}
    </a>
  </router-link>
</template>

  <!-- centered logo between links and user icon -->
<template #start>
  <router-link to="/" class='logo-link' style="display: flex; align-items: center;">
    <img
      src="/title6.png"
      alt="QuantiCart"
      style="height: 1.66rem; margin-left: 2rem; margin-right: 2.5rem; transform: scale(2.2); margin-bottom: 0.33rem;"
    
    />
  </router-link>
</template>
  <!-- login / user dropdown -->
  <template #end>
    <div class="flex align-items-center"  style="margin-top: 0.33rem;">
      <Button v-if="!auth.user" icon="pi pi-user" class="p-button-text" @click="goLogin" />
      <div v-else class="relative">
        <Button icon="pi pi-user" class="p-button-text" @click="userMenu.toggle($event)" />
        <TieredMenu ref="userMenu" :model="userMenuItems" popup />
      </div>
    </div>
  </template>
</Menubar>

      <!-- main content -->
      <main class="flex-1 overflow-auto">
        <!-- Use KeepAlive if you want components to persist state across navigation -->
        <!--
        <RouterView v-slot="{ Component }">
          <KeepAlive>
            <component :is="Component" />
          </KeepAlive>
        </RouterView>
        -->
        <!-- Or standard RouterView if component state reset on navigate is okay -->
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import Menubar from 'primevue/menubar'
import Button from 'primevue/button'
import TieredMenu from 'primevue/tieredmenu'
import Ripple from 'primevue/ripple' // Import Ripple if using v-ripple directive

import { useAuthStore } from '@/stores/auth'
import { useSidebarStore } from '@/stores/sidebar'
import { useSearchTags } from '@/stores/searchTags'
import { useSearchTerms } from '@/stores/searchTerms'
// Assuming supabase is initialized and available if needed for direct calls (like removeAllChannels)
// import { supabase } from '@/lib/supabase';

const auth = useAuthStore()
const sidebarStore = useSidebarStore()
const tagsStore = useSearchTags()
const termsStore = useSearchTerms()

const ready = ref(false)
const router = useRouter()
const route = useRoute()
const userMenu = ref(null) // Define ref for the TieredMenu

onMounted(async () => {
  // Initialize auth FIRST
  await auth.init()

  // Initial check: if already logged in (e.g., session restored), fetch data now.
  if (auth.user) {
    console.log('App.vue onMounted: User already logged in, fetching initial data...')
    await fetchDataForUser()
  } else if (route.name !== 'login' && route.meta.requiresAuth) {
    // Added requiresAuth check
    // if no user, not on login page, AND the page requires auth, bounce to login
    console.log('App.vue onMounted: No user, redirecting to login.')
    router.replace({ name: 'login' })
  }

  ready.value = true
})

// Watch for auth state changes (login/logout)
watch(
  () => auth.user,
  async (newUser, oldUser) => {
    if (newUser && !oldUser) {
      // User just logged IN
      console.log('App.vue watch(auth.user): User logged in, fetching initial data...')
      await fetchDataForUser()

      // Redirect away from login page if currently on it
      if (route.name === 'login') {
        router.replace({ name: 'home' }) // Or wherever your main authenticated view is
      }
    } else if (!newUser && oldUser) {
      // User just logged OUT
      console.log('App.vue watch(auth.user): User logged out, resetting stores...')
      resetStores() // Reset data stores on logout
      // Optional: Redirect to login after logout is complete if not handled by userMenu command
      // if (route.meta.requiresAuth) { // Only redirect if current route needs auth
      //    router.replace({ name: 'login' });
      // }
    }
  },
  { immediate: false }, // Don't run immediately, onMounted handles initial state
)

// Function to fetch essential data after login
async function fetchDataForUser() {
  console.log('[App.vue] Fetching data for user...')
  // Use Promise.all for concurrent fetching
  try {
    await Promise.all([
      sidebarStore.fetchFolders(), // Fetch folders/files for sidebar
      tagsStore.fetchTags(), // Fetch all available tags
      termsStore.fetchAll(), // Fetch all search terms and their initial prices
    ])
    // Initialize Supabase Realtime subscriptions AFTER initial data is loaded
    // Ensure initRealtime checks if subscriptions already exist to avoid duplicates
    termsStore.initRealtime()
    console.log('[App.vue] Initial data fetch complete.')
  } catch (error) {
    console.error('[App.vue] Error fetching initial data:', error)
    // Consider showing an error message to the user (e.g., using PrimeVue Toast)
  }
}

// Function to clear store data on logout
function resetStores() {
  console.log('[App.vue] Resetting stores...')
  sidebarStore.reset()
  tagsStore.reset()
  termsStore.reset()
  // Explicitly remove Supabase subscriptions if stores don't handle it in reset()
  // This prevents potential errors or duplicate listeners if the user logs back in.
  // try {
  //   console.log('[App.vue] Removing Supabase channels...');
  //   await supabase.removeAllChannels();
  // } catch (error) {
  //   console.error('[App.vue] Error removing Supabase channels:', error);
  // }
}

// --- Top Navigation Bar Items ---
const navItems = ref([
  // Use ref if items might change dynamically, otherwise const is fine
  { label: 'Home', icon: 'pi pi-home', to: { name: 'home' } },
  { label: 'Dashboard', icon: 'pi pi-chart-bar', to: { name: 'dashboard' } },
  { label: 'Database', icon: 'pi pi-database', to: { name: 'database' } },
  // Add other main navigation links here
])

// --- User Menu Items (Dropdown) ---
// Use computed so it reacts to changes in auth.user and router availability
const userMenuItems = computed(() => [
  {
    label: 'Settings',
    icon: 'pi pi-cog',
    // Ensure you have a route named 'settings' or change this command
    command: () =>
      router.push({ name: 'settings' }).catch((err) => {
        if (err.name !== 'NavigationDuplicated') console.error(err)
      }),
  },
  {
    separator: true, // Optional separator
  },
  {
    label: 'Log out',
    icon: 'pi pi-sign-out',
    command: onLogout, // Use the dedicated logout handler
  },
])

// --- Helper Functions ---
async function onLogout() {
  console.log('[App.vue] Logging out...')
  await auth.logout() // Auth store handles Supabase sign out & clearing its own state
  // The watch(auth.user) detects the change to null and calls resetStores()
  // Redirect to login after logout process is complete
  router.replace({ name: 'login' }).catch((err) => console.error('Logout redirect error:', err))
}

function goLogin() {
  // Navigate to the login page
  router.replace({ name: 'login' }).catch((err) => {
    if (err.name !== 'NavigationDuplicated') console.error(err)
  })
}

// Register Ripple directive if used
// Directives might need global registration or local import depending on setup
// If using <script setup>, PrimeVue components often handle directives internally.
// If not, ensure Ripple is registered correctly in main.js or locally:
// directives: {
//   ripple: Ripple
// }
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

 

a:active {
  background-color: var(--p-orange-200);
    border-radius: 0.5rem;
}

a.router-link-active,       /* partial match */
a.router-link-exact-active  /* exact match  */ {
  background-color: var(--p-orange-100) !important;
  /* optional – if PrimeVue theme gives undesirable text/icon colours */
  color: var(--p-orange-600) !important;
  border-radius: 0.5rem;
    text-shadow: 0 0 0.25px currentColor,
  0 0 0.5px currentColor;
}

.logo-link.router-link-active,
.logo-link.router-link-exact-active {
  background: transparent !important;



}

 
</style>
