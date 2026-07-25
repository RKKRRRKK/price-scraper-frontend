// Live AI round-trip for Canvy — the "Run with AI" flow.
//
// The manual flow (canvyAi.js) hands the board to a human who pastes it into a
// chat. This module does it directly: it calls the `canvy-ai` Supabase Edge
// Function (a thin OpenRouter proxy) with a compact op-DSL prompt + a screenshot,
// applies the returned edit commands, then screenshots the *result* and sends it
// back so the model can review what its blind edits actually rendered to.
//
// v2: instead of round-tripping the whole board as JSON, the board goes out in a
// terse alias notation (canvyOps) and the model replies with a small command
// list — far fewer tokens in and out. Every call is logged (canvyAiDebug).
//
// Orchestration lives here; the DOM/store coupling — committing a new board and
// screenshotting it — is injected by CanvyView.

import { supabase } from './supabase'
import { serializeBoard, parseOps, applyOps } from './canvyOps'
import { buildConstructivePrompt, buildBuildPrompt, layoutIssuesBlock, promptMode } from './canvyPrompts'
import { logCall, logRunSummary } from './canvyAiDebug'

// Call the edge function for one turn. Returns { text, usage }, or throws with a
// human-readable message (surfaced in the modal).
export async function callGemini({ prompt, imageBase64 }) {
  const { data, error } = await supabase.functions.invoke('canvy-ai', {
    body: { prompt, imageBase64 },
  })
  if (error) {
    // A non-2xx from the function comes back as FunctionsHttpError; the real
    // message is in the Response body, not error.message.
    let msg = error.message || 'AI request failed.'
    try {
      const body = await error.context?.json?.()
      if (body?.error) msg = body.error
    } catch { /* keep msg */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  const text = data?.text
  if (typeof text !== 'string' || !text.trim()) throw new Error('The AI returned an empty reply.')
  return { text, usage: data?.usage || null }
}

// A reply of just "ok" / "done" (any case / trailing punctuation) means the model
// considers the board complete and clean — nothing left to build or fix.
export function isOkReply(reply) {
  return /^\s*(ok|done)[.!]?\s*$/i.test(reply || '')
}

// Run the reason-act-observe build loop: each pass the model observes a screenshot
// of what it has built so far, reasons (a `!` note threaded pass→pass), then acts
// (ops that add the next chunk + fix issues). It self-stops with `done`, else runs up
// to maxPasses. `resume` + priorNotes continue a finished build (the "I want more"
// button).
//
// Injected callbacks:
//   capture()          → Promise<dataUri>  screenshot the current board
//   commitData(data)   → Promise           store `data` to the branch + remount +
//                                           settle a frame (so the next capture
//                                           reflects it)
//   onStatus({ phase, text })   → progress updates for the UI
//   onNote({ pass, note })      → the model's `!` reason line for this pass (live trace)
//
// Returns { ok, verified, passes, say, progressNotes, issues, usage, warning }.
export async function runLiveAi({
  board,
  boardData,
  promptKey = 'new',
  instruction,
  steering = '',
  scopeIds = null,
  scoped = false,
  context = false,
  maxPasses = 5,
  priorNotes = '',
  resume = false,
  moreMode = '',
  capture,
  commitData,
  callGemini: call = callGemini,
  onStatus = () => {},
  onNote = () => {},
}) {
  const runId = `run-${Date.now()}`
  const boardName = board?.name || 'board'
  const mode = promptMode(promptKey)
  const isComment = mode === 'comment'
  let current = boardData || { elements: [], arrows: [], comments: [] }
  const usageTotal = { in: 0, out: 0, cost: 0 }
  const says = []
  const issues = []
  const warnings = []
  let lastNote = (priorNotes || '').trim() // the model's own running plan, threaded pass→pass

  // When a section is selected, an *edit* run stays scoped: the model only sees (and
  // only screenshots) that section, and may only edit it. The scope grows to include
  // elements the model adds, so later passes still show its own work. A comment run
  // is always whole-board (you review anything) and never scoped.
  let liveScope = !isComment && scoped && scopeIds && scopeIds.size ? new Set([...scopeIds].map(String)) : null
  const withContext = !!(liveScope && context)
  // The screenshot exists so the model can see its own work, so it ALWAYS frames just
  // the selection when one is active (context or not) — the surrounding board is
  // provided as text, never as a zoomed-out screenshot.
  const captureOpts = () => (liveScope ? { frameIds: [...liveScope] } : {})
  const growScope = (prevIds) => {
    if (!liveScope) return
    for (const el of current.elements || []) {
      if (!prevIds.has(String(el.id))) liveScope.add(String(el.id))
    }
  }
  const applyScoped = (ops, maps) => {
    const prevIds = new Set((current.elements || []).map((e) => String(e.id)))
    // Comment runs only add comments/replies — filter out any stray structural op.
    const use = isComment ? ops.filter((o) => o.verb === 'cmt' || o.verb === 'rep') : ops
    const out = applyOps(use, current, maps, { scoped: !!liveScope, scopeIds: liveScope })
    current = out.data
    growScope(prevIds)
    return out
  }

  const addUsage = (u) => {
    if (u?.in) usageTotal.in += u.in
    if (u?.out) usageTotal.out += u.out
    if (u?.cost) usageTotal.cost += u.cost
  }
  const recordNote = (pass, note) => {
    const n = (note || '').trim()
    if (!n) return
    says.push(n)
    lastNote = n
    onNote({ pass, note: n })
  }

  // ── Comment mode: a single, cheap, text-only call — no screenshot, no build loop.
  if (isComment) {
    onStatus({ phase: 'sending', text: 'Sending the board for review…' })
    const { text: compact, fromAlias } = serializeBoard(current, { scopeIds: liveScope, withContext })
    const prompt = buildConstructivePrompt({ board, compact, promptKey, instruction, steering, scopeIds: liveScope, context: withContext, issues: '' })
    const res = await call({ prompt, imageBase64: null })
    const u0 = await logCall({ runId, round: 0, phase: 'comment', boardName, prompt, imageDataUri: null, reply: res.text, usage: res.usage })
    addUsage(u0)
    onStatus({ phase: 'applying', text: 'Adding the comments…' })
    const parsed = parseOps(res.text)
    if (parsed.say) recordNote(0, parsed.say)
    if (parsed.issues?.length) issues.push(...parsed.issues)
    const applied = applyScoped(parsed.ops, { fromAlias })
    warnings.push(...parsed.warnings, ...applied.warnings)
    await commitData(current)
    onStatus({ phase: 'done', text: 'Review complete — comments added ✓' })
    return await finish({ ok: true, verified: true, passes: 0 })
  }

  // ── Reason → Act → Observe build loop. Each pass the model reasons about what it
  // has built (screenshot + board + its own prior note), then adds the next chunk
  // and fixes issues. It self-stops with `done`; otherwise it runs up to maxPasses.
  for (let pass = 1; pass <= maxPasses; pass++) {
    const isFirst = pass === 1 && !resume
    onStatus({ phase: 'building', text: `Building the board (pass ${pass}/${maxPasses})…` })

    const ser = serializeBoard(current, { scopeIds: liveScope, withContext })
    // On a "Build more" pass we deliberately hide the layout-issue list so the model
    // spends the pass ADDING instead of getting pulled into rerouting the same arrows.
    const issuesBlock = (!isFirst && moreMode === 'build')
      ? ''
      : layoutIssuesBlock(
          current,
          { scopeIds: liveScope, toAlias: ser.toAlias },
          isFirst ? 'Problems in the current board to fix' : 'Problems your last pass produced',
        )
    const image = await capture(captureOpts())

    const prompt = isFirst
      ? buildConstructivePrompt({ board, compact: ser.text, promptKey, instruction, steering, scopeIds: liveScope, context: withContext, issues: issuesBlock })
      : buildBuildPrompt({
          board, compact: ser.text, promptKey, instruction, issues: issuesBlock,
          progressNotes: lastNote, pass, maxPasses,
          moreMode: resume ? moreMode : '',
        })

    const res = await call({ prompt, imageBase64: image })
    const u = await logCall({ runId, round: pass, phase: isFirst ? 'edit' : 'build', boardName, prompt, imageDataUri: image, reply: res.text, usage: res.usage })
    addUsage(u)

    // Self-stop: the model is satisfied.
    if (isOkReply(res.text)) {
      onStatus({ phase: 'done', text: 'The AI is satisfied with the result ✓' })
      return await finish({ ok: true, verified: true, passes: pass })
    }

    const parsed = parseOps(res.text)
    if (parsed.say) recordNote(pass, parsed.say)
    if (parsed.issues?.length) issues.push(...parsed.issues)

    // Nothing actionable came back — treat as finished rather than burning passes.
    if (!parsed.ops.length) {
      onStatus({ phase: 'done', text: 'The AI had nothing left to add ✓' })
      return await finish({ ok: true, verified: true, passes: pass })
    }

    onStatus({ phase: 'applying', text: 'Applying this pass…' })
    const applied = applyScoped(parsed.ops, { fromAlias: ser.fromAlias })
    warnings.push(...parsed.warnings, ...applied.warnings)

    await commitData(current)
  }

  onStatus({ phase: 'done', text: `Finished after ${maxPasses} passes.` })
  return await finish({ ok: true, verified: false, passes: maxPasses })

  async function finish(base) {
    const warning = warnings.length ? warnings.slice(0, 3).join(' ') + (warnings.length > 3 ? ` (+${warnings.length - 3} more)` : '') : ''
    // De-dupe issues (the model often repeats the same concern across passes).
    const uniqueIssues = [...new Set(issues.map((s) => s.trim()).filter(Boolean))]
    const result = {
      ...base,
      say: says.join(' ').trim(),
      progressNotes: lastNote, // seed for a "want more" resume
      issues: uniqueIssues,
      usage: usageTotal,
      warning,
    }
    // Persist the same summary the modal renders, next to the per-call dumps.
    await logRunSummary({ runId, boardName, instruction, promptKey, mode, result })
    return result
  }
}
