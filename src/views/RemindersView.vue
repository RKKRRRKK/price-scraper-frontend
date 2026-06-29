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

      <div v-else class="reminder-columns">
        <div class="reminder-column">
          <div class="column-head column-head-overdue">
            <i class="pi pi-exclamation-triangle" style="font-size: 0.8125rem;"></i>
            <span>More than 24h overdue</span>
            <span class="column-count">{{ overdueReminders.length }}</span>
          </div>
          <div v-if="overdueReminders.length" class="reminder-list">
            <ReminderCard
              v-for="r in overdueReminders" :key="r.id"
              :reminder="r"
              @edit="openEditModal"
              @delete="confirmDelete"
            />
          </div>
          <div v-else class="column-empty">Nothing here</div>
        </div>

        <div class="reminder-column">
          <div class="column-head">
            <i class="pi pi-clock" style="font-size: 0.8125rem;"></i>
            <span>Within 24h</span>
            <span class="column-count">{{ dueSoonReminders.length }}</span>
          </div>
          <div v-if="dueSoonReminders.length" class="reminder-list">
            <ReminderCard
              v-for="r in dueSoonReminders" :key="r.id"
              :reminder="r"
              @edit="openEditModal"
              @delete="confirmDelete"
            />
          </div>
          <div v-else class="column-empty">Nothing here</div>
        </div>

        <div class="reminder-column">
          <div class="column-head column-head-upcoming">
            <i class="pi pi-calendar" style="font-size: 0.8125rem;"></i>
            <span>Due in more than 24h</span>
            <span class="column-count">{{ upcomingReminders.length }}</span>
          </div>
          <div v-if="upcomingReminders.length" class="reminder-list">
            <ReminderCard
              v-for="r in upcomingReminders" :key="r.id"
              :reminder="r"
              @edit="openEditModal"
              @delete="confirmDelete"
            />
          </div>
          <div v-else class="column-empty">Nothing here</div>
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

          <div class="field toggle-row">
            <div class="toggle-row-text">
              <div class="toggle-row-title">
                <i class="pi pi-arrow-right-arrow-left" style="font-size: 0.75rem;"></i>
                Switch receiver
              </div>
              <div class="toggle-row-desc">Route this reminder to the alternate receiver instead of the default.</div>
            </div>
            <button
              type="button"
              class="switch"
              :class="{ on: form.switch_receiver }"
              role="switch"
              :aria-checked="form.switch_receiver ? 'true' : 'false'"
              aria-label="Switch receiver"
              @click="form.switch_receiver = !form.switch_receiver"
            >
              <span class="switch-knob"></span>
            </button>
          </div>

          <div class="field toggle-row">
            <div class="toggle-row-text">
              <div class="toggle-row-title">
                <i class="pi pi-bolt" style="font-size: 0.75rem;"></i>
                Trigger once
              </div>
              <div class="toggle-row-desc">Fire a single time, then stop. Turn off to keep it firing.</div>
            </div>
            <button
              type="button"
              class="switch"
              :class="{ on: form.trigger_once }"
              role="switch"
              :aria-checked="form.trigger_once ? 'true' : 'false'"
              aria-label="Trigger once"
              @click="form.trigger_once = !form.trigger_once"
            >
              <span class="switch-knob"></span>
            </button>
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
import ReminderCard from '@/components/ReminderCard.vue'
import dayjs from 'dayjs'

const store = useRemindersStore()
onMounted(() => store.fetchReminders())

const DAY_MS = 24 * 60 * 60 * 1000

const sortedReminders = computed(() =>
  [...store.reminders].sort((a, b) => new Date(a.remind_at) - new Date(b.remind_at))
)

// Bucket by how far remind_at sits from "now", using a 24h window on either side.
const overdueReminders = computed(() => {
  const cutoff = Date.now() - DAY_MS
  return sortedReminders.value.filter(r => new Date(r.remind_at).getTime() < cutoff)
})

const dueSoonReminders = computed(() => {
  const now = Date.now()
  return sortedReminders.value.filter(r => {
    const t = new Date(r.remind_at).getTime()
    return t >= now - DAY_MS && t <= now + DAY_MS
  })
})

const upcomingReminders = computed(() => {
  const cutoff = Date.now() + DAY_MS
  return sortedReminders.value.filter(r => new Date(r.remind_at).getTime() > cutoff)
})

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
    switch_receiver: false,
    trigger_once: true,
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
    switch_receiver: !!r.switch_receiver,
    trigger_once: r.trigger_once !== false,
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
      switch_receiver: form.value.switch_receiver,
      trigger_once: form.value.trigger_once,
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
  padding: 2.25rem 2rem 5rem;
  max-width: min(160rem, 96vw);
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

.reminders-app .modal-close {
  width: 2rem; height: 2rem; border-radius: 0.5rem;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint);
  transition: all 120ms;
}
.reminders-app .modal-close:hover { background: var(--bg-sunken); color: var(--text); }

.reminder-columns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10rem;
  align-items: start;
}

.reminder-column {
  display: flex; flex-direction: column; gap: 0.875rem;
  min-width: 0;
  container-type: inline-size;
}

.column-head {
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 0.8125rem; font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text-dim);
  padding: 0 0.25rem 0.625rem;
  border-bottom: 1px solid var(--border-soft);
}
.column-head .pi { color: var(--text-faint); }
.column-head-overdue { color: oklch(0.55 0.18 25); }
.column-head-overdue .pi { color: oklch(0.6 0.18 25); }
.column-head-upcoming { color: var(--accent-600); }
.column-head-upcoming .pi { color: var(--accent-500); }

.column-count {
  margin-left: auto;
  min-width: 1.375rem;
  height: 1.375rem;
  padding: 0 0.4375rem;
  border-radius: 999px;
  background: var(--bg-sunken);
  color: var(--text-dim);
  font-size: 0.75rem; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
}

.column-empty {
  font-size: 0.8125rem; color: var(--text-faint);
  text-align: center;
  padding: 1.5rem 0.5rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
}

.reminder-list {
  display: flex; flex-direction: column; gap: 0.875rem;
}

.reminders-app .switch {
  width: 2.375rem; height: 1.375rem;
  border-radius: 999px;
  background: var(--border);
  position: relative;
  flex-shrink: 0;
  transition: background 140ms;
}
.reminders-app .switch.on { background: var(--accent-500); }
.switch-knob {
  position: absolute;
  top: 0.1875rem; left: 0.1875rem;
  width: 1rem; height: 1rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,0.25);
  transition: transform 140ms;
}
.reminders-app .switch.on .switch-knob { transform: translateX(1rem); }

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

.toggle-row {
  flex-direction: row; align-items: center; justify-content: space-between;
  gap: 1rem;
  background: var(--bg-sunken);
  border: 1px solid var(--border-soft);
  border-radius: 0.625rem;
  padding: 0.875rem 1rem;
}
.toggle-row-text { display: flex; flex-direction: column; gap: 0.1875rem; min-width: 0; }
.toggle-row-title {
  display: inline-flex; align-items: center; gap: 0.4375rem;
  font-size: 0.875rem; font-weight: 600; color: var(--text);
  text-transform: none; letter-spacing: normal;
}
.toggle-row-title .pi { color: var(--accent-600); }
.toggle-row-desc { font-size: 0.8125rem; color: var(--text-dim); line-height: 1.4; }
.toggle-row .switch { cursor: pointer; }

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

/* Stack the three buckets once they get too narrow to hold a card comfortably */
@media (max-width: 61.99em) {
  .reminder-columns { grid-template-columns: 1fr; gap: 1.75rem; }
}

@media (max-width: 47.99em) {
  .reminders-main { padding: 1.5rem 1rem 4rem; }

  .reminders-header { flex-direction: column; align-items: stretch; gap: 1rem; }
  .reminders-app .add-btn { width: 100%; }

  .day-quick { flex-wrap: wrap; gap: 0.5rem; }

  .modal { max-width: calc(100vw - 1.5rem); }
  .modal-head,
  .modal-body,
  .modal-foot { padding-left: 1.25rem; padding-right: 1.25rem; }
  .modal-foot { flex-wrap: wrap; }
}
</style>
