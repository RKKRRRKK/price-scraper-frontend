// The one AudioContext Groovy shares.
//
// Separate from Bawu's so the two tools stay independent, and created with
// latencyHint 'interactive' because everything here is measured in
// milliseconds — a padded output buffer would push the click away from the
// moment you hear it.
//
// Created lazily so it comes up inside a user gesture (browsers refuse to start
// audio otherwise), and resumed on every access because a backgrounded tab can
// suspend it out from under us.

let ctx = null

export function ensureAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    // A number, not 'interactive'. latencyHint takes the maximum acceptable
    // latency in seconds, and 0 asks for the smallest buffer the device will
    // give. 'interactive' is a hint the browser may satisfy conservatively.
    ctx = new AC({ latencyHint: 0 })
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// The context if one has been made, without creating one.
export function currentContext() {
  return ctx
}

// Tear down the context and build a new one at a given sample rate.
//
// Worth the disruption: when the AudioContext and the capture device disagree
// about their rate, the browser resamples between them, which costs latency on
// top of everything else — and on Windows the two streams then run off
// different clocks, so the browser also has to keep a drift buffer between
// them. Matching the rate removes both. A context's rate is fixed at
// construction, so the only way to change it is to replace it.
//
// Everything that caches per-context (the output buses, the worklet module
// registry) keys off the context object and rebuilds itself, so callers only
// need to rewire their own nodes.
export async function resetAudio(sampleRate) {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  if (ctx) {
    try {
      await ctx.close()
    } catch {
      /* already closed */
    }
    ctx = null
  }
  ctx = sampleRate ? new AC({ latencyHint: 0, sampleRate }) : new AC({ latencyHint: 0 })
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// Best guess at how long after ctx.currentTime a scheduled sound actually
// leaves the interface. Only a starting point for the offset — the real number
// includes the interface's input path too, which only calibration can find.
export function outputLatencySec() {
  if (!ctx) return 0
  return (ctx.baseLatency || 0) + (ctx.outputLatency || 0)
}
