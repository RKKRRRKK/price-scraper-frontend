<template>
    <div class="welcome">
      <h1>Welcome!</h1>
      <div class="text">
      <p>First create a folder and a file to start with.</p>
      <p>After doing this, you will be able to create scrape jobs.</p>
      <p>Your results will be visible after the first scheduled run.</p>
      <p>Ensure your search terms and conditions will yield correct results on the target site.</p>
      <p></p>
    </div>
 
    </div>
  </template>
  
  <script setup>
  // purely presentational
  </script>
  
  <style scoped>
  .welcome{
 
    transform: translate(40rem, 5rem);
    color: var(--text-color-secondary);
 
  }
  .welcome h1 {
    margin-bottom: 2rem;
    font-weight:900
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  </style>