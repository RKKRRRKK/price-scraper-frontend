<template>
  <div class="reminders-app">
    <div class="reminders-main">
      <div class="reminders-header">
        <div>
          <div class="eyebrow">Productivity</div>
          <h1 class="reminders-title">Reminders</h1>
        </div>
        <button class="add-btn" @click="openAddModal">
          <i class="pi pi-plus" style="font-size: 0.875rem;"></i>
          Add Reminder
        </button>
      </div>

      <div v-if="store.loading && !store.reminders.length" class="empty">
        <i class="pi pi-spin pi-spinner" style="font-size: 2.5rem; color: var(--accent-500);"></i>
        <div class="empty-sub">Loading reminders...</div>
      </div>

      <div v-else-if="!store.reminders.length" class="empty">
        <div class="empty-art">
          <i class="pi pi-bell" style="font-size: 3.5rem; color: var(--text-faint);"></i>
        </div>
        <div class="empty-title">No reminders yet</div>
        <div class="empty-sub">Add your first reminder to get started.</div>
        <div class="empty-actions">
          <button class="add-btn add-btn-lg" @click="openAddModal">
            <i class="pi pi-plus" style="font-size: 0.875rem;"></i> New Reminder
          </button>
        </div>
      </div>

      <div v-else class="reminder-list">
        <div
          v-for="r in store.reminders" :key="r.id"
          class="reminder-card"
          :class="{ checked: r.checked, overdue: isOverdue(r) }"
        >
          <button
            class="check-btn"
            :class="{ checked: r.checked }"
            @click="store.toggleChecked(r.id)"
            :title="r.checked ? 'Uncheck' : 'Check off'"
          >
            <i v-if="r.checked" class="pi pi-check" style="font-size: 0.9375rem;"></i>
          </button>

          <div class="reminder-body">
            <div class="reminder-content">{{ r.content }}</div>
            <div class="reminder-meta">
              <span class="meta-item">
                <i class="pi pi-clock" style="font-size: 0.75rem;"></i>
                Due {{ formatDateTime(r.remind_at) }}
              </span>
              <span class="meta-item meta-faint">
                <i class="pi pi-plus-circle" style="font-size: 0.75rem;"></i>
                Added {{ formatDateTime(r.created_at) }}
              </span>
              <span v-if="r.repeating" class="repeat-pill">
                <i class="pi pi-refresh" style="font-size: 0.6875rem;"></i>
                {{ formatRepeat(r.repeat_interval) }}
              </span>
            </div>
          </div>

          <div class="reminder-actions">
            <button class="icon-btn" @click="openEditModal(r)" title="Edit">
              <i class="pi pi-pencil" style="font-size: 0.875rem;"></i>
            </button>
            <button class="icon-btn icon-danger" @click="confirmDelete(r.id)" title="Delete">
              <i class="pi pi-trash" style="font-size: 0.875rem;"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="modalOpen" class="modal-backdrop" @click.self="closeModal">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">{{ modalMode === 'add' ? 'New Reminder' : 'Edit Reminder' }}</span>
          <button class="modal-close" @click="closeModal">
            <i class="pi pi-times" style="font-size: 0.875rem;"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Reminder</label>
            <textarea
              class="modal-textarea"
              v-model="form.content"
              placeholder="What do you want to be reminded about?"
            ></textarea>
          </div>

          <div class="field">
            <label>Remind me at</label>
            <input type="datetime-local" class="sel" v-model="form.remind_at" />
          </div>

          <div class="field">
            <label class="toggle">
              <input type="checkbox" v-model="form.repeating" />
              Repeating
            </label>
          </div>

          <div v-if="form.repeating" class="field">
            <div class="day-picker-head">
              <label>Repeat on</label>
              <div class="day-quick">
                <button type="button" class="link-btn" @click="setDays([1,2,3,4,5])">Weekdays</button>
                <button type="button" class="link-btn" @click="setDays([0,6])">Weekends</button>
                <button type="button" class="link-btn" @click="setDays([0,1,2,3,4,5,6])">Every day</button>
                <button type="button" class="link-btn" @click="setDays([])">Clear</button>
              </div>
            </div>
            <div class="day-picker">
              <button
                v-for="d in DAYS" :key="d.value"
                type="button"
                class="day-pill"
                :class="{ active: form.days.includes(d.value) }"
                @click="toggleDay(d.value)"
              >{{ d.label }}</button>
            </div>
            <div v-if="!form.days.length" class="day-hint">Pick at least one day</div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="add-btn" @click="submitModal" :disabled="saving || !canSubmit">
            {{ modalMode === 'add' ? 'Create' : 'Save Changes' }}
          </button>
          <button class="btn-ghost" @click="closeModal">Cancel</button>
          <div style="flex:1;"></div>
          <button v-if="modalMode === 'edit'" class="btn-ghost btn-danger" @click="confirmDelete(form.id); closeModal();">
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRemindersStore } from '@/stores/reminders'
import dayjs from 'dayjs'

const store = useRemindersStore()
onMounted(() => store.fetchReminders())

const modalOpen = ref(false)
const modalMode = ref('add')
const saving = ref(false)
const form = ref(emptyForm())

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

function emptyForm() {
  return {
    id: null,
    content: '',
    remind_at: '',
    repeating: false,
    days: [],
  }
}

function parseDays(str) {
  if (!str) return []
  return str.split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n >= 0 && n <= 6)
}

function toggleDay(d) {
  const i = form.value.days.indexOf(d)
  if (i === -1) form.value.days.push(d)
  else form.value.days.splice(i, 1)
}

function setDays(days) { form.value.days = [...days] }

function formatRepeat(intervalStr) {
  const days = parseDays(intervalStr)
  if (!days.length) return 'repeating'
  if (days.length === 7) return 'Every day'
  const weekdays = [1,2,3,4,5]
  if (days.length === 5 && weekdays.every(d => days.includes(d))) return 'Weekdays'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends'
  const order = [1,2,3,4,5,6,0]
  return order.filter(d => days.includes(d))
    .map(d => DAYS.find(x => x.value === d).label)
    .join(', ')
}

const canSubmit = computed(() =>
  form.value.content.trim()
  && form.value.remind_at
  && (!form.value.repeating || form.value.days.length > 0)
)

function openAddModal() {
  modalMode.value = 'add'
  form.value = emptyForm()
  modalOpen.value = true
}

function openEditModal(r) {
  modalMode.value = 'edit'
  form.value = {
    id: r.id,
    content: r.content,
    remind_at: dayjs(r.remind_at).format('YYYY-MM-DDTHH:mm'),
    repeating: !!r.repeating,
    days: parseDays(r.repeat_interval),
  }
  modalOpen.value = true
}

function closeModal() { modalOpen.value = false }

async function submitModal() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    const payload = {
      content: form.value.content.trim(),
      remind_at: new Date(form.value.remind_at).toISOString(),
      repeating: form.value.repeating,
      repeat_interval: form.value.repeating ? form.value.days.slice().sort().join(',') : null,
    }
    if (modalMode.value === 'add') {
      await store.addReminder(payload)
    } else {
      await store.updateReminder(form.value.id, payload)
    }
    closeModal()
  } catch (e) {
    // handled in store
  } finally {
    saving.value = false
  }
}

async function confirmDelete(id) {
  if (!confirm('Delete this reminder?')) return
  await store.deleteReminder(id)
}

function formatDateTime(ts) {
  return ts ? dayjs(ts).format('MMM D, YYYY · h:mm A') : ''
}

function isOverdue(r) {
  return !r.checked && r.remind_at && new Date(r.remind_at) < new Date()
}
</script>

<style scoped>
.reminders-app {
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

  --shadow-sm:  0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
  --shadow:     0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04);
  --shadow-lg:  0 8px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04);

  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif;
  color: var(--text);
  font-size: 0.9375rem;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  min-height: calc(100vh - 5rem);
}

.reminders-app button { font: inherit; color: inherit; cursor: pointer; background: none; border: none; padding: 0; }
.reminders-app input, .reminders-app select, .reminders-app textarea { font: inherit; color: inherit; }

.reminders-main {
  padding: 2.25rem 1.5rem 5rem;
  max-width: 50rem;
  margin: 0 auto;
  width: 100%;
}

.reminders-header {
  display: flex; justify-content: space-between; align-items: flex-end;
  gap: 2rem; margin-bottom: 2rem;
}
.eyebrow {
  font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.12em;
  color: var(--accent-600);
  margin-bottom: 0.375rem;
  text-transform: uppercase;
}
.reminders-title {
  font-size: 2.25rem; font-weight: 700; margin: 0;
  letter-spacing: -0.02em;
}

.reminders-app .add-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.625rem;
  background: var(--accent-500);
  color: #fff;
  padding: 0.75rem 1.75rem;
  height: 2.875rem;
  border-radius: 0.625rem;
  font-size: 0.9375rem;
  font-weight: 600;
  box-shadow: 0 0.125rem 0.5rem oklch(0.5 0.18 var(--accent-hue) / 0.25);
  transition: background 120ms, transform 120ms, box-shadow 120ms;
  white-space: nowrap;
}
.reminders-app .add-btn:hover { background: var(--accent-600); transform: translateY(-1px); box-shadow: 0 0.25rem 0.875rem oklch(0.5 0.18 var(--accent-hue) / 0.3); }
.reminders-app .add-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
.reminders-app .add-btn-lg { height: 3.125rem; padding: 0.875rem 2.5rem; font-size: 1rem; }

.reminders-app .btn-ghost {
  padding: 0.625rem 1.5rem; height: 2.625rem; border-radius: 0.625rem;
  font-size: 0.875rem; color: var(--text-dim);
  border: 1px solid var(--border);
  background: #fff;
  transition: all 120ms;
  display: inline-flex; align-items: center;
  font-weight: 500;
}
.reminders-app .btn-ghost:hover { border-color: var(--text-faint); color: var(--text); background: var(--bg-sunken); }
.reminders-app .btn-ghost.btn-danger:hover { border-color: #f5c5c5; background: #fff0f0; color: #c33; }

.reminders-app .icon-btn {
  width: 2rem; height: 2rem;
  border-radius: 0.5rem;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint);
  transition: all 120ms;
}
.reminders-app .icon-btn:hover { background: var(--bg-sunken); color: var(--text); }
.reminders-app .icon-danger:hover { background: #fff0f0; color: #c33; }

.reminders-app .modal-close {
  width: 2rem; height: 2rem; border-radius: 0.5rem;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint);
  transition: all 120ms;
}
.reminders-app .modal-close:hover { background: var(--bg-sunken); color: var(--text); }

.reminder-list {
  display: flex; flex-direction: column; gap: 0.875rem;
}

.reminder-card {
  display: flex; align-items: flex-start; gap: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.125rem 1.25rem;
  box-shadow: var(--shadow-sm);
  transition: border-color 120ms, transform 120ms, box-shadow 120ms, opacity 120ms;
}
.reminder-card:hover {
  border-color: var(--accent-400);
  transform: translateY(-1px);
  box-shadow: var(--shadow);
}
.reminder-card.checked { opacity: 0.55; }
.reminder-card.checked .reminder-content { text-decoration: line-through; color: var(--text-faint); }
.reminder-card.overdue { border-left: 3px solid oklch(0.6 0.18 25); }

.check-btn {
  width: 1.625rem; height: 1.625rem;
  border-radius: 50%;
  border: 2px solid var(--border) !important;
  background: #fff;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  transition: all 120ms;
  margin-top: 0.125rem;
}
.check-btn:hover { border-color: var(--accent-400) !important; background: var(--accent-050); }
.check-btn.checked {
  background: var(--accent-500);
  border-color: var(--accent-500) !important;
  color: #fff;
}

.reminder-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.reminder-content {
  font-size: 1rem; font-weight: 500; color: var(--text);
  line-height: 1.45;
  word-wrap: break-word;
}

.reminder-meta {
  display: flex; flex-wrap: wrap; gap: 0.625rem; align-items: center;
}
.meta-item {
  display: inline-flex; align-items: center; gap: 0.375rem;
  font-size: 0.8125rem; color: var(--text-dim);
}
.meta-faint { color: var(--text-faint); }

.repeat-pill {
  display: inline-flex; align-items: center; gap: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  background: var(--accent-100);
  color: var(--accent-600);
}

.reminder-actions {
  display: flex; gap: 0.375rem;
  flex-shrink: 0;
}

/* Empty */
.empty {
  background: var(--bg-card);
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  padding: 5rem 2.5rem;
  text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
}
.empty-art { margin-bottom: 0.5rem; }
.empty-title { font-size: 1.25rem; font-weight: 600; }
.empty-sub { font-size: 0.9375rem; color: var(--text-dim); }
.empty-actions { display: flex; gap: 0.75rem; margin-top: 1rem; }

/* Modal */
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
  width: 32rem;
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

.modal-body { padding: 1.5rem 1.75rem; display: flex; flex-direction: column; gap: 1.125rem; overflow-y: auto; }

.field { display: flex; flex-direction: column; gap: 0.375rem; }
.field > label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); font-weight: 600; }

.modal-textarea {
  width: 100%;
  min-height: 6rem;
  border: 1px solid var(--border);
  border-radius: 0.625rem;
  padding: 0.875rem 1rem;
  font-size: 0.9375rem;
  line-height: 1.55;
  resize: vertical;
  outline: none;
  font-family: inherit;
  background: #fff;
}
.modal-textarea:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }

.sel {
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.5625rem 1rem;
  height: 2.5rem;
  font-size: 0.875rem;
  background: #fff;
  outline: none;
}
.sel:focus { border-color: var(--accent-400); box-shadow: 0 0 0 3px var(--accent-100); }

.toggle { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer; font-weight: 500; }
.toggle input { accent-color: var(--accent-500); width: 1rem; height: 1rem; }

.day-picker-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.day-quick { display: flex; gap: 0.75rem; }
.reminders-app .link-btn {
  font-size: 0.75rem;
  color: var(--accent-600);
  font-weight: 600;
  padding: 0.125rem 0.25rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.reminders-app .link-btn:hover { color: var(--accent-500); text-decoration: underline; }

.day-picker {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.reminders-app .day-pill {
  height: 2.75rem;
  border-radius: 0.625rem;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text-dim);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: all 120ms;
  display: flex; align-items: center; justify-content: center;
}
.reminders-app .day-pill:hover { border-color: var(--accent-400); color: var(--text); background: var(--accent-050); }
.reminders-app .day-pill.active {
  background: var(--accent-500);
  color: #fff;
  border-color: var(--accent-500);
  box-shadow: 0 0.125rem 0.375rem oklch(0.5 0.18 var(--accent-hue) / 0.3);
}
.day-hint { font-size: 0.75rem; color: oklch(0.55 0.16 25); margin-top: 0.5rem; }

.modal-foot {
  display: flex; gap: 0.75rem; align-items: center;
  padding: 1.125rem 1.75rem;
  border-top: 1px solid var(--border-soft);
}

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop-in  { from { opacity: 0; transform: translateY(0.375rem) scale(0.97); } to { opacity: 1; transform: none; } }

@media (max-width: 36em) {
  .reminders-header { flex-direction: column; align-items: flex-start; gap: 1rem; }
  .reminder-card { flex-wrap: wrap; }
}
</style>
