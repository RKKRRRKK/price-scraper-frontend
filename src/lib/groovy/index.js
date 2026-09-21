// Groovy: metronome, timing trainer and a small bass amp.
//
// The shape of it: one AudioContext, one input opened from the interface, and
// one clock. The clock schedules the click and the drums at exact context
// times; the input is tapped three ways — into the amp you hear, into an
// AudioWorklet that reports attacks on that same clock, and into a pitch
// tracker that draws the note. Because the attack and the click are timestamped
// against the same clock, the difference between them is a real number of
// milliseconds rather than a guess.
//
//   context.js    the shared AudioContext
//   bus.js        click/drum output gains and the shared noise buffer
//   grid.js       meters, subdivisions, slot naming, drum patterns
//   click.js      the metronome voice
//   drums.js      kick, snare, hat
//   transport.js  the lookahead scheduler and the grid it hands out
//   input.js      device and channel selection, the mono tap
//   amp.js        the bass amp chain
//   onset*.js     the attack detector (worklet) and its main-thread wrapper
//   pitch.js      bass-range pitch tracking for the roll
//   analysis.js   deviations into statistics
//   recorder.js   optional audio for a take

export { ensureAudio, currentContext, outputLatencySec } from './context'
export { setClickLevel, setDrumLevel } from './bus'
export {
  METERS,
  meterById,
  subdivisionsFor,
  coerceSubdiv,
  slotKind,
  slotLabel,
  slotsPerBar,
  patternsFor,
  patternById,
  patternRes,
} from './grid'
export { Transport } from './transport'
export {
  isSupported as isInputSupported,
  listInputDevices,
  openInput,
  selectChannel,
  closeInput,
  currentStream,
  looksLikeBuiltInMic,
} from './input'
export { BassAmp } from './amp'
export { OnsetDetector, isWorkletSupported, ratioForSensitivity } from './onset'
export { BassPitchTracker, midiFloatOfFreq, noteNameOfMidi, freqOfMidi } from './pitch'
export { summarise, histogram, grade, feelLabel, mean, stdev, median, percentile } from './analysis'
export { TakeRecorder, takeExtension } from './recorder'
