<template>
  <div v-if="open" class="slog">
    <div class="slog-head">
      <b><i class="pi pi-server"></i> Stream</b>

      <div class="chips">
        <span class="chip" :title="`Wall clock since the request was sent`">{{ fmtMs(elapsed) }}</span>
        <span class="chip" :class="{ warn: silentFor > 15000, bad: silentFor > 45000 }" :title="'Time since the last byte arrived'">
          quiet {{ fmtMs(silentFor) }}
        </span>
        <span class="chip" :title="'Bytes received from the edge function'">{{ fmtBytes(stats.bytes) }}</span>
        <span class="chip" :title="'SSE data events'">{{ stats.sseEvents }} ev</span>
        <span v-if="stats.reasoningChars" class="chip think" :title="'Characters of reasoning the model streamed before answering'">
          {{ fmtNum(stats.reasoningChars) }} thinking
        </span>
        <span class="chip" :title="'Characters of actual answer'">{{ fmtNum(stats.contentChars) }} out</span>
        <span class="chip" :class="{ ok: stats.rows > 0 }" :title="'Rows that parsed into melody lines'">{{ stats.rows }} rows</span>
        <span v-if="stats.badObjects" class="chip bad" :title="'Objects that failed to parse'">{{ stats.badObjects }} bad</span>
        <span v-if="stats.finishReason" class="chip" :title="'finish_reason from the model'">{{ stats.finishReason }}</span>
      </div>

      <div class="spacer"></div>
      <button class="sl-btn" :class="{ on: tab === 'log' }" @click="tab = 'log'">Log</button>
      <button class="sl-btn" :class="{ on: tab === 'prompt' }" @click="tab = 'prompt'">Prompt</button>
      <button class="sl-btn" :class="{ on: tab === 'info' }" @click="tab = 'info'">Request</button>
      <button class="sl-btn" @click="copyAll"><i :class="copied ? 'pi pi-check' : 'pi pi-copy'"></i> {{ copied ? 'Copied' : 'Copy all' }}</button>
      <button class="sl-btn" @click="$emit('clear')"><i class="pi pi-trash"></i></button>
      <button class="sl-btn" @click="$emit('close')"><i class="pi pi-times"></i></button>
    </div>

    <!-- Live tail of everything on the wire -->
    <div v-if="tab === 'log'" ref="bodyEl" class="slog-body" @scroll="onScroll">
      <div v-if="!entries.length" class="slog-empty">Nothing on the wire yet.</div>
      <div v-for="(e, i) in entries" :key="i" class="row" :class="'k-' + e.kind">
        <span class="t">{{ fmtMs(e.at) }}</span>
        <span class="k">{{ e.kind }}</span>
        <span class="x">{{ e.text }}</span>
      </div>
      <div v-if="!atBottom" class="jump" @click="scrollToEnd"><i class="pi pi-angle-double-down"></i> follow</div>
    </div>

    <!-- Exactly what was sent to the model -->
    <div v-else-if="tab === 'prompt'" class="slog-body">
      <div v-if="!prompt" class="slog-empty">No request has been sent yet.</div>
      <pre v-else class="pre">{{ prompt }}</pre>
    </div>

    <!-- Where it went and what came back -->
    <div v-else class="slog-body">
      <table class="kv">
        <tbody>
          <tr><td>pass</td><td>{{ stats.label || '—' }}</td></tr>
          <tr><td>model</td><td>{{ stats.model || '—' }}</td></tr>
          <tr><td>effort</td><td>{{ stats.effort || '—' }}</td></tr>
          <tr><td>prompt</td><td>{{ fmtNum(stats.promptChars) }} chars</td></tr>
          <tr><td>image</td><td>{{ fmtBytes(stats.imageChars) }} of base64</td></tr>
          <tr>
            <td>OpenRouter id</td>
            <td>
              <template v-if="stats.requestId"><b>{{ stats.requestId }}</b></template>
              <span v-else class="dim">not reported — redeploy <code>bawu-ai</code> to forward it</span>
            </td>
          </tr>
          <tr><td>upstream connect</td><td>{{ stats.upstreamMs != null ? stats.upstreamMs + ' ms' : '—' }}</td></tr>
          <tr><td>first byte</td><td>{{ stats.firstByteMs != null ? fmtMs(stats.firstByteMs) : 'never arrived' }}</td></tr>
          <tr><td>first answer token</td><td>{{ stats.firstContentMs != null ? fmtMs(stats.firstContentMs) : 'never arrived' }}</td></tr>
          <tr><td>thinking</td><td>{{ fmtNum(stats.reasoningChars) }} chars</td></tr>
          <tr><td>answer</td><td>{{ fmtNum(stats.contentChars) }} chars → {{ stats.objects }} objects, {{ stats.rows }} rows, {{ stats.badObjects }} unparseable</td></tr>
          <tr><td>finish_reason</td><td>{{ stats.finishReason || '—' }}</td></tr>
          <tr v-if="stats.error"><td>error</td><td class="err">{{ stats.error }}</td></tr>
        </tbody>
      </table>
      <p class="hint">
        The matching server-side log is in Supabase → Edge Functions → <code>bawu-ai</code> → Logs,
        tagged with the same OpenRouter id.
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'

// A window onto the transcription stream: what was sent, what came back, and
// when. Without it a run that produces nothing is indistinguishable from a slow
// model — which is exactly the hole this fills.
const props = defineProps({
  open: { type: Boolean, default: false },
  entries: { type: Array, default: () => [] },
  prompt: { type: String, default: '' },
  stats: { type: Object, default: () => ({}) },
  live: { type: Boolean, default: false },
})
defineEmits(['close', 'clear'])

const tab = ref('log')
const bodyEl = ref(null)
const atBottom = ref(true)
const copied = ref(false)
let copiedTimer = 0

// A ticking clock so "quiet for 30s" keeps counting while nothing arrives —
// the whole point is to see a stall happen.
const now = ref(Date.now())
let clock = 0
watch(
  () => props.live,
  (on) => {
    clearInterval(clock)
    if (on) clock = setInterval(() => (now.value = Date.now()), 500)
    now.value = Date.now()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearInterval(clock)
  clearTimeout(copiedTimer)
})

const elapsed = computed(() => {
  const s = props.stats
  if (!s.startedAt) return 0
  return (props.live ? now.value : s.lastByteAt || now.value) - s.startedAt
})
const silentFor = computed(() => {
  const s = props.stats
  if (!s.lastByteAt || !props.live) return 0
  return Math.max(0, now.value - s.lastByteAt)
})

// Follow the tail unless the user has scrolled up to read something.
watch(
  () => props.entries.length,
  () => {
    if (tab.value === 'log' && atBottom.value) nextTick(scrollToEnd)
  },
)
function onScroll() {
  const el = bodyEl.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}
function scrollToEnd() {
  const el = bodyEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  atBottom.value = true
}

async function copyAll() {
  const s = props.stats
  const head = [
    `pass=${s.label} model=${s.model} effort=${s.effort}`,
    `openrouter_id=${s.requestId || '(none)'} upstream=${s.upstreamMs ?? '?'}ms`,
    `firstByte=${s.firstByteMs ?? 'never'}ms firstContent=${s.firstContentMs ?? 'never'}ms elapsed=${elapsed.value}ms`,
    `bytes=${s.bytes} sseEvents=${s.sseEvents} thinking=${s.reasoningChars} content=${s.contentChars}`,
    `objects=${s.objects} rows=${s.rows} bad=${s.badObjects} finish=${s.finishReason || '—'}`,
    s.error ? `error=${s.error}` : '',
  ].filter(Boolean).join('\n')
  const log = props.entries.map((e) => `${fmtMs(e.at).padStart(8)}  ${e.kind.padEnd(9)} ${e.text}`).join('\n')
  const text = `── Bawu stream ──\n${head}\n\n── Prompt ──\n${props.prompt}\n\n── Wire ──\n${log}\n`
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    console.log(text) // clipboard blocked — at least put it somewhere reachable
  }
}

function fmtMs(ms) {
  if (!ms || ms < 0) return '0.0s'
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  return `${m}m ${Math.round((ms % 60000) / 1000)}s`
}
function fmtBytes(n) {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
function fmtNum(n) {
  return (n || 0).toLocaleString()
}
</script>

<style scoped>
.slog {
  display: flex; flex-direction: column; flex-shrink: 0;
  max-height: 22rem; border-top: 1px solid var(--border, #e5e4e1);
  background: #16181d; color: #d6dae3;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
.slog-head {
  display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
  padding: 0.4rem 0.6rem; border-bottom: 1px solid #2a2e37; flex-shrink: 0;
}
.slog-head > b { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.72rem; color: #9aa3b2; letter-spacing: 0.04em; text-transform: uppercase; }
.slog-head > b i { font-size: 0.7rem; }
.spacer { flex: 1; }

.chips { display: flex; align-items: center; gap: 0.3rem; flex-wrap: wrap; }
.chip {
  font-size: 0.68rem; padding: 0.1rem 0.4rem; border-radius: 0.3rem;
  background: #22262f; color: #9aa3b2; white-space: nowrap;
}
.chip.ok { background: #14331f; color: #6ee7a0; }
.chip.think { background: #241f38; color: #b9a4f0; }
.chip.warn { background: #3a2f14; color: #f5c86b; }
.chip.bad { background: #3a1a1a; color: #ff9b9b; }

.sl-btn {
  font-size: 0.68rem; font-weight: 600; padding: 0.2rem 0.45rem; border-radius: 0.3rem;
  background: #22262f; color: #9aa3b2; border: none; cursor: pointer; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 0.25rem;
}
.sl-btn:hover { background: #2d323d; color: #e6eaf2; }
.sl-btn.on { background: #3a4150; color: #fff; }
.sl-btn i { font-size: 0.65rem; }

.slog-body { flex: 1; min-height: 0; overflow: auto; padding: 0.4rem 0.6rem; position: relative; }
.slog-empty { color: #6b7280; font-size: 0.72rem; padding: 0.6rem 0; }

.row { display: flex; gap: 0.5rem; font-size: 0.7rem; line-height: 1.5; align-items: flex-start; }
.row .t { color: #5d6472; flex: none; width: 3.4rem; text-align: right; }
.row .k { color: #6b7280; flex: none; width: 4.6rem; }
.row .x { white-space: pre-wrap; word-break: break-word; min-width: 0; }

.k-request .k, .k-response .k, .k-open .k { color: #67b3ff; }
.k-request .x, .k-response .x, .k-open .x { color: #a8cdf5; }
.k-keepalive { opacity: 0.4; }
.k-reasoning .k { color: #b9a4f0; }
.k-reasoning .x { color: #8e86ad; font-style: italic; }
.k-content .x { color: #dfe4ec; }
.k-row .k, .k-meta .k { color: #6ee7a0; }
.k-row .x, .k-meta .x { color: #9ae6b8; }
.k-skip .k, .k-bad .k, .k-note .k { color: #f5c86b; }
.k-skip .x, .k-bad .x, .k-note .x { color: #d9b26a; }
.k-error .k { color: #ff9b9b; }
.k-error .x { color: #ff9b9b; }
.k-usage .k, .k-finish .k, .k-done .k, .k-sse .k { color: #6b7280; }
.k-usage .x, .k-finish .x, .k-done .x, .k-sse .x { color: #8b93a1; }

.jump {
  position: sticky; bottom: 0.2rem; margin-left: auto; width: fit-content;
  font-size: 0.68rem; background: #3a4150; color: #fff; border-radius: 999px;
  padding: 0.15rem 0.5rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;
}

.pre { font-size: 0.7rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word; margin: 0; color: #cdd3dd; }

.kv { border-collapse: collapse; font-size: 0.72rem; }
.kv td { padding: 0.18rem 0.7rem 0.18rem 0; vertical-align: top; }
.kv td:first-child { color: #6b7280; white-space: nowrap; }
.kv .dim { color: #6b7280; }
.kv .err { color: #ff9b9b; }
.hint { font-size: 0.68rem; color: #6b7280; margin: 0.7rem 0 0; line-height: 1.5; }
.hint code { background: #22262f; padding: 0 0.25rem; border-radius: 0.2rem; }
</style>
