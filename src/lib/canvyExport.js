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

export function boardToMarkdown(board) {
  const data = board?.data || {}
  const elements = Array.isArray(data.elements) ? data.elements : []
  const arrows = Array.isArray(data.arrows) ? data.arrows : []
  const comments = Array.isArray(data.comments) ? data.comments : []

  const byId = new Map(elements.map((el) => [el.id, el]))
  const stickies = elements.filter((el) => el.type === 'sticky')
  const texts = elements.filter((el) => el.type === 'text')
  const shapes = elements.filter((el) => el.type === 'shape')

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

  // ── Comments ──
  lines.push('## Comments')
  lines.push('')
  if (comments.length) {
    for (const c of comments) lines.push(`- ${clean(c.text) || '_(empty)_'}`)
  } else {
    lines.push('_None._')
  }
  lines.push('')

  return lines.join('\n')
}
