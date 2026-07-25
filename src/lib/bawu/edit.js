// On-pane note editing: pure transforms between the stored score `data`
// ({ key, bpm, timeSig, lines }) and a flat, explicit-start event list the roll
// can drag around. The bawu is monophonic, so events never overlap — the
// serializer resolves any overlap by trimming the earlier note and fills the
// gaps between notes with rests.

import { flattenScore, degOctAccOfMidi } from './notes'

const EPS = 1e-4
export const MIN_BEATS = 0.125 // finest note the model uses (three underlines)

// Score data → explicit-start note events (rests dropped; gaps are implicit).
// Each event: { id, start, beats, midi, art, ly, py }.
export function dataToEvents(data) {
  const { notes } = flattenScore(data)
  let id = 0
  return notes
    .filter((n) => !n.rest && n.midi != null)
    .map((n) => ({ id: id++, start: n.start, beats: n.beats, midi: n.midi, art: n.art || '', ly: n.ly || '', py: n.py || '' }))
}

// Events → { key, bpm, timeSig, lines }. Notes are sorted by start, de-overlapped
// (monophonic), and separated by rests; the flat cell list is then chunked into
// lines at bar boundaries so the digital jianpu view wraps sensibly. `barsPerLine`
// only affects that visual grouping.
export function eventsToData(events, { key = 'F', bpm = 80, timeSig = '4/4' } = {}, beatsPerBar = 4, barsPerLine = 4) {
  const evs = events
    .filter((e) => e.midi != null)
    .map((e) => ({ ...e, start: Math.max(0, e.start), beats: Math.max(MIN_BEATS, e.beats) }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi)

  // Monophonic cleanup: a note may not start before the previous one ends, and
  // two notes may not share a start.
  for (let i = 0; i < evs.length - 1; i++) {
    const next = evs[i + 1]
    if (next.start <= evs[i].start + EPS) next.start = evs[i].start + evs[i].beats
    const end = evs[i].start + evs[i].beats
    if (next.start < end - EPS) evs[i].beats = Math.max(MIN_BEATS, next.start - evs[i].start)
  }

  // Flat cell list with rests for the gaps.
  const cells = []
  let cursor = 0
  for (const e of evs) {
    if (e.start > cursor + EPS) cells.push({ deg: 0, oct: 0, beats: round8(e.start - cursor) })
    const { deg, oct, acc } = degOctAccOfMidi(e.midi, key)
    const note = { deg, oct, beats: round8(e.beats) }
    if (acc) note.acc = acc
    if (e.art) note.art = e.art
    if (e.ly) note.ly = e.ly
    if (e.py) note.py = e.py
    cells.push(note)
    cursor = e.start + e.beats
  }

  // Chunk into lines at bar boundaries (never mid-note).
  const perLine = Math.max(1, beatsPerBar * barsPerLine)
  const lines = []
  let cur = []
  let acc = 0
  for (const c of cells) {
    cur.push(c)
    acc += c.beats
    if (acc >= perLine - EPS) { lines.push({ notes: cur }); cur = []; acc = 0 }
  }
  if (cur.length) lines.push({ notes: cur })
  if (!lines.length) lines.push({ notes: [] })
  return { key, bpm, timeSig, lines }
}

// The rank (index among sorted notes) an event lands at once serialized — lets
// the caller keep a moved note selected after a drag reshuffles the order.
export function rankOfEvent(events, event) {
  const sorted = events
    .filter((e) => e.midi != null)
    .sort((a, b) => a.start - b.start || a.midi - b.midi)
  return Math.max(0, sorted.indexOf(event))
}

// Snap a beat value to the editing grid.
export function snapBeat(beat, grid) {
  return Math.round(beat / grid) * grid
}

function round8(b) {
  return Math.round(b * 8) / 8 // keep durations on the 1/8-beat grid the app uses
}
