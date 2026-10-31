<!-- File: src/components/groovy/GroovyModal.vue -->
<!--
  The sheet the metronome and the tuner open in. It covers the tool, not the
  page: it is positioned against .groovy-app (which is position: relative), so
  it inherits the tool's colour tokens and leaves the app navbar alone.

  Esc is handled by the view, which closes the top popup before it does
  anything else with the key.
-->
<template>
  <Transition name="gm">
    <div v-if="open" class="gm-scrim" @pointerdown.self="$emit('close')">
      <section
        ref="panel"
        class="gm"
        :class="tone"
        :style="{ '--gm-width': width }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
      >
        <header class="gm-head">
          <h2 class="gm-title">{{ title }}</h2>
          <div class="gm-tools"><slot name="tools" /></div>
          <button class="gm-x" title="Close (Esc)" @click="$emit('close')">
            <i class="pi pi-times"></i>
          </button>
        </header>
        <div class="gm-body">
          <slot />
        </div>
      </section>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  width: { type: String, default: '44rem' },
  // 'light' | 'dark' — the tuner is a dark instrument face.
  tone: { type: String, default: 'light' },
})
defineEmits(['close'])

const panel = ref(null)

watch(
  () => props.open,
  async (v) => {
    if (!v) return
    await nextTick()
    panel.value?.focus({ preventScroll: true })
  },
)
</script>

<style scoped>
.gm-scrim {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(24, 22, 20, 0.34);
  backdrop-filter: blur(6px) saturate(0.9);
  -webkit-backdrop-filter: blur(6px) saturate(0.9);
}

:where(.gm button) {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}

.gm {
  --gm-ink: var(--text);
  --gm-bg: #fff;
  --gm-line: var(--border-soft);
  width: min(var(--gm-width), 100%);
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--gm-bg);
  color: var(--gm-ink);
  border-radius: 1.1rem;
  box-shadow:
    0 1.5rem 4rem rgba(0, 0, 0, 0.22),
    0 0.25rem 1rem rgba(0, 0, 0, 0.08);
  outline: none;
  overflow: hidden;
}

.gm.dark {
  --gm-ink: #f4f3ef;
  --gm-bg: #141312;
  --gm-line: rgba(255, 255, 255, 0.08);
}

.gm-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 0.85rem 0.6rem 1.35rem;
}

.gm-title {
  margin: 0;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--accent-500);
}

.gm-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.gm-x {
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 0.72rem;
  opacity: 0.6;
  transition:
    opacity 120ms,
    background 120ms;
}

.gm-x:hover {
  opacity: 1;
  background: rgba(127, 127, 127, 0.14);
}

.gm-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 1.35rem 1.35rem;
}

/* ── Transition ── */
.gm-enter-active,
.gm-leave-active {
  transition: opacity 200ms ease;
}

.gm-enter-active .gm,
.gm-leave-active .gm {
  transition: transform 260ms cubic-bezier(0.2, 0.9, 0.25, 1.15);
}

.gm-enter-from,
.gm-leave-to {
  opacity: 0;
}

.gm-enter-from .gm,
.gm-leave-to .gm {
  transform: translateY(0.75rem) scale(0.97);
}

@media (max-width: 767.98px) {
  .gm-scrim {
    padding: 0.5rem;
    place-items: end center;
  }

  .gm-body {
    padding: 0 1rem 1rem;
  }
}
</style>
