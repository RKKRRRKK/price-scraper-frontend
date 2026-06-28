<template>
  <div ref="host" class="sql-merge" :class="{ readonly }"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { MergeView } from '@codemirror/merge'
import {
  sql,
  StandardSQL,
  PostgreSQL,
  MySQL,
  MSSQL,
  SQLite,
} from '@codemirror/lang-sql'

// Side-by-side diff editor: left (a) = baseline/original (read-only), right (b) =
// candidate. Removed lines highlight red on the left, added lines green on the
// right, and MergeView inserts spacer rows so matching lines stay aligned.
const props = defineProps({
  original: { type: String, default: '' },   // left / baseline (a)
  modelValue: { type: String, default: '' }, // right / candidate (b)
  dialect: { type: String, default: 'bigquery' },
  readonly: { type: Boolean, default: false }, // when true, right side is read-only too
  scrollLock: { type: Boolean, default: true }, // when true, scrolling one pane scrolls the other
})
const emit = defineEmits(['update:modelValue'])

const host = ref(null)
let view = null
const langA = new Compartment()
const langB = new Compartment()
const editB = new Compartment()

// ── Scroll locking ──
// MergeView doesn't sync scroll position between its two editors. When the lock
// is on we mirror scrollTop/scrollLeft from the pane being scrolled to the other,
// guarded by a reentrancy flag so the mirrored write doesn't echo back.
let scrollers = null
let onScrollA = null
let onScrollB = null
let syncing = false
function makeSync(from, to) {
  return () => {
    if (!props.scrollLock || syncing) return
    syncing = true
    to.scrollTop = from.scrollTop
    to.scrollLeft = from.scrollLeft
    requestAnimationFrame(() => { syncing = false })
  }
}

const DIALECTS = {
  bigquery: StandardSQL,
  standard: StandardSQL,
  postgresql: PostgreSQL,
  mysql: MySQL,
  mssql: MSSQL,
  sqlite: SQLite,
}
const dialectFor = (n) => DIALECTS[n] || StandardSQL
const sqlExt = () => sql({ dialect: dialectFor(props.dialect), upperCaseKeywords: false })

onMounted(() => {
  view = new MergeView({
    parent: host.value,
    orientation: 'a-b',
    highlightChanges: true,
    gutter: true,
    a: {
      doc: props.original,
      extensions: [
        basicSetup,
        langA.of(sqlExt()),
        EditorView.editorAttributes.of({ class: 'merge-a' }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
      ],
    },
    b: {
      doc: props.modelValue,
      extensions: [
        basicSetup,
        langB.of(sqlExt()),
        EditorView.editorAttributes.of({ class: 'merge-b' }),
        editB.of([
          EditorState.readOnly.of(props.readonly),
          EditorView.editable.of(!props.readonly),
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !props.readonly) {
            const v = u.state.doc.toString()
            if (v !== props.modelValue) emit('update:modelValue', v)
          }
        }),
      ],
    },
  })

  const aScroller = view.a.scrollDOM
  const bScroller = view.b.scrollDOM
  onScrollA = makeSync(aScroller, bScroller)
  onScrollB = makeSync(bScroller, aScroller)
  aScroller.addEventListener('scroll', onScrollA, { passive: true })
  bScroller.addEventListener('scroll', onScrollB, { passive: true })
  scrollers = { aScroller, bScroller }
})

onBeforeUnmount(() => {
  if (scrollers) {
    scrollers.aScroller.removeEventListener('scroll', onScrollA)
    scrollers.bScroller.removeEventListener('scroll', onScrollB)
    scrollers = null
  }
  view?.destroy()
  view = null
})

watch(
  () => props.original,
  (val) => {
    if (!view) return
    const cur = view.a.state.doc.toString()
    if (val !== cur) view.a.dispatch({ changes: { from: 0, to: cur.length, insert: val ?? '' } })
  },
)
watch(
  () => props.modelValue,
  (val) => {
    if (!view) return
    const cur = view.b.state.doc.toString()
    if (val !== cur) view.b.dispatch({ changes: { from: 0, to: cur.length, insert: val ?? '' } })
  },
)
watch(
  () => props.dialect,
  () => {
    if (!view) return
    view.a.dispatch({ effects: langA.reconfigure(sqlExt()) })
    view.b.dispatch({ effects: langB.reconfigure(sqlExt()) })
  },
)
watch(
  () => props.readonly,
  (ro) => {
    if (!view) return
    view.b.dispatch({
      effects: editB.reconfigure([
        EditorState.readOnly.of(ro),
        EditorView.editable.of(!ro),
      ]),
    })
  },
)
</script>

<style scoped>
.sql-merge {
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  overflow: hidden;
  background: #fff;
  font-size: 0.9375rem;
  /* Taller default, plus a native drag handle (bottom-right) to resize on the go. */
  height: 30rem;
  min-height: 14rem;
  max-height: 85vh;
  resize: vertical;
  display: flex;
  flex-direction: column;
}
/* By default MergeView forces each editor to height:auto / overflow:visible and
   scrolls both panes as one via the outer .cm-mergeView. We instead give each
   editor its OWN scroller (overriding those !important base rules) so the two
   panes can scroll independently; the scroll-lock JS mirrors them when locked. */
.sql-merge :deep(.cm-mergeView) {
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.sql-merge :deep(.cm-mergeViewEditors) {
  height: 100%;
  min-height: 0;
}
.sql-merge :deep(.cm-editor) {
  height: 100% !important;
  min-height: 0 !important;
}
.sql-merge :deep(.cm-editor.cm-focused) { outline: none; }
.sql-merge :deep(.cm-editor .cm-scroller) {
  overflow-y: auto !important;
  min-height: 0;
  font-family: 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace;
  line-height: 1.6;
}

/* Left = baseline: show removals in red. Right = candidate: additions in green. */
.sql-merge :deep(.merge-a .cm-changedLine) { background: oklch(0.94 0.05 25); }
.sql-merge :deep(.merge-a .cm-changedText) { background: oklch(0.86 0.11 25); }
.sql-merge :deep(.merge-b .cm-changedLine) { background: oklch(0.95 0.05 150); }
.sql-merge :deep(.merge-b .cm-changedText) { background: oklch(0.88 0.11 150); }

/* Deleted-chunk widgets (when present) follow the same red treatment. */
.sql-merge :deep(.cm-deletedChunk) { background: oklch(0.95 0.04 25); }
.sql-merge :deep(.cm-deletedChunk .cm-deletedText) { background: oklch(0.88 0.11 25); }

/* Alignment spacers sit flush with the sunken theme. */
.sql-merge :deep(.cm-mergeSpacer) { background: var(--bg-sunken); }
</style>
