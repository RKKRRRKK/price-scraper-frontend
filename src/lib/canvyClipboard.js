// Embed / extract native Canvy element+arrow data in clipboard HTML.
//
// A Canvy copy writes BOTH this native payload and the Miro payload
// (src/lib/canvyToMiro.js) into one clipboard write, so:
//   • pasting back into Canvy is lossless (exact colours, locks, ids, widths…);
//   • pasting into miro.com still works (Miro reads its own data-meta span).
// The native marker mirrors Miro's scheme — a base64 blob wrapped in a private
// comment inside an otherwise-empty span — so it survives a clipboard round-trip
// and is ignored by every other paste target.

const MARKER = /\(canvy-data-v1\)([\s\S]*?)\(\/canvy-data-v1\)/

// base64 over UTF-8 bytes (btoa is latin1-only, so pack bytes by hand).
function encode(json) {
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function decode(b64) {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function buildCanvyClipboardHtml(elements, arrows) {
  const encoded = encode(JSON.stringify({ elements: elements || [], arrows: arrows || [] }))
  return `<span data-canvy="<!--(canvy-data-v1)${encoded}(/canvy-data-v1)-->"></span>`
}

// clipboard HTML → { elements, arrows } | null (null = no Canvy payload present).
export function parseCanvyClipboard(html) {
  if (!html || typeof html !== 'string') return null
  const m = html.match(MARKER)
  if (!m) return null
  try {
    const b64 = m[1].replace(/&amp;/g, '&').replace(/\s+/g, '')
    const data = JSON.parse(decode(b64))
    if (!data || (!Array.isArray(data.elements) && !Array.isArray(data.arrows))) return null
    return { elements: data.elements || [], arrows: data.arrows || [] }
  } catch {
    return null
  }
}
