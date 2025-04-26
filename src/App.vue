<script setup>
import { RouterView, useRoute } from 'vue-router'
import Menubar from 'primevue/menubar'
import { onMounted } from 'vue'
import { useSearchTerms } from '@/stores/searchTerms'

const route = useRoute()
console.log('[App.vue] setup: route is', route.fullPath)

const items = [
  { label: 'Home', icon: 'pi pi-home', route: '/' },
  { label: 'Dashboard', icon: 'pi pi-chart-bar', route: '/dashboard' },
]

const endItems = [
  { label: 'Login', icon: 'pi pi-user', route: '/login' },
]

onMounted(async () => {
  console.log('[App.vue] onMounted: fetching search terms')
  const store = useSearchTerms()
  try {
    await store.fetchAll()       // initial load
    console.log('[App.vue] onMounted: fetchAll complete, terms count', store.terms.length)
  } catch (err) {
    console.error('[App.vue] onMounted fetchAll error:', err)
  }
  console.log('[App.vue] onMounted: initializing realtime')
  store.initRealtime()           // start listening
})
</script>

<template>
  <div class="surface-ground min-h-screen flex flex-column">
    <Menubar
      v-if="route.path !== '/login'"
      :model="items"
      class="border-none shadow-2 surface-card mb-3"
      style="padding-inline: 1rem"
    >
      <template #item="{ item, props }">
        <router-link
          v-if="item.route"
          v-slot="{ href, navigate }"
          :to="item.route"
          custom
        >
          <a v-ripple :href="href" v-bind="props.action" @click="navigate">
            <span :class="item.icon" class="mr-2" />
            <span>{{ item.label }}</span>
          </a>
        </router-link>
        <a
          v-else
          v-ripple
          :href="item.url"
          :target="item.target"
          v-bind="props.action"
        >
          <span :class="item.icon" class="mr-2" />
          <span>{{ item.label }}</span>
        </a>
      </template>

      <template #end>
        <div class="flex align-items-center">
          <router-link
            v-for="item in endItems"
            :key="item.label"
            :to="item.route"
            class="p-button p-button-text"
          >
            <span :class="item.icon" class="mr-2" />
            <span>{{ item.label }}</span>
          </router-link>
        </div>
      </template>
    </Menubar>

    <main
  :class="[
    'flex-1',
    route.path === '/login' ? 'flex items-center justify-center' : ''
  ]"
>
  <RouterView />
</main>
  </div>
</template>

<style>
#app {
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
