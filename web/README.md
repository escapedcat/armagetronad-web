# Web build (Emscripten port)

## Quickstart

The whole sequence, from a fresh clone to a running browser client and a
running server. Every command runs **from the repo root**, and the whole thing
takes ~15 minutes, most of it waiting on the Emscripten SDK download. The
sections after this one explain each step and what can go wrong; this is the
path that works.

```sh
# 1. Toolchain (~1.8 GB installed, several minutes). Once per checkout.
git clone https://github.com/emscripten-core/emsdk.git deps/emsdk
(cd deps/emsdk && ./emsdk install 6.0.8 && ./emsdk activate 6.0.8)

# 2. Load it. Once per SHELL — it does not persist across terminals.
source deps/emsdk/emsdk_env.sh

# 3. Dependencies. Once per checkout.
./deps/build-libxml2.sh      # static wasm libxml2, a few minutes
npm ci --prefix web          # the `ws` package, needed at RUNTIME by Node

# 4. Build. Two targets, same source files, different flags.
#    NOTE: the FIRST `client` link goes to the network — see below.
make -f web/Makefile client    -j8    # browser client -> web/dist-m1/
make -f web/Makefile dedicated -j8    # M0 server      -> web/dist-m0/

# 5a. Run the client. It MUST be served over HTTP; a file:// open cannot
#     fetch .wasm/.data. Open the URL and the game starts on its own.
python3 -m http.server 8000 --directory web/dist-m1
#     -> http://localhost:8000/armagetronad.html

# 5b. Run the M0 server.
node web/dist-m0/armagetronad-dedicated.js --doc | head -20
node web/dist-m0/armagetronad-dedicated.js \
    --datadir . --userdatadir /tmp/aa-persist --daemon < /dev/null

# 6. Publish what step 4 built -- or merge to main and let CI do 4 and 6.
#    See "Deploying to GitHub Pages" below --
#    it publishes, it does not build.
(cd web && npm run deploy)
#     -> https://escapedcat.github.io/armagetronad-web/
```

Day to day you only need steps 2, 4 and 5 — and step 2 only in a new terminal.

**The first `client` link needs the network, and nothing warns you first.**
`-sUSE_SDL=1 -sUSE_LIBPNG=1` are Emscripten *ports*: on the first link that
uses them, emcc downloads zlib and libpng source tarballs and builds them.
They cache into the shared emsdk
(`deps/emsdk/upstream/emscripten/cache/ports/{zlib,libpng}`) and every later
link is offline, but this is a network dependency M0 did not have — M0's only
external library, libxml2, is built once by `deps/build-libxml2.sh`. On a
machine that has never linked an SDL port, budget a few minutes and a working
connection for that one command.

**The server does not exit — press Ctrl-C once you have seen the idle loop.**
(If you want it to stop on its own, prefix it with `timeout 15`. That is GNU
coreutils, not stock macOS — `brew install coreutils` provides it.)

**A successful run ends with the server idling, not exiting:**

```
[0] Bound socket to *.*.*.*:4534.
[0] Setting CYCLE_BRAKE_REFILL (Group: Annoying) deviates from its default value; clients older than 0.2.5.0 may experience problems.
[0] Nobody there. Taking a nap...
[0] Timestamp: 2026/08/26 12:00:03
[0] Closing socket bound to *.*.*.*:4534
[0] Bound socket to *.*.*.*:4534.
```

Four things that look like failures and are not:

- **It never exits.** `Taking a nap...` is the finish line, not a hang — it is
  the idle serving loop.
- **`[0] Command HUD_CACHE_THRESHOLD unknown.`** — the very first line printed.
  That setting only exists in builds with a HUD (`gHud.cpp`, inside
  `#ifndef DEDICATED`), and the shipped config files set it unconditionally, so
  a dedicated server always reports it. Native dedicated builds print it too.
- **`Setting CYCLE_BRAKE_REFILL … deviates from its default value`** — a
  stock-config notice, not a port artifact: the value comes from
  `config/settings.cfg`, which ships with the game.
- **`Relocation error … found itself in web/dist-m0` on stderr.** The game
  checks whether it is installed where it expects, dislikes the answer, and
  falls back to the current directory. That fallback is exactly why every
  command runs from the repo root. Harmless — see *Expected startup noise*.

And one thing that is a real limitation, not a bug: **nothing answers on port
4534.** The game's synchronous loop never yields to Node's event loop, so the
socket never finishes listening. Still true after M2, and an earlier revision of
this file was wrong to say M1 would fix it: M1 put `-sASYNCIFY=1` on the
*client* link only (`CLIENT_LDFLAGS`), and the dedicated build's `LDFLAGS` is
deliberately unchanged so its wasm stays byte-identical. The dedicated server is
a build-validation artifact, not part of the Demo, so nothing on the roadmap
fixes this — it would take adding Asyncify and a yield point to the M0 link,
which would end the byte-identity check that guards the source files
both builds share — 2,488,298 bytes **and** md5 `9718a2a64978cb6e9b95ea2f0454cca5`.
It is worth naming both halves: M4 task 3 measured an unguarded change that links
to exactly the right size with the wrong md5, so a size-only reading of this
tripwire would have passed it. **There are now two platform pins, not one.**
That figure is the Mac pin, measured on the maintainer's machine; `checks.yml`'s
own first run showed a Linux runner on the identical emsdk 6.0.8 does not
reproduce it — same source, same toolchain, a dedicated wasm 16 bytes smaller
at 2,488,282 bytes, md5 `ecb69e501f47c1a35cfe544ec0fe4e15` — so CI asserts
whichever of the two pins the platform it runs on actually produces (see the
comment above `LINUX_PIN_BYTES` in `checks.yml` for the run that established
the second number) rather than weakening the check to size alone or
overwriting this one with a number nobody measured on this machine. The Mac
pin above stays the invariant a local rebuild is judged against.

**`--daemon < /dev/null` is mandatory, and dropping it is the one real trap.**
Without it the process sits at ~0% CPU with a shorter log, looking calm — but
it is stalled, blocked forever in `read()` on stdin. The *working* run pins a
core at ~98%. The quiet one is the broken one; *Known limitations* has the
mechanism.

## Toolchain

Emscripten is a compiler that converts C and C++ code to WebAssembly (WASM), allowing the game's C++ dedicated server to run in a JavaScript environment.

### Setup

The Emscripten SDK is gitignored and never committed. To set up on a fresh checkout, clone and activate it:

    git clone https://github.com/emscripten-core/emsdk.git deps/emsdk
    cd deps/emsdk
    ./emsdk install 6.0.8
    ./emsdk activate 6.0.8
    cd ../..

Everything below assumes the Emscripten environment is loaded in the current shell:

    source deps/emsdk/emsdk_env.sh

**Pinned version:** `emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 6.0.8 (aeb67926e7de656da38bc807d83050af93578758)`
Upgrading the SDK is a deliberate act: update this line in the same commit.

Node: v22.x (any ≥ 18 works for running the M0 server). The browser-driving
harness in `web/tools/` needs a global `WebSocket`, so ≥ 22 there — that is the
whole reason it has no npm dependencies.

## Dependencies

libxml2 (static, wasm): `./deps/build-libxml2.sh` (needs the emsdk env sourced).
Output lands in `deps/build/libxml2-install/`. Pinned to 2.12.x — see the
comment in the script for why. Re-run only after `rm -rf deps/build/libxml2-*`.

## The browser client (M1 + M2)

    source deps/emsdk/emsdk_env.sh
    make -f web/Makefile client -j8

Four files land in `web/dist-m1/`, all produced by the one `em++` invocation
(sizes as built from `make clean` at the end of M3; M2's are kept beside them
because M5's size budget was drawn against those):

| file | size at M3 | at M2 | what it is |
|---|---|---|---|
| `armagetronad.html` | 10,061 B | 10,061 B | the page. It is `web/shell.html`, passed to `--shell-file` |
| `armagetronad.js` | 637,202 B | 637,202 B | the loader/glue: fetches the other two, sets up the runtime |
| `armagetronad.wasm` | 8,878,433 B | 8,854,277 B | the game. Big because of Asyncify — see *Known limitations* |
| `armagetronad.data` | 688,393 B | 683,791 B | the preloaded asset tree (config, language, textures, models, sound, maps) |

Both M3 deltas are accounted for and neither is an asset change.

The wasm grew **24,156 B**, and M3 changed **two** source files, not one:
`src/engine/eSound.cpp` (the WAV parser and the mixing repairs — nearly all of
the growth) and `src/emscripten/eCompat.cpp`, which *deleted* `SDL_LoadWAV_RW`
and gave `SDL_FreeWAV` a one-line `free()` body. The second file's contribution
is near zero and is plausibly negative, but it is not zero by construction, so
the delta should not be attributed to `eSound.cpp` alone — an earlier revision
of this file did, in all three places it quotes the figure. The two were never
measured separately; if that ever matters, link each object in isolation rather
than reasoning about it.

The data grew **4,602 B** because `web/webdefaults/autoexec.cfg` — which is
preloaded — gained the comment block arguing `SOUND_BUFFER_SHIFT` down from 3
to 1, and later the correction recording that the sound menu offers five shift
values while the measured table covers four different ones. Verified rather
than inferred: the config grew 773 B in that second edit and the `.data` grew
by exactly 773 B with the `.wasm` md5 unchanged.

The directory name still says `m1`. It is where the client has lived since M1 and
renaming it would break every path in this file, the harness scripts and the
evidence directories for no gain; M2 added no build target.

`armagetronad.js` is **not** reproducible byte-for-byte across links: emcc
embeds the paths of its own temporary files in comments (`// include:
/var/folders/.../tmpXXXXXXXX.js`), which differ every run. The `.wasm`, `.data`
and `.html` *are* byte-identical across a `make clean` rebuild — verified at the
end of M2 and again at the end of M3, where the clean-rebuilt client wasm came
out at `md5 364233c6542fd97a21e9a5fe872e0507`, matching the build
`docs/evidence/m3-audio/` was taken against — so a `.js` diff that is only those
comment lines is not a change.

`web/dist-m1/` and the object directory `web/build-m1/` are **gitignored** —
build output is never committed. That matters for the harness below: on a fresh
clone there is nothing to drive until you have linked once.

The client compiles the same 100 source files as the dedicated server plus one:
`src/emscripten/eCompat.cpp`, the shims for what Emscripten's SDL and GL
emulation leave undefined. What makes it a *client* rather than a server is
`-DAA_WEB_CLIENT`, which flips `src/emscripten/config.h` to the variant that
leaves `DEDICATED` undefined. `make -f web/Makefile clean` removes both
variants' objects and both `dist-` directories.

### Running it — over HTTP, not from disk

    python3 -m http.server 8000 --directory web/dist-m1

then open <http://localhost:8000/armagetronad.html> and press **Play**.

**A `file://` open does not work.** The loader fetches `armagetronad.wasm` and
`armagetronad.data` with `fetch()`/XHR, which browsers refuse on `file://`
pages. `web/shell.html` catches that case and says so on the page rather than
sitting on "Loading…" forever, but the fix is to serve it. Any static server
will do; `python3 -m http.server` is used here only because it needs no
install.

~~The Play button is not decoration either: the page loads with
`noInitialRun`, and `Module.callMain()` runs from the click. A browser will
not let a page start audio without a user gesture, so something has to be
clicked before the game starts; making that explicit is cheaper than debugging
a muted, half-started runtime.~~

**REMOVED at M5, and the audio reason above did not hold.** The button was
carried through four milestones as the user gesture that unlocks audio. It is
not needed for that: **Emscripten resumes the AudioContext on the first
keypress**, and this game cannot be played without one. Measured rather than
argued — with the button gone, M3's audio gate is **25/25 in Chrome and in
Firefox**, including A7c (the menus are exactly silent before round 1) and A9
(every buffer in the measured window was handed to a `running` AudioContext).
The page still loads with `noInitialRun` and `callMain` is still exported and
still required; it now runs from `onRuntimeInitialized`. `?autostart=0` restores
the old wait-for-a-call behaviour.

### The page's query parameters

Nothing in the shipped flow sets any of these and none is linked from anywhere.
They exist because **this port cannot measure a phone** — there is no device in
this repo's loop — so the only way to ask a phone a question is to hand the
person holding it a switch and a readout.

| parameter | default | what it does |
|---|---|---|
| `?autostart=0` | off | holds `main()` until `AA_START()`. A harness hook; four M4 checks need the window between "runtime ready" and "main has run". |
| `?touch=1` / `?touch=0` | media query | forces the touch overlay on or off. |
| `?dpr=N` | `devicePixelRatio` | sizes the backing store with `N` instead of the real device pixel ratio. **`?dpr=1` on a dpr-3 phone loads the same build at one ninth of the pixels.** |
| `?cam=F` | `0.5` on touch, `1` otherwise | scales the `CAMERA_CUSTOM_*` / `CAMERA_GLANCE_*` distances. `?cam=1` is stock. |
| `?sparks=1` / `?sparks=0` | off on touch, on otherwise | appends `SPARKS 1` or `SPARKS 0` to the runtime config, **on any device**. Off by default on a touch device: the bursts thrown at a wall cost about a quarter of the frame. `?sparks=1` has to *write* rather than stay silent — the game saves `SPARKS` into `user.cfg`, and this appended file is read after it — so it beats both the touch default and anything a previous session saved. `?sparks=0` turns them off on a desktop too, which is the only way this rig could measure them. |
| `?diag=1` | off | a live readout: device pixel ratio, viewport, backing store, **the WebGL drawing buffer the driver actually allocated**, the displayed box, the aspect error between the last two, and buffer swaps per second. |

**`?dpr=1` is the experiment that decides the performance question, and it
decides it in one comparison.** On a desktop this port is CPU-bound, not
fill-bound: `docs/evidence/m5-startup` swept nine backing-store sizes and the
frame-time distribution did not move — 60 fps median at 0.79 Mpx and at 33.2
Mpx, p50 pinned at 16.7 ms throughout. Whether that also holds on a phone GPU is
**unknown**. So: play a round normally, then play one at `?dpr=1`. If it feels
smoother, the phone is fill-bound and resolution is the lever. If it feels
identical, it is CPU-bound and cutting pixels buys nothing but blur.

**In `?diag=1`, the row to read is `gl`.** `bs` is the backing store the page
asked for — the number the game reads back through `SDL_GetVideoInfo` and builds
`glViewport` and `glFrustum` from. `gl` is what the driver actually allocated. A
WebGL drawing buffer over the driver's limit is **silently clamped**, and if the
clamp is not proportional the browser scales a wrong-shaped buffer over the
element box, which is a genuinely stretched picture. The row says `MATCH` or
`CLAMPED`. Desktop GPUs report a 16384-pixel axis limit and never come near it,
which is exactly why no desktop test in this repo can find that fault.

The frame rate is also drawn by the game itself, in the top right, and always
has been (`sr_FPSOut` defaults to `true` in `src/render/rScreen.cpp`) — so an
in-page frame-rate readout costs nothing to *have*, and `?diag=1`'s `swaps/s`
row exists only because that text is small on a phone. The two agree; where they
ever disagree, the game's is right.

### On a phone

The page detects a touch device with `(hover: none) and (pointer: coarse)` and
then differs from the desktop page in four ways, all of them in
`web/shell.html`:

- **the touch overlay** — two half-screen steering zones and a four-button menu
  pad (Phase 3, `docs/evidence/phase3-touch/`);
- **portrait is the Game Boy layout.** A touch device that **loads** in portrait
  gets `window.AA_GAMEBOY` and `html.aa-gameboy`, and with them a different page:
  the game is a square anchored at the top of the screen, and a pad sits below it.
  The decision is touch **and** portrait, taken once, before the backing store is
  sized — a desktop, or a phone held landscape at load, takes the full layout and
  nothing on the page changes for it. The square's side is `min(100vw, 60dvh)` in
  CSS and the same number times the device pixel ratio in the backing store
  (412×915 dpr 3 gives 412 CSS px and 1236×1236); it is published to the
  stylesheet as `--aa-square`, which is `0px` in the full layout because that is
  the true answer there rather than an unset one. The **60 % cap** is what keeps
  at least 40 % of the height for the pad on a tablet wide enough that the width
  would eat it; on a 412×915 phone the width wins and the cap is inert.
  Aspect 1 is the point of the whole layout: `rViewport::Perspective` draws a
  square at 90° × 90°, against ~111° × 67° at a phone's landscape and ~131°
  vertical at a full-portrait load — the 4:3 desktop the projection was tuned
  near is 90° horizontal (`docs/evidence/phone-round2/fov/`).
  The pad is **six `data-aakey` buttons** on the same pointer → `KeyboardEvent`
  wiring every other control uses, so it adds no input code: a cross
  (`ArrowUp`/`ArrowLeft`/`ArrowRight`/`ArrowDown`), **B** for `Escape` and **A**
  for `Enter`, measured at 64 and 80 CSS px. It is up in menus and in a round
  alike — the cross is Up/Down for the lists and Left/Right for the turns — while
  the landscape overlay (the two turn zones, the top strip, the corner Escape) is
  `display:none` under `html.aa-gameboy`; the picture above stays a tap-for-Enter
  surface in menus, clipped to the square.
  **A rotation after load is still only the chip.** The layout and the backing
  store are both decided at load, so turning the phone raises the reload notice
  and changes nothing else. The boot hold, the "turn your phone sideways" prompt,
  the "Play in portrait" button and `?portrait=ask` are **gone**, and
  `localStorage` `aa.portrait` is **no longer read** — a returning visitor's
  stored answer is inert. What the chip is offering to fix, in the direction that
  costs most: a Game Boy load rotated to landscape draws its 1236×1236 backing
  store into a 247 CSS px box (the `min(100vw, 60dvh)` is live CSS, the backing
  store is not) and the pad's top edge is still at 412 px, below a 412 px-tall
  viewport, so the chip is the only control left until a reload or a rotation
  back. `docs/evidence/m7-gameboy/`, `docs/evidence/portrait-choice/` for the
  flow it replaced.
- **the camera sits at half the stock distance.** At a phone's landscape
  geometry the player's own cycle measures 23 × 63 backing-store pixels stock
  and 47 × 122 at `?cam=0.5`. `?cam=1` restores stock;
  `docs/evidence/phone-feedback/camera/` is the sweep, including why narrowing
  the field of view was the worse lever.
- **the crash sparks are off.** `SPARKS` is an existing config item, read at the
  two `crash_sparks` guards in `src/tron/gCycle.cpp` — both in the wall-contact
  block, so this is the shower a cycle throws while it **grinds a wall** and
  nothing else (dying is `EXPLOSION`) — and drawing only: no physics, timing,
  rubber or score consults it. M6 task 8 measured it where it hurts, with a cycle
  held against the rim: 17.15 ms median frame and 20.3 ms in the worst measured
  second, draw calls bursting to 171, against 13.1 and 13.65 ms median with
  `SPARKS 0` and the draw count pinned flat at 60. About a quarter of the frame at
  the wall — with its condition: the 17.15 arm sparked in 29 of its 40 rim
  seconds, while the second stock run of the same arm sparked in 11 of 40 and read
  14.0 ms median, so the median win is 23.6 % in the one and 2.5 % in the other
  and the worst second falls 32 % and 18 %. `?sparks=1` restores them — by
  appending `SPARKS 1`, not by staying quiet, and that difference is the whole of
  a defect the maintainer found on his phone. `SPARKS` is a `tConfItem` and
  `tConfItemBase::Save()` returns `true` (`tConfiguration.h:296`), so the game
  writes it into `/persist/var/user.cfg` on every menu leave; `st_LoadConfig`
  reads `user.cfg` **first** and this appended file **last**
  (`tConfiguration.cpp:975` and `992`), so after one touch session a silent
  `?sparks=1` would leave the saved `0` standing. The `CAMERA_*` items are
  `tSettingItem`s, whose `Save()` returns `false` (`tConfiguration.h:497`), never
  reach `user.cfg`, and that is why `?cam=1`'s silence really is stock. The same
  ordering means the in-game Preferences toggle is overridden on a touch device
  at the next load, and `?sparks=1` is the way back. `EXPLOSION` is the same kind
  of switch, was **not** measured, and is left alone.
  `docs/evidence/m6-lag/task8-sparks/`.

A successful run shows the game's language menu on the canvas within a few
seconds of the page load. Enter chooses a language, the first-run setup menu
follows, Escape leaves it, and a tutorial match against three AI opponents
starts. The arrow keys steer. What that looks like, in both browsers, is
committed under `docs/evidence/m1-task7/` (menus, M1),
`docs/evidence/m2-gate/` (gameplay, M2) and `docs/evidence/m3-audio/` (audio,
M3).

### Expected browser-console noise

None of these is a failure:

- `WARNING: using emscripten GL emulation …` and `… GL emulation unsafe opts`
  and `WARNING: using emscripten GL immediate mode emulation` — printed by
  `-sLEGACY_GL_EMULATION=1` on every run, by design.
- `Relocation error … found itself in .` — the same M0 path-discovery message
  explained under *Expected startup noise* below. Harmless there, harmless here.
- `404 … /favicon.ico` — the browser asks once per navigation and
  `python3 -m http.server` has none. **Any *other* 404 is a real failure**: it
  means an asset the page needs was not published.
- `Trying to start sound. Just restart Armagetron Advanced in case of crash.` —
  the game's own message. The device does open, and as of M3 it is fed. See
  *Known limitations*.
- `[SND] device opened: …` and `[WAV] loaded …` — M3's own diagnostics, and the
  only report of what `SDL_OpenAudio` actually handed back. Every `[WAV]`/`[SND]`
  class is budgeted at 16 lines and then goes quiet, so **do not count them**;
  `docs/evidence/m3-audio/check-audio-transcript.mjs` explains what that does to
  a naive assertion.
- `The AudioContext was not allowed to start` — Chrome only, and expected: the
  client does not resume the context on the Play click, because a synthetic
  click is not a user gesture. The first real key press resumes it. Firefox
  says nothing here and instead simply stops asking for buffers, which is why
  the M3 gate windows its measurement to the first *trusted* keydown.
- `TODO: glShadeModel` — an Emscripten GL-emulation stub, not a crash.
- `[L] …` lines — the ladder log, on because
  `web/webdefaults/autoexec.cfg` sets `CONSOLE_LADDER_LOG 1`. This is the
  port's only machine-readable "did a round actually happen?" signal and the
  M2 gate is built on it.

**`WebGL: INVALID_ENUM: hint: invalid target` is gone as of M2** and its return
would be a regression, not noise. M1 emitted hundreds of them — one per menu
frame from `rScreen.cpp`'s `glHint` call — which spent Chrome's *permanent*
per-context WebGL error budget 1.4 s into boot and left the console unable to
report any WebGL error for the rest of the session. The call is now compiled out
of the client. `docs/porting/browser-runtime-notes.md` § 9 is the full story,
including why a clean transcript is not by itself evidence of a clean run.

### The browser-driving harness

`web/tools/` holds two Node scripts (444 and 368 lines) that open the page in a real
browser, wait for `[BOOT] autostart`, press keys, take screenshots and record everything the
console says. They exist because the page cannot be checked with a plain
screenshot — nothing runs until Play is clicked — and because retyping the
browser flags each time is how evidence stops being reproducible.

They have **no dependencies**: no Playwright, no Puppeteer, no `npm install`.
Node 22's global `WebSocket` talks the Chrome DevTools Protocol
(`drive-browser.mjs`) and WebDriver BiDi (`drive-firefox.mjs`, because Firefox
dropped CDP in 129). Both take the same options and the same step vocabulary
(`wait:`/`shot:`/`click:`/`key:`/`eval:`/`mark:`/`until:`); each file's header
comment is the reference.

`until:N:MS:TEXT` is M2's addition: it blocks until `TEXT` has appeared in `N`
transcript lines, or `MS` elapses. Gameplay needs it. A round ends when a cycle
hits a wall, at a different moment every run, so the only way to express "wait
for the third round to finish" in `wait:` alone is a sleep long enough for the
worst case — and that cannot tell a finished round from a hung one.

### Re-running the M2 gate

`web/tools/gameplay-gate.steps` is the **M2** gate: the first-run flow, then
three complete rounds against three AIs, with the frame rate measured in-page
rather than asserted. To re-run it — **after `make -f web/Makefile client`,
since `web/dist-m1` is gitignored and a fresh clone has nothing to serve**:

```sh
python3 -m http.server 8000 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --headed --out /tmp/gate-chrome \
     --script-file web/tools/gameplay-gate.steps
node web/tools/drive-firefox.mjs         --out /tmp/gate-firefox \
     --script-file web/tools/gameplay-gate.steps
kill %1

node docs/evidence/m2-gate/check-transcript.mjs /tmp/gate-chrome/console.log
node docs/evidence/m2-gate/check-transcript.mjs /tmp/gate-firefox/console.log
```

Each run takes a little over 70 seconds and produces 18 screenshots plus a
transcript. **The pass/fail decision is the checker's exit status, not the
prose.** `check-transcript.mjs` counts completed rounds from `ROUND_WINNER` (not
`NEW_ROUND`, which counts rounds *started*), rebuilds the AI team's roster by
replaying the ladder log's `TEAM_*` events, checks the frame rate's median *and*
minimum against the ≥30 bar, checks the forbidden strings and the 404 rule, and
checks that the deliberate faults at the end of the script did show up. It exits
0 or 1, so use it as a gate.

The committed evidence — 41 files: both transcripts, 36 screenshots, the checker
and the steps file exactly as executed — is `docs/evidence/m2-gate/`, and its
`README.md` explains what each screenshot shows and which claims rest on which
line of which file. `gameplay-gate.steps.asrun` there is deliberately *not* kept
in sync with `web/tools/gameplay-gate.steps`: it is the record of what produced
those numbers, and the evidence README lists the two things corrected in the live
script since.

### Re-running the M3 gate

`web/tools/audio-gate.steps` is the **M3** gate: the same first-run flow and
three-round match, with an in-page probe wrapped around `SDL.audio.pushAudio`
instead of M2's per-frame sampler. Same server, same drivers:

```sh
node web/tools/drive-browser.mjs --headed --out /tmp/audio-chrome \
     --script-file web/tools/audio-gate.steps
node web/tools/drive-firefox.mjs         --out /tmp/audio-firefox \
     --script-file web/tools/audio-gate.steps

node docs/evidence/m3-audio/check-audio-transcript.mjs /tmp/audio-chrome/console.log
node docs/evidence/m3-audio/check-audio-transcript.mjs /tmp/audio-firefox/console.log
```

25 checks, exit 0 or 1. What passing means is narrow and the checker says so
itself after the verdict: **non-zero PCM reached `SDL.audio.pushAudio`.** It is
not a claim that the buffers were rendered to a device — `pushAudio` is
upstream of the Web Audio graph, and the harness mutes Chrome and runs Firefox
headless — and it is not a claim that the mix is correct. Nobody has heard it.

Two things make that verdict worth something, and both are re-runnable:

```sh
# every check flips to FAIL under a targeted mutation: 25 mutations, 25 flips
node docs/evidence/m3-audio/prove-checks-can-fail.mjs docs/evidence/m3-audio/chrome-console.log

# and a genuinely silent build fails the gate rather than passing it quietly
node docs/evidence/m3-audio/check-audio-transcript.mjs \
     docs/evidence/m3-audio/negative-control-chrome-console.log   # exits 1
```

`docs/evidence/m3-audio/README.md` has the numbers, the two traps the gate is
built around (the untrusted-click AudioContext and the 16-line diagnostic
budgets), and `make-silent-bundle.mjs`, which builds that silent bundle from
`web/dist-m1` without a rebuild.

**Before quoting a number the checker printed, know which kind it is.** Roughly
half of the gate's JSON payload is *printed for context and never asserted on* —
`install_polls`, `rounds_started`, `window.calls*`,
`window.buffers_with_nonzero_pcm`, `window.latency_ms`, all of `whole_run` and
`pre_gesture`, and **five of the nine `per_round` fields** (`round`, `span_s`,
`calls_unpaused`, `buffers_with_nonzero_pcm`, `push_gap_max_ms`) can be set to
any value and the gate still exits 0 (a fuzz of 221 malformed transcripts found
62 that do, and the per-round five were demonstrated separately). That includes
**both** headline count pairs: "853 of 1021 buffers" over the window *and*
"219/219 in every round". A5 and A7 assert the non-zero *fractions*; nothing
checks that a fraction equals its printed numerator over its printed
denominator.

What **is** checked: `window.nonzero_fraction`, `window.maxabs.p50`,
`window.peak_abs_sample`, and per round only `nonzero_fraction` — now to
**exactly 1**, so "every buffer of every round" is an assertion rather than a
reading — and `peak_abs_sample`. `per_round.from_ms`/`to_ms` are not asserted
directly but decide the windows A4b and A7b are computed over. Quote the
fractions, the median and the peaks with confidence; treat every raw count as
reported rather than verified.

### Re-running the M4 gates

There are two, because M4 makes two separate claims.

`web/tools/persist-gate.steps` is the **filesystem** claim: `/persist` is an
IDBFS mount whose IndexedDB→MEMFS populate finishes *before* `main()` starts,
and bytes written in one page load are readable after a real
`location.reload()`. 17 checks, scored by
`docs/evidence/m4-persist/check-persist-transcript.mjs`. It says explicitly
what it does not cover: nothing about the game *using* what it read.

`web/tools/persist-settings-gate.steps` is the **player** claim: a setting
changed in a menu is durable. It types into the "Name:" field of the First
Setup menu (the `tConfItemLine` `PLAYER_1`), shows that the file is still
byte-identical while the menu is open, shows that leaving the menu writes it
and that the bytes reach IndexedDB *before any unload event fires*, reloads,
and then destroys `user.cfg` from JavaScript and makes the game rewrite it from
its own memory. 17 checks, scored by
`docs/evidence/m4-persist-settings/check-settings-transcript.mjs`.

```sh
node web/tools/drive-browser.mjs --headed --out /tmp/set-chrome \
     --script-file web/tools/persist-settings-gate.steps
node web/tools/drive-firefox.mjs         --out /tmp/set-firefox \
     --script-file web/tools/persist-settings-gate.steps

node docs/evidence/m4-persist-settings/check-settings-transcript.mjs /tmp/set-chrome/console.log
node docs/evidence/m4-persist-settings/prove-settings-checks-can-fail.mjs
```

Both gates carry real-browser controls rather than only transcript mutations.
The settings gate's are four pages built from two independent switches — the
menu-leave save (a second link, `make -f web/Makefile client-control`) and the
JS unload backstop (a text edit to the generated page,
`make-settings-control-pages.mjs`). The row that matters most is the one that
must **pass**: `armagetronad-nobackstop.html`, the real client with
`visibilitychange` and `beforeunload` disabled, scores 18/18. That is what
makes "the backstop is not load-bearing" a fact rather than an intention.
`docs/evidence/m4-persist-settings/README.md` has the full matrix, two results
in it that were measured rather than predicted, and the known limitation.

`web/tools/persist-settings-menu.steps` and `web/tools/persist-backstop.steps`
are demonstrations, not gates, and deliberately have no checker: the first
toggles **Menu Wrap** in System Setup → Misc Stuff and shows it still off two
page loads later; the second shows the `visibilitychange` handler saving a
change the player never left the menu on.

`web/tools/menu-gate.steps` is the M1 gate, still re-runnable the same way with
the filename swapped. It passes with ten screenshots, all ten different from each
other, and a transcript with no `Stack overflow detected`, no `[EXCEPTION]`, no
`SDL event queue full`, and no 404 other than `/favicon.ico`.

`--headed` is **required for Chrome** and is not a preference: headless Chrome
152 emits thousands of spurious keydown events per real keypress, which
overflows SDL's event queue and loses the keystroke. Firefox headless is fine.
Pass `--chrome PATH` / `--firefox PATH` if your browsers are not at the macOS
defaults.

### Known limitations of the client at M3 (camera row updated at M5)

- ~~**The camera is permanently top-down**~~ — **fixed in M5.** Emscripten's
  `gluLookAt` (`libglemu.js:3888`) is a complete no-op: it passes the current
  matrix where the bundled gl-matrix expects `eye` and writes the result into a
  throwaway array, and `eCamera::Render` sets the whole view orientation with
  one call to it, so the view was always straight down −Z. `eCompat.cpp` now
  defines `gluLookAt` itself, against the GLU 1.3 specification and as a
  post-multiply (correcting the argument order alone is **not** the fix — see
  § 11). **No screenshot of this port taken before M5 shows a correct 3D view**,
  so read older evidence frames accordingly. Mechanism, the second bug
  underneath the first, and the before/after measurements:
  `docs/porting/browser-runtime-notes.md` § 11 and
  `docs/evidence/m5-camera/`.
- **The mouse camera binds are still dead, deliberately.** `default.cfg` binds
  `LOOK_LEFT`/`LOOK_RIGHT`/`BANK_UP`/`BANK_DOWN`/`ZOOM_IN` to 324-332, which are
  this program's own mouse pseudo-keys `SDLK_LAST+1…`, and `SDLK_LAST` was 323
  in SDL 1.2 but is 1536 here. M5 measured the cost and deferred: the same
  actions are bound to the **numpad** in the same file, those binds translate
  and work, and the only three with no live binding are `BANK_UP`, `BANK_DOWN`
  and `ZOOM_IN`. Enabling the mouse ones needs pointer-lock behaviour verified
  first. § 11, "M5 TASK 2B DECISION".
- **Multiplayer does not work and cannot, and over `https:` it says so ~98
  times in the console.** Play Game → Multiplayer → Online Multiplayer queries
  the four masters in `config/master.srv` over UDP, which Emscripten maps onto
  `ws://master*:4533`. A page served over HTTPS — the only scheme GitHub Pages
  offers — has every one of those blocked as mixed content, and because
  `libsockfs.js` re-creates a dead dgram peer on the next `sendto`, the game's
  0.25 s login resend turns four attempts into **~98 in 20 seconds**. **Nothing
  a visitor sees changes**: black screen for ~20 s, then "Master servers do not
  answer", then "Sorry, no server found :-(" — pixel-for-pixel the same
  sequence at the same times as over `http:`, in both browsers, because the
  wall clock is set by the game's own 5-second-per-master timeout and not by
  how the socket fails. **Examined and deliberately left alone at M5**,
  including one alternative (`wss://` rewrite) that was measured working and
  declined: `docs/porting/browser-runtime-notes.md` § 12,
  `docs/evidence/m5-https/`. Multiplayer itself needs the Phase 2 bridge.
- **For the ~20 seconds of that master query the canvas is solid black**, on
  both schemes and in both browsers, even though `BrowseSpecialMaster` turns
  the fullscreen console on to show "Connecting to Master Server N...".
  Measured at +2 s, +5 s, +10 s and +15.5 s. **Not diagnosed** — M5 task 3
  recorded it because "what does the visitor see" was its question, and it is
  not an HTTPS problem.
- **The cockpit HUD's first draw within a round is erratic**, and nobody has
  explained what it waits on. Screenshotting 5.5 s into a round finds the
  instrument panel present in anywhere from one round of three to three of
  three. **In Chrome that varies between runs of the same script on the same
  build** — four Chrome runs scored 1/3, 1/3, 3/3 and 1/3. Firefox has only one
  run per build, so same-build variance has not been observed there; what
  Firefox shows is 2/3 on *both* builds, missing a different round in each.
  Measured rather than guessed: `docs/evidence/m3-audio/README.md`, "The missing
  cockpit HUD", scores all 39 committed driving frames with
  `docs/evidence/m3-audio/cockpit-band.mjs`. It is **not** an M3 regression —
  the M3 build reaches three of three. The one plausible mechanism, M3's
  per-callback mixing work landing on the main thread, is *narrowed* there
  rather than dismissed: a run with the mixing **cost** removed on a
  byte-identical wasm still scores 1/3, which rules that cost out. Only the cost
  is ruled out — the audio callback, the open device and `pushAudio` all still
  run at 21.5/s under that same lesion, so "audio work on the main thread" as
  such is not excluded, and the phenomenon is stochastic enough that one run
  cannot exclude a probabilistic contribution anyway. **Those two figures —
  21.5 callbacks/s and 1020 unpaused pushes — come from the negative control**,
  not from the silent-bundle run scored for the HUD. They are two different runs
  of the same bundle: the negative control is driven by `audio-gate.steps` with
  the probe attached, while the HUD run is driven by M2's `gameplay-gate.steps`,
  which carries no audio probe at all, so no push count can be read off it. An
  earlier revision of this bullet attributed both figures to the HUD run. Open
  question for M4/M5.
- **Sound is produced, but nobody has heard it.** As of M3 both shipped WAVs
  decode and non-zero PCM reaches `SDL.audio.pushAudio` continuously through a
  match — every buffer of every round, in Chrome and Firefox, measured in
  `docs/evidence/m3-audio/`. `pushAudio` is *upstream* of the Web Audio graph,
  so that is not the same as "the buffers were rendered to a device", and
  nothing anywhere assesses whether the mix is *correct*: no audio has been
  captured to a file and no human has listened. The two known gaps are that the
  client does not resume the `AudioContext` on the Play click (the first key
  press does it, via Emscripten's `autoResumeAudioContext`), and that the
  voice limiter has only one voice of margin — it peaks at 9 against
  `SOUND_SOURCES 10`, so it has never actually engaged and raising `SP_NUM_AIS`
  would be the first time that code ran with real voices in it.
- **`SOUND_BUFFER_SHIFT 1` is a hard override a player cannot keep changed.**
  It lives in `web/webdefaults/autoexec.cfg`, which loads *after* `user.cfg`, so
  the audio-buffer size is reachable from the in-game sound menu but will be
  silently reset on every load once M4 lands persistence. Exactly the same
  problem `MAX_FPS` has, and they should be fixed together. The value itself was
  chosen on a measured margin argument — 278 ms of latency and starvation
  tolerance against a worst observed main-thread stall of 119-142 ms — and the
  full table is in the config file.
- **Persistence lands in M4 and is not finished.** `/persist` is an IDBFS mount
  populated before `main()` (task 1) and leaving a menu saves the config
  (task 2), so a setting a player changes now survives a reload — see
  "Re-running the M4 gates" above. Three things are still open. **(a)** The one
  menu whose caller applies the player's choice *after* the menu closes — First
  Setup, for Colour / Controls / Connection, and with it `FIRST_USE` — is not
  covered by a menu-leave save. The `beforeunload` backstop catches it today,
  and a backstop is not a mechanism. **(b)** `/persist` collects more than
  `user.cfg`: `var/ladderlog.txt` and `var/scorelog.txt` grow without bound,
  IndexedDB quota does not, and `libidbfs.js` surfaces no error to any caller
  when a write-back fails. **(c)** `beforeunload` has a measured payload cliff
  at ~2 MB of *delta* — the same problem seen from the other side. The
  `SDL_QUIT` call site (`gArmagetron.cpp`, in `filter`) is still unreachable in
  the browser, but it is now **one lost site out of the 11 the browser client
  compiles** rather than the whole story. (Counting basis, since three numbers
  are all correct: 12 call sites tree-wide before this task, 10 of them in code
  any build here compiles — the other two are `src/macosx/SDLMain.mm`, which no
  build here touches — plus the one M4 task 2 adds. The table is in
  `docs/evidence/m4-persist-settings/README.md`.)
- **The wasm is 8,878,433 bytes** as of M3, up from M2's 8,854,277 — M3's WAV
  parser and mixing-path repairs cost **+24,156 bytes**, which is the whole of
  the delta. Nearly all of it is `src/engine/eSound.cpp`; `src/emscripten/
  eCompat.cpp` also changed in that link (a deleted function and a one-line
  `free()` body, so a near-zero and plausibly negative contribution) and the two
  were never measured apart. Asyncify nearly triples the total (+5,888,604 over
  the same objects linked without it) and `-fexceptions` adds a further 827,185;
  both of those deltas were measured on the M2 tree and have not been re-taken.
  All are mandatory today. That is M5's size budget, and
  `docs/porting/browser-runtime-notes.md` § 7 has the measurements and the two
  ways to reduce the Asyncify half.
- **Frame pacing is `setTimeout`, not `requestAnimationFrame`.** `MAX_FPS` (60,
  from `web/webdefaults/autoexec.cfg`) is honoured, but browsers clamp nested
  timeouts to ~4 ms, so treat 60 as a ceiling rather than a cadence. Measured
  during three real rounds: a per-whole-second median of 60 (Chrome) and 59
  (Firefox), a minimum of 53 and 56 — and a worst *single* frame of 43.8 ms and
  41.0 ms, which is below 30 fps instantaneous in both.
- ~~**The binding menu shows blank key names** for arrows, Escape, Enter, Tab and
  the F-keys. Emscripten's `SDL_GetKeyName` names only `a-z` and `0-9`
  (`libsdl.js:1754-1764`). Rebinding works; it displays nothing. Deferred to M4.~~
  **This was never true.** `su_EmscriptenKeyName` in `uInput.cpp` supplies those
  names and is wired into `keyname()` under the correct guard; it was committed
  in M2 task 6 (`422dfb2b`, 19:46) and this line was written at 21:31 the same
  day, in the commit that closed M2 — **1h45m after the fix landed in the same
  tree.** Deleted as an item rather than fixed, because there was nothing to fix.
  Struck through rather than removed: it seeded M4's plan and this recon's own
  question list, so a reader who acted on it needs to find the retraction.
- **`default.cfg`'s mouse-camera bindings are dead** (`LOOK_LEFT`, `LOOK_RIGHT`,
  `BANK_UP`, `BANK_DOWN`, `ZOOM_IN`, lines 31-35). Those keycodes, 324-336, are
  the program's own mouse pseudo-keys defined as `SDLK_LAST+1…+13`, and
  `SDLK_LAST` was 323 in SDL 1.2 but is 1536 here. Fixing it needs the browser's
  pointer-lock behaviour verified first, so it was left rather than enabled
  blind. Same section, § 11.
- ~~**One known abort is latent and reachable**: `rViewport.cpp:246`, via the
  viewport-configuration screen in the settings menu.~~ **Wrong twice, corrected
  at M5.** It was never *latent*: M5's recon reached it in four keystrokes from
  the main menu (Player Setup, Down x4) and the tab died — *highlighting* the
  row was enough, because the offending batch is in `RenderBackground()`. M5
  task 1 closed it by adding the missing `RenderEnd()`, and
  `web/tools/viewport-menu-gate.steps` now drives that screen, so "nothing in
  the gate opens it" is no longer true either. Kept struck through rather than
  deleted: four milestones repeated the word "latent" about a live crash.
- **It has never been played by a person.** Every run has been driven by
  `web/tools/`, which presses Left and Right on a timer. Nothing here says the
  game *feels* right.

**Two things to read before editing client code, both in
`docs/porting/browser-runtime-notes.md`:**

- **§ 8, before adding any sleep, delay or wait.** `SDL_Delay` looks safe, is
  aliased to `emscripten_sleep`, links cleanly, and corrupts the stack pointer
  at runtime. That section is the rule and the proof.
- **§ 10, before adding a `Begin*()` call site or moving a colour or texcoord
  near one.** Emscripten derives one interleaved vertex layout for a whole
  `glBegin`/`glEnd` block, so every vertex in a block must emit the same
  attribute calls in the same order. Break it and you get either an abort or —
  if the slot count happens to divide evenly — silently wrong geometry. This is
  the largest single class of defect the port has found, and it is also why
  **`ASSERTIONS` must stay on**. **Updated at M5:** `CLIENT_LDFLAGS` now carries
  `-O2 -sASSERTIONS=1`. M2's ban on `-O` was really a ban on losing
  `ASSERTIONS`, and M5 recon proved the two separable by *firing* the assert on
  each build rather than by reading flags: it aborts identically without `-O`
  and with `-O2 -sASSERTIONS=1`, and on **bare `-O2` it silently renders wrong
  geometry instead**. So the rule is not "no `-O`" — it is **never drop
  `-sASSERTIONS=1`**.

## Deploying to GitHub Pages

**Live at <https://escapedcat.github.io/armagetronad-web/>.**

```sh
source deps/emsdk/emsdk_env.sh
make -f web/Makefile client -j8      # from the repo root; the deploy does NOT build
cd web && npm run deploy
```

`npm run deploy` copies `web/index.html` into `web/dist-m1/` and publishes that
directory. It builds nothing: publish a stale `dist-m1` and you publish stale
artefacts, which is a failure this port has already had once in another form
(M4's leftover `dist-m0` had the right size and the wrong md5).

**CI does this on every merge to `main`** (`.github/workflows/deploy-pages.yml`,
since 2026-09-03): a clean checkout, the pinned emsdk and the static libxml2 (both
cached), `make client`, then the *same* `npm run deploy` — publish-set gate
included — with `-x -r -u` appended for the runner. Pull requests run the build
and the gate but do not publish, so every PR proves the client still builds.
`gh workflow run deploy-pages.yml --ref <branch>` publishes a branch — the way
to get one onto a phone before it merges; `main` takes the site back on its next
change. Docs-only pushes are skipped. The manual procedure above stays valid and
is exactly what the workflow runs.

**Checks on every pull request** (`.github/workflows/checks.yml`, since
2026-09-03) add two things the build-and-gate above does not cover. The
`dedicated-pin` job builds the *other* wasm — the M0 dedicated server, which
`deploy-pages.yml` never touches — and asserts the byte invariant this file
states above under *Known limitations*, both halves (size and md5), the way
size alone once matched a build with the wrong md5. It asserts whichever of
the *two platform pins* (see above) the runner it built on actually produces,
printing both measured values first so a failing log needs no re-run to
explain itself. The `scripts` job runs `shellcheck` over
`web/tools/*.sh` and `deps/*.sh` and `node --check` over every
`web/tools/*.mjs`, so a script that cannot parse or has a real quoting bug
fails the PR instead of the next person to run it. There is deliberately no
C++ lint or formatter here: this port carries roughly 114,000 lines of
essentially unpatched upstream Armagetron source, and reformatting it would
fight `upstream-watch.yml`'s diff against real upstream commits rather than
catch anything this project wrote.

After an actual deploy (never on a PR — see *What runs when* above),
`deploy-pages.yml` itself polls the live site until
`armagetronad.wasm`'s sha256 matches what this job just built (Pages' own
build lag is ~20 s; the poll gives up after 10 minutes), then runs this
project's wire check — `web/tools/wire-facts.sh` and
`docs/evidence/m5-launch/check-wire-facts.mjs`, chained exactly as
`web/tools/live-gate.sh --only wire` runs them — against the freshly deployed
site. Its W7 compares the deployed bytes to a *local* build under
`web/dist-m1`, which in this job is the build that was just published, so the
comparison is never stale.

**What it does to the repository.** It force-pushes the branch `gh-pages` as a
single **parentless** commit containing only the six published files — the
branch has no shared history with `main` and is replaced, not appended to, on
every deploy. GitHub enables Pages by itself on the first push to a branch of
that name; the site is served from `gh-pages` at `/`, `https_enforced`, and the
Pages build takes about 20 s after the push. Nothing on `main` is touched.

**The entry point is `armagetronad.html`**, because emcc names its page after
the link target. `web/index.html` is a hand-written `<meta refresh>` that exists
so the bare Pages URL — the one a visitor is actually handed — is not GitHub's
404 page. It is not part of the wasm build and the Makefile does not produce it.

**Two flags and one bug fix in that script:**

- `-f` is gh-pages' `--no-history`. Without it every deploy appends a commit
  still carrying the previous 5 MB of binaries.
- `--nojekyll` writes `.nojekyll`. Nothing in the artefact set is
  underscore-prefixed today, so it is insurance, not a fix for an observed
  failure.
- `-v "{**/*,**/.*}"` **is not optional and is not in any plan.** gh-pages
  clears the branch by globbing its own checkout and `git rm`-ing the result,
  with globby's `dot: false`, so **no dotfile is ever removed** — including the
  root `.gitignore` that `git checkout --orphan` brings along on the first
  deploy. `git add .` then honours it, and its line 63 is a bare `*.html`. The
  first real deploy of this repository therefore published the `.wasm`, the
  `.js` and the `.data` **with no page at all**, printed `Published`, and exited
  0. `docs/evidence/m5-deploy/` has the broken commit verbatim and an A/B script
  that reproduces it on a local rig.

**What a visitor downloads**, measured on the deployed site with real GETs, not
from `curl -I` (`sh web/tools/wire-facts.sh`, checked by
`docs/evidence/m5-launch/check-wire-facts.mjs`):

| file | identity | on the wire | content-type |
|---|---|---|---|
| `armagetronad.html` | 4,395 | 2,078 | `text/html; charset=utf-8` |
| `armagetronad.js` | 357,282 | 87,938 | `application/javascript; charset=utf-8` |
| `armagetronad.wasm` | 4,331,484 | 1,274,267 | `application/wasm` |
| `armagetronad.data` | 687,094 | 384,664 | `application/octet-stream` |

**5,380,255 B becomes 1,748,947 B (1.668 MiB) on the wire.** The Pages edge does
gzip a 4.33 MB `.wasm` — that was M5's one unmeasured Pages fact, and it is
settled. It serves gzip only: `Accept-Encoding: br` alone returns identity.

*The table above was 4,331,548 → 1,274,294 and 1.667 MiB when M5 task 4 wrote
it, and both versions are correct about their own deploy: the site was
redeployed afterwards with the autostart/sizing build and three of the four
files changed size. That is the whole argument for **re-measuring rather than
quoting** — which is why the numbers are now recorded as JSON and arbitrated by
a program instead of typed into this table.*

### What is deployed right now, and how to tell

The `gh-pages` tip is **`60433d16`, "Deploy dd42ce68"** — the deploy script puts
`git rev-parse --short HEAD` in the commit message, so the published commit names
the source commit it came from.

**Expect that name to be an ancestor of `main` rather than its tip.** Everything
committed after a deploy that does not change an artefact — docs, evidence,
tooling — moves `HEAD` without invalidating the deployment. The check that
matters is not "does the tip match" but "do the published bytes come back from a
build of this tree", and at the M5 exit they do: all five published files are
**byte-identical by md5** to a clean rebuild, verified after
`rm -rf web/build-m0 web/dist-m0 web/build-m1 web/dist-m1`. `check-wire-facts.mjs`
W7 asserts exactly that against the live site, per file, by sha256.

### The published set is asserted, not assumed

`npm run deploy` runs `web/tools/check-publish-set.mjs` before it publishes
anything. That check asserts **set equality** against a declared release list and
exits 1 on a stray file *or* a missing one, so a bad set stops locally instead of
being force-pushed. It checks names only — `check-wire-facts.mjs` W7 is the
content check and runs against the deployment afterwards.

```sh
node web/tools/check-publish-set.mjs               # what would be published
node web/tools/check-publish-set.mjs --list        # the declared release set
sh web/tools/prove-publish-set-check-can-fail.sh   # 9 cases, all must behave as declared
```

**Verify what is actually published with `git ls-tree`, never by browsing** —
Pages serves no directory index, so that tree is the only way to see the set:

```sh
git fetch origin gh-pages && git ls-tree -r -l origin/gh-pages
```

At the M5 exit deploy that is **6 entries, 5,382,608 B**: the four game files,
`index.html` and `.nojekyll`.

~~**The published branch currently carries more than the six files listed above.**
`git ls-tree -r origin/gh-pages` shows 23 entries, 16,185,514 B; the four game
files, `index.html` and `.nojekyll` are 5,382,608 B of that, and the remaining
17 entries — `armagetronad-fstoggle.*`, `armagetronad-oldyield.*` and nine
`res-*.html` — are probe builds from M5's startup/sizing work that were in
`web/dist-m1` when the deploy ran.~~

**FIXED at the M5 exit, and worth reading rather than striking, because the cause
was structural.** Those 17 files were published because `npm run deploy` publishes
`web/dist-m1` **as it finds it**, that directory is gitignored, and
`make -f web/Makefile client` does not clear it — so every probe build and
generated control page any task wrote there was one deploy away from being public.
Two of them were whole builds with known defects, publicly fetchable and served as
`application/wasm`: `armagetronad-oldyield.*` is the build with the HUD flicker,
and `armagetronad-fstoggle.*` is a control whose fullscreen key is deliberately
broken. The texture work later left five more (`texprobe.html`,
`aniso-{on,off}.html`, `fps-aniso-{on,off}.html`) that the next deploy would have
published the same way — which is the tell that this was a process defect and not
one person's oversight.

A visitor never downloaded any of them, because nothing links to them; they cost
repository storage, not wire bytes. All 17 now answer **404**, verified by name
after the exit deploy. One of them returned 200 for a few minutes afterwards from
a stale edge cache — **removal from the branch is not instantly removal from the
CDN**, so re-check with a cache-busting query before concluding a deploy failed.

`make -f web/Makefile clean` before a release build is still the cure; the check
is what makes forgetting it non-silent.

### Re-running the live gate

Everything above, plus the gameplay and multiplayer gates, against the **public
URL** rather than a local server:

```sh
sh web/tools/live-gate.sh                 # ~8 minutes: wire, 2 gameplay, 2 multiplayer
sh web/tools/live-gate.sh --only wire     # just the curl assertions, seconds
sh web/tools/live-gate.sh --no-proxy      # if your Firefox can reach *.github.io
```

It runs M2's `gameplay-gate.steps` and M5 task 3's `https-multiplayer.steps`
**unmodified** — only `--url` changes — and arbitrates them with
`docs/evidence/m2-gate/check-transcript.mjs` and
`docs/evidence/m5-launch/check-live-multiplayer.mjs`. Evidence and the full
argument are in `docs/evidence/m5-launch/README.md`.

**On this machine Firefox cannot reach any `*.github.io` host**, GitHub's own
`pages.github.io` included, while Chrome and curl reach the same URL in the same
second. That is a local outbound restriction, so `live-gate.sh` routes Firefox
through `docs/evidence/m5-deploy/tunnel-proxy.mjs` by default; the proxy tunnels
`CONNECT` byte-for-byte, so TLS and the document origin are unchanged.

## Building the M0 dedicated server

    source deps/emsdk/emsdk_env.sh
    ./deps/build-libxml2.sh        # once
    make -f web/Makefile dedicated -j8

Output: web/dist-m0/armagetronad-dedicated.{js,wasm}. `make -f web/Makefile clean`
removes the objects and the artifact.

`dedicated` also generates the runtime data a native build gets from
`configure` — `language/languages.txt`, `config/aiplayers.cfg` and
`resource/included/` (see the `data` target). `clean` deliberately leaves those
alone, because they are generated *source-tree* data rather than build output.
To rebuild them from scratch — a corrupted or half-written `resource/included`
is the usual reason — use `make -f web/Makefile clean-data`, then any build
target regenerates them.

The Makefile is hand-written and deliberately does not use autotools. It compiles
100 translation units — the same `*.cpp` set a native *dedicated* build does,
cross-checked against the `*_SOURCES` lists in `src/Makefile.am`. (Native also
compiles `thirdparty/binreloc/prefix.c` for 101; it is inert without
`ENABLE_BINRELOC`, which this build does not define.) The `EXCLUDES` list names
the files the per-directory wildcards would otherwise sweep in — extra `main()`s,
stale demos, dead code, and `render/rConsoleCout.cpp`, which is `#include`d by
`rConsoleGraph.cpp` rather than compiled on its own. Each entry carries its
reason in a comment. Grow that list only for further `main()`s, never to make an
error go away.

Header dependencies are tracked (`-MMD -MP`), and objects depend on the Makefile
itself, so editing `src/emscripten/config.h` or a compile flag rebuilds what it
should.

### Expected startup noise

Running the server prints a `Relocation error. The binary was supposed to be
installed into /usr/local/bin and found itself in web/dist-m0 …` line on stderr.
**This is expected and harmless — the port is not broken.** The path code always
compares the binary's actual location against the compiled-in `/usr/local/bin`,
and a wasm artifact never lives there. The message is printed by a handler that
returns rather than exits, and the data/config search then falls back to `.` and
`./config`. It cannot be suppressed with `--datadir`, because the path search
runs before command-line options are parsed. See the comment on `AA_DATADIR` in
`src/emscripten/config.h` for the full trace.

Because of that fallback, **run the artifact from the repo root** (with
`-sNODERAWFS=1` the paths resolve against the Node process's working directory),
or the server will not find `config/`, `language/` and `resource/`.

## Running the M0 server

Both commands are run from the repo root, and both need `make -f web/Makefile
dedicated` to have run first — that target also generates the runtime data
(`language/languages.txt`, `config/aiplayers.cfg`, `resource/included/`) that a
native build would get from `configure`. Node needs `web/node_modules`, so run
`npm ci --prefix web` once on a fresh checkout — `ci` rather than `install`, so
the committed lockfile is honoured exactly, same discipline as the pinned emsdk
and libxml2 above.

    node web/dist-m0/armagetronad-dedicated.js --doc            # config self-test
    node web/dist-m0/armagetronad-dedicated.js --datadir . --userdatadir /tmp/aa-persist --daemon < /dev/null

`--doc` prints 772 settings with their English descriptions and exits. If you
see raw ids (`access_level_help`) instead of prose, `language/languages.txt` is
missing. The list is 772 rather than 848 items because `--doc` deliberately
hides settings whose help text is the literal `UNDOCUMENTED`
(`tConfiguration.cpp:815`, keys in `language/english_base_notranslate.txt`);
those settings still exist and still work.

A successful boot ends with:

    [0] Bound socket to *.*.*.*:4534.
    [0] Nobody there. Taking a nap...
    [0] Timestamp: ...
    [0] Closing socket bound to *.*.*.*:4534
    [0] Bound socket to *.*.*.*:4534.

and then stays there. That is the idle serving loop, and it is the M0 success
condition: the process does not exit on its own, so run it under a timeout.

**The map is parsed even though nothing says so.** `$map_file_loading` is inside
`#ifdef DEBUG` (`gGame.cpp:2899`) and map loading runs behind a console filter,
so a successful parse is silent. `gGame::Verify()` parses and DTD-validates a map
through libxml2 before the server starts listening, so reaching "Taking a
nap..." proves that libxml2 ran and that **some** map came out of it.

Be careful not to read more into that line than it carries. At `Verify()` time
the net state is still `nSTANDALONE`, so the throw at `gGame.cpp:2916` is gated
and `:2921-2922` quietly retries with `DEFAULT_MAP`, throwing only if the
fallback fails too. A broken `MAP_FILE` therefore still reaches "Taking a
nap..." — on the default map. **The nap line is not evidence that your map
loaded.**

To check that, look for the map's own settings. Pointing `MAP_FILE` at
`Z-Man/fortress/sumo_4x4-0.1.1.aamap.xml` adds:

    [0] MAP_FILE_OVERRIDE changed from 3 to 0.
    [0] FORTRESS_MAX_PER_TEAM changed from 0 to 1.
    [0] SPAWN_POINT_GROUP_SIZE changed from 0 to 4.

which are the three `<Setting>` elements inside that map file. If those lines
are absent, your map did not load and you are running the default. A failed
parse also prints libxml2's own errors (`:N: parser error`, `validity error`,
`[0] Failed to validate.`) before falling back. (Set `MAP_FILE` from a `.cfg` in
`<userdatadir>/config` and pass `-e <name>.cfg`; `--extraconfig` resolves
against the config path, not the working directory.)

### Known limitations at this milestone

**It cannot accept real connections.** The C++ reports `Bound socket to
*.*.*.*:4534`, and Emscripten does construct a `WebSocketServer` for it, but the
server never reaches its `listening` event: the game loop runs synchronously
inside `callMain()` and never yields, so Node's event loop never gets a turn to
finish the async bind. Nothing is reachable on 4534. **Still true after M2.**
Asyncify is what would fix it, and the client does use Asyncify — but only on the
client link, because the dedicated wasm has to stay byte-identical. See the
Quickstart's note on port 4534.

**Run it with `--daemon < /dev/null`, not on a terminal.** Without `--daemon`
the server installs a stdin console, and that console assumes `O_NONBLOCK` makes
`read()` return `EAGAIN` when no key has been pressed — the `F_SETFL` is at
`src/render/rConsoleCout.cpp:246` and the loop that depends on it is at
`:392-409`.
Under `-sNODERAWFS=1` that assumption does not hold: `fcntl(F_SETFL, O_NONBLOCK)`
succeeds and `F_GETFL` reports the flag set, but `read()` still blocks forever.
Interactive commands do work (`PLAYERS`, `SAY` and friends all respond), but
between commands the server is parked inside `read()` rather than in its network
select, so it stops servicing the idle loop — and `QUIT` sets its flag without
the loop ever getting to re-read it, so the server will not shut down. There is
no C-level fix: `poll()` reports the descriptor readable when it is not (see
below) and `ioctl(FIONREAD)` fails with `ENOTTY`. It needs JS-side stdin
handling and is left for a later milestone. `--daemon` skips the console.

**It burns 100% of one core while idle.** Both this and the `poll()` problem
above come from one place — `___syscall_poll` in the generated glue:

    function ___syscall_poll(fds, nfds, timeout) {
      var count = doPollSync(fds, nfds);
      if (!count && timeout != 0) warnOnce('non-zero poll() timeout not supported: ' + timeout)
      return count;
    }

It polls once and returns; the timeout is never waited on, it only decides
whether to warn. And `pollOne` treats any stream without a poll handler —
"regular files, incl. NODERAWFS/NODEFS" per its own comment — as permanently
readable and writable. So `sn_BasicNetworkSystem.Select(1.0f)` returns
instantly with descriptors falsely marked ready, and the idle loop spins. Note
that the warning is *not* printed in this case, because the false-ready
descriptors make `count` non-zero. Memory stays flat. A real yield point would
fix this too, and for the same reason as the socket above it is not coming: the
dedicated link stays Asyncify-free on purpose.

## Playback diagnostic

A one-off cross-check, not part of the build and not a gate: record a session
with the **native** build's deterministic recorder, replay it under wasm, and
see whether the two agree. Run once at M0; nothing here is automated.

**The native build works on modern macOS.** On macOS 26.5 (arm64) with Homebrew
`autoconf` 2.73 and `automake` 1.18.1 — plus the already-present `pkg-config`
and keg-only `libxml2` — `./bootstrap.sh` succeeded and an out-of-tree
`configure --enable-dedicated && make -j8` built clean on the first attempt, no
patches. `bootstrap.sh` prints a wall of obsolescence warnings (`AC_HELP_STRING`,
`AC_TRY_LINK`, `AC_HEADER_STDC`, `AC_CONFIG_HEADER` …); they are noise, not
errors. `libxml2` needs
`PKG_CONFIG_PATH=/opt/homebrew/opt/libxml2/lib/pkgconfig`. The binary lands at
`<builddir>/src/armagetronad_main` — the `armagetronad-dedicated` name is
applied at install time, so do not go looking for it in the build tree. All of
this stays outside the repo: build in a scratch dir, and note that the autotools
output `bootstrap.sh` drops in the *source* tree (`configure`, `aclocal.m4`,
`Makefile.in`, `config.h.in`, `version.m4`, `COPYING`, `ChangeLog`) is already
covered by `.gitignore`.

**The recorder flags are `--record <file>` and `--playback <file>`** (also a bare
`<file>.aarec`, which is inferred as playback) — `tRecorderInternal.cpp:311-337`.

**What can be recorded is narrower than it sounds.** With a dedicated server on
both sides there is no way to record an actual game round. `sg_HostGame()` naps
in a loop until `sg_NumUsers() != 0` (`gGame.cpp:1931`), and `NUM_AIS` does not
help — AI fill happens once a human has joined. Recording a round would need a
graphical client. This port had none at M0 and M1's could not play a round;
**M2's can**, so the wasm half of a round-level comparison now exists. The other
half does not: producing the *native* recording needs a native **graphical**
build, and only the native `--enable-dedicated` build has ever been built here
(see below). That is the remaining piece of work, and it belongs to M5. The
recording used below is still the M0 one:
**boot plus ~30 s of the idle nap loop**: 454 `CONFIG` sections, 61 timer `T`,
60 `READ` / 60 `NETERROR` / 59 `NETSELECT` / 3 `BIND`, 42 `FILE_READ` (all of
them `config/aiplayers.cfg`), 4 `RANDOM`. No cycle physics, no AI, no
trajectory math.

**Result: native and wasm agreed exactly.** Against a native→native playback run
as the control, the wasm playback log is identical line for line, and it is
reproducible across repeated wasm runs. Two differences are expected and
accounted for: the relocation banner described above, and the `Timestamp:` line,
which is live wall-clock rather than replayed (`sg_PrintCurrentTime`, not a
recorded section — the control run shows it differing from the recording too).
Both builds replayed the recorded ephemeral port (`Bound socket to
*.*.*.*:55947`), both printed the same `Uptime: 0 seconds.`, both ended the
recording at the same point with `Recording ends abruptly here, prepare for a
crash!` — the recording was cut mid-loop by the timeout — and neither crashed or
exited afterwards; both kept spinning until killed. `--daemon` did not interfere
with playback.

**Read this for what it is.** It says that config resolution, locale, map
verification through libxml2, and the network idle loop take the same path and
produce the same output under wasm as natively, given identical replayed inputs.
It says nothing about floating-point agreement in the game simulation, because
the recording contains none — the divergence risk in the plan's register is
untested, not retired. Also note that `Uptime: 0 seconds.` only appears when
`tRecorder::IsRunning()` (`gGame.cpp:163`), so a recording or playback run is
one line longer than a plain one; that is the recorder, not a divergence.

## Repository settings, kept as code

The one live finding of the 2026-09-03 security audit was that `main` had no
protection while CI deploys on merge. Protection is a GitHub *setting*, which a
pull request cannot carry, so the setting lives here as `.github/rulesets/main.json`
and `sh web/tools/apply-repo-settings.sh` makes the repository match it (idempotent;
read its header). It requires a pull request and a green PR build check to change
`main`, forbids force-push and deletion, binds the admin too, and turns Dependabot
vulnerability alerts on. The three GitHub actions in use are pinned by commit SHA
with the version as a comment; Dependabot keeps both current.
