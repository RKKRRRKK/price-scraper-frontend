<template>
  <div class="squell-app">
    <!-- ── Catalogue rail ── -->
    <aside class="rail" :class="{ open: railOpen }">
      <div class="rail-head">
        <div>
          <h1 class="rail-title">Squell</h1>
        </div>
        <button class="icon-btn rail-close mobile-only" @click="railOpen = false" title="Close">
          <i class="pi pi-times" style="font-size: 0.875rem;"></i>
        </button>
      </div>

      <button class="add-btn rail-new" @click="openNewQuery">
        <i class="pi pi-plus" style="font-size: 0.8125rem;"></i> New query
      </button>

      <div class="rail-list">
        <div v-if="store.loading && !store.queries.length" class="rail-loading">
          <i class="pi pi-spin pi-spinner" style="font-size: 1.25rem;"></i>
        </div>
        <div v-else-if="!store.queries.length" class="rail-empty">No queries yet.</div>
        <button
          v-for="q in store.queries"
          :key="q.id"
          class="rail-item"
          :class="{ active: q.id === store.activeQueryId }"
          @click="selectQuery(q.id)"
        >
          <span class="rail-item-name">{{ q.name }}</span>
          <span class="rail-item-meta">
            <span class="dialect-badge">{{ dialectLabel(q.dialect) }}</span>
            <span class="vcount">{{ (store.versionsByQuery[q.id] || []).length || '·' }}</span>
          </span>
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
import { ref, computed, watch, onMounted } from 'vue'
import dayjs from 'dayjs'
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
</script>

<style scoped>
.squell-app {
  --accent-hue: 182.5; /* teal — matches the Tools nav section */
  --accent-500: oklch(0.56 0.10 var(--accent-hue));
  --accent-600: oklch(0.50 0.095 var(--accent-hue));
  --accent-400: oklch(0.68 0.13 var(--accent-hue));
  --accent-100: oklch(0.96 0.045 var(--accent-hue));
  --accent-050: oklch(0.985 0.014 var(--accent-hue));

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
  width: 17rem;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 1.75rem 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: var(--bg-card);
}
.rail-head { display: flex; justify-content: space-between; align-items: flex-start; }
.rail-title { font-size: 1.625rem; font-weight: 700; margin: 0; letter-spacing: -0.02em; }
.rail-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.25rem; min-height: 4rem; }
.rail-loading, .rail-empty { padding: 1rem 0.5rem; color: var(--text-faint); font-size: 0.875rem; text-align: center; }
.rail-item {
  display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-start;
  width: 100%; text-align: left;
  padding: 0.625rem 0.75rem; border-radius: 0.5rem;
  transition: background 120ms;
}
.rail-item:hover { background: var(--accent-050); }
.rail-item.active { background: var(--accent-100); }
.rail-item-name { font-weight: 600; font-size: 0.9375rem; word-break: break-word; }
.rail-item.active .rail-item-name { color: var(--accent-600); }
.rail-item-meta { display: flex; align-items: center; gap: 0.5rem; }
.dialect-badge {
  font-size: 0.6875rem; font-weight: 600; color: var(--text-dim);
  background: var(--bg-sunken); padding: 0.0625rem 0.4375rem; border-radius: 999px;
}
.vcount { font-size: 0.75rem; color: var(--text-faint); }
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
    width: 16rem; transform: translateX(-100%); transition: transform 200ms;
    box-shadow: var(--shadow-lg);
  }
  .rail.open { transform: translateX(0); }
  .main { padding: 1.5rem 1rem 4rem; }
  .q-header-right { flex-wrap: wrap; }
}
</style>
