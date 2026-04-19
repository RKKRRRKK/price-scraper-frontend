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
<nav class="app-navbar surface-card shadow-2 mb-3">
  <router-link to="/" class="logo-link">
    <img
      src="/everything.webp"
      alt="Kumquant"
      style="height: 1rem; transform: scale(4); opacity: 0.5;"
    />
  </router-link>

  <div class="nav-groups">
    <div class="nav-section scraper-section">
      <span class="nav-section-label">Scraper</span>
      <div class="nav-section-links">
        <router-link :to="{ name: 'home' }" custom v-slot="{ href, navigate, isExactActive }">
          <a :href="href" @click="navigate" :class="{ active: isExactActive }">
            <i class="pi pi-home mr-2" />Home
          </a>
        </router-link>
        <router-link :to="{ name: 'dashboard' }" custom v-slot="{ href, navigate, isActive }">
          <a :href="href" @click="navigate" :class="{ active: isActive }">
            <i class="pi pi-chart-bar mr-2" />Dashboard
          </a>
        </router-link>
        <router-link :to="{ name: 'database' }" custom v-slot="{ href, navigate, isActive }">
          <a :href="href" @click="navigate" :class="{ active: isActive }">
            <i class="pi pi-database mr-2" />Database
          </a>
        </router-link>
      </div>
    </div>

    <div class="nav-section sensors-section">
      <span class="nav-section-label">Sensors</span>
      <div class="nav-section-links">
        <router-link :to="{ name: 'temps' }" custom v-slot="{ href, navigate, isActive }">
          <a :href="href" @click="navigate" :class="{ active: isActive }">
            <i class="pi pi-sun mr-2" />Weather
          </a>
        </router-link>
        <router-link :to="{ name: 'monitor' }" custom v-slot="{ href, navigate, isActive }">
          <a :href="href" @click="navigate" :class="{ active: isActive }">
            <i class="pi pi-server mr-2" />Monitor
          </a>
        </router-link>
      </div>
    </div>

    <div class="nav-section productivity-section">
      <span class="nav-section-label">Productivity</span>
      <div class="nav-section-links">
        <router-link :to="{ name: 'notes' }" custom v-slot="{ href, navigate, isActive }">
          <a :href="href" @click="navigate" :class="{ active: isActive }">
            <i class="pi pi-file-edit mr-2" />Notes
          </a>
        </router-link>
      </div>
    </div>
  </div>

  <div class="nav-end">
    <Button v-if="!auth.user" icon="pi pi-user" class="p-button-text" @click="goLogin" />
    <div v-else class="relative">
      <Button icon="pi pi-user" class="p-button-text" @click="userMenu.toggle($event)" />
      <TieredMenu ref="userMenu" :model="userMenuItems" popup />
    </div>
  </div>
</nav>

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
import Button from 'primevue/button'
import TieredMenu from 'primevue/tieredmenu'
import Ripple from 'primevue/ripple' // Import Ripple if using v-ripple directive

import { useAuthStore } from '@/stores/auth'
import { useSidebarStore } from '@/stores/sidebar'
import { useSearchTags } from '@/stores/searchTags'
import { useSearchTerms } from '@/stores/searchTerms'
import { useNotesStore } from '@/stores/notes'
// Assuming supabase is initialized and available if needed for direct calls (like removeAllChannels)
// import { supabase } from '@/lib/supabase';

const auth = useAuthStore()
const sidebarStore = useSidebarStore()
const tagsStore = useSearchTags()
const termsStore = useSearchTerms()
const notesStore = useNotesStore()

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
      notesStore.fetchNotes(), // Fetch notes for productivity section
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
  notesStore.reset()
  // Explicitly remove Supabase subscriptions if stores don't handle it in reset()
  // This prevents potential errors or duplicate listeners if the user logs back in.
  // try {
  //   console.log('[App.vue] Removing Supabase channels...');
  //   await supabase.removeAllChannels();
  // } catch (error) {
  //   console.error('[App.vue] Error removing Supabase channels:', error);
  // }
}

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
  width: 100vw;
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
  #app {
    display: block !important;
    grid-template-columns: none !important;
  }
}

/* ── Navbar ── */
.app-navbar {
  display: flex;
  align-items: center;
  padding: 0.75rem 2rem;
  border: none;
  gap: 1.5rem;
}

.logo-link {
  display: flex;
  align-items: center;
  margin-right: 1.5rem;
  text-decoration: none;
}

.nav-groups {
  padding: 0.5rem;
  padding-bottom: 0.25rem;
  display: flex;
  align-items: stretch;
  gap: 5rem;
  flex: 1;
}

/* ── Section (Scraper / Sensors) ── */
.nav-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-left: 0.85rem;
  border-left: 2px solid transparent;
}

.scraper-section {
  border-left-color: #f97316;
}

.sensors-section {
  border-left-color: #22c55e;
}

.productivity-section {
  border-left-color: #a855f7;
}

.nav-section-label {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  user-select: none;
  line-height: 1;
}

.scraper-section .nav-section-label {
  color: #fb923c;
}

.sensors-section .nav-section-label {
  color: #4ade80;
}

.productivity-section .nav-section-label {
  color: #c084fc;
}

.nav-section-links {
  display: flex;
  gap: 0.35rem;
}

.nav-section-links a {
  display: flex;
  align-items: center;
  padding: 0.4rem 0.85rem;
  border-radius: 0.375rem;
  font-size: 1rem;
  font-weight: 500;
  color: #4b5563;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.nav-section-links a:hover {
  background: #f3f4f6;
}

/* ── Active states ── */
.scraper-section .nav-section-links a.active {
  background-color: var(--p-orange-100);
  color: var(--p-orange-600);
  text-shadow: 0 0 0.25px currentColor, 0 0 0.5px currentColor;
}

.scraper-section .nav-section-links a:active {
  background-color: var(--p-orange-200);
}

.sensors-section .nav-section-links a.active {
  background-color: #dcfce7;
  color: #15803d;
  text-shadow: 0 0 0.25px currentColor, 0 0 0.5px currentColor;
}

.sensors-section .nav-section-links a:active {
  background-color: #bbf7d0;
}

.productivity-section .nav-section-links a.active {
  background-color: #f3e8ff;
  color: #7e22ce;
  text-shadow: 0 0 0.25px currentColor, 0 0 0.5px currentColor;
}

.productivity-section .nav-section-links a:active {
  background-color: #e9d5ff;
}

.nav-end {
  margin-left: auto;
  display: flex;
  align-items: center;
}

/* ── Responsive ── */
@media (max-width: 700px) {
  .app-navbar {
    flex-wrap: wrap;
    padding: 0.5rem 0.75rem;
  }

  .nav-groups {
    order: 3;
    width: 100%;
    gap: 1.5rem;
    overflow-x: auto;
  }

  .nav-end {
    order: 2;
  }
}
</style>
