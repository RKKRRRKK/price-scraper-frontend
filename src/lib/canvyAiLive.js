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
import { buildConstructivePrompt, buildVerifyPrompt, layoutIssuesBlock, promptMode } from './canvyPrompts'
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

// A verify reply of just "ok" (any case / trailing punctuation) means the render
// matched the model's intent — nothing to change.
export function isOkReply(reply) {
  return /^\s*ok[.!]?\s*$/i.test(reply || '')
}

// Run the full generate → apply → screenshot → verify loop.
//
// Injected callbacks:
//   capture()          → Promise<dataUri>  screenshot the current board
//   commitData(data)   → Promise           store `data` to the branch + remount +
//                                           settle a frame (so the next capture
//                                           reflects it)
//   onStatus({ phase, text })   → progress updates for the UI
//
// Returns { ok, verified, rounds, say, usage:{in,out,cost}, warning }.
export async function runLiveAi({
  board,
  boardData,
  promptKey = 'new',
  instruction,
  steering = '',
  scopeIds = null,
  scoped = false,
  context = false,
  maxRounds = 1,
  capture,
  commitData,
  callGemini: call = callGemini,
  onStatus = () => {},
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

  // When a section is selected, an *edit* run stays scoped: the model only sees (and
  // only screenshots) that section, and may only edit it. The scope grows to include
  // elements the model adds, so verify rounds still show its own work. A comment run
  // is always whole-board (you review anything) and never scoped.
  let liveScope = !isComment && scoped && scopeIds && scopeIds.size ? new Set([...scopeIds].map(String)) : null
  const withContext = !!(liveScope && context)
  // The screenshot exists only so the model can validate its own edits, so it
  // ALWAYS frames just the selection when one is active (context or not) — the
  // surrounding board is provided as text, never as a zoomed-out screenshot.
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

  // 1 — constructive turn.
  onStatus({ phase: 'sending', text: isComment ? 'Sending the board for review…' : 'Sending the board to the AI…' })
  const { text: compact, fromAlias, toAlias } = serializeBoard(current, { scopeIds: liveScope, withContext })
  const editIssues = isComment ? '' : layoutIssuesBlock(current, { scopeIds: liveScope, toAlias }, 'Problems in the current board to fix')
  const prompt = buildConstructivePrompt({ board, compact, promptKey, instruction, steering, scopeIds: liveScope, context: withContext, issues: editIssues })
  // Comment mode is a single, cheap, text-only call — no screenshot, no review loop.
  let image = isComment ? null : await capture(captureOpts())
  let res = await call({ prompt, imageBase64: image })
  const u0 = await logCall({ runId, round: 0, phase: isComment ? 'comment' : 'edit', boardName, prompt, imageDataUri: image, reply: res.text, usage: res.usage })
  addUsage(u0)

  onStatus({ phase: 'applying', text: isComment ? 'Adding the comments…' : 'Applying the edits…' })
  let parsed = parseOps(res.text)
  if (parsed.say) says.push(parsed.say)
  if (parsed.issues?.length) issues.push(...parsed.issues)
  let applied = applyScoped(parsed.ops, { fromAlias })
  warnings.push(...parsed.warnings, ...applied.warnings)
  await commitData(current)

  if (isComment) {
    onStatus({ phase: 'done', text: 'Review complete — comments added ✓' })
    return await finish({ ok: true, verified: true, rounds: 0 })
  }

  // 2 — verify rounds: show the model what it actually produced (scoped to the
  // same section when a selection is active, full board otherwise).
  for (let round = 1; round <= maxRounds; round++) {
    onStatus({
      phase: 'reviewing',
      text: maxRounds > 1 ? `Reviewing the result (round ${round}/${maxRounds})…` : 'Reviewing the result…',
    })
    const ser = serializeBoard(current, { scopeIds: liveScope, withContext })
    const verifyIssues = layoutIssuesBlock(current, { scopeIds: liveScope, toAlias: ser.toAlias }, 'Problems your edit produced')
    image = await capture(captureOpts())
    res = await call({ prompt: buildVerifyPrompt({ board, compact: ser.text, promptKey, instruction, issues: verifyIssues }), imageBase64: image })
    const u = await logCall({ runId, round, phase: 'review', boardName, prompt: '(verify)', imageDataUri: image, reply: res.text, usage: res.usage })
    addUsage(u)

    if (isOkReply(res.text)) {
      onStatus({ phase: 'done', text: 'The AI is happy with the result ✓' })
      return await finish({ ok: true, verified: true, rounds: round })
    }

    onStatus({ phase: 'applying', text: 'Applying the correction…' })
    parsed = parseOps(res.text)
    if (parsed.say) says.push(parsed.say)
    if (parsed.issues?.length) issues.push(...parsed.issues)
    applied = applyScoped(parsed.ops, { fromAlias: ser.fromAlias })
    warnings.push(...parsed.warnings, ...applied.warnings)
    await commitData(current)
  }

  onStatus({ phase: 'done', text: 'Finished — applied all corrections.' })
  return await finish({ ok: true, verified: false, rounds: maxRounds })

  async function finish(base) {
    const warning = warnings.length ? warnings.slice(0, 3).join(' ') + (warnings.length > 3 ? ` (+${warnings.length - 3} more)` : '') : ''
    // De-dupe issues (the model often repeats the same concern across rounds).
    const uniqueIssues = [...new Set(issues.map((s) => s.trim()).filter(Boolean))]
    const result = { ...base, say: says.join(' ').trim(), issues: uniqueIssues, usage: usageTotal, warning }
    // Persist the same summary the modal renders, next to the per-call dumps.
    await logRunSummary({ runId, boardName, instruction, promptKey, mode, result })
    return result
  }
}
