<template>
  <div
    class="reminder-card"
    :class="{ checked: reminder.checked, overdue: isOverdue }"
  >
    <button
      class="check-btn"
      :class="{ checked: reminder.checked }"
      @click="store.toggleChecked(reminder.id)"
      :title="reminder.checked ? 'Uncheck' : 'Check off'"
    >
      <i v-if="reminder.checked" class="pi pi-check" style="font-size: 0.9375rem;"></i>
    </button>

    <div class="reminder-body">
      <div class="reminder-content">{{ reminder.content }}</div>
      <div class="reminder-meta">
        <span class="meta-item">
          <i class="pi pi-clock" style="font-size: 0.75rem;"></i>
          Due {{ formatDateTime(reminder.remind_at) }}
        </span>
        <span class="meta-item meta-faint">
          <i class="pi pi-plus-circle" style="font-size: 0.75rem;"></i>
          Added {{ formatDateTime(reminder.created_at) }}
        </span>
        <span v-if="reminder.repeating" class="repeat-pill">
          <i class="pi pi-refresh" style="font-size: 0.6875rem;"></i>
          {{ formatRepeat(reminder.repeat_interval) }}
        </span>
      </div>
    </div>

    <div class="reminder-actions">
      <div class="switch-stack">
        <div class="switch-field">
          <span class="switch-field-label">
            <i class="pi pi-arrow-right-arrow-left" style="font-size: 0.6875rem;"></i>
            Switch receiver
          </span>
          <button
            class="switch"
            :class="{ on: reminder.switch_receiver }"
            role="switch"
            :aria-checked="reminder.switch_receiver ? 'true' : 'false'"
            aria-label="Switch receiver"
            @click="store.toggleSwitchReceiver(reminder.id)"
            :title="reminder.switch_receiver ? 'Switch receiver: on' : 'Switch receiver: off'"
          >
            <span class="switch-knob"></span>
          </button>
        </div>
        <div class="switch-field">
          <span class="switch-field-label">
            <i class="pi pi-bolt" style="font-size: 0.6875rem;"></i>
            Trigger once
          </span>
          <button
            class="switch"
            :class="{ on: reminder.trigger_once }"
            role="switch"
            :aria-checked="reminder.trigger_once ? 'true' : 'false'"
            aria-label="Trigger once"
            @click="store.toggleTriggerOnce(reminder.id)"
            :title="reminder.trigger_once ? 'Trigger once: on' : 'Trigger once: off'"
          >
            <span class="switch-knob"></span>
          </button>
        </div>
      </div>
      <div class="action-icons">
        <button class="icon-btn" @click="$emit('edit', reminder)" title="Edit">
          <i class="pi pi-pencil" style="font-size: 0.875rem;"></i>
        </button>
        <button class="icon-btn icon-danger" @click="$emit('delete', reminder.id)" title="Delete">
          <i class="pi pi-trash" style="font-size: 0.875rem;"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRemindersStore } from '@/stores/reminders'
import dayjs from 'dayjs'

const props = defineProps({
  reminder: { type: Object, required: true },
})
defineEmits(['edit', 'delete'])

const store = useRemindersStore()

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parseDays(str) {
  if (!str) return []
  return str.split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n >= 0 && n <= 6)
}

function formatRepeat(intervalStr) {
  const days = parseDays(intervalStr)
  if (!days.length) return 'repeating'
  if (days.length === 7) return 'Every day'
  const weekdays = [1, 2, 3, 4, 5]
  if (days.length === 5 && weekdays.every(d => days.includes(d))) return 'Weekdays'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends'
  const order = [1, 2, 3, 4, 5, 6, 0]
  return order.filter(d => days.includes(d)).map(d => DAY_LABELS[d]).join(', ')
}

function formatDateTime(ts) {
  return ts ? dayjs(ts).format('MMM D, YYYY · h:mm A') : ''
}

const isOverdue = computed(() =>
  !props.reminder.checked
  && props.reminder.remind_at
  && new Date(props.reminder.remind_at) < new Date()
)
</script>

<style scoped>
/* Buttons in this component sit inside .reminders-app, but scoped styles don't
   inherit the parent's button reset, so re-declare it here. */
button { font: inherit; color: inherit; cursor: pointer; background: none; border: none; padding: 0; }

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
  display: flex; gap: 0.875rem; align-items: center;
  flex-shrink: 0;
}

.switch-stack {
  display: flex; flex-direction: column; gap: 0.4375rem;
}
.switch-field {
  display: flex; align-items: center; justify-content: space-between; gap: 0.625rem;
}
.switch-field-label {
  display: inline-flex; align-items: center; gap: 0.3125rem;
  font-size: 0.75rem; font-weight: 600; color: var(--text-dim);
  white-space: nowrap;
}
.switch-field-label .pi { color: var(--text-faint); }

.action-icons { display: flex; gap: 0.375rem; align-items: center; }

.switch {
  width: 2.375rem; height: 1.375rem;
  border-radius: 999px;
  background: var(--border);
  position: relative;
  flex-shrink: 0;
  transition: background 140ms;
}
.switch.on { background: var(--accent-500); }
.switch-knob {
  position: absolute;
  top: 0.1875rem; left: 0.1875rem;
  width: 1rem; height: 1rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,0.25);
  transition: transform 140ms;
}
.switch.on .switch-knob { transform: translateX(1rem); }

.icon-btn {
  width: 2rem; height: 2rem;
  border-radius: 0.5rem;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint);
  transition: all 120ms;
}
.icon-btn:hover { background: var(--bg-sunken); color: var(--text); }
.icon-danger:hover { background: #fff0f0; color: #c33; }

/* When the column is too narrow to fit body + actions side by side,
   drop the actions onto their own full-width row so the text keeps room. */
@container (max-width: 28rem) {
  .reminder-card { flex-wrap: wrap; padding: 1rem; gap: 0.875rem; }
  .reminder-actions {
    width: 100%;
    justify-content: space-between;
    align-items: flex-end;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-soft);
  }
}
</style>
