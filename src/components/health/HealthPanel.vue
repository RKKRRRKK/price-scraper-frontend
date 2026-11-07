<template>
  <section class="hx-panel" :style="accent ? { '--accent': accent } : null">
    <header class="hx-panel-head">
      <div class="hx-panel-title">
        <slot name="title">
          <span class="hx-dot" />
          <h2>{{ title }}</h2>
          <span v-if="sub" class="hx-panel-sub">{{ sub }}</span>
        </slot>
      </div>
      <div class="hx-panel-meta"><slot name="meta" /></div>
      <div class="hx-panel-actions"><slot name="actions" /></div>
    </header>
    <div class="hx-panel-body"><slot /></div>
    <div v-if="loading" class="hx-panel-loading" />
  </section>
</template>

<script setup>
// Card frame every dashboard panel shares: title (or a custom #title slot),
// header stats (#meta), controls (#actions), and a flex body that charts fill.
defineProps({
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  accent: { type: String, default: '' },
  loading: { type: Boolean, default: false },
})
</script>
