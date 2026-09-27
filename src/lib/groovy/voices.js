// Where the metronome's sounds go.
//
// A voice sink is the set of calls the transport, calibration and the loopback
// test make to put a sound at an exact AudioContext time. The default sends
// them to Web Audio, as it always has. With the Windows helper in engine mode
// (nativeEngine.js), the view swaps in a sink that books the same sounds on the
// helper's output instead. The callers never know which one they have.
//
// Replay deliberately keeps calling scheduleClick() directly: its take audio
// plays through the browser, and its click has to come out of the same place.

import { scheduleClick } from './click'
import { scheduleKick, scheduleSnare, scheduleHat } from './drums'
import { scheduleProbe } from './probe'

export const webVoices = {
  click: (ac, when, kind) => scheduleClick(ac, when, kind),
  kick: (ac, when) => scheduleKick(ac, when),
  snare: (ac, when) => scheduleSnare(ac, when),
  hat: (ac, when, gain = 1, accent = false) => scheduleHat(ac, when, gain, accent),
  probe: (ac, when) => scheduleProbe(ac, when),
}
