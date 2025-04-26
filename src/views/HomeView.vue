<script setup>
import SearchTermSection from '@/components/SearchTermSection.vue'
</script>

<template>
  <!-- give the wrapper a semantic class -->
  <div class="sections">
    <SearchTermSection marketplace="kleinanzeigen" title="Kleinanzeigen.de" />
    <SearchTermSection marketplace="bazos" title="Bazos.sk" />
  </div>
</template>

<style scoped>
/* one column on phones; two centred columns from 768 px up */
.sections {
  display: grid;
  gap: 1rem; /* space between cards */
  justify-content: center; /* this does the horizontal centring */
  grid-template-columns: 1fr; /* mobile default */
  transform-origin: top center;
  scale: 0.8;
}

@media (min-width: 768px) {
  .sections {
    grid-template-columns: repeat(2, minmax(300px, 1fr));
    gap: 10rem;
    margin: 5rem;
    margin-top: 1rem;
  }
}
</style>
