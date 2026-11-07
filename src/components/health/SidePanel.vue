<template>
  <HealthPanel :accent="tab.accent">
    <template #title>
      <span class="hx-dot" />
      <HxSegmented v-model="view" :options="TABS" />
    </template>
    <template #actions>
      <span class="hx-panel-sub">{{ tab.sub() }}</span>
    </template>
    <KeepAlive>
      <component :is="tab.component" />
    </KeepAlive>
  </HealthPanel>
</template>

<script setup>
// The narrow panel beside the minute chart: zones for the window in view,
// vitals, and the workout list — one at a time.
import { ref, computed } from 'vue'
import HealthPanel from './HealthPanel.vue'
import HxSegmented from './HxSegmented.vue'
import HrZones from './HrZones.vue'
import VitalsList from './VitalsList.vue'
import WorkoutsList from './WorkoutsList.vue'
import { P } from '@/lib/health/theme'
import { useHealthStore, HISTORY_DAYS } from '@/stores/health'

const store = useHealthStore()

const TABS = [
  { label: 'Zones', value: 'zones', title: 'Time in heart-rate zones for the window in view' },
  { label: 'Vitals', value: 'vitals' },
  { label: 'Workouts', value: 'workouts' },
]

const PANES = {
  zones: { component: HrZones, accent: P.hr, sub: () => `${store.detailHours} h in view` },
  vitals: { component: VitalsList, accent: P.spo2, sub: () => `last ${HISTORY_DAYS} days` },
  workouts: { component: WorkoutsList, accent: P.kcal, sub: () => `${store.workouts.length} in ${HISTORY_DAYS} days` },
}

const view = ref('zones')
const tab = computed(() => PANES[view.value])
</script>
