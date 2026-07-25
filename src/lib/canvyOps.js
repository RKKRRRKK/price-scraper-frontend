// Terse op-DSL for the live Canvy AI flow.
//
// Instead of round-tripping the whole board as JSON (which echoes every UUID and
// every unchanged element — expensive and truncation-prone on big boards), the
// model is shown the board in a compact line notation with short *alias* ids
// (e1, a2, c3…) and replies with a small list of edit commands in the same
// notation. This module is the translation layer:
//
//   serializeBoard(data, opts) → compact text + alias↔uuid maps for one turn
//   parseOps(replyText)        → { ops, say, warnings } from the model's reply
//   applyOps(ops, data, maps)  → next board `data`, validated via normalizeBoard
//
// Aliases are per-turn: every turn re-serializes the current board (fresh maps),
// so the model always references what it was just shown. New ids the model coins
// (e.g. `n1`) are minted to real UUIDs on apply.

import { v4 as uuid } from 'uuid'
import { normalizeBoard, scopedData } from './canvyAi'

// ── Vocab maps ────────────────────────────────────────────────────────────────
// Kinds collapse element type+shape into one short token.
const KIND_TO_TYPE = {
  st: 'sticky', tx: 'text',
  rect: 'shape', ell: 'shape', dia: 'shape', cyl: 'shape', par: 'shape',
  dr: 'draw', fr: 'frame',
}
// Named boundary anchors → fractional (ax,ay) across the element box.
const SIDE_TO_ANCHOR = { t: [0.5, 0], b: [0.5, 1], l: [0, 0.5], r: [1, 0.5], c: [0.5, 0.5] }
// Lenient side lookup for *parsing* replies — also accepts the up/down synonyms the
// model reaches for (`:u`, `:d`) on top of the canonical t/b/l/r/c.
const PARSE_SIDE = { ...SIDE_TO_ANCHOR, u: [0.5, 0], d: [0.5, 1] }
const round2 = (n) => Math.round(n * 100) / 100
const KIND_TO_SHAPE = { rect: 'rect', ell: 'ellipse', dia: 'diamond', cyl: 'cylinder', par: 'parallelogram' }
const SHAPE_TO_KIND = { rect: 'rect', ellipse: 'ell', diamond: 'dia', cylinder: 'cyl', parallelogram: 'par' }
const COLOR_TO_LETTER = { yellow: 'y', pink: 'p', blue: 'b', green: 'g', purple: 'v', gray: 'k' }
const LETTER_TO_COLOR = { y: 'yellow', p: 'pink', b: 'blue', g: 'green', v: 'purple', k: 'gray' }

const COLOR_RE = /^([ypbgvk])([0-4])?$/
const SIZE_RE = /^(\d+)x(\d+)$/
const POS_RE = /^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/

// ── String helpers ────────────────────────────────────────────────────────────
function quote(s) {
  return '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"'
}
function unquote(tok) {
  // Strip surrounding quotes and unescape. Tolerates a missing closing quote.
  let s = tok
  if (s.startsWith('"')) s = s.slice(1)
  if (s.endsWith('"') && !s.endsWith('\\"')) s = s.slice(0, -1)
  return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}
const isQuoted = (tok) => tok.startsWith('"')

// Tokenize one line, keeping quoted strings (bare "…" and key:"…") intact.
function tokenize(line) {
  const re = /([A-Za-z_]+:"(?:\\.|[^"\\])*")|("(?:\\.|[^"\\])*")|(\S+)/g
  const out = []
  let m
  while ((m = re.exec(line))) out.push(m[0])
  return out
}

function colorToken(color, shade) {
  const letter = COLOR_TO_LETTER[color]
  if (!letter) return ''
  const sh = Number.isFinite(shade) ? shade : 1
  return `${letter}${sh}`
}
function parseColor(tok) {
  const m = COLOR_RE.exec(tok)
  if (!m) return null
  return { color: LETTER_TO_COLOR[m[1]], shade: m[2] != null ? Number(m[2]) : undefined }
}

// ── Serialize ─────────────────────────────────────────────────────────────────
function elementLine(a, el) {
  const kind = el.type === 'sticky' ? 'st'
    : el.type === 'text' ? 'tx'
    : el.type === 'draw' ? 'dr'
    : el.type === 'frame' ? 'fr'
    : SHAPE_TO_KIND[el.shape] || 'rect'
  const parts = [a, kind, `@${Math.round(el.x)},${Math.round(el.y)}`, `${Math.round(el.w)}x${Math.round(el.h)}`]
  if (el.type !== 'text') {
    const ct = colorToken(el.color, el.shade)
    if (ct) parts.push(ct)
  }
  if (el.fontSize) parts.push(`fs:${Math.round(el.fontSize)}`)
  if (el.locked) parts.push('lk')
  if (el.type !== 'draw' && el.text) parts.push(quote(el.text))
  return parts.join(' ')
}
// Encode a fractional boundary anchor as `:side` (t/r/b/l/c) or `:ax,ay`. Empty
// when the endpoint uses the default directional-from-centre attach.
function anchorToken(e) {
  if (e?.ax == null || e?.ay == null) return ''
  for (const [side, [ax, ay]] of Object.entries(SIDE_TO_ANCHOR)) {
    if (Math.abs(ax - e.ax) < 0.001 && Math.abs(ay - e.ay) < 0.001) return `:${side}`
  }
  return `:${round2(e.ax)},${round2(e.ay)}`
}
function arrowLine(a, ar, toAlias) {
  const end = (e) => (e?.elementId != null ? (toAlias.get(String(e.elementId)) || '?') + anchorToken(e) : `@${Math.round(e?.x || 0)},${Math.round(e?.y || 0)}`)
  const parts = [a, `${end(ar.from)}->${end(ar.to)}`]
  if (ar.label) parts.push(quote(ar.label))
  if (ar.mode === 'elbow') parts.push('elbow')
  else if (ar.curve) parts.push(`~${ar.curve}`)
  const h = ar.heads
  if (h && h.start && h.end) parts.push('<>')
  else if (h && h.start && !h.end) parts.push('<')
  if (ar.labelPos != null && Math.abs(ar.labelPos - 0.5) > 0.001) parts.push(`lpos:${round2(ar.labelPos)}`)
  if (ar.labelSize) parts.push(`lsz:${Math.round(ar.labelSize)}`)
  return parts.join(' ')
}
function commentLine(a, c, toAlias) {
  let anchor
  if (c.on?.elementId != null) anchor = `on:${toAlias.get(String(c.on.elementId)) || '?'}`
  else if (Array.isArray(c.on?.betweenIds)) anchor = `on:${c.on.betweenIds.map((x) => toAlias.get(String(x)) || '?').join('+')}`
  else if (c.on?.arrowId != null) anchor = `on:${toAlias.get(String(c.on.arrowId)) || '?'}`
  else anchor = `@${Math.round(c.x || 0)},${Math.round(c.y || 0)}`
  const text = Array.isArray(c.messages) ? c.messages.map((m) => m.text).filter(Boolean).join(' | ') : ''
  return [a, anchor, quote(text)].join(' ')
}

// Serialize a board to the compact notation. Returns { text, fromAlias, toAlias }
// (fromAlias: alias→uuid, toAlias: uuid→alias).
//   scopeIds (Set)  — a selected section.
//   withContext     — when scoped, also emit the rest of the board as a labelled
//                     READ-ONLY context block (aliased so the model can connect to
//                     it, but flagged not to edit it). Off → only the section.
export function serializeBoard(data, { scopeIds = null, withContext = false } = {}) {
  const scope = scopeIds && scopeIds.size ? new Set([...scopeIds].map(String)) : null
  const contextMode = !!(scope && withContext)

  // Scoped section only, unless including context (or unscoped) → whole board.
  const src = scope && !withContext ? scopedData(data || {}, scope) : scopedData(data || {}, null)
  const { elements, arrows, comments } = src

  const fromAlias = new Map()
  const toAlias = new Map()
  const alias = (prefix, i, id) => {
    const a = `${prefix}${i + 1}`
    fromAlias.set(a, String(id))
    toAlias.set(String(id), a)
    return a
  }
  // Alias everything up front so arrow/comment endpoints resolve to any element.
  const elAlias = elements.map((el, i) => alias('e', i, el.id))
  const arAlias = arrows.map((ar, i) => alias('a', i, ar.id))
  const cAlias = comments.map((c, i) => alias('c', i, c.id))

  const endIn = (e) => scope && e?.elementId != null && scope.has(String(e.elementId))
  const editEls = [], ctxEls = []
  elements.forEach((el, i) => {
    ;(!scope || scope.has(String(el.id)) ? editEls : ctxEls).push(elementLine(elAlias[i], el))
  })
  const editArs = [], ctxArs = []
  arrows.forEach((ar, i) => {
    const editable = !scope || (endIn(ar.from) && endIn(ar.to))
    ;(editable ? editArs : ctxArs).push(arrowLine(arAlias[i], ar, toAlias))
  })
  const editCs = [], ctxCs = []
  comments.forEach((c, i) => {
    let editable = !scope
    if (scope) {
      const on = c.on
      editable = (on?.elementId != null && scope.has(String(on.elementId))) ||
        (Array.isArray(on?.betweenIds) && on.betweenIds.every((x) => scope.has(String(x))))
    }
    ;(editable ? editCs : ctxCs).push(commentLine(cAlias[i], c, toAlias))
  })

  const editLines = [...editEls, ...editArs, ...editCs]
  let text
  if (contextMode) {
    text = [
      '# EDIT THESE — your selection (improve / restructure only these):',
      ...editLines,
      '',
      '# CONTEXT — rest of the board (READ-ONLY reference; you may draw arrows to these ids but must NOT move, restyle or delete them):',
      ...ctxEls, ...ctxArs, ...ctxCs,
    ].join('\n')
  } else {
    text = editLines.join('\n')
  }

  return { text, fromAlias, toAlias }
}

// ── Parse a reply into ops ────────────────────────────────────────────────────
// Pull the ```ops fence (or any fence, or the raw text), split into command
// lines, and collect the two prose line types: `!` = the model's note (`say`),
// `?` = a genuine issue it wants to flag (broken screenshot, serious inference,
// something it believes is wrong).
export function parseOps(replyText) {
  const warnings = []
  const full = replyText || ''
  const fenced = full.match(/```(?:ops|canvy[a-z-]*)?\s*([\s\S]*?)```/i)
  const opsBody = fenced ? fenced[1] : full

  const stripQuotes = (s) => s.replace(/^["']|["']$/g, '').trim()
  const sayLines = []
  const issues = []
  // `!` notes and `?` problems are collected from the WHOLE reply — models routinely
  // put the `!` summary line ABOVE the ```ops fence, and a fenced-only scan silently
  // dropped it, which broke the threaded progress note AND the live thinking trace.
  for (const rawLine of full.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('!')) { const t = line.slice(1).trim(); if (t) sayLines.push(t) }
    else if (line.startsWith('?')) { const t = stripQuotes(line.slice(1).trim()); if (t) issues.push(t) }
  }
  // Commands come only from the fenced block (or the whole reply when there's no fence).
  const ops = []
  for (const rawLine of opsBody.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    if (line.startsWith('!') || line.startsWith('?')) continue // already handled above
    const tokens = tokenize(line)
    if (!tokens.length) continue
    ops.push({ verb: tokens[0].toLowerCase(), tokens: tokens.slice(1), line })
  }
  return { ops, say: sayLines.join(' ').trim(), issues, warnings }
}

// ── Manual paste: parse an ops reply and apply it to the current board ─────────
// The copy-prompt and the pasted reply are two separate user actions, so the
// alias↔uuid map isn't kept in memory. We re-derive it by re-serializing the current
// board with the SAME scope/context the prompt used — deterministic, so as long as
// the board hasn't changed between copy and paste the ids line up. `commentOnly`
// (comment mode) keeps only cmt/rep commands so a stray structural op can't slip in.
export function applyOpsReply(text, currentData, { scopeIds = null, withContext = false, commentOnly = false } = {}) {
  const scope = scopeIds && scopeIds.size ? new Set([...scopeIds].map(String)) : null
  const { fromAlias } = serializeBoard(currentData || {}, { scopeIds: scope, withContext })
  const parsed = parseOps(text)
  let ops = parsed.ops
  if (commentOnly) ops = ops.filter((o) => o.verb === 'cmt' || o.verb === 'rep')
  if (!ops.length) {
    return { ok: false, error: 'No usable commands found. Paste the assistant’s ```ops block.' }
  }
  const out = applyOps(ops, currentData, { fromAlias }, { scoped: !!scope, scopeIds: scope })
  return { ok: true, data: out.data, warnings: [...parsed.warnings, ...out.warnings], say: parsed.say, issues: parsed.issues }
}

// ── Apply ops to board data ───────────────────────────────────────────────────
// `maps` is the { fromAlias } from the serialization the model was shown this
// turn. `opts`: { scoped, scopeIds } — scoped runs reject `clear` and edits to
// out-of-scope ids. Everything is funnelled through normalizeBoard so the same
// clamping/validation as the JSON flow applies.
export function applyOps(ops, currentData, maps, { scoped = false, scopeIds = null } = {}) {
  const warnings = []
  const fromAlias = maps?.fromAlias || new Map()
  const scope = scoped && scopeIds ? new Set([...scopeIds].map(String)) : null

  // Working copy of the full board.
  const els = deepClone(Array.isArray(currentData?.elements) ? currentData.elements : [])
  const ars = deepClone(Array.isArray(currentData?.arrows) ? currentData.arrows : [])
  const coms = deepClone(Array.isArray(currentData?.comments) ? currentData.comments : [])

  // Editable id set (any kind). When a section is selected the model may edit its
  // elements, the arrows *between* them, comments anchored inside it, and anything
  // it newly creates (added in the pre-scan + resolveOrMint). Everything else
  // (context) is read-only. Null when unscoped → the whole board is editable.
  let editable = null
  if (scope) {
    editable = new Set(scope)
    const endIn = (e) => e?.elementId != null && scope.has(String(e.elementId))
    for (const ar of ars) if (endIn(ar.from) && endIn(ar.to)) editable.add(String(ar.id))
    for (const c of coms) {
      const on = c.on
      if (on?.elementId != null && scope.has(String(on.elementId))) editable.add(String(c.id))
      else if (Array.isArray(on?.betweenIds) && on.betweenIds.every((x) => scope.has(String(x)))) editable.add(String(c.id))
    }
  }

  const local = new Map() // newly-coined alias → minted uuid (this batch)
  const knownUuid = (id) => els.some((e) => String(e.id) === id) || ars.some((a) => String(a.id) === id) || coms.some((c) => String(c.id) === id)

  // Resolve a token to an existing uuid, or null if it isn't a known item.
  const resolveExisting = (tok) => {
    if (fromAlias.has(tok)) return fromAlias.get(tok)
    if (local.has(tok)) return local.get(tok)
    if (knownUuid(String(tok))) return String(tok)
    return null
  }
  // Resolve/mint for a freshly-declared id (add/arw/cmt subject).
  const resolveOrMint = (tok) => {
    const existing = resolveExisting(tok)
    if (existing) return existing
    const id = uuid()
    local.set(tok, id)
    if (editable) editable.add(id)
    return id
  }

  const findEl = (id) => els.find((e) => String(e.id) === id)
  const findArrow = (id) => ars.find((a) => String(a.id) === id)
  const findComment = (id) => coms.find((c) => String(c.id) === id)
  const inScope = (id) => !editable || editable.has(String(id))

  // Pre-register declared ids so forward references (e.g. an arrow listed before
  // the element it points at) resolve within the batch (and count as editable).
  for (const op of ops) {
    if ((op.verb === 'add' || op.verb === 'arw' || op.verb === 'cmt') && op.tokens[0]) {
      const t = op.tokens[0]
      // Skip when the first token is an id-less arrow's `from->to` link, not an id.
      if (!t.includes('->') && !fromAlias.has(t) && !knownUuid(String(t)) && !local.has(t)) {
        const id = uuid()
        local.set(t, id)
        if (editable) editable.add(id)
      }
    }
  }

  for (const op of ops) {
    switch (op.verb) {
      case 'clear': {
        if (scope) { warnings.push('`clear` ignored (a section is selected).'); break }
        els.length = 0; ars.length = 0; coms.length = 0
        break
      }
      case 'del': {
        for (const t of op.tokens) {
          const id = resolveExisting(t)
          if (!id) { warnings.push(`del: unknown id "${t}".`); continue }
          if (!inScope(id)) { warnings.push(`del: "${t}" is outside the selection.`); continue }
          removeById(els, id); removeById(ars, id); removeById(coms, id)
        }
        break
      }
      case 'add': {
        const el = buildAdd(op.tokens, resolveOrMint, warnings)
        if (el) upsert(els, el)
        break
      }
      case 'mov': {
        const id = resolveExisting(op.tokens[0])
        const pos = op.tokens.slice(1).find((t) => POS_RE.test(t))
        const el = id && findEl(id)
        if (!el) { warnings.push(`mov: unknown element "${op.tokens[0]}".`); break }
        if (!inScope(id)) { warnings.push(`mov: "${op.tokens[0]}" is outside the selection.`); break }
        const m = pos && POS_RE.exec(pos)
        if (!m) { warnings.push(`mov: missing @x,y for "${op.tokens[0]}".`); break }
        el.x = Number(m[1]); el.y = Number(m[2])
        // Optional trailing size (`mov e5 @x,y 260x180`) — the model routinely writes
        // it, so honour it as a resize instead of silently dropping it.
        const size = op.tokens.slice(1).find((t) => SIZE_RE.test(t))
        const sm = size && SIZE_RE.exec(size)
        if (sm) { el.w = Number(sm[1]); el.h = Number(sm[2]) }
        break
      }
      case 'set': {
        const id = resolveExisting(op.tokens[0])
        if (!id) { warnings.push(`set: unknown id "${op.tokens[0]}".`); break }
        if (!inScope(id)) { warnings.push(`set: "${op.tokens[0]}" is outside the selection.`); break }
        const target = findEl(id) || findArrow(id)
        if (!target) { warnings.push(`set: "${op.tokens[0]}" is not an element or arrow.`); break }
        applySet(target, op.tokens.slice(1), warnings)
        break
      }
      case 'arw': {
        const ar = buildArrow(op.tokens, resolveOrMint, resolveExisting, warnings)
        if (ar) upsert(ars, ar)
        break
      }
      case 'cmt': {
        const c = buildComment(op.tokens, resolveOrMint, resolveExisting, els, ars, warnings)
        if (c) upsert(coms, c)
        break
      }
      case 'rep': {
        const id = resolveExisting(op.tokens[0])
        const target = id && findComment(id)
        if (!target) { warnings.push(`rep: unknown comment "${op.tokens[0]}".`); break }
        const text = op.tokens.slice(1).filter(isQuoted).map(unquote).join(' ')
        if (!text) { warnings.push(`rep: no text for "${op.tokens[0]}".`); break }
        if (!Array.isArray(target.messages)) target.messages = []
        target.messages.push({ id: uuid(), text })
        break
      }
      case 'back':
      case 'front': {
        // Reorder elements: the array is back→front, so unshift = behind, push = on
        // top. Lets the model send a container/background box behind existing notes.
        const moved = []
        for (const t of op.tokens) {
          const id = resolveExisting(t)
          if (!id || !findEl(id)) { warnings.push(`${op.verb}: unknown element "${t}".`); continue }
          if (!inScope(id)) { warnings.push(`${op.verb}: "${t}" is outside the selection.`); continue }
          const i = els.findIndex((e) => String(e.id) === id)
          if (i >= 0) moved.push(els.splice(i, 1)[0])
        }
        if (op.verb === 'back') els.unshift(...moved)
        else els.push(...moved)
        break
      }
      default:
        warnings.push(`Unknown command "${op.verb}" — skipped.`)
    }
  }

  const { data, warnings: normWarnings } = normalizeBoard({ elements: els, arrows: ars, comments: coms })
  return { ok: true, data, warnings: [...warnings, ...normWarnings] }
}

// ── op builders ───────────────────────────────────────────────────────────────
function buildAdd(tokens, resolveOrMint, warnings) {
  const idTok = tokens[0]
  const kindTok = (tokens[1] || '').toLowerCase()
  const type = KIND_TO_TYPE[kindTok]
  if (!type) { warnings.push(`add: unknown kind "${tokens[1]}".`); return null }
  const el = { id: resolveOrMint(idTok), type }
  if (type === 'shape') el.shape = KIND_TO_SHAPE[kindTok] || 'rect'
  for (const tok of tokens.slice(2)) {
    if (isQuoted(tok)) el.text = unquote(tok)
    else if (POS_RE.test(tok)) { const m = POS_RE.exec(tok); el.x = Number(m[1]); el.y = Number(m[2]) }
    else if (SIZE_RE.test(tok)) { const m = SIZE_RE.exec(tok); el.w = Number(m[1]); el.h = Number(m[2]) }
    else if (COLOR_RE.test(tok)) { const c = parseColor(tok); el.color = c.color; if (c.shade != null) el.shade = c.shade }
    else if (tok === 'lk') el.locked = true
    else if (tok.startsWith('fs:')) { const n = Number(tok.slice(3)); if (n) el.fontSize = n }
    else warnings.push(`add: ignored token "${tok}".`)
  }
  return el
}

function buildArrow(tokens, resolveOrMint, resolveExisting, warnings) {
  // The leading id is optional. The model very often omits it and writes the
  // `from->to` link as the first token (`arw e1->e2 "label" elbow`); when it does,
  // mint an id and treat every token as an option/link.
  const hasId = tokens[0] != null && !tokens[0].includes('->')
  const id = resolveOrMint(hasId ? tokens[0] : `arw-${uuid()}`)
  const rest = hasId ? tokens.slice(1) : tokens
  const link = rest.find((t) => t.includes('->'))
  if (!link) { warnings.push(`arw: missing from->to for "${tokens.join(' ')}".`); return null }
  const [fromTok, toTok] = link.split('->')
  // Endpoint: `@x,y` free point, or `alias` / `alias:side` / `alias:ax,ay` attached
  // with an optional fractional boundary anchor.
  const endpoint = (tok) => {
    const p = POS_RE.exec(tok)
    if (p) return { x: Number(p[1]), y: Number(p[2]) }
    let alias = tok, anchor = null
    const ci = tok.indexOf(':')
    if (ci >= 0) { alias = tok.slice(0, ci); anchor = tok.slice(ci + 1) }
    const uid = resolveExisting(alias)
    if (!uid) return null
    const end = { elementId: uid }
    if (anchor) {
      if (PARSE_SIDE[anchor]) { end.ax = PARSE_SIDE[anchor][0]; end.ay = PARSE_SIDE[anchor][1] }
      else { const fm = /^(-?\d*\.?\d+),(-?\d*\.?\d+)$/.exec(anchor); if (fm) { end.ax = Number(fm[1]); end.ay = Number(fm[2]) } }
    }
    return end
  }
  const from = endpoint(fromTok)
  const to = endpoint(toTok)
  if (!from || !to) { warnings.push(`arw: endpoint of "${link}" references a missing element.`); return null }
  const ar = { id, from, to, label: '', curve: 0, mode: 'straight', heads: { start: false, end: true } }
  for (const tok of rest) {
    if (tok === link) continue
    if (isQuoted(tok)) ar.label = unquote(tok)
    else if (tok.startsWith('~')) { ar.curve = Number(tok.slice(1)) || 0; ar.mode = 'curved' }
    else if (tok === 'elbow') ar.mode = 'elbow'
    else if (tok === '<>') ar.heads = { start: true, end: true }
    else if (tok === '<') ar.heads = { start: true, end: false }
    else if (tok.startsWith('lpos:')) ar.labelPos = Number(tok.slice(5))
    else if (tok.startsWith('lsz:')) ar.labelSize = Number(tok.slice(4))
  }
  return ar
}

// Parse a heads spec like `se`, `s`, `e`, `-` → { start, end }.
function parseHeads(val) {
  return { start: val.includes('s'), end: val.includes('e') }
}

function buildComment(tokens, resolveOrMint, resolveExisting, els, ars, warnings) {
  const id = resolveOrMint(tokens[0])
  const c = { id, x: 0, y: 0, messages: [] }
  for (const tok of tokens.slice(1)) {
    if (isQuoted(tok)) c.messages.push({ id: uuid(), text: unquote(tok) })
    else if (tok.startsWith('on:')) {
      const ref = tok.slice(3)
      if (ref.includes('+')) {
        const ids = ref.split('+').map(resolveExisting).filter(Boolean)
        if (ids.length === 2) c.on = { betweenIds: ids }
      } else {
        const uid = resolveExisting(ref)
        if (uid) {
          if (ars.some((a) => String(a.id) === uid)) c.on = { arrowId: uid }
          else c.on = { elementId: uid }
        }
      }
      if (!c.on) warnings.push(`cmt: anchor "${tok}" references a missing item.`)
    } else if (POS_RE.test(tok)) { const m = POS_RE.exec(tok); c.x = Number(m[1]); c.y = Number(m[2]) }
  }
  if (!c.messages.length) { warnings.push(`cmt: "${tokens[0]}" has no text.`); return null }
  return c
}

function applySet(target, tokens, warnings) {
  const isArrow = target.from != null || target.to != null
  for (const tok of tokens) {
    const i = tok.indexOf(':')
    if (i < 0) { warnings.push(`set: ignored token "${tok}".`); continue }
    const key = tok.slice(0, i)
    const rawVal = tok.slice(i + 1)
    const val = isQuoted(rawVal) ? unquote(rawVal) : rawVal
    switch (key) {
      case 'x': case 'y': case 'w': case 'h': target[key] = Number(val); break
      case 'text': if (!isArrow) target.text = val; break
      case 'c': { const c = parseColor(val); if (c) { target.color = c.color; if (c.shade != null) target.shade = c.shade } break }
      case 'sh': target.shade = Number(val); break
      case 'op': target.opacity = Number(val); break
      case 'rot': target.rotation = Number(val); break
      case 'bw': target.borderWidth = Number(val); break
      case 'bs': if (val === 'dashed' || val === 'solid') target.borderStyle = val; break
      case 'bc': { const c = parseColor(val); if (c) target.borderColor = c.color; break }
      case 'fs': if (!isArrow) target.fontSize = Number(val) || undefined; break
      case 'lk': if (!isArrow) target.locked = !(val === '0' || val === 'false'); break
      case 'label': if (isArrow) target.label = val; break
      case 'curve': if (isArrow) { target.curve = Number(val) || 0; if (target.curve) target.mode = 'curved' } break
      case 'mode':
        if (isArrow && ['straight', 'curved', 'elbow'].includes(val)) {
          target.mode = val
          if (val === 'curved' && !target.curve) target.curve = 0.18
          if (val !== 'curved') target.curve = 0
        }
        break
      case 'heads': if (isArrow) target.heads = parseHeads(val); break
      case 'lpos': if (isArrow) target.labelPos = Number(val); break
      case 'lsz': if (isArrow) target.labelSize = Number(val); break
      default: warnings.push(`set: unknown key "${key}".`)
    }
  }
}

// ── Layout diagnostics ────────────────────────────────────────────────────────
// Deterministic overlap / arrow-clutter detection, computed purely from the board
// coordinates the loop already has. We do NOT prevent these — the loop stays free
// to lay things out however it likes — we just hand the model an explicit, reliable
// list of problems so it doesn't have to spot them in a low-res screenshot.
//
//   computeLayoutIssues(data, { scopeIds, toAlias, max }) → string[]
//
// Each string is a short, alias-named problem, e.g. "e3 overlaps e4",
// "a5 label sits on e8", "a9 crosses e10". `toAlias` (uuid→alias, from
// serializeBoard) names the items the same way the model saw them; only items that
// have an alias are considered, so the report matches the prompt. When `scopeIds`
// is set, only issues touching an in-scope id are reported.
function rectOf(el) { return { x: el.x, y: el.y, w: Math.max(1, el.w), h: Math.max(1, el.h) } }
function areaOf(r) { return r.w * r.h }
function intersectArea(a, b) {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return ix > 0 && iy > 0 ? ix * iy : 0
}
function pointInRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h }
// Orientation-based segment↔segment intersection (used for arrow-through-box).
function segIntersect(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}
function segCrossesRect(p1, p2, r) {
  if (pointInRect(p1, r) || pointInRect(p2, r)) return true
  const c = [
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
  ]
  for (let i = 0; i < 4; i++) if (segIntersect(p1, p2, c[i], c[(i + 1) % 4])) return true
  return false
}
// World point of an arrow endpoint: the pinned boundary anchor, else the element
// centre, else a free-floating point.
function endpointPoint(end, elById) {
  if (!end) return null
  if (end.elementId != null) {
    const el = elById.get(String(end.elementId))
    if (!el) return null
    const ax = end.ax != null ? end.ax : 0.5
    const ay = end.ay != null ? end.ay : 0.5
    return { x: el.x + ax * el.w, y: el.y + ay * el.h }
  }
  if (end.x != null && end.y != null) return { x: end.x, y: end.y }
  return null
}

export function computeLayoutIssues(data, { scopeIds = null, toAlias = null, max = 12 } = {}) {
  const elements = Array.isArray(data?.elements) ? data.elements : []
  const arrows = Array.isArray(data?.arrows) ? data.arrows : []
  const scope = scopeIds && scopeIds.size ? new Set([...scopeIds].map(String)) : null
  const name = (id) => (toAlias ? toAlias.get(String(id)) || null : String(id))
  const elById = new Map(elements.map((el) => [String(el.id), el]))
  const inScope = (id) => !scope || scope.has(String(id))

  // Only reason about items the model was actually shown (have an alias) and can
  // see/move: skip frames (containers — notes inside them are fine) and freehand.
  const named = (el) =>
    el && el.type !== 'frame' && el.type !== 'draw' && (!toAlias || toAlias.has(String(el.id)))
  const boxes = elements.filter(named)

  const issues = []
  const seen = new Set()
  const push = (key, text) => { if (text && !seen.has(key)) { seen.add(key); issues.push(text) } }

  // ── element ↔ element overlaps ──
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (!inScope(a.id) && !inScope(b.id)) continue
      const na = name(a.id), nb = name(b.id)
      if (!na || !nb) continue
      const ra = rectOf(a), rb = rectOf(b)
      const inter = intersectArea(ra, rb)
      if (inter <= 0) continue
      if (inter >= 0.15 * Math.min(areaOf(ra), areaOf(rb))) {
        push(`ov:${[na, nb].sort().join('|')}`, `${na} overlaps ${nb}`)
      }
    }
  }

  // Precompute the drawable segment + label point of every named arrow (linear
  // approximation; curve/elbow routing ignored — good enough to flag tangles).
  const segs = []
  for (const ar of arrows) {
    const an = name(ar.id)
    if (!an) continue
    const fromId = ar.from?.elementId != null ? String(ar.from.elementId) : null
    const toId = ar.to?.elementId != null ? String(ar.to.elementId) : null
    const p1 = endpointPoint(ar.from, elById)
    const p2 = endpointPoint(ar.to, elById)
    if (!p1 || !p2) continue
    const t = ar.labelPos != null ? ar.labelPos : 0.5
    const labelPt = ar.label ? { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) } : null
    segs.push({ an, fromId, toId, p1, p2, labelPt, edit: !scope || inScope(fromId) || inScope(toId) })
  }

  // ── arrow ↔ box: label over, or segment through, a non-endpoint box ──
  for (const s of segs) {
    if (!s.edit) continue
    if (s.labelPt) {
      for (const el of boxes) {
        const id = String(el.id)
        if (id === s.fromId || id === s.toId) continue
        if (pointInRect(s.labelPt, rectOf(el))) { push(`lbl:${s.an}|${name(id)}`, `${s.an} label sits on ${name(id)}`); break }
      }
    }
    for (const el of boxes) {
      const id = String(el.id)
      if (id === s.fromId || id === s.toId) continue
      if (segCrossesRect(s.p1, s.p2, rectOf(el))) { push(`cx:${s.an}|${name(id)}`, `${s.an} crosses ${name(id)}`); break }
    }
  }

  // ── arrow ↔ arrow: crossing lines and colliding labels (the "tangle") ──
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j]
      if (!s.edit && !t.edit) continue
      const key = [s.an, t.an].sort().join('|')
      // Arrows that share an endpoint element meet legitimately — not a tangle.
      const share = (s.fromId && (s.fromId === t.fromId || s.fromId === t.toId)) ||
        (s.toId && (s.toId === t.fromId || s.toId === t.toId))
      if (!share && segIntersect(s.p1, s.p2, t.p1, t.p2)) push(`ax:${key}`, `${s.an} crosses ${t.an}`)
      if (s.labelPt && t.labelPt) {
        const dx = s.labelPt.x - t.labelPt.x, dy = s.labelPt.y - t.labelPt.y
        if (dx * dx + dy * dy < 55 * 55) push(`ll:${key}`, `${s.an} and ${t.an} labels collide`)
      }
    }
    if (issues.length >= max) break
  }

  return issues.slice(0, max)
}

// ── small array utils ─────────────────────────────────────────────────────────
function deepClone(a) { return JSON.parse(JSON.stringify(a)) }
function removeById(arr, id) {
  const i = arr.findIndex((x) => String(x.id) === id)
  if (i >= 0) arr.splice(i, 1)
}
function upsert(arr, item) {
  const i = arr.findIndex((x) => String(x.id) === String(item.id))
  if (i >= 0) arr[i] = item
  else arr.push(item)
}
