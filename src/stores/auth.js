import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'

export const useAuthStore = defineStore('auth', {
 persist: false,
    state: () => ({
    user: null,
    session: null,
    error: null,
    initialized: false,    // ← track init
  }),
  actions: {
    async init() {
      // 1) load any existing session
      const { data: { session } } = await supabase.auth.getSession()
      this.session = session
      this.user = session?.user ?? null

      // 2) listen for future changes
      supabase.auth.onAuthStateChange((_event, session) => {
        this.session = session
        this.user = session?.user ?? null
      })

      // 3) mark ready
      this.initialized = true
    },

    async login(email, password) {
      this.error = null
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        this.error = error.message
        return false
      }
      return true
    },

    async logout() {
      await supabase.auth.signOut()
      this.user = null
      this.session = null
    }
  }
})