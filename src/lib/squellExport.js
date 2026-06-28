// Builders that turn the Squell catalogue into self-contained TXT / Markdown
// documents. The output is structured with clear headings + fenced SQL so it
// can be pasted into any AI chatbot as standalone context.

function fmtDate(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  } catch {
    return String(ts)
  }
}

// One query "sheet": header, description, then every version with its note.
export function buildQueryMarkdown(query, versions = []) {
  const lines = []
  lines.push(`# Query: ${query.name}`)
  lines.push('')
  lines.push(`- **Dialect:** ${query.dialect || 'bigquery'}`)
  lines.push(`- **Versions:** ${versions.length}`)
  if (query.created_at) lines.push(`- **Created:** ${fmtDate(query.created_at)}`)
  lines.push('')
  lines.push('## Description')
  lines.push('')
  lines.push(query.description?.trim() || '_No description._')
  lines.push('')

  const ordered = [...versions].sort((a, b) => a.version_number - b.version_number)
  for (const v of ordered) {
    lines.push(`## Version ${v.version_number} — ${fmtDate(v.created_at)}`)
    lines.push('')
    lines.push('```sql')
    lines.push((v.sql_text || '').replace(/\s+$/, ''))
    lines.push('```')
    lines.push('')
    lines.push('**Note:** ' + (v.note?.trim() || '_(none)_'))
    if (v.ai_note?.trim()) {
      lines.push('')
      lines.push('**AI note:** ' + v.ai_note.trim())
    }
    lines.push('')
  }
  return lines.join('\n')
}

// The whole catalogue: a document title then every query sheet, separated.
export function buildCatalogueMarkdown(queries = [], versionsByQuery = {}) {
  const lines = []
  lines.push('# Squell — SQL Query Catalogue')
  lines.push('')
  lines.push(`Exported ${fmtDate(new Date().toISOString())} · ${queries.length} queries.`)
  lines.push('')
  lines.push('This document catalogues SQL queries and their version history. Each query')
  lines.push('lists every saved revision with the SQL and a note describing the change.')
  lines.push('')

  const ordered = [...queries].sort((a, b) =>
    (a.name || '').localeCompare(b.name || ''),
  )
  for (const q of ordered) {
    lines.push('---')
    lines.push('')
    lines.push(buildQueryMarkdown(q, versionsByQuery[q.id] || []))
  }
  return lines.join('\n')
}

// Plain-text variants reuse the Markdown structure (it reads fine as text and
// the fenced blocks still delimit the SQL clearly).
export function buildQueryText(query, versions = []) {
  return buildQueryMarkdown(query, versions)
}

export function buildCatalogueText(queries = [], versionsByQuery = {}) {
  return buildCatalogueMarkdown(queries, versionsByQuery)
}

// Trigger a client-side download of a string (native pattern used elsewhere
// in the app, e.g. DocumentsView.downloadDocument).
export function downloadTextFile(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Make a query name safe for a filename.
export function slugify(name) {
  return (name || 'query')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'query'
}
