<template>
    <div class="login-page">
      <div class="login-card">
        <h2 class="login-title">Login</h2>
        <p class="login-subtitle">
          Closed beta, accounts provided on request
        </p>
        <form @submit.prevent="onSubmit" class="login-form">
          <div class="form-group">
            <label for="name">Name</label>
            <InputText
              id="name"
              v-model="name"
              placeholder=""
              class="login-input"
            />
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <Password
              id="password"
              v-model="password"
              toggleMask
              class="login-input"
            />
          </div>
          <Button type="submit" label="Sign in" class="login-button" />
        </form>
      </div>
    </div>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  import InputText from 'primevue/inputtext'
  import Password from 'primevue/password'
  import Button from 'primevue/button'
  
  const name = ref('')
  const password = ref('')
  
  function onSubmit() {
    // your login logic
    console.log('login with', email.value, password.value)
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
  