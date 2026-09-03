# Armagetron Advanced → in the browser

This is a fork of [Armagetron Advanced](https://www.armagetronad.org/) — the classic
3D lightcycle game — with one goal: **make the real game run in a web browser**.

Not a rewrite, not a look-alike: the original C++ engine, physics, AI and network
protocol, compiled to WebAssembly with [Emscripten](https://emscripten.org/).

## ▶ Play it

**<https://escapedcat.github.io/armagetronad-web/>**

Desktop Chrome or Firefox, keyboard required. It starts on its own — arrow keys
steer. A first visit transfers **1.668 MiB** (the edge serves the 4.33 MB wasm
gzipped to 1.27 MB); after that it is cached, and your settings and key bindings
persist in IndexedDB. The canvas is sized from your window at page load, so
maximise before reloading if you want the sharpest image.

Single-player against AI is the committed scope: the multiplayer menu is present
but reaches no servers. Safari is not a target.

**Known rough edges, all diagnosed, stated as narrowly as they were measured:**

- The HUD and FPS counter used to blink about once a second. **Fixed** — the frame
  yield sat above the overlay draw, so a frame could be composited with the world
  present and the HUD not yet drawn; moving it below the swap block took blinks
  shorter than 300 ms from 870 to 0 in Chrome and 822 to 0 in Firefox over 40.5 s.
  **Three ~1.5 s HUD-off stretches per 40 s remain**, unchanged by the fix and
  present in the control build too, beginning just after each round ends. They are
  probably the game legitimately hiding the HUD at a round transition — that is a
  hypothesis, not a measurement.
- In the video menu the top row, *Window Size*, **does nothing** — this build runs
  fullscreen, where that setting is never read. The row below it, *Screen
  Resolution*, is the live one and works.
- **`n` toggles browser fullscreen; `f` does not**, though it is bound. Pre-existing
  and unresolved.
- The multiplayer menu shows about **20 seconds of black canvas** before the game's
  own "Sorry, no server found". It fails gracefully; the black canvas is undiagnosed.
- **On a phone you get a canvas you cannot play and no explanation.** A "needs a
  keyboard" notice was promised and never built. Touch controls are Phase 3.

## Why

Armagetron's famously precise feel lives in ~114k lines of battle-tested C++
(cycle physics, rubber, the collision grid, server-authoritative netcode with
client prediction and lag compensation). Every previous attempt to bring the game
to the browser was a from-scratch rewrite that had to re-create that feel by hand —
and none got there. Compiling the actual engine sidesteps the problem entirely.

## Prior art

We looked into several earlier attempts before choosing this approach:

- [Armawebtron](https://github.com/Armawebtron/Armawebtron) — a from-scratch
  JS/Three.js rewrite of the game; stalled, networking never finished.
- Web-technology explorations (Godot, raylib) discussed around 2020–21 in the
  [official project](http://armagetronad.net/)'s forums by the lead developer —
  no follow-through.

Nobody has compiled the real codebase to WebAssembly before. The reasoning is
recorded in
[ADR 0000](docs/adr/0000-port-real-codebase-via-emscripten.md).

## The plan

The committed goal is **the Demo**: the complete single-player game vs. AI
opponents, hosted on GitHub Pages — desktop Chrome + Firefox, keyboard
required. Client-side only; offline mode opens no sockets. Full milestones and
risk analysis in **[PLAN.md](PLAN.md)**; shared vocabulary in
[CONTEXT.md](CONTEXT.md); founding decisions in [docs/adr/](docs/adr/).

Beyond the Demo, two follow-ups are designed but deliberately **not
committed** — each gets its own go/no-go decision once the Demo ships:

- **Touch controls** — minimal mobile play via a JavaScript overlay that maps
  taps to the game's existing keyboard controls (no C++ changes).
- **Multiplayer on real community servers** — a small UDP-over-WebSocket
  bridge lets the browser client speak the game's native protocol to today's
  unmodified public servers, including the in-game server browser.

## Status

✅ **Phase 1 complete. The Demo is live, and "live" is the whole claim.**

**<https://escapedcat.github.io/armagetronad-web/>** — publicly reachable and
playable, in desktop Chrome and Firefox, on one maintainer's machine. That
sentence is the deliverable and it is deliberately narrow: one machine (macOS
26.5, Apple M1 Max), one GPU, two browser builds, and **no human has yet played
this for enjoyment rather than to satisfy a script.**

What is measured, against the deployment rather than a local server: a first
visit transfers **1,748,947 B = 1.668 MiB** for the four game files, 8.6× under
the 15 MB budget; three complete rounds against three AI opponents in both
engines, arbitrated by M2's unmodified checker; and the whole set is
**reproducible** — all five published files come back byte-identical from a clean
rebuild at the exit commit.

Frame rate clears the ≥30 fps bar roughly twice over and **is not stable enough to
quote as a single number**. Three runs of the same script against the same build
and the same URL gave per-second medians of 60/60, 60/57 and 60/59
(Chrome/Firefox): Chrome was 60 every time, Firefox moved across 57, 59 and 60.
Worst *single* frames ranged 41.9–46.3 ms in Chrome and 37.0–50.0 ms in Firefox —
below 30 fps instantaneously, as they have been since M2, and still uninvestigated.
Browsers: Chrome 152, and Firefox **155**, one major version newer than the 154
this was built against, passing with no change.

**What is not done** is written out honestly in [PLAN.md](PLAN.md) under
"Phase 1 — closed": twelve open items, including a phone visitor getting no
explanation, an undiagnosed 20-second black canvas in the multiplayer menu, a
dead row in the video menu, a fullscreen key that does not fire, and a persistence
check that has been red since M4 and needs a decision rather than a re-run. One
command re-verifies everything that *is* claimed:

```sh
sh web/tools/live-gate.sh    # wire assertions, gameplay in both engines, multiplayer route
```

Re-runnable, arbitrated by exit status, with a prover that shows all 53 new
assertions can fail under set equality. Evidence: `docs/evidence/m5-launch/`.

---

**M3 still holds: the game produces sound — and nobody has heard it.**

Read the second clause as seriously as the first. What M3 established, and what
its gate mechanically checks, is one narrow thing: **non-zero PCM reaches
`SDL.audio.pushAudio`**, the point at which Emscripten's SDL 1.2 takes the
buffer the game's own `fill_audio` callback just mixed and schedules it into Web
Audio. Through a real three-round match that is **853 of 1021** buffers in
Chrome and **850 of 1014** in Firefox — and inside the rounds themselves it is
*every single buffer, in all three rounds, in both engines*. A control build
whose two WAVs cannot be decoded reads **0 of 1020** over the same call count at
the same latency, so silence and success do not look alike to this measurement.

**Three things that is not.** `pushAudio` is *upstream* of the Web Audio graph —
it is the function that creates an `AudioBufferSourceNode` and calls `start()` —
so this does not show the buffers were rendered to a device. Nothing anywhere
assesses whether the mix is *correct*: not the pitch, not the panning, not the
resampling from the 11025 Hz source to the 22050 Hz device. And no audio was
captured to a file and no human listened — the harness in fact guarantees the
output end is silent, since Chrome runs with `--mute-audio` and Firefox
headless. "The game has sound" is a fair summary; "the sound is good" is not a
claim anyone here is entitled to make. Nor is "it works everywhere": this is
still one machine, one GPU, two browsers.

The evidence is [docs/evidence/m3-audio/](docs/evidence/m3-audio/), arbitrated
by `check-audio-transcript.mjs` — 24 checks, exit status rather than prose, with
a companion that mutates a passing transcript and proves each of the 24 can
fail. Re-verified at M3's exit from a `make clean` rebuild: both engines pass,
the dedicated wasm is still byte-identical at 2,488,298 bytes and md5
`9718a2a64978cb6e9b95ea2f0454cca5`, and the client
wasm came out byte-identical to the one the evidence was taken against.

```sh
node docs/evidence/m3-audio/check-audio-transcript.mjs docs/evidence/m3-audio/chrome-console.log
node docs/evidence/m3-audio/check-audio-transcript.mjs docs/evidence/m3-audio/firefox-console.log
node docs/evidence/m3-audio/check-audio-transcript.mjs \
     docs/evidence/m3-audio/negative-control-chrome-console.log   # exits 1, deliberately
```

One caveat to carry with any number lifted from that directory: roughly half the
gate's JSON payload is **printed rather than asserted**, including the raw
`853`/`1021` counts above. The non-zero *fraction*, the median per-buffer
amplitude and the peak are checked by A5/A5b/A6; the raw counts are reported
with no checker behind them. The evidence README says which is which.

**M2 still holds: the game is playable. Three complete rounds against three AI
opponents, in Chrome and Firefox, with the arrow keys steering.**

The gate is a script, not a claim. It drives a first-time visitor's path — Play,
language menu, first-run setup, into the tutorial match — and then plays three
rounds to completion, pressing Left and Right during each one. It passed in
**Chrome 152.0.7977.65** (headed, real GPU) and **Firefox 154.0.1** (headless),
both at canvas 1024×768, on macOS 26.5 with an Apple M1 Max.

Frame rate was **measured in-page, not asserted** — every `glFlush`/`glFinish`
counted over the whole span from round 1 starting to round 3 ending, then bucketed
into whole seconds:

| | Chrome | Firefox |
|---|---|---|
| span measured | 39.64 s, 2369 frames | 39.41 s, 2324 frames |
| frames per whole second, **median** | 60 | 59 |
| frames per whole second, **minimum** | 53 | 56 |
| **worst single frame** | 43.8 ms = **22.8 fps** | 41.0 ms = **24.4 fps** |

The ≥30 fps bar is about a frame *rate*, and it is cleared by a wide margin —
but read the last row too: **the worst single frame drops below 30 fps in both
browsers.** That is a much harsher statistic than a frame rate and it did not
decide the milestone, but it is in the evidence and it is not hidden here. It is
also not a fluke of one run: re-running the gate from a clean rebuild at M2's
exit reproduced the medians exactly (60 / 59) and the minima to within one frame
(53 / 57 against the 53 / 56 above), and produced worst single frames of 55 ms
(18.2 fps) in Chrome and 45 ms (22.2 fps) in Firefox. Whatever causes it is
still there and nobody has looked for it.

Two things to keep the numbers honest. First, **the match measured is the
tutorial match** — the one a first-time visitor gets — and `welcome()`
(`gArmagetron.cpp:378-395`) temporarily alters its speed, arena size, wall length,
rubber and turn delay, restoring them afterwards. It is a real game of
Armagetron with real AI opponents and real rounds; it is a *gentle* one, and a
busier arena would produce lower numbers. Do not lift "60 fps" out of here.
Second, **`welcome()` touches neither `numAIs` nor `limitRounds`** — that was
checked, not assumed — so "three opponents" is attributable to `SP_NUM_AIS 3`
alone and "three rounds" to `SP_LIMIT_ROUNDS 3` alone (the shipped default is
10 rounds, so a match that stops at three is itself the setting having been read).

Forty-one files of evidence are committed under
[docs/evidence/m2-gate/](docs/evidence/m2-gate/): eighteen screenshots per
browser, both full devtools transcripts, the steps file exactly as executed, and
`check-transcript.mjs` — a checker that re-derives every claim from a transcript
alone and **exits non-zero if any of them fails**. It is the arbiter; the prose
is a description of what it checks.

```sh
node docs/evidence/m2-gate/check-transcript.mjs docs/evidence/m2-gate/chrome-console.log
node docs/evidence/m2-gate/check-transcript.mjs docs/evidence/m2-gate/firefox-console.log
```

Getting here took five runtime blockers cleared in sequence, each only visible
once the one before it was fixed: a NULL-returning WAV stub that aborted round
entry, `SDL_ConvertSurface` on a surface whose canvas Emscripten had already
freed, `glDrawElements` with 32-bit indices, a `glBegin`/`glEnd` block whose
vertex format changed part-way through, and the keycodes that stopped the shipped
arrow-key binds from firing. **Not one of them was on the watch-list M1 handed
over**, and the two that involve GL are not gaps in the emulation but rules the
emulation enforces that real OpenGL does not. The fourth turned out to be a whole
class of defect rather than one bug — including a variant that draws wrong
geometry *without* complaining — and is written up as
[browser-runtime-notes.md](docs/porting/browser-runtime-notes.md) § 10. That is
the section to read before touching the renderer.

**What M2 does *not* prove.**

- **Not that it is *fun*, or correct in detail.** No human has sat down and
  played this. Every run of it has been scripted, and a script that presses Left
  and Right on a timer cannot tell a good game from a bad one. Cycle feel,
  rubber, camera behaviour, AI difficulty — all unassessed.
- ~~**The camera is permanently top-down.**~~ Emscripten's `gluLookAt` was a
  complete no-op (it passes gl-matrix's destination argument as `eye`, so the
  matrix was read and never written), so no screenshot of this port taken before
  M5 has ever shown a correct 3D view — **including every screenshot in the M2,
  M3 and M4 sections above.** **Closed by M5**: `gluLookAt` is implemented in
  `src/emscripten/eCompat.cpp` against the GLU specification, and the floor grid
  now converges, the horizon exists, and the player's own cycle is in frame at
  the default camera. Before/after numbers: `docs/evidence/m5-camera/`.
- **One machine, one GPU, two browsers.** macOS 26.5, Apple M1 Max, Chrome 152
  and Firefox 154. No Windows, no Linux, no Intel or AMD GPU, no Safari, no
  mobile. A ≥30 fps result on an M1 Max is not a ≥30 fps result anywhere else.
- ~~**It is silent.**~~ M2 shipped with the audio path stubbed so a missing WAV
  could not abort round entry; nothing played. **Closed by M3** — see the M3
  section above, and read its three caveats before upgrading "has sound" to
  "sounds right".
- **Nothing persists.** Every page load is a first run, so the first-run setup
  menu appears every time and no setting or rebinding survives a reload. M4.
- **It is 8,854,277 bytes of wasm** before any size work, and no page has been
  deployed anywhere. M5. (**8,878,433 as of M3**: the WAV parser and mixing
  repairs added 24,156 bytes — nearly all of it `eSound.cpp`, plus a near-zero
  contribution from `eCompat.cpp` that was never measured apart. Still nothing
  deployed.)

M1 still holds: the client boots to a navigable menu with WebGL on a real GPU
(Chrome reports `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)`, Firefox
`Apple M1, or similar`), and its own evidence is under
[docs/evidence/m1-task7/](docs/evidence/m1-task7/).

M0 still holds and is still checked on every change: the dedicated server
compiles to WebAssembly, boots under Node, and parses and validates its map
through libxml2 — and its wasm is still byte-identical at 2,488,298 bytes **and
md5 `9718a2a64978cb6e9b95ea2f0454cca5`**, the
tripwire that catches anything client-only leaking into the shared build.
**Quote both, always: the size alone does not catch this class of change.** M4
task 3 measured an unguarded edit that links to *exactly* 2,488,298 bytes with a
different md5, because it rewrote `i32` initialisers that already existed and so
changed nothing's length. The recorded control link is
`docs/evidence/m4-config-precedence/byte-identity.asrun`. It was
re-verified from a `make clean` at the end of M2, and again at the end of M3 —
which matters more than usual there, because M3 edited `eSound.cpp`, a file that
compiles into *both* builds. What M0 did not prove about gameplay correctness is
still open: its playback diagnostic covered boot and idle only, so whether native
and wasm compute identical results *during play* remains untested.
Full M0 boot log: [docs/m0/boot-evidence.log](docs/m0/boot-evidence.log).
Next: nothing in Phase 1 — it is closed. Phase 2 (multiplayer through a UDP↔WebSocket bridge) and Phase 3 (touch) each get their own go/no-go decision, and what they inherit is written down in [PLAN.md](PLAN.md) under "Future work".

## Build and run it

The complete sequence — toolchain, dependencies, build, run — is the
**[Quickstart in `web/README.md`](web/README.md#quickstart)**. Roughly 15
minutes from a fresh clone, most of it spent downloading the Emscripten SDK.
Two things are buildable today: the browser client and the M0 dedicated server.

The short version, once the toolchain and dependencies are in place:

```sh
source deps/emsdk/emsdk_env.sh

# The browser client. It MUST be served over HTTP — a file:// open cannot
# fetch the .wasm and .data, and the page says so instead of starting.
make -f web/Makefile client -j8
python3 -m http.server 8000 --directory web/dist-m1
# then open http://localhost:8000/armagetronad.html -- it starts on its own.
# Language menu -> first-run setup -> a tutorial match against three AIs.
# Arrow keys steer, there is sound, and settings persist in IndexedDB.

# The M0 dedicated server, under Node.
make -f web/Makefile dedicated -j8
node web/dist-m0/armagetronad-dedicated.js \
    --datadir . --userdatadir /tmp/aa-persist --daemon < /dev/null
```

The server idles at `Nobody there. Taking a nap...` rather than exiting — that
is success; press Ctrl-C. `web/README.md` explains the `--daemon` requirement,
the harmless startup warnings, why nothing answers on port 4534 yet, and the
one-time network fetch the client's first link performs.

## Repo layout

- `main` is based on upstream's `legacy_0.2.9` branch (the current stable line);
  the `upstream` remote points to the official GitLab repository
  ([gitlab.com/armagetronad/armagetronad](https://gitlab.com/armagetronad/armagetronad))
  so upstream fixes merge cleanly.
- Port code is additive: new files under `src/emscripten/` and `web/`, with
  preprocessor guards elsewhere — native builds stay untouched. Which guard
  form is correct depends on the *site*, not the file, because the wasm
  dedicated server and the wasm browser client both define `__EMSCRIPTEN__`:
  the table is in
  [docs/porting/browser-runtime-notes.md](docs/porting/browser-runtime-notes.md)
  § 1, and getting it wrong does not fail the build.
- The original project documentation is in the plain-text [README](README) and
  `README-DEVELOPER`.

## License

GPL-2.0-or-later, same as upstream — see [COPYING.txt](COPYING.txt).
