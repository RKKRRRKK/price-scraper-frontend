import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth' // Needed for user_id

export const useSearchTerms = defineStore('searchTerms', {
  state: () => ({
    terms: [],      // Array of term objects
    loaded: false,
    loading: false,
    error: null,
    realtimeChannelJobs: null,
    realtimeChannelPrices: null,
  }),
  persist: false,
  getters: {
    termsByMarketplace: (state) => (fileId, marketplace) => {
      if (fileId === null || typeof fileId === 'undefined') {
          // If no file is selected, return empty or terms only by marketplace?
          // Decide the behavior when no file is active. Returning empty is safest.
          console.warn('[SearchTerms] Getter called with null/undefined fileId');
          return [];
          // Or maybe: return state.terms.filter(t => t.marketplace === marketplace);
      }
      // Filter the main terms array by both fileId and marketplace
      return state.terms.filter(t => t.fileId === fileId && t.marketplace === marketplace);
    }
  },
  actions: {
    // Internal helper to map DB row to local state object
    _mapDbRowToState(dbRow) {
        if (!dbRow) return null;
        return {
            id: dbRow.id,
            fileId: dbRow.file_id, // Correct column name
            marketplace: dbRow.source,
            term: dbRow.search_term,
            primeOnly: dbRow.exclude_zoom, // aka exclude_zoom
            lensOnly: dbRow.exclude_bodies, // aka exclude_bodies
            excludeAcc: dbRow.exclude_acc, // aka exclude_acc
            excludeDamaged: dbRow.exclude_damaged, // Added based on schema
            include: dbRow.include_terms || [], // Correct column name
            exclude: dbRow.exclude_terms || [], // Correct column name
            smart_filter: dbRow.smart_filter,
            // Dynamic fields - initialized/updated separately
            link: null,
            currentPrice: null,
            lowestPrice: null,
            alltime_lowest: null,
            lastChanged: null,
            offersTotal: null,
            offersCurrent: null,
            condition: null,
            ageInDays: null,
        };
    },

    // Internal helper to upsert local state
    _upsertLocal(termStateObject) {
      if (!termStateObject || typeof termStateObject.id === 'undefined') {
          console.warn('[SearchTerms] _upsertLocal called with invalid data:', termStateObject);
          return;
      }
      const index = this.terms.findIndex((t) => t.id === termStateObject.id);
      if (index === -1) {
        // Add: ensure all fields exist, merge with defaults/empty values
        const newFullTerm = {
            // Defaults for dynamic fields
            link: null, currentPrice: null, lowestPrice: null, alltime_lowest: null, lastChanged: null,
            offersTotal: null, offersCurrent: null, condition: null, ageInDays: null,
             // Base fields from input
            ...termStateObject,
             // Ensure array fields are arrays
            include: termStateObject.include || [],
            exclude: termStateObject.exclude || [],
        };
        this.terms.push(newFullTerm);
        console.log('[SearchTerms] _upsertLocal: Added new term', termStateObject.id);
      } else {
        // Update: merge new data over existing term, preserving existing dynamic fields if not provided
        this.terms[index] = { ...this.terms[index], ...termStateObject };
        console.log('[SearchTerms] _upsertLocal: Updated term', termStateObject.id);
      }
    },

    _mergePrice(priceRow) {
      const term = this.terms.find(
        (t) => t.term === priceRow.search_term && t.marketplace === priceRow.source
      );
      if (!term) {
         // console.warn(`[SearchTerms] _mergePrice: No matching term for "${priceRow.search_term}" in ${priceRow.source}`);
        return;
      }
 
      term.currentPrice = priceRow.current_lowest_price;
      term.alltime_lowest = priceRow.alltime_lowest;
      term.lastChanged   = priceRow.latest_date;
      term.ageInDays     = priceRow.age_in_days;
      term.link          = priceRow.link;
      term.offersTotal   = priceRow.offers_total;
      term.offersCurrent = priceRow.offers_current;
      term.condition     = priceRow.current_condition;
      if (term.lowestPrice == null || (priceRow.current_lowest_price != null && priceRow.current_lowest_price < term.lowestPrice)) {
        term.lowestPrice = priceRow.current_lowest_price;
      }
    },

    async fetchAll() {
      if (this.loaded || this.loading) {
        console.log(`[SearchTerms] Skipping fetchAll (Loaded: ${this.loaded}, Loading: ${this.loading})`);
        return;
      }
      const auth = useAuthStore();
      if (!auth.user) {
          console.warn('[SearchTerms] Cannot fetch terms: User not logged in.');
          this.reset();
          return;
      }
      console.log('[SearchTerms] fetchAll: Starting fetch...');
      this.loading = true;
      this.error = null;
      try {
        // Select all columns from scrape_jobs for the user
        const { data: jobs, error: jobsError } = await supabase
          .from('scrape_jobs')
          .select('*') // Select all columns defined in schema
          .eq('user_id', auth.user.id); // Filter by user

        if (jobsError) throw jobsError;
        console.log('[SearchTerms] fetchAll: Loaded jobs count =', jobs?.length ?? 0);

        // Map DB rows to state objects
        this.terms = jobs.map(this._mapDbRowToState).filter(Boolean); // Filter out nulls if mapping fails

        // Fetch initial prices
        await this.refreshPrices(false); // Don't log start again

        this.loaded = true;
        console.log('[SearchTerms] fetchAll: Fetch complete, initializing realtime.');
        this.initRealtime();

      } catch (error) {
        console.error('[SearchTerms] fetchAll error:', error);
        this.error = error.message || 'Failed to fetch search terms.';
        this.loaded = false;
        this.terms = [];
      } finally {
        this.loading = false;
      }
    },

    async addTerm(termData) { // <-- Change to accept the whole object first
      // *** Log the ENTIRE object received by the action ***
      console.log('[SearchTerms] addTerm action RECEIVED:', JSON.stringify(termData));

      // *** Destructure AFTER logging ***
      const { marketplace, term, primeOnly, lensOnly, excludeAcc, excludeDamaged, include, exclude, fileId, smart_filter } = termData;

      // *** Log the DESTRUCTURED fileId specifically ***
      console.log('[SearchTerms] addTerm action DESTRUCTURED fileId:', fileId, 'Type:', typeof fileId);


      this.error = null;
      const auth = useAuthStore();
      if (!auth.user) { /* ... */ return; }
      if (!marketplace || !term?.trim()) { /* ... */ return; }

      // *** Add the explicit check for fileId validity AFTER destructuring ***
       if (fileId === null || typeof fileId === 'undefined' || typeof fileId !== 'number') {
            console.error('[SearchTerms] addTerm STOPPED post-destructure: fileId is missing or invalid!', fileId);
            this.error = "Cannot add term post-destructure: Associated file ID is missing or invalid.";
            // Optionally throw an error that the modal can catch
            throw new Error(this.error);
            // return; // Or just return if preferred
       }


      try {
        // Create the insert payload object explicitly
        const insertPayload = {
            user_id: auth.user.id,
            source: marketplace,
            search_term: term.trim(),
            include_terms: include || [],
            exclude_terms: exclude || [],
            exclude_zoom: primeOnly || false,
            exclude_bodies: lensOnly || false,
            exclude_acc: excludeAcc || false,
            exclude_damaged: excludeDamaged || false,
            file_id: fileId, // Use the validated, destructured fileId
            smart_filter: Boolean(smart_filter),
        };

        // *** Log the object JUST BEFORE sending to Supabase ***
        console.log('[SearchTerms] Inserting into Supabase with payload:', JSON.stringify(insertPayload));

        const { data, error } = await supabase
          .from('scrape_jobs')
          .insert(insertPayload) // Pass the explicit object
          .select('*')
          .single();

        if (error) throw error;
        if (!data) throw new Error("No data returned from insert operation.");

        // *** Log the raw data returned by Supabase ***
        console.log('[SearchTerms] Supabase returned data:', JSON.stringify(data));

        const newTermState = this._mapDbRowToState(data);
        if (newTermState) {
            this._upsertLocal(newTermState);
             // Log the mapped state's fileId
            console.log('[SearchTerms] Mapped state fileId:', newTermState.fileId);
        } else {
             console.warn('[SearchTerms] Failed to map DB row to state.');
        }

        // Final log using the raw 'data' object from Supabase response
        console.log('[SearchTerms] addTerm successful, ID:', data.id, 'DB file_id:', data.file_id); // Changed log again

      } catch (error) {
          console.error('[SearchTerms] addTerm error:', error);
          this.error = error.message || 'Failed to add search term.';
          // Re-throw error so the modal's catch block can see it
          throw error;
      }
    },
    async removeTerm(id) {
      console.log('[SearchTerms] removeTerm:', id);
      this.error = null;
       // Note: Need to manually delete tags from `search_tags` first if no DB cascade delete is set up  -> I think there is cascade?
      //  const tagsStore = useSearchTags(); // Assuming tagsStore is available or imported
      //  await tagsStore.setTags(id, []); // Clear tags first

      try {
        const { error } = await supabase
          .from('scrape_jobs')
          .delete()
          .eq('id', id);

        if (error) throw error;

        const initialLength = this.terms.length;
        this.terms = this.terms.filter((t) => t.id !== id);
        if (this.terms.length < initialLength) {
            console.log('[SearchTerms] removeTerm successful, removed locally.');
        } else {
            console.warn('[SearchTerms] removeTerm: Term ID not found in local state:', id);
        }

      } catch (error) {
        console.error('[SearchTerms] removeTerm error:', error);
        this.error = error.message || 'Failed to remove search term.';
      }
    },

    initRealtime() {
        if (this.realtimeChannelJobs || this.realtimeChannelPrices) {
            console.warn('[SearchTerms] initRealtime: Channels already initialized? Ensure cleanup.');
            // await this.removeRealtime(); // Optional: Force cleanup before re-init
        }
        const auth = useAuthStore();
        if (!auth.user) {
            console.log('[SearchTerms] initRealtime: No user, skipping subscription.');
            return;
        }
        const userId = auth.user.id;
        console.log('[SearchTerms] initRealtime: Subscribing to channels for user:', userId);
        try {
            // Subscribe to user's scrape_jobs changes
            this.realtimeChannelJobs = supabase
                .channel(`scrape_jobs_user_${userId}`) // User-specific channel
                .on(
                    'postgres_changes',
                    // Filter events for this specific user on the server-side
                    { event: '*', schema: 'public', table: 'scrape_jobs', filter: `user_id=eq.${userId}` },
                    (payload) => {
                        console.log('[SearchTerms] Realtime <scrape_jobs> event:', payload.eventType);
                        const { eventType, new: newRecord, old: oldRecord } = payload;
                        if (eventType === 'INSERT' || eventType === 'UPDATE') {
                            const termState = this._mapDbRowToState(newRecord);
                            if(termState) this._upsertLocal(termState);
                        } else if (eventType === 'DELETE') {
                            if (oldRecord && oldRecord.id) {
                                const initialLength = this.terms.length;
                                this.terms = this.terms.filter((t) => t.id !== oldRecord.id);
                                if (this.terms.length < initialLength) {
                                    console.log('[SearchTerms] Realtime <scrape_jobs> DELETE processed locally for ID:', oldRecord.id);
                                }
                            }
                        }
                    }
                )
                .subscribe(this._handleSubscriptionStatus('scrape_jobs_user'));

            // Subscribe to user's listing changes (which trigger price updates)
            this.realtimeChannelPrices = supabase
                .channel(`listings_user_${userId}`) // User-specific channel
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'listings', filter: `user_id=eq.${userId}` },
                    (payload) => {
                        console.log('[SearchTerms] Realtime <listings> event received, triggering price refresh:', payload.eventType);
                        // Could potentially optimize by only refreshing prices for the affected search_term
                        this.refreshPrices();
                    }
                )
                 .subscribe(this._handleSubscriptionStatus('listings_user'));

        } catch (error) {
            console.error('[SearchTerms] initRealtime: Failed to subscribe', error);
            this.error = "Failed to set up real-time updates.";
        }
    },

    // Helper for logging subscription status
     _handleSubscriptionStatus(channelName) {
        return (status, err) => {
            const baseMsg = `[SearchTerms] Realtime <${channelName}>`;
            if (status === 'SUBSCRIBED') {
                console.log(`${baseMsg} SUBSCRIBED.`);
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.error(`${baseMsg} Subscription Error/Timeout: ${status}`, err);
            } else if (status === 'CLOSED') {
                 console.log(`${baseMsg} CLOSED.`);
            } else {
                 console.log(`${baseMsg} Status: ${status}`);
            }
        };
    },


    async removeRealtime() {
        console.log('[SearchTerms] removeRealtime: Removing subscriptions...');
        let promises = [];
        if (this.realtimeChannelJobs) {
            console.log('[SearchTerms] Removing channel:', this.realtimeChannelJobs.channelName);
            promises.push(supabase.removeChannel(this.realtimeChannelJobs));
            this.realtimeChannelJobs = null;
        }
        if (this.realtimeChannelPrices) {
            console.log('[SearchTerms] Removing channel:', this.realtimeChannelPrices.channelName);
            promises.push(supabase.removeChannel(this.realtimeChannelPrices));
            this.realtimeChannelPrices = null;
        }
        try {
            await Promise.all(promises);
            console.log('[SearchTerms] removeRealtime: Channels removed.');
        } catch (error) {
            console.error('[SearchTerms] removeRealtime: Error removing channels', error);
        }
    },

    async refreshPrices(logStart = true) {
      if (logStart) console.log('[SearchTerms] refreshPrices: Starting price refresh...');
      const auth = useAuthStore();
      if (!auth.user) {
          console.warn("[SearchTerms] refreshPrices: No user logged in.");
          return;
      }
      try {
        const { data: prices, error } = await supabase.rpc('current_low_query');
        if (error) throw error;
        if (prices && prices.length > 0) {
            prices.forEach(this._mergePrice);
            console.log('[SearchTerms] refreshPrices: Merged latest price data.');
        } else {
             console.log('[SearchTerms] refreshPrices: No price data returned from RPC.');
        }
      } catch (error) {
        console.error('[SearchTerms] refreshPrices error:', error);
        this.error = error.message || 'Failed to refresh prices.';
      }
    },

    async reset() {
        console.log('[SearchTerms] Resetting state...');
        await this.removeRealtime(); // Remove subscriptions first
        this.terms = [];
        this.loaded = false;
        this.loading = false;
        this.error = null;
    },
  },
});