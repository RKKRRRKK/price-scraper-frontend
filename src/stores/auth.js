import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'

export const useAuthStore = defineStore('auth', {
  // No persistence needed for auth state itself, session is handled by Supabase
  persist: false,
  state: () => ({
    user: null, // Supabase User object
    session: null, // Supabase Session object
    error: null, // To store login/auth errors
    initialized: false, // Track if init() has completed
  }),
  actions: {
    /**
     * Initializes the auth store by checking the current session
     * and setting up a listener for auth state changes.
     * Should be called once when the app loads (e.g., in App.vue).
     */
    async init() {
      if (this.initialized) {
        console.log('[AuthStore] Already initialized.');
        return;
      }
      console.log('[AuthStore] Initializing...');
      try {
        // 1) Attempt to load any existing session from Supabase storage
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
            console.error('[AuthStore] Error getting session:', error.message);
            // Decide how to handle session fetch errors - maybe clear state?
            this.session = null;
            this.user = null;
        } else {
            this.session = session;
            this.user = session?.user ?? null;
            console.log('[AuthStore] Session loaded:', this.session ? 'Exists' : 'None');
        }


        // 2) Listen for future auth state changes (LOGIN, LOGOUT, TOKEN_REFRESHED, etc.)
        supabase.auth.onAuthStateChange((event, session) => {
          console.log(`[AuthStore] onAuthStateChange event: ${event}`, session);
          this.session = session;
          this.user = session?.user ?? null;
          this.error = null; // Clear previous errors on state change
        });

        // 3) Mark initialization complete
        this.initialized = true;
        console.log('[AuthStore] Initialization complete.');

      } catch (err) {
        console.error('[AuthStore] Initialization failed:', err);
        // Ensure state is clean if init fails catastrophically
        this.user = null;
        this.session = null;
        this.initialized = false; // Mark as not ready
        this.error = 'Authentication service failed to initialize.';
      }
    },

    /**
     * Attempts to log in the user with email and password.
     * @param {string} email
     * @param {string} password
     * @returns {Promise<boolean>} True if login successful, false otherwise.
     */
    async login(email, password) {
      console.log('[AuthStore] Attempting login...');
      this.error = null; // Clear previous errors
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          console.error('[AuthStore] Login failed:', error.message);
          this.error = error.message; // Store specific error message
          // State (user/session) will be updated by onAuthStateChange listener
          return false;
        }
        // Login successful, onAuthStateChange listener will update user/session state.
        console.log('[AuthStore] Login successful.');
        return true;
      } catch (err) {
          console.error('[AuthStore] Unexpected error during login:', err);
          this.error = 'An unexpected error occurred during login.';
          return false;
      }
    },

    /**
     * Logs out the current user.
     */
    async logout() {
      console.log('[AuthStore] Logging out...');
      this.error = null;
      try {
          const { error } = await supabase.auth.signOut();
          if (error) {
              console.error('[AuthStore] Logout failed:', error.message);
              this.error = error.message; // Store error, though state should still clear
          }
           // State (user/session) will be cleared by onAuthStateChange listener.
          console.log('[AuthStore] Logout process initiated.');
          // No need to manually set user/session to null here,
          // the onAuthStateChange listener handles it reliably.
      } catch (err) {
          console.error('[AuthStore] Unexpected error during logout:', err);
          this.error = 'An unexpected error occurred during logout.';
          // Ensure state is clear even if signOut fails unexpectedly
          this.user = null;
          this.session = null;
      }
    },

    // Note: No explicit reset() needed here as logout() + onAuthStateChange
    // handle the state clearing. The `initialized` flag persists across logout/login.
  }
})