// Output buses for everything the app plays at you (click, drums) plus a cached
// noise buffer the percussive voices share.
//
// Click and drums get their own gain so you can bury the kit under a loud click
// without touching the other. Both are deliberately dry and go straight out —
// reverb on a click smears the exact edge you are trying to play against.
//
// Everything is cached per context rather than for "the" context, because the
// native engine renders the same voices in an OfflineAudioContext to upload
// them (nativeEngine.js), and that must not knock the live context's buses and
// their levels over.

const buses = new WeakMap()

function ensureBuses(ac) {
  let b = buses.get(ac)
  if (!b) {
    const click = ac.createGain()
    click.gain.value = 0.8
    click.connect(ac.destination)
    const drums = ac.createGain()
    drums.gain.value = 0.7
    drums.connect(ac.destination)
    b = { click, drums }
    buses.set(ac, b)
  }
  return b
}

export function clickBus(ac) {
  return ensureBuses(ac).click
}

export function drumBus(ac) {
  return ensureBuses(ac).drums
}

export function setClickLevel(ac, v) {
  ensureBuses(ac).click.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), ac.currentTime, 0.01)
}

export function setDrumLevel(ac, v) {
  ensureBuses(ac).drums.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), ac.currentTime, 0.01)
}

// ── Noise ────────────────────────────────────────────────────────────────────
// Two seconds of white noise, generated once per context and looped by every
// voice that needs a transient.
const noises = new WeakMap()

export function noiseBuffer(ac) {
  let noise = noises.get(ac)
  if (!noise) {
    const len = Math.floor(ac.sampleRate * 2)
    noise = ac.createBuffer(1, len, ac.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    noises.set(ac, noise)
  }
  return noise
}
