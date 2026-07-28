// Image helpers shared by the import modal (fresh upload) and the lyrics pass
// (re-reading a score's stored picture out of Supabase storage).

// Downscale a blob and encode it as a JPEG data URI for the AI call. The
// original blob is what gets stored — this is only what goes over the wire.
export async function toDataUri(blob, maxDim = 1600) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.88)
}

// Fetch a (signed) image URL and encode it the same way. Used to re-send a
// saved score's original picture on a follow-up pass.
export async function urlToDataUri(url, maxDim = 1600) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not read the stored picture (HTTP ${res.status}).`)
  return toDataUri(await res.blob(), maxDim)
}
