// Turn a Canvy whiteboard into a self-contained Markdown document so an AI can
// understand the board: its sticky notes, text blocks, shapes, the arrows that
// connect them, and any comments. Output is structured with clear headings and
// readable connection lines ("A → B"), ready to paste into any AI chat.

const SHAPE_LABEL = { rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond' }

function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}

// A short human label for an element, used both in its own section and when an
// arrow references it. Falls back to a type + id stub when the element is empty.
function elementLabel(el) {
  const t = clean(el?.text)
  if (t) return t.length > 80 ? t.slice(0, 77) + '…' : t
  if (!el) return 'unknown'
  if (el.type === 'shape') return `(empty ${SHAPE_LABEL[el.shape] || 'shape'})`
  if (el.type === 'sticky') return '(empty sticky note)'
  return '(empty text block)'
}

// Resolve an arrow endpoint ({ elementId } or { x, y }) to a readable label.
function endpointLabel(end, byId) {
  if (!end) return '(unattached)'
  if (end.elementId != null) {
    const el = byId.get(end.elementId)
    return el ? elementLabel(el) : '(deleted element)'
  }
  if (end.x != null && end.y != null) {
    return `(point ${Math.round(end.x)}, ${Math.round(end.y)})`
  }
  return '(unattached)'
}

// Shortest distance from a point to an element's rectangle (0 when inside).
function distToBox(px, py, el) {
  const dx = Math.max(el.x - px, 0, px - (el.x + el.w))
  const dy = Math.max(el.y - py, 0, py - (el.y + el.h))
  return Math.hypot(dx, dy)
}

// Describe what a comment points to. An explicit `on` anchor wins; otherwise
// infer from a free-floating pin's position (inside / near element(s)).
function commentAnchor(comment, elements, byId) {
  const on = comment.on
  if (on) {
    if (on.elementId != null) {
      return ` (on "${elementLabel(byId.get(on.elementId))}")`
    }
    if (Array.isArray(on.betweenIds) && on.betweenIds.length === 2) {
      return ` (between "${elementLabel(byId.get(on.betweenIds[0]))}" and "${elementLabel(byId.get(on.betweenIds[1]))}")`
    }
    if (on.arrowId != null) return ' (on an arrow)'
  }
  if (comment.x == null || comment.y == null || !elements.length) return ''
  const px = comment.x
  const py = comment.y
  const inside = elements.filter((el) => distToBox(px, py, el) === 0)
  if (inside.length) {
    return ` (on ${inside.map((el) => `"${elementLabel(el)}"`).join(', ')})`
  }
  const NEAR = 160 // world px
  const near = elements
    .map((el) => ({ el, d: distToBox(px, py, el) }))
    .filter((x) => x.d <= NEAR)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
  if (near.length === 1) return ` (near "${elementLabel(near[0].el)}")`
  if (near.length > 1) {
    return ` (near ${near.map((x) => `"${elementLabel(x.el)}"`).join(', ')})`
  }
  return ' (floating, not near any element)'
}

export function boardToMarkdown(board) {
  const data = board?.data || {}
  const elements = Array.isArray(data.elements) ? data.elements : []
  const arrows = Array.isArray(data.arrows) ? data.arrows : []
  const comments = Array.isArray(data.comments) ? data.comments : []

  const byId = new Map(elements.map((el) => [el.id, el]))
  const stickies = elements.filter((el) => el.type === 'sticky')
  const texts = elements.filter((el) => el.type === 'text')
  const shapes = elements.filter((el) => el.type === 'shape')
  const draws = elements.filter((el) => el.type === 'draw')

  const lines = []
  lines.push(`# Whiteboard: ${board?.name || 'Untitled board'}`)
  lines.push('')
  lines.push(
    'This document describes a digital whiteboard. It lists the sticky notes, ' +
      'text blocks, and shapes on the board, the arrows that connect them, and any ' +
      'comments. Use it to understand the structure and intent of the board.',
  )
  lines.push('')
  lines.push(
    `- **Sticky notes:** ${stickies.length}  ` +
      `**Text blocks:** ${texts.length}  ` +
      `**Shapes:** ${shapes.length}  ` +
      `**Drawings:** ${draws.length}  ` +
      `**Connections:** ${arrows.length}  ` +
      `**Comments:** ${comments.length}`,
  )
  lines.push('')

  // ── Sticky notes ──
  lines.push('## Sticky notes')
  lines.push('')
  if (stickies.length) {
    for (const s of stickies) lines.push(`- ${clean(s.text) || '_(empty)_'}`)
  } else {
    lines.push('_None._')
  }
  lines.push('')

  // ── Text blocks ──
  lines.push('## Text blocks')
  lines.push('')
  if (texts.length) {
    for (const t of texts) lines.push(`- ${clean(t.text) || '_(empty)_'}`)
  } else {
    lines.push('_None._')
  }
  lines.push('')

  // ── Shapes ──
  lines.push('## Shapes')
  lines.push('')
  if (shapes.length) {
    for (const sh of shapes) {
      const kind = SHAPE_LABEL[sh.shape] || 'Shape'
      lines.push(`- **${kind}:** ${clean(sh.text) || '_(no label)_'}`)
    }
  } else {
    lines.push('_None._')
  }
  lines.push('')

  // ── Drawings ──
  if (draws.length) {
    lines.push('## Drawings')
    lines.push('')
    lines.push(`_${draws.length} freehand ${draws.length === 1 ? 'stroke' : 'strokes'} (hand-drawn annotations)._`)
    lines.push('')
  }

  // ── Connections ──
  lines.push('## Connections')
  lines.push('')
  if (arrows.length) {
    for (const a of arrows) {
      const from = endpointLabel(a.from, byId)
      const to = endpointLabel(a.to, byId)
      const label = clean(a.label)
      lines.push(`- ${from} → ${to}${label ? ` _(${label})_` : ''}`)
    }
  } else {
    lines.push('_None._')
  }
  lines.push('')

  // ── Comments (threads) ──
  lines.push('## Comments')
  lines.push('')
  const threads = comments
    .map((c) => ({
      anchor: commentAnchor(c, elements, byId),
      msgs: Array.isArray(c.messages) ? c.messages : c.text ? [{ text: c.text }] : [],
    }))
    .filter((t) => t.msgs.length)
  if (threads.length) {
    threads.forEach((t, i) => {
      lines.push(`- **Thread ${i + 1}**${t.anchor}:`)
      for (const m of t.msgs) lines.push(`  - ${clean(m.text) || '_(empty)_'}`)
    })
  } else {
    lines.push('_None._')
  }
  lines.push('')

  return lines.join('\n')
}
