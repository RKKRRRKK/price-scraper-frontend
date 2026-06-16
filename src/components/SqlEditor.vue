<template>
  <div ref="host" class="sql-editor" :class="{ readonly }"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, placeholder as cmPlaceholder } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import {
  sql,
  StandardSQL,
  PostgreSQL,
  MySQL,
  MSSQL,
  SQLite,
} from '@codemirror/lang-sql'

const props = defineProps({
  modelValue: { type: String, default: '' },
  dialect: { type: String, default: 'bigquery' },
  readonly: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const host = ref(null)
let view = null
const langCompartment = new Compartment()
const editCompartment = new Compartment()

// BigQuery isn't a named lang-sql dialect; StandardSQL is the closest match.
const DIALECTS = {
  bigquery: StandardSQL,
  standard: StandardSQL,
  postgresql: PostgreSQL,
  mysql: MySQL,
  mssql: MSSQL,
  sqlite: SQLite,
}

function dialectFor(name) {
  return DIALECTS[name] || StandardSQL
}

onMounted(() => {
  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      basicSetup,
      langCompartment.of(sql({ dialect: dialectFor(props.dialect), upperCaseKeywords: false })),
      editCompartment.of([
        EditorState.readOnly.of(props.readonly),
        EditorView.editable.of(!props.readonly),
      ]),
      cmPlaceholder(props.placeholder),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !props.readonly) {
          const value = update.state.doc.toString()
          if (value !== props.modelValue) emit('update:modelValue', value)
        }
      }),
    ],
  })
  view = new EditorView({ state, parent: host.value })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

// Sync external value changes (e.g. loading a version into the pane).
watch(
  () => props.modelValue,
  (val) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (val !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: val ?? '' } })
    }
  },
)

watch(
  () => props.dialect,
  (d) => {
    if (!view) return
    view.dispatch({
      effects: langCompartment.reconfigure(
        sql({ dialect: dialectFor(d), upperCaseKeywords: false }),
      ),
    })
  },
)

watch(
  () => props.readonly,
  (ro) => {
    if (!view) return
    view.dispatch({
      effects: editCompartment.reconfigure([
        EditorState.readOnly.of(ro),
        EditorView.editable.of(!ro),
      ]),
    })
  },
)
</script>

<style scoped>
.sql-editor {
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  overflow: hidden;
  background: #fff;
  font-size: 0.9375rem;
}
.sql-editor.readonly {
  background: var(--bg-sunken);
}
.sql-editor :deep(.cm-editor) {
  min-height: 9rem;
  max-height: 32rem;
}
.sql-editor :deep(.cm-editor.cm-focused) {
  outline: none;
}
.sql-editor :deep(.cm-scroller) {
  font-family: 'SF Mono', 'Cascadia Code', Menlo, Consolas, 'Liberation Mono', monospace;
  line-height: 1.55;
}
.sql-editor :deep(.cm-content) {
  padding: 0.75rem 0;
}
.sql-editor.readonly :deep(.cm-content) {
  cursor: default;
}
</style>
