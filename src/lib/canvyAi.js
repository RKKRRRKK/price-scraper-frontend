// AI round-trip for Canvy boards: build a prompt that hands an assistant the
// current board (as JSON) plus the schema + rules, and parse the assistant's
// reply (a ```json block) back into a board `data` object the app can apply.
//
// A Canvy board's `data` is already plain JSON, so the "build spec" IS the board
// shape — no translation layer is needed, just validation/normalisation.

import { v4 as uuid } from 'uuid'

const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray']
const SHAPES = ['rect', 'ellipse', 'diamond']
const TYPES = ['sticky', 'text', 'shape']

// ── Prompt ───────────────────────────────────────────────────────────────────
function currentJson(board) {
  const d = board?.data || {}
  return JSON.stringify(
    {
      elements: Array.isArray(d.elements) ? d.elements : [],
      arrows: Array.isArray(d.arrows) ? d.arrows : [],
      comments: Array.isArray(d.comments) ? d.comments : [],
    },
    null,
    2,
  )
}

export function buildPromptMarkdown(board) {
  return `# Canvy whiteboard — AI edit prompt

You are editing a digital whiteboard called **${board?.name || 'Untitled board'}**.
Apply the change I describe at the bottom, then return the **complete updated board**
as a single \`\`\`json code block that matches the schema below. Return only valid
JSON inside that block — no commentary inside it.

## Coordinate system
- Units are pixels. Origin (0,0) is top-left; x increases to the right, y downward.
- Suggested sizes: sticky 180×140, text 220×48, shape 180×110.
- Leave ~40px of space between elements so they don't overlap. Lay diagrams out
  left-to-right or top-to-bottom following the flow of the arrows.

## Schema
\`\`\`
{
  "elements": [
    {
      "id": "string, unique and stable (reuse existing ids when editing)",
      "type": "sticky | text | shape",
      "x": number, "y": number, "w": number, "h": number,
      "text": "string (the label / contents)",
      "color": "${COLORS.join(' | ')}   (sticky & shape only)",
      "shape": "rect | ellipse | diamond   (only when type = shape)"
    }
  ],
  "arrows": [
    {
      "id": "string, unique",
      "from": { "elementId": "<an element id>" }   // or a free point: { "x": n, "y": n }
      "to":   { "elementId": "<an element id>" },   // or { "x": n, "y": n }
      "label": "string (optional, shown on the arrow)"
    }
  ],
  "comments": [
    {
      "id": "string, unique",
      "x": number, "y": number,
      "messages": [ { "id": "string", "text": "string" } ]
    }
  ]
}
\`\`\`

## Rules
- Keep ids stable when modifying existing items so arrows stay connected.
- Every arrow endpoint must reference an existing element id (or be an {x,y} point).
- Use \`type:"shape"\` with a \`shape\` of rect/ellipse/diamond for architecture boxes;
  use \`type:"sticky"\` for notes and \`type:"text"\` for plain labels.
- Return the FULL board (all elements/arrows/comments you want to keep), not just the diff.

## Current board
\`\`\`json
${currentJson(board)}
\`\`\`

## Change to make
> _Replace this line with your instructions, e.g. "Add a login flow: a 'Client' box → 'API' box → 'Auth DB' box, connected with labelled arrows."_
`
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

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const str = (v) => (v == null ? '' : String(v))

function normalizeEndpoint(end, ids) {
  if (!end || typeof end !== 'object') return null
  if (end.elementId != null && ids.has(String(end.elementId))) return { elementId: String(end.elementId) }
  if (end.x != null && end.y != null) return { x: num(end.x), y: num(end.y) }
  return null
}

export function parseBuild(text) {
  const json = extractJson(text)
  if (!json) {
    return { ok: false, error: 'No JSON found. Paste the assistant’s reply — it should contain a ```json block.' }
  }
  let spec
  try { spec = JSON.parse(json) } catch (e) { return { ok: false, error: 'Could not parse JSON: ' + e.message } }
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'The JSON is not a board object.' }

  const warnings = []

  // ── elements ──
  const elements = []
  const ids = new Set()
  for (const raw of Array.isArray(spec.elements) ? spec.elements : []) {
    if (!raw || typeof raw !== 'object') continue
    let type = TYPES.includes(raw.type) ? raw.type : null
    if (!type) { warnings.push(`Skipped element with unknown type "${raw.type}"`); continue }
    let id = raw.id != null ? String(raw.id) : uuid()
    if (ids.has(id)) id = uuid()
    ids.add(id)
    const el = {
      id,
      type,
      x: num(raw.x),
      y: num(raw.y),
      w: Math.max(60, num(raw.w, type === 'text' ? 220 : type === 'sticky' ? 180 : 180)),
      h: Math.max(36, num(raw.h, type === 'text' ? 48 : type === 'sticky' ? 140 : 110)),
      text: str(raw.text),
    }
    if (type === 'shape') el.shape = SHAPES.includes(raw.shape) ? raw.shape : 'rect'
    if (type !== 'text') el.color = COLORS.includes(raw.color) ? raw.color : type === 'sticky' ? 'yellow' : 'blue'
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
    arrows.push({ id, from, to, label: str(raw.label) })
  }

  // ── comments ──
  const comments = []
  for (const raw of Array.isArray(spec.comments) ? spec.comments : []) {
    if (!raw || typeof raw !== 'object') continue
    let messages = []
    if (Array.isArray(raw.messages)) {
      messages = raw.messages
        .filter((m) => m && (m.text != null))
        .map((m) => ({ id: m.id != null ? String(m.id) : uuid(), text: str(m.text), created_at: m.created_at || null }))
    } else if (raw.text != null && String(raw.text).trim()) {
      messages = [{ id: uuid(), text: str(raw.text), created_at: null }]
    }
    comments.push({ id: raw.id != null ? String(raw.id) : uuid(), x: num(raw.x), y: num(raw.y), messages })
  }

  if (!elements.length && !arrows.length && !comments.length) {
    return { ok: false, error: 'The JSON contained no elements, arrows or comments.' }
  }
  return { ok: true, data: { elements, arrows, comments }, warnings }
}
