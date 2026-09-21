// Opening the right input, on the right channel.
//
// A desk with an interface on it has several inputs and the browser will
// happily hand you the laptop's built-in microphone instead. So: open once to
// earn the permission that makes device labels readable, then let the user pick
// the interface and the channel their bass is actually plugged into, and
// reopen. All the processing that follows works on a single mono tap, so the
// channel split happens here and nowhere else.
//
// Every browser-side "make it sound nice" feature is turned off — echo
// cancellation, noise suppression and AGC all move the signal around in time
// and level, which is precisely what we are trying to measure.

let stream = null
let source = null
let mono = null
let splitter = null

export function isSupported() {
  return !!navigator.mediaDevices?.getUserMedia
}

export async function listInputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      // Labels are empty until a getUserMedia call has been granted.
      label: d.label || `Input ${i + 1}`,
      labelled: !!d.label,
    }))
}

// Resolves with { source, mono, channelCount, deviceId, label, sampleRate }.
// `mono` is the node everything downstream taps: the amp, the onset detector
// and the pitch tracker all hang off it.
//
// There is one way to ask, and this is it: every browser DSP off, the shortest
// buffer the device will give. There used to be a picker offering three other
// getUserMedia paths, because which one is fastest looked like a property of
// the driver rather than something to reason out. It was measured across all
// of them and they agreed within a few milliseconds, so the picker was noise
// in the panel and is gone. The real variable turned out to be the Windows
// driver, which no constraint here can reach.
//
// channelCount is deliberately never constrained: asking for a count the
// device does not natively provide can push the browser onto a
// channel-conversion path with buffering of its own, and Windows shared mode
// hands a browser the first two channels regardless.
const AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  latency: { ideal: 0 },
}

export async function openInput(ac, { deviceId = null, channelIndex = 0 } = {}) {
  if (!isSupported()) throw new Error('This browser cannot open an audio input.')
  closeInput()

  const audio = { ...AUDIO_CONSTRAINTS }
  if (deviceId && deviceId !== 'default') audio.deviceId = { exact: deviceId }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio })
  } catch (e) {
    // Chrome's device IDs are scoped to the origin and rotate when site data is
    // cleared, so a remembered deviceId goes stale and `exact` then throws
    // OverconstrainedError — with the input sitting there plugged in and
    // working. Fall back to the default device rather than making the user
    // guess what an OverconstrainedError is.
    if (!audio.deviceId || (e?.name !== 'OverconstrainedError' && e?.name !== 'NotFoundError')) {
      throw e
    }
    console.warn('[Groovy] remembered input is gone; falling back to the default device.', e)
    delete audio.deviceId
    stream = await navigator.mediaDevices.getUserMedia({ audio })
  }
  const track = stream.getAudioTracks()[0]
  const settings = track?.getSettings?.() || {}
  const channelCount = Math.max(1, settings.channelCount || 1)

  source = ac.createMediaStreamSource(stream)
  mono = ac.createGain()
  mono.channelCount = 1
  mono.channelCountMode = 'explicit'
  mono.channelInterpretation = 'discrete'

  if (channelCount > 1) {
    splitter = ac.createChannelSplitter(channelCount)
    source.connect(splitter)
    splitter.connect(mono, Math.min(channelIndex, channelCount - 1), 0)
  } else {
    source.connect(mono)
  }

  return {
    source,
    mono,
    channelCount,
    deviceId: settings.deviceId || deviceId || 'default',
    label: track?.label || 'Input',
    // The device's own rate. When it differs from the AudioContext's, the
    // browser resamples, which costs both latency and a little accuracy — the
    // setup panel surfaces the mismatch so it can be fixed in the OS.
    sampleRate: settings.sampleRate || null,
    latencyHint: typeof settings.latency === 'number' ? settings.latency : null,
  }
}

// Re-point the mono tap at a different channel of the input that is already
// open. Cheap — no new permission prompt, no gap in the stream.
export function selectChannel(channelIndex) {
  if (!splitter || !mono) return false
  try {
    splitter.disconnect(mono)
  } catch {
    /* was not connected */
  }
  const idx = Math.max(0, Math.min(channelIndex, splitter.numberOfOutputs - 1))
  splitter.connect(mono, idx, 0)
  return true
}

export function closeInput() {
  try {
    splitter?.disconnect()
  } catch {
    /* already gone */
  }
  try {
    source?.disconnect()
  } catch {
    /* already gone */
  }
  try {
    mono?.disconnect()
  } catch {
    /* already gone */
  }
  if (stream) stream.getTracks().forEach((t) => t.stop())
  stream = null
  source = null
  mono = null
  splitter = null
}

export function currentStream() {
  return stream
}

// A device whose label smells like a laptop microphone.
//
// This only matters for an *acoustic* input. An instrument on a cable has no
// path from the speakers back to the interface, so monitoring out loud is
// perfectly fine; it is a microphone in the room that lets the metronome back
// into the detector to be scored as immaculate playing.
//
// Chrome prefixes the current default device with "Default - " and the
// communications device with "Communications - ", so those words are stripped
// before matching — otherwise picking an interface as the system default would
// make it look like a built-in mic.
export function looksLikeBuiltInMic(label = '') {
  const name = label.replace(/^(default|communications)\s*[-–]\s*/i, '')
  return /built-?in|internal|microphone array|\brealtek\b|laptop|headset/i.test(name)
}
