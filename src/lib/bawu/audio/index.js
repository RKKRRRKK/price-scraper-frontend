// Bawu audio: synth voices, metronome, mic pitch tracking, take recorder.
//
// One shared AudioContext (created lazily on the first user gesture). The mic
// is opened once and shared by the pitch tracker and the take recorder so the
// browser only prompts once per session.
//
//   context.js     the shared AudioContext
//   params.js      AudioParam automation helpers and easing curves
//   tables.js      wavetables, LFO shapes, noise — cached for the session
//   reverb.js      the output bus: dry + convolution hall + compressor
//   expression.js  attack scoops, glissandi, bends, fall-offs, portamenti, vibrato
//   voice.js       the modeled free-reed voice
//   classic.js     the original sawtooth voice, kept for A/B
//   handle.js      the live voice handle (glideTo / extendTo / release)
//   metronome.js   the click
//   mic.js         the shared, reference-counted microphone stream
//   pitch.js       autocorrelation pitch tracking
//   recorder.js    MediaRecorder takes

export { ensureAudio } from './context'
export { setReverbEnabled, setReverbLevel, isReverbEnabled } from './reverb'
export { setBawuVoice, playBawuTone } from './voice'
export { playClick } from './metronome'
export { PitchTracker } from './pitch'
export { TakeRecorder, takeExtension } from './recorder'
