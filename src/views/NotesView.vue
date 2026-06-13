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
          <select class="f-control" v-model="contextDropdown" @change="onContextChange">
            <option value="">All contexts</option>
            <option v-for="ctx in store.allContexts" :key="ctx" :value="ctx">{{ ctx }}</option>
          </select>

          <select class="f-control" v-model="store.categoryFilter">
            <option value="all">All categories ({{ store.categoryCounts.all || 0 }})</option>
            <option v-for="c in store.allCategories" :key="c" :value="c">
              {{ c }} ({{ store.categoryCounts[c] || 0 }})
            </option>
          </select>

          <select class="f-control" v-model="store.stakeholderFilter" :disabled="!store.allStakeholders.length">
            <option value="all">Any stakeholder</option>
            <option v-for="s in store.allStakeholders" :key="s" :value="s">
              {{ s }} ({{ store.stakeholderCounts[s] || 0 }})
            </option>
          </select>

          <select class="f-control" v-model="store.statusFilter">
            <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
              {{ opt.label === 'All' ? 'Any status' : opt.label }} ({{ store.statusCounts[opt.value] || 0 }})
            </option>
          </select>

          <select class="f-control" v-model="store.priorityFilter">
            <option v-for="opt in priorityOptions" :key="opt.value" :value="opt.value">
              {{ opt.label === 'All' ? 'Any priority' : opt.label }} ({{ store.priorityCounts[opt.value] || 0 }})
            </option>
          </select>

          <div class="f-daterange">
            <input type="date" class="f-control f-date" v-model="store.dateFrom" />
            <span class="f-date-sep">–</span>
            <input type="date" class="f-control f-date" v-model="store.dateTo" />
            <button
              v-if="store.dateFrom || store.dateTo"
              class="f-date-clear"
              @click="store.dateFrom = null; store.dateTo = null"
              title="Clear dates"
            >&times;</button>
          </div>

          <button
            class="f-toggle"
            :class="{ active: store.deadlineFilter }"
            @click="store.deadlineFilter = !store.deadlineFilter"
          >
            <i class="pi pi-clock" style="font-size: 0.875rem;"></i>
            Has deadline
          </button>

          <button
            class="f-toggle f-toggle-review"
            :class="{ active: store.needsReviewFilter }"
            :disabled="!store.needsReviewCount && !store.needsReviewFilter"
            @click="store.needsReviewFilter = !store.needsReviewFilter"
            :title="store.needsReviewCount + ' note(s) outside the taxonomy'"
          >
            <i class="pi pi-exclamation-circle" style="font-size: 0.875rem;"></i>
            Needs review ({{ store.needsReviewCount }})
          </button>

          <button v-if="anyFilterActive" class="f-clear" @click="clearAllFilters">Clear</button>
        </div>

        <button class="add-btn" @click="openAddModal">
          <i class="pi pi-plus" style="font-size: 0.875rem;"></i>
          Add Note
        </button>
      </div>

      <!-- ── Subcategory filter bar ── -->
      <div class="category-bar" v-if="store.allSubcategories.length">
        <span class="filter-group-label">Subcategories</span>
        <div class="category-pills">
          <button
            v-for="sub in store.allSubcategories" :key="sub"
            class="cat-pill"
            :class="{ active: store.activeSubcategories.includes(sub) }"
            :style="catStyle(sub)"
            @click="store.toggleSubcategory(sub)"
          >
            <span class="catchip-dot"></span>
            {{ sub }}
            <span class="filter-count">{{ store.subcategoryCounts[sub] || 0 }}</span>
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
            :style="catStyle(store.noteSubcategory(note))"
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
                  :style="catStyle(store.noteSubcategory(note))"
                >
                  <span class="catchip-dot"></span> {{ store.noteSubcategory(note) }}
                </span>
                <span class="ctxpill" :class="'ctxpill-' + note.context">{{ note.context }}</span>
                <span v-if="note.category" class="subcatpill">{{ note.category }}</span>
                <span
                  v-if="store.needsReview(note)"
                  class="review-badge"
                  title="Not in the canonical taxonomy"
                >
                  <i class="pi pi-exclamation-circle" style="font-size: 0.625rem;"></i> review
                </span>
                <span
                  v-if="store.notePriority(note) !== 'none'"
                  class="prioritypill"
                  :class="'prioritypill-' + store.notePriority(note)"
                >{{ store.notePriority(note) }}</span>
                <span
                  v-if="store.noteStatus(note) !== 'active'"
                  class="statuspill"
                  :class="'statuspill-' + store.noteStatus(note)"
                >{{ store.noteStatus(note) }}</span>
                <span v-if="note.stakeholder" class="speaker stakeholder-chip">
                  <i class="pi pi-users" style="font-size: 0.6875rem;"></i> {{ note.stakeholder }}
                </span>
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
          <div class="editor-body">
            <div class="editor-head">
              <button class="editor-back" @click="selectedNote = null" title="Back to list">
                <i class="pi pi-arrow-left" style="font-size: 0.9375rem;"></i>
              </button>
              <div class="editor-meta">
                <span class="catchip" :style="catStyle(editForm.subcategory || 'unassigned')">
                  <span class="catchip-dot"></span> {{ editForm.subcategory || 'unassigned' }}
                </span>
                <span class="ctxpill" :class="'ctxpill-' + editForm.context">{{ editForm.context }}</span>
                <span v-if="editForm.category" class="subcatpill">{{ editForm.category }}</span>
                <span
                  v-if="store.needsReview(selectedNote)"
                  class="review-badge"
                  title="Not in the canonical taxonomy"
                >
                  <i class="pi pi-exclamation-circle" style="font-size: 0.625rem;"></i> review
                </span>
                <span
                  v-if="store.notePriority(selectedNote) !== 'none'"
                  class="prioritypill"
                  :class="'prioritypill-' + store.notePriority(selectedNote)"
                >{{ store.notePriority(selectedNote) }}</span>
                <span class="editor-date">{{ formatDate(selectedNote.created_at) }}</span>
              </div>
              <div class="editor-actions">
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
              class="editor-text"
              v-model="editForm.content"
              placeholder="Write your note..."
            ></textarea>
          </div>

          <aside class="rail">
            <section class="rail-section">
              <h4 class="rail-title">Classification</h4>
              <label class="rail-field">
                <span>Context</span>
                <select class="rail-input" v-model="editForm.context">
                  <option value="work">work</option>
                  <option value="personal">personal</option>
                </select>
              </label>
              <label class="rail-field">
                <span>Category</span>
                <select class="rail-input" v-model="editForm.category">
                  <option value="" disabled>Pick a category…</option>
                  <option
                    v-if="editForm.category && !editCategoryOptions.includes(editForm.category)"
                    :value="editForm.category"
                    disabled
                  >{{ editForm.category }} (legacy)</option>
                  <option v-for="c in editCategoryOptions" :key="c" :value="c">{{ c }}</option>
                </select>
              </label>
              <label class="rail-field">
                <span>Subcategory</span>
                <select class="rail-input" v-model="editForm.subcategory" :disabled="!editSubcategoryOptions.length">
                  <option value="" disabled>Pick a subcategory…</option>
                  <option
                    v-if="editForm.subcategory && !editSubcategoryOptions.includes(editForm.subcategory)"
                    :value="editForm.subcategory"
                    disabled
                  >{{ editForm.subcategory }} (legacy)</option>
                  <option v-for="s in editSubcategoryOptions" :key="s" :value="s">{{ s }}</option>
                </select>
              </label>
              <label class="rail-field">
                <span>Priority</span>
                <select class="rail-input" v-model="editForm.priority">
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </section>

            <section class="rail-section">
              <h4 class="rail-title">People</h4>
              <label class="rail-field">
                <span>Speaker</span>
                <input class="rail-input" v-model="editForm.speaker" placeholder="Optional" />
              </label>
              <label class="rail-field">
                <span>Stakeholder</span>
                <input class="rail-input" v-model="editForm.stakeholder" placeholder="Optional" />
              </label>
            </section>

            <section class="rail-section">
              <h4 class="rail-title">Tags</h4>
              <div class="rail-chips">
                <span
                  v-for="(kw, i) in editForm.keywords" :key="i"
                  class="kwchip-static removable"
                  @click="editForm.keywords.splice(i, 1)"
                >{{ kw }} <span class="kw-x">&times;</span></span>
                <input
                  class="rail-tag-input"
                  placeholder="+ tag ↵"
                  @keydown.enter.prevent="addKeywordToEdit"
                  v-model="newKeyword"
                />
              </div>
            </section>

            <section class="rail-section">
              <h4 class="rail-title">Related notes</h4>
              <div v-if="!relatedNotes.length" class="rail-empty">No linked notes yet</div>
              <ul v-else class="rail-rellist">
                <li v-for="rel in relatedNotes" :key="rel.id" class="rail-relitem">
                  <button class="rail-rellink" @click="selectNote(rel)">
                    <i class="pi pi-link" style="font-size: 0.75rem;"></i>
                    <span class="rail-reltitle">{{ noteTitle(rel) }}</span>
                  </button>
                  <button class="rail-relx" @click="unlinkRelated(rel.id)" title="Unlink">&times;</button>
                </li>
              </ul>
              <div class="rel-picker-wrap" ref="relPickerWrap">
                <button class="rail-link-btn" @click="openRelPicker">
                  <i class="pi pi-link" style="font-size: 0.8125rem;"></i>
                  Link related note
                </button>
                <div v-if="showRelatedPicker" class="rel-popover">
                  <input
                    ref="relSearchInput"
                    class="rel-popover-input"
                    v-model="relatedSearch"
                    placeholder="Search notes…"
                  />
                  <div class="rel-popover-list">
                    <button
                      v-for="cand in relatedSearchResults" :key="cand.id"
                      class="rel-popover-option"
                      @click="linkRelated(cand)"
                    >{{ noteTitle(cand) }}</button>
                    <div v-if="!relatedSearchResults.length" class="rel-popover-empty">No matches</div>
                  </div>
                </div>
              </div>
            </section>

            <section class="rail-section">
              <h4 class="rail-title">Deadline</h4>
              <label class="rail-toggle">
                <input type="checkbox" v-model="editForm.deadline" />
                <span>Has deadline</span>
              </label>
              <template v-if="editForm.deadline">
                <label class="rail-field">
                  <span>Due</span>
                  <input type="date" class="rail-input" v-model="editForm.deadline_date" />
                </label>
                <label class="rail-field">
                  <span>Stakeholder</span>
                  <input class="rail-input" v-model="editForm.deadline_stakeholder" placeholder="Optional" />
                </label>
              </template>
            </section>
          </aside>
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
          <textarea
            class="modal-textarea"
            v-model="modalForm.content"
            placeholder="Write your note..."
          ></textarea>

          <section class="modal-section">
            <h4 class="modal-section-title">Classification</h4>
            <div class="modal-grid modal-grid-2">
              <label class="modal-field">
                <span>Context</span>
                <select class="sel" v-model="modalForm.context">
                  <option value="work">work</option>
                  <option value="personal">personal</option>
                </select>
              </label>
              <label class="modal-field">
                <span>Category</span>
                <select class="sel" v-model="modalForm.category">
                  <option value="" disabled>Pick a category…</option>
                  <option v-for="c in modalCategoryOptions" :key="c" :value="c">{{ c }}</option>
                </select>
              </label>
              <label class="modal-field">
                <span>Subcategory</span>
                <select class="sel" v-model="modalForm.subcategory" :disabled="!modalSubcategoryOptions.length">
                  <option value="" disabled>Pick a subcategory…</option>
                  <option v-for="s in modalSubcategoryOptions" :key="s" :value="s">{{ s }}</option>
                </select>
              </label>
              <label class="modal-field">
                <span>Priority</span>
                <select class="sel" v-model="modalForm.priority">
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
          </section>

          <section class="modal-section">
            <h4 class="modal-section-title">People</h4>
            <div class="modal-grid modal-grid-2">
              <label class="modal-field">
                <span>Speaker</span>
                <input class="sel" v-model="modalForm.speaker" placeholder="Optional" />
              </label>
              <label class="modal-field">
                <span>Stakeholder</span>
                <input class="sel" v-model="modalForm.stakeholder" placeholder="Optional" />
              </label>
            </div>
          </section>

          <section class="modal-section">
            <h4 class="modal-section-title">Tags</h4>
            <div class="modal-chips">
              <span
                v-for="(kw, i) in modalForm.keywords" :key="i"
                class="kwchip-static removable"
                @click="modalForm.keywords.splice(i, 1)"
              >{{ kw }} <span class="kw-x">&times;</span></span>
              <input
                class="rail-tag-input"
                placeholder="+ keyword ↵"
                @keydown.enter.prevent="addKeywordToModal"
                v-model="modalNewKeyword"
              />
            </div>
          </section>

          <section class="modal-section">
            <h4 class="modal-section-title">Deadline</h4>
            <label class="rail-toggle">
              <input type="checkbox" v-model="modalForm.deadline" />
              <span>Has deadline</span>
            </label>
            <div v-if="modalForm.deadline" class="modal-grid modal-grid-2" style="margin-top: 0.625rem;">
              <label class="modal-field">
                <span>Due</span>
                <input type="date" class="sel" v-model="modalForm.deadline_date" />
              </label>
              <label class="modal-field">
                <span>Stakeholder</span>
                <input class="sel" v-model="modalForm.deadline_stakeholder" placeholder="Optional" />
              </label>
            </div>
          </section>
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
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { useNotesStore } from '@/stores/notes'
import { categoriesFor, subcategoriesFor } from '@/lib/taxonomy'
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
const priorityOptions = [
  { value: 'all', label: 'All' },
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
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

const anyFilterActive = computed(() =>
  !!contextDropdown.value
  || store.categoryFilter !== 'all'
  || store.activeSubcategories.length > 0
  || store.stakeholderFilter !== 'all'
  || store.statusFilter !== 'all'
  || store.priorityFilter !== 'all'
  || !!store.dateFrom
  || !!store.dateTo
  || store.deadlineFilter
  || store.needsReviewFilter
)

function clearAllFilters() {
  contextDropdown.value = ''
  store.activeContexts = []
  store.activeSubcategories = []
  store.categoryFilter = 'all'
  store.stakeholderFilter = 'all'
  store.statusFilter = 'all'
  store.priorityFilter = 'all'
  store.dateFrom = null
  store.dateTo = null
  store.deadlineFilter = false
  store.needsReviewFilter = false
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
    subcategory: '',
    content: '',
    keywords: [],
    speaker: '',
    stakeholder: '',
    priority: 'none',
    related_note_ids: [],
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
    subcategory: note.subcategory || '',
    content: note.content,
    keywords: [...(note.keywords || [])],
    speaker: note.speaker || '',
    stakeholder: note.stakeholder || '',
    priority: note.priority || 'none',
    related_note_ids: [...(note.related_note_ids || [])],
    deadline: note.deadline || false,
    deadline_date: note.deadline_date || '',
    deadline_stakeholder: note.deadline_stakeholder || '',
    processed_content: note.processed_content || '',
  }
  relatedSearch.value = ''
  showRelatedPicker.value = false
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
      subcategory: editForm.value.subcategory || 'unassigned',
      content: editForm.value.content,
      keywords: editForm.value.keywords,
      speaker: editForm.value.speaker || null,
      stakeholder: editForm.value.stakeholder || null,
      priority: editForm.value.priority || 'none',
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

// ── Taxonomy-driven cascading selects ──
const editCategoryOptions    = computed(() => categoriesFor(editForm.value.context))
const editSubcategoryOptions = computed(() => subcategoriesFor(editForm.value.context, editForm.value.category))
const modalCategoryOptions    = computed(() => categoriesFor(modalForm.value.context))
const modalSubcategoryOptions = computed(() => subcategoriesFor(modalForm.value.context, modalForm.value.category))

// When context changes, drop a category that no longer belongs to it.
watch(() => editForm.value.context, (ctx) => {
  if (editForm.value.category && !categoriesFor(ctx).includes(editForm.value.category)) {
    editForm.value.category = ''
    editForm.value.subcategory = ''
  }
})
watch(() => modalForm.value.context, (ctx) => {
  if (modalForm.value.category && !categoriesFor(ctx).includes(modalForm.value.category)) {
    modalForm.value.category = ''
    modalForm.value.subcategory = ''
  }
})

// When category changes, drop a subcategory that no longer belongs to it.
watch(() => editForm.value.category, (cat) => {
  const valid = subcategoriesFor(editForm.value.context, cat)
  if (editForm.value.subcategory && !valid.includes(editForm.value.subcategory)) {
    editForm.value.subcategory = ''
  }
})
watch(() => modalForm.value.category, (cat) => {
  const valid = subcategoriesFor(modalForm.value.context, cat)
  if (modalForm.value.subcategory && !valid.includes(modalForm.value.subcategory)) {
    modalForm.value.subcategory = ''
  }
})

// ── Related notes (link picker) ──
const relatedSearch = ref('')
const showRelatedPicker = ref(false)
const relPickerWrap = ref(null)
const relSearchInput = ref(null)

const relatedNotes = computed(() =>
  (editForm.value.related_note_ids || [])
    .map(id => store.notes.find(n => n.id === id))
    .filter(Boolean)
)

const relatedSearchResults = computed(() => {
  if (!selectedNote.value) return []
  const q = relatedSearch.value.trim().toLowerCase()
  const linked = new Set(editForm.value.related_note_ids || [])
  return store.notes
    .filter(n => n.id !== selectedNote.value.id && !linked.has(n.id))
    .filter(n => !q || n.content.toLowerCase().includes(q))
    .slice(0, 8)
})

async function openRelPicker() {
  showRelatedPicker.value = true
  relatedSearch.value = ''
  await nextTick()
  relSearchInput.value?.focus()
}

function closeRelPicker() {
  showRelatedPicker.value = false
  relatedSearch.value = ''
}

function onDocMousedown(e) {
  if (!showRelatedPicker.value) return
  const root = relPickerWrap.value
  if (root && !root.contains(e.target)) closeRelPicker()
}

onMounted(() => document.addEventListener('mousedown', onDocMousedown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMousedown))

async function linkRelated(cand) {
  if (!selectedNote.value) return
  await store.linkRelated(selectedNote.value.id, cand.id)
  const fresh = store.notes.find(n => n.id === selectedNote.value.id)
  if (fresh) {
    selectedNote.value = fresh
    editForm.value.related_note_ids = [...(fresh.related_note_ids || [])]
  }
  closeRelPicker()
}

async function unlinkRelated(otherId) {
  if (!selectedNote.value) return
  await store.unlinkRelated(selectedNote.value.id, otherId)
  const fresh = store.notes.find(n => n.id === selectedNote.value.id)
  if (fresh) {
    selectedNote.value = fresh
    editForm.value.related_note_ids = [...(fresh.related_note_ids || [])]
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
  if (
    !modalForm.value.content.trim()
    || !modalForm.value.category.trim()
    || !modalForm.value.subcategory.trim()
  ) return
  saving.value = true
  try {
    if (modalMode.value === 'add') {
      const created = await store.addNote({
        context: modalForm.value.context,
        category: modalForm.value.category,
        subcategory: modalForm.value.subcategory || 'unassigned',
        content: modalForm.value.content,
        keywords: modalForm.value.keywords,
        speaker: modalForm.value.speaker || null,
        stakeholder: modalForm.value.stakeholder || null,
        priority: modalForm.value.priority || 'none',
        deadline: modalForm.value.deadline,
        deadline_date: modalForm.value.deadline_date || null,
        deadline_stakeholder: modalForm.value.deadline_stakeholder || null,
      })
      if (created) selectNote(created)
    } else {
      await store.updateNote(modalForm.value.id, {
        context: modalForm.value.context,
        category: modalForm.value.category,
        subcategory: modalForm.value.subcategory || 'unassigned',
        content: modalForm.value.content,
        keywords: modalForm.value.keywords,
        speaker: modalForm.value.speaker || null,
        stakeholder: modalForm.value.stakeholder || null,
        priority: modalForm.value.priority || 'none',
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

function catStyle(name) {
  // `name` is now a subcategory — palette assignment lives in the store.
  const c = store.subcategoryColor(name)
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
watch(() => store.filteredNotes, (list) => {
  if (!selectedNote.value) return
  // Clear the selection if it no longer matches the current filters (or was deleted).
  const stillVisible = list.some(n => n.id === selectedNote.value.id)
  if (!stillVisible) selectedNote.value = null
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

.filters {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  row-gap: 0.5rem;
  align-items: center;
  flex: 1;
}

/* Unified filter control — selects, date inputs */
.f-control {
  height: 2.5rem;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  padding: 0 0.875rem;
  font-size: 0.8125rem;
  background: #fff;
  color: var(--text);
  outline: none;
  cursor: pointer;
  transition: border-color 120ms, box-shadow 120ms;
  min-width: 0;
}
.f-control:hover:not(:disabled) { border-color: var(--text-faint); }
.f-control:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }
.f-control:disabled { opacity: 0.55; cursor: not-allowed; }
select.f-control { padding-right: 0.5rem; }

/* Date range — two date inputs visually grouped */
.f-daterange {
  display: inline-flex; align-items: center; gap: 0.375rem;
}
.f-date { min-width: 8.5rem; font-size: 0.8125rem; padding: 0 0.625rem; }
.f-date-sep { color: var(--text-faint); font-size: 0.875rem; }
.f-date-clear {
  width: 1.625rem; height: 1.625rem; border-radius: 50%;
  color: var(--text-faint);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 1.125rem; line-height: 1;
}
.f-date-clear:hover { background: var(--border); color: var(--text); }

/* Has-deadline toggle — same shape as f-control */
.f-toggle {
  display: inline-flex; align-items: center; gap: 0.5rem;
  height: 2.5rem;
  padding: 0 1rem;
  border-radius: 0.625rem;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-dim);
  font-size: 0.8125rem;
  font-weight: 500;
  transition: all 120ms;
}
.f-toggle:hover { border-color: var(--text-faint); color: var(--text); }
.f-toggle.active {
  background: var(--accent-100);
  color: var(--accent-600);
  border-color: var(--accent-400);
  font-weight: 600;
}

.f-clear {
  font-size: 0.8125rem;
  color: var(--text-faint);
  text-decoration: underline;
  padding: 0 0.5rem;
}
.f-clear:hover { color: var(--text); }

/* Needs-review toggle — uses an amber palette to distinguish from the deadline toggle */
.f-toggle-review.active {
  background: oklch(0.95 0.07 60);
  color: oklch(0.45 0.16 60);
  border-color: oklch(0.78 0.13 60);
}
.f-toggle-review:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Review badge — small inline pill on cards / editor head */
.review-badge {
  display: inline-flex; align-items: center; gap: 0.25rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.1875rem 0.5rem;
  border-radius: 0.375rem;
  background: oklch(0.95 0.07 60);
  color: oklch(0.45 0.16 60);
  border: 1px solid oklch(0.85 0.11 60);
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

/* ── Subcategory chip ── */
.subcatpill {
  font-size: 0.8125rem;
  padding: 0.3125rem 0.75rem;
  border-radius: 0.375rem;
  font-weight: 600;
  background: var(--bg-sunken);
  color: var(--text-dim);
  border: 1px solid var(--border-soft);
  text-transform: lowercase;
}

/* ── Priority chip ── */
.prioritypill {
  font-size: 0.8125rem;
  padding: 0.3125rem 0.75rem;
  border-radius: 0.375rem;
  font-weight: 600;
  text-transform: capitalize;
  letter-spacing: 0.02em;
}
.prioritypill-low    { background: oklch(0.95 0.05 230); color: oklch(0.44 0.13 230); }
.prioritypill-medium { background: oklch(0.95 0.06 70);  color: oklch(0.46 0.13 70); }
.prioritypill-high   { background: oklch(0.94 0.08 25);  color: oklch(0.46 0.16 25); }

/* Stakeholder reuses .speaker styling; small tonal shift */
.speaker.stakeholder-chip {
  background: oklch(0.96 0.03 210);
  color: oklch(0.45 0.11 210);
}

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

/* ── Right panel: editor (body + rail grid) ── */
.split-editor {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: grid;
  grid-template-columns: 1fr 19rem;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.editor-body {
  display: flex; flex-direction: column;
  padding: 1.75rem 2.25rem 1.75rem;
  gap: 1rem;
  min-width: 0;
}

.editor-head {
  display: flex; justify-content: space-between; align-items: center;
  padding-bottom: 1rem; border-bottom: 1px solid var(--border-soft);
  gap: 1rem;
  flex-wrap: wrap;
}
.editor-meta { display: flex; gap: 0.625rem; align-items: center; flex-wrap: wrap; }
.editor-date { font-size: 0.8125rem; color: var(--text-faint); }
.editor-actions { display: flex; gap: 0.625rem; align-items: center; }

/* Back-to-list button — mobile master/detail only */
.editor-back {
  display: none;
  align-items: center; justify-content: center;
  width: 2.375rem; height: 2.375rem;
  border-radius: 0.5rem;
  color: var(--text-dim);
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  margin-right: 0.5rem;
  flex-shrink: 0;
  transition: all 120ms;
}
.editor-back:hover { color: var(--text); border-color: var(--text-faint); }

.inline-processed { margin: 0.25rem 0 0.5rem; }

.editor-text {
  flex: 1;
  min-height: 22rem;
  border: none; outline: none;
  resize: none;
  font-size: 1rem;
  line-height: 1.7;
  color: var(--text);
  background: transparent;
  font-family: inherit;
  padding: 0.75rem 0;
}

/* ── Right rail ── */
.rail {
  background: var(--bg-sunken);
  border-left: 1px solid var(--border);
  padding: 1.25rem 1.25rem 1.5rem;
  overflow-y: auto;
  max-height: calc(100vh - 21.25rem);
  display: flex; flex-direction: column;
}
.rail-section + .rail-section {
  border-top: 1px solid var(--border-soft);
  margin-top: 1.25rem;
  padding-top: 1.25rem;
}
.rail-title {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
  margin: 0 0 0.625rem;
}
.rail-field {
  display: flex; flex-direction: column; gap: 0.25rem;
  margin-bottom: 0.625rem;
}
.rail-field:last-child { margin-bottom: 0; }
.rail-field > span {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-dim);
}
.rail-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  height: 2.375rem;
  font-size: 0.8125rem;
  background: #fff;
  color: var(--text);
  outline: none;
  font-family: inherit;
}
.rail-input:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }

.rail-chips { display: flex; flex-wrap: wrap; gap: 0.375rem; align-items: center; }
.rail-tag-input {
  border: 1px dashed var(--border); outline: none; background: #fff;
  padding: 0.3125rem 0.625rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-family: 'SF Mono', ui-monospace, monospace;
  width: 100%;
  height: 1.875rem;
  color: var(--text);
}
.rail-tag-input:focus { background: var(--accent-050); border-color: var(--accent-400); border-style: solid; }

.rail-toggle {
  display: inline-flex; align-items: center; gap: 0.5rem;
  font-size: 0.8125rem; cursor: pointer; font-weight: 500;
  color: var(--text);
}
.rail-toggle input { accent-color: var(--accent-500); width: 1rem; height: 1rem; }

/* Related notes in rail */
.rail-empty {
  font-size: 0.8125rem;
  color: var(--text-faint);
  font-style: italic;
  padding: 0.375rem 0;
}
.rail-rellist { list-style: none; padding: 0; margin: 0 0 0.625rem; display: flex; flex-direction: column; gap: 0.25rem; }
.rail-relitem {
  display: flex; align-items: center;
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 0.5rem;
  transition: border-color 120ms, background 120ms;
}
.rail-relitem:hover { border-color: var(--accent-400); background: var(--accent-050); }
.rail-rellink {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  color: var(--text);
  text-align: left;
  background: none; border: none;
  cursor: pointer;
}
.rail-rellink:hover { color: var(--accent-600); }
.rail-rellink .pi-link { color: var(--accent-500); }
.rail-reltitle {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1; min-width: 0;
}
.rail-relx {
  width: 1.75rem; height: 1.75rem;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-faint);
  font-size: 1.125rem; line-height: 1;
  border-radius: 0.375rem;
  margin-right: 0.25rem;
}
.rail-relx:hover { background: #fff0f0; color: #c33; }

.rel-picker-wrap { position: relative; }
.rail-link-btn {
  display: inline-flex; align-items: center; gap: 0.5rem;
  width: 100%;
  justify-content: center;
  padding: 0.5625rem 0.875rem;
  background: var(--accent-050);
  border: 1px dashed var(--accent-400);
  color: var(--accent-600);
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
  transition: background 120ms, border-style 120ms;
}
.rail-link-btn:hover { background: var(--accent-100); border-style: solid; }

.rel-popover {
  position: absolute;
  top: calc(100% + 0.375rem);
  left: 0; right: 0;
  z-index: 30;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  box-shadow: var(--shadow-lg);
  padding: 0.5rem;
  display: flex; flex-direction: column; gap: 0.375rem;
  max-height: 18rem;
}
.rel-popover-input {
  width: 100%;
  height: 2.25rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0 0.75rem;
  font-size: 0.8125rem;
  outline: none;
}
.rel-popover-input:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }
.rel-popover-list { display: flex; flex-direction: column; overflow-y: auto; max-height: 14rem; }
.rel-popover-option {
  text-align: left;
  padding: 0.5rem 0.625rem;
  font-size: 0.8125rem;
  color: var(--text);
  border-radius: 0.375rem;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.rel-popover-option:hover { background: var(--accent-050); color: var(--accent-600); }
.rel-popover-empty {
  padding: 0.625rem;
  font-size: 0.8125rem;
  color: var(--text-faint);
  text-align: center;
  font-style: italic;
}

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

.modal-section + .modal-section { border-top: 1px solid var(--border-soft); padding-top: 1.125rem; }
.modal-section-title {
  font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-faint);
  margin: 0 0 0.75rem;
}
.modal-grid { display: grid; gap: 0.875rem; }
.modal-grid-2 { grid-template-columns: 1fr 1fr; }
.modal-field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.modal-field > span { font-size: 0.75rem; font-weight: 600; color: var(--text-dim); }
.modal-chips { display: flex; flex-wrap: wrap; gap: 0.375rem; align-items: center; }

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
@media (max-width: 75em) {
  .split-editor { grid-template-columns: 1fr; }
  .rail {
    border-left: none;
    border-top: 1px solid var(--border);
    max-height: none;
  }
}

@media (max-width: 62.5em) {
  .filterbar { flex-wrap: wrap; }
  .notes-title-row { flex-direction: column; align-items: flex-start; }
  .split-layout { grid-template-columns: 1fr; min-height: 0; }
  .modal-grid-2 { grid-template-columns: 1fr; }

  /* Master–detail: the list and the editor become full-width "pages".
     The empty editor renders a .split-placeholder, so its presence tells us
     nothing is selected → show the list; its absence → show the editor. */
  .split-list {
    max-height: none;
    overflow: visible;
    margin: 0;
    padding: 0;
  }
  .split-layout:not(:has(.split-placeholder)) .split-list { display: none; }
  .split-layout:has(.split-placeholder) .split-editor { display: none; }
  .editor-back { display: inline-flex; }
  .editor-body { max-height: none; }
}

/* ── Phone ── */
@media (max-width: 47.99em) {
  .notes-main { padding: 1.5rem 1rem 4rem; }

  /* Stats overflow horizontally instead of breaking the row */
  .notes-stats { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .stat { padding: 0.625rem 1rem; min-width: 4.5rem; }
  .stat-value { font-size: 1.375rem; }

  .upcoming { flex-direction: column; align-items: flex-start; gap: 0.625rem; }
  .upcoming-title { max-width: 60vw; }

  .filterbar { padding: 0.875rem 1rem; gap: 0.75rem; }
  .searchwrap { width: 100%; min-width: 0; }
  .filters { width: 100%; }
  .filters .f-control { flex: 1 1 8rem; }
  .f-daterange { width: 100%; }
  .f-date { flex: 1; min-width: 0; }
  .notes-app .add-btn { width: 100%; padding-left: 1.5rem; padding-right: 1.5rem; }

  .editor-body { padding: 1.25rem 1.25rem 1.5rem; }
  .editor-actions { width: 100%; }
  .editor-actions .btn-save,
  .editor-actions .btn-danger { flex: 1; justify-content: center; }

  .modal { max-width: calc(100vw - 1.5rem); }
  .modal-head,
  .modal-body,
  .modal-foot { padding-left: 1.25rem; padding-right: 1.25rem; }
}
</style>
