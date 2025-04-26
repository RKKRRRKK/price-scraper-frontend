<script setup>
import { RouterView } from 'vue-router'
import Menubar from 'primevue/menubar'
import { onMounted } from 'vue'
import { useSearchTerms } from '@/stores/searchTerms'


const items = [
  { label: 'Home', icon: 'pi pi-home', route: '/' },
  { label: 'Dashboard', icon: 'pi pi-chart-bar', route: '/dashboard' },
]


onMounted(() => {
  const store = useSearchTerms()
  store.fetchAll()       // initial load
  store.initRealtime()   // start listening
})


</script>

<template>
  <div class="surface-ground min-h-screen flex flex-column">
    <Menubar
      :model="items"
      class="border-none shadow-2 surface-card mb-3"
      style="padding-inline: 1rem"
    >
      <template #item="{ item, props }">
        <router-link v-if="item.route" v-slot="{ href, navigate }" :to="item.route" custom>
          <a v-ripple :href="href" v-bind="props.action" @click="navigate">
            <span :class="item.icon" class="mr-2" />
            <span>{{ item.label }}</span>
          </a>
        </router-link>

        <a v-else v-ripple :href="item.url" :target="item.target" v-bind="props.action">
          <span :class="item.icon" class="mr-2" />
          <span>{{ item.label }}</span>
        </a>
      </template>
    </Menubar>

    <main class="flex-1 p-3 md:p-5">
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
