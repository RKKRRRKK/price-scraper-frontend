<template>
  <div class="welcome">
    <img
      src="/newfavicon2.png"
      alt="QuantiCart"
      class="fox"
    />

    <div class="welcome-text">
      <h1>Welcome to <span class="name">QuanHu!</span></h1>
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
  margin-left: 15rem;
  opacity: 0.25;
  flex: 0 1 auto; /* allow shrinking */
  margin-top: 15rem;
  height: clamp(600px, 70vh, 100vh);
  filter: grayscale(50%);
  
}

.welcome-text {
  flex: 1 1 auto; /* allow shrinking */
  min-width: 0;    /* enable proper flex-shrink */
  color: #333;
}

.welcome-text h1 {
  font-size: clamp(2.5rem, 8vw, 5rem);
  font-weight: 700;
  margin-bottom: 1.5rem;
  white-space: nowrap; /* keep on one line when there's room */
}

.welcome-text p {
  font-size: clamp(1rem, 3vw, 2rem);
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

/* Mobile: stack vertically, text below fox */
@media (max-width: 600px) {
  .welcome {
    flex-direction: column;
    margin-left: 20vw;
    padding: 0;
  }
  .fox {
    margin: 0;
    height: clamp(300px, 40vh, 60vh);
  }
  .welcome-text {
    margin-top: 1rem;
  }
  .welcome-text h1 {
    white-space: normal;
  }
}
</style>
