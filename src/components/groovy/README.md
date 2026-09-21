# Groovy

Metronome, timing trainer and a small bass amp. Tools → Groovy, route `/groovy`.

You plug a bass into the interface, set a tempo and a grid, and play. The app
tells you how far off each note was, in milliseconds, in real time — and keeps
recorded takes so you can find out whether last week's practice actually did
anything.

---

## The one idea

Everything rests on a single fact: **the click and your notes are timestamped
against the same clock.**

The metronome is not played "now" — it is *scheduled* at an exact
`AudioContext` time by a lookahead scheduler. The attack detector runs inside an
`AudioWorklet`, which sees every 128-sample block and reports an onset at an
exact `AudioContext` time too. Subtracting one from the other is therefore a
real measurement, not an estimate built out of `setTimeout` and hope.

That is also why the detector is a worklet and not an `AnalyserNode` polled from
`requestAnimationFrame`. rAF fires roughly every 16 ms, which is the same order
of magnitude as the errors being measured — you cannot measure a 12 ms rush with
a 16 ms ruler.

**Sign convention, everywhere in this tool: negative is early (rushing),
positive is late (dragging).** The roll, the live readout, the stats and the
stored rows all agree.

---

## Files

### `src/lib/groovy/` — the engine, no Vue

| File | What it owns |
|---|---|
| `context.js` | The shared `AudioContext` (`latencyHint: 0` — the smallest buffer the device offers) |
| `bus.js` | Click/drum output gains, plus the cached noise buffer |
| `grid.js` | Meters, subdivisions, counting syllables, drum patterns |
| `click.js` | The metronome voice, at four weights |
| `drums.js` | Kick, snare, closed hat |
| `transport.js` | The lookahead scheduler and the grid it hands out |
| `input.js` | Device + channel selection; the single mono tap |
| `amp.js` | The bass amp chain |
| `calibration.js` | The latency measurement's own click train |
| `probe.js` | The loopback test's pulse, shaped like a plucked note |
| `onsetWorkletSource.js` | The detector, as source text (see below) |
| `onset.js` | Loads that worklet and wraps it in callbacks |
| `pitch.js` | Bass-range pitch tracking, for the roll only |
| `analysis.js` | Deviations → statistics |
| `recorder.js` | Optional audio capture for a take |
| `index.js` | Barrel + the map of all of the above |

### `src/components/groovy/` — the UI

| File | What it draws |
|---|---|
| `GroovyRoll.vue` | The scrolling practice surface (canvas) |
| `GroovyInputSetup.vue` | Device, channel, detector tuning, calibration |
| `GroovyAmp.vue` | The amp panel |
| `GroovyTakeCompare.vue` | Tiles, histograms, per-position chart, table |

Plus `src/views/GroovyView.vue` (layout + all the wiring),
`src/stores/groovy.js` (takes in Supabase, practice settings in localStorage)
and `supabase/groovy_schema.sql`.

---

## The grid

A **pulse** is what the main click lands on: the quarter in simple meters, the
dotted quarter in compound ones. **`bpm` always counts pulses per minute**, so
6/8 at 60 is one dotted quarter a second — the way you would set a hardware
metronome, not one eighth a second.

A **slot** is the finest line on the grid: one pulse divided by `subdiv`. The
click, the roll's gridlines and the onset matcher all speak in slots, so they
cannot quietly disagree about where a beat is.

```
4/4,  subdiv 4  →  pulses 4, slots/bar 16, counted  1 e & a  2 e & a …
6/8,  subdiv 3  →  pulses 2, slots/bar  6, counted  1 la li  2 la li
```

Drum patterns sit on their **own** grid (`patternRes` steps per pulse:
sixteenths in simple meters, six-per-dotted-quarter in compound), so changing
the click from eighths to sixteenths does not rewrite the groove. The scheduler
walks a single fine grid — `lcm(subdiv, patternRes)` steps per pulse — and asks
at each step whether it is a click slot, a drum step, or both.

### Segments

The transport keeps the grid as a list of **segments**: stretches of constant
tempo/meter/subdivision, each with an origin. The time of any slot is exactly
`origin + index * slotSec`, so there is no accumulated drift and no array of
timestamps to run out of.

Changing tempo while running opens a new segment on the **next downbeat** rather
than lurching mid-bar, and the old segment stays around, so a note played
*before* the change still matches against the grid it was actually played to. A
change that is queued but not yet reached gets superseded rather than stacked —
otherwise dragging the tempo slider would queue one segment per pixel.

---

## The detector

`onsetWorkletSource.js` holds the processor **as a string**, handed to
`audioWorklet.addModule()` through a Blob URL. A worklet module is loaded by URL
at runtime rather than bundled, so shipping it as a separate file would make
correctness depend on how the bundler chooses to emit and serve it. A Blob
behaves identically in dev and in the built site, with no build configuration.

The algorithm is an envelope-ratio onset detector on a high-passed band:

- a **fast** envelope (0.5 ms attack) tracks the transient
- a **slow** envelope (80 ms attack, 300 ms release) is the local reference
- an onset fires when `fast > slow × ratio`, above an absolute gate, **and** a
  low band (≈200 Hz) also has energy
- on firing it walks *back* through a ring of recent envelope values to the foot
  of the attack, so the reported time is when the note started rather than when
  it got loud enough to notice

The low-band requirement is what separates a plucked note from fret buzz, a
string squeak or a pop in the cable — all transients with nothing underneath
them. Playing very high up the G string pushes the fundamental toward the corner
of that filter; `lowGateFactor` in the worklet loosens the requirement if that
ever starts costing notes. (It also rejects a metronome click arriving through
an open microphone, but on a DI'd instrument no such path exists — see
*Monitoring* below.)

### Tuning it

| Control | What it does | When to move it |
|---|---|---|
| **Gate** | Absolute floor on the transient band | Set it just above the "background" mark on the live bar |
| **Sensitivity** | The `fast > slow × ratio` threshold | Up if soft notes are missed; down if the tail of a note retriggers |
| **Min gap** | Refractory period | Down for fast sixteenths; up if one note registers twice |

---

## Latency and the offset

Between the interface, the OS and the browser there is a fixed delay that would
otherwise read as a constant "you drag by 20 ms". The **offset** is subtracted
from every hit before it is matched.

### Why calibration has its own click train

This is the subtlest bug in the tool, and it bit in the first week, so it is
worth understanding before touching `calibration.js`.

Matching a note to the nearest grid line can only ever measure a delay **smaller
than half the gap between lines**. Anything larger wraps onto the next line and
comes back as a small number — and the small number looks entirely plausible,
which is what makes it dangerous. A real 430 ms round trip, measured against a
90 bpm eighth-note grid, reports a tidy and completely fictional **96 ms**.

So calibration does not use the practice grid at all. It stops the metronome and
runs its own train: one click every 1.2 s, spaced so that any latency a browser
can plausibly produce still lands nearer its own click than the next.

The match window is also **asymmetric**, which doubles the usable range again.
Round-trip latency is physically positive — you cannot react to a click before it
has sounded — so a note arriving long after its click is expected, while one
arriving *well* before it is not a fast player but an alias from the next click.
Allowing 80 ms of anticipation and giving the rest of the interval to the late
side yields an unambiguous **−80 … +1120 ms**. Verified across that whole range;
recovery error is the human jitter and nothing else.

The result is reported through `estimateLatency()`, which drops the first two
notes, takes a median, and rejects outliers against the MAD rather than the
standard deviation (sd is itself wrecked by the outliers it is meant to find).
The panel draws every individual reading as a dot so a scattered run is visible
rather than merely asserted, and flags a result that lands near the edge of what
the train can resolve.

### The loopback test

The click-train calibration measures the round trip *including you* — your ears,
your reaction, your hands. That human contribution is typically ±10 ms and is
why a run can come back with only half its notes usable.

The loopback test removes the human. The app plays a pulse and listens for its
own pulse returning through the interface's loopback, so what comes back is the
machine alone.

**Chrome only exposes the first two channels of a multichannel interface;
Firefox exposes all of them.** Measured on a Scarlett 4i4, which Windows
presents as a six-channel capture endpoint: Chrome's picker shows Input 1–2 and
refuses `applyConstraints({ channelCount: { exact: 6 } })`, while Firefox lists
all six.

So **run the loopback test in Firefox** — the interface's own loopback appears
as a selectable channel and no cable is needed. In Chrome the loopback sits on a
channel it cannot reach, and the workaround is a physical cable from an output
back into input 1 (see below), or routing loopback onto inputs 1–2 if the
interface can do that. The 4i4 cannot: its routing page assigns mixes to outputs
only.

Worth noting what this *doesn't* explain: Chrome converting 6 channels down to 2
was a good suspect for the input latency, and Firefox getting all six natively
with no conversion is ~6% *slower*. Channel conversion is not the cost.

Not every interface can do that. The Scarlett 4i4's routing page assigns mixes
to outputs only — its loopback is a fixed virtual input on channels 5–6, which a
browser cannot reach at all. Where that is the case, **a physical cable is the
better answer anyway**: send a mix to an analogue output, patch it into input 1,
set that input to line level, and run the same test. It measures everything the
digital path does *plus* the converters, which is the whole round trip and not a
shortcut through it.

It reuses `CalibrationRun` through its `voice` hook — the asymmetric matching
was fiddly enough to get right once. What it does *not* reuse is the metronome
click, which the onset detector would reject outright: the detector fires on a
transient above 350 Hz but only when a band below ~200 Hz also has energy, and a
click is all treble. `probe.js` therefore builds a pulse shaped like a plucked
note — a low body for the gate, a bright tick for the transient — with an attack
as close to a step as an oscillator manages, so the detector's backtracking has
a sharp foot to find. The detector is also temporarily retuned for it
(`PROBE_DETECTOR_CONFIG`) and put back afterwards, without touching prefs.

**The number it reports that matters is the jitter, not the round trip.** The
round trip is subtracted away and costs nothing however large it is; jitter is
the noise floor beneath every measurement the tool makes. Under ~5 ms is clean.
The blind spot is the converters either side of the analogue world, worth a
millisecond or two.

### What it actually measures

It absorbs your own resting bias along with the system's latency. If you
deliberately sit behind the beat, calibrating will zero that out. The manual
controls are there for exactly that reason — calibrate once to get in the right
neighbourhood, then nudge it if you would rather keep your feel and see it
reported.

The number is **typed** in the field beside the label, because the numbers that
belong there are measured ones and no slider lands on 269.1 by hand. It takes
anything from −100 to 1200 ms, commits on Enter or on leaving the field, and
puts the old value back if it is emptied. The slider under it is the coarse
control for exploring a value; it reaches 600 ms, and stretches further when
the field already holds more, so dragging can never silently truncate a
measured number.

One implementation note, because it produced a field that could not be typed
into at all: this panel re-renders about fifty times a second, since the level
meter is a live prop, and Vue re-syncs an input's DOM value from its binding on
every render. A binding that does not track each keystroke therefore erases
each keystroke ~20 ms after it lands. The field is `v-model`-bound to a draft
string, and only parses on Enter or blur.

### The offset is per-session, and that is not negotiable

Measured on a Scarlett 4i4: **five loopback runs in one session returned 299 ms
every time, with zero jitter. Reloading the page changed the number.** The
browser negotiates its buffer depth when the input stream opens and then holds
it exactly; a different open lands 60–80 ms away.

So **the offset is not remembered across loads.** `loadPrefs()` restores every
other setting and forces `offsetMs` back to zero. An offset restored from
`localStorage` describes a stream that no longer exists, and it looks exactly
as trustworthy as a real one, which is the dangerous part.

There was a whole apparatus for this once: a session counter, a staleness
computed, a warning paragraph in the panel, a toast when arming a take, and an
`offsetVerified` flag written into every take. All of it existed to explain why
a remembered number might be a lie. Not remembering it is shorter, and nobody
has to read a warning to be safe. Old take rows may still carry
`offsetVerified`; nothing reads it.

The workflow this implies: **open the input, measure, then practise.** Within a
session everything is exact.

### When the delay itself is the problem

Calibration removes a *constant* delay from the measurements; it does nothing
about the delay you can hear while playing. Under about 120 ms that is a browser
being a browser. Past ~200 ms something is misconfigured:

1. **Chrome renders to the Windows default playback device**, whatever you are
   recording from. If that is not the interface, you inherit its latency *plus*
   a drift buffer, because capture and playback are then running off two
   different clocks. Make the interface the default for **both** directions.
2. **Sample-rate mismatch.** `openDevice()` now rebuilds the AudioContext at the
   capture device's rate when they disagree — a context's rate is fixed at
   construction, so the only way to change it is to replace it. The setup panel
   still shows the rates in case the OS is forcing a conversion of its own.
3. **Bluetooth headphones** add 150–300 ms and cannot meaningfully be
   calibrated away.

**The interface's ASIO buffer size is irrelevant here.** Browsers reach the
sound card through WASAPI, not ASIO; setting the Focusrite to 16 samples changes
nothing a browser can see. This surprises everyone, including whoever wrote the
first version of this file.

### Measured on a Scarlett 4i4 — don't repeat this investigation

~300 ms round trip, and it was chased to the end. Eliminated, each by
measurement rather than reasoning:

| Suspect | Result |
|---|---|
| Chrome vs Firefox | 290 ms vs 309 ms — two unrelated backends, same answer |
| Capture path (raw / default / WebRTC-processed) | 305.5 / 306.8 / 308.8 ms — no difference |
| ASIO buffer 16 vs 1024 | Inside run-to-run noise |
| Sample rate, Windows enhancements, spatial sound, exclusive-mode priority, default device | All already correct |
| USB port / cable / converters | ASIO loopback on the same hardware is fast |

Within one stream the figure is *perfectly* deterministic — eight consecutive
runs returned 299 ms with ±0.0 ms jitter. Reopening the stream moves it a few
ms; reloading the page moves it more, and the output half is where that wander
lives (`outputLatency` drifted 75→82 ms while the input half held still).

Then the measurement that settled it — Windows' own WASAPI numbers, read
directly with no browser in the way:

| | Windows reports | Measured in-browser |
|---|---|---|
| Output buffer | 22.0 ms | ~80 ms |
| Input buffer | 22.0 ms | ~210 ms |
| Device (driver-declared) | 5.8 ms | — |
| **Round trip** | **~50 ms** | **~290 ms** |

So the OS and the interface are capable of ~50 ms and the browser layer adds
~240 ms. Two further attempts to get at it:

- `--audio-buffer-size=480` — verified to reach the `audio.mojom.AudioService`
  process, and changed nothing. Chrome ignores it for this device.
- A second probe read capture frames via `MediaStreamTrackProcessor` in a
  Worker, skipping Web Audio's MediaStream bridge entirely, and reported its
  own round trip beside the worklet's. The direct path came back ~170 ms
  **slower** even after a timebase bug of mine was corrected.
  `MediaStreamTrackProcessor` is built for transcoding, not low latency; its
  stream queuing costs more than the bridge it avoids. **There is no faster
  input path available to us in the browser.** The probe and its panel are
  deleted: the question is closed, and a second round-trip number with no
  explanation attached was only ever going to be read as a fault.

The capture-path picker went the same way. It offered four different
`getUserMedia` requests on the theory that which one is fastest is a property
of the driver. Measured, they agreed within a few milliseconds. The variable
that mattered was the Windows driver, which no constraint in a browser can
reach.

### SOLVED: it was Focusrite's WDM driver

Replacing Focusrite's Windows driver with **Microsoft's built-in USB Audio 2.0
class driver** (`usbaudio2.sys`) took the round trip from **~290 ms to 92 ms**,
jitter unchanged at ±0.0 ms.

The mechanism, confirmed by `IAudioClient3::GetSharedModeEnginePeriod` before
and after:

| | Focusrite WDM driver | USB Audio 2.0 class driver |
|---|---|---|
| Capture min shared-mode period | 10 ms (= default, none) | **7 ms — low-latency available** |
| Chrome's reported capture frame | 10.0 ms | **7.0 ms** |
| Round trip | ~290 ms | **92 ms** |

When a driver won't do low-period capture, Chromium falls back to a padded
multi-packet FIFO sized to never glitch — which is where the ~200 ms lived. It
is invisible to every browser-side control, which is why nothing tried in the
browser moved it.

The cost of the fix is Focusrite Control 2: no software mixer, no Loopback, no
software monitor routing, no ASIO. Hardware monitoring on the unit still works.
Revert by reinstalling Control 2.

Corroborating evidence gathered along the way: the same app on **macOS has no
perceptible delay at all**, and macOS drives this interface with its own USB
audio class driver — no vendor driver involved. That was the clue that the
Windows vendor driver was the variable.

**Method note for anyone tempted to repeat the investigation:** the thing that
finally identified it was querying `IAudioClient3` per endpoint, not
`IAudioClient`. The latter reports the device period; only the former says
whether *low-latency shared mode* is available, which is the property that
actually decides which Chromium capture path is used.

It also does not matter much. Zero jitter means the offset removes it exactly,
and monitoring feel comes from the interface's direct monitor, not from here.

---

## Reading the roll

The now-line sits at 72% rather than at the right edge, so the next beat is
visible on its way in and you can aim at it.

- **Pitch lane** — the note you are playing, as a trace, with a dot at each
  attack, joined back to the grid line it was aiming at. Open strings are drawn
  as faint rules. The dot's vertical position is filled in ~130 ms after the
  timing tick appears, because the pitch tracker needs a moment of steady note
  before it can say anything; the timing tick, which is the part that matters,
  is immediate.
- **Timing lane** — one tick per attack at its grid line, as tall as the error.
  Up is early, down is late. The shaded band is the tolerance window.

Colour carries exactly one thing: which side of the beat you were on. Blue is
early, red is late. "In the pocket" is conveyed by the band rather than by
recolouring the marks, so hue never has to mean two things at once.

---

## Monitoring

With an instrument on a cable — a bass into a Focusrite, which is what this was
built for — there is **no feedback path**. The click leaves through the
headphone or monitor output; the bass arrives through the jack. Nothing the
speakers do can reach the detector. Monitor out loud if you like.

The warning in the amp panel exists for the other case: an acoustic input. If
you ever point a microphone at a cab, or fall back to the laptop's built-in mic,
speakers put the metronome straight into the detector, which scores it as
immaculate playing. `looksLikeBuiltInMic()` in `input.js` is the heuristic, and
it strips Chrome's `Default - ` / `Communications - ` label prefixes first —
without that, selecting your interface as the *system default* would make it
look like a built-in mic and warn you for nothing.

The one way to do it to yourself on a cable is to feed the output back to the
input: select a **loopback channel** as the input, or let Windows expose the
interface with more output channels than it has physical ones so a loopback lands
where you expected input 1. Both produce a rising howl rather than a subtle
problem. `onLevel()` in the view watches for it — a pinned input that stays
pinned for a second while we are also driving the output is not playing, and the
monitor is cut automatically.

### The native helper (Windows)

`native/groovy-monitor/` is a small .NET 8 process that runs this same amp
chain natively and carries the monitor path on **ASIO** (when the interface's
own driver is installed) or on **WASAPI's low-latency shared mode** (on the
Microsoft class driver). Measured on the 4i4 with the class driver: 7 ms
periods on both endpoints, about 22 ms in to out — a third of the browser's
70–90 ms, and shared mode, so the browser keeps its own streams on the same
interface for the click and the detector. ASIO on the vendor driver should
land under 10 ms; that path compiles but is untested until the driver is
back.

```
cd native/groovy-monitor
dotnet build -c Release
bin/Release/net8.0-windows/groovy-monitor.exe --list
bin/Release/net8.0-windows/groovy-monitor.exe --device Scarlett     # WASAPI, or ASIO if a driver exists
```

Then open Groovy. The amp panel finds the helper on `ws://127.0.0.1:47391`,
shows **Native · WASAPI · 309 frames · ~22 ms**, mutes the browser's own
monitor path and mirrors the knobs over the socket
(`src/lib/groovy/nativeMonitor.js`). Close the helper and the panel falls back
to the browser amp on its own. The **On/Off** button stops the panel looking
for it. Only Windows looks; a Mac has nothing to gain.

Two buttons on that row answer the two questions worth asking:

- **Test** makes the helper play a quarter-second tone from its *own* output,
  whatever the monitor switch says. Hearing it proves the native path reaches
  the speakers — the badge alone only proves the socket is up.
- **Measure** runs the helper's loopback test: six pulses out of its output,
  timed back in at its input, reported as a median and a jitter. It needs the
  same physical loop as the browser's loopback test — a cable from a Scarlett
  output into input 1 at line level, or the Loopback channel once Focusrite's
  driver is back — and you should not play during it. The result replaces the
  estimate in the badge and lands in *Recent measurements* next to the
  browser's own figures, which is the comparison that matters. With nothing
  looped back it reports "0 of 6 pulses" after about seven seconds.

Timing never touches the helper. The click, the detector and the takes stay on
the `AudioContext` clock exactly as before; the helper only carries what you
hear. Its input channel is picked on its own command line (`--in-channel`),
not in the panel, because it opens the interface itself.

Origins are checked: the helper accepts the app's own hosts and localhost, and
refuses any other page that tries the socket. Add a host with `--origin`.

### You will hear the bass twice

This is the most confusing thing about the tool, so it is worth stating plainly.
There are **two** paths to your ears:

| Path | Latency |
|---|---|
| The interface's own **direct monitor** | Effectively zero |
| **This amp** — in, through the browser, back out | The measured round trip |

With both on, a single plucked note arrives twice, and the second arrival is
easy to mistake for "the app has half a second of lag". Pick one:

- **Direct monitor on, amp muted** — best feel, and the honest recommendation.
  No browser will beat an interface's analogue path, and the timing measurements
  do not care what you are listening to.
- **Direct monitor off, amp on** — if you want the amp's tone, and can live with
  the round trip.

### Getting that right on the interface

On a Focusrite (Control 2, and most interfaces work the same way), the mix sent
to your speakers or headphones is a blend of two kinds of strip:

| Strip | What it is |
|---|---|
| **Analogue 1 / 2** | Your bass, straight through. The direct monitor. |
| **Playback 1-2** | Everything from the computer — this amp, *and the click*. |

So "turn off direct monitor" means **pull the Analogue fader down**, not untick
Headphones under the mix's destinations. Unticking the destination removes the
whole mix from that output and you lose the metronome along with everything
else — which looks exactly like the app having broken, because the input meters
carry on moving happily. Output routing has no bearing on capture.

Whatever else you do, **Playback has to stay up**: the click and drums arrive
that way, and without them there is nothing to practise against and nothing to
calibrate with.

One thing to avoid: routing a mix to **Loopback** while also selecting the
loopback channel as Groovy's input. That is the output-into-input path described
above, and it howls.

---

## Takes

A take stores three things: the grid it was played to (`settings`), every
attack (`hits`), and the derived numbers (`stats`, denormalised so the
catalogue can draw a list without re-deriving a standard deviation from a few
hundred hits). Audio is optional per take, via the "Keep audio" toggle, and goes
to the private `groovy` bucket.

Full shapes are documented at the top of `supabase/groovy_schema.sql`.

**The number to practise against is the spread, not the mean.** A consistent
15 ms behind the click is a feel; 15 ms of scatter either side of it is a timing
problem. The analysis panel leads with standard deviation for that reason, and
`analysis.js` → `grade()` puts words to it (Locked / Tight / Loose / Scattered).

Up to three takes compare at once. That cap is not arbitrary: the compare chart
is an all-pairs form, and three is as far as the categorical palette clears the
colourblind-separation floor. Selection uses fixed slots, so deselecting the
second take does not slide the third into its colour.

Position-by-position comparison is only drawn when the takes share a grid — the
fourth sixteenth of 4/4 is not the fourth eighth of 6/8, and pretending
otherwise would be a lie. Spread and feel still compare fine across grids, and
the table always shows everything.

---

## Setup

1. Run `supabase/groovy_schema.sql` in the Supabase SQL editor (these tables are
   created by hand, like the app's other tools).
2. Open Tools → Groovy, press **Enable audio input**, grant the permission.
3. Pick the interface and the channel the bass is on. Device labels are blank
   until permission has been granted once, which is why the first open uses the
   default device.
4. Calibrate.

Keyboard: **Space** starts/stops the count, **R** records a take.

---

## Gotchas

- **Speakers are fine on a cable**, and a trap on a microphone. See
  *Monitoring*.
- **Browser DSP must stay off.** `input.js` disables echo cancellation, noise
  suppression and AGC — all three move the signal around in time and level,
  which is the thing being measured. Do not "helpfully" re-enable them.
- **The pitch tracker is display-only.** No timing decision anywhere reads it.
- **`bpm` counts pulses, not eighths**, in 6/8 and 12/8. See above.
- **Changing the meter coerces the subdivision** (`coerceSubdiv`) — 3/4 at
  triplets moving to 6/8 falls back to eighths, because compound meters have no
  triplet option.
- **The amp's monitor path is muted by default** and ramps rather than
  switching; an instant unmute on a loud input pops.
