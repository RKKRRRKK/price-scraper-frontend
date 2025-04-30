<template>
    <div class="login-page">
      <div class="login-card">
        <h2>Login</h2>
        <p class="login-subtitle">Closed beta, accounts by invite only</p>
  
        <form @submit.prevent="onSubmit" class="login-form">
          <div class="form-group">
            <label for="email">Email</label>
            <InputText
              id="email"
              v-model="email"
              placeholder="username@email.com"
              class="login-input"
            />
          </div>
  
          <div class="form-group mt-4">
            <label for="password">Password</label>
            <Password
              id="password"
              v-model="password"
              toggleMask
                :feedback="false"
              class="login-input"
            />
          </div>
  
          <p v-if="auth.error" class="text-red-600 mt-2">
            {{ auth.error }}
          </p>
  
          <Button
            type="submit"
            label="Sign in"
            class="login-button mt-6"
          />
        </form>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  import { useRouter } from 'vue-router'
  import InputText from 'primevue/inputtext'
  import Password from 'primevue/password'
  import Button from 'primevue/button'
  import { useAuthStore } from '@/stores/auth'
  
  const auth = useAuthStore()
  const router = useRouter()
  
  const email = ref('')
  const password = ref('')
  
  async function onSubmit() {
    auth.error = null
    const ok = await auth.login(email.value, password.value)
    if (ok) {
      router.push({ name: 'home' })
    }
  }
  </script>
  
  
  <style scoped>
  /* Fullscreen centered flex container */
  .login-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    min-width: 100vw;
    background: var(--surface-ground);
  }
  
  /* Card */
  .login-card {
    width: 100%;
    max-width: 400px;
    background: var(--surface-card);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    padding: 2rem;
    padding-top: 1.5rem;
    padding-bottom: 1.5rem;
  }
  
  /* Title + subtitle */
  .login-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-color);
  }
  
  .login-subtitle {
    margin: 0.5rem 0 1rem;
    font-size: 0.875rem;
    color: var(--text-secondary-color);
  }
  
  /* Form groups */
   .form-group {
    margin-bottom: 0rem;
     
  }
  .login-form {
    margin-top: 0rem;
  }
 
  
  .login-form label {
    display: block;
    margin-bottom: 0.25rem;
    font-size: 0.875rem;
    color: var(--text-color);
  }
  
  /* Ensure all direct input elements span full width */
  .login-input {
    width: 100%;
    box-sizing: border-box;
  }
  
  /* Use Vue scoped deep selector to target Password internals */
  .login-input::v-deep(.p-inputwrapper) {
    display: flex !important;
    align-items: center;
  }
  
  .login-input::v-deep(.p-password-input) {
    flex: 1 1 auto !important;
    width: auto !important;
    box-sizing: border-box;
  }
  
  .login-input::v-deep(.p-password-toggle-mask-icon) {
    margin-left: 0.5rem;
    cursor: pointer;
  }
  
  .login-button {
    margin-top: 1.5rem;
    width: 100%;
  }
  
  .login-button:hover {
    background: var(--primary-color-hover);
  }
  
  .login-button:active {
    background: var(--primary-color-active);
  }
  </style>
  