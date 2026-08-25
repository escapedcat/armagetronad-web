# Port the real C++ codebase via Emscripten rather than rewrite for the web

Every earlier attempt to bring Armagetron Advanced ([armagetronad.net](http://armagetronad.net/)) to the browser was a from-scratch rewrite — notably [Armawebtron](https://github.com/Armawebtron/Armawebtron), a JS/Three.js re-implementation that stalled with networking never finished, and 2020–21 forum explorations of web-capable tech (Godot, raylib) by the lead developer that saw no follow-through. The game's famously precise feel lives in ~114k lines of battle-tested C++ (cycle physics, rubber, collision grid, netcode); rewrites must re-create that by hand, and none got there. We decided to compile the actual engine to WebAssembly with Emscripten instead — nobody has done this, and research confirmed the codebase is unusually portable (SDL 1.2, fixed-function GL, no Boost/protobuf/FreeType, all network I/O through a single UDP socket).

## Considered Options

- **Continue or fork Armawebtron** — rejected: re-creating the physics and netcode by hand is exactly the failure mode already observed.
- **Re-implement in Godot/raylib** (the upstream forum idea) — rejected: same problem, plus a permanent fork of game logic away from upstream.
