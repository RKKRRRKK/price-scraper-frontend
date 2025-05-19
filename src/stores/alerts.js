// File: src/stores/alerts.js
import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

export const useAlertsStore = defineStore('alerts', {
  state: () => ({
    alerts: [],
    loading: false,
    error: null,
  }),
  actions: {
    _mapDbRowToAlert(dbRow) {
      if (!dbRow) return null
      return {
        id: dbRow.id,
        fileId: dbRow.file_id,
        marketplace: dbRow.source,
        term: dbRow.search_term,
        alertEmail: dbRow.alert_email,
        telegramAlert: dbRow.telegram_alert,
      }
    },
    async fetchAlerts(fileId, marketplace) {
      this.loading = true
      this.error = null
      const auth = useAuthStore()
      if (!auth.user) {
        this.alerts = []
        this.loading = false
        return
      }
      const { data, error } = await supabase
        .from('scrape_jobs')
        .select('id, file_id, source, search_term, alert_email, telegram_alert')
        .eq('user_id', auth.user.id)
        .eq('file_id', fileId)
        .eq('source', marketplace)
      if (error) {
        this.error = error.message
      } else {
        this.alerts = data.map(this._mapDbRowToAlert).filter(Boolean)
      }
      this.loading = false
    },
    async updateAlert(id, { alertEmail, telegramAlert }) {
      this.error = null
      const { data, error } = await supabase
        .from('scrape_jobs')
        .update({ alert_email: alertEmail, telegram_alert: telegramAlert })
        .eq('id', id)
        .select('*')
        .single()
      if (error) {
        this.error = error.message
      } else {
        const idx = this.alerts.findIndex((a) => a.id === id)
        if (idx !== -1) {
          this.alerts.splice(idx, 1, this._mapDbRowToAlert(data))
        }
      }
    },
    async updateAll(settings) {
      this.error = null
      try {
        await Promise.all(
          settings.map((s) =>
            supabase
              .from('scrape_jobs')
              .update({ alert_email: s.alertEmail, telegram_alert: s.telegramAlert })
              .eq('id', s.id)
          )
        )
        this.alerts = settings
      } catch (error) {
        this.error = error.message
      }
    },
  },
})
