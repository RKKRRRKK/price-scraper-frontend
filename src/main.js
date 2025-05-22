import '@/assets/main.css'
import 'primeicons/primeicons.css'
 import { definePreset } from '@primeuix/themes';
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

const MyPreset = definePreset(Lara, {
    semantic: {
        primary: {
            50: '{orange.50}',
            100: '{orange.100}',
            200: '{orange.200}',
            300: '{orange.300}',
            400: '{orange.400}',
            500: '{orange.500}',
            600: '{orange.600}',
            700: '{orange.700}',
            800: '{orange.800}',
            900: '{orange.900}',
            950: '{orange.950}'
        },
    }
});

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
        preset: MyPreset
    }
 });
 
app.use(ConfirmationService); // Register service
app.directive('tooltip', Tooltip); // Register directive

app.mount('#app')
