import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

import HomeView from '@/views/HomeView.vue'
import DashboardView from '@/views/DashboardView.vue'
import LoginView from '@/views/LoginView.vue'
import SettingsView from '@/views/SettingsView.vue'
import DataView from '@/views/DataView.vue'
import TempsView from '@/views/TempsView.vue'
import MonitorView from '@/views/MonitorView.vue'
import NotesView from '@/views/NotesView.vue'
import RemindersView from '@/views/RemindersView.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomeView,
    meta: { requiresAuth: true },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: DashboardView,
    meta: { requiresAuth: true },
  },
  {
    path: '/login',
    name: 'login',
    component: LoginView,
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
  },
  {
    path: '/database',
    name: 'database',
    component: DataView,
  },
  {
    path: '/temps',
    name: 'temps',
    component: TempsView,
    meta: { requiresAuth: true },
  },
  {
    path: '/monitor',
    name: 'monitor',
    component: MonitorView,
    meta: { requiresAuth: true },
  },
  {
    path: '/notes',
    name: 'notes',
    component: NotesView,
    meta: { requiresAuth: true },
  },
  {
    path: '/reminders',
    name: 'reminders',
    component: RemindersView,
    meta: { requiresAuth: true },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// Wait for auth.init() to finish before evaluating guards
function waitForAuth(auth) {
  if (auth.initialized) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = auth.$subscribe((_, state) => {
      if (state.initialized) { stop(); resolve() }
    })
  })
}

// Global guard: redirect to /login if not authed, or to / if already logged in
router.beforeEach(async (to, from, next) => {
  const auth = useAuthStore()

  // Wait for auth to finish initializing before making any decision
  await waitForAuth(auth)

  // If the target page requires auth and the user is NOT logged in → send to login
  if (to.meta.requiresAuth && !auth.user) {
    return next({ name: 'login' })
  }

  // If already logged in and trying to visit /login → send to home
  if (to.name === 'login' && auth.user) {
    return next({ name: 'home' })
  }

  // Otherwise, carry on
  return next()
})

export default router
