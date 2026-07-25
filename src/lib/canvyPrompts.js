// Prompt catalogue + builders for the Canvy op-DSL flow.
//
// Both entry points now speak the same terse op-DSL (canvyOps): the manual
// copy/paste flow AND the live "Run with AI" loop build their prompt here and parse
// the reply with applyOps. The only thing that varies per prompt is the *semantics*
// — what kind of diagram the model should produce — which is injected into a shared
// mechanical shell so the notation/command reference isn't duplicated per mode.
//
//   PROMPTS / promptMode          — the menu + each entry's apply-mode
//   buildConstructivePrompt(…)    — the first build pass / comment turn (live + manual)
//   buildBuildPrompt(…)           — a continuation build pass (live, edit modes)
//   buildManualPrompt(board,data) — the full copy/download prompt for the paste flow

import promptOpsRaw from './canvy-prompts/prompt_ops.md?raw'
import promptOpsCommentRaw from './canvy-prompts/prompt_ops_comment.md?raw'
import promptBuildOpsRaw from './canvy-prompts/prompt_verify_ops.md?raw'
import { serializeBoard, computeLayoutIssues } from './canvyOps'

// `mode` drives how a reply is applied: 'edit' = constructive build, 'comment' =
// review that only adds comments/replies.
export const PROMPTS = [
  { key: 'new', label: 'General', mode: 'edit' },
  { key: 'bpmn', label: 'BPMN diagram', mode: 'edit' },
  { key: 'c4', label: 'C4 model', mode: 'edit' },
  { key: 'comment', label: 'Comment only', mode: 'comment' },
]

export function promptMode(key) {
  return PROMPTS.find((p) => p.key === key)?.mode || 'edit'
}

// ── Per-mode semantics (injected into the shell's {{SEMANTICS}} slot) ────────────
const SEMANTICS = {
  new: `You are redesigning this whiteboard by issuing a list of **edit commands**. You are
the designer here, not a copy-editor: **be ambitious.** Restructure the layout,
regroup related ideas, redraw the flow, add the elements the board is missing, cut
what's redundant, and improve the underlying idea — do whatever genuinely makes the
board clearer and better, even if that means many changes. A bold, well-organised
redesign is the goal; a couple of timid nudges is a failure.`,

  bpmn: `You are editing this whiteboard as a **BPMN 2.0 process diagram** — model the process
the instruction describes, using proper BPMN structure.

Map each BPMN concept to a Canvy kind:
- **Events** (start / intermediate / end) → \`ell\` (ellipse). Start event = green,
  thin border; end event = pink, thick border (\`set … bw:5\`); intermediate = plain.
- **Activities / tasks** → \`rect\`, blue, labelled with a verb phrase ("Review order").
- **Gateways** (decision / merge / parallel) → \`dia\` (diamond), yellow. Label the
  decision question or mark "X" (exclusive) / "+" (parallel). Every flow leaving an
  exclusive gateway MUST have a labelled arrow (its condition, e.g. "Approved").
- **Data objects / datastores** → \`cyl\` (datastore) or \`par\` (data), gray.
- **Pools / lanes** → one \`fr\` frame per lane (title = participant); keep that
  participant's tasks inside its lane.
- **Sequence flows** → solid arrows. **Message flows** → an arrow whose label starts "msg:".

Flow strictly **left-to-right** along the happy path; branch on the y-axis for
alternate paths, then rejoin. Exactly one start event and at least one end event;
every task lies on a path between them.`,

  c4: `You are editing this whiteboard as a **C4 model architecture diagram** — keep a single
board to ONE level (Context / Container / Component) unless told otherwise.

Every box's text reads as three lines — **Name**, then *[Type/Technology]*, then a
short responsibility, e.g. \`"API Application\\n[Container: Node.js]\\nHandles business logic"\`.
Map each element to a Canvy kind:
- **Person / actor** → \`ell\` (ellipse), gray; name + "[Person]".
- **Software system** → \`rect\`, blue for the system in focus, gray for external systems.
- **Container** (app / service / SPA / API) → \`rect\`, blue, \`[Container: <tech>]\`.
- **Datastore / database** → \`cyl\`, blue or green, \`[Container: <db tech>]\`.
- **Component** (inside a container) → \`rect\`, purple.
- **Boundary** (system/container) → a \`fr\` frame (title = boundary name) with the members inside.
- **External** people/systems → gray fill + a dashed border (\`set … bs:dashed\`).

Every arrow is a **directed dependency** and MUST carry a short label describing the
interaction and ideally the protocol ("Reads/writes", "Makes API calls to [JSON/HTTPS]").
Arrows point from the consumer to what it depends on; most should point the same way.`,
}

// ── Shell builders ──────────────────────────────────────────────────────────────
function scopeNote(scopeIds, context) {
  if (!scopeIds || !scopeIds.size) return ''
  if (context) {
    return `\n> Scope: the board below is split into **EDIT THESE** (a selected section, ${scopeIds.size} item(s)) and **CONTEXT** (the rest of the board, read-only). Improve only the EDIT-THESE items — restructure, restyle, add, delete within them. You may draw arrows connecting them to CONTEXT ids, but must NOT move, restyle or delete anything under CONTEXT, and must not \`clear\`.\n`
  }
  return `\n> Scope: you were given only a SELECTED SECTION (${scopeIds.size} item(s)). Edit only these ids; do not \`clear\` or touch the rest of the board.\n`
}
function steeringBlock(steering) {
  const s = (steering || '').trim()
  if (!s) return ''
  return `\n## Plan to execute\nA senior assistant already planned this change — execute the plan below rather than inventing your own approach:\n\n${s}\n`
}
// A machine-checked list of overlaps / arrow clutter (from coordinates, aliased to
// match what the model was shown). Empty string when the layout is clean.
export function layoutIssuesBlock(data, { scopeIds, toAlias }, heading) {
  const issues = computeLayoutIssues(data, { scopeIds, toAlias })
  if (!issues.length) return ''
  return `\n## ${heading}\nDetected automatically from the coordinates — resolve every one:\n${issues.map((s) => `- ${s}`).join('\n')}\n`
}

// The constructive turn. For edit modes this is the redesign shell with the mode's
// semantics injected; for comment mode it's the review template.
export function buildConstructivePrompt({ board, compact, promptKey = 'new', instruction, steering, scopeIds, context, issues = '' }) {
  const name = board?.name || 'Untitled board'
  if (promptMode(promptKey) === 'comment') {
    return promptOpsCommentRaw
      .replace(/\{\{BOARD_NAME\}\}/g, name)
      .replace('{{SCOPE_NOTE}}', scopeNote(scopeIds, context))
      .replace('{{BOARD_COMPACT}}', compact || '(empty board)')
      .replace('{{INSTRUCTION}}', (instruction || '').trim() || '_review the whole board_')
  }
  return promptOpsRaw
    .replace('{{SEMANTICS}}', SEMANTICS[promptKey] || SEMANTICS.new)
    .replace(/\{\{BOARD_NAME\}\}/g, name)
    .replace('{{SCOPE_NOTE}}', scopeNote(scopeIds, context))
    .replace('{{STEERING}}', steeringBlock(steering))
    .replace('{{LAYOUT_ISSUES}}', issues)
    .replace('{{BOARD_COMPACT}}', compact || '(empty board)')
    .replace('{{INSTRUCTION}}', (instruction || '').trim() || '_describe your change here_')
}

// A continuation build pass (edit modes only). The model sees a screenshot of what
// it has built so far plus its own prior note, then keeps building + fixing. Re-states
// the mode's conventions so additions stay in style.
//   progressNotes — the model's `!` note from the previous pass (threaded reasoning)
//   pass/maxPasses — where we are in the self-stopping loop
//   moreMode      — a user "keep going" resume: 'build' (expansion REQUIRED) or 'fix'
//                   (correction only). Empty for ordinary continuation passes.
export function buildBuildPrompt({ board, compact, promptKey = 'new', instruction, issues = '', progressNotes = '', pass = 1, maxPasses = 5, moreMode = '' }) {
  const passInfo = `You are on **pass ${pass} of at most ${maxPasses}**. Don't stop early — only reply \`done\` once the diagram is genuinely thorough AND clean.`
  const progressBlock = progressNotes
    ? `\n## Progress so far (your own note from the previous pass)\n${progressNotes}\n`
    : ''
  let moreBlock = ''
  if (moreMode === 'build') {
    moreBlock = `\n> ## BUILD MORE — you MUST add new content this pass\n> The user looked at the board and wants it **substantially expanded**. This pass is for **adding**, not tidying:\n> - Add **at least 5 brand-new elements** — new tasks/services/branches/sub-steps/data stores/notes — plus the arrows that connect them. Put them in open space (extend to the right or downward).\n> - Create them with the \`add\` command, e.g. \`add n1 rect @2600,120 200x120 b1 "New Service"\` and \`arw n1:l->e13:r "label"\`. **\`mov\` only repositions items that ALREADY exist — it does nothing for a new id, so never try to "add" with \`mov\`.** Coin fresh ids like \`n1 n2 n3\`.\n> - Do **not** spend this pass fixing minor overlaps or rerouting existing arrows, and you are **forbidden from replying \`done\`**. Adding real new content is the only goal.\n> - If you think it's already complete, invent plausible extensions anyway (edge cases, retries, monitoring, supporting services, related subsystems) — expansion is required regardless.\n> - Reply **only** in the line-command DSL below. **Never reply with JSON.**\n`
  } else if (moreMode === 'fix') {
    moreBlock = `\n> ## CORRECT MISTAKES — this is a correction pass\n> Focus entirely on what is **wrong** in the screenshot: overlapping boxes, crossing/cluttered arrows, arrows attached to the wrong element or pointing the wrong way, mislabeled / misplaced / clipped items, anything that reads as broken. **Repair** them — pull boxes ≥100px apart, reroute arrows (\`elbow\`/\`~curve\`/pin a side), fix connections and labels. Do **not** add new scope this pass. Reply \`done\` only once it genuinely looks clean.\n`
  } else {
    moreBlock = `\n> There is almost always more you can add or tighten — keep **enriching** the diagram this pass (missing steps/detail, clearer grouping, cleaner layout). Prefer making real progress over stopping; reply \`done\` only when it's genuinely complete and clean.\n`
  }
  return promptBuildOpsRaw
    .replace('{{SEMANTICS}}', SEMANTICS[promptKey] || SEMANTICS.new)
    .replace(/\{\{BOARD_NAME\}\}/g, board?.name || 'Untitled board')
    .replace('{{INSTRUCTION}}', (instruction || '').trim() || '(the change described earlier)')
    .replace('{{PASS_INFO}}', passInfo)
    .replace('{{PROGRESS_NOTES}}', progressBlock)
    .replace('{{MORE_NUDGE}}', moreBlock)
    .replace('{{LAYOUT_ISSUES}}', issues)
    .replace('{{BOARD_COMPACT}}', compact || '(empty board)')
}

// The full copy/download prompt for the manual paste flow — serializes the board to
// the compact notation (the same the live flow sends) and folds in layout issues.
export function buildManualPrompt(board, data, { promptKey = 'new', instruction = '', scopeIds = null, context = false, steering = '' } = {}) {
  const mode = promptMode(promptKey)
  const scope = mode !== 'comment' && scopeIds && scopeIds.size ? scopeIds : null
  const withContext = !!(scope && context)
  const { text: compact, toAlias } = serializeBoard(data || {}, { scopeIds: scope, withContext })
  const issues = mode === 'comment' ? '' : layoutIssuesBlock(data || {}, { scopeIds: scope, toAlias }, 'Problems in the current board to fix')
  return buildConstructivePrompt({ board, compact, promptKey, instruction, steering, scopeIds: scope, context: withContext, issues })
}
