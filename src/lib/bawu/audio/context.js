// The one AudioContext everything in Bawu shares.
//
// Created lazily so it comes up inside a user gesture (browsers refuse to start
// audio otherwise), and resumed on every access because a backgrounded tab can
// suspend it out from under us.

let ctx = null

export function ensureAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// The context if one has been made, without creating one. Used by the caches in
// tables.js so they can throw their contents away if the context ever changes.
export function currentContext() {
  return ctx
}
