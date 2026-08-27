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
#     fetch .wasm/.data. Then open the URL and press Play.
python3 -m http.server 8000 --directory web/dist-m1
#     -> http://localhost:8000/armagetronad.html

# 5b. Run the M0 server.
node web/dist-m0/armagetronad-dedicated.js --doc | head -20
node web/dist-m0/armagetronad-dedicated.js \
    --datadir . --userdatadir /tmp/aa-persist --daemon < /dev/null
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
socket never finishes listening. Still true after M1, and an earlier revision of
this file was wrong to say M1 would fix it: M1 put `-sASYNCIFY=1` on the
*client* link only (`CLIENT_LDFLAGS`), and the dedicated build's `LDFLAGS` is
deliberately unchanged so its wasm stays byte-identical. The dedicated server is
a build-validation artifact, not part of the Demo, so nothing on the roadmap
fixes this — it would take adding Asyncify and a yield point to the M0 link,
which would end the 2,488,298-byte identity check that guards the source files
both builds share.

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

## The browser client (M1)

    source deps/emsdk/emsdk_env.sh
    make -f web/Makefile client -j8

Four files land in `web/dist-m1/`, all produced by the one `em++` invocation:

| file | ~size | what it is |
|---|---|---|
| `armagetronad.html` | 10 KB | the page. It is `web/shell.html`, passed to `--shell-file` |
| `armagetronad.js` | 640 KB | the loader/glue: fetches the other two, sets up the runtime |
| `armagetronad.wasm` | 8.9 MB | the game. Big because of Asyncify — see *Known limitations* |
| `armagetronad.data` | 680 KB | the preloaded asset tree (config, language, textures, models, sound, maps) |

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

The Play button is not decoration either: the page loads with
`noInitialRun`, and `Module.callMain()` runs from the click. A browser will
not let a page start audio without a user gesture, so something has to be
clicked before the game starts; making that explicit is cheaper than debugging
a muted, half-started runtime.

A successful run shows the game's language menu on the canvas within a few
seconds of the click, and arrow keys / Enter / Escape move through it. What
that looks like, in both browsers, is committed under `docs/evidence/m1-task7/`.

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
- `The AudioContext was not allowed to start` — audio is M3's; the client does
  not yet resume the context on the Play click.
- `TODO: glShadeModel` — an Emscripten GL-emulation stub, not a crash.
- **`WebGL: INVALID_ENUM: hint: invalid target`, hundreds of them**, followed
  by Chrome's `too many errors, no more errors will be reported to the console
  for this context`. This one is noise *today* and a trap for M2 — see the note
  at the end of `docs/porting/browser-runtime-notes.md`.

### The browser-driving harness

`web/tools/` holds two ~200-line Node scripts that open the page in a real
browser, click Play, press keys, take screenshots and record everything the
console says. They exist because the page cannot be checked with a plain
screenshot — nothing runs until Play is clicked — and because retyping the
browser flags each time is how evidence stops being reproducible.

They have **no dependencies**: no Playwright, no Puppeteer, no `npm install`.
Node 22's global `WebSocket` talks the Chrome DevTools Protocol
(`drive-browser.mjs`) and WebDriver BiDi (`drive-firefox.mjs`, because Firefox
dropped CDP in 129). Both take the same options and the same step vocabulary
(`wait:`/`shot:`/`click:`/`key:`/`eval:`/`mark:`); each file's header comment is
the reference.

`web/tools/menu-gate.steps` is the M1 gate itself, as a re-runnable script.
To re-run it — **after `make -f web/Makefile client`, since `web/dist-m1` is
gitignored and a fresh clone has nothing to serve**:

```sh
python3 -m http.server 8000 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --headed --out /tmp/gate-chrome \
     --script-file web/tools/menu-gate.steps
node web/tools/drive-firefox.mjs         --out /tmp/gate-firefox \
     --script-file web/tools/menu-gate.steps
kill %1
```

`--headed` is **required for Chrome** and is not a preference: headless Chrome
152 emits thousands of spurious keydown events per real keypress, which
overflows SDL's event queue and loses the keystroke. Firefox headless is fine.
Pass `--chrome PATH` / `--firefox PATH` if your browsers are not at the macOS
defaults.

Pass looks like: ten screenshots, all ten different from each other, and a
transcript with no `Stack overflow detected`, no `[EXCEPTION]`, no
`SDL event queue full`, and no 404 other than `/favicon.ico`.
`menu-gate.steps`' own comments say what each screenshot is supposed to show
and — just as important — what the gate does *not* demonstrate.

### Known limitations of the client at M1

- **It is not a game yet.** M1 reaches the language menu and the first-run
  setup menu. Everything past them is M2: no round has been played in a
  browser, so cycle physics, AI, walls and scoring are all still untested here.
- **The wasm is 8.9 MB.** Asyncify nearly triples it (+5.9 MB over the same
  objects linked without it). That is the largest single line item in M5's size
  budget, and `docs/porting/browser-runtime-notes.md` § 7 has both the
  measurement and the two ways to reduce it.
- **Frame pacing is `setTimeout`, not `requestAnimationFrame`.** `MAX_FPS` (60,
  from `web/webdefaults/autoexec.cfg`) is honoured — measured at ~63 FPS in the
  menu — but browsers clamp nested timeouts to ~4 ms, so treat 60 as a ceiling
  rather than a cadence.
- **Nothing persists.** No IndexedDB yet, so every page load is a first run and
  the first-run setup menu appears every time. M4.
- **No sound.** The audio context is never resumed. M3.
- **Default arrow-key *steering* will not fire in gameplay.**
  `config/keys_cursor.cfg` binds SDL 1.2 numeric keycodes (274/275/276) and
  Emscripten emits 1105/1103/1104. Menu navigation uses `SDLK_*` constants and
  is unaffected, which is why M1 passes. M2 has to fix this before anything is
  drivable.

**Before adding any sleep, delay or wait to client code, read
`docs/porting/browser-runtime-notes.md` § 8.** `SDL_Delay` looks safe, is
aliased to `emscripten_sleep`, links cleanly, and corrupts the stack pointer at
runtime. That section is the rule and the proof.

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
finish the async bind. Nothing is reachable on 4534. **Still true after M1.**
Asyncify is what would fix it, and M1 does use Asyncify — but only on the
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
graphical client. This port had none at M0; M1 builds one, but it cannot play a
round yet, so a recorded round is still out of reach — M5's validation work is
where to revisit it. So the recording used here is
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
