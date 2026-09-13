// The live voice handle both synth voices hand back.
//
// A tie or a slur is ONE sound spanning several notes, so a voice has to
// outlive the note that started it: the caller glides it to the next pitch and
// extends its envelope rather than re-attacking. Notes that stand alone simply
// never get glided.

import { freqOfMidi } from '../notes'
import { holdParam, holdGain } from './params'
import { glideGesture } from './expression'

// `pitch` and `bright` are cents params, `artic` and `amp` are gains.
// `curC` / `curBright` track where the gesture curves were left so a slur
// arriving mid-note ramps on from the right place instead of snapping to it.
export function makeHandle({ ac, nodes, midi, endsAt, pitch, bright, artic, amp }) {
  let end = endsAt
  const baseMidi = midi
  let curC = 0
  const curBright = 0
  let dead = false

  const stopAt = (t) => {
    for (const n of nodes) {
      try { n.stop(t) } catch { /* already past its stop time */ }
    }
  }
  stopAt(end + 0.12)

  return {
    get dead() { return dead },
    get endsAt() { return end },
    get midiFreq() { return freqOfMidi(baseMidi + curC / 100) },

    // Slide to a new pitch. `delaySec` lets the caller schedule a portamento
    // that starts BEFORE the next note is due — which is exactly what a
    // `go:'to'` glide between two slurred notes has to do.
    glideTo(toMidi, glideSec = 0, delaySec = 0) {
      if (dead) return
      const at = ac.currentTime + Math.max(0, delaySec)
      const toC = (toMidi - baseMidi) * 100
      glideGesture({ pitch, bright, artic }, {
        fromC: curC,
        toC,
        at,
        span: Math.max(0.004, glideSec),
        fromBright: curBright,
      })
      curC = toC
    },

    // Keep the sound alive for `durSec` more from now, re-shaping the tail.
    extendTo(durSec) {
      if (dead) return
      const now = ac.currentTime
      const tEnd = now + Math.max(0.06, durSec)
      const rel = Math.min(0.13, durSec * 0.3)
      holdGain(amp, now)
      amp.exponentialRampToValueAtTime(0.9, Math.max(now + 0.01, tEnd - rel))
      amp.exponentialRampToValueAtTime(0.0001, tEnd)
      end = tEnd
      stopAt(end + 0.12)
    },

    // End the sound now (seek, stop, or simply the next note re-attacking).
    // The tone closes down as it fades rather than only getting quieter, which
    // is the difference between a player stopping and a fader being pulled.
    release(fade = 0.09) {
      if (dead) return
      dead = true
      const now = ac.currentTime
      const f = Math.max(0.02, fade)
      holdGain(amp, now)
      amp.exponentialRampToValueAtTime(0.0001, now + f)
      if (bright) {
        holdParam(bright, now)
        bright.linearRampToValueAtTime(curBright - 450, now + f)
      }
      end = now + f
      stopAt(end + 0.06)
    },
  }
}
