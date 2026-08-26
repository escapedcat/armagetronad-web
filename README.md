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

🚧 M0 complete: the real dedicated server compiles to WebAssembly and boots
under Node. It parses and validates its map using libxml2, the same library
the original game uses. It does not yet accept network connections — that's
M1's job. Zero changes were made to the game's own source code: the only two
files added under `src/` are new — `src/emscripten/config.h` and
`src/emscripten/nTrueVersion.h`. This proves the build toolchain, libxml2,
and the ~114k-line C++ codebase all port to WebAssembly without modification
(PLAN.md's M0 goal). What it does *not* prove: a playback diagnostic checked
only boot and idle behavior, not actual gameplay (cycle physics, AI), so
whether native and wasm compute identical results during play is still
untested. Full boot log: [docs/m0/boot-evidence.log](docs/m0/boot-evidence.log).
Next: M1 — the client boots to the main menu in a browser.

## Repo layout

- `main` is based on upstream's `legacy_0.2.9` branch (the current stable line);
  the `upstream` remote points to the official GitLab repository
  ([gitlab.com/armagetronad/armagetronad](https://gitlab.com/armagetronad/armagetronad))
  so upstream fixes merge cleanly.
- Port code is additive: new files under `src/emscripten/` and `web/`, with
  `#ifdef __EMSCRIPTEN__` guards elsewhere — native builds stay untouched.
- The original project documentation is in the plain-text [README](README) and
  `README-DEVELOPER`.

## License

GPL-2.0-or-later, same as upstream — see [COPYING.txt](COPYING.txt).
