<template>
  <div class="notes-app">
    <div class="notes-main">
      <!-- ── Header ── -->
      <div class="notes-header">
        <div class="notes-title-row">
          <div>
            <div class="eyebrow">PRODUCTIVITY</div>
            <h1 class="notes-title">Notes</h1>
          </div>
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
          <i class="pi pi-search" style="color: var(--text-faint); font-size: 15px;"></i>
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
          <!-- Context pills -->
          <div class="filter-group" v-if="store.allContexts.length">
            <span class="filter-group-label">Context</span>
            <div class="filter-group-pills">
              <button
                v-for="ctx in store.allContexts" :key="ctx"
                class="filter-pill"
                :class="[
                  'ctx-' + ctx,
                  { active: store.activeContexts.includes(ctx) }
                ]"
                @click="store.toggleContext(ctx)"
              >{{ ctx }}</button>
            </div>
          </div>

          <!-- Category pills -->
          <div class="filter-group" v-if="store.allCategories.length">
            <span class="filter-group-label">Category</span>
            <div class="filter-group-pills">
              <button
                v-for="cat in store.allCategories" :key="cat"
                class="filter-pill cat-filter"
                :class="{ active: store.activeCategories.includes(cat) }"
                :style="{ '--cat-hue': store.categoryHue(cat) }"
                @click="store.toggleCategory(cat)"
              >
                <span class="catchip-dot"></span>
                {{ cat }}
                <span class="filter-count">{{ store.categoryCounts[cat] || 0 }}</span>
              </button>
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
                <i class="pi pi-clock" style="font-size: 13px;"></i>
                Has deadline
              </button>
            </div>
          </div>
        </div>

        <button class="add-btn" @click="openAddModal">
          <i class="pi pi-plus" style="font-size: 14px;"></i>
          Add Note
        </button>
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
            <i class="pi pi-plus" style="font-size: 14px;"></i> New Note
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
            :class="{ selected: selectedNote?.id === note.id }"
            :style="{ '--cat-hue': store.categoryHue(note.category) }"
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
                  :style="{ '--cat-hue': store.categoryHue(note.category) }"
                >
                  <span class="catchip-dot"></span> {{ note.category }}
                </span>
                <span class="ctxpill" :class="'ctxpill-' + note.context">{{ note.context }}</span>
                <span v-if="note.speaker" class="speaker">
                  <i class="pi pi-user" style="font-size: 11px;"></i> {{ note.speaker }}
                </span>
                <span v-if="note.deadline && note.deadline_date" class="deadline" :class="'deadline-' + store.deadlineUrgency(note.deadline_date)">
                  <i class="pi pi-clock" style="font-size: 11px;"></i>
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
                <span class="catchip" :style="{ '--cat-hue': store.categoryHue(editForm.category) }">
                  <span class="catchip-dot"></span> {{ editForm.category }}
                </span>
                <span class="ctxpill" :class="'ctxpill-' + editForm.context">{{ editForm.context }}</span>
                <span class="inline-editor-date">{{ formatDate(selectedNote.created_at) }}</span>
              </div>
              <div class="inline-editor-actions">
                <button class="btn-ghost btn-save" @click="saveInlineEdit">
                  <i class="pi pi-check" style="font-size: 13px; margin-right: 6px;"></i> Save
                </button>
                <button class="btn-ghost btn-danger" @click="confirmDelete(selectedNote.id)">
                  <i class="pi pi-trash" style="font-size: 13px; margin-right: 6px;"></i> Delete
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
                  placeholder="+ add tag"
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
            <i class="pi pi-file-edit" style="font-size: 3rem; color: var(--text-faint); margin-bottom: 16px;"></i>
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
        <i class="pi pi-palette" style="font-size: 16px;"></i>
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
            <i class="pi pi-times" style="font-size: 14px;"></i>
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
              placeholder="+ keyword (Enter)"
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
              <input class="sel" v-model="modalForm.deadline_stakeholder" placeholder="Stakeholder" style="min-width: 140px;" />
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

  --radius:    12px;
  --radius-lg: 16px;

  --shadow-sm:  0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
  --shadow:     0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg:  0 8px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);
  --shadow-card: 0 1px 4px rgba(0,0,0,0.05), 0 2px 12px rgba(0,0,0,0.03);

  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif;
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: calc(100vh - 80px);
}

.notes-app button { font: inherit; color: inherit; cursor: pointer; background: none; border: none; padding: 0; }
.notes-app input, .notes-app select, .notes-app textarea { font: inherit; color: inherit; }

/* ── Main — full width for ultrawide ── */
.notes-main {
  padding: 36px 48px 80px;
  width: 100%;
  position: relative;
}
.notes-header { margin-bottom: 28px; }
.notes-title-row {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 32px; margin-bottom: 20px;
}
.eyebrow {
  font-size: 12px; font-weight: 700; letter-spacing: 0.12em;
  color: var(--accent-600);
  margin-bottom: 6px;
}
.notes-title {
  font-size: 34px; font-weight: 700; margin: 0;
  letter-spacing: -0.02em;
  color: var(--text);
}

/* ── Stats ── */
.notes-stats {
  display: flex; gap: 2px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px;
  box-shadow: var(--shadow-sm);
}
.stat {
  padding: 12px 24px;
  text-align: center;
  min-width: 80px;
}
.stat + .stat { border-left: 1px solid var(--border-soft); }
.stat-value { font-size: 24px; font-weight: 700; line-height: 1; color: var(--text); }
.stat-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 6px; font-weight: 600; }

/* ── Upcoming ── */
.upcoming {
  display: flex; align-items: center; gap: 20px;
  background: linear-gradient(90deg, var(--accent-050), transparent 60%);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  padding: 14px 20px;
  margin-bottom: 8px;
}
.upcoming-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.1em;
  color: var(--accent-600); text-transform: uppercase;
  white-space: nowrap;
}
.upcoming-row { display: flex; gap: 10px; flex-wrap: wrap; }
.upcoming-pill {
  display: inline-flex; align-items: center; gap: 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 8px 16px 8px 8px;
  transition: border-color 120ms, transform 120ms, box-shadow 120ms;
  box-shadow: var(--shadow-sm);
}
.upcoming-pill:hover { border-color: var(--accent-400); transform: translateY(-1px); box-shadow: var(--shadow); }
.upcoming-title { font-size: 13px; color: var(--text-dim); max-width: 240px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Filter bar ── */
.filterbar {
  display: flex;
  align-items: center;
  gap: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 24px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}
.searchwrap {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 16px;
  height: 44px;
  min-width: 280px;
  flex-shrink: 0;
}
.searchwrap:focus-within { border-color: var(--accent-400); background: #fff; box-shadow: 0 0 0 3px var(--accent-100); }
.search {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 14px;
}
.search::placeholder { color: var(--text-faint); }
.search-clear {
  width: 22px; height: 22px; border-radius: 50%;
  color: var(--text-faint); display: flex; align-items: center; justify-content: center;
  font-size: 18px; line-height: 1;
}
.search-clear:hover { background: var(--border); color: var(--text); }

.filters { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; flex: 1; }
.filter-group { display: flex; align-items: center; gap: 8px; }
.filter-group-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-faint); font-weight: 600;
}
.filter-group-pills { display: flex; gap: 6px; flex-wrap: wrap; }

.filter-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 7px 16px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 500;
  transition: all 120ms;
}
.filter-pill:hover { border-color: var(--text-faint); color: var(--text); background: var(--bg-sunken); }
.filter-pill .catchip-dot { width: 8px; height: 8px; border-radius: 50%; background: oklch(0.6 0.16 var(--cat-hue)); }
.filter-count {
  font-size: 11px; color: var(--text-faint);
  background: var(--bg-sunken);
  padding: 2px 7px; border-radius: 999px;
  margin-left: 2px; font-weight: 600;
}

.filter-pill.ctx-work.active { background: oklch(0.96 0.04 var(--accent-hue)); color: var(--accent-600); border-color: var(--accent-400); }
.filter-pill.ctx-personal.active { background: oklch(0.96 0.04 55); color: oklch(0.45 0.12 55); border-color: oklch(0.78 0.1 55); }

.filter-pill.cat-filter.active {
  background: oklch(0.96 0.05 var(--cat-hue));
  color: oklch(0.4 0.14 var(--cat-hue));
  border-color: oklch(0.8 0.1 var(--cat-hue));
}
.filter-pill.cat-filter.active .filter-count { background: oklch(0.92 0.06 var(--cat-hue)); }

.filter-pill.deadline-filter.active {
  background: oklch(0.95 0.06 35); color: oklch(0.45 0.14 35); border-color: oklch(0.78 0.1 35);
}

.add-btn {
  display: inline-flex; align-items: center; gap: 10px;
  background: var(--accent-500);
  color: #fff;
  padding: 12px 28px;
  height: 44px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 2px 8px oklch(0.5 0.18 var(--accent-hue) / 0.25);
  transition: background 120ms, transform 120ms, box-shadow 120ms;
  white-space: nowrap;
  flex-shrink: 0;
}
.add-btn:hover { background: var(--accent-600); transform: translateY(-1px); box-shadow: 0 4px 14px oklch(0.5 0.18 var(--accent-hue) / 0.3); }
.add-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.add-btn-lg { height: 48px; padding: 14px 32px; font-size: 15px; }

/* ── Shared atoms ── */
.catchip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: oklch(0.97 0.04 var(--cat-hue));
  color: oklch(0.38 0.14 var(--cat-hue));
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.catchip-dot { width: 7px; height: 7px; border-radius: 50%; background: oklch(0.58 0.16 var(--cat-hue)); }

.ctxpill {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  font-weight: 600;
  text-transform: lowercase;
  letter-spacing: 0.02em;
}
.ctxpill-work { background: var(--accent-100); color: var(--accent-600); }
.ctxpill-personal { background: oklch(0.96 0.04 55); color: oklch(0.48 0.12 55); }

.kwchip-static {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 3px 9px;
  font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
}
.kwchip-static.removable { cursor: pointer; transition: all 120ms; }
.kwchip-static.removable:hover { background: #fff0f0; color: #c33; border-color: #f5c5c5; }
.kw-x { opacity: 0.5; margin-left: 3px; }

.deadline {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  font-weight: 600;
}
.deadline-overdue { background: oklch(0.94 0.08 20); color: oklch(0.45 0.18 20); }
.deadline-urgent  { background: oklch(0.95 0.06 35); color: oklch(0.48 0.15 35); }
.deadline-soon    { background: oklch(0.96 0.04 75); color: oklch(0.45 0.12 75); }
.deadline-later   { background: var(--bg-sunken); color: var(--text-dim); }

.speaker {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  background: oklch(0.96 0.02 320);
  color: oklch(0.45 0.11 320);
  font-weight: 500;
}

.processed-block {
  background: var(--accent-050);
  border-left: 3px solid var(--accent-400);
  padding: 14px 20px;
  border-radius: 0 10px 10px 0;
}
.processed-label {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
  color: var(--accent-600);
  text-transform: uppercase;
  margin-bottom: 6px;
}
.processed-text { font-size: 13.5px; color: var(--text-dim); line-height: 1.6; font-style: italic; }

/* ════════════════════════════════════════════
   SPLIT LAYOUT — the only layout
   ════════════════════════════════════════════ */
.split-layout {
  display: grid;
  grid-template-columns: minmax(400px, 520px) 1fr;
  gap: 24px;
  min-height: calc(100vh - 380px);
}

/* ── Left panel: note list ── */
.split-list {
  display: flex; flex-direction: column; gap: 10px;
  max-height: calc(100vh - 340px);
  overflow-y: auto;
  padding-right: 8px;
  /* Subtle scrollbar */
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

/* ── Note card (left panel) ── */
.split-card {
  position: relative;
  text-align: left;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  transition: all 150ms ease;
  box-shadow: var(--shadow-card);
  cursor: pointer;
}
.split-card:hover {
  border-color: var(--accent-400);
  box-shadow: var(--shadow);
  transform: translateY(-1px);
}
.split-card.selected {
  border-color: var(--accent-500);
  box-shadow: 0 0 0 2px var(--accent-100), var(--shadow);
  background: var(--accent-050);
}

/* Category color stripe on left */
.split-card-stripe {
  width: 5px;
  flex-shrink: 0;
  background: oklch(0.62 0.17 var(--cat-hue));
  border-radius: 3px 0 0 3px;
}
.split-card.selected .split-card-stripe {
  background: var(--accent-500);
}

.split-card-body {
  flex: 1;
  padding: 16px 20px;
  display: flex; flex-direction: column; gap: 8px;
  min-width: 0;
}

.split-card-top {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
}
.split-card-title {
  font-size: 15px; font-weight: 600; color: var(--text);
  line-height: 1.35;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.split-card-date {
  font-size: 12px; color: var(--text-faint); white-space: nowrap;
  flex-shrink: 0; padding-top: 2px;
}

.split-card-preview {
  font-size: 13px; color: var(--text-dim); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}

.split-card-meta {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 4px;
}
.split-card-kws {
  display: inline-flex; gap: 4px; margin-left: auto;
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
  padding: 28px 36px 24px;
  gap: 16px;
}

.inline-editor-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 16px; border-bottom: 1px solid var(--border-soft);
}
.inline-editor-meta { display: flex; gap: 12px; align-items: center; }
.inline-editor-date { font-size: 13px; color: var(--text-faint); }
.inline-editor-actions { display: flex; gap: 10px; }

.inline-processed { margin: 4px 0 8px; }

.inline-editor-text {
  flex: 1;
  min-height: 300px;
  border: none; outline: none;
  resize: none;
  font-size: 15px;
  line-height: 1.7;
  color: var(--text);
  background: transparent;
  font-family: inherit;
  padding: 12px 0;
}

.inline-editor-foot {
  display: flex; flex-direction: column; gap: 14px;
  padding-top: 16px; border-top: 1px solid var(--border-soft);
}

.foot-label {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--text-faint); margin-right: 4px;
}

.inline-editor-kws { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

.inline-editor-fields {
  display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end;
}
.inline-field {
  display: flex; flex-direction: column; gap: 4px;
}

.deadline-toggle { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; font-weight: 500; }
.deadline-toggle input { accent-color: var(--accent-500); width: 16px; height: 16px; }

.sel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 14px;
  height: 38px;
  font-size: 13px;
  background: #fff;
  color: var(--text);
  outline: none;
  min-width: 120px;
}
.sel:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }

.kw-input {
  border: 1px solid var(--border-soft); outline: none; background: var(--bg-sunken);
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-family: 'SF Mono', ui-monospace, monospace;
  width: 120px;
  height: 30px;
}
.kw-input:focus { background: var(--accent-050); border-color: var(--accent-400); }

/* Placeholder state */
.split-placeholder {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 60px;
  text-align: center;
}
.split-placeholder-title { font-size: 18px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.split-placeholder-sub { font-size: 14px; color: var(--text-faint); max-width: 300px; line-height: 1.5; }

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
  width: 680px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  display: flex; flex-direction: column;
  animation: pop-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.1);
}
.modal-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 28px;
  border-bottom: 1px solid var(--border-soft);
}
.modal-title { font-size: 18px; font-weight: 700; }
.modal-close {
  width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint);
  transition: all 120ms;
}
.modal-close:hover { background: var(--bg-sunken); color: var(--text); }

.modal-body { padding: 24px 28px; display: flex; flex-direction: column; gap: 18px; overflow-y: auto; }

.modal-meta { display: flex; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.field > label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); font-weight: 600; }

.modal-textarea {
  width: 100%;
  min-height: 220px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 20px;
  font-size: 14px;
  line-height: 1.65;
  resize: vertical;
  outline: none;
  font-family: inherit;
  background: #fff;
}
.modal-textarea:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }

.modal-deadline { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding-top: 4px; }

.modal-foot {
  display: flex; gap: 12px; align-items: center;
  padding: 18px 28px;
  border-top: 1px solid var(--border-soft);
}
.btn-ghost {
  padding: 10px 20px; height: 40px; border-radius: 10px;
  font-size: 14px; color: var(--text-dim);
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
  padding: 80px 40px;
  text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
}
.empty-art { margin-bottom: 8px; }
.empty-title { font-size: 20px; font-weight: 600; color: var(--text); }
.empty-sub { font-size: 15px; color: var(--text-dim); }
.empty-actions { display: flex; gap: 12px; margin-top: 16px; }

/* ── Tweaks ── */
.tweaks-toggle {
  position: fixed;
  bottom: 24px; right: 24px;
  width: 44px; height: 44px;
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
  bottom: 80px; right: 24px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 16px 20px;
  z-index: 50;
  display: flex; flex-direction: column; gap: 12px;
  animation: pop-in 200ms;
}
.tweaks-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent-600); }
.hue-row { display: flex; gap: 8px; }
.hue-swatch {
  width: 28px; height: 28px; border-radius: 8px;
  border: 2px solid transparent;
  transition: transform 120ms;
}
.hue-swatch:hover { transform: scale(1.1); }
.hue-swatch.active { border-color: var(--text); box-shadow: 0 0 0 2px #fff inset; }

/* ── Animations ── */
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop-in  { from { opacity: 0; transform: translateY(6px) scale(0.97); } to { opacity: 1; transform: none; } }

/* ── Responsive ── */
@media (max-width: 1000px) {
  .filterbar { flex-wrap: wrap; }
  .notes-title-row { flex-direction: column; align-items: flex-start; }
  .split-layout { grid-template-columns: 1fr; }
}
</style>
