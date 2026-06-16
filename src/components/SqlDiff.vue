<template>
  <div class="sql-diff">
    <div v-if="!hasChange" class="diff-empty">
      <i class="pi pi-equals" style="font-size: 0.875rem;"></i>
      No differences between these versions.
    </div>
    <pre v-else class="diff-body"><template v-for="(line, i) in lines" :key="i"><span
      class="diff-line"
      :class="line.kind"
    ><span class="diff-gutter">{{ gutter(line.kind) }}</span><span class="diff-text">{{ line.text || ' ' }}</span></span></template></pre>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { diffLines } from 'diff'

const props = defineProps({
  before: { type: String, default: '' },
  after: { type: String, default: '' },
})

// Produce a flat list of { kind: 'added'|'removed'|'same', text } lines.
const lines = computed(() => {
  const parts = diffLines(props.before || '', props.after || '')
  const out = []
  for (const part of parts) {
    const kind = part.added ? 'added' : part.removed ? 'removed' : 'same'
    // Split into lines but drop the trailing empty entry from a final newline.
    const partLines = part.value.split('\n')
    if (partLines.length && partLines[partLines.length - 1] === '') partLines.pop()
    for (const text of partLines) out.push({ kind, text })
  }
  return out
})

const hasChange = computed(() => lines.value.some(l => l.kind !== 'same'))

function gutter(kind) {
  if (kind === 'added') return '+'
  if (kind === 'removed') return '-'
  return ' '
}
</script>

<style scoped>
.sql-diff {
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  background: var(--bg-sunken);
  overflow: auto;
  max-height: 24rem;
}
.diff-empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.25rem;
  color: var(--text-faint);
  font-size: 0.875rem;
}
.diff-body {
  margin: 0;
  padding: 0.5rem 0;
  font-family: 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.diff-line {
  display: flex;
  align-items: flex-start;
}
.diff-gutter {
  flex: 0 0 1.5rem;
  text-align: center;
  user-select: none;
  color: var(--text-faint);
}
.diff-text {
  flex: 1;
  padding-right: 0.75rem;
}
.diff-line.added {
  background: oklch(0.94 0.06 150);
}
.diff-line.added .diff-gutter { color: oklch(0.45 0.13 150); }
.diff-line.removed {
  background: oklch(0.93 0.06 25);
}
.diff-line.removed .diff-gutter { color: oklch(0.5 0.16 25); }
</style>
