import '@/assets/main.css'
import 'primeicons/primeicons.css'
import 'primeflex/primeflex.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Lara from '@primevue/themes/lara'
import piniaPersist from 'pinia-plugin-persistedstate'

import App from './App.vue'
import router from './router'


const app = createApp(App)

const pinia = createPinia()
pinia.use(piniaPersist)

app.use(pinia)
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: Lara,
  },
})

app.mount('#app')
