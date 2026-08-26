# Web build (Emscripten port)

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

Node: v22.x (any ≥ 18 works for running the M0 server).

## Dependencies

libxml2 (static, wasm): `./deps/build-libxml2.sh` (needs the emsdk env sourced).
Output lands in `deps/build/libxml2-install/`. Pinned to 2.12.x — see the
comment in the script for why. Re-run only after `rm -rf deps/build/libxml2-*`.

## Building the M0 dedicated server

    source deps/emsdk/emsdk_env.sh
    ./deps/build-libxml2.sh        # once
    make -f web/Makefile dedicated -j8

Output: web/dist-m0/armagetronad-dedicated.{js,wasm}. `make -f web/Makefile clean` resets.

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
