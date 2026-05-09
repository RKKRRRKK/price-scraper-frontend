<template>
  <div class="documents-app">
    <div class="documents-main">
      <div class="documents-header">
        <div>
          <div class="eyebrow">Productivity</div>
          <h1 class="documents-title">Documents</h1>
        </div>
        <div class="header-actions">
          <button class="btn-ghost" @click="openNewFolder">
            <i class="pi pi-folder-plus" style="font-size: 0.875rem; margin-right: 0.375rem;"></i>
            New Folder
          </button>
          <button class="add-btn" @click="openScanner">
            <i class="pi pi-camera" style="font-size: 0.875rem;"></i>
            Scan
          </button>
        </div>
      </div>

      <div class="breadcrumbs">
        <button class="crumb" :class="{ current: currentFolderId === null }" @click="enterFolder(null)">
          <i class="pi pi-home" style="font-size: 0.75rem; margin-right: 0.375rem;"></i>
          All Documents
        </button>
        <template v-for="(c, i) in store.folderPath(currentFolderId)" :key="c.id">
          <i class="pi pi-angle-right crumb-sep"></i>
          <button
            class="crumb"
            :class="{ current: i === store.folderPath(currentFolderId).length - 1 }"
            @click="enterFolder(c.id)"
          >{{ c.name }}</button>
        </template>
      </div>

      <div v-if="store.loading && !store.loaded" class="empty">
        <i class="pi pi-spin pi-spinner" style="font-size: 2.5rem; color: var(--accent-500);"></i>
        <div class="empty-sub">Loading documents…</div>
      </div>

      <div
        v-else-if="!visibleFolders.length && !visibleDocuments.length"
        class="empty"
      >
        <div class="empty-art">
          <i class="pi pi-images" style="font-size: 3.5rem; color: var(--text-faint);"></i>
        </div>
        <div class="empty-title">{{ currentFolderId ? 'This folder is empty' : 'No documents yet' }}</div>
        <div class="empty-sub">Capture a document with your phone or pick an image to scan.</div>
        <div class="empty-actions">
          <button class="add-btn add-btn-lg" @click="openScanner">
            <i class="pi pi-camera" style="font-size: 0.875rem;"></i> New Scan
          </button>
        </div>
      </div>

      <div v-else class="grid">
        <div
          v-for="f in visibleFolders"
          :key="f.id"
          class="folder-card"
          @dblclick="enterFolder(f.id)"
        >
          <button class="folder-body" @click="enterFolder(f.id)">
            <i class="pi pi-folder folder-icon"></i>
            <span class="folder-name">{{ f.name }}</span>
            <span class="folder-meta">{{ folderItemCount(f.id) }}</span>
          </button>
          <div class="card-actions">
            <button class="icon-btn" @click.stop="openRenameFolder(f)" title="Rename">
              <i class="pi pi-pencil" style="font-size: 0.8125rem;"></i>
            </button>
            <button class="icon-btn icon-danger" @click.stop="confirmDeleteFolder(f)" title="Delete folder">
              <i class="pi pi-trash" style="font-size: 0.8125rem;"></i>
            </button>
          </div>
        </div>

        <div
          v-for="d in visibleDocuments"
          :key="d.id"
          class="doc-card"
          @click="openPreview(d)"
        >
          <div class="doc-thumb">
            <img v-if="thumbUrls[d.id]" :src="thumbUrls[d.id]" :alt="d.name" />
            <i v-else class="pi pi-file-pdf doc-thumb-icon"></i>
          </div>
          <div class="doc-info">
            <div class="doc-name" :title="d.name">{{ d.name }}</div>
            <div class="doc-meta">{{ formatDate(d.captured_at) }} · {{ formatSize(d.size_bytes) }}</div>
          </div>
          <div class="card-actions">
            <button class="icon-btn" @click.stop="downloadDocument(d)" title="Download">
              <i class="pi pi-download" style="font-size: 0.8125rem;"></i>
            </button>
            <button class="icon-btn" @click.stop="openMoveDocument(d)" title="Move">
              <i class="pi pi-arrows-alt" style="font-size: 0.8125rem;"></i>
            </button>
            <button class="icon-btn icon-danger" @click.stop="confirmDeleteDocument(d)" title="Delete">
              <i class="pi pi-trash" style="font-size: 0.8125rem;"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <DocumentScannerModal
      v-if="scannerOpen"
      :initial-folder-id="currentFolderId"
      @close="scannerOpen = false"
      @saved="onScanSaved"
    />

    <div v-if="folderModal.open" class="modal-backdrop" @click.self="closeFolderModal">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">{{ folderModal.mode === 'add' ? 'New Folder' : 'Rename Folder' }}</span>
          <button class="modal-close" @click="closeFolderModal">
            <i class="pi pi-times" style="font-size: 0.875rem;"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Name</label>
            <input
              type="text"
              class="sel"
              v-model="folderModal.name"
              placeholder="Folder name"
              @keydown.enter="submitFolder"
              ref="folderNameInput"
            />
          </div>
          <div v-if="folderModal.mode === 'add'" class="field">
            <label>Inside</label>
            <select class="sel" v-model="folderModal.parent_id">
              <option :value="null">All Documents (root)</option>
              <option v-for="o in folderPickerOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
            </select>
          </div>
        </div>
        <div class="modal-foot">
          <button class="add-btn" @click="submitFolder" :disabled="!folderModal.name.trim() || folderModal.saving">
            {{ folderModal.mode === 'add' ? 'Create' : 'Save' }}
          </button>
          <button class="btn-ghost" @click="closeFolderModal">Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="moveModal.open" class="modal-backdrop" @click.self="closeMoveModal">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">Move Document</span>
          <button class="modal-close" @click="closeMoveModal">
            <i class="pi pi-times" style="font-size: 0.875rem;"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Destination</label>
            <select class="sel" v-model="moveModal.target">
              <option :value="null">All Documents (root)</option>
              <option v-for="o in folderPickerOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
            </select>
          </div>
        </div>
        <div class="modal-foot">
          <button class="add-btn" @click="submitMove" :disabled="moveModal.saving">Move</button>
          <button class="btn-ghost" @click="closeMoveModal">Cancel</button>
        </div>
      </div>
    </div>

    <div v-if="preview.doc" class="modal-backdrop preview-backdrop" @click.self="closePreview">
      <div class="modal preview-modal">
        <div class="modal-head">
          <span class="modal-title">{{ preview.doc.name }}</span>
          <div class="preview-head-actions">
            <button class="icon-btn" @click="downloadDocument(preview.doc)" title="Download">
              <i class="pi pi-download" style="font-size: 0.875rem;"></i>
            </button>
            <button class="modal-close" @click="closePreview">
              <i class="pi pi-times" style="font-size: 0.875rem;"></i>
            </button>
          </div>
        </div>
        <div class="modal-body preview-body">
          <div v-if="preview.loading" class="preview-loading">
            <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
          </div>
          <img v-else-if="preview.url" :src="preview.url" :alt="preview.doc.name" class="preview-image" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import { useDocumentsStore } from '@/stores/documents'
import DocumentScannerModal from '@/components/DocumentScannerModal.vue'

const store = useDocumentsStore()

const currentFolderId = ref(null)
const scannerOpen = ref(false)

const folderModal = reactive({
  open: false,
  mode: 'add',
  id: null,
  name: '',
  parent_id: null,
  saving: false,
})
const folderNameInput = ref(null)

const moveModal = reactive({
  open: false,
  doc: null,
  target: null,
  saving: false,
})

const preview = reactive({
  doc: null,
  url: '',
  loading: false,
})

const thumbUrls = ref({})

onMounted(async () => {
  await store.fetchAll()
  refreshThumbnails()
})

const visibleFolders = computed(() => store.folderChildren(currentFolderId.value))
const visibleDocuments = computed(() => store.documentsInFolder(currentFolderId.value))

const folderPickerOptions = computed(() => {
  const out = []
  const walk = (parentId, depth) => {
    for (const f of store.folderChildren(parentId)) {
      out.push({
        id: f.id,
        label: `${'\u00A0\u00A0'.repeat(depth)}${depth > 0 ? '↳ ' : ''}${f.name}`,
      })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
})

watch(visibleDocuments, refreshThumbnails)

async function refreshThumbnails() {
  for (const d of visibleDocuments.value) {
    if (thumbUrls.value[d.id]) continue
    try {
      thumbUrls.value[d.id] = await store.getSignedUrl(d.storage_path, 600)
    } catch (e) {
      console.warn('[Documents] thumb failed:', e)
    }
  }
}

function folderItemCount(folderId) {
  const docs = store.documentsInFolder(folderId).length
  const subs = store.folderChildren(folderId).length
  const parts = []
  if (subs) parts.push(`${subs} folder${subs === 1 ? '' : 's'}`)
  if (docs) parts.push(`${docs} doc${docs === 1 ? '' : 's'}`)
  return parts.length ? parts.join(' · ') : 'Empty'
}

function enterFolder(id) {
  currentFolderId.value = id
}

function openScanner() {
  scannerOpen.value = true
}

function onScanSaved() {
  refreshThumbnails()
}

function openNewFolder() {
  folderModal.mode = 'add'
  folderModal.id = null
  folderModal.name = ''
  folderModal.parent_id = currentFolderId.value
  folderModal.open = true
  nextTick(() => folderNameInput.value?.focus())
}

function openRenameFolder(f) {
  folderModal.mode = 'rename'
  folderModal.id = f.id
  folderModal.name = f.name
  folderModal.parent_id = f.parent_id
  folderModal.open = true
  nextTick(() => folderNameInput.value?.focus())
}

function closeFolderModal() {
  folderModal.open = false
}

async function submitFolder() {
  if (!folderModal.name.trim() || folderModal.saving) return
  folderModal.saving = true
  try {
    if (folderModal.mode === 'add') {
      await store.createFolder({
        name: folderModal.name,
        parent_id: folderModal.parent_id,
      })
    } else {
      await store.renameFolder(folderModal.id, folderModal.name)
    }
    closeFolderModal()
  } catch (e) {
    // surfaced via store.error
  } finally {
    folderModal.saving = false
  }
}

async function confirmDeleteFolder(f) {
  const docs = store.documentsInFolder(f.id).length
  const subs = store.folderChildren(f.id).length
  const extra = docs || subs
    ? ` This will permanently remove ${docs} document(s) and ${subs} subfolder(s) inside it.`
    : ''
  if (!confirm(`Delete "${f.name}"?${extra}`)) return
  await store.deleteFolder(f.id)
}

function openMoveDocument(d) {
  moveModal.doc = d
  moveModal.target = d.folder_id ?? null
  moveModal.open = true
}
function closeMoveModal() {
  moveModal.open = false
  moveModal.doc = null
}
async function submitMove() {
  if (!moveModal.doc || moveModal.saving) return
  moveModal.saving = true
  try {
    await store.moveDocument(moveModal.doc.id, moveModal.target)
    closeMoveModal()
  } finally {
    moveModal.saving = false
  }
}

async function confirmDeleteDocument(d) {
  if (!confirm(`Delete "${d.name}"?`)) return
  await store.deleteDocument(d.id)
  delete thumbUrls.value[d.id]
}

async function openPreview(d) {
  preview.doc = d
  preview.url = ''
  preview.loading = true
  try {
    preview.url = await store.getSignedUrl(d.storage_path, 600)
  } finally {
    preview.loading = false
  }
}
function closePreview() {
  preview.doc = null
  preview.url = ''
}

async function downloadDocument(d) {
  try {
    const url = await store.getSignedUrl(d.storage_path, 60, true)
    const a = document.createElement('a')
    a.href = url
    const ext = d.mime_type === 'image/png' ? 'png' : 'jpg'
    a.download = `${d.name}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  } catch (e) {
    console.error('[Documents] download failed:', e)
  }
}

function formatDate(ts) {
  return ts ? dayjs(ts).format('MMM D, YYYY · h:mm A') : ''
}

function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<style scoped>
.documents-app {
  --accent-hue: 295;
  --accent-500: oklch(0.56 0.18 var(--accent-hue));
  --accent-600: oklch(0.5 0.18 var(--accent-hue));
  --accent-400: oklch(0.68 0.14 var(--accent-hue));
  --accent-100: oklch(0.96 0.025 var(--accent-hue));
  --accent-050: oklch(0.985 0.012 var(--accent-hue));

  --bg-card: #ffffff;
  --bg-sunken: #f3f2f0;
  --border: #e5e4e1;
  --border-soft: #eeede9;
  --text: #1a1a1a;
  --text-dim: #5c5c5c;
  --text-faint: #9a9a9a;

  --radius: 0.75rem;
  --radius-lg: 1rem;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02);
  --shadow: 0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 8px 30px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);

  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif;
  color: var(--text);
  font-size: 0.9375rem;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  min-height: calc(100vh - 5rem);
}

.documents-app button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}
.documents-app input,
.documents-app select {
  font: inherit;
  color: inherit;
}

.documents-main {
  padding: 2.25rem 1.5rem 5rem;
  max-width: 64rem;
  margin: 0 auto;
  width: 100%;
}

.documents-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 2rem;
  margin-bottom: 1.25rem;
}
.eyebrow {
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--accent-600);
  margin-bottom: 0.375rem;
  text-transform: uppercase;
}
.documents-title {
  font-size: 2.25rem;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.02em;
}
.header-actions {
  display: flex;
  gap: 0.625rem;
}

.documents-app .add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: var(--accent-500);
  color: #fff;
  padding: 0.625rem 1.5rem;
  height: 2.625rem;
  border-radius: 0.625rem;
  font-size: 0.9375rem;
  font-weight: 600;
  box-shadow: 0 0.125rem 0.5rem oklch(0.5 0.18 var(--accent-hue) / 0.25);
  transition: background 120ms, transform 120ms;
  white-space: nowrap;
}
.documents-app .add-btn:hover:not(:disabled) {
  background: var(--accent-600);
  transform: translateY(-1px);
}
.documents-app .add-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.documents-app .add-btn-lg {
  height: 3.125rem;
  padding: 0.875rem 2.5rem;
  font-size: 1rem;
}

.documents-app .btn-ghost {
  padding: 0.5625rem 1.25rem;
  height: 2.625rem;
  border-radius: 0.625rem;
  font-size: 0.875rem;
  color: var(--text-dim);
  border: 1px solid var(--border);
  background: #fff;
  display: inline-flex;
  align-items: center;
  font-weight: 500;
  transition: all 120ms;
}
.documents-app .btn-ghost:hover:not(:disabled) {
  border-color: var(--text-faint);
  color: var(--text);
  background: var(--bg-sunken);
}

.documents-app .icon-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  transition: all 120ms;
}
.documents-app .icon-btn:hover {
  background: var(--bg-sunken);
  color: var(--text);
}
.documents-app .icon-danger:hover {
  background: #fff0f0;
  color: #c33;
}

.breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 1.5rem;
  font-size: 0.875rem;
}
.crumb {
  padding: 0.25rem 0.625rem;
  border-radius: 0.4375rem;
  color: var(--text-dim);
  font-weight: 500;
  transition: all 120ms;
  display: inline-flex;
  align-items: center;
}
.crumb:hover {
  background: var(--bg-sunken);
  color: var(--text);
}
.crumb.current {
  color: var(--accent-600);
  background: var(--accent-100);
}
.crumb-sep {
  color: var(--text-faint);
  font-size: 0.75rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
  gap: 1rem;
}

.folder-card,
.doc-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-sm);
  transition: border-color 120ms, transform 120ms, box-shadow 120ms;
}
.folder-card:hover,
.doc-card:hover {
  border-color: var(--accent-400);
  transform: translateY(-1px);
  box-shadow: var(--shadow);
}
.folder-card:hover .card-actions,
.doc-card:hover .card-actions {
  opacity: 1;
}

.folder-body {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.125rem;
  text-align: left;
  width: 100%;
}
.folder-icon {
  font-size: 1.5rem;
  color: var(--accent-500);
  flex-shrink: 0;
}
.folder-name {
  font-weight: 600;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.folder-meta {
  font-size: 0.75rem;
  color: var(--text-faint);
  white-space: nowrap;
}

.doc-card {
  cursor: pointer;
}
.doc-thumb {
  aspect-ratio: 4 / 3;
  background: var(--bg-sunken);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.doc-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.doc-thumb-icon {
  font-size: 2.5rem;
  color: var(--text-faint);
}
.doc-info {
  padding: 0.75rem 0.875rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.doc-name {
  font-size: 0.9375rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-meta {
  font-size: 0.75rem;
  color: var(--text-faint);
}

.card-actions {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  gap: 0.25rem;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(4px);
  padding: 0.25rem;
  border-radius: 0.5rem;
  opacity: 0;
  transition: opacity 120ms;
  box-shadow: var(--shadow-sm);
}

.empty {
  background: var(--bg-card);
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  padding: 5rem 2.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
.empty-art { margin-bottom: 0.5rem; }
.empty-title { font-size: 1.25rem; font-weight: 600; }
.empty-sub { font-size: 0.9375rem; color: var(--text-dim); }
.empty-actions { display: flex; gap: 0.75rem; margin-top: 1rem; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: fade-in 140ms;
}
.modal {
  background: #fff;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 28rem;
  max-width: calc(100vw - 1.5rem);
  max-height: calc(100vh - 1.5rem);
  display: flex;
  flex-direction: column;
  animation: pop-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.1);
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.125rem 1.5rem;
  border-bottom: 1px solid var(--border-soft);
}
.modal-title {
  font-size: 1.125rem;
  font-weight: 700;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modal-close {
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  transition: all 120ms;
}
.modal-close:hover {
  background: var(--bg-sunken);
  color: var(--text);
}

.modal-body {
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.field > label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  font-weight: 600;
}

.sel {
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.5625rem 1rem;
  height: 2.5rem;
  font-size: 0.875rem;
  background: #fff;
  outline: none;
}
.sel:focus {
  border-color: var(--accent-400);
  box-shadow: 0 0 0 3px var(--accent-100);
}

.modal-foot {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-soft);
}

.preview-backdrop {
  background: rgba(0, 0, 0, 0.7);
}
.preview-modal {
  width: 56rem;
  max-width: calc(100vw - 1.5rem);
}
.preview-head-actions {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.preview-body {
  padding: 1rem;
  background: var(--bg-sunken);
  align-items: center;
  justify-content: center;
  min-height: 18rem;
}
.preview-image {
  max-width: 100%;
  max-height: 75vh;
  display: block;
  margin: 0 auto;
  border-radius: 0.5rem;
  box-shadow: var(--shadow);
}
.preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  color: var(--text-faint);
}

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop-in {
  from { opacity: 0; transform: translateY(0.375rem) scale(0.97); }
  to { opacity: 1; transform: none; }
}

@media (max-width: 36em) {
  .documents-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }
  .header-actions {
    width: 100%;
  }
  .header-actions > * {
    flex: 1;
  }
  .card-actions {
    opacity: 1;
  }
}
</style>
