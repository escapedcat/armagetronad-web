# Armagetron Advanced → in the browser

This is a fork of [Armagetron Advanced](https://www.armagetronad.org/) — the classic
3D lightcycle game — with one goal: **make the real game run in a web browser**.

Not a rewrite, not a look-alike: the original C++ engine, physics, AI and network
protocol, compiled to WebAssembly with [Emscripten](https://emscripten.org/).

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

🚧 **M1 complete: the real game client compiles to WebAssembly and boots to a
navigable menu in Chrome and Firefox, rendering through WebGL on the GPU.**

Arrow keys, Enter and Escape drive it: the language menu responds, Enter
chooses a language and moves on to the first-run setup menu, Left/Right change
values there, and Escape leaves it for the game's welcome screen. Both browsers
render on a real GPU rather than a software rasteriser — Chrome reports
`ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)`, Firefox `Apple M1, or
similar`. Twenty screenshots and both devtools transcripts are committed under
[docs/evidence/m1-task7/](docs/evidence/m1-task7/), and the script that
produced them is re-runnable: `web/tools/menu-gate.steps`.

Getting there took guarded patches to 11 of the game's own source files, plus
two new files of port-owned code (`src/emscripten/eCompat.cpp` and the shared
`config.h`). The reasoning behind each patch is in
[docs/porting/browser-runtime-notes.md](docs/porting/browser-runtime-notes.md).
Measured on macOS 26.5 (Apple silicon) with Chrome 152 and Firefox 154 — no
other browser, OS or GPU has been tried.

**What M1 does *not* prove: the game is not playable.** No round has ever run
in a browser. No cycle physics, no AI, no walls, no collisions, no scoring have
executed — the two menus M1 reaches are the ones that come *before* the game,
and the main menu with its submenus sits behind a first-run tutorial round,
which is gameplay. Frame pacing was measured only while sitting in a menu
(~63 FPS against the `MAX_FPS 60` cap), which says nothing about a scene with
cycles in it. Nothing persists across a reload, audio is unverified, the
default arrow-key *steering* bindings are known not to fire yet, and the wasm
is 8.9 MB before any size work. Those are M2 (playable single-player vs AI),
M3 (audio), M4 (persistence) and M5 (size and packaging).

M0 still holds and is still checked on every change: the dedicated server
compiles to WebAssembly, boots under Node, and parses and validates its map
through libxml2 — and its wasm is still byte-identical at 2,488,298 bytes, the
tripwire that catches anything client-only leaking into the shared build. What
M0 did not prove about gameplay correctness is still open: its playback
diagnostic covered boot and idle only, so whether native and wasm compute
identical results *during play* remains untested.
Full M0 boot log: [docs/m0/boot-evidence.log](docs/m0/boot-evidence.log).
Next: M2 — playable single-player against the AI.

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
# then open http://localhost:8000/armagetronad.html and press Play

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
