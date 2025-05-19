import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

import HomeView from '@/views/HomeView.vue'
import DashboardView from '@/views/DashboardView.vue'
import LoginView from '@/views/LoginView.vue'
import SettingsView from '@/views/SettingsView.vue'

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
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// Global guard: redirect to /login if not authed, or to / if already logged in
router.beforeEach((to, from, next) => {
  const auth = useAuthStore()

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
