# Armagetron Advanced → Browser (Emscripten/WASM port)

## Goal — "the Demo"

Success is **the Demo**: a publicly hosted web page (GitHub Pages) where anyone can play single-player Armagetron vs AI in the browser. Envelope: desktop Chrome + Firefox, keyboard required, ≥30 fps on the maintainer's machine. Safari is a non-target (working there is a bonus, never an obligation); mobile is deferred to Phase 3 (see Future work).

There is **no deadline** — this is a hobby project. Progress is milestone-driven; every estimate below is *relative effort*, not a calendar promise. Shared vocabulary lives in [CONTEXT.md](CONTEXT.md); founding decisions in [docs/adr/](docs/adr/).

## Context

Goal: get Armagetron Advanced (this C++ 3D lightcycle game, [armagetronad.net](http://armagetronad.net/)) running in the browser. Research confirmed **nobody has ported the real C++ codebase to WASM** — prior art is only [Armawebtron](https://github.com/Armawebtron/Armawebtron) (a stalled JS/Three.js rewrite with never-finished networking) and 2020–2021 forum threads where lead dev Z-Man explored web-capable tech (Godot, raylib) without follow-through. The niche is open; the community demonstrably wants browser play. (Decision record: [ADR 0000](docs/adr/0000-port-real-codebase-via-emscripten.md).)

**Decisions:** full Emscripten port of the real source (base: `legacy_0.2.9`, [ADR 0001](docs/adr/0001-base-on-legacy-0-2-9.md)); single-player vs AI is the committed scope; multiplayer via a UDP↔WebSocket bridge is designed but **not committed** (see Future work).

Key facts driving the design: SDL 1.2 (Emscripten emulates natively), no Boost/protobuf/FreeType; fixed-function GL 1.x with display lists **defaulting off** at runtime; no live threads (auth thread has sync fallback); single-player opens no sockets (`nSTANDALONE`); deterministic record/playback system (`tRecorder`) available for validation; the client does ALL network I/O through **one** UDP socket (`nBasicNetworkSystem::controlSocket_`), demultiplexing peers by source address — so one WebSocket per browser client reproduces native behavior exactly.

## Repo setup (done)

This repo (`escapedcat/armagetronad-web`) is a clone of upstream GitLab (`https://gitlab.com/armagetronad/armagetronad`, kept as the `upstream` remote). `main` is based on upstream `legacy_0.2.9` and is the default branch; port work happens on branches off `main`. **`main` is frozen at its current base commit until M5** — no mid-port upstream merges (they would land rebase noise on exactly the files being patched). Tracking resumes after the Demo ships, so upstream fixes merge cleanly and the port could one day be offered upstream as a merge request.

## Strategy summary

| Decision | Choice |
|---|---|
| Build | New hand-written `web/Makefile` + hand-written `src/emscripten/config.h` (precedent: `src/config_ide.h`, `src/win32/config.h`). Autotools not used for wasm. `-std=gnu++14`, `-O2`. Documented in `web/README.md` so a non-C++ dev can drive it |
| Main loop | Keep nested blocking loops; `-sASYNCIFY=1` with yield points in `rSysDep::SwapGL()` / `sr_LimitFPS()` / `tDelay()` — every blocking loop funnels through these. JSPI (`-sASYNCIFY=2`) as an M5 experiment only<br>**M5: WHERE the yield sits inside `SwapGL()` is a visible-quality decision, not an implementation detail.** M1 moved it to the top of the function for a correctness reason that still holds (`sr_glOut` returns early and would skip a yield placed at the end). But the top of `SwapGL()` is also **above** `rPerFrameTask::DoPerFrameTasks()`, which draws the entire overlay layer and nothing else — the HUD, the score panel, the FPS counter, the console. So every frame parked the tab in a `setTimeout` with the world in the drawing buffer and the HUD not yet in it, and the compositor took that window whenever its 60 Hz phase drifted into it. That was the visible flicker the maintainer reported. Moved below the swap block at M5 task 5: on the compositor's own clock over 40.5 s, separate HUD-gone runs **873 → 3** in Chrome and **824 → 3** in Firefox, with runs shorter than 300 ms going **870 → 0** and **822 → 0**. `glFlush()`, not a mutex, is the reason to prefer after-the-swap-block: `sr_netLock` is always NULL in this build. **JSPI was tried at M5 and declined** — see the M5 entry. |
| GL | `-sLEGACY_GL_EMULATION=1` + ~~3 targeted patches (mipmaps, display-list stubs, alpha-test tolerance)~~. Defaults already avoid texgen/infinity-plane/display-lists/ARB-programs (all dead or off). Fallback chain in risk register.<br>**Corrected at M1 and M2.** The "alpha-test tolerance" patch was never needed — alpha test is fully implemented in the emulation and already ran every M1 menu frame. M1 landed two GL patches, not three (mipmaps and display-list stubs), plus `GL_QUAD_STRIP` → `GL_TRIANGLE_STRIP`. What M2 then found is not on this list at all and is larger than everything on it: **one `glBegin`/`glEnd` block gets one vertex format** (`browser-runtime-notes.md` § 10), plus a no-op `gluLookAt`, plus `glDrawElements` rejecting 32-bit indices, plus `SDL_ConvertSurface` failing on a GL surface. |
| SDL | `-sUSE_SDL=1` (SDL 1.2 emulation) + `src/emscripten/eCompat.cpp` stub TU, driven by `-sERROR_ON_UNDEFINED_SYMBOLS=1` |
| libxml2 | Build from source via `emconfigure`, **pin 2.12.x** (last with nanoHTTP), `--with-http` so `LIBXML_HTTP_ENABLED` avoids the `#error` in `tResourceManager.cpp`; runtime HTTP fails gracefully → bundled maps. Recorded fallback: `#ifdef` the `#error`/HTTP call sites and use current libxml2 |
| Assets | `--preload-file` for data (~2 MB); IDBFS mounted at `/persist`; zero path patches via `--datadir /data --userdatadir /persist` (`tDirectories` runtime switches) |
| Threads | None; leave `HAVE_PTHREAD`/`HAVE_LIBZTHREAD` undefined (auth falls back to synchronous in `nAuthentication.cpp`) |
| Network | Compiles unchanged in all milestones (inherited obligation — costs nothing, keeps the Phase 2 door open); connects fail gracefully |
| Hosting | **GitHub Pages.** Deploy = local clean `make` + `npx gh-pages` push; CI automation only once the local flow is boringly repeatable. Pre-approved fallback if M5 compression/size disappoints: Cloudflare Pages<br>**M5 task 4: this recipe, run exactly as written, published a site with no entry point — and reported success.** `npx gh-pages -d dist -f --nojekyll` printed `Published` and exited 0 while publishing the `.wasm`, the `.js`, the `.data`, fourteen stray dotfiles and **neither html file**; the only symptom was a 404 on the page itself. Three things compose to produce it: gh-pages clears the branch by globbing its own checkout and passes globby no `dot` option, so **no dotfile is ever removed**; with the branch absent it creates it with `git checkout --orphan` from the default branch, so the checkout starts as a full copy of `main` — **root `.gitignore` included**, which by the first point survives the clearing; and `git add .` then honours it, silently, and line 63 of that file is a bare `*.html`. The fix is `-v "{**/*,**/.*}"`, A/B'd on **both** gh-pages code paths (branch absent and branch present) because only the first is the first-deploy case: `docs/evidence/m5-deploy/gh-pages-remove-pattern.sh`. Two further things this row does not say and a reader needs. **The entry point is `armagetronad.html`, not `index.html`** — Pages serves a directory URL from `index.html` only, so `web/index.html` exists as a redirect and is copied in at deploy time. And **`local clean make` is load-bearing, not hygiene**: `deploy` publishes `web/dist-m1` as it finds it, that directory is gitignored, `make client` does not clear it, and the live branch accordingly carried 17 probe files nobody meant to ship. `npm run deploy` now asserts its own published set first (`web/tools/check-publish-set.mjs`). |

All source patches `#ifdef __EMSCRIPTEN__`-guarded; native builds untouched. New code in `src/emscripten/` + `web/`.

## Phase 1 milestones (single-player port)

Estimates are relative effort, not calendar commitments.

**M0 — Dedicated server on WASM/Node (2–4 days).** Pure validation milestone: proves toolchain + libxml2 + C++ portability with zero graphics/SDL/Asyncify variables in the mix, so M1 breakage is attributable to graphics, not the toolchain. Runtime is Node.
- New `deps/build-libxml2.sh` (emconfigure, static, no python/threads/zlib, `--with-http`)
- New `src/emscripten/config.h` (dedicated variant): define `DEDICATED`, `HAVE_LIBXML2`, `DONTUSEMEMMANAGER`, all `HAVE_*F` float-math macros (prevents the `defs.h` fallbacks colliding with musl), `HAVE_SELECT/SOCKLEN_T/ISBLANK/WMEMSET/UNISTD_H`; do NOT define `TOP_SOURCE_DIR`, platform macros, thread/curl/krawall macros
- New `src/emscripten/nTrueVersion.h` (`#define TRUE_ARMAGETRONAD_VERSION VERSION`)
- New `web/Makefile` compiling `src/{tools,network,engine,render,ui,tron}/*.cpp` (+ `thirdparty/particles` for client), `-iquote` dirs mirroring `src/Makefile.am`, `-I src/emscripten` first
- Link: `-sENVIRONMENT=node -sNODERAWFS=1 -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1`
- Verify: `--doc` output; boots with map parsed, reaching the idle loop's
  "Nobody there. Taking a nap..." and settling into its `Closing socket bound
  to *.*.*.*:4534` / `Bound socket to *.*.*.*:4534.` re-listen pair — that
  pair, not just the absence of a crash, is the actual passing signal (no
  "Ready for connections" string exists in this codebase); native-recorded
  demo plays back under Node (best-effort)

**M1 — Client links, boots to main menu in browser (4–7 days). ✅ DONE.** Chrome 152 and Firefox 154, WebGL on a real GPU, arrow keys / Enter / Escape all working. Evidence: `docs/evidence/m1-task7/` (20 screenshots, 2 console transcripts); re-runnable as `web/tools/menu-gate.steps`. **Read "main menu" narrowly**: what the client reaches is the language menu and the first-run setup menu, which are the two menus that come *before* the game. `gMenus.cpp`'s main menu — the one with submenus — sits behind a first-run tutorial round, so reaching it is gameplay and therefore M2's. Long-form reasoning behind every patch: `docs/porting/browser-runtime-notes.md`.
- Client config.h variant: + `HAVE_LIBSDL`, `HAVE_SDL_SDL_IMAGE_H`, `HAVE_LIBSDL_IMAGE`, `HAVE_LIBPNG`, − `DEDICATED`
- Patch `src/render/rTexture.cpp`: stub `IMG_InvertAlpha`; `gluBuild2DMipmaps` → `glTexImage2D` (unsized formats) + `glGenerateMipmap`
- Patch `src/render/rSysdep.cpp`: `SDL_Delay`→`emscripten_sleep` in `sr_LimitFPS`; guaranteed `emscripten_sleep(0)` per frame ~~at end of~~ **at the TOP of** `SwapGL()` — THE browser yield point (all blocking loops call SwapGL: `uMenu::Enter`, splash screen, message boxes, connection waits, game loop). *Corrected at M1: `SwapGL()` returns early whenever `sr_glOut` is false — console auto-scroll, recorder frame-skip and fast-forward all clear it — and that return skips everything below, so a yield at the end is missed by exactly the loops that spin hardest. Top-of-function is the only placement that is once-per-call for every caller.* The `sr_LimitFPS` half of this line was right, and the M1 plan's landmine #2 talked M1 out of it for a while; see that entry's correction.
- Patch `src/tools/tSysTime.cpp`: `tDelay` → `emscripten_sleep` (recorder-safe: inside the wrapped functions)
- New `src/emscripten/eCompat.cpp`: stubs (SDL mutex/thread no-ops, `SDL_LoadWAV`/`SDL_BuildAudioCVT` if missing, display-list family `glNewList`… return 0 — lists default off)
- Link: `-sUSE_SDL=1 -sUSE_LIBPNG=1 -sLEGACY_GL_EMULATION=1 -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072 -sALLOW_MEMORY_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=1 -fexceptions --use-preload-plugins --preload-file config@/data/config` (+ language/textures/models/sound/resource/included/webdefaults) `--shell-file web/shell.html`
- New `web/shell.html` (start-overlay for audio unlock + `callMain`, canvas, progress bar) and `web/webdefaults/autoexec.cfg`; `Module.arguments = ['--datadir','/data','--userdatadir','/persist','--userconfigdir','/data/webdefaults']`. Note `-sEXPORTED_RUNTIME_METHODS=callMain` is required: Emscripten does not export `callMain`, and without it the start button aborts the runtime on click. *(**The start overlay was removed at M5 task 5, and the reason this line gives for it did not hold.** The button was carried through four milestones as the user gesture that unlocks audio. It is not needed for that: Emscripten resumes the AudioContext on the first **keypress**, and this game cannot be played without one. Measured rather than argued — with the button gone, M3's audio gate is **25/25 in Chrome and in Firefox**, including A7c (the menus are exactly silent before round 1) and A9 (every buffer in the window was handed to a `running` AudioContext). `callMain` is still exported and still required; it is now called from `onRuntimeInitialized` instead of from a click. The page also sizes its canvas from the viewport before boot rather than shipping a fixed 1024x768. `?autostart=0` is new public surface that restores the old wait-for-a-call behaviour.)*
- **Carried forward from M0 — two things this milestone must not re-derive:**
  1. `-fexceptions` is mandatory in **every** configuration, at compile *and* link (it is in the list above for that reason). Emscripten's default silently discards every `catch`, and this codebase uses exceptions as control flow, so the first `throw` aborts the process. Full argument in `web/Makefile`; it costs ~827 KB of wasm. *(Corrected at M5 task 2: **+827 KB is the DEDICATED, non-Asyncify figure** — `web/Makefile` says so in its own comment, and it is right about that build. On the **client** the cost is far higher, because Asyncify instruments the unwinder too and the two multiply: **+2,402,246 bytes (+37.09%)** at the pre-M5-task-2 link settings and **+1,231,132 (+39.71%)** at the shipped `-O2 -sASSERTIONS=1` settings. Measured by recompiling all 102 client translation units with `EXCEPTIONS` empty and relinking: `docs/evidence/m5-o2-assertions/measure-fexceptions-cost.sh`.)*
  2. **Asyncify is load-bearing for sockets, not just for frame pacing.** M0 found the server binds port 4534 and then nothing is reachable on it: the game loop runs synchronously inside `callMain()` and never returns to Node's event loop, so the socket never reaches its `listening` event. The yield point in `SwapGL()` is what lets *any* async I/O complete — not merely what keeps the tab responsive. (`web/README.md`, "Known limitations at this milestone".)

**M2 — Playable single-player vs AI (3–5 days). ✅ DONE.** Three complete rounds against three AI opponents, arrow keys steering, in Chrome 152.0.7977.65 (headed) and Firefox 154.0.1 (headless) on macOS 26.5 / Apple M1 Max. Frame rate measured in-page over the full span of the rounds: per-whole-second median 60 / minimum 53 (Chrome) and 59 / 56 (Firefox) against the ≥30 bar. Evidence: `docs/evidence/m2-gate/` (41 files); the arbiter is `check-transcript.mjs`, which exits non-zero. Re-verified from a `make clean` rebuild at M2 exit, with the dedicated wasm still at 2,488,298 bytes. *(Annotated at M4 task 3: that check was **size-only**, which is now known insufficient — an unguarded change can link to exactly this size with a different md5. Not restated as a stronger claim here, because size is what M2 actually checked. The md5 is `9718a2a64978cb6e9b95ea2f0454cca5` and is unchanged today, so nothing is known to be wrong; it simply was not the check. See the M4 note below.)*

> **Read the result narrowly, in four ways.**
>
> 1. **The match measured is the *tutorial* match** — the one a first-time visitor gets. `welcome()` (`gArmagetron.cpp:378-395`) temporarily lowers speed and arena size and caps wall length for it. Those are tutorial-parameter frame rates; a busier arena would be slower. What `welcome()` does **not** touch is `numAIs` or `limitRounds`, which is what keeps "three AIs" attributable to `SP_NUM_AIS 3` and "three rounds" to `SP_LIMIT_ROUNDS 3`.
> 2. **The worst *single* frame is below 30 fps in both browsers** — 43.8 ms (22.8 fps) in Chrome, 41.0 ms (24.4 fps) in Firefox. The gate is about a frame *rate* and the rate clears the bar comfortably; the hitch is real and is recorded rather than smoothed away.
> 3. **Nobody has played it.** Every run has been scripted. Nothing here says the game feels right. (The camera *was* permanently top-down when this was written; M5 task 2b fixed it — see the M5 row below.)
> 4. **One machine, one GPU, two browsers.**
>
> **Where this plan was wrong.** The playtest sentence below — "fix LEGACY_GL fallout (watch-list: alpha test, fog modes, GL_QUADS paths, GL_LUMINANCE font atlas)" — was **four-for-four wrong**, exactly as the M2 plan's landmine #3 predicted, and that prediction held up under execution. Alpha test was already fully implemented and ran every M1 menu frame; fog is commented out (`gGame.cpp:1766-1772`); `GL_QUADS` was fine and the `GL_QUAD_STRIP` fix had already landed in M1; the `GL_LUMINANCE` font atlas is unreachable because M1's texture patch covers it. Not one hour of M2 was spent there.
>
> What M2 actually was: five runtime blockers in sequence — (1) a NULL-returning WAV stub aborting round entry, (2) `SDL_ConvertSurface` on a GL surface whose canvas Emscripten had already freed, (3) `glDrawElements` with 32-bit indices, (4) a `glBegin`/`glEnd` block whose vertex format changed part-way through, (5) keycodes. **Three of the five are not GL at all, and the two that are are not *gaps* in `LEGACY_GL_EMULATION` — they are rules it enforces that real OpenGL does not** (real GL accepts 32-bit indices and lets a `glBegin`/`glEnd` block mix vertex formats). Number 4 turned out to be a whole class of defect rather than one bug, including a variant that renders wrong geometry without asserting; it is written up as `docs/porting/browser-runtime-notes.md` § 10 and it is the thing to read before touching the renderer.

`web/webdefaults/autoexec.cfg`: ~~`MAX_FPS 60`~~, `INFINITY_PLANE 0`, `USE_DISPLAYLISTS 0`, ~~`SOUND_BUFFER_SHIFT 3`~~ ~~**`SOUND_BUFFER_SHIFT 1` since M3**~~ — 3 costs a measured 974 ms of audio latency against 1's 278 ms, with zero starvation at either. **Since M4 task 3, neither `MAX_FPS` nor `SOUND_BUFFER_SHIFT` is in this file:** both are player preferences, and anything in this file beats `user.cfg`, so the player could change them and never keep the change. They are now compiled defaults (`sr_maxFPS` in `rSysdep.cpp`, `buffer_shift` in `eSound.cpp`) and M3's table moved to the latter. See the M4 landmine list below. **The filename is load-bearing.** M1 established that `settings_web.cfg` — the name this plan originally specified — is opened by no code path at all (`tConfiguration.cpp:959-1000`), so every one of those settings would have silently never applied. `autoexec.cfg` is loaded unconditionally from the highest-priority config path. Two consequences to respect: `/data/webdefaults` **replaces rather than merges**, so never put a `settings.cfg` or `keys_*.cfg` there; and it loads *after* `user.cfg`, making everything in it a hard override a user cannot change back — right for `USE_DISPLAYLISTS` and `INFINITY_PLANE`, and the reason `MAX_FPS` and `SOUND_BUFFER_SHIFT` had to leave. **M2's first commit, before any rendering work: un-mute the WebGL error console.** M1's client emits 256 `INVALID_ENUM` errors in its first second and exhausts Chrome's per-context WebGL error budget 1.4 s into boot; after that Chrome reports *no* WebGL errors for that context, permanently. M2 is the milestone that debugs gameplay WebGL, and it would otherwise do it blind. One line causes it — `rScreen.cpp:1099`, a `glHint` target WebGL does not accept, called once per menu frame. `docs/porting/browser-runtime-notes.md` § 9 has the cause, the fix shape, and why the clean Firefox transcript is a harness artifact rather than evidence of a clean run. Second known item, also inherited from M1: `config/keys_cursor.cfg` binds SDL 1.2 numeric keycodes (274/275/276) while Emscripten emits 1105/1103/1104, so default arrow-key *steering* silently does not fire — menu navigation uses `SDLK_*` and is unaffected, which is why M1 passed without noticing. Then playtest and fix LEGACY_GL fallout (~~watch-list: alpha test, fog modes, GL_QUADS paths, GL_LUMINANCE font atlas~~ — **all four wrong, see the correction above; the real watch-list is `browser-runtime-notes.md` § 10, "one glBegin/glEnd block, one vertex format"**). ~~Verify text entry/key names for binding menu.~~ **Done and deliberately not fixed:** Emscripten's `SDL_GetKeyName` names only `a-z` and `0-9` (`libsdl.js:1754-1764`), so the binding menu renders blanks for arrows, Escape, Enter, Tab and the F-keys. Rebinding still works; it displays nothing. Deferred to M4 rather than patched blind — see M4's inherited list. Gate: 3 full rounds vs 3 AIs, ≥30 fps on the maintainer's machine, Chrome+Firefox — **met**.

**M3 — Audio (1–3 days, droppable). ✅ DONE.** ~~SDL1 `fill_audio` callback via Web Audio; implement PCM WAV load/convert in eCompat.cpp if the JS library lacks it (~80 lines; only 2 WAVs matter);~~ buffer size via `SOUND_BUFFER_SHIFT`; ~~unlock on start-overlay click.~~ **Escape hatch: if audio exceeds its timebox, the Demo ships muted (with a "sound coming soon" note) and audio becomes a post-launch fix. Audio never blocks shipping.** — not needed; the escape hatch was not taken.

> **What shipped, stated as narrowly as the evidence supports.** **Non-zero PCM reaches `SDL.audio.pushAudio`** through a real three-round match in both engines: Chrome 853/1021 buffers in the measurement window, Firefox 850/1014, and *every buffer of every round* in both. Peak 5467/32768 (Chrome) and 5145 (Firefox). A control bundle whose two WAVs cannot be decoded reads 0/1020 over the same call count at the same latency. Evidence: `docs/evidence/m3-audio/`; the arbiter is `check-audio-transcript.mjs`, 24 checks, exit status not prose, with `prove-checks-can-fail.mjs` showing every one of the 24 can fail. Re-verified at M3 exit from a `make clean` rebuild — both engines pass, dedicated wasm still 2,488,298 bytes, client wasm byte-identical to the build the evidence was taken against. *(Annotated at M4 task 3: the **wasm** half of that was size-only and is now known insufficient. M3 is nonetheless the least exposed milestone to this, because every one of its tasks additionally compared the `eSound.o` **object** md5 — `aca51a511f51fdee88a45a64b3bee59b` — against a base compile, which is a stronger check than either. Left as written; the weaker sentence is what M3 claimed.)*
>
> **Read it narrowly, in four ways.**
>
> 1. **`pushAudio` is *upstream* of the Web Audio graph.** It is the function that creates an `AudioBufferSourceNode`, fills it from the heap and calls `start()`. Whether the graph rendered anything and whether a device played it is outside the instrument entirely.
> 2. **Nothing assesses whether the mix is correct.** Pitch tracking, panning, relative levels, the 11025 → 22050 Hz resample: all unassessed.
> 3. **Nobody has heard it.** No audio was captured to a file; no human listened. The harness *guarantees* the output end is silent — Chrome runs `--mute-audio`, Firefox headless.
> 4. **One machine, one GPU, two browsers**, and one committed run per engine. The peak in particular is a scale, not a constant: it has measured 4593, 5145, 5349, 5467 and 6298 on this same build. The *shape* is what has been stable.
>
> **Where this plan was wrong.** Four items, corrected inline rather than deleted, because the wrong version is what a reader may already have acted on:
>
> - **"~80 lines" for the parser: it is ~50.** No format conversion is needed — both WAVs are 8-bit unsigned mono PCM and the existing `AUDIO_U8` path in `eWavData::Load` already skips conversion, with the mixer resampling itself.
> - **"in eCompat.cpp": no.** The parser is a static `SDL_LoadWAV` inside `eSound.cpp` using `fopen`. It *cannot* live behind `SDL_LoadWAV_RW`, because Emscripten's `SDL_RWFromFile` returns a JS array index rather than a struct and never fails — see the correction to the M2 note below.
> - **"unlock on start-overlay click": `web/shell.html` needed no change.** A *trusted* click already gives `audioContext.state: "running"` with zero warnings. M2's five `AudioContext was not allowed to start` warnings were a **harness artifact**: the driver clicks via `Runtime.evaluate`, which is not a user gesture. That is not a cosmetic detail — it is why the gate windows its measurement to the first *trusted* keydown, and why a naive continuity assertion over the whole run would fail in Firefox for a reason having nothing to do with the game.
> - **`SOUND_BUFFER_SHIFT 3` (recommended below under M2) ships as `1`.** At this port's 22050 Hz device, shift 3 costs a measured **974 ms** of latency; shift 1 costs 278 ms. Latency and starvation tolerance are the *same number* here, so it is a real trade: zero starvation was measured at every value 0–3, and shift 1 was chosen because it gives 2.0–2.4× margin over the worst observed main-thread stall where shift 0 gives about 1.1–1.4×. The full argument, with the table, is in `web/webdefaults/autoexec.cfg` itself. Note the reason upstream's own default of 0 does not transfer: native SDL 1.2 runs `fill_audio` on its own audio thread, so a stalled main thread costs the device nothing; Emscripten has one thread, where every main-thread stall *is* an audio stall.

> **Inherited from M2 — three things, all in `src/engine/eSound.cpp` and `src/emscripten/eCompat.cpp`.** M2 shipped silent on purpose: `eWavData::Load()` short-circuits with `loadError = true` under Emscripten, because the WAV loader is a NULL-returning stub and without the short-circuit a missing WAV throws out of `sg_EnterGameCore` and makes it impossible to enter a round at all. ~~That block is M3's to delete, and the comment at the site says so.~~
>
> > ### ⚠️ CORRECTED BY M3 — this was the dangerous one. Do not delete that block.
> >
> > The short-circuit had to be **replaced, not removed**, and anyone acting on the struck-through sentence would have shipped a process abort. Deleting it re-arms the `throw tGenericException` calls in `eWavData::Load` on the `fill_audio` → `eSoundPlayer::Mix` → `eWavData::Mix` → `Load()` path. `fill_audio` runs **at the completion of every Asyncify rewind, with wasm on the stack** — measured during M3 reconnaissance at `Asyncify.state == Normal` in 750/750 samples — and Emscripten's `callUserCallback` turns an exception escaping a callback into a **process abort**, not a caught error. So nothing reachable from `fill_audio` may throw *or* sleep. What M3 shipped is a guard that fails the *load* (still setting `loadError = true`) without throwing, with a real parser behind it.
> >
> > That path is not hypothetical or rare. Every `eWavData` names a moviepack file first and only then a `sound/` fallback, and `moviesounds/` does not exist in this tree and is not preloaded — so the **missing-file path runs on every single load, before any successful one**. Whatever the loader does when `fopen` fails is the common case.
>
> Then:
>
> 1. **`eSoundPlayer::Mix` never retires a silent voice.** With no data, `eWavData::Mix` returns `false`, and `eSoundPlayer::Mix` does `return goon[viewer] = !wav->Mix(...)` — so `goon` stays `true` forever instead of going false the way a finished sound would set it. Each such call also increments `real_sound_sources`, which is the input to the `loudness_thresh` voice limiter (~~`eSound.cpp:138-160`~~ — **line citation rotted; the limiter is in `se_SoundMix`, and `loudness_thresh` is greppable**). It is harmless while nothing plays; it is a real bug the moment sounds do, and it is invisible today. **Fixed by M3 task 2**, and the limiter now reports itself: `[SND] live voices peaked at 9 (SOUND_SOURCES 10, loudness_thresh 0.0000)`.
> 2. **Three of the four audio stubs in `eCompat.cpp` are now dead code.** With the `Load()` short-circuit in place, no client object has an undefined reference to `SDL_LoadWAV_RW`, `SDL_BuildAudioCVT` or `SDL_ConvertAudio` (checked with `llvm-nm` over `web/build-m1/**/*.o`). `SDL_FreeWAV` is still referenced, by `eSound.o`. So M3 is not editing live code when it replaces those three — it is replacing stubs nothing calls, ~~and it must make them reachable again as part of the same change.~~
>
> > ### ⚠️ CORRECTED BY M3 — only one of the three changed status, and it changed the other way.
> >
> > **`SDL_LoadWAV_RW` did not become reachable; it became *deletable*.** It cannot be implemented in C at all: Emscripten's `SDL_RWFromFile` returns a **JS array index**, not a pointer to a struct, and never fails — so a C function receiving an `SDL_RWops*` has nothing it can legally dereference. M3's parser therefore sits behind `eSound.cpp`'s own static `SDL_LoadWAV( char const *, ... )` and uses `fopen` directly, bypassing RWops entirely.
> >
> > **`SDL_BuildAudioCVT` and `SDL_ConvertAudio` are now unreachable *by construction*, and correctly still return −1.** No conversion is needed: both shipped WAVs are 8-bit unsigned mono PCM, which `eWavData::Load`'s existing `AUDIO_U8` path skips conversion for, and the mixer resamples itself. Making them "reachable again" was never the goal and would have meant writing code with no caller.
> >
> > The one mandatory `eCompat.cpp` edit was the fourth stub: `SDL_FreeWAV` → `free()`. Note the shape of the original error — the plan generalised from one stub to all three in the same sentence, and only the one it did not name individually turned out to be the live one.
> 3. **The `memset` at the top of `fill_audio` must become *conditional*, never deleted.** It exists because Emscripten's SDL 1.2 hands back the same un-zeroed `malloc`ed buffer every callback while every mixing path only *adds* into it — so with nothing loaded, uninitialised heap gets scheduled into the Web Audio graph as audio. But `fill_audio` has a second registration: `Mix_SetPostMix(&fill_audio, NULL)`, in **`se_SoundInit`** (~~`eSound.cpp:270`~~ — **that line citation has since rotted twice; grep the symbol**), and the comment at the `memset` says so and explains why. A *post*-mix callback receives a buffer that already holds SDL_mixer's output, and zeroing it there would silence the music. That path is dead today (it is inside `#ifdef HAVE_LIBSDL_MIXER`, which nothing in this build defines) — which is exactly why one unconditional `memset` is safe *now* and stops being safe the moment M3 reaches for SDL_mixer. **Done as specified by M3 task 2** — this is the one of the three the plan got exactly right.
>
> > ### Added by M3 — a fourth thing, and it is live rather than latent.
> >
> > **A `data != NULL, samples == 0` `eWavData` is constructed and mixed every round.** There are **six** `eWavData` constructions in the tree, not the four M3's own reconnaissance counted: `gCycle.cpp` (`cycle_run`, `turn_wav`, `scrap`), `gExplosion.cpp` (`explode`), and `gGame.cpp` (`intro`, `extro`). The two `gGame.cpp` ones name a moviepack file with **no `sound/` fallback**, so they take `eWavData::Load`'s *other* retry arm — which is upstream code, not this port's: it loads `sound/expl.wav` as a stand-in and then deliberately sets `len = 0`, upstream's silent-placeholder idiom.
> >
> > On that shape, `eWavData::Mix`'s `while (goon)` loop **cannot terminate when `loop` is true**: the inner loop cannot advance with `samples == 0`, so `pos.pos >= samples` is always true and `pos.pos -= samples` subtracts nothing. That is an infinite loop *inside the audio callback* — a frozen tab, not a muted one. M3 closed it with a guard in `eWavData::Mix`. It was latent anyway behind `eSoundPlayer`'s `loop` defaulting to false, and the only looped sound (`cycle_run`) loads successfully — but **the shape itself is live and is constructed every round**, so it is one config change from mattering. Do not remove that guard on the grounds that nothing loops today.

**M4 — Persistence + shell polish (2–3 days).** IDBFS mount + `FS.syncfs` on `st_SaveConfig` (`tConfiguration.cpp`) — the load-bearing sync point — and best-effort on `beforeunload`; verify name/keybinding survive reload; fullscreen button; hide/fix resolution menu if `SDL_SetVideoMode` resize misbehaves. Touch devices get a friendly "needs a keyboard" note instead of a broken canvas.

> **M4 — DONE (tasks 1–5), merged as PR #5. Settings and key bindings survive a page reload in Chrome and Firefox.**
>
> **What shipped, stated as narrowly as the evidence supports.** `/persist` is an IDBFS mount populated *before* `main()` runs; the game saves when the player leaves a menu; and two settings that were silently reverted on every load are compiled defaults a player can now override. The arbiter is `docs/evidence/m4-persistence/check-milestone-transcript.mjs` — 22 checks, exit status not prose — with `prove-milestone-checks-can-fail.mjs` flipping all of them under **set equality**, so collateral must be declared rather than tolerated. Its negative control fails **exactly three, one per assertion**, so wiping IndexedDB breaks each claim independently rather than collapsing them. Three further task-scoped gates back it: `m4-persist/` (the mount), `m4-persist-settings/` (the save), `m4-config-precedence/` (the defaults, plus a byte-identity gate). Re-verified at M4 exit from a clean rebuild of all 100 dedicated TUs: **2,488,298 bytes and md5 `9718a2a64978cb6e9b95ea2f0454cca5`**, all four checkers at their expected exits, all four provers passing, byte-identity gate 8/8 controls.
>
> **This entry was wrong in five places, and each was disproved by measurement rather than argument.** Annotated, not rewritten — the wrong version is what a reader may already have acted on.
>
> 1. ~~"`FS.syncfs` on `st_SaveConfig` — the load-bearing sync point"~~ implies C++ must call something. **It does not.** IDBFS `autoPersist: true` hooks `stream_ops.close`, and `st_SaveConfig` writes through a `std::ofstream` whose destructor closes the fd — so the save *is* the sync trigger and `tConfiguration.cpp` was never touched. The mount point is `/persist` (from `--userdatadir`), not the `--userconfigdir` this line's emphasis pointed at; `/persist` is outside the preloaded MEMFS entirely and collides with nothing.
> 2. **The premise that settings are never saved was false.** `st_SaveConfig` has a dozen call sites tree-wide (ten compiled by any build here, eleven in the browser client, thirteen after M4 adds its own — count them on a stated basis, this milestone got it wrong twice). `sr_InitDisplay` and `lowlevel_sr_InitDisplay` call it unconditionally on **every boot** — a crash detector persisting `FAILED_ATTEMPTS` — plus every resolution change. The `SDL_QUIT` path in `filter` is one lost site, not the save. The real gap was narrower: nothing saved after a settings-*menu* change, so an edit stayed volatile until some unrelated event flushed it.
> 3. ~~"best-effort on `beforeunload`"~~ survives as a **backstop that is provably not load-bearing** — a control build with both unload handlers disabled passes the settings gate 18/18. It cannot be the mechanism: measured, `beforeunload` persists up to ~500 KB of delta and at 2 MB loses the **entire batch**, including small files written in the same handler, and an explicit `FS.syncfs` does not rescue it. And `pagehide` — the hook conventional advice prefers — is **strictly worse**: measured twice, the handler runs, the write reaches MEMFS, and the data is lost.
> 4. ~~"hide/fix resolution menu if `SDL_SetVideoMode` resize misbehaves"~~ — **it does not misbehave.** Measured: four mode changes, canvas resizes, GL context and textures survive, error queue clean. Do not hide it. Note `sr_ReinitDisplay` is a *separate* question and remains untested — see M5's inherited list. *(M5 task 4c: tested, and it works.)*
> 5. The binding-menu blank-key-names item this milestone inherited **was never true**; the fix landed in M2 task 6, 1h45m before `web/README.md` declared it outstanding. Struck through in place there.
>
> **Not done, and not claimed:** the fullscreen button, and the touch-device "needs a keyboard" note. Both are still open items of this entry.
>
> **M5 status of those two, at Phase 1's close. One is half done; the other was never built.**
>
> - **Fullscreen: half.** M5 task 5 made `TOGGLE_FULLSCREEN` ask the *browser* for fullscreen instead of resizing the canvas to a stored value, and the user gesture survives Asyncify — which was the open question. **`n` enters and leaves browser fullscreen and the canvas is unchanged**, against a control build (`client-fullscreentoggle`) that moves the canvas to 640x480 on the same keystroke, which is what makes the shipped result mean anything. **But `f` never reaches `toggle_fullscreen_func` at all**, and it is the key the maintainer named. Diagnosed as far as: DOM keyCode 70 → SDL keysym 102, `KEYBOARD 102 PLAYER_BIND TOGGLE_FULLSCREEN 0` **is** in the persisted `user.cfg`, and the function is not entered — not even with `x <= 0` — while keysym 110 on an identical line enters it twice. **Pre-existing**: the control build behaves the same. First suspects are `config/keys_cursor.cfg` and `keys_cursor_single.cfg`, which both rebind 102. Unresolved.
> - **The touch-device "needs a keyboard" note was never built, in M4 or in M5.** It is not deferred to Phase 3 by anyone's decision; it was simply never done, and this entry promised it. A visitor on a phone today gets the canvas and no way to play it and no explanation. It is the cheapest open item in this document — it is a page change in `web/shell.html`, no C++ — and it is the only one that affects a visitor who did nothing wrong.

>
> **The resolution question is half answered, and the answered half is the one the gate needed.** Picking a resolution in Screen Mode and letting it take effect on the *next* page load works in both engines — `SDL_SetVideoMode` resizes the canvas to 320×200 and the game renders and plays there (`docs/evidence/m4-persistence/`, check M14). **"Apply Changes" was deliberately never pressed**, so `sr_ReinitDisplay` — `sr_ExitDisplay` followed by a second `SDL_SetVideoMode`, i.e. tearing down and rebuilding a live WebGL context mid-run — is still completely untested in this port. Do not read M14 as evidence that it works. That is the half that could still need hiding.
>
> **ANSWERED, M5 task 4c (`docs/evidence/m5-defect-a-resolution/`).** `sr_ReinitDisplay` was pressed. It **works**: the canvas resizes live, `isContextLost()` stays false, no `webglcontextlost` fires, 0 GL errors in 3832 polls, and the game then plays two full rounds at the new size. It does not need hiding for safety. The defect the maintainer actually hit is the **other** row: `sg_ScreenModeMenu` builds "Window Size" last, so `uMenu`'s reverse render order makes it the **top row and the one the cursor lands on**, and `lowlevel_sr_InitDisplay` reads `currentScreensetting.res` when fullscreen is set — this port runs `FULLSCREEN 1` — so `windowSize` is never read. Set it to 320x200, Apply, leave the menu, reload: the canvas never moves. And 1024x768, the maintainer's own choice, is a no-op even on the working row, because `web/shell.html`'s canvas is already 1024x768. Hiding is therefore **tidy, not urgent**.

> **Inherited from M1 and M2 — four things.**
>
> 1. **`st_SaveConfig()` never runs on tab close.** The `SDL_QUIT` case that calls it lives in the SDL event *filter* (`gArmagetron.cpp:502`), and M1 could not install that filter: `SDL_SetEventFilter` is a no-op in Emscripten's SDL and its only replacement, `emscripten_SDL_SetEventHandler`, *replaces* polling rather than filtering it — installing it would starve `su_GetSDLInput`'s `SDL_PollEvent`. The reasoning is at `gArmagetron.cpp:820-846` and the loss is called out there as an explicit M4 obligation. `beforeunload` is the browser-side substitute the plan already names; it needs to reach `st_SaveConfig`, not just `FS.syncfs`.
> 2. **Everything in `web/webdefaults/autoexec.cfg` is a *hard override*, not a default** — the opposite of what the directory name suggests. That file loads *after* `user.cfg`, so once persistence lands, a player who changes `MAX_FPS` in the in-game menu will have it silently reset to 60 on every load with no way to make it stick. Right for `USE_DISPLAYLISTS` and `INFINITY_PLANE`; wrong for `MAX_FPS`; `CONSOLE_LADDER_LOG 1` and the three `SP_*` gate settings are in the same position and should be reconsidered as a set. (`SP_LIMIT_ROUNDS` is a `tSettingItem`, so it is read from config but never written back to `user.cfg` — that one is fine either way.) Also: `/data/webdefaults` **replaces** a same-named file rather than merging with it, so never drop a `settings.cfg` or `keys_*.cfg` in there.
>
>    **M3 added a second entry with exactly this problem: `SOUND_BUFFER_SHIFT 1`.** It is reachable from the in-game sound menu, so the moment persistence lands, a player who changes the audio buffer size will have it silently overwritten on every load — the same failure as `MAX_FPS`, and now there are two. Handle them together. Note the asymmetry when deciding: `MAX_FPS` and `SOUND_BUFFER_SHIFT` are *player preferences* that happen to have port-specific good defaults, whereas `USE_DISPLAYLISTS` and `INFINITY_PLANE` are *correctness* settings a player must not be able to break. Only the first kind should become soft.
>
>    **DONE, M4 task 3.** Both moved out of `autoexec.cfg` and into the binary as compiled defaults under `#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )` — `sr_maxFPS` in `rSysdep.cpp`, `buffer_shift` in `eSound.cpp`, with M3's measured latency/starvation table carried across to the new site. Both menu-reachable claims were verified in source and one of them end to end: a player-chosen `MAX_FPS 30` now survives two page reloads, and the same wasm relinked with the two lines put back reverts it, which is the before/after (`docs/evidence/m4-config-precedence/`). `INFINITY_PLANE` and `USE_DISPLAYLISTS` stay as hard overrides, deliberately. `CONSOLE_LADDER_LOG` and `SP_LIMIT_ROUNDS` need no action — both are `tSettingItem`, never written back to `user.cfg`, so there is no player choice for them to overwrite. **`SP_NUM_AIS` and `SP_AUTO_AIS` still have the defect and were left alone on purpose:** they are `tConfItem` and `gGameSettings::Menu()` is reachable on `singlePlayer` via `GameSettingsSP()`, but they are what pins the M2/M3 gates to three AIs regardless of the saved profile a run starts from. Revisit if they ever stop being gate scaffolding. Two byte-level facts M5 should not have to rediscover: the dedicated wasm's **size alone does not detect this class of change** (an unguarded build links to exactly 2,488,298 bytes with a different md5 — always quote the md5), and object **order** on a link line moves the output by hundreds of bytes, so any control link must substitute objects in place rather than append them.
> 3. **Task 6's keycode translation is idempotent by construction, so `user.cfg` round-trips safely.** `su_TranslateSDL12Keysym` (`uInput.cpp`) re-encodes SDL 1.2 keysyms as they are read from a `.cfg`; its source range (256-312) and target range (1081-1255) are disjoint, so a value this build already wrote passes through untouched. A player who rebinds turn-left onto the left arrow gets 1104 saved and 1104 restored — reading our own output is a no-op, not a second translation. M4 does not need to do anything about this; it needs to *not* break it. **Measured at the M4 milestone gate, so it is no longer "by construction":** boot 2's `user.cfg` carries `KEYBOARD 1104 PLAYER_BIND CYCLE_TURN_LEFT 1` and `1103` for right, in a boot that loaded neither `default.cfg` nor any `keys_*.cfg` — and the arrow keys demonstrably steer there. `docs/evidence/m4-persistence/`, checks M7, M12 and M17. That is the only test of this round trip anywhere in the project; treat those three as the regression guard if `uInput.cpp` is touched again.
> 4. **The binding menu renders blank key names**, deferred here from M2. `SDL_GetKeyName` in Emscripten names only `a-z` and `0-9` (`libsdl.js:1754-1764`), so arrows, Escape, Enter, Tab and F-keys display as empty strings. Rebinding works. It matters more once settings persist, because that screen is where a player fixes a binding they can now save.
> 5. **Inherited from M3 — the cockpit HUD's first draw is erratic, and it is unexplained.** Screenshotting 5.5 s into a round finds the instrument panel present in anywhere from one round of three to three of three, and **in Chrome it varies between runs of the same script on the same build**: four runs scored 1/3, 1/3, 3/3, 1/3. It is not an M3 regression — the M3 build reaches 3/3. Measured with `docs/evidence/m3-audio/cockpit-band.mjs` over 39 committed driving frames.
>
>    **Record the refuted hypothesis beside it so nobody re-proposes it: M3's per-callback mixing *cost* is not the cause.** A silent bundle removes exactly that work — `eWavData::Mix` returns before its resampling loop when no WAV decodes — on a **byte-identical wasm**, and still scores 1/3. Read that narrowly: it refutes the mixing *cost*, not "audio work on the main thread", because the callback, the open device and `pushAudio` all still run at 21.5/s under that lesion. And it is one run against a stochastic phenomenon, so it excludes a *deterministic* mechanism only. Characterising this properly needs a **rebuilt M2-era client** to compare against, which M3 did not do — the M2-era 3/3 is itself a single run from committed evidence. This sits on M4/M5 rather than M4 alone; whoever gets to it first should do the rebuild before theorising.
>
> **M5 tasks 4c and 5: a flicker in this area was reproduced, mechanised and largely fixed — but read carefully, because it is probably NOT the same phenomenon as the paragraph above, and this entry must not be allowed to read as closed.** What M5 chased was the maintainer's own report that the HUD and the FPS counter blink during play. The cause is neither of the two hypotheses anyone had proposed — not § 10, not audio work on the main thread — and there is no GL error involved. `rSysDep::SwapGL()` yielded to the browser **above** `rPerFrameTask::DoPerFrameTasks()`, and `DoPerFrameTasks()` is the entire overlay layer and nothing else: `display_hud_subby_all` (`gHud.cpp`, including `display_fps_subby`), `sr_ConsolePerFrame` (`rConsoleGraph.cpp`) and `scores` (`ePlayer.cpp`). Every frame therefore parked the tab in a `setTimeout` with the world drawn and the HUD not drawn, and the compositor sampled that state whenever its phase drifted into the window. The world geometry never flickered because it is already in the buffer at the yield — which is exactly what the report said. **Moving the yield below the swap block fixed the short blinks: on the compositor's clock over 40.5 s, runs shorter than 300 ms went 870 → 0 in Chrome and 822 → 0 in Firefox.** *(`docs/evidence/m5-defect-b-hud-flicker/`, and M5 task 5.)*
>
> **Three ~1.5 s HUD-off stretches per 40 s remain, they were 3 before the fix and are 3 after it in both engines, and nobody has established what they are.** They begin ~515 ms after each `ROUND_SCORE`/`NEW_ROUND` triple, so "the game legitimately hides the HUD at a round transition" is the obvious reading and it is a hypothesis, not a measurement. **The maintainer has not reported back whether the flicker they were seeing is the short kind (fixed) or the long kind (untouched)**, and until they do, this is open. Note also that the M3 phenomenon this item was originally about is a *first-draw* question sampled once at 5.5 s, whereas M5 measured *continuous* presence over whole rounds; they may well be different things, and the rebuilt-M2-client comparison this entry asks for was still never done. Three of M5's own probes returned clean negatives before the right one worked, all three wrong for the same structural reason — they sampled at the game's swap, where the frame is always complete — and are kept as `docs/evidence/m5-defect-b-hud-flicker/negative-swap-time-only/` so nobody repeats them.

**M5 — Validation, perf, packaging, launch (3–5 days).** Native-recorded demo playback in wasm build (best-effort diagnostic, not a gate); profile Asyncify overhead; try JSPI variant (check browser support at that time); brotli/size work (~8–15 MB wasm expected — note M0 measured `-fexceptions` alone at **+827 KB uncompressed, ~+50% of that build's wasm**, and it is mandatory in every configuration; JSPI would be the way to trade it back for `-fwasm-exceptions`) *(**Both halves of this line were overtaken at M5.** The +827 KB is M0's **dedicated** measurement and under-reports the client by 1.58 MB — see the corrected figures under M1 above. And the size work did not need brotli or JSPI: M5 task 2 put `-O2 -sASSERTIONS=1` on the client link and the wire total went **4,097,666 → 1,707,754 bytes gzipped**, 3.91 MiB → 1.63 MiB against a 15 MB budget. M5 recon dropped brotli — GitHub Pages serves gzip only, brotli buys 379 KB and needs a Cloudflare-proxied custom domain — and declined JSPI: it links and is 80% smaller, but Emscripten 6.0.8's `libsdl.js` pushes to `Asyncify.sleepCallbacks` under `#if ASYNCIFY` while that array exists only under `#if ASYNCIFY == 1`, which kills M3's audio.)*; confirm network menus fail gracefully *(**done at M5 task 3, over `https:` as well as `http:`** — the route is Play Game → Multiplayer → Online Multiplayer, and it ends at the game's own "Sorry, no server found :-(" on both schemes, in Chrome and Firefox, with the client alive afterwards. Over HTTPS every `ws://master*` attempt is blocked as mixed content and the game's 0.25 s login resend turns 4 attempts into ~98 in 20 s, but **nothing visible changes** — the wall clock is set by `sn_Connect`'s 5 s per-master timeout, not by how the socket fails. Examined and deliberately left unchanged, one working alternative included: `docs/porting/browser-runtime-notes.md` § 12, `docs/evidence/m5-https/`.)*. **Deploy: local clean `make` + `npx gh-pages` to GitHub Pages; verify wire size/compression on the live CDN (fallback: Cloudflare Pages); the Demo is publicly reachable.** CI automation deferred until the local build-and-deploy loop is proven.

> **M5 — DONE (tasks 1, 2, 2b, 3, 4, 4c, 5, the live gate and the texture investigation). The Demo is live at
> <https://escapedcat.github.io/armagetronad-web/>.** Merged as PRs #7, #8, #9 and #10.
>
> ### What shipped, stated as narrowly as the evidence supports
>
> **The Demo is publicly reachable and playable, in desktop Chrome and Firefox, on one maintainer's machine.** That is
> the whole claim. It is not "done" in any broader sense, and four qualifiers belong inside the sentence rather than
> after it: one machine (macOS 26.5, Apple M1 Max), one GPU, two browser builds (Chrome 152, Firefox 154), and no human
> has yet played it for enjoyment rather than to satisfy a script. Every frame-rate number in this document is an M1
> Max's.
>
> **Measured, from the deployment rather than from a local server:**
>
> - **A first visit transfers 1,748,947 B = 1.668 MiB** for the four game files (5,380,255 B unpacked), or 1,750,214 B
>   including the `index.html` redirect — **8.6x under `PLAN.md`'s 15 MB budget**. The Pages edge gzips all five,
>   including the 4,331,484-byte wasm, and serves it as `application/wasm`. That was the milestone's one genuinely
>   unmeasured hosting fact and it cost one deploy and one `curl` to settle.
> - **Three complete rounds against three AI opponents, in both engines, played off the public URL**, arbitrated by M2's
>   own `check-transcript.mjs` — unmodified, and pointed at the deployment with `--url` and nothing else, because every
>   asset path is relative.
> - **The bar is >=30 fps and it is cleared with margin, but the number is not stable across runs and should not be
>   quoted as if it were.** **Three runs of the same script, same build, same public URL**, each ~39.5 s of real rounds,
>   as per-whole-second median / minimum: M5 task 5's committed run **60 / 58 (Chrome), 60 / 58 (Firefox)**; this exit
>   before the redeploy **60 / 57** and **57 / 53**; this exit after it **60 / 58** and **59 / 57**.
>   Chrome's median was 60 in all three. **Firefox's moved across 57, 59 and 60** — so the honest statement is "comfortably
>   above 30 in both engines", and **"60 fps" is not a property of this port.** Worst *single* frames in these two exit runs
>   were 41.9-46.3 ms (Chrome) and 37.0-50.0 ms (Firefox), i.e. below 30 fps instantaneously, as they have been since M2 and
>   still with nobody having looked for the cause. Browsers: Chrome 152.0.7977.75, and **Firefox 155.0 — one major version
>   newer than the 154 the milestone was built against, with no change needed to pass.**
> - **The dedicated wasm is still 2,488,298 bytes and md5 `9718a2a64978cb6e9b95ea2f0454cca5`**, from a rebuild after
>   `rm -rf web/build-m0 web/dist-m0 web/build-m1 web/dist-m1`. Quote both halves, always.
> - **The deployment is reproducible from source.** At the exit commit, all five published files — `armagetronad.wasm`,
>   `.js`, `.data`, `.html` and `index.html` — come back **byte-identical by md5** from that clean rebuild. This had
>   never been checkable before M5: `PLAN.md` recorded that `armagetronad.js` was not byte-reproducible, and `-O2`
>   changed that.
>
> **Re-runnable as one command:** `sh web/tools/live-gate.sh`, which runs the wire assertions (W1-W13 plus a WZ
> self-guard), M2's gameplay gate in both engines, and the https multiplayer route in both (X1-X11 plus XZ).
> `docs/evidence/m5-launch/prove-live-checks-can-fail.mjs` shows every new assertion can fail, 53 cases under **set
> equality** — a case is green only when the observed failure set *equals* the ids it declared.
>
> ### What M5 disproved, in this document and elsewhere. Annotated in place above; collected here
>
> **Ten items, counted from the numbered list immediately below.** Every one was settled by a measurement, and several
> had survived three or four milestones as prose. Two bases worth stating, because a bare count here would be exactly
> the defect this project keeps catching: items 1 and 2 were annotated in place by *earlier* M5 tasks, not by this
> exit, and item 10 is a process finding rather than a claim in this document being false — so "places `PLAN.md`
> itself was wrong and this exit corrected inline" is **seven**, not ten. The commit that landed these annotations
> says "eight" in its subject line and is wrong; it is immutable, and this is the correction.
>
> 1. **The `-O` ban was really an ASSERTIONS ban, and the two are separable.** Four milestones forbade `-O` at link.
>    Proven by *firing* the assert, not by reading flags: with a section 10 defect deliberately reintroduced,
>    `-O2 -sASSERTIONS=1` aborts on the same route with the same stack, while **bare `-O2` silently drops geometry
>    instead of aborting** (716 border pixels to 0). The size work was never blocked by `-O`. See the M2-inherited item
>    above.
> 2. **`rViewport` was never "latent".** Four milestones called it that. It was a live crash **four keystrokes from the
>    main menu** — Player Setup, then Down four times — reached through `RenderBackground()` from `uMenu::OnEnter`, so
>    *highlighting* the row was enough; no selection required. It would have shipped. Section 10 had the caller wrong as
>    well, naming `uMenu::Render`.
> 3. **The brotli work was unnecessary.** GitHub Pages serves gzip only — `Accept-Encoding: br` alone returns identity,
>    re-confirmed against the live deployment at 4.33 MB. Brotli buys 378,988 B and needs a custom domain proxied
>    through Cloudflare. Dropped.
> 4. **This document's `-fexceptions` figure was the wrong build's.** +827,185 B is the **dedicated, non-Asyncify**
>    measurement, and `web/Makefile` says so in its own comment. On the client it is **+2,402,246 (+37.1%)** at the
>    pre-`-O2` settings and +1,231,132 (+39.7%) at the shipped ones, because Asyncify instruments the unwinder and the
>    two costs multiply. Corrected under M1 above.
> 5. **This document's own deploy recipe published a site with no entry point, and exited 0 saying "Published".** See
>    the Hosting row.
> 6. **The camera bug was two bugs**, and fixing only the documented one would have produced a scene with no perspective
>    divide. See the M2-inherited item 5.
> 7. **The HUD flicker was neither suspected cause.** Not section 10, not audio on the main thread — the browser yield
>    sat above the overlay draw. See the M4-inherited item 5.
> 8. **The Play button's stated audio reason did not hold.** Emscripten resumes audio on the first keypress. See M1's
>    `shell.html` line.
> 9. **JSPI links, both target browsers support it, it is ~80% smaller — and it kills M3's audio.** Emscripten 6.0.8's
>    `libsdl.js` pushes to `Asyncify.sleepCallbacks` under `#if ASYNCIFY`, while that array exists only under
>    `#if ASYNCIFY == 1`. `-fexceptions` plus JSPI dies before `main`. **Recorded so nobody re-explores it**; it is the
>    single most attractive-looking dead end left in this port.
> 10. **The recurring defect of this project is stale evidence: a check verified before a later commit changed its
>    subject.** It was caught three separate times inside M5 alone — M4's P11 (broken by M4's own second task, shipped
>    green), task 3's socket counter (broken by task 3's own later commit, caught by the same task), and the nine steps
>    files task 5 edited. It is not a discipline problem; a passing transcript simply stops being about the build once
>    the build moves.


> **M5 OPEN ITEM — one gate is knowingly red, and task 6 owns it.**
>
> **`m4-persist` check P11 fails on a fresh run** against the current build:
> `boot 2 read user.cfg back with the SAME content hash (a579ed3e → 12176ddd)`.
> M4's *committed* transcript still exits 0, so this was invisible until M5 task 2
> re-ran every gate in a browser.
>
> **It is not `-O2`.** A control link with both flags removed reproduces M5 task 1's
> client byte-for-byte and fails identically, twice. **Cause (mechanism plus
> evidence, not a lesion):** M4 task 2 added the `beforeunload` backstop — a second
> `user.cfg` writer that runs after `sr_LoadDefaultConfig()` — and M4 task 1's gate
> was never re-run afterwards. The three-line diff matches exactly the three
> settings that function raises, and the M4 transcript contains no `backstop` line
> while today's contains `[PERSISTSAVE] js-backstop n=1`. **Not a product defect**:
> the divergence converges upward and M4's own persistence-milestone gate is 21/21
> in both engines. P11's hash-equality is simply now too strict for the shipped
> behaviour.
>
> **The process finding is the durable part: a gate not re-run after a later task
> changes its subject is stale evidence.** M4's committed transcript certifies a
> build that stopped existing later in the same milestone. **Fix shape:** either
> re-scope P11 to tolerate the backstop's write, or re-record M4's transcript
> against a current build — the second is cheaper and keeps the check strict.
> Recorded here rather than only in an evidence README, because a known-red gate
> filed where nobody re-reads it is exactly how `rViewport.cpp` survived four
> milestones.

> **Inherited from M4 — three byte-level traps, then the untested paths.**
>
> **1. The byte tripwire needs size AND md5, and always did.** Every milestone from M0 to M3 verified the dedicated server by its size alone. M4 task 3 recorded an **unguarded** build linking to *exactly* 2,488,298 bytes with md5 `830a19dc…`, **size delta zero** — both edits rewrote `i32` initialisers that already existed, so nothing changed length. A size-only check would have passed a server with a silently altered frame cap and audio buffer. The control link is committed at `docs/evidence/m4-config-precedence/byte-identity.asrun`, and `check-dedicated-byte-identity.mjs` re-measures it on demand. **Quote both numbers, always: 2,488,298 bytes and md5 `9718a2a64978cb6e9b95ea2f0454cca5`.**
>
> **2. The source *basename* perturbs an object's md5; the `-o` path does not.** Measured twice: two different output paths give byte-identical objects, while the same content compiled under a different filename gives a different md5 at an identical size. So a control that copies a source to a scratch *file* measures the rename, not the change — M4 task 3's first control did exactly that and caught it. Hold the basename constant; the directory and the `-o` are irrelevant.
>
> **3. Object *order* on a link line moves the output** by hundreds of bytes with no source change. Any control link must **substitute** objects in place, never append them.
>
> **Untested paths M5 must not mistake for tested ones.**
>
> - **`sr_ReinitDisplay` is completely unexercised.** *(No longer true: M5 task 4c exercised it and it works. See the annotation on M14 above.)* No gate presses Apply Changes, so tearing down and rebuilding a live WebGL context mid-run has never run in this port. The milestone gate's resolution check (M14) restores a *chosen* mode across a reload; it is **not** evidence that a live reinit works.
> - **The IndexedDB-unavailable path is reasoned about, not driven** — no private-window or storage-disabled run. A mount failure degrades to a working, non-persistent game rather than a page that never starts, and the log says `FAILED`, but nobody has watched it happen.
> - **First Setup's Colour/Controls/Connection menus are not covered** by the menu-leave save: their caller applies the choice *after* the menu closes, through a `uMenu::Message`, which is not a `uMenu` and fires no callback. `beforeunload` catches them today, and a backstop is not a mechanism. Closing it needs a guarded edit to `gArmagetron.cpp` — a task, not a line.
>
> **Live hazards.**
>
> - **`/persist` grows without bound.** It also collects `ladderlog.txt`, `scorelog.txt` and `/persist/screenshot`, and M4 makes writes *more* frequent, not fewer. IndexedDB quota is finite and `libidbfs.js` surfaces no error for exceeding it. Note the batching is all-or-nothing: one oversized file in a delta takes the config down with it.
> - **`[PERSISTSYNC] idle` means the queue drained, not that writes succeeded.** `onPersistComplete()` takes no error parameter, so a failed write-back still reports idle. Any quota work must read back rather than trust it.
> - **`SP_NUM_AIS` and `SP_AUTO_AIS` still have the precedence defect**, left as hard overrides on purpose — they pin the M2/M3 gates to three AIs regardless of the saved profile a run starts from. Revisit only when they stop being gate scaffolding.
> - **`uActionTooltip::Disable` zeroes every bound action's counter** whenever any input-configuration menu opens (via `s_InputConfigGeneric`). Unreachable on the current gate route, but a future route through the bindings screen would make the milestone gate's steering checks pass **with no steering at all**.
>
> **A process note that cost this milestone real time:** commit messages containing backticks must go through `git commit -F <file>`. Inline `-m "…"` runs them as shell command substitution and silently empties them.

> **Inherited from M2 — read the first item before touching a compiler flag.**
>
> 1. **Do not add `-O` to `CLIENT_LDFLAGS` blindly.** There is no `-O` at link today, which is the only reason `ASSERTIONS` is on — and `ASSERTIONS` is the only reason this milestone's largest defect class *announced itself* instead of drawing silent garbage geometry. The class is `docs/porting/browser-runtime-notes.md` § 10: Emscripten's immediate-mode emulation derives one interleaved vertex layout per `glBegin`/`glEnd` block, so a block whose vertices do not all emit the same attribute calls either aborts on an assert (loud, and fixable) or happens to divide evenly and renders wrong (silent — `gSparks.cpp` was doing exactly that and nothing complained). Adding `-O` converts every future instance of the first kind into the second kind. If size work needs `-O`, re-run the § 10 sweep first — `python3 web/tools/sweep-immediate-mode.py src`, the committed script that produced § 10's site lists, and § 10 accounts by name for every hit it currently prints, so a new one is visible — and keep an assertions-on build for debugging. *(**Resolved at M5 task 2, and the resolution is the opposite of what this item assumes.** The ban was on losing `ASSERTIONS`, not on `-O` — the two are separable, and `CLIENT_LDFLAGS` now carries `-O2 -sASSERTIONS=1`. Not argued, fired: with a § 10 defect deliberately reintroduced, `-O2 -sASSERTIONS=1` aborts on the same route with the same `numVertices` message and the same `abort ← assert ← flush ← _emscripten_glEnd` stack, while bare `-O2` does not abort and silently drops the viewport border (716 border pixels → 0). A fourth cell — the FIXED objects at bare `-O2` — draws the same 716 pixels, so the misrendering is attributable to the defect rather than to `-O2` or to `ASSERTIONS=0`. The sweep was re-run as this item asks and prints **18**, not 19: M5 task 1 fixed one, and a fix in this class REMOVES a line rather than reclassifying it. `docs/evidence/m5-o2-assertions/`, 23 checks + 20 falsifying mutations.)*
> 2. ~~**`rViewport.cpp:246` is a live, reachable, unfixed instance of that class.**~~ **FIXED at M5 task 1** (`ef342734`) — a `RenderEnd()` before the `glColor3f`, exactly as this item prescribed. It was never latent: the route is main menu → Down → "Player Setup" → Enter → Down ×4, and the fourth Down killed the tab, because `uMenu::OnEnter` calls `RenderBackground()` on the *selected* item. Four keystrokes from the main menu of the build M5 was about to publish. Left in place below rather than deleted, because the word this entry's own body contradicted — "reachable in the shipped build right now … left unfixed only because nothing in M2 opens that screen" — is how it survived three milestones under the heading "latent". Original text follows. `rViewportConfiguration::DemonstrateViewport` opens a `GL_LINE_LOOP`, emits four `glVertex2f`, then a `glColor3f(1,1,1)` with the block *still open*, then `DisplayText()` whose `RenderEnd(true)` flushes it: 17 slots against a 20-byte stride. It would abort. It compiles, and it is reachable in the shipped build right now through the viewport-configuration screen in the settings menu. It was left because nothing in M2 opens that screen, so a fix could not be verified by the harness. The fix is a `RenderEnd(true)` before the `glColor3f`; verify it by actually opening the screen.
> 3. **The two size line items, measured on this tree:** Asyncify **+5,888,604 bytes** (+197%, relinking the same objects with and without it) and `-fexceptions` **+827,185**. Asyncify displaces exceptions as the largest item by about a factor of seven. *(**Annotated at M5 task 2. The Asyncify number holds; the exceptions number is the wrong build's.** M5 recon re-measured Asyncify at +5,893,427 / +197.4%, which agrees with M2's +5,888,604. But +827,185 is `web/Makefile`'s **dedicated, non-Asyncify** figure, and it is quoted here inside a list about the CLIENT. Re-measured on the client at M5 task 2 by recompiling all 102 translation units with `EXCEPTIONS` empty: **+2,402,246 (+37.09%)** at the pre-task-2 link settings, **+1,231,132 (+39.71%)** at the shipped `-O2` settings. So exceptions are ~2.9× larger on the client than this line says, and Asyncify's lead over them is ~2.5×, not seven. `docs/evidence/m5-o2-assertions/measure-fexceptions-cost.sh`.)* `-sASYNCIFY_ADVISE` is the way to generate a defensible `ASYNCIFY_ONLY` list — do not hand-write one, a wrong list fails as a runtime `unreachable` trap rather than a build error. Details and the JSPI question in `browser-runtime-notes.md` § 7.
> 4. **`web/dist-m1/armagetronad.js` is not byte-reproducible** across links: emcc embeds its own temp-file paths in comments. The `.wasm`, `.data` and `.html` are. Any release-artifact hashing has to account for that. *(**No longer true as of M5 task 2 — `-O2` fixed it as a side effect.** The minifier strips the comments that carried those paths. Measured both ways, two relinks each, same objects: at the pre-task-2 link settings the `.js` md5 moves (`4bbd92e6…` → `f18fb9b8…`), and at the shipped `-O2 -sASSERTIONS=1` settings it does not (`f8c5f94ca0dad2fc8b26e8233c118346` twice), with the `.wasm` stable in both. So release-artifact hashing over all four files is now viable, which matters for task 4's deploy.)*
> 5. ~~**The camera is a correctness item, not a polish item.**~~ **CLOSED by M5 task 2b.** Emscripten's `gluLookAt` was a no-op, so the view was permanently top-down; `src/emscripten/eCompat.cpp` now implements it against the GLU specification. **It was two bugs, not one, and fixing only the documented one would have made things worse.** § 11 and every restatement of it since M2 described a single defect: gl-matrix's `mat4.lookAt` is declared `(eye, center, up, dest)` — destination **last** — while Emscripten passes destination **first**, so the current matrix arrived as `eye` and the result was written into a three-element array literal and discarded. That is real. But `mat4.lookAt` also **overwrites** its destination rather than post-multiplying into it, and `eCamera::Render` calls `gluLookAt` on the **projection** matrix immediately after `glFrustum`. So correcting the argument order alone would have discarded the frustum and produced a scene with no perspective divide at all. The shipped shim post-multiplies. A same-file lesson: this is the second time a § 11 line citation into an emsdk file had drifted, which is why this repo pairs emsdk citations with greppable tokens. The floor grid converges, there is a horizon, and the bike is in frame at the default camera — measured before/after in `docs/evidence/m5-camera/`. **The related mouse-camera binds are deliberately still dead**, and the cost of that is now measured rather than assumed: `LOOK_LEFT`/`LOOK_RIGHT` and every `MOVE_*` are also bound to the numpad in the same `default.cfg` block and those binds are live, so the only actions with no binding at all are `BANK_UP`, `BANK_DOWN` and `ZOOM_IN`. Enabling the mouse ones converts raw mouse motion into camera rotation with no pointer lock (`SDL_WM_GrabInput` is called nowhere in the tree) and puts `ZOOM_IN` on the browser's middle click, so M5 did not turn them on at the deployment milestone. `docs/porting/browser-runtime-notes.md` § 11, "M5 TASK 2B DECISION".
>
> **Inherited from M3 — two, both about the gate rather than the game.**
>
> 6. **The voice limiter has exactly one voice of margin.** `[SND] live voices peaked at 9 (SOUND_SOURCES 10, loudness_thresh 0.0000)` in every run taken, reproduced exactly from a clean rebuild at M3 exit. It cuts nothing today and has therefore **never run against real voices**. Raising `SP_NUM_AIS`, or a player lowering `SOUND_SOURCES` in the sound menu, crosses it — and the first time it engages will be the first time that code path has ever executed with sound in it. If you change the AI count for any reason, including a busier packaging demo, you have changed this experiment.
> 7. **`A14` can fail with nothing actually wrong.** `eSound.cpp` gives each diagnostic class a **16-line budget** and then falls silent, so a gate that counted log lines could pass *because a line stopped printing*. A14 therefore fails outright if any of the five budgets (`se_wavFailureBudget`, `se_wavSuccessBudget`, `se_wavRetireBudget`, `se_peakBudget`, `se_limiterBudget`) saturates. That is deliberately stricter than anything depending on it — no check reads a non-zero count today — but it means **a longer or busier match can fail the gate without a defect**: more rounds, more AIs, or a `SOUND_SOURCES` low enough to make the limiter oscillate will reach 16 lines legitimately. If M5 changes the match to something more representative, expect to raise the budgets or rework A14, and do not read that failure as a regression.
> 8. **A9 is only load-bearing in Firefox.** "Every buffer went to a `running` AudioContext" discriminates only to the extent that a transcript contains pushes taken while the context was parked. Firefox makes 5 such pushes, all recorded `suspended`, so there the check is real. **Chrome makes zero pre-gesture pushes** — a parked context stops Emscripten asking for buffers at all — so every Chrome reading necessarily came from after the gesture and could not have been anything else. A9 passing in Chrome is close to vacuous, and the checker says which case it is in the A9 line itself.

## Phase 1 — closed. What is met, and what is not

Phase 1 ran M0 through M5 and ends here. This section is the honest accounting against
the Demo's own definition at the top of this document, which is worth re-reading before
anything below it: *a publicly hosted GitHub Pages page where anyone can play
single-player Armagetron vs AI; desktop Chrome + Firefox; keyboard required; >=30 fps on
the maintainer's machine; Safari a non-target.*

**The Demo is live at <https://escapedcat.github.io/armagetronad-web/> and it is
playable.** Nothing below retracts that. What follows is the boundary of it.

### Met

Every clause of the definition, read as written:

| clause | status |
|---|---|
| publicly hosted on GitHub Pages | **met** — Pages enabled itself on the first push to `gh-pages`; `https_enforced: true` |
| anyone can play single-player vs AI | **met** — three complete rounds against three AI opponents, played off the public URL, arbitrated by M2's unmodified `check-transcript.mjs` |
| desktop Chrome + Firefox | **met** — Chrome 152.0.7977.75, and Firefox 154 at the deploy and **155.0** at this exit; the gate passed on both Firefox majors with no change, which is the only evidence this port has that it is not pinned to one browser build |
| keyboard required | **met**, and it is *required* in a way the definition did not anticipate — see open item 1 |
| >=30 fps on the maintainer's machine | **met with margin, and the margin moves** — see below |
| Safari a non-target | **held** — never tested, never claimed |

**On the frame rate, precisely.** Per-whole-second medians at this exit were **60
(Chrome) / 57 (Firefox)** with minima of **57 / 53**, over 39.6 s and 39.4 s of real
rounds against the public URL. M5 task 5's committed run of the same script against the
same build recorded 60 in *both* engines. So the bar is cleared roughly twice over, and
the number is not stable to better than about three frames between runs — **do not quote
"60 fps" as a property of this port**. The worst *single* frame was 41.9 ms and 50.0 ms,
i.e. below 30 fps instantaneously, which has been true since M2 and which nobody has ever
investigated.

**Two things are true beyond the definition and are worth recording** because they were
not promised: the deployment is **reproducible** — all five published files come back
byte-identical from a clean rebuild at the exit commit — and the wire cost is **1.668 MiB
on a first visit**, 8.6x under the 15 MB budget, without brotli, without JSPI, and
without anyone having to choose an optimisation level.

### Not met, or open

**Twelve items, counted from the list below.** None of them makes the Demo unplayable;
several are visible to a first-time visitor. They are ordered by who is hurt, not by
effort.

1. **The touch-device "needs a keyboard" note was never built.** M4's own milestone entry
   promised it and M4 recorded it as not done; M5 did not do it either. It is not deferred
   to Phase 3 by any decision — it was simply never built. **A visitor on a phone gets a
   canvas they cannot play and no explanation.** This is the only open item that harms
   someone who did nothing wrong, and it is a change to `web/shell.html` with no C++ in it.
2. **The multiplayer menu shows ~20 s of solid black canvas** before the game's own "Sorry,
   no server found :-(". Reachable in three keystrokes from the main menu. The *failure* is
   graceful and is gated (X1-X11 against the live site, both engines); the **black canvas is
   undiagnosed** — `BrowseSpecialMaster` enables the fullscreen console and nothing renders
   anyway. Task 3 called it "the Demo's worst 20 seconds" and nobody has argued with that.
3. **The video menu's top row, *Window Size*, does nothing.** `sg_ScreenModeMenu` builds it
   last and `uMenu` renders in reverse, so it is the top row *and* the row the cursor lands
   on; `lowlevel_sr_InitDisplay` reads `currentScreensetting.res` when fullscreen is set and
   this build runs `FULLSCREEN 1`, so `windowSize` is never read. ***Screen Resolution*, the
   row below it, is the live one** and `sr_ReinitDisplay` was tested at M5 task 4c and
   works. Hiding the dead row is tidy, not urgent — but note that hiding it while keeping
   the Fullscreen toggle creates a *new* silent no-op, because turning Fullscreen off makes
   Screen Resolution the dead row instead. The two rows and the toggle have to move together.
4. **`f` never reaches `toggle_fullscreen_func`, though `n` does.** The bind is in the
   persisted `user.cfg` (`KEYBOARD 102 PLAYER_BIND TOGGLE_FULLSCREEN 0`), the keycode
   translation is right, and the function is not entered at all — not even with `x <= 0` —
   while keysym 110 on an identical line enters it twice. **Pre-existing**: a control build
   from before the fullscreen work behaves the same. First suspects are
   `config/keys_cursor.cfg` and `keys_cursor_single.cfg`, which both rebind 102.
5. **Three ~1.5 s HUD-off stretches remain at round transitions, and it is NOT established
   that they are what the maintainer was seeing.** The short blinks were fixed and the
   numbers are unambiguous — separate gone-runs under 300 ms went **870 -> 0** in Chrome and
   **822 -> 0** in Firefox over 40.5 s. The long ones went **3 -> 3** in both, i.e. the fix
   did not touch them, and they are present in the control build too. They begin ~515 ms
   after each `ROUND_SCORE`/`NEW_ROUND` triple, so "the game legitimately hides the HUD at a
   round transition" is the obvious reading — **a hypothesis, not a measurement**. The
   maintainer was asked specifically whether the remaining flicker is the long kind or the
   short kind and **has not answered**. Until they do this is open, and it must not be
   filed as fixed.
6. **`m4-persist` P11 is red and needs a decision, not a re-run.** It compares boot 1's
   `user.cfg` content hash against boot 2's; M4's *own second task* then added the
   `beforeunload` backstop — a second `user.cfg` writer running after
   `sr_LoadDefaultConfig()` — and P11's gate was never re-run afterwards. The committed M4
   transcript still exits 0 **because it predates the backstop** (zero
   `[PERSISTBACKSTOP]`/`[PERSISTSAVE]` lines in it; present in every re-recording since). It
   is not `-O2`: a control link with both flags removed reproduces the pre-`-O2` client
   byte-for-byte and fails identically, twice. **The check is now stricter than the shipped
   behaviour.**

   **This exit re-ran the checker over the committed transcripts and found something sharper
   than "P11 is red": the two committed transcripts in `docs/evidence/m4-persist/` are of
   different vintages, against different pages, and only one of them can pass.**
   `chrome-console.log` was re-recorded at M5 task 5 (`d7214876`) against the autostart page
   — it carries **1 `[PERSISTBACKSTOP]` line and 2 `autostart` lines**, and the checker exits
   **1** on it, failing exactly P11 and nothing else. `firefox-console.log` has not been
   touched since M4 task 1 (`e3c93e72`) — **0 backstop lines, 0 autostart lines** — and exits
   **0**. So the Firefox half of that gate certifies a page that no longer exists (it still
   has the Play button), and it passes *because* it is stale. Re-recording it would turn it
   red too.

   Three honest options, and someone has to choose — nothing here chose for them: re-scope
   P11 to assert what the backstop actually makes true; re-record **both** transcripts and
   accept a red P11 until it is re-scoped; or delete P11 as superseded by
   `m4-persist-settings`, which tests the same property with a control build and is green on
   both engines. **What is not acceptable is leaving a mismatched pair where one engine
   passes only by being older than the build.** Counted by running the checker on both files
   and by `grep -c` on the two markers.
7. **Anisotropic filtering is offered and undecided.** It is supported here (max 16) and
   never requested; turning it on is measurably crisper — on the cycle's own saturated
   pixels **21.9% of pixels change and 13.1% change by more than 8**, against a **noise
   floor measured at exactly zero** — with no measurable frame cost. **But `grep -rn
   "ANISOTROP\|anisotrop" src/` returns 0 across the whole tree**: native never asks for it
   either, and macOS has no driver panel to force it on. So adding it would make the port
   *better than* native, which is a fine thing to want and is not a fix for the report that
   prompted it. **The maintainer has not said yes or no.** If yes, the site is the existing
   `#ifdef __EMSCRIPTEN__` block in `rISurfaceTexture::OnSelect`, gated on `minFilter` being
   one of the four mipmapped values so it stays off the NPOT `title.jpg`.
8. **Section 11's mouse-camera binds are deferred, with the cost measured rather than
   assumed.** `default.cfg` binds five camera actions to keycodes 324-336, which were SDL
   1.2's mouse pseudo-keys when `SDLK_LAST` was 323; in this build `SDLK_LAST` is 1536, so
   those binds are dead. The numpad binds for the same actions **are live** — proved by
   reading the game's own persisted keymap, where 1116/1118 sit beside the dead 324-332 —
   so **the actions with no binding at all are exactly three: `BANK_UP`, `BANK_DOWN`,
   `ZOOM_IN`.** Enabling the mouse ones means raw mouse motion driving the camera with no
   pointer lock (`SDL_WM_GrabInput` is called nowhere in the tree) and `ZOOM_IN` on the
   browser's middle click. Not at a launch milestone.
9. **Eight gate steps files were updated for the autostart change but only re-read, never
   re-run in a browser.** Task 5 reported nine; **`https-multiplayer.steps` has since been
   run live in both engines** by the live gate, so the standing figure is eight:
   `persist-negative`, `persistence-milestone-gate`, `persistence-milestone-negative`,
   `persist-settings-gate`, `persist-settings-menu`, `persist-backstop`, `menu-gate`,
   `maxfps-precedence`. Counted by name from task 5's list minus the one since exercised.
   The edit was mechanical — removing `click:#start`, which no longer exists — and every
   one of them still waits on `[BOOT] autostart`. It is still evidence that has not been
   taken.
10. **M4's two control-page generators have been broken since `-O2` landed**, and this exit
   re-ran both to confirm rather than repeating the claim: `make-control-pages.mjs` and
   `make-settings-control-pages.mjs`, **exit 2 each**. `-O2` minifies the generated HTML and
   both match un-minified literals. They fail loudly, as designed. **Proven not to be caused
   by the branch that found it** — the source line in `web/shell.html` is byte-identical to
   that branch's base. They block M4's *control* pages only, not any primary gate; anyone
   needing M4's control matrix must fix them first, without loosening the literal match.
11. **Native-recorded demo playback in the wasm build was never run at M5.** It was written
   into this document's M5 line and its verification item 5 as an explicit best-effort
   diagnostic and explicitly not a gate, and M5's time went elsewhere. So **M0's open
   question — whether native and wasm compute identical results *during play*, as opposed to
   during boot and idle — is still open at Phase 1's close.**
12. **Nobody has played this for fun.** Every run of this port in five milestones has been
   scripted. A script that presses Left and Right on a timer cannot tell a good game from a
   bad one: cycle feel, rubber, AI difficulty, whether the camera *reads* well in motion,
   whether the audio mix is right — all unassessed. M3 said the same thing about sound and
   it is still true: the harness guarantees the output end is silent. This is not a bug and
   it cannot be closed by a machine.

**Closed during this exit, and recorded so it is not re-found as open:** the published
`gh-pages` branch carried **17 files nobody meant to ship** — 23 entries and 16,185,514 B
against a release of 6 entries and 5,382,608 B — including two probe *builds* that were
publicly fetchable, one with the flickering HUD and one with a deliberately broken
fullscreen key. The texture work had left five more in `web/dist-m1` that the next deploy
would have published the same way. The cause is structural rather than careless:
`npm run deploy` publishes `web/dist-m1` as it finds it, that directory is gitignored, and
`make client` does not clear it. `npm run deploy` now runs
`web/tools/check-publish-set.mjs` first, which asserts **set equality** against a declared
release list and refuses to publish a stray or a missing file
(`web/tools/prove-publish-set-check-can-fail.sh`, 9 cases).

### The one process finding worth carrying out of Phase 1

**Stale evidence is this project's recurring defect, and it is structural rather than a
discipline problem.** A gate that is not re-run after a *later* task changes its subject
certifies a build that has stopped existing. It was caught three separate times inside M5
alone: M4's P11, which shipped green and was broken by M4's own second task; task 3's
socket counter, which its own later commit falsified inside the same task; and the eight
steps files above. The related defect is the same shape in prose — a claim restated
across milestones without being re-derived. `rViewport` survived four milestones under
the word "latent" while being a crash four keystrokes from the main menu, and the `-O`
ban survived four while being a ban on something else. **Both were settled in minutes,
the moment somebody ran the thing instead of reading about it.**

## Risk register (top items)

| Risk | Mitigation → Fallback |
|---|---|
| LEGACY_GL_EMULATION gaps | Conservative runtime defaults + per-feature disables → **gl4es drop-in** (more complete fixed-function translator, same integration shape) → targeted GLES2 rewrite of hot paths only (floor/walls/model) via existing `rRenderer` seam (`rRender.h`) — last resort.<br>**M2 outcome: the fallback chain was not needed, and the gaps were not the shape this row assumes.** Every gap M2 hit was a *rule the emulation enforces and real GL does not* (one vertex format per block; 16-bit indices only) or a plain bug in one function (`gluLookAt`), not a missing feature. Each was fixed at the call site in a few lines. Keep the chain for M5, but do not reach for it on the strength of one abort. |
| Asyncify stack/reentrancy | Yield points funnelled through SwapGL (M1 ships two per frame — top-of-function, plus `sr_LimitFPS()` when the frame finishes early; both measured fine), big ASYNCIFY_STACK_SIZE → manually restructure only `uMenu::Enter` + `sg_EnterGameCore`, or JSPI. **The primitive matters, the count does not**: only sleeps in `ASYNCIFY_IMPORTS` are safe, never `SDL_Delay` — `browser-runtime-notes.md` § 8 |
| SDL1 emulation gaps | eCompat.cpp stubs, found at link time → each replaceable <100 lines |
| Float non-determinism breaks demo playback | Treat playback as diagnostic, not gate → manual playtest matrix |
| Immediate-mode emulation too slow | MAX_FPS 60, reduced effects → same gl4es / GLES2 hot-path chain as above.<br>**M2: not observed.** Three real rounds held a per-whole-second median of 60/59 fps and a minimum of 53/56 against the `MAX_FPS 60` cap, on an M1 Max. Note this was the tutorial match, and that Task 4 deliberately moved cycle model rendering *into* immediate mode (away from `glDrawElements`, which Emscripten cannot feed 32-bit indices) without a measurable cost. The risk is not retired for busier arenas or weaker GPUs, but it is not what limits this port today. |
| Web Audio fights back | M3 timebox → ship the Demo muted, fix post-launch.<br>**M3 outcome: it did not fight back, and the escape hatch was not used.** Emscripten's SDL 1.2 already implements the device and calls the game's own `fill_audio`; the only missing piece was a WAV loader, ~50 lines. Autoplay policy needed no shell change either — a *trusted* click already yields a `running` AudioContext. What did bite was adjacent and unlisted: `fill_audio` runs on the Asyncify rewind path where a `throw` becomes a **process abort**, which is a constraint on error handling rather than on Web Audio. The remaining audio risk is not technical but epistemic: **nobody has listened**, so "correct mix" is untested rather than confirmed. |
| libxml2 ≥2.13 drops nanoHTTP | Pin 2.12.x → `#ifdef` the tResourceManager HTTP path |
| GitHub Pages compression for `.wasm` disappoints | Measure at M5 → Cloudflare Pages (pre-approved swap, an afternoon) |

## Verification (Phase 1)

1. M0: dedicated wasm server boots under Node, parses maps, plays back a native-recorded demo (best-effort). **✅ done.**
2. M2 gate: 3 complete single-player rounds vs AI in Chrome + Firefox at ≥30 fps on the maintainer's machine; tab stays responsive. **✅ done** — `docs/evidence/m2-gate/`, re-runnable as `web/tools/gameplay-gate.steps`, arbitrated by `docs/evidence/m2-gate/check-transcript.mjs` (exit status, not prose). Read the four caveats under the M2 milestone entry before quoting any of it.
3. M3 gate: non-zero PCM reaches `SDL.audio.pushAudio` in every round of a three-round match, Chrome + Firefox. **✅ done** — `docs/evidence/m3-audio/`, re-runnable as `web/tools/audio-gate.steps`, arbitrated by `docs/evidence/m3-audio/check-audio-transcript.mjs` (24 checks, exit status). Two controls: `prove-checks-can-fail.mjs` shows each of the 24 can fail, and a silent bundle on a byte-identical wasm reads 0/1020. Read the four caveats under the M3 milestone entry first — in particular, this is **not** a claim that anything was rendered to a device or that the mix is correct.
4. M4 gate: settings persist across reload (IndexedDB). **✅ done** — `docs/evidence/m4-persistence/`, re-runnable as `web/tools/persistence-milestone-gate.steps`, arbitrated by `check-milestone-transcript.mjs` (21 checks plus a self-guard, exit status). Three assertions across three boots: the canvas comes back at the resolution the player picked (measured on the DOM, outside the wasm), the later boots skip the first-use path, and the game still steers. Two controls: `prove-milestone-checks-can-fail.mjs` flips all 21 with 25 mutations under set equality, and `persistence-milestone-negative.steps` — the same script with IndexedDB destroyed between two boots, one executable line different — takes down exactly one check per assertion. Chrome 152 headed and Firefox 154 headless both 22/22. Read "What is not claimed" in that README first: it does **not** separate the menu-leave save from the `beforeunload` backstop (that is task 2's gate, which does it with a control build), and it covers one resolution, one keyboard template and one player.
5. M5: native demo playback survives >1 round in wasm build (best-effort); packaged page loads <15 MB over the wire. **Half done, and the half that was a gate is done.** The size half is met with room to spare: a first visit transfers **1,748,947 B = 1.668 MiB**, 8.6x under the 15 MB budget, measured against the live deployment with `%{size_download}` from real GETs and each gzip body gunzipped and hashed back to the built artefact (`web/tools/wire-facts.sh`, arbitrated by `docs/evidence/m5-launch/check-wire-facts.mjs`). **The native-demo-playback half was never run at M5 and is not claimed** — it was written as best-effort and explicitly not a gate, and M5's time went to the crash, the camera, the deploy and the two defects the maintainer found by playing. So the question M0 left open — whether native and wasm compute identical results *during play*, as opposed to during boot and idle — is still open at Phase 1's close.
6. **Launch: the Demo is publicly reachable on GitHub Pages. ✅ done** — <https://escapedcat.github.io/armagetronad-web/>, re-runnable as `sh web/tools/live-gate.sh`, which asserts the wire facts (W1-W13 + WZ), plays M2's gate in both engines against the public URL, and drives the https multiplayer route in both (X1-X11 + XZ). `prove-live-checks-can-fail.mjs` shows all 53 new-assertion cases can fail under set equality. Evidence: `docs/evidence/m5-launch/`. **Read item 5's caveat and the M5 milestone entry's "what is NOT met" list before quoting this as Phase 1 being finished** — reachable and playable is exactly what is claimed and it is less than done.

## Future work (explicitly not committed)

Neither phase below is part of "done." Each gets its own go/no-go decision after the Demo ships, informed by real Phase 1 data. Phase 1 carries exactly two obligations to keep these doors open, both free: network code compiles unchanged, and all patches stay `#ifdef __EMSCRIPTEN__`-guarded.

> **What Phase 1 actually established for these two phases, now that it has shipped.** Both
> obligations were kept: `git diff` over `src/network/` against upstream is confined to
> nothing that would obstruct the bridge, and every patch outside `src/emscripten/` is
> guarded. Beyond that, five things are now measured rather than assumed, and a sixth is a
> warning.
>
> **For Phase 2 (the multiplayer bridge):**
>
> 1. **Single-player really does open no sockets, and the Demo is behavioural evidence for
>    it — though read the form of the evidence, because it is an absence.** The architecture
>    note at the top of this document establishes it from source (`nSTANDALONE`). What the
>    live gate adds is this: in both three-round gameplay transcripts taken against the
>    public URL, the strings `ws://` and `websocket` appear **0 times each** — while the
>    *same driver, same session, same build*, walked into the multiplayer menu and produced
>    **98 `ws://` lines in Chrome and 97 in Firefox**. So the channel that would report a
>    socket demonstrably works and printed nothing for the whole match. **Stated exactly:
>    `gameplay-gate.steps` installs no WebSocket counter** — the counter belongs to
>    `https-multiplayer.steps` — so this is "the browser logged no socket activity", not
>    "an instrument counted zero". It is enough to say a bridge is genuinely additive:
>    nothing in the committed scope has to change to accommodate one.
> 2. **The one-UDP-socket claim held all the way through.** `nBasicNetworkSystem::controlSocket_`
>    remains the client's only socket and peers are still demultiplexed by source address —
>    which is exactly why one WebSocket per browser client reproduces native behaviour, and
>    why the server browser's concurrent master pings work through the same shim. Nothing in
>    M0-M5 disturbed this, and the design below still rests on it.
> 3. **The master query's shape is now measured against a real deployment, and a bridge has
>    to fit inside it.** Four masters, **24 or 25 attempts to each**, **96-100 total**, over
>    **20.0 s** — and the 20 s is `sn_Connect`'s 5 s-per-master timeout, not a property of how
>    the socket fails. Nine transcripts and 36 per-master observations, all from one machine
>    on one network path. A bridge that answers faster shortens this; a bridge that answers
>    *slower than 5 s per master* is indistinguishable from no bridge at all.
> 4. **The HTTPS finding is a hard constraint on the bridge host, not a preference.** Pages
>    is HTTPS-only and `https_enforced: true`, so **every `ws://` the client opens is blocked
>    as mixed content** — measured live, 96-100 blocked attempts per master query. The bridge
>    must therefore be **`wss://` with a real certificate**; a plain-`ws` bridge cannot be
>    reached from the Demo's origin at all, on any browser, regardless of what the bridge
>    does. That makes Caddy-or-equivalent TLS a day-one requirement rather than the M-C item
>    the plan below files it as. A **working `wss://` rewrite already exists and was
>    deliberately declined at M5 task 3** — it takes the attempt count from 98 to 19 and
>    removes every mixed-content error — and the four reasons it was declined are recorded in
>    `docs/porting/browser-runtime-notes.md` § 12. Phase 2 should read that decision before
>    re-implementing it: it is the same code, wanted for a different reason.
> 5. **Firefox on the maintainer's machine cannot open a connection to any `*.github.io`
>    host** — including GitHub's own `pages.github.io` — while Chrome and `curl` reach the
>    same URL in the same second. It is a local outbound restriction, not a fact about the
>    deployment, and every Firefox number in this project came through a CONNECT proxy that
>    tunnels bytes and never sees plaintext. **Any Phase 2 work that measures Firefox against
>    a remote bridge will hit this**, and should reach for
>    `docs/evidence/m5-deploy/tunnel-proxy.mjs` rather than re-diagnosing it.
> 6. **The warning: Asyncify is the constraint that shapes the JS side of the bridge, and
>    JSPI is not an escape from it.** The design below is already right about this — the
>    `onmessage` handler must only *enqueue*, never re-enter C++ — and Phase 1 supplies the
>    reason it must stay right: JSPI links, is ~80% smaller, and is supported by both target
>    browsers, but **it kills audio** through Emscripten 6.0.8's `libsdl.js`
>    (`Asyncify.sleepCallbacks` pushed under `#if ASYNCIFY`, the array defined only under
>    `#if ASYNCIFY == 1`). So a bridge cannot assume it will one day be freed from Asyncify's
>    reentrancy rules by switching main-loop strategies.
>
> **For Phase 3 (touch):**
>
> 7. **Its cheapest piece is already overdue and belongs to Phase 1, not Phase 3.** The
>    touch-device "needs a keyboard" note was promised by M4 and never built (open item 1
>    above). Whoever starts Phase 3 will find it sitting there; whoever does *not* start
>    Phase 3 should still build it, because a phone visitor today gets a canvas and no
>    explanation.
> 8. **Canvas sizing is solved and the solution is the constraint.** `web/shell.html` sizes
>    the backing store once, before boot, from `innerWidth`/`innerHeight` x
>    `devicePixelRatio`, capped by *area* at 3840x2160 — and the cap is an **allocation**
>    bound, not a frame-rate one: nine backing-store sizes through M2's sampler held a 60 fps
>    median from 0.79 Mpx **to 33.2 Mpx**, with p50 frame time pinned at 16.7 ms throughout.
>    **This port is not fill-bound on an M1 Max**, which is a real datum for the phone-GPU
>    question and not an answer to it. A later window resize deliberately does **not** move
>    the backing store — following it means `sr_ReinitDisplay` — so CSS scales and a reload is
>    crisp. An orientation change on a phone is exactly that case, and it is unhandled.
> 9. **`sr_ReinitDisplay` works, which reopens the resize question Phase 3 will need.**
>    Measured at M5 task 4c: the canvas resizes live, `isContextLost()` stays false, no
>    `webglcontextlost` fires, 0 GL errors in 3832 polls, and the game then plays two full
>    rounds at the new size. Emscripten's `SDL_SetVideoMode` never creates or destroys a GL
>    context. So a resize-and-reinit listener is *available* to Phase 3; it was deliberately
>    not built at Phase 1.
> 10. **The keyboard surface a touch overlay has to synthesize is smaller than the plan
>    assumes in one place and larger in another.** Four keys and arrows+enter is right for
>    play and menus. But `f` does not work today even from a real keyboard (open item 4), and
>    three camera actions have no binding at all (open item 8) — so an overlay that
>    synthesizes keystrokes inherits both, and should not be blamed for either.


### Phase 3 — minimal touch support (likely first: days of JS, not weeks of Go)

Armagetron's gameplay is four keys and its menus are arrows+enter, so minimal mobile play needs **zero C++ changes**: a JavaScript overlay in the shell page synthesizes the game's existing keyboard controls from touch input (tap zones for turn/brake, a simple D-pad for menus). Unknowns priced into this phase, not the Demo: phone GPU performance under the emulation layers, canvas sizing, and iOS — where every browser is WebKit underneath, reopening the Safari question deliberately skipped on desktop.

### Phase 2 — multiplayer bridge (go/no-go after M5)

Shipping this changes the maintainer's role from developer to **service operator** (VPS, TLS, abuse policy, coordination with server admins, indefinitely) — the main reason it is not committed. The verified design is preserved below.

**Architecture (verified against source):** one WebSocket per browser client ↔ bridge holding one ephemeral-port UDP socket per session (servers identify clients by ip:port — this mirrors a native client exactly, including the server browser's 20 concurrent pings via `sn_Bend`). Binary frames: `{version, type, port u16, addrLen, addrToken(ascii host or dotted quad), payload}` — bridge echoes the client's token back, client never does DNS (fake-IP map `10.42.0.0/16` in `nAddress::SetHostname`). Rejected alternatives: Emscripten default SOCKFS WebSocket emulation (destination routing lost / per-peer WSS handshakes) and `-sPROXY_POSIX_SOCKETS` (needs pthreads+COOP/COEP, demo-grade open-relay proxy).

**C++ changes confined to `src/network/nSocket.cpp`** (`#ifdef __EMSCRIPTEN__` at: `Create`, `Open/Bind`, `Read`, `Write`, `Broadcast` → disabled, `nBasicNetworkSystem::Select` → queue-check + `emscripten_sleep(5)` loop, `nAddress::SetHostname` → fake DNS) + new `src/network/nSocketWeb.cpp/.h` (~300 lines: handle table, RX queue, token↔IP map) + new `web/library_bridge.js` (~250 lines; onmessage only ENQUEUES — C++ never re-entered from JS events, no Asyncify reentrancy). `nNetwork.cpp`, `nServerInfo.cpp`, `gServerBrowser.cpp`, `config/master.srv` all unchanged — the entire in-game server browser works through the shim.

**Bridge service:** small Go binary (goroutine/session), behind Caddy for wss/TLS, Docker Compose on a €5–9/mo EU VPS (community servers cluster EU/US; ~+5–25 ms added RTT same-region). Anti-abuse: destination policy (no private/multicast; port allowlist 4533–4599 + config), unanswered-flow budget (kills reflection), 32/64 KB/s per-session caps, per-IP session cap 4, Origin allowlist, JSON-line logs + Prometheus counters. Known risk: servers cap clients per IP (`MAX_CLIENTS_SAME_IP_SOFT=4`/`HARD=8`) — mitigate with secondary IPs and by talking to server admins before launch.

- **M-A (1–2 wks):** shim + JS lib + minimal bridge (plain ws), join local dockerized dedicated server via custom-connect; verify full round, resend-under-loss, WS-drop recovery; then one real community server. Gate: browser client completes a round on an unmodified community server through the bridge.
- **M-B (1–2 wks):** fake-DNS + master list (`master1-4.armagetronad.org:4533`) + in-game server browser through bridge. Gate: server count/pings ≈ native client; joins from list.
- **M-C (1–2 wks):** wss/Caddy, policies, rate limits, metrics, prod deploy; load test 50 sessions, abuse tests.
- **M-D (stretch):** US bridge + region picker; REST lobby cache; WebTransport datagrams; egress-IP pooling.

## Critical files

Port: `src/render/rSysdep.cpp`, `src/tools/tSysTime.cpp`, `src/render/rTexture.cpp`, new `src/emscripten/{config.h,nTrueVersion.h,eCompat.cpp}`, new `web/{Makefile,README.md,shell.html,webdefaults/autoexec.cfg}`, new `deps/build-libxml2.sh`.
M2 added guarded patches to `src/engine/eSound.cpp`, `src/render/{rScreen.cpp,rModel.cpp,rGLRender.cpp}`, `src/tron/{gWall.cpp,gCycle.cpp,gSparks.cpp}` and `src/ui/uInput.cpp` (the keycode re-encoding), plus `web/tools/gameplay-gate.steps` and `docs/evidence/m2-gate/`.
M3 touched only two source files — `src/engine/eSound.cpp` (the WAV parser, the `Load()` guard, silent-voice retirement, the `samples == 0` guard in `eWavData::Mix`, and the budgeted diagnostics) and `src/emscripten/eCompat.cpp` — plus `web/webdefaults/autoexec.cfg`, `web/tools/audio-gate.steps` and `docs/evidence/m3-audio/`. **`eSound.cpp` compiles into the dedicated build too**, which is why the byte-identity tripwire — 2,488,298 bytes **and** md5 `9718a2a64978cb6e9b95ea2f0454cca5`, both halves; see the M4 task 3 note above for why the size alone is not enough — matters more there than anywhere else; its Emscripten guards are `#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)` for that reason. That file also now states a local rule worth honouring: **same-file references name a symbol, never a line** — line citations in it went stale twice inside this one milestone, and two more in this document rotted the same way (both struck through above).
Every patch's long-form reasoning is in `docs/porting/browser-runtime-notes.md`; the source files carry pointers to it rather than the argument.
Future bridge: `src/network/nSocket.cpp`, new `src/network/nSocketWeb.{cpp,h}`, new `web/library_bridge.js`, new Go bridge service (`bridge/` dir).
