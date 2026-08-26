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
