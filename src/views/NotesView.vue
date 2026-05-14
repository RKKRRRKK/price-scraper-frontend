<template>
  <div class="notes-app">
    <div class="notes-main">
      <!-- ── Header ── -->
      <div class="notes-header">
        <div class="notes-title-row">
          <div class="notes-stats" v-if="store.stats.total > 0">
            <div class="stat">
              <div class="stat-value">{{ store.stats.total }}</div>
              <div class="stat-label">Total</div>
            </div>
            <div class="stat">
              <div class="stat-value">{{ store.stats.thisWeek }}</div>
              <div class="stat-label">This Week</div>
            </div>
            <div class="stat">
              <div class="stat-value">{{ store.stats.categories }}</div>
              <div class="stat-label">Categories</div>
            </div>
            <div class="stat">
              <div class="stat-value">{{ store.stats.withDeadline }}</div>
              <div class="stat-label">Deadlines</div>
            </div>
            <div class="stat">
              <div class="stat-value">{{ store.stats.completed }}</div>
              <div class="stat-label">Completed</div>
            </div>
            <div class="stat">
              <div class="stat-value">{{ store.stats.suspended }}</div>
              <div class="stat-label">Suspended</div>
            </div>
          </div>
        </div>

        <!-- Upcoming deadlines -->
        <div class="upcoming" v-if="store.upcomingDeadlines.length">
          <span class="upcoming-label">Upcoming</span>
          <div class="upcoming-row">
            <button
              v-for="n in store.upcomingDeadlines" :key="n.id"
              class="upcoming-pill"
              @click="selectNote(n)"
            >
              <span class="deadline" :class="'deadline-' + store.deadlineUrgency(n.deadline_date)">
                {{ formatDeadlineDate(n.deadline_date) }}
              </span>
              <span class="upcoming-title">{{ noteTitle(n) }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ── Filter bar ── -->
      <div class="filterbar">
        <div class="searchwrap">
          <i class="pi pi-search" style="color: var(--text-faint); font-size: 0.9375rem;"></i>
          <input
            class="search"
            placeholder="Search notes & keywords..."
            v-model="store.searchQuery"
          />
          <button
            v-if="store.searchQuery"
            class="search-clear"
            @click="store.searchQuery = ''"
          >&times;</button>
        </div>

        <div class="filters">
          <!-- Context dropdown -->
          <div class="filter-group" v-if="store.allContexts.length">
            <span class="filter-group-label">Context</span>
            <select class="context-select" v-model="contextDropdown" @change="onContextChange">
              <option value="">All contexts</option>
              <option v-for="ctx in store.allContexts" :key="ctx" :value="ctx">{{ ctx }}</option>
            </select>
          </div>

          <!-- Date range filter -->
          <div class="filter-group date-filter-group">
            <span class="filter-group-label">Date</span>
            <div class="date-range-inputs">
              <input type="date" class="date-input" v-model="store.dateFrom" placeholder="From" />
              <span class="date-separator">–</span>
              <input type="date" class="date-input" v-model="store.dateTo" placeholder="To" />
              <button
                v-if="store.dateFrom || store.dateTo"
                class="date-clear"
                @click="store.dateFrom = null; store.dateTo = null"
                title="Clear dates"
              >&times;</button>
            </div>
          </div>

          <!-- Deadline filter -->
          <div class="filter-group">
            <div class="filter-group-pills">
              <button
                class="filter-pill deadline-filter"
                :class="{ active: store.deadlineFilter }"
                @click="store.deadlineFilter = !store.deadlineFilter"
              >
                <i class="pi pi-clock" style="font-size: 0.875rem;"></i>
                Has deadline
              </button>
            </div>
          </div>

          <!-- Status filter -->
          <div class="filter-group">
            <span class="filter-group-label">Status</span>
            <select class="context-select" v-model="store.statusFilter">
              <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }} ({{ store.statusCounts[opt.value] || 0 }})
              </option>
            </select>
          </div>
        </div>

        <button class="add-btn" @click="openAddModal">
          <i class="pi pi-plus" style="font-size: 0.875rem;"></i>
          Add Note
        </button>
      </div>

      <!-- ── Category filter bar ── -->
      <div class="category-bar" v-if="store.allCategories.length">
        <span class="filter-group-label">Categories</span>
        <div class="category-pills">
          <button
            v-for="cat in store.allCategories" :key="cat"
            class="cat-pill"
            :class="{ active: store.activeCategories.includes(cat) }"
            :style="catStyle(cat)"
            @click="store.toggleCategory(cat)"
          >
            <span class="catchip-dot"></span>
            {{ cat }}
            <span class="filter-count">{{ store.categoryCounts[cat] || 0 }}</span>
          </button>
        </div>
      </div>

      <!-- ── Loading ── -->
      <div v-if="store.loading && !store.notes.length" class="empty">
        <i class="pi pi-spin pi-spinner" style="font-size: 2.5rem; color: var(--accent-500);"></i>
        <div class="empty-sub">Loading notes...</div>
      </div>

      <!-- ── Empty state ── -->
      <div v-else-if="!store.loading && !store.filteredNotes.length && !store.notes.length" class="empty">
        <div class="empty-art">
          <i class="pi pi-file-edit" style="font-size: 3.5rem; color: var(--text-faint);"></i>
        </div>
        <div class="empty-title">No notes yet</div>
        <div class="empty-sub">Create your first note to get started.</div>
        <div class="empty-actions">
          <button class="add-btn add-btn-lg" @click="openAddModal">
            <i class="pi pi-plus" style="font-size: 0.875rem;"></i> New Note
          </button>
        </div>
      </div>

      <!-- ── No results ── -->
      <div v-else-if="!store.filteredNotes.length" class="empty">
        <div class="empty-title">No matching notes</div>
        <div class="empty-sub">Try adjusting your search or filters.</div>
      </div>

      <!-- ── SPLIT Layout (always) ── -->
      <div v-else class="split-layout">
        <!-- Left: note list -->
        <div class="split-list">
          <button
            v-for="note in store.filteredNotes" :key="note.id"
            class="split-card"
            :class="{ selected: selectedNote?.id === note.id, 'is-inactive': store.noteStatus(note) !== 'active' }"
            :style="catStyle(note.category)"
            @click="selectNote(note)"
          >
            <div class="split-card-stripe"></div>
            <div class="split-card-body">
              <div class="split-card-top">
                <span class="split-card-title">{{ noteTitle(note) }}</span>
                <span class="split-card-date">{{ formatDate(note.created_at) }}</span>
              </div>
              <div class="split-card-preview">{{ note.content }}</div>
              <div class="split-card-meta">
                <span
                  class="catchip"
                  :style="catStyle(note.category)"
                >
                  <span class="catchip-dot"></span> {{ note.category }}
                </span>
                <span class="ctxpill" :class="'ctxpill-' + note.context">{{ note.context }}</span>
                <span
                  v-if="store.noteStatus(note) !== 'active'"
                  class="statuspill"
                  :class="'statuspill-' + store.noteStatus(note)"
                >{{ store.noteStatus(note) }}</span>
                <span v-if="note.speaker" class="speaker">
                  <i class="pi pi-user" style="font-size: 0.6875rem;"></i> {{ note.speaker }}
                </span>
                <span v-if="note.deadline && note.deadline_date" class="deadline" :class="'deadline-' + store.deadlineUrgency(note.deadline_date)">
                  <i class="pi pi-clock" style="font-size: 0.6875rem;"></i>
                  {{ formatDeadlineDate(note.deadline_date) }}
                </span>
                <div class="split-card-kws" v-if="note.keywords?.length">
                  <span v-for="kw in note.keywords.slice(0, 3)" :key="kw" class="kwchip-static">{{ kw }}</span>
                  <span v-if="note.keywords.length > 3" class="kwchip-static">+{{ note.keywords.length - 3 }}</span>
                </div>
              </div>
            </div>
          </button>
        </div>

        <!-- Right: editor pane -->
        <div v-if="selectedNote" class="split-editor">
          <div class="inline-editor">
            <div class="inline-editor-head">
              <div class="inline-editor-meta">
                <span class="catchip" :style="catStyle(editForm.category)">
                  <span class="catchip-dot"></span> {{ editForm.category }}
                </span>
                <span class="ctxpill" :class="'ctxpill-' + editForm.context">{{ editForm.context }}</span>
                <span
                  class="statuspill"
                  :class="'statuspill-' + store.noteStatus(selectedNote)"
                >{{ store.noteStatus(selectedNote) }}</span>
                <span class="inline-editor-date">{{ formatDate(selectedNote.created_at) }}</span>
              </div>
              <div class="inline-editor-actions">
                <select
                  class="status-select"
                  :class="'status-select-' + store.noteStatus(selectedNote)"
                  :value="store.noteStatus(selectedNote)"
                  :disabled="savingStatus"
                  @change="changeStatus($event.target.value)"
                >
                  <option
                    v-for="opt in statusOptions.filter(o => o.value !== 'all')" :key="opt.value"
                    :value="opt.value"
                  >{{ opt.label }}</option>
                </select>
                <button class="btn-ghost btn-save" @click="saveInlineEdit">
                  <i class="pi pi-check" style="font-size: 0.8125rem; margin-right: 0.375rem;"></i> Save
                </button>
                <button class="btn-ghost btn-danger" @click="confirmDelete(selectedNote.id)">
                  <i class="pi pi-trash" style="font-size: 0.8125rem; margin-right: 0.375rem;"></i> Delete
                </button>
              </div>
            </div>

            <div v-if="selectedNote.processed_content" class="inline-processed processed-block">
              <div class="processed-label">AI Processed</div>
              <div class="processed-text">{{ selectedNote.processed_content }}</div>
            </div>

            <textarea
              class="inline-editor-text"
              v-model="editForm.content"
              placeholder="Write your note..."
            ></textarea>

            <div class="inline-editor-foot">
              <!-- Keywords -->
              <div class="inline-editor-kws">
                <span class="foot-label">Tags</span>
                <span
                  v-for="(kw, i) in editForm.keywords" :key="i"
                  class="kwchip-static removable"
                  @click="editForm.keywords.splice(i, 1)"
                >{{ kw }} <span class="kw-x">&times;</span></span>
                <input
                  class="kw-input"
                  placeholder="+ tag ↵"
                  @keydown.enter.prevent="addKeywordToEdit"
                  v-model="newKeyword"
                />
              </div>

              <!-- Metadata selects -->
              <div class="inline-editor-fields">
                <div class="inline-field">
                  <span class="foot-label">Context</span>
                  <select class="sel" v-model="editForm.context">
                    <option value="work">work</option>
                    <option value="personal">personal</option>
                  </select>
                </div>
                <div class="inline-field">
                  <span class="foot-label">Category</span>
                  <input class="sel" v-model="editForm.category" placeholder="Category" />
                </div>
                <div class="inline-field">
                  <span class="foot-label">Speaker</span>
                  <input class="sel" v-model="editForm.speaker" placeholder="Speaker" />
                </div>

                <label class="deadline-toggle">
                  <input type="checkbox" v-model="editForm.deadline" />
                  Deadline
                </label>
                <template v-if="editForm.deadline">
                  <div class="inline-field">
                    <span class="foot-label">Due</span>
                    <input type="date" class="sel" v-model="editForm.deadline_date" />
                  </div>
                  <div class="inline-field">
                    <span class="foot-label">Stakeholder</span>
                    <input class="sel" v-model="editForm.deadline_stakeholder" placeholder="Stakeholder" />
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="split-editor">
          <div class="split-placeholder">
            <i class="pi pi-file-edit" style="font-size: 3rem; color: var(--text-faint); margin-bottom: 1rem;"></i>
            <div class="split-placeholder-title">Select a note</div>
            <div class="split-placeholder-sub">Choose a note from the list to view and edit its contents.</div>
          </div>
        </div>
      </div>

      <!-- ── Tweaks panel toggle ── -->
      <button
        class="tweaks-toggle"
        @click="showTweaks = !showTweaks"
        title="Display settings"
      >
        <i class="pi pi-palette" style="font-size: 1rem;"></i>
      </button>

      <!-- ── Tweaks panel ── -->
      <div v-if="showTweaks" class="tweaks">
        <div class="tweaks-head">Accent Color</div>
        <div class="hue-row">
          <button
            v-for="hue in accentHues" :key="hue"
            class="hue-swatch"
            :class="{ active: accentHue === hue }"
            :style="{ background: `oklch(0.6 0.18 ${hue})` }"
            @click="setAccent(hue)"
          ></button>
        </div>
      </div>
    </div>

    <!-- ── Add / Edit Modal ── -->
    <div v-if="modalOpen" class="modal-backdrop" @click.self="closeModal">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">{{ modalMode === 'add' ? 'New Note' : 'Edit Note' }}</span>
          <button class="modal-close" @click="closeModal">
            <i class="pi pi-times" style="font-size: 0.875rem;"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="modal-meta">
            <div class="field">
              <label>Context</label>
              <select class="sel" v-model="modalForm.context">
                <option value="work">work</option>
                <option value="personal">personal</option>
              </select>
            </div>
            <div class="field">
              <label>Category</label>
              <input class="sel" v-model="modalForm.category" placeholder="e.g. meeting, idea, task" />
            </div>
            <div class="field">
              <label>Speaker</label>
              <input class="sel" v-model="modalForm.speaker" placeholder="Optional" />
            </div>
          </div>
          <textarea
            class="modal-textarea"
            v-model="modalForm.content"
            placeholder="Write your note..."
          ></textarea>

          <!-- Keywords -->
          <div class="inline-editor-kws">
            <span class="foot-label">Keywords</span>
            <span
              v-for="(kw, i) in modalForm.keywords" :key="i"
              class="kwchip-static removable"
              @click="modalForm.keywords.splice(i, 1)"
            >{{ kw }} <span class="kw-x">&times;</span></span>
            <input
              class="kw-input"
              placeholder="+ keyword ↵"
              @keydown.enter.prevent="addKeywordToModal"
              v-model="modalNewKeyword"
            />
          </div>

          <!-- Deadline -->
          <div class="modal-deadline">
            <label class="deadline-toggle">
              <input type="checkbox" v-model="modalForm.deadline" />
              Has deadline
            </label>
            <template v-if="modalForm.deadline">
              <input type="date" class="sel" v-model="modalForm.deadline_date" />
              <input class="sel" v-model="modalForm.deadline_stakeholder" placeholder="Stakeholder" style="min-width: 8.75rem;" />
            </template>
          </div>
        </div>
        <div class="modal-foot">
          <button class="add-btn" @click="submitModal" :disabled="saving">
            {{ modalMode === 'add' ? 'Create Note' : 'Save Changes' }}
          </button>
          <button class="btn-ghost" @click="closeModal">Cancel</button>
          <div style="flex:1;"></div>
          <button v-if="modalMode === 'edit'" class="btn-ghost btn-danger" @click="confirmDelete(modalForm.id); closeModal();">
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { useNotesStore } from '@/stores/notes'
import dayjs from 'dayjs'

const store = useNotesStore()

onMounted(() => store.fetchNotes())

// ── UI state ──
const showTweaks = ref(false)
const accentHue = ref(295)
const accentHues = [295, 260, 210, 160, 120, 45, 10, 340]
const selectedNote = ref(null)
const contextDropdown = ref('')

// ── Status filter / switcher ──
const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'suspended', label: 'Suspended' },
]
const savingStatus = ref(false)

async function changeStatus(status) {
  if (!selectedNote.value || store.noteStatus(selectedNote.value) === status) return
  savingStatus.value = true
  try {
    const updated = await store.setNoteStatus(selectedNote.value.id, status)
    if (updated) selectedNote.value = updated
  } catch (e) {
    // error handled in store
  } finally {
    savingStatus.value = false
  }
}

function onContextChange() {
  store.activeContexts = contextDropdown.value ? [contextDropdown.value] : []
}

// ── Modal state ──
const modalOpen = ref(false)
const modalMode = ref('add')
const saving = ref(false)
const modalNewKeyword = ref('')
const modalForm = ref(emptyForm())

function emptyForm() {
  return {
    id: null,
    context: 'work',
    category: '',
    content: '',
    keywords: [],
    speaker: '',
    deadline: false,
    deadline_date: '',
    deadline_stakeholder: '',
    processed_content: '',
  }
}

// ── Inline edit (split view) ──
const editForm = ref(emptyForm())
const newKeyword = ref('')

function selectNote(note) {
  selectedNote.value = note
  editForm.value = {
    id: note.id,
    context: note.context,
    category: note.category,
    content: note.content,
    keywords: [...(note.keywords || [])],
    speaker: note.speaker || '',
    deadline: note.deadline || false,
    deadline_date: note.deadline_date || '',
    deadline_stakeholder: note.deadline_stakeholder || '',
    processed_content: note.processed_content || '',
  }
}

function addKeywordToEdit() {
  const kw = newKeyword.value.trim()
  if (kw && !editForm.value.keywords.includes(kw)) {
    editForm.value.keywords.push(kw)
  }
  newKeyword.value = ''
}

async function saveInlineEdit() {
  if (!selectedNote.value) return
  saving.value = true
  try {
    const updated = await store.updateNote(selectedNote.value.id, {
      context: editForm.value.context,
      category: editForm.value.category,
      content: editForm.value.content,
      keywords: editForm.value.keywords,
      speaker: editForm.value.speaker || null,
      deadline: editForm.value.deadline,
      deadline_date: editForm.value.deadline_date || null,
      deadline_stakeholder: editForm.value.deadline_stakeholder || null,
    })
    selectedNote.value = updated
  } catch (e) {
    // error handled in store
  } finally {
    saving.value = false
  }
}

// ── Modal ──
function openAddModal() {
  modalMode.value = 'add'
  modalForm.value = emptyForm()
  modalNewKeyword.value = ''
  modalOpen.value = true
}

function closeModal() {
  modalOpen.value = false
}

function addKeywordToModal() {
  const kw = modalNewKeyword.value.trim()
  if (kw && !modalForm.value.keywords.includes(kw)) {
    modalForm.value.keywords.push(kw)
  }
  modalNewKeyword.value = ''
}

async function submitModal() {
  if (!modalForm.value.content.trim() || !modalForm.value.category.trim()) return
  saving.value = true
  try {
    if (modalMode.value === 'add') {
      const created = await store.addNote({
        context: modalForm.value.context,
        category: modalForm.value.category,
        content: modalForm.value.content,
        keywords: modalForm.value.keywords,
        speaker: modalForm.value.speaker || null,
        deadline: modalForm.value.deadline,
        deadline_date: modalForm.value.deadline_date || null,
        deadline_stakeholder: modalForm.value.deadline_stakeholder || null,
      })
      if (created) selectNote(created)
    } else {
      await store.updateNote(modalForm.value.id, {
        context: modalForm.value.context,
        category: modalForm.value.category,
        content: modalForm.value.content,
        keywords: modalForm.value.keywords,
        speaker: modalForm.value.speaker || null,
        deadline: modalForm.value.deadline,
        deadline_date: modalForm.value.deadline_date || null,
        deadline_stakeholder: modalForm.value.deadline_stakeholder || null,
      })
    }
    closeModal()
  } catch (e) {
    // error handled in store
  } finally {
    saving.value = false
  }
}

// ── Delete ──
async function confirmDelete(id) {
  if (!confirm('Delete this note?')) return
  await store.deleteNote(id)
  if (selectedNote.value?.id === id) selectedNote.value = null
}

// ── Helpers ──
function noteTitle(note) {
  return note.content.split('\n')[0].slice(0, 100) || 'Untitled'
}

function formatDate(ts) {
  return ts ? dayjs(ts).format('MMM D, YYYY') : ''
}

function formatDeadlineDate(d) {
  return d ? dayjs(d).format('MMM D') : ''
}

function catStyle(cat) {
  const c = store.categoryColor(cat)
  return {
    '--cat-h': c.h,
    '--cat-s': c.s + '%',
    '--cat-l': c.l + '%',
  }
}

function setAccent(hue) {
  accentHue.value = hue
  document.documentElement.style.setProperty('--accent-hue', hue)
}

// Keep selected note synced when store data changes
watch(() => store.filteredNotes, () => {
  if (selectedNote.value) {
    const fresh = store.notes.find(n => n.id === selectedNote.value.id)
    if (!fresh) selectedNote.value = null
  }
}, { deep: true })
</script>

<style scoped>
/* ── Design tokens ── */
.notes-app {
  --accent-hue: 295;
  --accent-500: oklch(0.56 0.18 var(--accent-hue));
  --accent-600: oklch(0.50 0.18 var(--accent-hue));
  --accent-400: oklch(0.68 0.14 var(--accent-hue));
  --accent-100: oklch(0.96 0.025 var(--accent-hue));
  --accent-050: oklch(0.985 0.012 var(--accent-hue));

  --bg:          #f8f8f7;
  --bg-card:     #ffffff;
  --bg-sunken:   #f3f2f0;
  --border:      #e5e4e1;
  --border-soft: #eeede9;
  --text:        #1a1a1a;
  --text-dim:    #5c5c5c;
  --text-faint:  #9a9a9a;

  --radius:    0.75rem;
  --radius-lg: 1rem;

  --shadow-sm:  0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
  --shadow:     0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg:  0 8px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
  --shadow-card: 0 1px 4px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.03);

  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif;
  color: var(--text);
  font-size: 0.9375rem;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  min-height: calc(100vh - 5rem);
}

.notes-app button { font: inherit; color: inherit; cursor: pointer; background: none; border: none; padding: 0; }
.notes-app input, .notes-app select, .notes-app textarea { font: inherit; color: inherit; }

/* ── Main — full width for ultrawide ── */
.notes-main {
  padding: 2.25rem 3rem 5rem;
  max-width: 106.25rem;
  margin: 0 auto;
  width: 100%;
  position: relative;
}
.notes-header { margin-bottom: 1.75rem; }
.notes-title-row {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 2rem; margin-bottom: 1.25rem;
}
.eyebrow {
  font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.12em;
  color: var(--accent-600);
  margin-bottom: 0.375rem;
}
.notes-title {
  font-size: 2.25rem; font-weight: 700; margin: 0;
  letter-spacing: -0.02em;
  color: var(--text);
}

/* ── Stats ── */
.notes-stats {
  display: flex; gap: 2px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.375rem;
  box-shadow: var(--shadow-sm);
}
.stat {
  padding: 0.75rem 1.5rem;
  text-align: center;
  min-width: 5rem;
}
.stat + .stat { border-left: 1px solid var(--border-soft); }
.stat-value { font-size: 1.625rem; font-weight: 700; line-height: 1; color: var(--text); }
.stat-label { font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 0.375rem; font-weight: 600; }

/* ── Upcoming ── */
.upcoming {
  display: flex; align-items: center; gap: 1.25rem;
  background: linear-gradient(90deg, var(--accent-050), transparent 60%);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 0.875rem 1.25rem;
  margin-bottom: 0.5rem;
}
.upcoming-label {
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.1em;
  color: var(--accent-600); text-transform: uppercase;
  white-space: nowrap;
}
.upcoming-row { display: flex; gap: 0.625rem; flex-wrap: wrap; }
.upcoming-pill {
  display: inline-flex; align-items: center; gap: 0.625rem;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.5rem 1rem 0.5rem 0.5rem;
  transition: border-color 120ms, transform 120ms, box-shadow 120ms;
  box-shadow: var(--shadow-sm);
}
.upcoming-pill:hover { border-color: var(--accent-400); transform: translateY(-1px); box-shadow: var(--shadow); }
.upcoming-title { font-size: 0.8125rem; color: var(--text-dim); max-width: 15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Filter bar ── */
.filterbar {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: var(--shadow-sm);
}
.searchwrap {
  display: flex; align-items: center; gap: 0.75rem;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  padding: 0.625rem 1rem;
  height: 2.75rem;
  min-width: 17.5rem;
  flex-shrink: 0;
}
.searchwrap:focus-within { border-color: var(--accent-400); background: #fff; box-shadow: 0 0 0 3px var(--accent-100); }
.search {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 0.9375rem;
}
.search::placeholder { color: var(--text-faint); }
.search-clear {
  width: 1.375rem; height: 1.375rem; border-radius: 50%;
  color: var(--text-faint); display: flex; align-items: center; justify-content: center;
  font-size: 1.125rem; line-height: 1;
}
.search-clear:hover { background: var(--border); color: var(--text); }

.filters { display: flex; gap: 1.25rem; flex-wrap: wrap; align-items: center; flex: 1; }
.filter-group { display: flex; align-items: center; gap: 0.625rem; }
.filter-group-label {
  font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-faint); font-weight: 600;
}
.filter-group-pills { display: flex; gap: 0.5rem; flex-wrap: wrap; }

/* Context dropdown */
.context-select {
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  padding: 0.5625rem 1rem;
  height: 2.625rem;
  font-size: 0.875rem;
  background: #fff;
  color: var(--text);
  outline: none;
  min-width: 10rem;
  cursor: pointer;
}
.context-select:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }

/* Date filter */
.date-filter-group { gap: 0.625rem; }
.date-range-inputs {
  display: flex; align-items: center; gap: 0.5rem;
}
.date-input {
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  padding: 0.5625rem 0.875rem;
  height: 2.625rem;
  font-size: 0.8125rem;
  background: #fff;
  color: var(--text);
  outline: none;
  min-width: 8.75rem;
}
.date-input:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }
.date-separator { color: var(--text-faint); font-size: 1rem; }
.date-clear {
  width: 1.75rem; height: 1.75rem; border-radius: 50%;
  color: var(--text-faint); display: flex; align-items: center; justify-content: center;
  font-size: 1.25rem; line-height: 1;
}
.date-clear:hover { background: var(--border); color: var(--text); }

/* Deadline filter pill (stays as pill) */
.filter-pill {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.5625rem 1.25rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-dim);
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 120ms;
}
.filter-pill:hover { border-color: var(--text-faint); color: var(--text); background: var(--bg-sunken); }
.filter-pill.deadline-filter.active {
  background: oklch(0.95 0.06 35); color: oklch(0.45 0.14 35); border-color: oklch(0.78 0.1 35);
}

/* Inline editor status dropdown (next to Save / Delete) */
.status-select {
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  padding: 0.625rem 1rem;
  height: 2.625rem;
  font-size: 0.875rem;
  font-weight: 600;
  background: #fff;
  color: var(--text-dim);
  outline: none;
  cursor: pointer;
  transition: all 120ms;
}
.status-select:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }
.status-select:disabled { opacity: 0.6; cursor: not-allowed; }
.status-select-active    { background: oklch(0.95 0.06 150); color: oklch(0.42 0.13 150); border-color: oklch(0.78 0.1 150); }
.status-select-completed { background: oklch(0.95 0.05 230); color: oklch(0.44 0.13 230); border-color: oklch(0.78 0.09 230); }
.status-select-suspended { background: oklch(0.95 0.05 70);  color: oklch(0.46 0.12 70);  border-color: oklch(0.8 0.09 70); }
.status-select option { background: #fff; color: var(--text); }

/* ── Category bar (separate row, big pills) ── */
.category-bar {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  margin-bottom: 1.5rem;
  padding: 0.5rem 0;
}
.category-pills {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.cat-pill {
  display: inline-flex; align-items: center; gap: 0.625rem;
  padding: 0.6875rem 1.375rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-dim);
  font-size: 0.9375rem;
  font-weight: 500;
  transition: all 120ms;
  cursor: pointer;
}
.cat-pill:hover { border-color: var(--text-faint); color: var(--text); background: var(--bg-sunken); }
.cat-pill .catchip-dot { width: 0.625rem; height: 0.625rem; border-radius: 50%; background: hsl(var(--cat-h) var(--cat-s) var(--cat-l)); }
.cat-pill .filter-count {
  font-size: 0.75rem; color: var(--text-faint);
  background: var(--bg-sunken);
  padding: 0.1875rem 0.5625rem; border-radius: 999px;
  margin-left: 0.125rem; font-weight: 600;
}
.cat-pill.active {
  background: hsl(var(--cat-h) var(--cat-s) 94%);
  color: hsl(var(--cat-h) var(--cat-s) 30%);
  border-color: hsl(var(--cat-h) var(--cat-s) 70%);
}
.cat-pill.active .filter-count { background: hsl(var(--cat-h) var(--cat-s) 88%); }

.notes-app .add-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.625rem;
  background: var(--accent-500);
  color: #fff;
  padding: 0.75rem 3.5rem;
  height: 2.875rem;
  border-radius: 0.625rem;
  font-size: 0.9375rem;
  font-weight: 600;
  box-shadow: 0 0.125rem 0.5rem oklch(0.5 0.18 var(--accent-hue) / 0.25);
  transition: background 120ms, transform 120ms, box-shadow 120ms;
  white-space: nowrap;
  flex-shrink: 0;
}
.notes-app .add-btn:hover { background: var(--accent-600); transform: translateY(-1px); box-shadow: 0 0.25rem 0.875rem oklch(0.5 0.18 var(--accent-hue) / 0.3); }
.notes-app .add-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.notes-app .add-btn-lg { height: 3.125rem; padding: 0.875rem 4rem; font-size: 1rem; }

/* ── Shared atoms ── */
.catchip {
  display: inline-flex; align-items: center; gap: 0.375rem;
  padding: 0.3125rem 0.875rem;
  border-radius: 999px;
  background: hsl(var(--cat-h) var(--cat-s) 95%);
  color: hsl(var(--cat-h) var(--cat-s) 30%);
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
}
.catchip-dot { width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: hsl(var(--cat-h) var(--cat-s) var(--cat-l)); }

.ctxpill {
  font-size: 0.8125rem;
  padding: 0.3125rem 0.75rem;
  border-radius: 0.375rem;
  font-weight: 600;
  text-transform: lowercase;
  letter-spacing: 0.02em;
}
.ctxpill-work { background: var(--accent-100); color: var(--accent-600); }
.ctxpill-personal { background: oklch(0.96 0.04 55); color: oklch(0.48 0.12 55); }

/* ── Status pill (badge) ── */
.statuspill {
  font-size: 0.8125rem;
  padding: 0.3125rem 0.75rem;
  border-radius: 0.375rem;
  font-weight: 600;
  text-transform: capitalize;
  letter-spacing: 0.02em;
}
.statuspill-active    { background: oklch(0.95 0.06 150); color: oklch(0.42 0.13 150); }
.statuspill-completed { background: oklch(0.95 0.05 230); color: oklch(0.44 0.13 230); }
.statuspill-suspended { background: oklch(0.95 0.05 70);  color: oklch(0.46 0.12 70); }

.kwchip-static {
  display: inline-flex; align-items: center; gap: 0.1875rem;
  font-size: 0.75rem;
  color: var(--text-dim);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: 0.375rem;
  padding: 0.1875rem 0.5625rem;
  font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
}
.kwchip-static.removable { cursor: pointer; transition: all 120ms; }
.kwchip-static.removable:hover { background: #fff0f0; color: #c33; border-color: #f5c5c5; }
.kw-x { opacity: 0.5; margin-left: 0.1875rem; }

.deadline {
  display: inline-flex; align-items: center; gap: 0.3125rem;
  font-size: 0.8125rem;
  padding: 0.3125rem 0.75rem;
  border-radius: 0.375rem;
  font-weight: 600;
}
.deadline-overdue { background: oklch(0.94 0.08 20); color: oklch(0.45 0.18 20); }
.deadline-urgent  { background: oklch(0.95 0.06 35); color: oklch(0.48 0.15 35); }
.deadline-soon    { background: oklch(0.96 0.04 75); color: oklch(0.45 0.12 75); }
.deadline-later   { background: var(--bg-sunken); color: var(--text-dim); }

.speaker {
  display: inline-flex; align-items: center; gap: 0.3125rem;
  font-size: 0.8125rem;
  padding: 0.3125rem 0.75rem;
  border-radius: 0.375rem;
  background: oklch(0.96 0.02 320);
  color: oklch(0.45 0.11 320);
  font-weight: 500;
}

.processed-block {
  background: var(--accent-050);
  border-left: 3px solid var(--accent-400);
  padding: 0.875rem 1.25rem;
  border-radius: 0 0.625rem 0.625rem 0;
}
.processed-label {
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.08em;
  color: var(--accent-600);
  text-transform: uppercase;
  margin-bottom: 0.375rem;
}
.processed-text { font-size: 0.84375rem; color: var(--text-dim); line-height: 1.6; font-style: italic; }

/* ════════════════════════════════════════════
   SPLIT LAYOUT — the only layout
   ════════════════════════════════════════════ */
.split-layout {
  display: grid;
  grid-template-columns: minmax(25rem, 32.5rem) 1fr;
  gap: 1.5rem;
  min-height: calc(100vh - 23.75rem);
}

/* ── Left panel: note list ── */
.split-list {
  display: flex; flex-direction: column; gap: 1rem;
  max-height: calc(100vh - 21.25rem);
  overflow-y: auto;
  /* Extra padding so the selected card's glow rings + scale aren't clipped */
  padding: 0.75rem 1rem;
  margin: -0.75rem -1rem;
  /* Subtle scrollbar */
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

/* ── Note card (left panel) ── */
.split-card {
  position: relative;
  text-align: left;
  background: var(--bg-card);
  border: none;
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  flex-shrink: 0;
  transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease;
  /* Card definition is entirely outer (shadow-based), so selection can build on it cleanly */
  box-shadow:
    0 0 0 1px var(--border),
    var(--shadow-card);
  cursor: pointer;
}
.split-card:hover {
  box-shadow:
    0 0 0 1px var(--accent-400),
    var(--shadow);
  transform: translateY(-1px);
}
.split-card.selected,
.split-card.selected:focus,
.split-card.selected:focus-visible,
.split-card.selected:active {
  outline: none;
  box-shadow:
    0 0 0 1px var(--border),
    0 4px 8px rgba(0, 0, 0, 0.12),
    0 4px 8px oklch(0.5 0.18 var(--accent-hue) / 0.22);
  background: var(--accent-100);
  transform: translateY(-2px) scale(1.03);
}
.split-card:focus, .split-card:focus-visible, .split-card:active { outline: none; }
.split-card.selected .split-card-title { color: var(--accent-600); }

/* Greyed-out state for completed / suspended notes */
.split-card.is-inactive { background: var(--bg-sunken); }
.split-card.is-inactive:not(.selected) .split-card-stripe { filter: grayscale(0.5); opacity: 0.1; }
.split-card.is-inactive:not(.selected) .split-card-title { color: var(--text-dim); }
.split-card.is-inactive:not(.selected) .split-card-preview,
.split-card.is-inactive:not(.selected) .split-card-date { color: var(--text-faint); }
.split-card.is-inactive:not(.selected) .split-card-body { opacity: 0.5; }
.split-card.is-inactive:not(.selected):hover .split-card-body { opacity: 1; }

/* Category color stripe on left */
.split-card-stripe {
  width: 0.3125rem;
  flex-shrink: 0;
  background: hsl(var(--cat-h) var(--cat-s) var(--cat-l));
  border-radius: 0.1875rem 0 0 0.1875rem;
}
.split-card.selected .split-card-stripe {
  background: var(--accent-500);
  width: 0.3rem;
}

.split-card-body {
  flex: 1;
  padding: 1rem 1.25rem;
  display: flex; flex-direction: column; gap: 0.5rem;
  min-width: 0;
}

.split-card-top {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
}
.split-card-title {
  font-size: 1rem; font-weight: 600; color: var(--text);
  line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.split-card-date {
  font-size: 0.8125rem; color: var(--text-faint); white-space: nowrap;
  flex-shrink: 0; padding-top: 0.125rem;
}

.split-card-preview {
  font-size: 0.875rem; color: var(--text-dim); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}

.split-card-meta {
  display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
  margin-top: 0.25rem;
}
.split-card-kws {
  display: inline-flex; gap: 0.25rem; margin-left: auto;
}

/* ── Right panel: editor ── */
.split-editor {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex; flex-direction: column;
  box-shadow: var(--shadow);
}

.inline-editor {
  display: flex; flex-direction: column;
  height: 100%;
  padding: 1.75rem 2.25rem 1.5rem;
  gap: 1rem;
}

.inline-editor-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 1rem; border-bottom: 1px solid var(--border-soft);
}
.inline-editor-meta { display: flex; gap: 0.75rem; align-items: center; }
.inline-editor-date { font-size: 0.8125rem; color: var(--text-faint); }
.inline-editor-actions { display: flex; gap: 0.625rem; }

.inline-processed { margin: 0.25rem 0 0.5rem; }

.inline-editor-text {
  flex: 1;
  min-height: 18.75rem;
  border: none; outline: none;
  resize: none;
  font-size: 1rem;
  line-height: 1.7;
  color: var(--text);
  background: transparent;
  font-family: inherit;
  padding: 0.75rem 0;
}

.inline-editor-foot {
  display: flex; flex-direction: column; gap: 0.875rem;
  padding-top: 1rem; border-top: 1px solid var(--border-soft);
}

.foot-label {
  font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-faint); margin-right: 0.25rem;
}

.inline-editor-kws { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }

.inline-editor-fields {
  display: flex; flex-wrap: wrap; gap: 0.875rem; align-items: flex-end;
}
.inline-field {
  display: flex; flex-direction: column; gap: 0.25rem;
}

.deadline-toggle { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; cursor: pointer; font-weight: 500; }
.deadline-toggle input { accent-color: var(--accent-500); width: 1rem; height: 1rem; }

.sel {
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.5625rem 1rem;
  height: 2.5rem;
  font-size: 0.875rem;
  background: #fff;
  color: var(--text);
  outline: none;
  min-width: 7.5rem;
}
.sel:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }

.kw-input {
  border: 1px solid var(--border-soft); outline: none; background: var(--bg-sunken);
  padding: 0.375rem 0.875rem;
  border-radius: 0.375rem;
  font-size: 0.8125rem;
  font-family: 'SF Mono', ui-monospace, monospace;
  width: 8.75rem;
  height: 2rem;
}
.kw-input:focus { background: var(--accent-050); border-color: var(--accent-400); }

/* Placeholder state */
.split-placeholder {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 3.75rem;
  text-align: center;
}
.split-placeholder-title { font-size: 1.125rem; font-weight: 600; color: var(--text); margin-bottom: 0.5rem; }
.split-placeholder-sub { font-size: 0.875rem; color: var(--text-faint); max-width: 18.75rem; line-height: 1.5; }

/* ── Modal ── */
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.25);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
  animation: fade-in 140ms;
}
.modal {
  background: #fff;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 42.5rem;
  max-width: calc(100vw - 3rem);
  max-height: calc(100vh - 3rem);
  display: flex; flex-direction: column;
  animation: pop-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.1);
}
.modal-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 1.25rem 1.75rem;
  border-bottom: 1px solid var(--border-soft);
}
.modal-title { font-size: 1.25rem; font-weight: 700; }
.modal-close {
  width: 2rem; height: 2rem; border-radius: 0.5rem;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint);
  transition: all 120ms;
}
.modal-close:hover { background: var(--bg-sunken); color: var(--text); }

.modal-body { padding: 1.5rem 1.75rem; display: flex; flex-direction: column; gap: 1.125rem; overflow-y: auto; }

.modal-meta { display: flex; gap: 1rem; }
.field { display: flex; flex-direction: column; gap: 0.375rem; flex: 1; }
.field > label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); font-weight: 600; }

.modal-textarea {
  width: 100%;
  min-height: 13.75rem;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  padding: 1rem 1.25rem;
  font-size: 0.9375rem;
  line-height: 1.65;
  resize: vertical;
  outline: none;
  font-family: inherit;
  background: #fff;
}
.modal-textarea:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }

.modal-deadline { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; padding-top: 0.25rem; }

.modal-foot {
  display: flex; gap: 0.75rem; align-items: center;
  padding: 1.125rem 1.75rem;
  border-top: 1px solid var(--border-soft);
}
.btn-ghost {
  padding: 0.625rem 1.5rem; height: 2.625rem; border-radius: 0.625rem;
  font-size: 0.875rem; color: var(--text-dim);
  border: 1px solid var(--border);
  background: #fff;
  transition: all 120ms;
  display: inline-flex; align-items: center;
  font-weight: 500;
}
.btn-ghost:hover { border-color: var(--text-faint); color: var(--text); background: var(--bg-sunken); }
.btn-ghost.btn-danger:hover { border-color: #f5c5c5; background: #fff0f0; color: #c33; }
.btn-ghost.btn-save:hover { border-color: var(--accent-400); background: var(--accent-050); color: var(--accent-600); }

/* ── Empty ── */
.empty {
  background: var(--bg-card);
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  padding: 5rem 2.5rem;
  text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
}
.empty-art { margin-bottom: 0.5rem; }
.empty-title { font-size: 1.25rem; font-weight: 600; color: var(--text); }
.empty-sub { font-size: 0.9375rem; color: var(--text-dim); }
.empty-actions { display: flex; gap: 0.75rem; margin-top: 1rem; }

/* ── Tweaks ── */
.tweaks-toggle {
  position: fixed;
  bottom: 1.5rem; right: 1.5rem;
  width: 2.75rem; height: 2.75rem;
  border-radius: 50%;
  background: var(--accent-500);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--shadow-lg);
  z-index: 49;
  transition: background 120ms, transform 120ms;
}
.tweaks-toggle:hover { background: var(--accent-600); transform: scale(1.08); }

.tweaks {
  position: fixed;
  bottom: 5rem; right: 1.5rem;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 1rem 1.25rem;
  z-index: 50;
  display: flex; flex-direction: column; gap: 0.75rem;
  animation: pop-in 200ms;
}
.tweaks-head { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-600); }
.hue-row { display: flex; gap: 0.5rem; }
.hue-swatch {
  width: 1.75rem; height: 1.75rem; border-radius: 0.5rem;
  border: 2px solid transparent;
  transition: transform 120ms;
}
.hue-swatch:hover { transform: scale(1.1); }
.hue-swatch.active { border-color: var(--text); box-shadow: 0 0 0 2px #fff inset; }

/* ── Animations ── */
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop-in  { from { opacity: 0; transform: translateY(0.375rem) scale(0.97); } to { opacity: 1; transform: none; } }

/* ── Responsive ── */
@media (max-width: 62.5em) {
  .filterbar { flex-wrap: wrap; }
  .notes-title-row { flex-direction: column; align-items: flex-start; }
  .split-layout { grid-template-columns: 1fr; }
}
</style>
