// ── Rich-text helpers ──
// Note bodies are stored as HTML (produced by the TipTap editor). These helpers
// bridge that HTML with the places that still want plain text (titles, card
// previews, search) and with legacy notes that were saved as plain text.

// Rough check for "does this string already contain HTML markup". Good enough to
// distinguish editor HTML from legacy plain text — we only ever emit tags like
// <p>, <strong>, <s>, <ol>, <a>.
function looksLikeHtml(value) {
  return /<[a-z][\s\S]*>/i.test(value)
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Convert stored content into HTML suitable for the editor. Already-HTML content
// passes through untouched; legacy plain text is escaped and its line structure
// is preserved (blank lines split paragraphs, single newlines become <br>).
export function normalizeToHtml(value) {
  const str = value == null ? '' : String(value)
  if (!str.trim()) return ''
  if (looksLikeHtml(str)) return str
  return str
    .split(/\n{2,}/)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// Convert stored content into plain text. Used for titles, previews and search,
// so they reflect the visible text rather than HTML tag names. Plain-text legacy
// content passes through (after collapsing any stray markup).
export function htmlToText(value) {
  const str = value == null ? '' : String(value)
  if (!str) return ''
  if (!looksLikeHtml(str)) return str

  // Insert newlines at block boundaries before stripping, so list items and
  // paragraphs don't run together once the tags are gone.
  const withBreaks = str
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')

  const doc = new DOMParser().parseFromString(withBreaks, 'text/html')
  const text = doc.body.textContent || ''
  return text.replace(/\n{3,}/g, '\n\n').trim()
}
