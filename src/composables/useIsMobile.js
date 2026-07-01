import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Reactive breakpoint helper. Matches the existing app breakpoint (767/768px).
 * Returns a ref that is true on mobile widths.
 */
export function useIsMobile(query = '(max-width: 767px)') {
  const mq = window.matchMedia(query)
  const isMobile = ref(mq.matches)
  const update = () => {
    isMobile.value = mq.matches
  }
  onMounted(() => mq.addEventListener('change', update))
  onUnmounted(() => mq.removeEventListener('change', update))
  return isMobile
}
