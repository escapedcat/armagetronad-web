# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A fork of Armagetron Advanced (~114k lines of C++, 3D lightcycle game) with one goal: compile the **real** engine to WebAssembly via Emscripten so the game runs in a browser. Not a rewrite — the original physics, AI, and netcode, compiled as-is.

Three planning documents are authoritative; read them before doing any port work:

- **PLAN.md** — milestones M0–M5, build strategy table, risk register, critical-file list. This is the source of truth for what to build and in what order.
- **CONTEXT.md** — project vocabulary. Use its terms: "the Demo" (not "the product"/"the release"), Phase 1/2/3.
- **docs/adr/** — founding decisions (port-not-rewrite, base on `legacy_0.2.9`).

Committed scope is **the Demo** only: single-player vs AI, desktop Chrome + Firefox, keyboard required, hosted on GitHub Pages. Multiplayer (Phase 2, UDP-over-WebSocket bridge) and touch controls (Phase 3) are designed in PLAN.md but explicitly **not committed** — do not build toward them beyond the obligations listed below.

## Hard rules for port work

- There is **no deadline** — this is a hobby project. Milestones and gates define progress, never dates; when tempted to cut a corner "to go faster", the default answer is no. Effort estimates in PLAN.md are relative, not calendar promises.
- `~/data/src/armagetronad` (outside this repo) is a history-less reference snapshot of the codebase — read-only, never modify it.
- Every change to an existing source file must be `#ifdef __EMSCRIPTEN__`-guarded. Native builds stay untouched — that discipline is what keeps an eventual upstream merge request plausible.
- New port code goes only under `src/emscripten/` and `web/` (neither exists until M0/M1 create them).
- The network code must keep compiling unchanged in every milestone (keeps the Phase 2 door open at zero cost).
- `main` is **frozen at its base commit until M5** — no merges from the `upstream` remote (gitlab.com/armagetronad/armagetronad) until the Demo ships. Port work happens on branches off `main`.

## Build commands

**WASM build (the port):** a hand-written `web/Makefile` plus hand-written `src/emscripten/config.h` — autotools is *not* used for wasm. Created in M0; per PLAN.md it must stay documented in `web/README.md` well enough that a non-C++ dev can drive it. Precedent for hand-written platform config headers: `src/config_ide.h`, `src/win32/config.h`.

**Native build (autotools)** — used to verify port patches don't break native:

```sh
./bootstrap.sh                      # generate configure (needs autoconf/automake)
./configure                        # client build; add --enable-dedicated for the server
make
make run                           # run from build dir; data from source tree, var/ inside build dir
make debug                         # creates gdb symlink + .gdbinit
```

Upstream recommends `DEBUGLEVEL=3 CODELEVEL=2` as configure-time env vars for development (DEBUGLEVEL 0–5 controls assertions/memory debugging, CODELEVEL 0–4 controls warning strictness — see README-DEVELOPER). There is no automated test suite; validation is the deterministic record/playback system (`tRecorder`) plus the per-milestone gates in PLAN.md.

## Architecture

The engine is layered static libraries, one directory each under `src/`, with a single-letter class prefix per layer. Lower layers never depend on higher ones:

| Directory | Prefix | Role |
|---|---|---|
| `src/tools/` | `t` | Foundation: strings, config (`tConfiguration`), data dirs (`tDirectories` — paths switchable at runtime via `--datadir`/`--userdatadir`), deterministic record/playback (`tRecorder`), memory manager |
| `src/network/` | `n` | UDP netcode, master server, version handshake. All client I/O goes through **one** socket (`nBasicNetworkSystem::controlSocket_`), demultiplexing peers by source address — the fact the Phase 2 bridge design rests on |
| `src/engine/` | `e` | Generic simulation: grid, walls, cameras, game objects, timestep |
| `src/render/` | `r` | Fixed-function GL 1.x, textures, fonts, display lists. `rSysdep.cpp` owns the swap/frame-limit loop — the planned Asyncify yield point |
| `src/ui/` | `u` | Menus and input. `uMenu::Enter` is a nested blocking loop (why the port needs Asyncify) |
| `src/tron/` | `g` | The actual game: cycles, AI (`gAIBase`), arena, game modes |

Client links all layers; the dedicated server (`--enable-dedicated`, `DEDICATED` define) builds only a subset with no render/ui. `src/thirdparty/particles` is client-only. Blocking loops are pervasive (menus, splash, connection waits) but all funnel through `rSysDep::SwapGL()` / `sr_LimitFPS()` / `tDelay()` — the port's whole main-loop strategy depends on that funneling.

Dependencies are deliberately light (the wasm feasibility case rests on this): SDL 1.2, fixed-function OpenGL, libxml2 (resource/map loading — pin 2.12.x for nanoHTTP), libpng. No Boost, no protobuf, no FreeType, no live threads (auth has a synchronous fallback when `HAVE_PTHREAD` is undefined).
