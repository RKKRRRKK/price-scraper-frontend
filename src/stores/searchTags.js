import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'

export const useSearchTags = defineStore('searchTags', {
  state: () => ({
    // in-memory cache: { [scrapeJobId]: [tag,…] }
    tagsByJob: {},
  }),

  actions: {
    /** Load tags for one job (or all if no id provided) */
    async fetchTags(jobId = null) {
      let q = supabase.from('search_tags').select('scrape_job_id, tag')

      if (jobId) {
        q = q.eq('scrape_job_id', jobId)
      }

      const { data, error } = await q
      if (error) {
        console.error('fetchTags error', error)
        return
      }

      // reset the cache for this job if we're fetching just one
      if (jobId) {
        this.tagsByJob[jobId] = []
      }
      // if loading all jobs, reset entire cache
      else {
        this.tagsByJob = {}
      }

      data.forEach(({ scrape_job_id, tag }) => {
        if (!this.tagsByJob[scrape_job_id]) {
          this.tagsByJob[scrape_job_id] = []
        }
        this.tagsByJob[scrape_job_id].push(tag)
      })
    },

    /** Replace tags for a given scrape job */
    async setTags(jobId, tags) {
      // delete existing tags for this job
      const { error: delErr } = await supabase
        .from('search_tags')
        .delete()
        .eq('scrape_job_id', jobId)

      if (delErr) {
        console.error('Error deleting tags', delErr)
        return
      }

      // bulk-insert new tag rows
      const rows = tags.map((tag) => ({ scrape_job_id: jobId, tag }))
      const { error: insErr } = await supabase.from('search_tags').insert(rows)

      if (insErr) {
        console.error('Error inserting tags', insErr)
        return
      }

      // update local cache
      this.tagsByJob[jobId] = [...tags]
    },

    /** Get tags for a scrape job from cache */
    getTags(jobId) {
      return this.tagsByJob[jobId] || []
    },
  },
})
