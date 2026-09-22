<template>
  <div class="welcome">
    <img
      src="/everything.webp"
      alt="QuantiCart"
      class="fox"
    />

    <div class="welcome-text">
      <h1>Welcome to <span class="name">Kumquant!</span></h1>
      <p>Get started by creating a new folder.</p>
      <p>After doing this, you will be able to create scrape jobs and results will appear after first scheduled run is complete</p>
    </div>
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
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 2rem;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
}

.fox {
  margin-left: 0rem;
  opacity: 0.25;
  flex: 0 1 auto; /* allow shrinking */
  margin-top: 2em;
  margin-right: 2rem;
  /* the 500px floor was wider than the whole flex row on a small laptop, which
     squeezed the greeting out of view; cap the width and let it letterbox */
  height: clamp(15rem, 60vh, 100vh);
  max-width: 40%;
  object-fit: contain;
  filter: grayscale(50%);
  
}

.welcome-text {
  flex: 1 1 auto; /* allow shrinking */
  min-width: 0;    /* enable proper flex-shrink */
  color: #333;
}

.welcome-text h1 {
  /* 8vw outran the column the moment the fruit took its share of the row */
  font-size: clamp(2rem, 5vw, 5rem);
  font-weight: 700;
  margin-bottom: 1.5rem;
  /* it still sits on one line wherever it fits; nowrap made it overrun the
     column instead of breaking when it didn't */
  text-wrap: balance;
}

.welcome-text p {
  font-size: clamp(1rem, 1.6vw, 2rem);
  color: #555;
  margin-top: 1rem;
}

.name {
  display: inline-block;
  font-weight: 800;
  /* base color + sheen layer */
  background: 
    linear-gradient(

      120deg,
      transparent 0%,
        transparent 5%,
      rgba(255, 255, 255, 1) 50%,
             transparent 51%,
      transparent 100%
    ),
    #F97316;
  border-color: red;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  background-size: 200% 100%;
  background-position: -200% 0;
  animation: sheen 4s cubic-bezier(0.65, 0, 0.35, 1) infinite;
}

@keyframes sheen {
  0% {
    background-position: 100% 0;
    transform: scale(1);
    text-shadow: 2px 10px 10px rgba(0,0,0,0);
  }


  7.5% {
      transform: scale(1.15);
      text-shadow: 1px 1px 350px rgba(253, 218, 171, 0.5);
  }
    8% {
    background-position: -90% 0;
    opacity: 1;
    text-shadow: 0px 0px 0px transparent;
    text-shadow: 2px 2px 10px rgba(0,0,0,0.0);
 
  }
  15% {
    background-position: -90% 0;
    opacity: 1;
    transform: scale(1);
    text-shadow: 0px 0px 0px transparent;
    text-shadow: 2px 2px 10px rgba(0,0,0,0.0);
 
  }
  100% {
    background-position: -90% 0;
    opacity: 1;
          transform: scale(1);
    text-shadow: 2px 2px 10px rgba(0,0,0,0.00);

  }
}

/* Stack vertically once the folder rail plus the fruit leave the greeting too
   narrow to read — that happens well before phone width, since the rail alone
   is 18rem of a side-by-side row. */
@media (max-width: 61.99em) {
  .welcome {
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 0;
  }
  .fox {
    margin: 0;
    max-width: 80%;
    height: clamp(9rem, 32vh, 60vh);
  }
  .welcome-text {
    margin-top: 1rem;
  }
}
</style>
