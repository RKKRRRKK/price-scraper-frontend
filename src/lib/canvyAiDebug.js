// Debug + logging for the live Canvy AI flow.
//
// Answers the two "I can't see what's happening" problems:
//   • every call is logged to the console AND kept in a small reactive ring
//     buffer the modal renders (prompt, reply, screenshot, tokens, cost);
//   • if the user picks a debug folder (File System Access API — Chrome/Edge),
//     the exact bytes sent each round are dumped to disk as .md + .png so you
//     can confirm the model really sees the whole board.
//
// State is module-level so the picked folder survives modal open/close within a
// session. Nothing here throws into the run — disk writes fail soft.

import { ref } from 'vue'

const MAX_ENTRIES = 24

// Reactive, consumed by CanvyAiModal.
export const debugLog = ref([])           // newest-first ring buffer
export const debugFolderName = ref('')    // '' when no folder chosen

let rootHandle = null                     // FileSystemDirectoryHandle | null
const runDirs = new Map()                 // runId → per-run subdirectory handle

export function supportsDebugFolder() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

// Prompt the user to choose (once) a folder for this session's dumps.
export async function pickDebugFolder() {
  if (!supportsDebugFolder()) return false
  try {
    rootHandle = await window.showDirectoryPicker({ id: 'canvy-ai-debug', mode: 'readwrite' })
    debugFolderName.value = rootHandle.name || 'selected folder'
    runDirs.clear()
    return true
  } catch {
    return false // user cancelled — leave any previous handle in place
  }
}

export function clearDebugFolder() {
  rootHandle = null
  debugFolderName.value = ''
  runDirs.clear()
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
function slug(s) {
  return (s || 'board').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'board'
}

async function runDir(runId, boardName) {
  if (!rootHandle) return null
  if (runDirs.has(runId)) return runDirs.get(runId)
  try {
    const dir = await rootHandle.getDirectoryHandle(`canvy-${slug(boardName)}-${stamp()}`, { create: true })
    runDirs.set(runId, dir)
    return dir
  } catch {
    return null
  }
}

async function writeFile(dir, name, contents) {
  try {
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(contents)
    await w.close()
  } catch (e) {
    console.warn('[Canvy AI] could not write', name, e)
  }
}

function readUsage(usage) {
  if (!usage || typeof usage !== 'object') return { in: null, out: null, cost: null }
  return {
    in: usage.prompt_tokens ?? usage.input_tokens ?? null,
    out: usage.completion_tokens ?? usage.output_tokens ?? null,
    cost: typeof usage.cost === 'number' ? usage.cost : null,
  }
}

// Record one model call. `phase` is a short tag (sending / reviewing / applying).
export async function logCall({ runId, round = 0, phase = '', boardName = '', prompt = '', imageDataUri = '', reply = '', usage = null }) {
  const u = readUsage(usage)

  // Console (grouped so it stays tidy).
  const tag = `[Canvy AI] ${phase}${round ? ` r${round}` : ''}`
  // eslint-disable-next-line no-console
  console.groupCollapsed(`${tag} — ${u.in ?? '?'} in / ${u.out ?? '?'} out${u.cost != null ? ` · $${u.cost.toFixed(4)}` : ''}`)
  // eslint-disable-next-line no-console
  console.log('prompt:\n', prompt)
  // eslint-disable-next-line no-console
  console.log('reply:\n', reply)
  if (usage) console.log('usage:', usage) // eslint-disable-line no-console
  console.groupEnd() // eslint-disable-line no-console

  // Ring buffer for the in-app panel.
  debugLog.value = [
    { id: `${runId}-${round}-${phase}-${Date.now()}`, phase, round, ts: Date.now(), tokensIn: u.in, tokensOut: u.out, cost: u.cost, prompt, reply, image: imageDataUri },
    ...debugLog.value,
  ].slice(0, MAX_ENTRIES)

  // Disk dump.
  const dir = await runDir(runId, boardName)
  if (dir) {
    const base = `r${round}-${phase || 'call'}`
    const md = [
      '---',
      `phase: ${phase}`,
      `round: ${round}`,
      `tokens_in: ${u.in ?? ''}`,
      `tokens_out: ${u.out ?? ''}`,
      `cost_usd: ${u.cost ?? ''}`,
      '---',
      '',
      '## Prompt',
      '',
      prompt,
      '',
      '## Reply',
      '',
      reply,
      '',
    ].join('\n')
    await writeFile(dir, `${base}.md`, md)
    if (imageDataUri) {
      try {
        const blob = await (await fetch(imageDataUri)).blob()
        await writeFile(dir, `${base}.png`, blob)
      } catch { /* ignore image dump failure */ }
    }
  }

  return u
}

export function clearDebugLog() {
  debugLog.value = []
}

// Write the run-level summary the modal shows (the model's combined note, the
// deduped flagged issues, warnings, verified/rounds, and total token/cost) as one
// `summary.md` alongside the per-call dumps. No-ops when no debug folder is chosen.
export async function logRunSummary({ runId, boardName = '', instruction = '', promptKey = '', mode = '', result = {} }) {
  const dir = await runDir(runId, boardName)
  if (!dir) return
  const u = result.usage || {}
  const issues = Array.isArray(result.issues) ? result.issues : []
  const md = [
    '---',
    'kind: summary',
    `prompt: ${promptKey}`,
    `mode: ${mode}`,
    `verified: ${result.verified ? 'yes' : 'no'}`,
    `rounds: ${result.rounds ?? ''}`,
    `tokens_in: ${u.in ?? ''}`,
    `tokens_out: ${u.out ?? ''}`,
    `cost_usd: ${u.cost ?? ''}`,
    '---',
    '',
    '## Instruction',
    '',
    instruction || '(none)',
    '',
    "## Model note (what it says it did)",
    '',
    result.say || '(none)',
    '',
    '## Flagged issues',
    '',
    issues.length ? issues.map((s) => `- ${s}`).join('\n') : '(none)',
    '',
    '## Warnings',
    '',
    result.warning || '(none)',
    '',
  ].join('\n')
  await writeFile(dir, 'summary.md', md)
}
