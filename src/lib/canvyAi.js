// AI round-trip for Canvy boards. Two flows:
//
//  • "Edit board" (constructive) — hand an assistant the current board (as JSON)
//    plus the schema + rules, and parse its reply (a ```json block) back into a
//    board `data` object. Can be scoped to a selected section and merged back.
//  • "Comment only" (review) — the assistant returns a *comment-merge* JSON that
//    adds comments / replies to existing ones, without redefining the board.
//
// A Canvy board's `data` is already plain JSON, so the "build spec" IS the board
// shape — no translation layer is needed, just validation/normalisation.

import { v4 as uuid } from 'uuid'

const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray']
const SHAPES = ['rect', 'ellipse', 'diamond']
const TYPES = ['sticky', 'text', 'shape', 'draw']

// ── Prompt templates ──────────────────────────────────────────────────────────
// `mode` drives how a reply is applied: 'edit' = constructive build (→ branch),
// 'comment' = comment-merge review (→ current view). Old/New are two constructive
// variants you can A/B; Comment only is the review prompt.
import promptOldRaw from './canvy-prompts/prompt_old.md?raw'
import promptNewRaw from './canvy-prompts/prompt_new.md?raw'
import promptCommentRaw from './canvy-prompts/prompt_comment.md?raw'

export const PROMPTS = [
  { key: 'old', label: 'Old', mode: 'edit' },
  { key: 'new', label: 'New', mode: 'edit' },
  { key: 'comment', label: 'Comment only', mode: 'comment' },
]

// Look up a prompt's apply-mode by key (defaults to constructive 'edit').
export function promptMode(key) {
  return PROMPTS.find((p) => p.key === key)?.mode || 'edit'
}

const PROMPT_TEMPLATES = {
  old: promptOldRaw,
  new: promptNewRaw,
  comment: promptCommentRaw,
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const str = (v) => (v == null ? '' : String(v))
const clampN = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

// Pick the elements/arrows/comments to expose to the assistant. When `scopeIds`
// is given, restrict to that selection: the selected elements, arrows whose both
// endpoints are selected, and comments anchored within the selection.
function scopedData(d, scopeIds) {
  const elements = Array.isArray(d.elements) ? d.elements : []
  const arrows = Array.isArray(d.arrows) ? d.arrows : []
  const comments = Array.isArray(d.comments) ? d.comments : []
  if (!scopeIds || !scopeIds.size) return { elements, arrows, comments }

  const inScope = (id) => id != null && scopeIds.has(String(id))
  const els = elements.filter((el) => scopeIds.has(String(el.id)))
  const ars = arrows.filter((a) => inScope(a.from?.elementId) && inScope(a.to?.elementId))
  const arIds = new Set(ars.map((a) => String(a.id)))
  const coms = comments.filter((c) => {
    const on = c.on
    if (!on) return false // free-floating comments are board-wide, not section-scoped
    if (on.elementId != null) return inScope(on.elementId)
    if (Array.isArray(on.betweenIds)) return on.betweenIds.every(inScope)
    if (on.arrowId != null) return arIds.has(String(on.arrowId))
    return false
  })
  return { elements: els, arrows: ars, comments: coms }
}

function currentJson(board, scopeIds) {
  const d = board?.data || {}
  return JSON.stringify(scopedData(d, scopeIds), null, 2)
}

// Build the markdown prompt. `opts`: { instruction, scopeIds, data }.
// `data` overrides board.data (used to build from whichever view — main/branch —
// is currently shown).
export function buildPromptMarkdown(board, promptKey = 'new', opts = {}) {
  const template = PROMPT_TEMPLATES[promptKey] ?? PROMPT_TEMPLATES.new
  const src = opts.data ? { name: board?.name, data: opts.data } : board
  const scopeNote =
    opts.scopeIds && opts.scopeIds.size
      ? `\n> Scope: you are only given a SELECTED SECTION of the board (${opts.scopeIds.size} element(s)). Edit only these; keep their ids stable. Do not invent the rest of the board.\n`
      : ''
  return template
    .replace('{{BOARD_NAME}}', src?.name || 'Untitled board')
    .replace('{{SCOPE_NOTE}}', scopeNote)
    .replace('{{BOARD_JSON}}', currentJson(src, opts.scopeIds))
    .replace('{{INSTRUCTION}}', (opts.instruction || '').trim() || '_describe your change here_')
}

// ── Parse a reply back into board data ────────────────────────────────────────
// Pull the first JSON object out of a reply (fenced ```json block first, then any
// fenced block, then the first balanced {…}).
function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json|canvy[a-z-]*)?\s*([\s\S]*?)```/i)
  if (fenced && fenced[1].trim().startsWith('{')) return fenced[1].trim()
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

function normalizeEndpoint(end, ids) {
  if (!end || typeof end !== 'object') return null
  if (end.elementId != null && ids.has(String(end.elementId))) return { elementId: String(end.elementId) }
  if (end.x != null && end.y != null) return { x: num(end.x), y: num(end.y) }
  return null
}

// A comment anchor (`on`): { elementId } | { betweenIds:[a,b] } | { arrowId }.
// Returns null if the anchor is missing or references ids that don't exist.
function normalizeAnchor(on, ids, arrowIds) {
  if (!on || typeof on !== 'object') return null
  if (on.elementId != null && ids.has(String(on.elementId))) return { elementId: String(on.elementId) }
  if (Array.isArray(on.betweenIds)) {
    const b = on.betweenIds.map(String).filter((x) => ids.has(x))
    if (b.length === 2) return { betweenIds: [b[0], b[1]] }
  }
  if (on.arrowId != null && arrowIds.has(String(on.arrowId))) return { arrowId: String(on.arrowId) }
  return null
}

function normalizeMessages(raw) {
  if (Array.isArray(raw.messages)) {
    return raw.messages
      .filter((m) => m && m.text != null)
      .map((m) => ({ id: m.id != null ? String(m.id) : uuid(), text: str(m.text), created_at: m.created_at || null }))
  }
  if (raw.text != null && String(raw.text).trim()) {
    return [{ id: uuid(), text: str(raw.text), created_at: null }]
  }
  return []
}

// Validate + clean a raw board spec into a board `data` object. Shared by the
// full build and the scoped merge.
function normalizeBoard(spec) {
  const warnings = []

  // ── elements ──
  const elements = []
  const ids = new Set()
  for (const raw of Array.isArray(spec.elements) ? spec.elements : []) {
    if (!raw || typeof raw !== 'object') continue
    const type = TYPES.includes(raw.type) ? raw.type : null
    if (!type) { warnings.push(`Skipped element with unknown type "${raw.type}"`); continue }
    let id = raw.id != null ? String(raw.id) : uuid()
    if (ids.has(id)) id = uuid()
    ids.add(id)

    if (type === 'draw') {
      const pts = Array.isArray(raw.points)
        ? raw.points
            .map((p) => (Array.isArray(p) ? [num(p[0]), num(p[1])] : null))
            .filter(Boolean)
        : []
      if (pts.length < 2) { warnings.push('Skipped a draw element with fewer than 2 points.'); ids.delete(id); continue }
      // Derive the bbox and store points relative to it (matches the editor).
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const [px, py] of pts) {
        minX = Math.min(minX, px); minY = Math.min(minY, py)
        maxX = Math.max(maxX, px); maxY = Math.max(maxY, py)
      }
      const el = {
        id,
        type: 'draw',
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.max(1, Math.round(maxX - minX)),
        h: Math.max(1, Math.round(maxY - minY)),
        points: pts.map(([px, py]) => [Math.round(px - minX), Math.round(py - minY)]),
        color: COLORS.includes(raw.color) ? raw.color : 'gray',
        shade: clampN(num(raw.shade, 4), 0, 4),
        strokeWidth: clampN(num(raw.strokeWidth, 3), 1, 24),
      }
      applyCommonStyle(el, raw)
      elements.push(el)
      continue
    }

    const el = {
      id,
      type,
      x: num(raw.x),
      y: num(raw.y),
      w: Math.max(60, num(raw.w, type === 'text' ? 220 : 180)),
      h: Math.max(36, num(raw.h, type === 'text' ? 48 : type === 'sticky' ? 140 : 110)),
      text: str(raw.text),
    }
    if (type === 'shape') el.shape = SHAPES.includes(raw.shape) ? raw.shape : 'rect'
    if (type !== 'text') {
      el.color = COLORS.includes(raw.color) ? raw.color : type === 'sticky' ? 'yellow' : 'blue'
      el.shade = clampN(num(raw.shade, 1), 0, 4)
    }
    applyCommonStyle(el, raw)
    elements.push(el)
  }

  // ── arrows ──
  const arrows = []
  const arrowIds = new Set()
  for (const raw of Array.isArray(spec.arrows) ? spec.arrows : []) {
    if (!raw || typeof raw !== 'object') continue
    const from = normalizeEndpoint(raw.from, ids)
    const to = normalizeEndpoint(raw.to, ids)
    if (!from || !to) { warnings.push('Skipped an arrow with an endpoint that referenced a missing element.'); continue }
    let id = raw.id != null ? String(raw.id) : uuid()
    if (arrowIds.has(id)) id = uuid()
    arrowIds.add(id)
    const curve = clampN(num(raw.curve, 0), -0.9, 0.9)
    arrows.push({ id, from, to, label: str(raw.label), curve })
  }

  // ── comments ──
  const comments = []
  for (const raw of Array.isArray(spec.comments) ? spec.comments : []) {
    if (!raw || typeof raw !== 'object') continue
    const comment = { id: raw.id != null ? String(raw.id) : uuid(), x: num(raw.x), y: num(raw.y), messages: normalizeMessages(raw) }
    const on = normalizeAnchor(raw.on, ids, arrowIds)
    if (on) comment.on = on
    comments.push(comment)
  }

  return { data: { elements, arrows, comments }, warnings }
}

// Carry optional opacity/rotation through normalization for any element type.
function applyCommonStyle(el, raw) {
  if (raw.opacity != null) el.opacity = clampN(num(raw.opacity, 1), 0.1, 1)
  if (raw.rotation != null) el.rotation = ((num(raw.rotation, 0) % 360) + 360) % 360
}

export function parseBuild(text) {
  const json = extractJson(text)
  if (!json) {
    return { ok: false, error: 'No JSON found. Paste the assistant’s reply — it should contain a ```json block.' }
  }
  let spec
  try { spec = JSON.parse(json) } catch (e) { return { ok: false, error: 'Could not parse JSON: ' + e.message } }
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'The JSON is not a board object.' }

  const { data, warnings } = normalizeBoard(spec)
  if (!data.elements.length && !data.arrows.length && !data.comments.length) {
    return { ok: false, error: 'The JSON contained no elements, arrows or comments.' }
  }
  return { ok: true, data, warnings }
}

// Merge a scoped build back into the full current board: replace selected
// elements with the assistant's versions (matched by id), drop selected elements
// the assistant omitted, append any new elements, and overlay arrows/comments by
// id. Everything outside the selection is preserved.
export function applyScoped(text, currentData, scopeIds) {
  const json = extractJson(text)
  if (!json) return { ok: false, error: 'No JSON found. Paste the assistant’s reply — it should contain a ```json block.' }
  let spec
  try { spec = JSON.parse(json) } catch (e) { return { ok: false, error: 'Could not parse JSON: ' + e.message } }
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'The JSON is not a board object.' }

  const cur = {
    elements: Array.isArray(currentData?.elements) ? currentData.elements : [],
    arrows: Array.isArray(currentData?.arrows) ? currentData.arrows : [],
    comments: Array.isArray(currentData?.comments) ? currentData.comments : [],
  }
  const scope = new Set([...(scopeIds || [])].map(String))
  const build = Array.isArray(spec.elements) ? spec.elements : []
  const buildById = new Map(build.map((el) => [String(el.id), el]))

  // Elements: keep out-of-scope as-is; within scope, take the build version or
  // drop if omitted; append genuinely new elements at the end (front).
  const mergedElements = []
  for (const el of cur.elements) {
    if (scope.has(String(el.id))) {
      if (buildById.has(String(el.id))) mergedElements.push(buildById.get(String(el.id)))
      // else: omitted by the assistant → deleted
    } else {
      mergedElements.push(el)
    }
  }
  const curIds = new Set(cur.elements.map((el) => String(el.id)))
  for (const el of build) {
    if (!curIds.has(String(el.id))) mergedElements.push(el)
  }

  // Arrows/comments: overlay by id (replace matches, add new), keep the rest.
  const buildArrowIds = new Set((spec.arrows || []).map((a) => String(a.id)))
  const buildCommentIds = new Set((spec.comments || []).map((c) => String(c.id)))
  const mergedArrows = [
    ...cur.arrows.filter((a) => !buildArrowIds.has(String(a.id))),
    ...(Array.isArray(spec.arrows) ? spec.arrows : []),
  ]
  const mergedComments = [
    ...cur.comments.filter((c) => !buildCommentIds.has(String(c.id))),
    ...(Array.isArray(spec.comments) ? spec.comments : []),
  ]

  const { data, warnings } = normalizeBoard({
    elements: mergedElements,
    arrows: mergedArrows,
    comments: mergedComments,
  })
  return { ok: true, data, warnings }
}

// ── Comment-only review ───────────────────────────────────────────────────────
// Merge an assistant's comment-review JSON into the current board's comments:
//   { addComments: [ { on|x,y, messages:[{text}] } ],
//     replies:     [ { commentId, messages:[{text}] } ] }
// Returns a new comments array (the rest of the board is untouched).
export function parseCommentBuild(text, currentData) {
  const json = extractJson(text)
  if (!json) return { ok: false, error: 'No JSON found. Paste the assistant’s reply — it should contain a ```json block.' }
  let spec
  try { spec = JSON.parse(json) } catch (e) { return { ok: false, error: 'Could not parse JSON: ' + e.message } }
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'The JSON is not a comment-review object.' }

  const elements = Array.isArray(currentData?.elements) ? currentData.elements : []
  const arrows = Array.isArray(currentData?.arrows) ? currentData.arrows : []
  const ids = new Set(elements.map((el) => String(el.id)))
  const arrowIds = new Set(arrows.map((a) => String(a.id)))
  const comments = JSON.parse(JSON.stringify(Array.isArray(currentData?.comments) ? currentData.comments : []))
  const byId = new Map(comments.map((c) => [String(c.id), c]))

  const warnings = []
  let added = 0
  let replied = 0

  for (const raw of Array.isArray(spec.addComments) ? spec.addComments : []) {
    if (!raw || typeof raw !== 'object') continue
    const messages = normalizeMessages(raw).map((m) => ({ ...m, created_at: m.created_at || new Date().toISOString() }))
    if (!messages.length) continue
    const comment = { id: uuid(), x: num(raw.x), y: num(raw.y), messages }
    const on = normalizeAnchor(raw.on, ids, arrowIds)
    if (on) comment.on = on
    comments.push(comment)
    added++
  }

  for (const raw of Array.isArray(spec.replies) ? spec.replies : []) {
    if (!raw || typeof raw !== 'object') continue
    const target = byId.get(String(raw.commentId))
    if (!target) { warnings.push(`Skipped a reply to unknown comment "${raw.commentId}".`); continue }
    const messages = normalizeMessages(raw).map((m) => ({ ...m, created_at: m.created_at || new Date().toISOString() }))
    if (!messages.length) continue
    if (!Array.isArray(target.messages)) target.messages = []
    target.messages.push(...messages)
    replied++
  }

  if (!added && !replied) {
    return { ok: false, error: 'The JSON added no comments and replied to none.' }
  }
  return { ok: true, comments, added, replied, warnings }
}
