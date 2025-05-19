import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    chatId: '',
    email: '',
    loading: false,
    saving: false,
  }),

  actions: {
    // pull current chat_id + email from alerts_data
    async fetchSettings() {
      this.loading = true
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) throw new Error('User not logged in')

        const { data, error } = await supabase
          .from('alerts_data')
          .select('chat_id, email')
          .eq('user_id', user.id)
          .maybeSingle()

        if (error) throw error
        this.chatId = data?.chat_id ?? ''
        this.email = data?.email ?? ''
      } catch (err) {
        console.error('Error fetching settings:', err)
      } finally {
        this.loading = false
      }
    },

    // upsert new values
    async saveSettings({ chatId, email }) {
      this.saving = true
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) throw new Error('User not logged in')

        const { error } = await supabase
          .from('alerts_data')
          .upsert({ user_id: user.id, chat_id: chatId, email }, { onConflict: 'user_id' })

        if (error) throw error
        this.chatId = chatId
        this.email = email
      } finally {
        this.saving = false
      }
    },
  },
})
