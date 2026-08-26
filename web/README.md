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
finish the async bind. Nothing is reachable on 4534. This is expected here and
is one of the things the Asyncify work in the next milestone fixes.

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
descriptors make `count` non-zero. Memory stays flat. Asyncify, in the next
milestone, is what gives the loop a real yield point.
