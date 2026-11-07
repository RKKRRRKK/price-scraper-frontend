<template>
  <div class="hx-root health-view" :style="cssVars">
    <div v-if="store.error" class="hx-error">
      <i class="pi pi-exclamation-triangle" />
      <span>{{ store.error }}</span>
      <button class="hx-btn" @click="store.error = null"><i class="pi pi-times" /></button>
    </div>

    <!-- Nothing synced yet -->
    <div v-if="store.ready && !store.hasData" class="onboard">
      <div class="onboard-card">
        <span class="onboard-icon"><i class="pi pi-heart-fill" /></span>
        <h2>No watch data yet</h2>
        <p>Link the Health Bridge app on your phone and the dashboard fills in after its first sync.</p>
        <button class="hx-btn primary" @click="linkOpen = true"><i class="pi pi-mobile" />Link phone</button>
      </div>
    </div>

    <template v-else>
      <div class="screen">
        <div class="grid">
          <KpiStrip class="a-kpi" @settings="settingsOpen = true" @link="linkOpen = true" />
          <HrDetailPanel class="a-detail" />
          <SidePanel class="a-side" />
          <HrTrendPanel class="a-trend" />
          <SleepPanel class="a-sleep" />
          <ActivityPanel class="a-activity" />
        </div>
      </div>

      <!-- Below the first screen; each panel only exists once its data has arrived. -->
      <div v-if="extras > 0" :class="['extras', `n${extras}`]">
        <StressPanel v-if="hasStress" class="a-stress" />
        <BodyPanel v-if="hasBody" class="a-body" />
        <WorkoutPanel v-if="store.hasWorkoutDetails" class="a-workout" />
      </div>
    </template>

    <!-- Settings -->
    <Teleport to="body">
      <div v-if="settingsOpen" class="hx-root hx-modal-backdrop" :style="cssVars" @click.self="settingsOpen = false">
        <div class="hx-modal">
          <h3>Dashboard settings <button class="hx-btn" @click="settingsOpen = false"><i class="pi pi-times" /></button></h3>
          <label class="hx-field">
            <span>Max heart rate<small>Sets the zone boundaries (≈ 220 − age)</small></span>
            <input v-model.number="store.settings.maxHr" class="hx-input" type="number" min="120" max="230" />
          </label>
          <label class="hx-field">
            <span>Daily step goal</span>
            <input v-model.number="store.settings.stepGoal" class="hx-input" type="number" min="1000" step="500" />
          </label>
        </div>
      </div>
    </Teleport>

    <!-- Link phone -->
    <Teleport to="body">
      <div v-if="linkOpen" class="hx-root hx-modal-backdrop" :style="cssVars" @click.self="linkOpen = false">
        <div class="hx-modal">
          <h3>Link phone <button class="hx-btn" @click="linkOpen = false"><i class="pi pi-times" /></button></h3>
          <p v-if="store.link">
            Linked{{ store.link.device ? ` to ${store.link.device}` : '' }} ·
            {{ store.link.last_used_at ? `last sync ${fmt.ago(new Date(store.link.last_used_at).getTime())}` : 'not synced yet' }}
          </p>
          <template v-if="newToken">
            <p>Paste into <code>native/health-bridge/health.properties</code>, then rebuild the app.</p>
            <pre class="hx-code">{{ propsText }}</pre>
            <button class="hx-btn" @click="copyProps"><i class="pi pi-copy" />{{ copied ? 'Copied' : 'Copy' }}</button>
          </template>
          <template v-else>
            <p v-if="store.link">A new token unlinks the current phone until its app is rebuilt.</p>
            <button class="hx-btn primary" :disabled="creating" @click="generateToken">
              <i :class="['pi', creating ? 'pi-spin pi-spinner' : 'pi-key']" />
              {{ store.link ? 'Replace token' : 'Generate token' }}
            </button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import '@/components/health/health.css'
import KpiStrip from '@/components/health/KpiStrip.vue'
import HrDetailPanel from '@/components/health/HrDetailPanel.vue'
import SidePanel from '@/components/health/SidePanel.vue'
import HrTrendPanel from '@/components/health/HrTrendPanel.vue'
import SleepPanel from '@/components/health/SleepPanel.vue'
import ActivityPanel from '@/components/health/ActivityPanel.vue'
import StressPanel from '@/components/health/StressPanel.vue'
import BodyPanel from '@/components/health/BodyPanel.vue'
import WorkoutPanel from '@/components/health/WorkoutPanel.vue'
import { cssVars, fmt } from '@/lib/health/theme'
import { useHealthStore } from '@/stores/health'

const store = useHealthStore()

onMounted(() => {
  store.refresh()
  store.startPolling()
})
onBeforeUnmount(() => store.stopPolling())

const settingsOpen = ref(false)

const SCALE_METRICS = ['weight_kg', 'body_fat_pct', 'muscle_kg', 'water_pct', 'bone_kg', 'visceral_fat', 'bmr_kcal', 'bmi']
const hasStress = computed(() => !!store.sources.stress && !!store.daily.stress?.length)
const hasBody = computed(() => SCALE_METRICS.some((m) => store.vitals[m]?.length))
const extras = computed(() => [hasStress.value, hasBody.value, store.hasWorkoutDetails].filter(Boolean).length)

// ── Link phone ──
const linkOpen = ref(false)
const creating = ref(false)
const newToken = ref(null)
const copied = ref(false)

const propsText = computed(() =>
  [
    `supabase.url=${import.meta.env.VITE_SUPABASE_URL}`,
    `supabase.anonKey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    `health.token=${newToken.value}`,
  ].join('\n'),
)

async function generateToken() {
  creating.value = true
  try {
    newToken.value = await store.createToken()
    copied.value = false
  } catch (err) {
    store.error = err.message || String(err)
    linkOpen.value = false
  } finally {
    creating.value = false
  }
}

async function copyProps() {
  await navigator.clipboard.writeText(propsText.value)
  copied.value = true
}

watch(linkOpen, (open) => {
  if (!open) newToken.value = null
})
</script>

<style scoped>
/* The route is `flush` (router meta), so the navbar drops its 1rem bottom
   margin and the usual 6.75rem budget shrinks to 5.75rem — no light strip
   between the bar and the dark dashboard. */
.health-view {
  position: relative;
  height: calc(100vh - 5.75rem);
  height: calc(100dvh - 5.75rem);
  min-height: 40rem;
  padding: 0.75rem;
  /* The first screen fills the view exactly; stress, body and workout panels sit below it. */
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--hx-border2) transparent;
  /* inset: depth under the navbar; outer: paints the budget's few px of slack
     below the view dark (shadows never add scroll) */
  box-shadow:
    inset 0 0.75rem 1rem -0.75rem rgba(15, 23, 42, 0.1),
    0 1rem 0 0 var(--hx-bg);
}

.screen {
  height: calc(100vh - 5.75rem - 1.5rem);
  height: calc(100dvh - 5.75rem - 1.5rem);
  min-height: 38.5rem;
}

.extras {
  height: clamp(25rem, 46dvh, 38rem);
  margin-top: 0.75rem;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.extras.n1 > * { grid-column: span 6; }
.extras.n2 > * { grid-column: span 6; }
.extras.n3 > * { grid-column: span 4; }

.grid {
  height: 100%;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-rows: auto minmax(0, 1.15fr) minmax(0, 1fr);
  grid-template-areas:
    'kpi kpi kpi kpi kpi kpi kpi kpi kpi kpi kpi kpi'
    'detail detail detail detail detail detail detail detail side side side side'
    'trend trend trend trend trend sleep sleep sleep sleep act act act';
}

.a-kpi { grid-area: kpi; }
.a-detail { grid-area: detail; }
.a-side { grid-area: side; }
.a-trend { grid-area: trend; }
.a-sleep { grid-area: sleep; }
.a-activity { grid-area: act; }

.hx-error {
  position: absolute;
  top: 1rem;
  left: 50%;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  max-width: min(40rem, calc(100% - 2rem));
  padding: 0.5rem 0.5rem 0.5rem 0.875rem;
  font-size: 0.8125rem;
  color: #991b1b;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 0.75rem;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
  transform: translateX(-50%);
}

.hx-error span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.onboard {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboard-card {
  max-width: 24rem;
  padding: 2rem;
  text-align: center;
  background: var(--hx-panel);
  border: 1px solid var(--hx-border);
  border-radius: 1rem;
}

.onboard-card h2 {
  margin: 0.875rem 0 0.375rem;
  font-size: 1.125rem;
}

.onboard-card p {
  margin: 0 0 1.25rem;
  font-size: 0.875rem;
  color: var(--hx-text2);
}

.onboard-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3rem;
  height: 3rem;
  font-size: 1.25rem;
  color: var(--hx-hr);
  background: color-mix(in srgb, var(--hx-hr) 14%, transparent);
  border-radius: 50%;
}

/* Below 1280 px: two columns, the page scrolls. */
@media (max-width: 80em) {
  .health-view {
    height: auto;
    min-height: calc(100vh - 5.75rem);
    overflow: visible;
  }

  .screen {
    height: auto;
    min-height: 0;
  }

  .extras {
    height: auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .extras > * { grid-column: span 1 !important; height: 28rem; }
  .extras > .a-workout { height: 34rem; }
  .extras.n3 > .a-workout { grid-column: span 2 !important; }
  .extras.n1 > * { grid-column: span 2 !important; }

  .grid {
    height: auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: auto 26rem 22rem 22rem;
    grid-template-areas:
      'kpi kpi'
      'detail detail'
      'side trend'
      'sleep act';
  }
}

/* Phone (the shell's compact nav kicks in at this exact width). */
@media (max-width: 767.98px) {
  .health-view {
    min-height: calc(100vh - 3.75rem);
    padding: 0.5rem;
  }

  .extras {
    gap: 0.5rem;
    margin-top: 0.5rem;
    grid-template-columns: minmax(0, 1fr);
  }

  .extras > *,
  .extras.n1 > *,
  .extras.n3 > .a-workout { grid-column: span 1 !important; }
  .extras > .a-stress { height: 40rem; }
  .extras > .a-workout { height: 40rem; }

  .grid {
    gap: 0.5rem;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 24rem 22rem 22rem 24rem 22rem;
    grid-template-areas: 'kpi' 'detail' 'side' 'trend' 'sleep' 'act';
  }
}
</style>
