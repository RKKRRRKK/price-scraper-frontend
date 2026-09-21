// Output buses for everything the app plays at you (click, drums) plus a cached
// noise buffer the percussive voices share.
//
// Click and drums get their own gain so you can bury the kit under a loud click
// without touching the other. Both are deliberately dry and go straight out —
// reverb on a click smears the exact edge you are trying to play against.

let clickGain = null
let drumGain = null
let ownerCtx = null

function ensureBuses(ac) {
  if (ownerCtx !== ac) {
    ownerCtx = ac
    clickGain = null
    drumGain = null
  }
  if (!clickGain) {
    clickGain = ac.createGain()
    clickGain.gain.value = 0.8
    clickGain.connect(ac.destination)
  }
  if (!drumGain) {
    drumGain = ac.createGain()
    drumGain.gain.value = 0.7
    drumGain.connect(ac.destination)
  }
}

export function clickBus(ac) {
  ensureBuses(ac)
  return clickGain
}

export function drumBus(ac) {
  ensureBuses(ac)
  return drumGain
}

export function setClickLevel(ac, v) {
  ensureBuses(ac)
  clickGain.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), ac.currentTime, 0.01)
}

export function setDrumLevel(ac, v) {
  ensureBuses(ac)
  drumGain.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), ac.currentTime, 0.01)
}

// ── Noise ────────────────────────────────────────────────────────────────────
// Two seconds of white noise, generated once and looped by every voice that
// needs a transient. Thrown away if the context is ever replaced.
let noise = null
let noiseCtx = null

export function noiseBuffer(ac) {
  if (noiseCtx !== ac) {
    noiseCtx = ac
    noise = null
  }
  if (!noise) {
    const len = Math.floor(ac.sampleRate * 2)
    noise = ac.createBuffer(1, len, ac.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }
  return noise
}
