<template>
  <div class="squell-app">
    <!-- ── Catalogue rail ── -->
    <aside class="rail" :class="{ open: railOpen }">
      <div class="rail-head">
        <div>
          <div class="eyebrow">Productivity</div>
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
              {{ rightTitle }}
              <button
                v-if="mode === 'edit'"
                class="link-btn"
                @click="candidateSql = leftSql"
                title="Reset to baseline"
              >reset</button>
            </span>
          </div>
          <SqlMergeView
            :key="mergeKey"
            :original="leftSql"
            :model-value="mergeRight"
            :dialect="dialectDraft"
            :readonly="mode === 'review'"
            @update:model-value="onMergeInput"
          />
        </section>

        <!-- Note -->
        <section class="card">
          <div class="card-head">
            <label class="card-label">Note — what changed in this revision</label>
            <button
              v-if="mode === 'edit'"
              class="ai-btn"
              :disabled="genNote || !canGenerateNote"
              :title="store.aiConfigured ? 'Generate with AI' : aiOffTitle"
              @click="generateNote"
            >
              <i :class="genNote ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'" style="font-size: 0.8125rem;"></i>
              {{ genNote ? 'Generating…' : 'Generate' }}
            </button>
          </div>
          <textarea
            v-if="mode === 'edit'"
            class="ta"
            v-model="candidateNote"
            rows="3"
            placeholder="Describe the change from the baseline (or generate it with AI)."
          ></textarea>
          <div v-else class="note-readonly">{{ reviewNote || '— no note —' }}</div>
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
const candidateNote = ref('')
const nameDraft = ref('')
const descriptionDraft = ref('')
const dialectDraft = ref('bigquery')

const railOpen = ref(false)
const saving = ref(false)
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
}

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
    return prev ? `v${prev.version_number} (baseline)` : 'empty (no prior version)'
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
const reviewNote = computed(() => versions.value[reviewIndex.value]?.note || '')

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
  if (mode.value === 'review') return i === reviewIndex.value
  return i === versions.value.length - 1
}
function reviewVersion(i) {
  // Clicking the latest chip in edit mode is a no-op; otherwise enter review.
  if (mode.value === 'edit' && i === versions.value.length - 1) return
  mode.value = 'review'
  reviewIndex.value = i
}
function enterEditMode() {
  mode.value = 'edit'
  candidateSql.value = latest.value?.sql_text || ''
  candidateNote.value = ''
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
    })
    // baseline shifts to the just-saved version; candidate seeds from it.
    candidateNote.value = ''
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
const canGenerateNote = computed(() => store.aiConfigured && canSave.value)

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
    const text = await store.generateAi('diff_note', {
      dialect: dialectDraft.value,
      query_name: nameDraft.value,
      previous_sql: latest.value?.sql_text || '',
      current_sql: candidateSql.value,
    })
    candidateNote.value = text
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
  --accent-hue: 295;
  --accent-500: oklch(0.56 0.18 var(--accent-hue));
  --accent-600: oklch(0.50 0.18 var(--accent-hue));
  --accent-400: oklch(0.68 0.14 var(--accent-hue));
  --accent-100: oklch(0.96 0.025 var(--accent-hue));
  --accent-050: oklch(0.985 0.012 var(--accent-hue));

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
.eyebrow {
  font-size: 0.75rem; font-weight: 700; letter-spacing: 0.12em;
  color: var(--accent-600); text-transform: uppercase; margin-bottom: 0.25rem;
}
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
.note-readonly { font-size: 0.9375rem; color: var(--text-dim); white-space: pre-wrap; }

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
