<script setup>
import { watch, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { normalizeToHtml } from '@/lib/richtext'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  // 'inline' fills its flex container (split-view editor); 'modal' is a bordered
  // fixed-height box (add/edit modal).
  variant: { type: String, default: 'inline' },
})
const emit = defineEmits(['update:modelValue'])

const editor = useEditor({
  content: normalizeToHtml(props.modelValue),
  extensions: [
    // StarterKit (TipTap v3) bundles Link, so configure it here rather than
    // registering a second Link extension.
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    Placeholder.configure({ placeholder: props.placeholder }),
  ],
  onUpdate: ({ editor }) => {
    // Treat a visually-empty doc as an empty string so guards/title logic stay simple.
    const html = editor.getHTML()
    emit('update:modelValue', editor.getText().trim() ? html : '')
  },
})

// Sync external changes (e.g. switching the selected note) without clobbering the
// cursor while the user types.
watch(
  () => props.modelValue,
  (value) => {
    if (!editor.value) return
    const next = normalizeToHtml(value)
    const current = editor.value.getText().trim() ? editor.value.getHTML() : ''
    if (next !== current) {
      editor.value.commands.setContent(next, false)
    }
  },
)

onBeforeUnmount(() => editor.value?.destroy())

function toggleLink() {
  if (!editor.value) return
  if (editor.value.isActive('link')) {
    editor.value.chain().focus().unsetLink().run()
    return
  }
  const previous = editor.value.getAttributes('link').href || ''
  const url = window.prompt('Link URL', previous)
  if (url === null) return // cancelled
  if (url === '') {
    editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}
</script>

<template>
  <div class="rte" :class="`rte-${variant}`">
    <div v-if="editor" class="rte-toolbar">
      <button
        type="button" class="rte-btn"
        :class="{ active: editor.isActive('bold') }"
        title="Bold"
        @click="editor.chain().focus().toggleBold().run()"
      ><span class="rte-bold">B</span></button>
      <button
        type="button" class="rte-btn"
        :class="{ active: editor.isActive('strike') }"
        title="Strikethrough"
        @click="editor.chain().focus().toggleStrike().run()"
      ><span class="rte-strike">S</span></button>
      <button
        type="button" class="rte-btn"
        :class="{ active: editor.isActive('orderedList') }"
        title="Numbered list"
        @click="editor.chain().focus().toggleOrderedList().run()"
      ><i class="pi pi-list"></i></button>
      <button
        type="button" class="rte-btn"
        :class="{ active: editor.isActive('link') }"
        title="Insert link"
        @click="toggleLink"
      ><i class="pi pi-link"></i></button>
    </div>
    <EditorContent class="rte-content" :editor="editor" />
  </div>
</template>

<style scoped>
.rte {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rte-inline { flex: 1; }

.rte-toolbar {
  display: flex;
  gap: 0.25rem;
  align-items: center;
  padding: 0.375rem 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.5rem;
}

.rte-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.rte-btn:hover { background: var(--bg-sunken); color: var(--text); }
.rte-bold { font-weight: 700; }
.rte-strike { font-weight: 700; text-decoration: line-through; }
.rte-btn.active {
  background: var(--accent-100);
  color: var(--accent-600);
  border-color: var(--accent-400);
}

.rte-content { display: flex; flex-direction: column; }
.rte-inline .rte-content { flex: 1; }

/* ── Editable surface ── */
.rte :deep(.ProseMirror) {
  outline: none;
  color: var(--text);
  font-size: 1rem;
  line-height: 1.7;
  font-family: inherit;
}
.rte-inline :deep(.ProseMirror) {
  min-height: 22rem;
  padding: 0.5rem 0;
}
.rte-modal {
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  padding: 0.5rem 1.25rem 1rem;
  background: #fff;
}
.rte-modal:focus-within { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }
.rte-modal :deep(.ProseMirror) {
  min-height: 11rem;
  font-size: 0.9375rem;
  line-height: 1.65;
}

/* Placeholder for an empty document (provided by the Placeholder extension) */
.rte :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  color: var(--text-faint);
  float: left;
  height: 0;
  pointer-events: none;
}

/* Formatting marks/nodes */
/* base.css applies a global `* { font-weight: normal }` reset, so bold needs an
   explicit weight to render inside the editor. */
.rte :deep(.ProseMirror strong),
.rte :deep(.ProseMirror b) { font-weight: 700; }
.rte :deep(.ProseMirror p) { margin: 0 0 0.5rem; }
.rte :deep(.ProseMirror p:last-child) { margin-bottom: 0; }
.rte :deep(.ProseMirror ol) { padding-left: 1.5rem; margin: 0 0 0.5rem; }
.rte :deep(.ProseMirror ul) { padding-left: 1.5rem; margin: 0 0 0.5rem; }
.rte :deep(.ProseMirror li) { margin: 0.125rem 0; }
.rte :deep(.ProseMirror s) { text-decoration: line-through; }
.rte :deep(.ProseMirror a) {
  color: var(--accent-600);
  text-decoration: underline;
  cursor: pointer;
}
</style>
