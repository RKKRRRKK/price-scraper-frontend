import '@/assets/main.css'
import 'primeicons/primeicons.css'
 
import '@/assets/primeflex‑custom.scss'  
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'; // Import service
import Tooltip from 'primevue/tooltip'; // Import directive
import Lara from '@primevue/themes/lara'



import piniaPersist from 'pinia-plugin-persistedstate'

import App from './App.vue'
import router from './router'



// ECHARTS STUFF BELOW 

import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'            
import { BarChart, LineChart } from 'echarts/charts'       
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent
} from 'echarts/components'                            
import { UniversalTransition } from 'echarts/features'       
use([
  CanvasRenderer,
  BarChart,
  LineChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  UniversalTransition
])

// ECHARTS STUFF ABOVE

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
app.use(ConfirmationService); // Register service
app.directive('tooltip', Tooltip); // Register directive

app.mount('#app')
