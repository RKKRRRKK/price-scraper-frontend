# Bawu — practice aid (Tools)

A player aid for a bawu flute in **Chinese F** (筒音作5; the all-covered tube note
sounds concert **C4**, playable set **C4 D4 E4 F4 G4 A4 C5 D5** — no natural B).
Photograph Chinese jianpu or western notation (or type jianpu by hand), let AI turn
it into a practice roll that rises into a drawing of the instrument, and play
along with the mic listening.

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
- **Truncation is non-fatal.** Because each row is parsed on arrival, a
  `finish_reason: length` cut keeps every complete row; the player shows a
  "possibly incomplete" banner with **Continue** (a prefix-cached follow-up call
  via `continueTranscription` that resumes where it stopped), **Keep as is**, or
  **Discard**. `max_tokens` is 32000, so this is rare.
- **Expression marks are opt-in** (off by default). Asking for slurs, slides and
  bends in the same breath as the notes costs attention that is better spent on
  pitches and rhythms, and it widened the spread between models on clean printed
  scores. Turn it on in the import modal when a score really needs it, or add
  the marks by hand in Edit.

### Reading the reply

The model is asked for one JSON object per line, but models improvise:
pretty-printing across several lines, two objects on one line, the whole lot
wrapped in an array, a stray ```json fence. Splitting the stream on newlines
silently dropped every one of those, which came out as an empty score with no
explanation. `scanObjects()` in `ai.js` matches braces instead, so all of those
read, and a half-arrived object waits for the next chunk.

**Spelled-out field names.** The wire schema says `{"row":0,"notes":[{"degree":5,
"octave":0,"beats":1}]}`, not `{"i":0,"notes":[{"d":5,"o":0,"b":1}]}`. Single
letters are an odd, low-frequency shape to ask a model to emit and it showed in
the output. The *stored* shape stays short (`deg`, `oct`, `beats`); `normalizeLine`
and `normalizeMeta` are where the two meet, and both still accept the old
abbreviations so older replies and hand-written fixtures keep working.

**Two channels.** OpenRouter streams `delta.content` (the answer) and
`delta.reasoning` (the thinking) separately. Some providers put the *entire*
answer in the reasoning channel and never emit a content token — `x-ai/grok-4.5`
above `low` effort has been seen doing exactly this, trickling rows of JSON out
as "reasoning" at a few tokens a second until the request dies. So `runStream`
mines the reasoning channel too, but only while the answer channel is silent; if
content later starts, anything already taken from reasoning was scratch work and
is discarded (`onReset`).

That behaviour is a symptom, not the disease: a model that normally runs at
100 tok/s does not suddenly generate at three. The likeliest cause is routing —
OpenRouter falling back to a provider that can't honour the reasoning parameter
and emulates or ignores it. Two things guard against that now:

- `bawu-ai` sends `provider: { require_parameters: true }`, so a provider that
  can't honour what was sent is not eligible. If none can, the request fails
  immediately with a readable error instead of degrading silently. The client
  can override the whole object (e.g. `order: ['xai'], allow_fallbacks: false`).
- The stream panel shows the **provider actually served by**, the **resolved
  model**, and a live **tok/s** figure, so a reroute is visible in one run.

### When a run misbehaves

Everything on the wire is recorded and shown in the player. The stream strip's
**Details** button (or **Stream** in the header, afterwards) opens
`BawuStreamLog.vue`:

- **Log** — a live tail of the request, every keepalive, reasoning and content
  delta, each object parsed, each one that failed to, and the finish reason.
- **Prompt** — the exact text sent to the model, verbatim.
- **Request** — model, effort, prompt size, image size, the **OpenRouter request
  id**, upstream connect time, time to first byte, time to first *answer* token,
  and the object/row/failure counts. **Copy all** puts the lot on the clipboard.

The loader itself names the phase — sending, waiting, thinking, reading,
transcribing — with elapsed time, and turns amber with "stalled — nothing for
Ns" the moment the bytes stop. A stream that goes quiet for 150s is cancelled
rather than spinning forever.

Server side, `bawu-ai` logs the model, effort, prompt head and tail, upstream
status and latency, the OpenRouter id, and the byte/chunk totals as the stream
passes through (Supabase → Edge Functions → `bawu-ai` → Logs). It also closes
the stream itself at `BAWU_STREAM_DEADLINE_MS` (240s by default) with an
explanatory SSE error, so overrunning the platform's wall-clock limit reads as a
message instead of a socket going dead — which is also why an overrunning run
never appears in OpenRouter's dashboard: the generation is abandoned before it
completes, so no generation record is ever written.

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
| `src/views/BawuView.vue` | The whole tool: catalogue rail, mode bar, the deck, transport, original-score panel, key/transpose card. Owns the score, the playback loop and what an edit *means*; the deck owns where a gesture landed. |
| `src/components/bawu/BawuFluteRoll.vue` | The deck: a transverse bawu drawn across the top (reed end right) and a fingering roll climbing into it — one column per hole in bore order `6 5 4 · 3 2 1 · T`, a note drawn as seven bars (green = covered, grey = open). Scrolls itself, draws the mic trace, and carries the whole on-pane editing gesture set including the right-click menu. |
| `src/components/bawu/BawuImportModal.vue` | Add score: picture (drop/browse/paste, model + effort dropdowns → hands the stream to the player) or typed jianpu with live parse feedback. |
| `src/components/bawu/BawuLyricsModal.vue` | The lyrics pass: confirm what will run (pīnyīn, overwrite, model, effort, guidance) → watch it stream → review the alignment row by row → **Apply**. |
| `src/components/bawu/BawuStreamLog.vue` | The stream inspector: live wire log, the exact prompt that was sent, and request/timing/parse counters with the OpenRouter id. |
| `src/components/bawu/BawuJianpuStaff.vue` | The transcribed-jianpu sheet, shared by the docked panel and the phone reader: digits, octave dots, duration decorations, tie/slur arcs, slide and bend marks, lyric syllables. |
| `src/components/bawu/BawuJianpuEditor.vue` | Adjust modal: copy the current transposition's jianpu to the clipboard, hand-edit / paste it back, live parse + fit check, then save it as the score's `data.adjusted` variant. |
| `src/components/bawu/BawuTuner.vue` | Pop-up tuner: ±50¢ needle gauge, note name, Hz readout. Opens from the rail-foot card. |
| `src/lib/bawu/notes.js` | Fingering table, jianpu/key math (refDo per key), fit checking, coach hints ("lift finger 4"), `degOctAccOfMidi` (pitch → jianpu spelling), `readExpr` + `flattenScore`'s tie/slur resolution, `mergeLyrics`. |
| `src/lib/bawu/audio/` | The synth, split by job — `index.js` is the public face and the only thing anything imports. `context.js` the shared AudioContext · `params.js` AudioParam automation + easing curves · `tables.js` register-banked reed spectra, LFO shapes, noise · `reverb.js` the output bus (dry + **convolution hall** with early reflections and frequency-dependent decay, into a compressor) toggled from the transport · `expression.js` attack scoops, glissandi, bends, fall-offs, portamenti, the `vb` vibrato table · `voice.js` the modeled free-reed voice · `classic.js` the original sawtooth, kept for A/B · `handle.js` the live voice handle · `metronome.js` · `mic.js` the shared reference-counted mic · `pitch.js` autocorrelation tracking · `recorder.js` MediaRecorder takes. |
| `src/lib/bawu/ai.js` | Streaming conversion client (`convertImageStream`, `continueTranscription`, `convertLyricsStream`); `buildPrompt({ mode })` assembles the jianpu/western NDJSON prompt; SSE parser, `MODELS`/`EFFORTS`, manual jianpu parser/serialiser, type-0 MIDI export. |
| `src/lib/bawu/edit.js` | On-pane note editing: `dataToEvents` / `eventsToData` convert the stored `data` ⇄ an explicit-start, monophonic event list (de-overlap + rest-fill + bar chunking) that the roll drags around, dropping any tie/slur whose partner moved away. |
| `src/lib/bawu/image.js` | `toDataUri` / `urlToDataUri` — downscale a picture for the wire, shared by the import modal and the lyrics pass. |
| `supabase/functions/bawu-ai/index.ts` | OpenRouter proxy (Deno). `{ prompt, imageBase64, model, effort }` → streams the SSE reply straight through. Holds the key; adds CORS; forwards model + reasoning effort; logs the prompt and byte counts; returns OpenRouter's request id as `x-openrouter-id`; closes on a soft wall-clock deadline with a readable error. |
| `src/stores/bawu.js` | Pinia store: scores + folders CRUD, debounced JSONB saves, picture upload + signed URLs. |
| `supabase/bawu_schema.sql` | Tables, RLS, whitelist policy, `bawu` bucket + storage policies. |

## How it behaves

- **Modes** — *Follow me*: the song waits at the playhead until the mic hears the
  target note held for ~120 ms (Space advances manually). *Steady*: scrolls at the
  set BPM with metronome, optional synth. *Listen*: synth plays the piece.
- **The deck** — a **transverse** bawu is drawn across the top, held out to the
  player's right the way it is actually played: foot at the left, then the finger
  holes, then the **reed housing you blow across the side of** at the right-hand
  end (not an end-blown mouthpiece). The roll stands on its end beneath it —
  **one column per hole**, with notes **entering at the bottom and climbing into
  the instrument**. Each note is seven bars — **green where the hole is covered,
  pale grey where it is open** — and the holes on the instrument light up to
  match at the NOW line. You read the shape of the fingering, not a pitch row;
  the jianpu/western label, lyric and expression marks print in a gutter down the
  left, under the foot where the instrument has no holes.

  **The column order is the bore order**, left→right: `6 5 4 · 3 2 1 · T`. The
  thumb hole comes last because it is the one *nearest the mouth* — the last hole
  to open — so covering it alone sounds C5 and adding hole 1 gives A4, the very
  next note down. It is bored through the far side of the tube, so it is drawn
  low and ringed with a narrower column and almost no gap, which puts it right
  beside hole 1 where the thumb actually falls. The covered staircase therefore
  grows from the **reed end**, and pointing past the thumb means nothing covered
  at all.

  The holes are drawn as **cut-outs of the tube's silhouette**, not discs resting
  on it: each is a half-disc whose flat side lies along the edge it is bored
  through — the six front holes notch the **top** edge, the thumb notches the
  **bottom** — which is the shape the instrument presents when it is turned so
  the centred blow hole faces you.

  **Every size, shape and colour is a dial.** The block at the top of
  `BawuFluteRoll.vue`'s script holds the lot — spacing, hole width, tube
  geometry, type sizes, bar fill, the green/grey pair — and the stylesheet reads
  all of it through CSS variables, so retuning the look is a one-line edit there
  and nothing else.

  Colour says one thing and one thing only: **green is a covered hole**. So the
  note being played is *not* recoloured — it is called out by lighting the row it
  sits in, played notes simply fade, and where nothing sounds nothing is drawn,
  so a rest reads as the empty space it is. The lane is laid out top-down with
  beat 0 at the head.

  A hole column has a **ceiling**, so the three under one hand stay a hand's width
  apart rather than spreading with the window, and the gap between the hands is
  wider than any gap within one. The deck is capped and centred to match, with
  the `.desk` surround sunken so it reads as a sheet laid on a desk rather than a
  panel that failed to fill. Bars and holes are sized as a fraction of a column
  (capped first, so every bar comes out the same width even though the thumb's
  column is narrower) and shrink together once the deck gets tight.

  The one fact the geometry rests on: `BAWU_NOTES` is ordered high→low and the
  fingerings are a strict prefix chain (T, then 1, 2, … 6), so **a note's index in
  that table is the number of holes covered**. `BawuFluteRoll` calls that number
  the `level`, and it turns a pointer position, a menu choice and a drag delta
  into a pitch with no lookup table: *the column you point at is the last hole
  that stays covered.* Levels descend left→right across the columns, matching the
  bore.
- **It really scrolls.** The deck is a native scroll container, not a transform:
  the rAF loop drives `scrollTop` while the song plays, and the wheel drives the
  song while it doesn't — scrolling by hand moves the playhead with it, so the
  NOW line always means what it says. A cached last-painted position is what
  keeps the two from fighting. Notes and grid lines outside a few screenfuls
  aren't in the DOM at all (seven bars a note adds up), and the window re-centres
  in steps rather than every frame.
- **Mic trace** — a narrow ribbon beside the ruler, appearing only while the mic
  is on: pitch across, time *up* alongside the notes it is there to be compared
  against, with the target pitch as a red band. The heard
  *fingering* is also drawn as an amber ghost row at the playhead, so being one
  step off reads as one bar out of place; in follow mode a tip on the instrument
  says which finger to move.
- **Phone landscape keeps the old roll.** A short, wide screen reads a horizontal
  scrolling pitch axis far better than a standing one, so that layout still uses
  `paintRoll()` and the `.note` pills, with the **Scroll ⇄ Line** behaviour
  (sticky in `localStorage`, now without a toggle since the desktop deck always
  scrolls). **Scroll** slides the sheet leftwards under a pinned NOW line;
  **Line** holds the sheet still and sweeps the line across it, sliding one
  screenful at the right edge — in line mode the lane transform is only written
  on a page turn, which is what lets a CSS transition animate the flip.
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
  a glide has to start before the note it lands on.

  Every gesture is written in **cents onto one detune bus** that the oscillators
  *and* the body filter hang off, never in hertz onto `frequency`. That is what
  makes the bends and slides work: one eased curve moves the whole voice at once
  and the parts can't disagree, vibrato depth stays constant through a glide
  instead of drifting with the pitch, and a curve is free to sit at or cross
  zero. And a gesture is never only a pitch move — `expression.js` writes pitch,
  tone colour and a small level dip together, so a bend darkens, a fall-off
  closes down and goes breathy, and a slide pulls back at the join.
- **How they look** — arcs and diagonals can't come out of a stack of positioned
  pills, so the phone roll draws them as one SVG layer inside the lane
  (`buildFxPaths`, real pixels so the curves aren't distorted); the jianpu sheet
  wraps each linked run in an `.a4-grp` box with a CSS arc, and prints slide, bend
  and vibrato marks beside the digits. Stood on its end there is nowhere for an
  arc to go, so the deck prints the marks as **glyphs beside the label**
  (`⟋ ⟍ → ↗1 〜 ⌣ ⌢`) and runs a **spine** down the gutter edge of a tied or
  slurred note — the halves touch, so it reads as one unbroken line.
- **Note names** — the toolbar's **1 / C** toggle relabels every note in the
  gutter between the jianpu digit and its western pitch name (e.g. `5` ⇄ `C5`),
  **and the instrument with it**: each hole is tagged with the note it *makes* —
  the one that sounds when it is the last hole still covered — so the tags read
  `5̣ 6̣ 7̣ · 1 2 3 · 5` or `C4 D4 E4 · F4 G4 A4 · C5`. The hole's own number stays
  in its tooltip.
- **Lyrics** — when a score carries `ly`/`py` syllables they print under the
  numbers in the transcribed-jianpu panel; the toolbar's **Lyrics** toggle also
  shows them under the roll notes, and **中文 / Pīnyīn** switches script.
- **Edit notes on the deck** — the toolbar's **Edit** button makes the roll
  directly editable:
  - **Right-click** anywhere for the note menu: eight pitches, each with its own
    little fingering diagram, and the length presets. On empty space a pitch drops
    a note there; on a note it changes that note, and **Delete** removes it.
    Picking a length on empty space only sets the default and leaves the menu up,
    so length-then-pitch is one gesture.
  - **Double-click** a column to drop a note without the menu — the column you
    click is the last hole that stays covered.
  - **Drag** a note: up and down moves it in time, left and right points at the
    hole the fingering should stop at. Everything selected travels together.
    Drag a note's **bottom edge** (its end, since the lane runs top-down) to
    change its length.
  - **Drag on empty space** to box-select; **1–7** step-insert at the cursor;
    **↑↓** move the selection's pitch, **←→** its length, **Del** removes it.

  A second inspector row sets tie / slur / slide / bend / vibrato on the selection,
  and the **holes on the instrument are piano keys** — press one to hear what
  covering down to it sounds like. Notes **sound as you click, drop and drag them**
  — the speaker button in the edit bar mutes that. Edits to a manual score save in place; edits to a
  picture-derived score are kept as the `data.adjusted` variant so the original
  transcription is never overwritten. Everything persists through the store's
  debounced save.
- **Blank sheet** — **Blank sheet** (empty state or the rail) creates an empty
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
