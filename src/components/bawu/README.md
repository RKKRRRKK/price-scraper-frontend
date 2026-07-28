# Bawu — practice aid (Tools)

A player aid for a bawu flute in **Chinese F** (筒音作5; the all-covered tube note
sounds concert **C4**, playable set **C4 D4 E4 F4 G4 A4 C5 D5** — no natural B).
Photograph Chinese jianpu or western notation (or type jianpu by hand), let AI turn
it into a right-to-left scrolling practice roll with the fingering chart on the
left, and play along with the mic listening.

## Setup

1. **Database + storage** — run `supabase/bawu_schema.sql` in the Supabase SQL
   editor. It creates `bawu_folders`, `bawu_scores` (RLS + whitelist policy, like
   the other tools) and the private `bawu` storage bucket where every converted
   picture is kept.
2. **AI conversion** — deploy the OpenRouter proxy (same pattern as `canvy-ai`;
   the key stays server-side, out of the client bundle):

   ```
   supabase functions deploy bawu-ai
   supabase secrets set OPENROUTER_JIANPU_KEY=<the "Jianpu" OpenRouter key>
   ```

   The function **streams** the model's reply; picture conversion requires it to
   be deployed (there is no frontend key). Redeploy after editing the function.
   Manual jianpu entry works without any AI setup.

### Streaming conversion

Picture conversion is a single **streamed** request. The model replies as
**NDJSON** — a `meta` line first (title, English title, key, BPM, time sig, and
an estimated line count), then one object per melody row. The client
(`convertImageStream` in `ai.js`) opens the score as soon as `meta` arrives,
drops you into the player, and appends rows live as they stream — you can start
playing before it finishes. The whole thing is saved to Supabase once, on clean
completion.

- **Model + effort** are chosen in the import modal (persisted in `localStorage`)
  and passed to the function: `x-ai/grok-4.5` (accurate) or
  `google/gemini-3.5-flash-lite` (fast/cheap); reasoning effort low/medium/high.
  An explicit effort is forwarded for any model; otherwise reasoning-capable
  models default to `low` so grok doesn't spiral into a multi-minute think.
- **Source notation** is also chosen in the import modal (persisted). A
  **Jianpu / Western** toggle picks a dedicated prompt: jianpu reads the printed
  digits directly; **Western** reads five-line staff notation (clef + key
  signature + note positions) and converts each pitch to a jianpu degree relative
  to the detected key. The whole prompt is assembled client-side by
  `buildPrompt({ mode })` in `ai.js` and sent as `prompt` — **the edge function is
  an unchanged pass-through, so prompt changes never need a redeploy.**
- **Truncation is non-fatal.** Because each NDJSON line is parsed on arrival, a
  `finish_reason: length` cut keeps every complete row; the player shows a
  "possibly incomplete" banner with **Continue** (a prefix-cached follow-up call
  via `continueTranscription` that resumes where it stopped), **Keep as is**, or
  **Discard**. `max_tokens` is 32000, so this is rare.

### Lyrics are a second pass

Notes and words used to come back from one request. On a long score that request
ran out of time, and splitting the model's attention between pitches and text
cost accuracy on both — so **lyrics have their own trip to the model**, started
from the **Get lyrics** button on an already-transcribed score
(`BawuLyricsModal.vue` → `convertLyricsStream` in `ai.js`).

The pass re-sends the stored picture (the edge function only reads images) along
with the melody it already knows, rendered as a per-row outline:

```
Row 0 (12 notes): 5 6 1 2 | 3 - 5 3
```

The reply is one NDJSON object per row — `{"i":0,"ly":[…],"py":[…]}` — with the
arrays aligned to that row's **sounding** notes, so nothing has to be matched up
by guesswork on this side. A count that doesn't match is trimmed or padded and
flagged in the review panel. The modal runs **confirm → stream → review**;
nothing is written until **Apply**, which merges into whichever transposition is
on screen (`mergeLyrics` in `notes.js`). Hand-typed scores have no picture, so
the button doesn't appear for them.

## Files

| File | What it is |
| --- | --- |
| `src/views/BawuView.vue` | The whole tool: catalogue rail, mode bar, fingering axis + scrolling roll, transport, original-score panel, key/transpose card. |
| `src/components/bawu/BawuImportModal.vue` | Add score: picture (drop/browse/paste, model + effort dropdowns → hands the stream to the player) or typed jianpu with live parse feedback. |
| `src/components/bawu/BawuLyricsModal.vue` | The lyrics pass: confirm what will run (pīnyīn, overwrite, model, effort, guidance) → watch it stream → review the alignment row by row → **Apply**. |
| `src/components/bawu/BawuJianpuStaff.vue` | The transcribed-jianpu sheet, shared by the docked panel and the phone reader: digits, octave dots, duration decorations, tie/slur arcs, slide and bend marks, lyric syllables. |
| `src/components/bawu/BawuJianpuEditor.vue` | Adjust modal: copy the current transposition's jianpu to the clipboard, hand-edit / paste it back, live parse + fit check, then save it as the score's `data.adjusted` variant. |
| `src/components/bawu/BawuTuner.vue` | Pop-up tuner: ±50¢ needle gauge, note name, Hz readout. Opens from the rail-foot card. |
| `src/lib/bawu/notes.js` | Fingering table, jianpu/key math (refDo per key), fit checking, coach hints ("lift finger 4"), `degOctAccOfMidi` (pitch → jianpu spelling), `readExpr` + `flattenScore`'s tie/slur resolution, `mergeLyrics`. |
| `src/lib/bawu/audio.js` | Shared AudioContext, two synth bawu voices (modeled free-reed + classic sawtooth) into a master bus with a **big-hall convolution reverb** (long pre-delayed impulse, hot wet mix, bus compressor) toggled from the transport, metronome, autocorrelation pitch tracker, MediaRecorder takes. `playBawuTone` returns a live voice handle (`glideTo` / `extendTo` / `release`) so one sound can span a tie or a slur. |
| `src/lib/bawu/ai.js` | Streaming conversion client (`convertImageStream`, `continueTranscription`, `convertLyricsStream`); `buildPrompt({ mode })` assembles the jianpu/western NDJSON prompt; SSE parser, `MODELS`/`EFFORTS`, manual jianpu parser/serialiser, type-0 MIDI export. |
| `src/lib/bawu/edit.js` | On-pane note editing: `dataToEvents` / `eventsToData` convert the stored `data` ⇄ an explicit-start, monophonic event list (de-overlap + rest-fill + bar chunking) that the roll drags around, dropping any tie/slur whose partner moved away. |
| `src/lib/bawu/image.js` | `toDataUri` / `urlToDataUri` — downscale a picture for the wire, shared by the import modal and the lyrics pass. |
| `supabase/functions/bawu-ai/index.ts` | OpenRouter proxy (Deno). `{ prompt, imageBase64, model, effort }` → streams the SSE reply straight through. Holds the key; adds CORS; forwards model + reasoning effort. |
| `src/stores/bawu.js` | Pinia store: scores + folders CRUD, debounced JSONB saves, picture upload + signed URLs. |
| `supabase/bawu_schema.sql` | Tables, RLS, whitelist policy, `bawu` bucket + storage policies. |

## How it behaves

- **Modes** — *Follow me*: the song waits at the playhead until the mic hears the
  target note held for ~120 ms (Space advances manually). *Steady*: scrolls at the
  set BPM with metronome, optional synth. *Listen*: synth plays the piece.
- **Roll** — notes flow right → left into the dashed playhead. The mic trace is
  drawn as an orange line/dot mapped onto the note rows; in follow mode a tip
  shows what was heard and which finger to move.
- **Scroll ⇄ Line** — the toolbar toggle picks how the roll moves while playing
  (sticky in `localStorage`). **Scroll** is the original: the sheet slides
  leftwards under a NOW line pinned at `PLAYHEAD_X`. **Line** holds the sheet
  still and sweeps the line across it, sliding one screenful when it reaches the
  right edge — easier to read ahead from. Both are painted by `paintRoll()` in
  the rAF loop; in line mode the lane transform is only written on a page turn,
  which is what lets a CSS transition animate the flip.
- **Score data** — lives in `bawu_scores.data` as JSONB (`key`, `bpm`, `timeSig`,
  `lines[].notes[] {deg, oct, beats, acc?, art?, ly?, py?}` plus the expression
  fields below). `ly`/`py` are the sung syllable and its pīnyīn. Line grouping
  mirrors the printed systems and drives the where-are-we band over the original
  picture (manual scores render a jianpu sheet instead).
- **Expression marks** — optional per-note fields, all validated in one place by
  `readExpr()` in `notes.js`:

  | field | values | meaning |
  | --- | --- | --- |
  | `ti` | `1` | tied into the next note (same pitch) — one sustained sound |
  | `sl` | `1` | slurred into the next note (different pitch) — legato, no re-tonguing |
  | `gi` | `1` | glissando into this note at the attack (上/下滑音) |
  | `go` | `'off'` / `'to'` | falls away at the end, or portamento across to the next note |
  | `bd` | `-2…2` | bend in semitones during the note, and back (压音) |
  | `vb` | `0…3` | vibrato depth — 3 is flutter tongue (花舌) |

  `ti` and `sl` print as the same arc, so **the pitch decides which it is**:
  `flattenScore()` downgrades a tie to a slur when the neighbour is a different
  pitch, and drops both when a rest or the end of the piece breaks the pair. It
  also derives `noAttack` (don't re-strike this note), `tiedIn` (this is the tail
  of a tie, not a new note) and `soundBeats` (how long the one sound lasts), which
  is what the player, the MIDI export and the roll overlay all read.
- **How they sound** — `playBawuTone` returns a live voice handle, so a tie or a
  slur keeps one voice alive and glides it to the next pitch instead of
  re-attacking. `go:'to'` schedules its portamento *ahead* of the next note, since
  a glide has to start before the note it lands on. Slides, bends and vibrato are
  written onto the oscillator frequency by `schedulePitch()`.
- **How they look** — arcs and diagonals can't come out of a stack of positioned
  pills, so the roll draws them as one SVG layer inside the lane (`buildFxPaths`,
  real pixels so the curves aren't distorted); the jianpu sheet wraps each linked
  run in an `.a4-grp` box with a CSS arc, and prints slide, bend and vibrato marks
  beside the digits.
- **Note names** — the roll toolbar's **1 / C** toggle relabels every roll note
  between the jianpu digit and its western pitch name (e.g. `5` ⇄ `C5`).
- **Lyrics** — when a score carries `ly`/`py` syllables they print under the
  numbers in the transcribed-jianpu panel; the toolbar's **Lyrics** toggle also
  shows them under the roll notes, and **中文 / Pīnyīn** switches script.
- **Edit notes on the roll** — the toolbar's **Edit notes** button makes the roll
  directly editable: drag a note to move it in time and pitch (snaps to the grid
  and to a bawu row), drag its right edge to change length, double-click empty
  space to drop a note, and **Del** removes the selected one. A second inspector
  row sets tie / slur / slide / bend / vibrato on the selection. Notes **sound as
  you click, drop and drag them** (one tone per row crossed) — the speaker button
  in the edit bar mutes that. Edits to a manual score save in place; edits to a
  picture-derived score are kept as the `data.adjusted` variant so the original
  transcription is never overwritten. Everything persists through the store's
  debounced save.
- **Blank sheet** — **Blank sheet** (empty state or roll toolbar) creates an empty
  manual score and drops straight into edit mode to build it up by hand.
- **Key & transpose** — F / G / C / A♯ reinterpret the same degrees onto the
  instrument; unplayable notes are flagged (dashed amber pills, fit indicator). Keys
  are canonicalised to sharp spellings (`canonicalKey` in `notes.js`): every pitch
  class has one name, so enharmonics (F♯≡G♭) compare by pitch, never by string. The
  score's imported key is marked **orig** and, when it isn't one of the four buttons,
  is added as its own button so it's always reachable after transposing.
- **Adjust** — the *Copy* / *Adjust* buttons on the key card serialise the current
  transposition to editable jianpu text (`scoreToJianpuText` ⇄ `parseManualJianpu`
  round-trip in `ai.js`, lossless including every expression mark: `/5` slide in,
  `5\` fall off, `5>` glide to next, `5=` tie, `5~` slur, `5(tr,bd-1,vb2)` tags).
  Hand-edit and **Save** writes a `data.adjusted`
  `{ key, bpm, timeSig, lines }` variant, selectable as **"1=&lt;key&gt; · adj"**
  alongside the transposition buttons; nothing persists unless you save.
- **Shift every note** — the ½ up / down stepper chromatically transposes all
  sounding notes by a semitone (`transposeData` in `notes.js`, keeping the key and
  re-spelling degrees + accidentals), saved straight into that same `data.adjusted`
  variant. Distinct from the F/G/C/A♯ buttons, which keep the degrees and change the
  key. Repeated clicks accumulate; the original transcription is never touched.
- **Takes** — the red button records the mic; takes are session-only (download to
  keep) and are never uploaded, by design.
- **Every AI conversion is stored** — the score row keeps the original picture in
  the `bawu` bucket plus `ai_meta` (model, usage, raw reply).
