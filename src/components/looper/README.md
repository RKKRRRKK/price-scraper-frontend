# Looper — design notes

Tools → Looper (`/looper`). Record a loop, layer more over it while it plays,
arrange the loops as a song, export to REAPER. Built for getting an idea down
fast; finishing happens in REAPER, so nothing here tries to be a DAW. No
Supabase: the session lives in this browser (IndexedDB) and leaves by export.

Files: `views/LooperView.vue` (state machine, transport, sheets),
`components/looper/*` (pad, arrange grid, input and amp panels),
`lib/looper/*` (engine, detection, export, persistence), `stores/looper.js`.
Input, amp, onset detector, click, calibration run and the scale map come from
Groovy (`lib/groovy/*`, `GroovyFretboard.vue`, `GroovyModal.vue`).

## One timeline: scheduled time

Every time is "scheduled time": the AudioContext time a sound must be
scheduled at to be heard at that moment. Loops, the click and recorded notes
all live there, which is what keeps an overdub on the beat of what you were
listening to.

Input arrives late against it by the **round trip** (output buffer + input
buffer). A sample the capture worklet stamps with context frame `c` was played
along to whatever was scheduled at `c − sync`. Taps are read as
`currentTime − outputLatency` (what you are hearing), live onsets as
`onsetTime − sync`.

## Sync, and why layers are kept raw

The sync (Input → Sync) is that round trip. It starts from the last value
measured on that input, or the browser's estimate, and can be measured (10
clicks, play one note on each, median of the matches — Groovy's
`CalibrationRun`) or set by ear.

Layers are stored as their **raw capture with margins** (0.4 s before, 2.4 s
after) plus the numbers that cut them (`base`, `R`, `len`, `offset`). A layer
played along to something (`follow: true` — every overdub, and a first loop
recorded to the click) is re-cut whenever the sync changes. So a wrong sync
never costs a take: slide it until the overdubs sit, and every layer already
recorded moves with it. That replaced "remember the offset and warn when it
may be stale", which Groovy's history showed is the worse design.

A first loop played free (`follow: false`) is its own reference and never
moves.

## Continuous capture

The capture worklet runs whenever the input is open and posts 1024-frame
chunks (dry DI + amp output) with their context frame. The main thread keeps
10 s in a ring, or everything from the record press back while recording
(`hold`). That is what lets a recording start before the button: a late tap
keeps its downbeat, and a first note keeps the whole of its attack.

## Recording: the keys

Played from the keyboard, on the focused pad (arrows move the focus):
**Space** records, and pressed again mid-take starts the take over;
**Enter** keeps it and moves the focus to the next empty pad (with nothing
recording it plays/stops); **M** / **S** mute / solo; **Delete** clears;
**T** trims and **N** nudges (the focused pad, or right after a take, that
take). Space on a
filled pad records over it — the old take is silent meanwhile and only
replaced on Enter, keeping its name, volume and song row (Ctrl+Z gets it
back).

- **First loop, no click.** Auto: the part played twice (below). Auto off,
  or nothing repeated: `markedLoop` in `detect.js` — the first note's foot to
  the Enter press, moved onto a note's foot if one is within 60 ms. The
  length is otherwise never changed (the old first-note fallback trimmed to
  whole bars and could record past the stop into silence). A tempo is only
  *read* (`readTempo`): the bar count that puts the notes best on the beat,
  60–180 bpm; none fitting well → free.
- **First loop, click on**: one bar of count-in, starts on bar one, ends on
  the bar line nearest the press (or the caught repeat).
- **Over a loop**: Auto looks for the repeat on the grid; else the first note
  (Auto) or the press snaps to the bar, Enter to the nearest; an end in the
  future keeps recording to it.
- **Overdub lengths** (`layerUnits`): shorter takes round up to a divisor of
  the master (a 1-bar shaker repeats every bar); longer ones to ×1/2/4/8, the
  overhang folding over the start like a pedal overdub.
- Recording over the only loop there is starts the session over (new
  master); over a pad among others, it is cut to their grid.

## Catching the repeat (Auto)

What Auto means, in the user's words: "I am finding my groove while
recording, then find it, and then play it again, and it recovers that."
`lib/looper/repeat.js`; while recording it runs every 1.5 s on the last 40 s
so the pad can show "2 bars ✓".

**Notes first, frames second.** The first version compared the take with
itself every 42 ms (pitch, chroma, spectral shape) and wanted a whole pass
to average 80% alike. Real playing isn't: a note dug in harder, one left
ringing, ghost notes that change every pass. It caught 3 of 24 synthetic
cajon takes with that variation, matching the user's report on their cajon
("I only ever get the full recording" — the fallback then started on the
first noodled note). It now runs only when the note search finds nothing.

The note search (`findNoteRepeat`): every onset with its pitch (bass) or
spectral shape (drums, dead notes), weighted by how hard it was hit (ghost
taps count for little). Lag L repeats from s when nearly every note in
[s, s+L) has the same note about L later and vice versa (±60 ms; a pitched
note with no onset where the same pitch is sounding counts 0.8 — soft and
re-struck notes don't always register).

- **Chance is the enemy on drums.** In-tempo noodling with two sounds
  (bass, slap) lines up with anything ~85% of the time. So each lag is scored
  against itself shifted by ±80–400 ms (second best of 18 shifts): a real
  repeat falls apart a sixteenth off, chance doesn't. Ranked on that
  contrast, shrunk when few notes back it, docked per second it ends before
  the stop.
- **Which multiple.** Shorter only if it explains the same playing as well
  (to 0.015 — drums half-repeat at half a bar, and too long sounds right
  where too short doesn't); longer if a multiple explains its own passes
  clearly better (two-bar grooves whose bars nearly match). Found last: a
  strong repeat played twice inside the chosen one's second pass, at a
  length that doesn't divide it, and explaining that whole pass, wins —
  practising half the groove while noodling otherwise reads as one long
  "noodling, then groove" repeat.
- **Length**: measured from matched pairs (median, then the mean within
  25 ms), replaced by the beat-grid fit over every note when they agree to
  0.5%. Boundaries use ±30 ms around it — at ±60 ms noodled hits keep finding
  partners and walk the start back into the noodling.
- **Pass kept**: the latest that fits inside the repeat, stepped in whole
  beats from where it came in (errors are at the start); `phase` puts the
  downbeat back at the loop's first sample (the layer's `offset`).

Synthetic tests (`real.mjs`-style, not in the repo: plucked bass with
harmonics, cajon bass/slap/ghost taps, ±12 ms timing, tempo drift, 4%
dropped notes, ghost notes, noodling that half-plays the groove, stops on
time / 0.6–1.8 s late / 15% early, plus pure noodling): on an unseen seed
33/40 cajon and 37/40 bass caught right (old: 14 and 16), no false catches
in 20 noodle-only takes. Misses left: grooves whose halves differ by a ghost
or two (taken at half length), a few one-bar grooves pairing with practice
in the noodling. Not yet run on the user's real cajon — the Export sheet's
"Last take" (whole take, clean DI) is there to bring one back for tuning.

## Trim

Pad menu → Trim, or **T**. The source is the whole last take while it is in
memory (up to 2 min), else what the layer kept (its region ± margins). An
overview with both edges (drag between them to slide), and a 1-s close-up
per edge that snaps to note starts; Preview loops the selection. The only
loop: any length, tempo read again. Among others: whole grid units of the
lengths they allow, and the loop keeps its place on the grid (moving the
start by d moves the `offset` by d). Undoable; a fresh id keeps the old take.

## Nudge

Pad menu → Nudge, or **N**. One turn of the loop over the bar/beat/sixteenth
grid (sixteenths of the master loop when there's no tempo), with everything
else that plays against it underneath — every layer loops from one anchor,
so position k hears `o.wet[k mod o.len]` of each other layer. Drag or arrow
it by 1/16, a beat, or freely (5 ms; Shift 1 ms); grid steps land on the
grid. The loops play while the sheet is open and each shift is heard live as
a rotated copy of the buffer — exact, because buildLayer writes everything
relative to `offset`, so Apply (offset + shift, undoable) is the same sound.
On the only loop it moves where "one" falls, e.g. a downbeat Auto got wrong.

`detect.js` onsets, for reference: log-energy and HF-energy flux, 5 ms steps
over a **20 ms trailing window** — a 5 ms window is shorter than one cycle of
a low E, and the waveform's own ripple read as 3× too many attacks.

## Seams

`buildLayer` folds the region into a circular buffer. If a note starts right
at the region end (you played into the next pass) the end is **crossfaded**
(20 ms) into the audio from just before the start — downbeat once, no step.
Otherwise the last note was ringing: its **tail** (to the next note, max 2 s)
is added over the start, as it would ring if the phrase really repeated. The
tail only exists a couple of seconds after the loop closes, so the layer is
rebuilt then and hot-swapped (30 ms crossfade between sample-aligned buffers).

## Playback

One looping `AudioBufferSourceNode` per layer, all against one anchor;
looping sources wrap on exact sample counts so layers never drift. Layer
lengths that are multiples of the master are exact sample multiples of it.
The arrangement books gain automation per block up front; the export renders
the same envelope (`RAMP_SEC` in both).

## Export

- **REAPER project** (zip): each loop once as a 32-bit float WAV, a `.rpp`
  with `TEMPO`, and each run of "on" blocks as a looping item (`LOOP 1`,
  `SOFFS` = phase into the loop) — the song stays editable. Optional muted DI
  tracks for re-amping. Plus `Mix.wav`.
- **Stems**: full-length renders per loop, all from zero.
- **Mix**: the song, pulled under full scale only if it would clip.

Not verified in REAPER itself yet — the `.rpp` is hand-written to the format.
The REAPER zip also holds the session (`Session/`), so it opens in the Looper.

## Save and open

The session lives in this browser (IndexedDB, one session, saved ~1 s after
every change). **Save** (Ctrl+S) writes it as a `.looper` file and **Open**
(Ctrl+O) reads it back — `lib/looper/session.js`. The file is a store-only
zip: `session.json` (master, sync, mix, song, each layer's cut: len, offset,
R, base, follow) plus every layer's *raw* capture as float WAVs, so an opened
session trims, nudges and re-syncs like the saved one. The REAPER export
carries the same files in `Session/`, so that zip opens too, and so does one
re-zipped by Windows (deflate, inflated with DecompressionStream). Opened
loops get fresh ids (undo holds the old ones); opening over a session is one
undo step. A file made at another sample rate is resampled to the context's
(OfflineAudioContext) with every position scaled and master multiples kept
exact. Round-trip tested in Node (stored, nested in a REAPER zip, deflated);
the resampling path is not.

**New session** sits in the footer, red, and takes two clicks (the first
arms it for 4 s). It replaces this browser's saved copy, so Ctrl+Z brings the
old one back only until a reload.

## Not done (yet)

Time-stretching (tempo is fixed once the first loop exists), MIDI/footswitch
beyond the keyboard,
live pitch on the scale map, the Windows native helper path.
