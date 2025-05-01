// File: src\stores\sidebar.js
import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth' // Needed to get user_id

export const useSidebarStore = defineStore('sidebar', {
  state: () => ({
    folders: [],         // Array of { id, name, files: [{ id, name }] }
    expandedKeys: {},     // PrimeVue Tree state for expanded nodes { 'folderId': true }
    selectedFile: null,   // { folderId, fileId } or null
    loaded: false,        // Flag: Have folders been fetched for the current session?
    loading: false,       // Flag: Is a fetch currently in progress?
  }),

  // Persist only the expandedKeys across page reloads/sessions
  persist: {
    paths: ['expandedKeys'] // Correct syntax for Pinia 3+ persist plugin
  },

  actions: {
    /**
     * Fetches folders and their nested files for the currently logged-in user.
     * Avoids redundant fetches if data is already loaded.
     */
    async fetchFolders() {
      if (this.loaded || this.loading) {
         console.log(`[SidebarStore] Skipping fetchFolders (Loaded: ${this.loaded}, Loading: ${this.loading})`);
         return;
      }

      const auth = useAuthStore();
      if (!auth.user) {
        console.warn('[SidebarStore] Cannot fetch folders: User not logged in.');
        this.reset(); // Ensure state is clear if user logs out somehow
        return;
      }

      console.log('[SidebarStore] Fetching folders...');
      this.loading = true;
      this.error = null; // Assuming you might add an error state property

      try {
        const { data, error } = await supabase
          .from('folders')
          .select('id, name, files(id, name)') // Select files nested within folders
          .eq('user_id', auth.user.id)
          .order('name', { ascending: true }) // Order folders by name
          // If you need files ordered too: .order('name', { foreignTable: 'files', ascending: true })

        if (error) {
            console.error('[SidebarStore] Error fetching folders:', error);
            throw error; // Rethrow to be caught below
        }

        this.folders = data || []; // Ensure folders is an array even if data is null/undefined
        this.loaded = true;
        console.log('[SidebarStore] Folders fetched successfully:', this.folders.length);

      } catch (error) {
        console.error('[SidebarStore] Fetch folders failed:', error);
        this.error = error.message || 'Failed to fetch folders.';
        this.loaded = false; // Reset loaded flag on error
        this.folders = []; // Clear potentially partial data
      } finally {
        this.loading = false;
      }
    },

    /** Resets the store state, typically on logout. Keeps persisted expandedKeys. */
    reset() {
        console.log('[SidebarStore] Resetting state...');
        this.folders = [];
        this.selectedFile = null;
        this.loaded = false;
        this.loading = false;
        this.error = null;
        // Note: `expandedKeys` is intentionally NOT reset here because it's persisted.
        // If you want to clear it on logout, uncomment the next line:
        // this.expandedKeys = {};
    },

    /** Clears the current file selection. */
    resetSelection() {
      this.selectedFile = null;
    },

    /** Updates the expanded keys state (used by PrimeVue Tree). */
    setExpandedKeys(keys) {
      this.expandedKeys = keys;
    },

    /** Sets the currently selected file. */
    selectFile(folderId, fileId) {
      // Basic validation
      if (typeof folderId !== 'number' || typeof fileId !== 'number') {
          console.warn(`[SidebarStore] Invalid selectFile call: folderId=${folderId}, fileId=${fileId}`);
          return;
      }
      this.selectedFile = { folderId, fileId };
      console.log('[SidebarStore] File selected:', this.selectedFile);
    },

    // --- FOLDER CRUD ---

    async addFolder(name) {
       console.log('[SidebarStore] Adding folder:', name);
       const auth = useAuthStore();
       if (!auth.user) return console.error("Cannot add folder: No user");

       try {
           const { data, error } = await supabase
             .from('folders')
             .insert({ user_id: auth.user.id, name: name.trim() })
             .select('id, name') // Select only necessary fields
             .single(); // Expecting a single row back

           if (error) throw error;
           if (!data) throw new Error("No data returned from insert.");

           // Add to local state
           this.folders.push({ id: data.id, name: data.name, files: [] });
           // Keep folders sorted alphabetically
           this.folders.sort((a, b) => a.name.localeCompare(b.name));
           console.log('[SidebarStore] Folder added:', data.id);

       } catch (error) {
           console.error('[SidebarStore] Error adding folder:', error);
           // Potentially set an error state or show a notification
       }
    },

    async renameFolder(folderId, newName) {
       console.log(`[SidebarStore] Renaming folder ${folderId} to:`, newName);
       try {
           const { error } = await supabase
             .from('folders')
             .update({ name: newName.trim() })
             .eq('id', folderId);

           if (error) throw error;

           // Update local state
           const folder = this.folders.find(f => f.id === folderId);
           if (folder) {
             folder.name = newName.trim();
             // Keep folders sorted
             this.folders.sort((a, b) => a.name.localeCompare(b.name));
             console.log('[SidebarStore] Folder renamed locally.');
           }
       } catch (error) {
           console.error('[SidebarStore] Error renaming folder:', error);
       }
    },

    async deleteFolder(folderId) {
      console.log('[SidebarStore] Deleting folder:', folderId);
       // Note: Supabase cascade delete should handle associated files if set up in DB schema.
       // If not, you'd need to delete files first.
      try {
           const { error } = await supabase
             .from('folders')
             .delete()
             .eq('id', folderId);

           if (error) throw error;

           // Remove from local state
           this.folders = this.folders.filter(f => f.id !== folderId);

           // Clear selection if the selected file was in the deleted folder
           if (this.selectedFile?.folderId === folderId) {
             this.selectedFile = null;
             console.log('[SidebarStore] Cleared selection as parent folder was deleted.');
           }
           // Clear expanded state for the deleted folder
           if (this.expandedKeys[String(folderId)]) {
             delete this.expandedKeys[String(folderId)];
             // Need to create a new object for reactivity if directly modifying
             this.expandedKeys = { ...this.expandedKeys };
           }
           console.log('[SidebarStore] Folder deleted locally.');

       } catch (error) {
           console.error('[SidebarStore] Error deleting folder:', error);
       }
    },

    // --- FILE CRUD ---

    async addFile(folderId, name) {
       console.log(`[SidebarStore] Adding file '${name}' to folder:`, folderId);
       const auth = useAuthStore();
       if (!auth.user) return console.error("Cannot add file: No user");

       try {
           const { data, error } = await supabase
             .from('files')
             .insert({ folder_id: folderId, user_id: auth.user.id, name: name.trim() })
             .select('id, name')
             .single();

           if (error) throw error;
           if (!data) throw new Error("No data returned from file insert.");

           // Add to local state
           const folder = this.folders.find(f => f.id === folderId);
           if (folder) {
             folder.files.push({ id: data.id, name: data.name });
             // Optional: sort files within the folder
             folder.files.sort((a, b) => a.name.localeCompare(b.name));
             console.log('[SidebarStore] File added locally:', data.id);
           } else {
             console.warn(`[SidebarStore] Could not add file locally: Folder ${folderId} not found.`);
             // Maybe re-fetch folders if state is inconsistent?
             // await this.fetchFolders(); // Be careful with loops
           }

       } catch (error) {
           console.error('[SidebarStore] Error adding file:', error);
       }
    },

    async renameFile(fileId, newName) {
       console.log(`[SidebarStore] Renaming file ${fileId} to:`, newName);
       try {
           const { error } = await supabase
             .from('files')
             .update({ name: newName.trim() })
             .eq('id', fileId);

           if (error) throw error;

           // Update local state
           let found = false;
           for (const folder of this.folders) {
             const file = folder.files.find(f => f.id === fileId);
             if (file) {
               file.name = newName.trim();
               // Optional: re-sort files within the folder
               folder.files.sort((a, b) => a.name.localeCompare(b.name));
               found = true;
               break;
             }
           }
           if (found) console.log('[SidebarStore] File renamed locally.');
           else console.warn(`[SidebarStore] Could not rename file locally: File ${fileId} not found.`);

       } catch (error) {
           console.error('[SidebarStore] Error renaming file:', error);
       }
    },

    async deleteFile(fileId) {
       console.log('[SidebarStore] Deleting file:', fileId);
       try {
           const { error } = await supabase
             .from('files')
             .delete()
             .eq('id', fileId);

           if (error) throw error;

           // Remove from local state
           let found = false;
           this.folders.forEach(folder => {
             const initialLength = folder.files.length;
             folder.files = folder.files.filter(f => f.id !== fileId);
             if (folder.files.length < initialLength) {
                found = true;
             }
           });

            // Clear selection if the deleted file was selected
           if (this.selectedFile?.fileId === fileId) {
             this.selectedFile = null;
             console.log('[SidebarStore] Cleared selection as file was deleted.');
           }

           if (found) console.log('[SidebarStore] File deleted locally.');
           else console.warn(`[SidebarStore] Could not delete file locally: File ${fileId} not found.`);

       } catch (error) {
           console.error('[SidebarStore] Error deleting file:', error);
       }
    }
  }
})