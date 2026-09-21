# Groovy: why a native audio path is being considered

Background for anyone picking up the idea of an Electron build with a native
(ASIO or WASAPI-exclusive) audio path. This is what was measured and concluded,
not a plan.

## The app

Groovy is a metronome, bass timing trainer and small amp, at Tools → Groovy
(`/groovy`). Engine in `src/lib/groovy/`, UI in `src/components/groovy/`, full
design notes in `README.md` in that folder.

It works by scheduling the metronome click at an exact `AudioContext` time and
detecting played notes in an AudioWorklet on that same clock, so the difference
between them is a real measurement. A fixed latency offset, measured by a
loopback test, is subtracted from every hit.

It runs in the browser and is used on both macOS and Windows.

## What we measured

On Windows, a Focusrite Scarlett 4i4 4th Gen:

| Configuration | Round trip | Jitter |
|---|---|---|
| Web Audio, Focusrite's WDM driver | ~290 ms | ±0.0 ms |
| Web Audio, Microsoft's `usbaudio2` class driver | ~70 ms | ±0.0 ms |
| Windows WASAPI shared-mode floor (`IAudioClient`, no browser) | ~50 ms | — |
| ASIO, same hardware | 1–15 ms | — |
| Web Audio on macOS | no perceptible delay | — |

The 290 → 70 ms drop came from replacing Focusrite's Windows driver with
Microsoft's USB Audio 2.0 class driver. `IAudioClient3::GetSharedModeEnginePeriod`
showed Focusrite's driver advertising no low-latency shared-mode capture period
(min == default == 10 ms) where the class driver reports 7 ms; without it
Chromium falls back to a padded multi-packet FIFO. Cost of that fix: no
Focusrite Control 2, so no software mixer, no loopback, no ASIO.

Things that were tested and made no difference: Chrome vs Firefox, three
different `getUserMedia` capture paths, `--audio-buffer-size`,
`--enable-exclusive-audio`, `--disable-features=AudioServiceOutOfProcess`
(all verified to reach the audio service process), `latencyHint`, sample rates,
channel counts, `MediaStreamTrackProcessor`, and a full audit of the machine's
audio stack (APOs, middleware, DPC latency, power, MMCSS, drivers — all clean).

## Where that leaves things

Timing measurement is exact and unaffected by the latency. Jitter is ±0.0 ms and
the offset cancels the constant, so every millisecond the app reports is the
player's, whatever the round trip happens to be.

Monitoring is the part that suffers. At 70 ms, playing while listening through
the app's amp puts the player's own note ~70 ms behind the click they are
playing to, which is well past the ~20–30 ms where delayed auditory feedback
starts disrupting timing. The workaround today is the interface's analogue
direct monitor with the app's amp muted — which works, and costs nothing except
that the amp's tone is unavailable while playing.

Note that the click's own latency is harmless: the player hears the click late
and their own note instantly, so the gap they perceive is their true error.

## Why native is on the table

To make the app's amp usable while playing on Windows. That is the only thing it
would buy — monitoring latency low enough to play through.

An Electron shell on its own would not help, since it carries Chromium's audio
stack with it; the value would be entirely in a native audio path alongside it.

The web version stays primary — it is used on macOS, where none of this is a
problem — so any Windows-native path would need to coexist with it rather than
replace it.

---

## Assessment (20 Sep 2026)

State of the machine when this was written, read from Device Manager rather
than remembered: the 4i4 is on Microsoft's `usbaudio2` class driver, and
`HKLM\SOFTWARE\ASIO` is empty. The ASIO row in the table above was measured
with Focusrite's driver installed; today there is no ASIO on this machine at
all. That splits the question in two, because what a native path can reach
depends entirely on which driver is installed.

### With the class driver (today)

The only native API is WASAPI, in one of two modes.

- **Exclusive mode** gets the small buffers — round trips around 10 ms are
  typical for a USB Audio 2.0 device on the class driver — but exclusive means
  exclusive: the endpoint is taken away from every other process, the browser
  included. Groovy needs the *capture* endpoint for detection and the *render*
  endpoint for the click, so an exclusive helper would have to take both, and
  then the whole engine (click scheduling, onset detection, matching) has to
  move native with it. That is a second engine to keep in step with the web
  one. Not worth it.
- **Shared mode at the low-latency period**
  (`IAudioClient3::InitializeSharedAudioStream` at the 7 ms minimum the class
  driver advertises) coexists with the browser. Expect roughly period in +
  period out + engine + device: on the order of 20–30 ms round trip. Under the
  browser's 70 ms, but sitting right on the threshold where delayed feedback
  starts to bite. A fair amount of work for "maybe playable".

### With Focusrite's driver reinstalled

ASIO comes back (1–15 ms measured), and Focusrite's Windows driver is, as far
as can be told without it installed, multi-client — ASIO and WDM open at the
same time, provided the sample rates agree. This is the configuration in which
a native path actually delivers the goal:

- A small helper opens the interface over **ASIO** and runs only the amp: bass
  in → DSP → the interface's outputs (speakers here; a DI'd bass has no
  feedback path, so speakers are fine), at ASIO latency.
- The browser keeps **everything else** — click, detection, grid, takes — on
  WDM shared mode, back at ~290 ms round trip. That is harmless for the reasons
  already given above: the jitter was ±0.0 ms on that driver too, the offset
  cancels the constant, and the click's own lateness never enters the
  measurement. The one visible cost is that the roll's ticks appear ~200 ms
  later than they do today. Focusrite Control 2 also comes back, so the
  loopback channel is selectable again (in Firefox).

**Verify this before building anything:** with Focusrite's driver installed,
open any ASIO application and play browser audio at the same time. If both
sound, coexistence is confirmed. If they fight, this route is dead and the
class-driver shared-mode helper above is what is left. Five minutes, and it
decides everything.

### What the helper is

Not an Electron app. A separate, tiny, Windows-only process that the web app
talks to.

- Rust with `cpal` (ASIO behind its `asio` feature; needs the Steinberg ASIO
  SDK on the build machine — the licence allows shipping binaries, not the
  SDK), or C++ with JUCE or RtAudio, which put ASIO and WASAPI behind one
  device API. The amp chain is seven trivial stages (`amp.js`): a few hundred
  lines either way.
- A WebSocket on `127.0.0.1`. The amp panel becomes a remote control: when the
  socket connects, the browser mutes its own Web Audio monitor path, sends the
  knob values as JSON, and marks the monitor as native. When the socket is
  absent — every Mac, and any Windows machine without the helper — nothing
  changes.
- Timing stays entirely in the browser. The helper never learns what a click
  or a grid is.

One thing to test on day one: Chrome has been tightening access from public
HTTPS sites to `localhost` (Private Network Access, then Local Network
Access). Expect a one-time permission prompt; if it turns out to be a hard
block in the browser in use, the helper has to serve a locally trusted
certificate instead of plain `ws://` — a nuisance rather than a blocker.

### Built (20 Sep 2026): `native/groovy-monitor`

C# on .NET 8. NAudio drives ASIO through the driver's own COM vtable, so no
Steinberg SDK is needed; the WASAPI side is written directly against
`IAudioClient3` so it gets the low-latency shared-mode period that
`IAudioClient` (and NAudio's wrapper of it) never asks for. The amp is a
stage-for-stage port of `amp.js`; the control surface is a hand-shaken
WebSocket on `127.0.0.1:47391` with an origin allow-list. Usage is in
`README.md` under *Monitoring*.

First run on this machine, class driver, shared mode:

| | |
|---|---|
| Endpoint periods | 309 frames = 7.0 ms, both directions (the driver's minimum) |
| Estimated in → out | ~22 ms (capture period + one period in the ring + render period + converters) |
| Dropouts | none after the render buffer pre-fill was added |
| Coexistence | two helper instances plus the browser on the same endpoints at once, all fine — shared mode does what it says |

The 22 ms is an estimate from the period sizes. The helper has its own
loopback test (**Measure** in the amp panel) for the real number; it needs the
output cabled back into input 1, which was not connected when this was
written, so the measured figure is still to come.

Rust was the first choice and lost on logistics: no compiler on the machine,
and cpal's ASIO backend needs the MSVC build tools, LLVM for bindgen and the
Steinberg SDK before it will even compile, with nothing here to test it
against. The .NET route is one 200 MB install and an ASIO path that other
people already run in anger.

**ASIO, first run (later the same day, Focusrite driver reinstalled):**
`Focusrite USB ASIO`, 48 kHz, 256-frame buffer (5.3 ms), ten seconds, zero
dropouts. The driver reports 13.9 ms each way at that buffer, which is its
safety padding around the buffer; the buffer size itself is set in Focusrite
Control 2 and 64 or 32 is where the single-digit figures live. Two things
needed fixing to get there: `[STAThread]` on `Main` (ASIO drivers are
apartment-threaded COM) and preferring the USB driver over the Thunderbolt
one Focusrite registers regardless. With the vendor driver back, the WASAPI
endpoints report a 10 ms minimum period again — the browser fallback cause,
seen directly in `--list`.

**The number that settles it:** with the ASIO buffer at 64 samples, the
helper's own loopback test measures **4 ms** in to out. That is the whole
reason this was built — well under the ~20–30 ms where delayed auditory
feedback starts disrupting timing, so the app's amp is now something you can
play through on Windows. The browser, on the same interface and the vendor
driver, is back to ~269 ms, which costs nothing but the offset.

**Coexistence, verified:** an ASIO instance of the helper ran 25 s with zero
dropouts while a second instance opened the same 4i4's WDM endpoints (shared
mode, 10 ms periods) and ran alongside it. That second instance is exactly
what the browser is. The route in *With Focusrite's driver reinstalled* above
is therefore open: helper on ASIO for the amp, browser on WDM for the click
and the detector, same interface, same time.

With the vendor driver the loopback channel is reachable again, and for the
helper it is an ASIO input like any other: `--in-channel 5` (Loopback L on a
4i4) with a mix routed to Loopback in Control 2 measures the helper's round
trip with no cable; switch back to `--in-channel 1` to play.

### The zero-code version

Any ASIO-capable standalone amp sim on Focusrite's driver, alongside Groovy in
the browser on WDM, is the same architecture without writing the helper. It
loses Groovy's own tone and gains a better amp. It is also the cheapest
possible test of the coexistence assumption.

### Not worth pursuing

- Electron, Tauri or WebView2 shells on their own: same Chromium audio
  service, same numbers.
- More browser-side work: everything listed above was tried, and
  `MediaStreamTrackProcessor` came back slower.
- Moving detection native: sample-exact timing is already in hand; a second
  engine buys nothing.

### Two figures to reconcile

- This file says ~70 ms for the class driver; `README.md` says 92 ms. Both are
  measurements from this machine; the gap is the input stream renegotiating
  between page loads, which the README documents. "70–90 ms" is the honest
  figure.
- `README.md` listed `context.js` as `latencyHint: 'interactive'`; the code
  asks for `latencyHint: 0`. Fixed in the README.
