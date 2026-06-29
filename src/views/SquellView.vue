<template>
  <div class="squell-app">
    <!-- ── Catalogue rail ── -->
    <aside class="rail" :class="{ open: railOpen }">
      <div class="rail-head">
        <div class="rail-head-text">
          <div class="eyebrow">Tools</div>
          <h1 class="rail-title">Diffy</h1>
          <div class="rail-sub">{{ store.queries.length }} {{ store.queries.length === 1 ? 'query' : 'queries' }}</div>
        </div>
        <button class="icon-btn rail-close mobile-only" @click="railOpen = false" title="Close">
          <i class="pi pi-times" style="font-size: 0.875rem;"></i>
        </button>
      </div>

      <div class="rail-actions">
        <button class="add-btn rail-new" @click="openNewQuery">
          <i class="pi pi-plus" style="font-size: 0.8125rem;"></i> New query
        </button>
        <button class="icon-btn rail-newfolder" title="New folder" @click="startAddFolder">
          <i class="pi pi-folder-plus" style="font-size: 0.9rem;"></i>
        </button>
      </div>

      <div class="rail-search">
        <i class="pi pi-search"></i>
        <input v-model="railQuery" type="text" placeholder="Filter queries…" />
        <button v-if="railQuery" class="rail-search-clear" @click="railQuery = ''" title="Clear">
          <i class="pi pi-times"></i>
        </button>
      </div>

      <div class="rail-list">
        <div v-if="store.loading && !store.queries.length" class="rail-state">
          <i class="pi pi-spin pi-spinner" style="font-size: 1.25rem;"></i>
        </div>
        <div v-else-if="!store.queries.length && !store.folders.length && !addingFolder" class="rail-state">
          <i class="pi pi-database rail-state-icon"></i>
          <span>No queries yet.</span>
        </div>
        <div v-else-if="railQuery && !matchedQueries.length" class="rail-state">
          <i class="pi pi-search rail-state-icon"></i>
          <span>No matches for “{{ railQuery }}”.</span>
        </div>

        <template v-else>
          <!-- Inline new-folder input -->
          <div v-if="addingFolder" class="folder-add">
            <i class="pi pi-folder folder-icon"></i>
            <input
              ref="newFolderInput"
              v-model="newFolderName"
              type="text"
              placeholder="Folder name…"
              @keyup.enter="confirmAddFolder"
              @keyup.esc="cancelAddFolder"
              @blur="confirmAddFolder"
            />
          </div>

          <!-- Folders -->
          <div v-for="f in visibleFolders" :key="f.id" class="folder">
            <div class="folder-head" @click="toggleFolder(f.id)">
              <i class="pi folder-chevron" :class="isExpanded(f.id) ? 'pi-chevron-down' : 'pi-chevron-right'"></i>
              <i class="pi pi-folder folder-icon"></i>
              <input
                v-if="editingFolderId === f.id"
                class="folder-rename"
                v-model="editFolderName"
                @click.stop
                @keyup.enter="confirmRenameFolder(f)"
                @keyup.esc="cancelRenameFolder"
                @blur="confirmRenameFolder(f)"
                :ref="(el) => { if (el) el.focus() }"
              />
              <span v-else class="folder-name">{{ f.name }}</span>
              <span class="folder-count">{{ folderTotal(f.id) }}</span>
              <span class="folder-tools" @click.stop>
                <button class="folder-tool" title="Rename folder" @click="startRenameFolder(f)"><i class="pi pi-pencil"></i></button>
                <button class="folder-tool" title="Delete folder" @click="removeFolder(f)"><i class="pi pi-trash"></i></button>
              </span>
            </div>
            <div v-show="isExpanded(f.id)" class="folder-body">
              <button
                v-for="q in folderQueries(f.id)"
                :key="q.id"
                class="rail-item"
                :class="{ active: q.id === store.activeQueryId }"
                @click="selectQuery(q.id)"
              >
                <span class="rail-item-icon"><i class="pi pi-database"></i></span>
                <span class="rail-item-body">
                  <span class="rail-item-name">{{ q.name }}</span>
                  <span class="rail-meta">
                    <span class="dialect-badge">{{ dialectLabel(q.dialect) }}</span>
                    <span class="stat" title="Versions"><i class="pi pi-clone"></i>{{ versionCount(q.id) || '·' }}</span>
                    <span v-if="q.updated_at" class="stat stat-time" :title="'Updated ' + relTime(q.updated_at)">{{ shortAgo(q.updated_at) }}</span>
                  </span>
                </span>
                <span class="rail-item-kebab" role="button" title="Options" @click.stop="openRowMenu($event, q)"><i class="pi pi-ellipsis-v"></i></span>
              </button>
              <div v-if="!folderQueries(f.id).length" class="folder-empty">Empty</div>
            </div>
          </div>

          <!-- Ungrouped queries -->
          <div v-if="ungroupedQueries.length" class="folder-loose">
            <div v-if="visibleFolders.length" class="loose-label">No folder</div>
            <button
              v-for="q in ungroupedQueries"
              :key="q.id"
              class="rail-item"
              :class="{ active: q.id === store.activeQueryId }"
              @click="selectQuery(q.id)"
            >
              <span class="rail-item-icon"><i class="pi pi-database"></i></span>
              <span class="rail-item-body">
                <span class="rail-item-name">{{ q.name }}</span>
                <span class="rail-meta">
                  <span class="dialect-badge">{{ dialectLabel(q.dialect) }}</span>
                  <span class="stat" title="Versions"><i class="pi pi-clone"></i>{{ versionCount(q.id) || '·' }}</span>
                  <span v-if="q.updated_at" class="stat stat-time" :title="'Updated ' + relTime(q.updated_at)">{{ shortAgo(q.updated_at) }}</span>
                </span>
              </span>
              <span class="rail-item-kebab" role="button" title="Options" @click.stop="openRowMenu($event, q)"><i class="pi pi-ellipsis-v"></i></span>
            </button>
          </div>
        </template>
      </div>

      <!-- Per-query options menu (move to folder / delete) -->
      <div v-if="rowMenu.open" class="sq-menu-backdrop" @click="closeRowMenu" @contextmenu.prevent="closeRowMenu"></div>
      <div v-if="rowMenu.open" class="sq-menu" :style="{ top: rowMenu.y + 'px', left: rowMenu.x + 'px' }">
        <div class="sq-menu-label">Move to folder</div>
        <button class="sq-menu-item" :class="{ on: !menuQuery?.folder_id }" @click="moveTo(null)">
          <i class="pi pi-inbox"></i> No folder
        </button>
        <button
          v-for="f in foldersSorted"
          :key="f.id"
          class="sq-menu-item"
          :class="{ on: menuQuery?.folder_id === f.id }"
          @click="moveTo(f.id)"
        >
          <i class="pi pi-folder"></i> {{ f.name }}
        </button>
        <div v-if="!foldersSorted.length" class="sq-menu-hint">No folders yet — use the folder button.</div>
        <div class="sq-menu-sep"></div>
        <button class="sq-menu-item danger" @click="deleteFromMenu">
          <i class="pi pi-trash"></i> Delete query
        </button>
      </div>

      <div class="rail-foot">
        <button class="btn-ghost btn-sm" @click="exportAll('md')" :disabled="!store.queries.length">
          <i class="pi pi-download" style="font-size: 0.75rem;"></i> All .md
        </button>
        <button class="btn-ghost btn-sm" @click="exportAll('txt')" :disabled="!store.queries.length">
          <i class="pi pi-download" style="font-size: 0.75rem;"></i> All .txt
        </button>
      </div>
    </aside>

    <!-- ── Main ── -->
    <main class="main">
      <button class="btn-ghost btn-sm rail-toggle mobile-only" @click="railOpen = true">
        <i class="pi pi-bars" style="font-size: 0.75rem;"></i> Queries
      </button>

      <div v-if="!store.activeQuery" class="empty">
        <div class="empty-art"><i class="pi pi-database" style="font-size: 3.5rem; color: var(--text-faint);"></i></div>
        <div class="empty-title">No query selected</div>
        <div class="empty-sub">Create a new query or pick one from the list to compare versions.</div>
        <div class="empty-actions">
          <button class="add-btn add-btn-lg" @click="openNewQuery">
            <i class="pi pi-plus" style="font-size: 0.875rem;"></i> New query
          </button>
        </div>
      </div>

      <template v-else>
        <!-- Header -->
        <div class="q-header">
          <input
            class="q-name"
            v-model="nameDraft"
            @change="saveName"
            placeholder="Query name"
          />
          <div class="q-header-right">
            <select class="sel" v-model="dialectDraft" @change="saveDialect">
              <option v-for="d in DIALECTS" :key="d.value" :value="d.value">{{ d.label }}</option>
            </select>
            <button class="btn-ghost btn-sm" @click="exportOne('md')"><i class="pi pi-download" style="font-size: 0.75rem;"></i> .md</button>
            <button class="btn-ghost btn-sm" @click="exportOne('txt')"><i class="pi pi-download" style="font-size: 0.75rem;"></i> .txt</button>
            <button class="icon-btn icon-danger" @click="removeQuery" title="Delete query">
              <i class="pi pi-trash" style="font-size: 0.875rem;"></i>
            </button>
          </div>
        </div>

        <!-- Description -->
        <section class="card">
          <div class="card-head">
            <label class="card-label">Description — what this query does</label>
            <button
              class="ai-btn"
              :disabled="genDesc || !canGenerateDesc"
              :title="store.aiConfigured ? 'Generate with AI' : aiOffTitle"
              @click="generateDescription"
            >
              <i :class="genDesc ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'" style="font-size: 0.8125rem;"></i>
              {{ genDesc ? 'Generating…' : 'Generate' }}
            </button>
          </div>
          <textarea
            class="ta"
            v-model="descriptionDraft"
            @change="saveDescription"
            rows="3"
            placeholder="Describe the purpose of this query (or generate it with AI)."
          ></textarea>
        </section>

        <!-- Version timeline -->
        <div class="timeline">
          <span class="timeline-label">Versions</span>
          <button
            v-for="(v, i) in versions"
            :key="v.id"
            class="vchip"
            :class="{ active: isChipActive(i), latest: i === versions.length - 1 }"
            @click="reviewVersion(i)"
            :title="formatDate(v.created_at)"
          >v{{ v.version_number }}</button>
          <button
            v-if="mode === 'review'"
            class="vchip vchip-edit"
            @click="enterEditMode"
          ><i class="pi pi-pencil" style="font-size: 0.6875rem;"></i> New revision</button>
        </div>

        <!-- Side-by-side diff (left = baseline, red; right = candidate, green) -->
        <section class="compare">
          <div class="compare-head">
            <span class="pane-title half">{{ leftTitle }}</span>
            <span class="pane-title half right-half">
              <span class="pane-title-text">{{ rightTitle }}</span>
              <span class="pane-tools">
                <button
                  v-if="mode === 'edit'"
                  class="link-btn"
                  @click="candidateSql = leftSql"
                  title="Reset to baseline"
                >reset</button>
                <button
                  class="lock-toggle"
                  :class="{ on: scrollLock }"
                  @click="scrollLock = !scrollLock"
                  :title="scrollLock ? 'Scroll lock on — both panes scroll together. Click to unlock.' : 'Scroll lock off — panes scroll independently. Click to lock.'"
                >
                  <i :class="scrollLock ? 'pi pi-lock' : 'pi pi-lock-open'" style="font-size: 0.6875rem;"></i>
                  {{ scrollLock ? 'Scroll locked' : 'Scroll unlocked' }}
                </button>
              </span>
            </span>
          </div>
          <SqlMergeView
            :key="mergeKey"
            :original="leftSql"
            :model-value="mergeRight"
            :dialect="dialectDraft"
            :readonly="mode === 'review'"
            :scroll-lock="scrollLock"
            @update:model-value="onMergeInput"
          />
        </section>

        <!-- Notes — distinct user-written and AI-written, both editable -->
        <section class="card">
          <div class="note-block">
            <div class="card-head">
              <label class="card-label">
                <i class="pi pi-user" style="font-size: 0.6875rem;"></i> Your note — what changed in this revision
              </label>
              <span v-if="noteSaving" class="save-hint"><i class="pi pi-spin pi-spinner" style="font-size: 0.6875rem;"></i> Saving…</span>
            </div>
            <textarea
              class="ta"
              v-model="userNoteModel"
              @change="onUserNoteChange"
              rows="3"
              placeholder="Describe the change from the baseline, in your own words."
            ></textarea>
          </div>

          <div class="note-block note-block-ai">
            <div class="card-head">
              <label class="card-label">
                <i class="pi pi-sparkles" style="font-size: 0.6875rem;"></i> AI note
              </label>
              <button
                class="ai-btn"
                :disabled="genNote || !canGenerateNote"
                :title="store.aiConfigured ? 'Generate with AI' : aiOffTitle"
                @click="generateNote"
              >
                <i :class="genNote ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'" style="font-size: 0.8125rem;"></i>
                {{ genNote ? 'Generating…' : aiNoteModel ? 'Regenerate' : 'Generate' }}
              </button>
            </div>
            <textarea
              class="ta ta-ai"
              v-model="aiNoteModel"
              @change="onAiNoteChange"
              rows="3"
              placeholder="Generate an AI summary of the change — or write one here."
            ></textarea>
          </div>
        </section>

        <!-- Save bar (edit mode) -->
        <div v-if="mode === 'edit'" class="save-bar">
          <button class="add-btn" :disabled="!canSave || saving" @click="saveVersion">
            <i :class="saving ? 'pi pi-spin pi-spinner' : 'pi pi-save'" style="font-size: 0.875rem;"></i>
            {{ saving ? 'Saving…' : versions.length ? `Save as v${nextVersionNumber}` : 'Save first version' }}
          </button>
          <span v-if="!canSave && candidateSql.trim()" class="save-hint">No change from baseline.</span>
        </div>

        <p v-if="actionError" class="action-error">{{ actionError }}</p>
      </template>
    </main>

    <!-- ── New query modal ── -->
    <div v-if="newOpen" class="modal-backdrop" @click.self="newOpen = false">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">New query</span>
          <button class="modal-close" @click="newOpen = false"><i class="pi pi-times" style="font-size: 0.875rem;"></i></button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Name</label>
            <input class="sel" v-model="newForm.name" placeholder="e.g. Daily active users" />
          </div>
          <div class="field">
            <label>Dialect</label>
            <select class="sel" v-model="newForm.dialect">
              <option v-for="d in DIALECTS" :key="d.value" :value="d.value">{{ d.label }}</option>
            </select>
          </div>
          <div class="field">
            <label>Version 1 (left)</label>
            <SqlEditor v-model="newForm.sqlV1" :dialect="newForm.dialect" placeholder="Paste the first query…" />
          </div>
          <div class="field">
            <label>Version 2 (right) — optional</label>
            <SqlEditor v-model="newForm.sqlV2" :dialect="newForm.dialect" placeholder="Paste a second version to compare (optional)…" />
          </div>
        </div>
        <div class="modal-foot">
          <button class="add-btn" :disabled="!newForm.name.trim() || !newForm.sqlV1.trim() || creating" @click="submitNewQuery">
            {{ creating ? 'Creating…' : 'Create' }}
          </button>
          <button class="btn-ghost" @click="newOpen = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
dayjs.extend(relativeTime, { rounding: Math.floor })
import { useSquellStore } from '@/stores/squell'
import SqlEditor from '@/components/SqlEditor.vue'
import SqlMergeView from '@/components/SqlMergeView.vue'
import {
  buildQueryMarkdown,
  buildCatalogueMarkdown,
  downloadTextFile,
  slugify,
} from '@/lib/squellExport'

const store = useSquellStore()

const DIALECTS = [
  { value: 'bigquery', label: 'BigQuery' },
  { value: 'standard', label: 'Standard SQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mssql', label: 'SQL Server' },
  { value: 'sqlite', label: 'SQLite' },
]
function dialectLabel(v) {
  return DIALECTS.find(d => d.value === v)?.label || 'BigQuery'
}

const aiOffTitle = 'AI webhook not configured (set VITE_SQUELL_AI_WEBHOOK)'

// ── Local editing state ──
const mode = ref('edit')          // 'edit' | 'review'
const reviewIndex = ref(0)        // index into versions (the "after" of a review pair)
const candidateSql = ref('')
const candidateNote = ref('')     // user note for the in-progress (edit-mode) version
const candidateAiNote = ref('')   // AI note for the in-progress version
const reviewNoteDraft = ref('')   // editable user note for the reviewed version
const reviewAiNoteDraft = ref('') // editable AI note for the reviewed version
const nameDraft = ref('')
const descriptionDraft = ref('')
const dialectDraft = ref('bigquery')

const railOpen = ref(false)
const railQuery = ref('')

// Queries matching the current filter (by name). Used to build the grouped list.
const matchedQueries = computed(() => {
  const q = railQuery.value.trim().toLowerCase()
  if (!q) return store.queries
  return store.queries.filter((x) => (x.name || '').toLowerCase().includes(q))
})
const foldersSorted = computed(() =>
  [...store.folders].sort((a, b) => a.name.localeCompare(b.name)),
)
const ungroupedQueries = computed(() => matchedQueries.value.filter((q) => !q.folder_id))
function folderQueries(fid) {
  return matchedQueries.value.filter((q) => q.folder_id === fid)
}
function folderTotal(fid) {
  return store.queries.filter((q) => q.folder_id === fid).length
}
// While searching, hide folders with no matches; otherwise show all folders.
const visibleFolders = computed(() => {
  if (!railQuery.value.trim()) return foldersSorted.value
  return foldersSorted.value.filter((f) => folderQueries(f.id).length)
})

// ── Folder collapse state (persisted) ──
const COLLAPSE_KEY = 'squell.collapsedFolders'
const collapsedFolders = ref(new Set(loadCollapsed()))
function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]') } catch { return [] }
}
function persistCollapsed() {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsedFolders.value])) } catch { /* ignore */ }
}
function isExpanded(fid) {
  // Force-expand everything while filtering so matches are always visible.
  if (railQuery.value.trim()) return true
  return !collapsedFolders.value.has(fid)
}
function toggleFolder(fid) {
  const next = new Set(collapsedFolders.value)
  next.has(fid) ? next.delete(fid) : next.add(fid)
  collapsedFolders.value = next
  persistCollapsed()
}

// ── Folder create / rename / delete ──
const addingFolder = ref(false)
const newFolderName = ref('')
const newFolderInput = ref(null)
const editingFolderId = ref(null)
const editFolderName = ref('')

function startAddFolder() {
  addingFolder.value = true
  newFolderName.value = ''
  nextTick(() => newFolderInput.value?.focus())
}
function cancelAddFolder() {
  addingFolder.value = false
  newFolderName.value = ''
}
async function confirmAddFolder() {
  // Close first so the trailing @blur (after Enter/Esc) sees an empty draft and no-ops.
  const name = newFolderName.value.trim()
  addingFolder.value = false
  newFolderName.value = ''
  if (!name) return
  try { await store.createFolder(name) } catch { /* surfaced via store.error */ }
}
function startRenameFolder(f) {
  editingFolderId.value = f.id
  editFolderName.value = f.name
}
function cancelRenameFolder() {
  editingFolderId.value = null
  editFolderName.value = ''
}
async function confirmRenameFolder(f) {
  const name = editFolderName.value.trim()
  editingFolderId.value = null
  editFolderName.value = ''
  if (name && name !== f.name) {
    try { await store.renameFolder(f.id, name) } catch { /* ignore */ }
  }
}
async function removeFolder(f) {
  const n = folderTotal(f.id)
  const msg = n
    ? `Delete folder “${f.name}”? Its ${n} ${n === 1 ? 'query' : 'queries'} will become ungrouped (not deleted).`
    : `Delete folder “${f.name}”?`
  if (!window.confirm(msg)) return
  try { await store.deleteFolder(f.id) } catch { /* ignore */ }
}

// ── Per-query menu (move to folder / delete) ──
const rowMenu = ref({ open: false, queryId: null, x: 0, y: 0 })
const menuQuery = computed(() => store.queries.find((q) => q.id === rowMenu.value.queryId) || null)
function openRowMenu(e, q) {
  const r = e.currentTarget.getBoundingClientRect()
  const left = Math.min(r.left, window.innerWidth - 232)
  rowMenu.value = { open: true, queryId: q.id, x: Math.max(8, left), y: r.bottom + 4 }
}
function closeRowMenu() {
  rowMenu.value = { open: false, queryId: null, x: 0, y: 0 }
}
async function moveTo(folderId) {
  const id = rowMenu.value.queryId
  closeRowMenu()
  if (!id) return
  try { await store.moveQueryToFolder(id, folderId) } catch { /* ignore */ }
}
async function deleteFromMenu() {
  const q = menuQuery.value
  closeRowMenu()
  if (!q) return
  if (!window.confirm(`Delete query “${q.name}” and all its versions?`)) return
  try { await store.deleteQuery(q.id) } catch { /* ignore */ }
}

const scrollLock = ref(true)       // lock both diff panes to scroll together
const saving = ref(false)
const noteSaving = ref(false)
const genDesc = ref(false)
const genNote = ref(false)
const actionError = ref('')

const newOpen = ref(false)
const creating = ref(false)
const newForm = ref({ name: '', dialect: 'bigquery', sqlV1: '', sqlV2: '' })

onMounted(() => store.fetchQueries())

const versions = computed(() => store.activeVersions)
const latest = computed(() => versions.value[versions.value.length - 1] || null)
const nextVersionNumber = computed(() => (latest.value?.version_number || 0) + 1)

// Sync local drafts whenever the active query changes.
watch(
  () => store.activeQueryId,
  () => syncFromActive(),
)
watch(
  () => store.activeVersions.length,
  () => { if (mode.value === 'edit') candidateSql.value = latest.value?.sql_text || '' },
)

function syncFromActive() {
  const q = store.activeQuery
  actionError.value = ''
  candidateNote.value = ''
  candidateAiNote.value = ''
  if (!q) {
    mode.value = 'edit'
    nameDraft.value = ''
    descriptionDraft.value = ''
    dialectDraft.value = 'bigquery'
    candidateSql.value = ''
    return
  }
  nameDraft.value = q.name
  descriptionDraft.value = q.description || ''
  dialectDraft.value = q.dialect || 'bigquery'
  candidateSql.value = latest.value?.sql_text || ''
  // Default view: if there are 2+ versions, show the latest real comparison
  // (v[n-1] → v[n]); with a single version, drop into edit mode to build v2.
  if (versions.value.length >= 2) {
    mode.value = 'review'
    reviewIndex.value = versions.value.length - 1
  } else {
    mode.value = 'edit'
  }
  syncReviewNotes()
}

// Pull the reviewed version's stored notes into the editable drafts.
function syncReviewNotes() {
  const v = versions.value[reviewIndex.value]
  reviewNoteDraft.value = v?.note || ''
  reviewAiNoteDraft.value = v?.ai_note || ''
}
watch(reviewIndex, syncReviewNotes)

async function selectQuery(id) {
  railOpen.value = false
  await store.selectQuery(id)
  syncFromActive()
}

// ── Pane / diff wiring ──
const leftSql = computed(() => {
  if (mode.value === 'review') return versions.value[reviewIndex.value - 1]?.sql_text || ''
  return latest.value?.sql_text || ''
})
const rightSql = computed(() => {
  if (mode.value === 'review') return versions.value[reviewIndex.value]?.sql_text || ''
  return candidateSql.value
})
const leftTitle = computed(() => {
  if (mode.value === 'review') {
    const prev = versions.value[reviewIndex.value - 1]
    return prev ? `v${prev.version_number} (baseline)` : 'v1 (baseline)'
  }
  return latest.value ? `v${latest.value.version_number} (baseline)` : 'no baseline yet'
})
const rightTitle = computed(() => {
  if (mode.value === 'review') {
    const cur = versions.value[reviewIndex.value]
    return cur ? `v${cur.version_number}` : ''
  }
  return `v${nextVersionNumber.value} (candidate)`
})
// Note models route to edit-mode candidate drafts or the reviewed version's
// drafts depending on mode. In review mode, changes persist on blur/change.
const userNoteModel = computed({
  get: () => (mode.value === 'edit' ? candidateNote.value : reviewNoteDraft.value),
  set: (v) => { if (mode.value === 'edit') candidateNote.value = v; else reviewNoteDraft.value = v },
})
const aiNoteModel = computed({
  get: () => (mode.value === 'edit' ? candidateAiNote.value : reviewAiNoteDraft.value),
  set: (v) => { if (mode.value === 'edit') candidateAiNote.value = v; else reviewAiNoteDraft.value = v },
})

async function onUserNoteChange() {
  if (mode.value !== 'review') return // edit-mode notes persist when the version is saved
  const v = versions.value[reviewIndex.value]
  if (!v) return
  const note = reviewNoteDraft.value.trim() || null
  if (note === (v.note || null)) return
  await persistVersionNote(v.id, { note })
}
async function onAiNoteChange() {
  if (mode.value !== 'review') return
  const v = versions.value[reviewIndex.value]
  if (!v) return
  const ai_note = reviewAiNoteDraft.value.trim() || null
  if (ai_note === (v.ai_note || null)) return
  await persistVersionNote(v.id, { ai_note })
}
async function persistVersionNote(id, updates) {
  noteSaving.value = true
  try { await store.updateVersion(id, updates) }
  catch (e) { actionError.value = e.message || 'Failed to save note.' }
  finally { noteSaving.value = false }
}

// The right-hand doc for the merge view: live candidate while editing, or the
// selected version while reviewing.
const mergeRight = computed(() => (mode.value === 'review' ? rightSql.value : candidateSql.value))
function onMergeInput(val) {
  if (mode.value === 'edit') candidateSql.value = val
}
// Remount the merge editor only when the comparison context changes (query,
// mode, or reviewed version) — not on every keystroke.
const mergeKey = computed(
  () => `${store.activeQueryId}-${mode.value}-${reviewIndex.value}`,
)

function isChipActive(i) {
  // Highlight both members of the compared pair (baseline + candidate).
  if (mode.value === 'review') return i === reviewIndex.value || i === reviewIndex.value - 1
  return i === versions.value.length - 1
}
function reviewVersion(i) {
  // Clicking the latest chip in edit mode is a no-op; otherwise enter review.
  if (mode.value === 'edit' && i === versions.value.length - 1) return
  mode.value = 'review'
  // The oldest version has no predecessor, so pair it forward (v1 → v2) instead
  // of showing an empty "no prior version" baseline on the left.
  reviewIndex.value = Math.max(i, 1)
}
function enterEditMode() {
  mode.value = 'edit'
  candidateSql.value = latest.value?.sql_text || ''
  candidateNote.value = ''
  candidateAiNote.value = ''
}

// ── Save / mutate ──
const canSave = computed(
  () => mode.value === 'edit'
    && candidateSql.value.trim()
    && candidateSql.value !== (latest.value?.sql_text || ''),
)

async function saveVersion() {
  if (!canSave.value) return
  saving.value = true
  actionError.value = ''
  try {
    await store.addVersion(store.activeQueryId, {
      sql_text: candidateSql.value,
      note: candidateNote.value.trim() || null,
      ai_note: candidateAiNote.value.trim() || null,
    })
    // baseline shifts to the just-saved version; candidate seeds from it.
    candidateNote.value = ''
    candidateAiNote.value = ''
    candidateSql.value = latest.value?.sql_text || ''
    mode.value = 'edit'
  } catch (e) {
    actionError.value = e.message || 'Failed to save version.'
  } finally {
    saving.value = false
  }
}

async function saveName() {
  const name = nameDraft.value.trim()
  if (!name || name === store.activeQuery?.name) return
  try { await store.updateQuery(store.activeQueryId, { name }) }
  catch (e) { actionError.value = e.message }
}
async function saveDialect() {
  try { await store.updateQuery(store.activeQueryId, { dialect: dialectDraft.value }) }
  catch (e) { actionError.value = e.message }
}
async function saveDescription() {
  if (descriptionDraft.value === (store.activeQuery?.description || '')) return
  try { await store.updateQueryDescription(store.activeQueryId, descriptionDraft.value) }
  catch (e) { actionError.value = e.message }
}

async function removeQuery() {
  if (!confirm(`Delete query "${store.activeQuery?.name}" and all its versions?`)) return
  try { await store.deleteQuery(store.activeQueryId) }
  catch (e) { actionError.value = e.message }
}

// ── AI generation ──
const canGenerateDesc = computed(() => store.aiConfigured && !!latest.value)
const canGenerateNote = computed(() => {
  if (!store.aiConfigured) return false
  // Edit mode: need a real change to describe. Review mode: need a current version.
  if (mode.value === 'edit') return canSave.value
  return !!versions.value[reviewIndex.value]
})

async function generateDescription() {
  if (!canGenerateDesc.value) return
  genDesc.value = true
  actionError.value = ''
  try {
    const text = await store.generateAi('description', {
      dialect: dialectDraft.value,
      query_name: nameDraft.value,
      sql: latest.value?.sql_text || '',
    })
    descriptionDraft.value = text
    await saveDescription()
  } catch (e) {
    actionError.value = e.message || 'AI generation failed.'
  } finally {
    genDesc.value = false
  }
}

async function generateNote() {
  if (!canGenerateNote.value) return
  genNote.value = true
  actionError.value = ''
  try {
    let previousSql, currentSql
    if (mode.value === 'edit') {
      previousSql = latest.value?.sql_text || ''
      currentSql = candidateSql.value
    } else {
      previousSql = versions.value[reviewIndex.value - 1]?.sql_text || ''
      currentSql = versions.value[reviewIndex.value]?.sql_text || ''
    }
    const text = await store.generateAi('diff_note', {
      dialect: dialectDraft.value,
      query_name: nameDraft.value,
      previous_sql: previousSql,
      current_sql: currentSql,
    })
    aiNoteModel.value = text
    if (mode.value === 'review') await onAiNoteChange()
  } catch (e) {
    actionError.value = e.message || 'AI generation failed.'
  } finally {
    genNote.value = false
  }
}

// ── New query ──
function openNewQuery() {
  newForm.value = { name: '', dialect: dialectDraft.value || 'bigquery', sqlV1: '', sqlV2: '' }
  newOpen.value = true
}
async function submitNewQuery() {
  if (!newForm.value.name.trim() || !newForm.value.sqlV1.trim()) return
  creating.value = true
  try {
    await store.createQuery({
      name: newForm.value.name,
      dialect: newForm.value.dialect,
      sqlV1: newForm.value.sqlV1,
      sqlV2: newForm.value.sqlV2,
    })
    syncFromActive()
    newOpen.value = false
  } catch (e) {
    actionError.value = e.message || 'Failed to create query.'
  } finally {
    creating.value = false
  }
}

// ── Export ──
async function exportOne(format) {
  const q = store.activeQuery
  if (!q) return
  const vs = store.versionsByQuery[q.id] || (await store.fetchVersions(q.id))
  const md = buildQueryMarkdown(q, vs)
  const ext = format === 'md' ? 'md' : 'txt'
  const mime = format === 'md' ? 'text/markdown' : 'text/plain'
  downloadTextFile(`squell-${slugify(q.name)}.${ext}`, md, mime)
}
async function exportAll(format) {
  // Ensure every query's versions are loaded before building the catalogue.
  await Promise.all(
    store.queries
      .filter(q => !store.versionsByQuery[q.id])
      .map(q => store.fetchVersions(q.id)),
  )
  const md = buildCatalogueMarkdown(store.queries, store.versionsByQuery)
  const ext = format === 'md' ? 'md' : 'txt'
  const mime = format === 'md' ? 'text/markdown' : 'text/plain'
  downloadTextFile(`squell-catalogue.${ext}`, md, mime)
}

function formatDate(ts) {
  return ts ? dayjs(ts).format('MMM D, YYYY · h:mm A') : ''
}
function relTime(ts) {
  return ts ? dayjs(ts).fromNow() : ''
}
function shortAgo(ts) {
  if (!ts) return ''
  const s = Math.max(0, dayjs().diff(dayjs(ts), 'second'))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 2592000) return `${Math.floor(s / 86400)}d`
  if (s < 31536000) return `${Math.floor(s / 2592000)}mo`
  return `${Math.floor(s / 31536000)}y`
}
function versionCount(id) {
  return (store.versionsByQuery[id] || []).length
}
</script>

<style scoped>
.squell-app {
  --accent-hue: 10; /* red — shared Tools brand (matches Breadly) */
  --accent-500: #ef4444;
  --accent-600: #b91c1c;
  --accent-400: #f87171;
  --accent-100: #fee2e2;
  --accent-050: #fef2f2;

  --bg-card:     #ffffff;
  --bg-sunken:   #f3f2f0;
  --border:      #e5e4e1;
  --border-soft: #eeede9;
  --text:        #1a1a1a;
  --text-dim:    #5c5c5c;
  --text-faint:  #9a9a9a;

  --radius:    0.75rem;
  --radius-lg: 1rem;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
  --shadow:    0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg: 0 8px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);

  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif;
  color: var(--text);
  font-size: 0.9375rem;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  min-height: calc(100vh - 5rem);
  display: flex;
  align-items: stretch;
}
.squell-app button { font: inherit; color: inherit; cursor: pointer; background: none; border: none; padding: 0; }
.squell-app input, .squell-app select, .squell-app textarea { font: inherit; color: inherit; }

/* ── Rail ── */
.rail {
  width: 18.5rem;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 1.25rem 0.85rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  background: var(--bg-card);
}
.rail-head { display: flex; justify-content: space-between; align-items: flex-start; }
.eyebrow {
  font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.09em; color: var(--accent-500);
}
.rail-title { font-size: 1.4rem; font-weight: 800; margin: 0.1rem 0 0; letter-spacing: -0.01em; }
.rail-sub { margin-top: 0.15rem; font-size: 0.75rem; color: var(--text-faint); }

/* primary "new" button — shared spec across both tools */
.squell-app .add-btn.rail-new {
  width: 100%; height: 2.6rem;
  padding: 0 1rem; border-radius: 0.6rem;
  font-size: 0.9375rem; font-weight: 600;
  box-shadow: 0 2px 8px rgba(20, 184, 166, 0.25);
}

/* search */
.rail-search {
  display: flex; align-items: center; gap: 0.45rem;
  border: 1px solid var(--border); border-radius: 0.6rem;
  padding: 0 0.6rem; background: var(--bg-sunken);
  transition: border-color 120ms, background 120ms;
}
.rail-search:focus-within { border-color: var(--accent-500); background: #fff; box-shadow: 0 0 0 3px var(--accent-050); }
.rail-search .pi-search { font-size: 0.8rem; color: var(--text-faint); }
.rail-search input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  padding: 0.5rem 0; font-size: 0.85rem; color: var(--text);
}
.rail-search input::placeholder { color: var(--text-faint); }
.rail-search-clear { color: var(--text-faint); padding: 0.15rem; font-size: 0.72rem; display: inline-flex; }
.rail-search-clear:hover { color: var(--text-dim); }

/* list */
.rail-list {
  flex: 1; overflow-y: auto; display: flex; flex-direction: column;
  gap: 0.4rem; min-height: 4rem; padding: 0.15rem 0.15rem 0.4rem;
}
.squell-app .rail-item {
  position: relative;
  display: flex; align-items: flex-start; gap: 0.6rem;
  width: 100%; text-align: left;
  padding: 0.65rem 0.7rem; border-radius: 0.65rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: border-color 120ms, box-shadow 120ms, background 120ms;
}
.squell-app .rail-item:hover { border-color: var(--accent-400); box-shadow: 0 2px 7px rgba(0, 0, 0, 0.07); }
.squell-app .rail-item.active {
  background: var(--accent-050);
  border-color: var(--accent-500);
  box-shadow: 0 1px 3px rgba(20, 184, 166, 0.18);
}
.rail-item-icon {
  flex: none; width: 1.85rem; height: 1.85rem; border-radius: 0.5rem;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg-sunken); color: var(--text-dim); font-size: 0.9rem;
}
.rail-item.active .rail-item-icon { background: #fff; color: var(--accent-600); }
.rail-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.rail-item-name {
  font-weight: 700; font-size: 0.9rem; line-height: 1.25;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rail-item.active .rail-item-name { color: var(--accent-600); }

/* meta row */
.rail-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.05rem; }
.dialect-badge {
  font-size: 0.66rem; font-weight: 700; color: var(--text-dim);
  background: var(--bg-sunken); padding: 0.1rem 0.45rem; border-radius: 999px;
  text-transform: uppercase; letter-spacing: 0.02em;
}
.rail-item.active .dialect-badge { background: #fff; color: var(--accent-600); }
.rail-meta .stat { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; color: var(--text-dim); }
.rail-meta .stat i { font-size: 0.68rem; color: var(--text-faint); }
.rail-meta .stat-time { margin-left: auto; color: var(--text-faint); font-size: 0.7rem; }

/* empty / loading / no-match */
.rail-state {
  display: flex; flex-direction: column; align-items: center; gap: 0.45rem;
  padding: 1.75rem 0.5rem; color: var(--text-faint); font-size: 0.875rem; text-align: center;
}
.rail-state-icon { font-size: 1.5rem; opacity: 0.55; }

/* ── New query + new folder actions ── */
.rail-actions { display: flex; gap: 0.4rem; align-items: stretch; }
.rail-actions .add-btn.rail-new { width: auto; flex: 1; }
.squell-app .rail-actions .rail-newfolder {
  width: 2.6rem; height: 2.6rem; border-radius: 0.6rem;
  border: 1px solid var(--border); background: var(--bg-card); color: var(--text-dim);
}
.squell-app .rail-actions .rail-newfolder:hover { background: var(--accent-050); border-color: var(--accent-400); color: var(--accent-600); }

/* ── Inline new-folder input ── */
.folder-add {
  display: flex; align-items: center; gap: 0.45rem;
  padding: 0.5rem 0.6rem; border: 1px dashed var(--accent-400);
  border-radius: 0.6rem; background: var(--accent-050);
}
.folder-add .folder-icon { color: var(--accent-600); font-size: 0.85rem; }
.folder-add input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-size: 0.85rem; font-weight: 600; color: var(--text);
}

/* ── Folder group ── */
.folder { display: flex; flex-direction: column; }
.folder-head {
  display: flex; align-items: center; gap: 0.4rem;
  padding: 0.4rem; border-radius: 0.5rem; cursor: pointer;
  user-select: none; transition: background 120ms;
}
.folder-head:hover { background: var(--bg-sunken); }
.folder-chevron { font-size: 0.7rem; color: var(--text-faint); width: 0.8rem; text-align: center; }
.folder-head .folder-icon { font-size: 0.85rem; color: var(--accent-600); }
.folder-name {
  flex: 1; min-width: 0; font-size: 0.82rem; font-weight: 700;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.folder-rename {
  flex: 1; min-width: 0; border: 1px solid var(--accent-400); border-radius: 0.4rem;
  padding: 0.15rem 0.4rem; font-size: 0.82rem; font-weight: 700; outline: none;
  background: #fff; color: var(--text);
}
.folder-count {
  font-size: 0.68rem; font-weight: 700; color: var(--text-faint);
  background: var(--bg-sunken); border-radius: 999px;
  padding: 0.05rem 0.4rem; min-width: 1.1rem; text-align: center;
}
.folder-tools { display: none; align-items: center; gap: 0.1rem; }
.folder-head:hover .folder-tools { display: flex; }
.squell-app .folder-tool {
  width: 1.5rem; height: 1.5rem; border-radius: 0.35rem; display: inline-flex;
  align-items: center; justify-content: center; color: var(--text-faint); font-size: 0.7rem;
}
.squell-app .folder-tool:hover { background: #fff; color: var(--accent-600); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
.squell-app .folder-tool:last-child:hover { color: #c33; }
.folder-body {
  display: flex; flex-direction: column; gap: 0.35rem;
  padding: 0.35rem 0 0.2rem 0.55rem; margin: 0.1rem 0 0.15rem 0.45rem;
  border-left: 1px solid var(--border-soft);
}
.folder-empty { font-size: 0.74rem; color: var(--text-faint); padding: 0.2rem 0.4rem; font-style: italic; }

/* ── Ungrouped section ── */
.folder-loose { display: flex; flex-direction: column; gap: 0.4rem; }
.loose-label {
  font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--text-faint); padding: 0.5rem 0.4rem 0.05rem;
}

/* ── Per-query kebab ── */
.rail-item-kebab {
  flex: none; align-self: center; width: 1.4rem; height: 1.4rem;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 0.35rem; color: var(--text-faint); font-size: 0.8rem;
  opacity: 0; transition: opacity 120ms, background 120ms, color 120ms;
}
.rail-item:hover .rail-item-kebab,
.rail-item.active .rail-item-kebab { opacity: 1; }
.rail-item-kebab:hover { background: #fff; color: var(--accent-600); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }

/* ── Floating per-query menu ── */
.sq-menu-backdrop { position: fixed; inset: 0; z-index: 120; }
.sq-menu {
  position: fixed; z-index: 121; width: 13.5rem; max-height: 60vh; overflow-y: auto;
  background: #fff; border: 1px solid var(--border); border-radius: 0.6rem;
  box-shadow: var(--shadow-lg); padding: 0.3rem;
}
.sq-menu-label {
  font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
  color: var(--text-faint); padding: 0.3rem 0.5rem 0.2rem;
}
.squell-app .sq-menu-item {
  display: flex; align-items: center; gap: 0.5rem; width: 100%; text-align: left;
  padding: 0.4rem 0.5rem; border-radius: 0.4rem; font-size: 0.83rem; color: var(--text);
}
.squell-app .sq-menu-item i { font-size: 0.78rem; color: var(--text-faint); width: 0.9rem; }
.squell-app .sq-menu-item:hover { background: var(--accent-050); }
.squell-app .sq-menu-item.on { color: var(--accent-600); font-weight: 600; }
.squell-app .sq-menu-item.on i { color: var(--accent-600); }
.squell-app .sq-menu-item.danger { color: #c33; }
.squell-app .sq-menu-item.danger i { color: #c33; }
.squell-app .sq-menu-item.danger:hover { background: #fff0f0; }
.sq-menu-hint { font-size: 0.72rem; color: var(--text-faint); padding: 0.2rem 0.5rem 0.4rem; line-height: 1.35; }
.sq-menu-sep { height: 1px; background: var(--border-soft); margin: 0.3rem 0.2rem; }

.rail-foot { display: flex; gap: 0.5rem; padding-top: 0.75rem; border-top: 1px solid var(--border-soft); }
.rail-foot button { flex: 1; }

/* ── Main ── */
.main {
  flex: 1; min-width: 0;
  padding: 2rem 16rem 5rem;
  width: 100%;
  display: flex; flex-direction: column; gap: 1.25rem;
}
.rail-toggle { align-self: flex-start; }

.q-header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.q-name {
  font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em;
  border: none; outline: none; background: none;
  flex: 1; min-width: 12rem; padding: 0.25rem 0;
  border-bottom: 2px solid transparent;
}
.q-name:focus { border-bottom-color: var(--accent-400); }
.q-header-right { display: flex; align-items: center; gap: 0.5rem; }

/* ── Cards ── */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem 1.125rem 1.125rem;
  box-shadow: var(--shadow-sm);
}
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 0.625rem; }
.card-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); font-weight: 600; }
.ta {
  width: 100%; border: 1px solid var(--border); border-radius: 0.625rem;
  padding: 0.75rem 0.875rem; font-size: 0.9375rem; line-height: 1.55;
  resize: vertical; outline: none; font-family: inherit; background: #fff;
}
.ta:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }
.ta-ai { background: var(--accent-050); }
.ta-ai:focus { background: #fff; }
.note-block + .note-block { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-soft); }
.note-block .card-label { display: inline-flex; align-items: center; gap: 0.375rem; }
.note-block-ai .card-label { color: var(--accent-600); }

/* ── Timeline ── */
.timeline { display: flex; align-items: center; gap: 0.375rem; flex-wrap: wrap; }
.timeline-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); font-weight: 600; margin-right: 0.25rem; }
.vchip {
  padding: 0.25rem 0.625rem; border-radius: 999px; font-size: 0.8125rem; font-weight: 600;
  border: 1px solid var(--border); color: var(--text-dim); background: #fff; transition: all 120ms;
}
.vchip:hover { border-color: var(--accent-400); color: var(--text); }
.vchip.active { background: var(--accent-500); color: #fff; border-color: var(--accent-500); }
.vchip.latest:not(.active) { border-color: var(--accent-400); color: var(--accent-600); }
.vchip-edit { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--accent-600); border-style: dashed; }

/* ── Compare (side-by-side diff) ── */
.compare { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.compare-head { display: flex; gap: 1px; }
.pane-title { font-size: 0.8125rem; font-weight: 600; color: var(--text-dim); }
.pane-title.half { flex: 1; min-width: 0; }
.pane-title.right-half { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding-left: 0.75rem; }
.pane-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pane-tools { display: inline-flex; align-items: center; gap: 0.625rem; flex-shrink: 0; }
.lock-toggle {
  display: inline-flex; align-items: center; gap: 0.3125rem;
  padding: 0.1875rem 0.5rem; border-radius: 999px;
  font-size: 0.6875rem; font-weight: 600;
  color: var(--text-faint); border: 1px solid var(--border); background: #fff;
  transition: all 120ms;
}
.lock-toggle:hover { border-color: var(--text-faint); color: var(--text-dim); }
.lock-toggle.on { color: var(--accent-600); border-color: var(--accent-100); background: var(--accent-050); }
.lock-toggle.on:hover { border-color: var(--accent-400); }

/* ── Buttons (shared with reminders idiom) ── */
.squell-app .add-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  background: var(--accent-500); color: #fff;
  padding: 0.625rem 1.25rem; height: 2.625rem; border-radius: 0.625rem;
  font-size: 0.9375rem; font-weight: 600;
  box-shadow: 0 0.125rem 0.5rem oklch(0.5 0.18 var(--accent-hue) / 0.25);
  transition: background 120ms, transform 120ms;
}
.squell-app .add-btn:hover:not(:disabled) { background: var(--accent-600); transform: translateY(-1px); }
.squell-app .add-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.squell-app .add-btn-lg { height: 3.125rem; padding: 0.875rem 2.5rem; font-size: 1rem; }
.rail-new { width: 100%; }

.squell-app .btn-ghost {
  padding: 0.5rem 1rem; height: 2.5rem; border-radius: 0.625rem;
  font-size: 0.875rem; color: var(--text-dim);
  border: 1px solid var(--border); background: #fff;
  display: inline-flex; align-items: center; gap: 0.375rem; font-weight: 500;
  transition: all 120ms;
}
.squell-app .btn-ghost:hover:not(:disabled) { border-color: var(--text-faint); color: var(--text); background: var(--bg-sunken); }
.squell-app .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.squell-app .btn-sm { height: 2.125rem; padding: 0.375rem 0.75rem; font-size: 0.8125rem; justify-content: center; }

.squell-app .icon-btn {
  width: 2.25rem; height: 2.25rem; border-radius: 0.5rem;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint); transition: all 120ms; flex-shrink: 0;
}
.squell-app .icon-btn:hover { background: var(--bg-sunken); color: var(--text); }
.squell-app .icon-danger:hover { background: #fff0f0; color: #c33; }

.ai-btn {
  display: inline-flex; align-items: center; gap: 0.375rem;
  padding: 0.3125rem 0.75rem; border-radius: 0.5rem;
  font-size: 0.8125rem; font-weight: 600; color: var(--accent-600);
  border: 1px solid var(--accent-100); background: var(--accent-050);
  transition: all 120ms;
}
.ai-btn:hover:not(:disabled) { background: var(--accent-100); border-color: var(--accent-400); }
.ai-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.squell-app .link-btn { font-size: 0.75rem; color: var(--accent-600); font-weight: 600; }
.squell-app .link-btn:hover { text-decoration: underline; }

.sel {
  border: 1px solid var(--border); border-radius: 0.5rem;
  padding: 0.5rem 0.75rem; height: 2.5rem; font-size: 0.875rem;
  background: #fff; outline: none;
}
.sel:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }

/* ── Save bar ── */
.save-bar { display: flex; align-items: center; gap: 0.875rem; }
.save-hint { font-size: 0.8125rem; color: var(--text-faint); }
.action-error { color: oklch(0.55 0.16 25); font-size: 0.875rem; margin: 0; }

/* ── Empty ── */
.empty {
  background: var(--bg-card); border: 2px dashed var(--border); border-radius: var(--radius-lg);
  padding: 5rem 2.5rem; text-align: center; margin: auto 0;
  display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
}
.empty-title { font-size: 1.25rem; font-weight: 600; }
.empty-sub { font-size: 0.9375rem; color: var(--text-dim); max-width: 24rem; }
.empty-actions { margin-top: 1rem; }

/* ── Modal ── */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.25); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center; z-index: 100; animation: fade-in 140ms;
}
.modal {
  background: #fff; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
  width: 44rem; max-width: calc(100vw - 3rem); max-height: calc(100vh - 3rem);
  display: flex; flex-direction: column; animation: pop-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.1);
}
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem 1.75rem; border-bottom: 1px solid var(--border-soft); }
.modal-title { font-size: 1.25rem; font-weight: 700; }
.modal-close { width: 2rem; height: 2rem; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; color: var(--text-faint); transition: all 120ms; }
.modal-close:hover { background: var(--bg-sunken); color: var(--text); }
.modal-body { padding: 1.5rem 1.75rem; display: flex; flex-direction: column; gap: 1.125rem; overflow-y: auto; }
.modal-foot { display: flex; gap: 0.75rem; align-items: center; padding: 1.125rem 1.75rem; border-top: 1px solid var(--border-soft); }
.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field > label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); font-weight: 600; }

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop-in { from { opacity: 0; transform: translateY(0.375rem) scale(0.97); } to { opacity: 1; transform: none; } }

/* ── Mobile ── */
/* Scoped under .squell-app so it beats .squell-app .btn-ghost / .icon-btn (0,2,0). */
.squell-app .mobile-only { display: none; }
@media (max-width: 63.99em) {
  .panes { grid-template-columns: 1fr; }
}
@media (max-width: 47.99em) {
  .squell-app .mobile-only { display: inline-flex; }
  .rail {
    position: fixed; top: 0; left: 0; bottom: 0; z-index: 90;
    width: 17rem; transform: translateX(-100%); transition: transform 200ms;
    box-shadow: var(--shadow-lg);
  }
  .rail.open { transform: translateX(0); }
  .main { padding: 1.5rem 1rem 4rem; }
  .q-header-right { flex-wrap: wrap; }
}
</style>
