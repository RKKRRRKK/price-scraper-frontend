<template>
  <div class="welcome">
    <!-- oversized faint icon in the background -->
<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="rgba(0,0,0,0.05)" class="size-6">
  <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
</svg>


    <Dialog v-model:visible="visible" modal header="Welcome!" :style="{ width: '30rem' }">
      <div class="dialog-text">
        <p>First create a folder and a file to start with.</p>
        <p>After doing this, you will be able to create scrape jobs.</p>
        <p>Your results will be visible after the first scheduled run.</p>
        <p>Ensure your search terms and conditions will yield correct results on the target site.</p>
      </div>

      <template #footer>
        <Button label="OK" @click="visible = false" autofocus />
      </template>
    </Dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';

const visible = ref(true);
</script>

<style scoped>
.welcome {
  position: absolute;
  overflow: hidden;
  display: flex;
  top: 15%;
  left: 35%;
 
}

.background-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 80%; /* scales with viewport */
  height: 80%;
  transform: translate(-50%, -50%);
  opacity: 0.01; /* slight transparency */
  stroke: var(--text-color-secondary);
  pointer-events: none; /* ignore pointer events so it doesn’t block dialog */
}

.dialog-text p + p {
  margin-top: 1rem;
}
</style>
