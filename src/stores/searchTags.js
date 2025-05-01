import { defineStore } from 'pinia';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth'; // Needed for user_id

export const useSearchTags = defineStore('searchTags', {
  state: () => ({
    // Store unique tag *names* found across all user's terms
    tags: [],         // Array of unique tag strings: ['tag1', 'tag2', ...]
    // Map: { termId: ['tagA', 'tagB', ...] } - Cache of tags per term
    termTags: {},
    loaded: false,    // Have unique tags & relationships been loaded?
    loading: false,
    error: null,
  }),

  persist: { // Persisting might be okay, but ensure consistency on load
      paths: ['tags', 'termTags', 'loaded']
  },

  getters: {
    /** Returns all unique tag names discovered, sorted. */
    allTagNames: (state) => [...state.tags].sort(), // Return sorted copy
    /** Returns an array of tag names for a specific term ID from cache. */
    getTags: (state) => (termId) => {
        return state.termTags[termId] || [];
    },
  },

  actions: {
    /**
     * Fetches all unique tags and term-tag relationships for the user.
     * Populates both `state.tags` and `state.termTags`.
     */
    async fetchTagsAndRelationships() {
        // Use persisted 'loaded' flag check if persistence is enabled
        if (this.loaded || this.loading) {
            console.log(`[SearchTags] Skipping fetchTagsAndRelationships (Loaded: ${this.loaded}, Loading: ${this.loading})`);
            return;
        }
        const auth = useAuthStore();
        if (!auth.user) {
            console.warn('[SearchTags] Cannot fetch tags: User not logged in.');
            this.reset();
            return;
        }
        console.log('[SearchTags] Fetching tags and relationships...');
        this.loading = true;
        this.error = null;
        try {
            // Fetch all tag relationships for the current user
            const { data: relationships, error } = await supabase
                .from('search_tags') // Correct table name
                .select('scrape_job_id, tag') // Select term ID and tag name
                .eq('user_id', auth.user.id); // Filter by user

            if (error) throw error;

            // Process the relationships
            const uniqueTags = new Set();
            const newTermTags = {};

            if (relationships) {
                relationships.forEach(rel => {
                    const termId = rel.scrape_job_id;
                    const tagName = rel.tag;

                    if (!tagName) return; // Skip if tag name is null/empty

                    uniqueTags.add(tagName); // Add to set of all unique tags

                    if (!newTermTags[termId]) {
                        newTermTags[termId] = [];
                    }
                    if (!newTermTags[termId].includes(tagName)) { // Avoid duplicates per term
                        newTermTags[termId].push(tagName);
                    }
                });
            }

            // Sort tags alphabetically within each term's list
            Object.values(newTermTags).forEach(tagList => tagList.sort());

            // Update state
            this.tags = Array.from(uniqueTags).sort(); // Store sorted unique tag names
            this.termTags = newTermTags; // Store the map of termId -> tags
            this.loaded = true;
            console.log(`[SearchTags] Tags (${this.tags.length}) and relationships processed.`);

        } catch (error) {
            console.error('[SearchTags] Error fetching tags/relationships:', error);
            this.error = error.message || 'Failed to fetch tags.';
            this.loaded = false; // Reset loaded state on error
            this.tags = [];
            this.termTags = {};
        } finally {
            this.loading = false;
        }
    },

    // Keep fetchTags for potential compatibility, but it now calls the combined fetch
    async fetchTags() {
        await this.fetchTagsAndRelationships();
    },

    /**
     * Sets (replaces) the tags for a specific search term (scrape_job_id).
     * @param {number} termId - The ID of the scrape_job.
     * @param {string[]} tagNames - Array of tag names.
     */
    async setTags(termId, tagNames) {
        console.log(`[SearchTags] Setting tags for term ${termId}:`, tagNames);
        this.error = null;
        const auth = useAuthStore();
        if (!auth.user) {
            this.error = "Cannot set tags: User not logged in.";
            console.error('[SearchTags] setTags error:', this.error);
            return;
        }
        if (typeof termId !== 'number') {
            console.error("[SearchTags] setTags requires a valid termId.");
            this.error = "Invalid Term ID provided.";
            return;
        }

        // Ensure unique, non-empty, sorted tag names
        const uniqueValidTagNames = [...new Set(tagNames)]
                                      .map(t => t?.trim()) // Trim whitespace
                                      .filter(Boolean)    // Remove empty strings
                                      .sort();

        try {
            // 1. Delete existing tags for this termId and user
            console.log(`[SearchTags] Deleting existing tags for term ${termId}...`);
            const { error: deleteError } = await supabase
                .from('search_tags')
                .delete()
                .eq('scrape_job_id', termId)
                .eq('user_id', auth.user.id); // Ensure user isolation

            if (deleteError) throw deleteError;

            // 2. Insert new tags if any are provided
            if (uniqueValidTagNames.length > 0) {
                 console.log(`[SearchTags] Inserting new tags for term ${termId}:`, uniqueValidTagNames);
                 const rowsToInsert = uniqueValidTagNames.map(tagName => ({
                    scrape_job_id: termId,
                    tag: tagName,
                    user_id: auth.user.id, // Include user_id on insert
                 }));

                const { error: insertError } = await supabase
                    .from('search_tags')
                    .insert(rowsToInsert);

                if (insertError) throw insertError;
            }

            // 3. Update the local termTags cache
            this.termTags[termId] = uniqueValidTagNames;
            // Ensure reactivity if needed
            this.termTags = { ...this.termTags };

            // 4. Update the global unique tags list (state.tags)
            uniqueValidTagNames.forEach(tag => {
                if (!this.tags.includes(tag)) {
                    this.tags.push(tag);
                }
            });
            this.tags.sort(); // Keep the global list sorted

            console.log(`[SearchTags] Tags successfully set for term ${termId}.`);

        } catch (error) {
            console.error(`[SearchTags] Error setting tags for term ${termId}:`, error);
            this.error = error.message || `Failed to set tags for term ${termId}.`;
            // Revert local state? Maybe re-fetch to be safe?
            // delete this.termTags[termId]; // Simple revert
            // await this.fetchTagsAndRelationships(); // More robust revert
        }
    },

    /** Resets the store state, respecting persistence config. */
    reset() {
        console.log('[SearchTags] Resetting state...');
        this.tags = [];
        this.termTags = {};
        this.loaded = false;
        this.loading = false;
        this.error = null;
    },

     /** Removes a tag globally and from all associated terms. Use with caution! */
     async deleteTagGlobally(tagName) {
         console.warn(`[SearchTags] Deleting tag globally: "${tagName}"`);
         this.error = null;
         const auth = useAuthStore();
         if (!auth.user) {
             this.error = "Cannot delete tag: User not logged in.";
             console.error(this.error);
             return;
         }
         if (!tagName?.trim()){
             this.error = "Cannot delete empty tag name.";
             console.error(this.error);
             return;
         }
         try {
             // Delete all instances of this tag for this user from the join table
             const { error: deleteError } = await supabase
                 .from('search_tags')
                 .delete()
                 .eq('tag', tagName.trim())
                 .eq('user_id', auth.user.id);

             if (deleteError) throw deleteError;

             // Remove from local state: global tags list
             this.tags = this.tags.filter(t => t !== tagName.trim());

             // Remove from local state: termTags cache
             Object.keys(this.termTags).forEach(termId => {
                 this.termTags[termId] = this.termTags[termId].filter(t => t !== tagName.trim());
                 // Optional: delete termId key if array becomes empty
                 // if (this.termTags[termId].length === 0) {
                 //    delete this.termTags[termId];
                 // }
             });
             // Ensure reactivity
             this.termTags = { ...this.termTags };

             console.log(`[SearchTags] Tag "${tagName}" deleted globally and from local cache.`);

         } catch(error) {
             console.error(`[SearchTags] Error deleting tag globally "${tagName}":`, error);
             this.error = error.message || `Failed to delete tag "${tagName}".`;
         }
     }
  },
});