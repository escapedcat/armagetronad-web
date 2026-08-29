# Browser runtime notes

Long-form reasoning behind the M1 and M2 changes that make the client survive a
browser and play a round. The source files carry short pointers here rather than
the whole argument; this is the file to read before undoing one of them.

Scope: the Asyncify yield, the two `usleep` replacements, the rule about which
sleep primitives are safe at all (§8 — read that one before adding any sleep),
the GL traps, and the camera. Each section is named so a comment can cite it.

**If you are about to touch rendering, read §10 first.** "One `glBegin`/`glEnd`
block, one vertex format" is the largest single class of defect this port has
found. It has two shapes and **one of them is silent** — it draws wrong geometry
without asserting. One instance is still unfixed (`rViewport.cpp:246`).

**If you are about to add `-O` to the client link, read §10 as well, and then
don't.** `ASSERTIONS` being on is the only reason the loud shape of that defect
class is loud.

**§9 was M2's first task and is done.** Kept because the trap it describes —
reading a clean console as evidence when the console had gone deaf — is general,
and §9a records how the same mistake was avoided the second time.

**On emsdk citations.** Line numbers into `deps/emsdk/upstream/emscripten` drift
on every toolchain bump. Each one below is paired with a greppable token; if the
line is wrong, grep the token before concluding the claim is stale.

---

## 1. Guarding a change per build variant

`em++` defines `__EMSCRIPTEN__` for **both** wasm variants this repo builds —
the M0 dedicated server and the M1 browser client. `src/emscripten/config.h`
defines `DEDICATED` unless `-DAA_WEB_CLIENT` is passed. So:

| intent | guard |
|---|---|
| both wasm variants, not native | `#ifdef __EMSCRIPTEN__` |
| browser client only | `#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )` |
| everything except the browser client | `#if defined( DEDICATED ) \|\| !defined( __EMSCRIPTEN__ )` |

A plain `#ifdef __EMSCRIPTEN__` is only correct when the surrounding code is
already inside `#ifndef DEDICATED`. Check per *site*, not per file — `rScreen.cpp`
contains both kinds. In M1 it is true at `rSysdep.cpp` (`SwapGL()` and
`sr_LimitFPS()`, both inside the region opened at `:465`), `rScreen.cpp` (the two
ALT-Tab waits, inside the region opened at `:432`), `rGLRender.cpp` (whole file,
`:30-259`) and `eDisplay.cpp` (`infinity_xy_plane()`, inside `:70-615`); and it
is **not** true at `tSysTime.cpp` (`tDelay`/`tDelayForce`) or `rScreen.cpp`
(`sr_LoadDefaultConfig()`).

### Checking it, and the check that lies to you

An earlier revision of this section recommended an `awk` one-liner that counts
`#if`/`#endif` depth down to a line number. **Do not use it. It is wrong on the
very file this section warns you about**, and it is wrong in the dangerous
direction — it reports code as guarded that is not.

```bash
# WRONG -- kept only so it is recognisable if you find it quoted somewhere.
awk '/^[ \t]*#[ \t]*(if|ifdef|ifndef)/ {d++; s[d]=NR"|"$0; next}
     /^[ \t]*#[ \t]*endif/ {d--; next}
     NR==1007 {for(i=1;i<=d;i++) print "depth "i": "s[i]}' src/render/rScreen.cpp
#   -> depth 1: 432|#ifndef DEDICATED
```

That answer is false. `sr_LoadDefaultConfig()` at `rScreen.cpp:1007` is **not**
inside any `#ifndef DEDICATED` — the region opened at `:432` closes at `:878` —
and the function is compiled into the dedicated build. Which is exactly why the
NVIDIA branch inside it (§ 6) needed the three-clause guard rather than a bare
`#ifdef __EMSCRIPTEN__`.

The cause: a preprocessor directive does not stop being one for `awk` when it
sits inside a comment. `rScreen.cpp:546-553` is a block comment containing
`#ifdef POWERPAK_DEB` and a matching `#else`, but no `#endif` — the `*/` comes
first. `awk` counts the opener, never sees a closer, and reports every depth
from `:547` onward one too high. The imbalance is visible directly: the file
has 45 lines matching the opener pattern and 44 `#endif`s.

```bash
grep -c '^[ \t]*#[ \t]*\(if\|ifdef\|ifndef\)' src/render/rScreen.cpp   # 45
grep -c '^[ \t]*#[ \t]*endif'                 src/render/rScreen.cpp   # 44
```

Any C file may contain that shape, and a text-level nesting counter cannot be
trusted on any of them.

**Not hypothetical.** Mis-reading which side of a `#ifndef DEDICATED` a line
sits on is the mistake that silently changed the M0 wasm earlier in this
milestone. Silently, because — as the next subsection explains — the wrong
guard links cleanly.

#### The authoritative check: ask the preprocessor

Only the preprocessor knows. Run it with the dedicated build's flags and grep
the output for a token from the line in question. Token present ⇒ the line is
in the dedicated build.

```bash
source deps/emsdk/emsdk_env.sh
em++ -E -std=gnu++14 \
     -I src/emscripten -I deps/build/libxml2-install/include/libxml2 \
     -iquote src -iquote src/tools -iquote src/network -iquote src/render \
     -iquote src/ui -iquote src/engine -iquote src/tron \
     -iquote src/thirdparty/binreloc -iquote src/thirdparty/particles \
     src/render/rScreen.cpp | grep -c sr_LoadDefaultConfig
```

Run against this tree, with a positive and a negative control inside the same
file so the command checks itself:

| token in `rScreen.cpp` | dedicated | client | what it means |
|---|---|---|---|
| `sr_LoadDefaultConfig` | 2 | 3 | in **both** builds — `awk` called this dedicated-excluded, and was wrong |
| `NVIDIA` | 1 | 0 | the § 6 guard doing its job: kept for dedicated, gone from the client |
| `glHint` | 0 | ~~3~~ **2** | see below — this row is a live example of a control going stale |

Re-measured at M2 exit; the first two rows still reproduce exactly. **The
`glHint` row changed, and the reason is instructive rather than annoying.** At
M1 the client saw 3 hits: two header declarations (`glHint` and `glHintPGI`) and
the call at `:1112`. M2's Task 1 compiled that call out of the client (§ 9), so
the client now sees the two declarations only. Two things follow. First, a
control table is an assertion about the tree and goes stale with it — if these
numbers do not reproduce, check the tree before concluding the *method* is
broken. Second, `grep -c` over preprocessed output counts **declarations, not
just uses**: a token that appears in a GL header will never reach 0 in a build
that includes it, so "0 vs non-zero" is only meaningful for tokens that exist
solely in this codebase. `sr_LoadDefaultConfig` and `NVIDIA` are good controls
for that reason; `glHint` was always a slightly poor one.

For the client column, add `-DAA_WEB_CLIENT -sUSE_SDL=1 -sUSE_LIBPNG=1` to the
same command; nothing else changes. Choose a *distinctive* token — a function
name, a string literal, an odd identifier. A common word will match somewhere
in the ~66,000 lines of expanded headers and tell you nothing.

#### The check that is right about the wrong thing

**`em++ -E` can fail and still print a full, plausible preprocessed stream. A
`grep -c` that does not test the exit status will get a confidently wrong
answer, and the recipe above pipes straight into `grep`, which throws that
status away.** Found in M2 Task 1, where it produced a `0` that sat in a report
next to numbers from healthy runs.

The failure looks like this:

```
In file included from src/render/rScreen.cpp:28:
In file included from src/render/rFont.h:31:
src/render/rSDL.h:4:10: fatal error: 'config.h' file not found
1 error generated.
```

despite `-I src/emscripten` being present and correct. clang does **not** stop
there: it recovers from the missing header and preprocesses the rest of the
translation unit, so stdout still contains tens of thousands of lines and looks
normal. But `config.h` is what defines `DEDICATED`, so a run that hits this
silently never defines it — **for the dedicated and the client command line
equally**, which destroys exactly the comparison the technique exists to make.
It was reproduced on demand in this environment: five consecutive identical
invocations all exiting 1, immediately after two identical ones exiting 0. No
flag, ordering or `-MMD -MP` change made it go away. It is nondeterministic
here, not caused by a bad command line.

So: **redirect to a file and let the shell gate the grep on the exit status.**
`&&` rather than `;` is the whole fix — a failed preprocess then prints nothing
instead of printing a number:

```sh
em++ -E -std=gnu++14 \
     -I src/emscripten -I deps/build/libxml2-install/include/libxml2 \
     -iquote src -iquote src/tools -iquote src/network -iquote src/render \
     -iquote src/ui -iquote src/engine -iquote src/tron \
     -iquote src/thirdparty/binreloc -iquote src/thirdparty/particles \
     src/render/rScreen.cpp > /tmp/pp.i \
  && grep -c sr_LoadDefaultConfig /tmp/pp.i
```

`-c` compiles were not observed failing this way — every one run during Task 1
succeeded, including several interleaved with failing `-E` runs — which is why
the `llvm-nm` route below is the reliable fallback when `-E` will not settle
down. It answers a coarser question (does the *function* survive?), so it does
not replace `-E` for a question about a particular line.

#### The cheap check, when the question is about a whole function

If the question is only whether a *function* survives into the dedicated build,
the object file already on disk answers it without recompiling:

```bash
deps/emsdk/upstream/bin/llvm-nm web/build-m0/render/rScreen.o | grep LoadDefaultConfig
#   -> 00001b2c T _Z20sr_LoadDefaultConfigv        (T = defined in this object)
```

Two caveats. **`llvm-nm` is not on `PATH` after `source
deps/emsdk/emsdk_env.sh`** — spell out `deps/emsdk/upstream/bin/llvm-nm`, as
above. And it answers at function granularity only: `sr_ResetRenderState` is
`T` in that same object even though most of its body is inside `#ifndef
DEDICATED`, because the *function* is not. For a question about a particular
line, use `em++ -E`.

### Why getting this wrong is not caught by the build

The natural assumption is that a client-only symbol leaking into the dedicated
build fails at link, because `web/Makefile` sets
`-sERROR_ON_UNDEFINED_SYMBOLS=1`. For `emscripten_sleep` that is false.

Without `-sASYNCIFY`, `emscripten_sleep` is still a defined JS library
function. Its entire body is

```js
emscripten_sleep: () => {
  abort('Please compile your program with async support in order to use asynchronous operations like emscripten_sleep');
},
```

(`src/lib/libasync.js`, grep `in order to use asynchronous operations`). So the
mistake links cleanly, silently changes the dedicated wasm, and aborts the
server at the first call.

`tDelay` is live in the dedicated build — `llvm-nm` finds an undefined
`_Z6tDelayi` in `nSocket.o`, `nNetwork.o`, `nServerInfo.o` and `gGame.o` — so
the abort would be reached in normal operation, not in some corner.

**Rule for M2 and later: any new `emscripten_*` call in a translation unit that
is not already inside `#ifndef DEDICATED` must use the client-only guard.**

The cheap check is **`grep -c emscripten_sleep web/dist-m0/armagetronad-dedicated.js`**,
which must stay 0. An earlier revision of this note said to grep for
`emscripten_` and expect 0; that can never be 0 in any Emscripten build and so
tests nothing. The current dedicated build has 50 such hits and is correct —
all of them are toolchain runtime internals (`emscripten_stack_get_end`,
`emscripten_get_now`, `emscripten_resize_heap`, `emscripten_builtin_memalign`
and similar), none of them a call this port introduced.

The other cheap check, for the hazard in §8, is
`grep -c SDL_Delay web/dist-m0/armagetronad-dedicated.js` — also 0, and 0 in
the *client* wasm's imports too, which is the one that matters.

Both of those are post-link and tell you only that *something* is wrong. To get
the same answer per file, before linking and with the offender named, run the
preprocessor over every game source the port has patched:

```bash
source deps/emsdk/emsdk_env.sh
for f in $(git diff --name-only main...HEAD -- 'src/*.cpp' | grep -v '^src/emscripten/'); do
  n=$(em++ -E -std=gnu++14 -I src/emscripten \
        -I deps/build/libxml2-install/include/libxml2 \
        -iquote src -iquote src/tools -iquote src/network -iquote src/render \
        -iquote src/ui -iquote src/engine -iquote src/tron \
        -iquote src/thirdparty/binreloc -iquote src/thirdparty/particles \
        "$f" | grep -c 'emscripten_sleep\|SDL_Delay')
  printf '%-28s %s\n' "$f" "$n"
done
```

**Every count must be 0**, because neither symbol belongs in a dedicated build.
As of M1 all ten patched files report 0 — which is what re-verified §8's
"checked, not assumed" claim about the `rSysdep.cpp` and `rScreen.cpp` guards
after the `awk` tool that originally checked them turned out to be unreliable.
A non-zero row names the file to go and look at.

---

## 2. Why the yield is at the top of `SwapGL()`

`src/render/rSysdep.cpp`. The game has no frame callback. Every loop in it is a
plain `while()` that returns only when its work is done, so nothing ever hands
control back to the browser's event loop. `emscripten_sleep(0)` unwinds the C++
stack to the JS caller and resumes the call afterwards; Asyncify is the
machinery that makes that possible.

Placement is the whole decision:

- `SwapGL()` returns early out of its `if (!sr_glOut)` block, and that return
  skips the buffer swap, `breakpoint()` and `sr_LimitFPS()`. `!sr_glOut` is
  common, not exotic — the console clears it while auto-scrolling, and the
  recorder's frame-skip and fast-forward paths both drive it. A yield below
  that block is skipped for exactly the loops that spin hardest.
- `sr_LimitFPS()` is the wrong place for *this* yield: it runs *after* that
  early return, so it would miss exactly the callers that need it most. It does
  yield too, when a frame finishes ahead of the cap — a second yield inside the
  same `SwapGL()` call. That is fine; §8 has the measurement. What is not fine
  is the primitive it used to yield with, which is also §8.
- Every blocking loop reaches `SwapGL()` once per iteration. `uMenu::Enter`
  calls it unconditionally at `uMenu.cpp:390`, covering both the rendering path
  and the `tDelay(10000)`-throttled idle path at `uMenu.cpp:386`.

Top-of-function is the only placement that is provably once per call for every
caller on every path.

### Consequences to expect

`emscripten_sleep` is `Asyncify.handleSleep` around `setTimeout`
(`src/lib/libasync.js`, grep `emscripten_sleep:`). Browsers clamp nested
timeouts to about 4ms. Therefore:

- The client caps near 250 FPS and is **not** aligned to
  `requestAnimationFrame`. Expect uneven pacing rather than a smooth 60Hz.
  Converting the render loop to rAF is a much larger change.
- **Console output is now expensive.** `rConsole::DisplayAtNewline()` calls
  `rSysDep::SwapGL()` (`rConsoleGraph.cpp:67`), so a console newline can cost a
  full event-loop round trip. It is gated — `rConsole.cpp:130` requires
  `autoDisplayAtNewline`, no `NoAutoDisplayAtNewline` callback (the menu
  suppresses it, `uMenu.cpp:144`) and `sr_textOut`; `DisplayAtNewline()` itself
  requires `sr_glOut` — but `autoDisplayAtNewline` is switched on precisely
  during the long operations that print a lot: game loading (`gGame.cpp:2077`,
  `:2255`) and the server browser (`gServerBrowser.cpp:216`, `:261`). A burst of
  output there becomes seconds of wall clock. **If the page looks hung during
  boot or while connecting, check this before suspecting Asyncify itself.**

---

## 3. `tDelay` / `tDelayForce` — patch inside the recorder guards

`src/tools/tSysTime.cpp`. Emscripten's `usleep()` busy-waits on the calling
thread: on the main thread it burns a core *and* freezes the tab for the full
duration, because it never returns to the event loop.

The replacement goes inside each function's existing `if`, not above it. These
two functions exist for their guards:

- `tDelay()` must not sleep at all during playback; it only records that a
  delay was wanted (`s_delayedInPlayback`).
- `tDelayForce()`'s `else` branch does not sleep either — it rewinds
  `timeStart` by the delay. That rewind is what makes a recording replay
  identically on a machine of a different speed.

Replacing libc `usleep()` globally, or hoisting the sleep above the `if`, would
break demo playback (an M5 deliverable) and would catch callers that must not
yield.

`usecdelay / 1000` truncates, so a sub-millisecond request becomes
`emscripten_sleep(0)`. That is not a lost yield — 0 still round-trips through
the event loop, which is the point of the call.

---

## 4. `glTexCoord4f`: remove the caller, do not shim the callee

`src/engine/eDisplay.cpp`. Emscripten defines the symbol as
`() => { abort('glTexCoord4f: TODO') }` (`src/lib/libglemu.js`, grep
`glTexCoord4f`) — an abort of the whole runtime, so the tab dies rather than the
floor rendering wrong.

The only code in the tree that reaches it is the `else` branch of
`infinity_xy_plane()`, and that branch requires `sr_infinityPlane`. M1 forces
`use_rim = true` under `__EMSCRIPTEN__`, which makes all six calls unreachable.

### Why no shim is available

**A 4-component texture coordinate is projective: `q` must survive
interpolation and divide `s` and `t` per *fragment*.** That is the argument the
decision rests on, and it holds independently of any particular vertex's
values:

1. There is no C++-reachable way to hand `q` to the rasteriser. libglemu's
   immediate-mode attribute path is 2-wide — `glTexCoord2i` pushes exactly two
   floats and calls `addRendererComponent(GLImmediate.TEXTURE0, 2, GLctx.FLOAT)`
   (`src/lib/libglemu.js`, grep `addRendererComponent(GLImmediate.TEXTURE0`).
   Widening it means a custom `--js-library`, which is a different change.
2. The only shim expressible in C++ is `glTexCoord2f(s/q, t/q)` — a *per-vertex*
   divide. That is affine texture mapping. It is wrong wherever `q` varies
   across a primitive, and it is most wrong exactly here, because the whole
   construction is a triangle fan whose outer vertices are points at infinity.

### The arithmetic, stated correctly

An earlier draft of this reasoning claimed the per-vertex divide yields `NaN`.
That is wrong and the correction is worth keeping, because someone revisiting
the shim question will check it.

With `sr_infinityPlane` true, `zero` stays `0` (`eDisplay.cpp:128` initialises
it; `:164` sets `.001` only when the setting is *off*). Five of the six calls
are then `(s, t, r, q)` = `(1, 0.1, 0, 0)`, `(0.1, 1.1, 0, 0)`,
`(-1, 0.1, 0, 0)`, `(0.1, -1.1, 0, 0)`, `(1, 0.1, 0, 0)`.

A 2-wide shim computes `s/q` and `t/q` only. Those are `1/0`, `0.1/0`, `-1/0` —
**±Infinity, not NaN**. `r/q` would be `0/0` and therefore NaN, but a 2-wide
shim never computes it. The sixth call passes `q = 1` and divides cleanly.

So the shim does not produce NaN; it produces infinities and an affine
approximation of a projective mapping. That is still not something to ship, but
"it would be wrong" is the honest claim, not "it would be NaN".

### What the forcing does and does not guarantee

**Does:** the six calls become unreachable however `sr_infinityPlane` was set —
the `INFINITY_PLANE` config item (`gMenus.cpp:168`), the Tweaks menu toggle
(`gMenus.cpp:589-592`), or the vendor sniff had it survived. Written at the
single consumption point rather than by pinning the variable, so it does not
have to fight each writer. It also pins the *existing default*: with
`sr_infinityPlane` false, `use_rim` was already unconditionally true, so nothing
changes for a default configuration.

**Does not:** `glTexCoord4f` is still an abort, and
`rGLRender.cpp`'s `rRenderer::TexCoord(REAL,REAL,REAL,REAL)` overload still
forwards to it unguarded. That overload has no callers anywhere in the tree
today; if one is added it will abort, and this change does not protect it.

**Also does not:** the Tweaks toggle still moves and still does nothing visible.
Hiding it, or showing it as forced off, is an M4 UI question.

---

## 5. `GL_QUAD_STRIP` → `GL_TRIANGLE_STRIP`

`src/render/rGLRender.cpp`. Emscripten's immediate-mode emulation supports
`GL_POINTS` through `GL_TRIANGLE_FAN` plus `GL_QUADS` and aborts the runtime on
anything else:

```js
} else if (GLImmediate.mode > 6) { // above GL_TRIANGLE_FAN are the non-GL ES modes
  if (GLImmediate.mode != 7) abort('unsupported immediate mode ' + GLImmediate.mode);
```

(`src/lib/libglemu.js`, grep `unsupported immediate mode`). `GL_QUAD_STRIP` is
mode 8. Fatal.

`GL_TRIANGLE_STRIP` is a faithful substitution, not an approximation: both
consume the vertex stream as a ladder of adjacent pairs, in the same order, and
cover the same surface. The only difference is that a quad strip's implied
diagonal is unspecified while a triangle strip's is fixed — invisible for the
flat, per-vertex-shaded quads the one caller draws.

The caller is `gWall.cpp:1242`, the cycle wall, drawn every frame of every
round, guarded by `sg_renderBeginQuads` — a `static const bool = true` outside
DEBUG (`gWall.cpp:1066`). Not configurable. Not reachable from the main menu, so
M1 does not depend on it; M2 does.

### The aliasing check

`BeginPrimitive()` elides the `glBegin` when the requested mode equals
`lastPrimitive`, so mapping two rRenderer primitives onto one GLenum could
silently merge a triangle strip and a quad strip into one batch. It cannot
happen: **`BeginTriangleStrip()` has zero call sites in the whole tree** — it is
declared at `rRender.h:67`, wrapped at `rRender.h:177`, implemented at
`rGLRender.cpp:157`, and never called. If one ever appears, note that both
overloads pass `forceEnd=true`, which makes the next `End()` emit a `glEnd` and
clear `lastPrimitive` regardless of its `force` argument.

---

## 6. The GPU-vendor branch

`src/render/rScreen.cpp`, `sr_LoadDefaultConfig()`. The `NVIDIA` branch is
compiled out of the browser client.

This is a **clarity change, not a crash fix**. The branch cannot fire in a
browser: `gl_vendor` comes from `glGetString(GL_VENDOR)` (`rScreen.cpp:720`),
and Emscripten forwards `GL_VENDOR` (0x1F00) to WebGL's own `VENDOR` parameter
rather than to `UNMASKED_VENDOR_WEBGL` (`src/lib/libwebgl.js`, grep
`case 0x1F00`). It reads "Mozilla" or "WebKit", never "NVIDIA".

Removed anyway because everything about it is hostile here:

- Both effects are traps. `sr_infinityPlane=true` is the only route to
  `glTexCoord4f` (§4); `rDisplayList_CAC` routes geometry through the
  display-list stubs in `src/emscripten/eCompat.cpp`, which capture nothing.
- It runs on every page load — `sr_LoadDefaultConfig()` is called from
  `gArmagetron.cpp:297` under `if (st_FirstUse)`, and until M4 gives the client
  persistent storage, every page load is a first use.
- It runs *after* config parsing, so no `.cfg` can defend against it. It
  overwrites the player's `INFINITY_PLANE`.

The neighbouring 3Dfx / ATI-on-MacOSX / Matrox branches are left alone: equally
dead under WebGL, but none enables anything that aborts.

A vendor string is a proxy for driver capabilities. WebGL is one implementation
with one capability set; there is nothing to sniff.

---

## 7. Asyncify: what it costs and how to reduce it

`web/Makefile`, `CLIENT_LDFLAGS`. `-sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072`.

Asyncify is a **link-time** Binaryen transform over the linked wasm; passing it
at compile time does nothing, which is why it is absent from `CLIENT_CXXFLAGS`.

Relinking the same 101 objects with and without the two flags:

| | wasm | js |
|---|---|---|
| without | 2,982,495 | 584,996 |
| with | 8,871,099 | 625,787 |
| delta | **+5,888,604 (+197%)** | +40,791 (+7%) |

The wasm very nearly triples. Asyncify displaces `-fexceptions` (+827,185) as
the largest single line item in M5's size budget, by a factor of about seven.
The cause is that `ASYNCIFY=1` instruments every function that could be on the
stack when an async call happens, and here that is essentially the whole
program: `SwapGL()` sits at the bottom of the render tree, which every game loop
calls.

### Reducing it

`ASYNCIFY_ONLY` (or `ASYNCIFY_REMOVE` / `ASYNCIFY_ADD`) instruments a named list
instead of everything. Do **not** hand-write that list — a wrong list fails as an
`unreachable` trap at runtime, not as a build error.

Generate it instead: **`-sASYNCIFY_ADVISE`** (`src/settings.js`, grep
`ASYNCIFY_ADVISE`; wired into the Binaryen pass at `tools/link.py`, grep
`settings.ASYNCIFY_ADVISE`) makes the toolchain print the functions it
instrumented together with the reason each one was included. That output is the
input to a defensible `ASYNCIFY_ONLY`. It is worth doing only once the client
actually runs, so the advice can be checked against real behaviour — which is
why M1 does not attempt it.

JSPI is the other exit and would cost far less. Older notes in this repo claimed
it conflicts with `-fexceptions`; **that is not enforced by the emsdk in use** —
`src/settings.js` has `var JSPI = 0` and `tools/link.py` contains no
JSPI/exceptions or JSPI/longjmp `exit_with_error` (the only Asyncify
incompatibility encoded there is `WASM_ESM_INTEGRATION`). Treat the interaction
as **needing verification against the emsdk in use** rather than as a known
blocker. The real obstacle is browser baseline, not the toolchain.

### `ASYNCIFY_STACK_SIZE`

131072 (128KB), 32x the 4096 default. The buffer is a **fixed** allocation, not
a growing one: overflowing it aborts at runtime with "Asyncify stack overflow",
never at build time. It has not been validated against a running client. If that
string appears in the console, raise the number — it costs linear memory and
nothing else.

---

## 8. Never call `SDL_Delay` in the client

`src/render/rSysdep.cpp` (`sr_LimitFPS()`), `src/render/rScreen.cpp` (two
ALT-Tab waits). **The rule is about which sleep primitive you call, not about
how many times per frame you call it.**

> **Correction notice.** An earlier revision of this section said the rule was
> "one Asyncify yield per frame, and no more", and had `sr_LimitFPS()` compiled
> out of the client entirely. That was a working fix built on a wrong diagnosis.
> Two yields per frame are fine. The hazard was `SDL_Delay` specifically. Both
> the fix and the rule below replace it. If you find the old rule quoted
> anywhere (it is in commit `1c156cc9`'s message, which is history and stays as
> written), this section supersedes it.

### The rule

**Only call sleeps that appear in `ASYNCIFY_IMPORTS`.**

| primitive | safe in the client? | why |
|---|---|---|
| `emscripten_sleep()` | **yes** | carries `emscripten_sleep__async: 'auto'` (`src/lib/libasync.js`, grep `emscripten_sleep__async`), so it reaches `ASYNCIFY_IMPORTS` and Binaryen instruments its call sites |
| `tDelay()` / `tDelayForce()` | **yes** | they *are* `emscripten_sleep` in the client (`src/tools/tSysTime.cpp`, §3) |
| `SDL_Delay()` | **NO** | aliased to `emscripten_sleep` on the JS side only; never reaches `ASYNCIFY_IMPORTS` |
| `usleep()` | works, but don't | Emscripten busy-waits it: burns a core and freezes the tab for the full duration (§3) |

The escape hatch, if a call site you cannot edit ever forces it, is
**`-sASYNCIFY_IMPORTS=SDL_Delay`** at link. It is verified to work (below).
Prefer deleting the call: with no `SDL_Delay` anywhere in the client,
"`WebAssembly.Module.imports()` on `armagetronad.wasm` lists no `SDL_Delay`"
is a one-line invariant anyone can check.

```bash
node -e "const fs=require('fs');
  console.log(WebAssembly.Module.imports(new WebAssembly.Module(
    fs.readFileSync('web/dist-m1/armagetronad.wasm')))
    .filter(i=>/Delay|sleep/i.test(i.name)))"
```

### Why `SDL_Delay` is the one that breaks

Emscripten's SDL declares it, under `#if ASYNCIFY`, as a plain alias:

```js
SDL_Delay: 'emscripten_sleep',
```

(`src/lib/libsdl.js`, grep `SDL_Delay: 'emscripten_sleep'`.) So at runtime
`_SDL_Delay` genuinely *is* the wrapped function that starts an unwind.

The alias is resolved in `src/jsifier.mjs` — grep `LibraryManager.isAlias` —
and that resolution **does not copy the target's `__async` decorator**. The
list that matters is built earlier in the same function, from
`LibraryManager.library[symbol + '__async']` (grep `asyncFuncs.push`), and
`SDL_Delay__async` does not exist. `tools/link.py` turns exactly that list into
the Binaryen argument (grep `js_info\['asyncFuncs'\]`, and
`--pass-arg=asyncify-imports@` just above it).

So the two halves disagree. **JS side:** a real unwind starts. **Wasm side:**
the caller of `SDL_Delay` was never instrumented, so it does not check
`asyncify_state`, does not spill its frame, and runs on to return normally —
while instrumented frames above it rewind anyway and restore
`__stack_pointer` from an asyncify-stack slot that was never written. That is
the reported "SP set to a tiny absolute address at every stack size": not stack
exhaustion, not a memory-layout problem, just a stack pointer restored from
garbage.

### How that was verified

Two ways, against the emsdk in `deps/` (6.0.8):

**1. The Binaryen argument itself.** `emcc -v` prints the pass arguments:

```
asyncify-imports@env.invoke_*,env.__asyncjs__*,*.fd_sync,...,*.emscripten_sleep,
*.emscripten_wget_data,*.emscripten_scan_registers,*.emscripten_fiber_swap
```

`*.emscripten_sleep` is there. `*.SDL_Delay` is not.

**2. A reduction with `SwapGL()`'s shape** — one yield at the top, a nested
call that yields again — built three ways from the *same* source and run under
Node:

| build | result |
|---|---|
| both yields `emscripten_sleep` | **SURVIVED 100 frames with TWO yields per frame** |
| second yield `SDL_Delay` | `RuntimeError: unreachable`, immediately |
| second yield `SDL_Delay`, plus `-sASYNCIFY_IMPORTS=SDL_Delay` | **SURVIVED 100 frames** |

Row 1 disproves the yield-counting rule. Rows 2 and 3 together isolate the
variable to `SDL_Delay`'s absence from `ASYNCIFY_IMPORTS`, since nothing else
differs between them.

### Why the original bisection pointed the wrong way

It was sound as localisation and invalid as generalisation. Flipping `MAX_FPS`
between 60 and 0 on an identical binary really does flip the failure — but
`sr_LimitFPS()` returns early when `MAX_FPS` is 0, so what that flip actually
controls is *whether `SDL_Delay` is reached at all*, not how many yields happen
per frame. Both readings fit the data; only one survives the reduction above.

Worth keeping as a method note: a bisection tells you which switch changes the
outcome. It does not tell you what the switch is wired to.

### What the symptom looked like

With the limiter on, the client:

1. booted, initialised GL, loaded its textures, drew the title screen and drew
   the language menu correctly — one frame;
2. then never updated the picture again;
3. never responded to a keystroke — `_SDL_PollEvent` was called **once in six
   seconds**, against ~60 times a second expected;
4. and, in most runs, died seconds later with
   `Attempt to set SP to 0xffffffb0`.

Throughout, the game loop was *running*: ~120 yields a second, parked in
`uMenu::OnEnter -> rSysDep::SwapGL` exactly where it should be. Alive,
rendering nothing, deaf to input — which is what makes one bug look like three,
in the renderer, the input layer and the memory layout.

Things ruled out by measurement on the way, all of them still correctly ruled
out: `-sSTACK_SIZE` at 64KB/1MB/4MB (identical failure each time),
`-sGLOBAL_BASE=1024` (bogus SP still ~0, so nowhere near the stack),
`-sASYNCIFY_STACK_SIZE` at 1MB, `-fwasm-exceptions`, and `SOUND_QUALITY 0`.

### Where the calls were, and what was done

| site | before | after |
|---|---|---|
| `rSysdep.cpp`, `sr_LimitFPS()` | `SDL_Delay(...)`; whole function `return`ed early under `__EMSCRIPTEN__` | `emscripten_sleep(...)` under `__EMSCRIPTEN__`, `SDL_Delay` kept for native. Limiter works; `MAX_FPS` is live again |
| `rScreen.cpp` ×2, the ALT-Tab waits | `while ((SDL_GetAppState() & SDL_APPACTIVE) == 0) SDL_Delay(100);` | compiled out under `__EMSCRIPTEN__` |

The `rScreen.cpp` pair were the *only* objects in the whole client link with an
undefined `SDL_Delay` (checked with `llvm-nm` over every `.o`), and they were
dormant purely by luck: `SDL_GetAppState` ORs `SDL_APPACTIVE` into its result
unconditionally (`src/lib/libsdl.js`, grep `SDL_GetAppState`), so the loop
never spun. Any change to that shim would have trapped immediately. There is no
ALT-Tab in a browser; if page visibility is ever wanted it is
`document.visibilityState` and a different design, M2/M4's.

Both guards are bare `#ifdef __EMSCRIPTEN__` / `#ifndef __EMSCRIPTEN__`, which
§1 permits only inside an existing `#ifndef DEDICATED`. Checked, not assumed:
`sr_LimitFPS()` is inside the region opened at `rSysdep.cpp:465`, and both
`rScreen.cpp` waits are inside the one opened at `rScreen.cpp:432`. Neither
appears in the dedicated build, whose wasm is unchanged at 2,488,298 bytes.

**Re-checked at M1 exit with a tool that works.** The nesting above was
originally confirmed with §1's `awk` one-liner, which has since been shown to
give wrong answers on `rScreen.cpp` (a commented-out `#ifdef` throws its depth
count off — §1 has the detail). Re-run through `em++ -E` with the dedicated
flags, both files still come out clean: zero `emscripten_sleep` and zero
`SDL_Delay` survive dedicated preprocessing in either. The conclusion held; the
tool that produced it did not, and that is worth knowing if any of these guards
is ever revisited.

### What this costs, and what to watch for

The frame rate is capped again, at `MAX_FPS` — 60, which since M4 task 3 is the
compiled default of `sr_maxFPS` in `rSysdep.cpp`, guarded by
`#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )`. It is **no longer a
line in `web/webdefaults/autoexec.cfg`**: that file loads after `user.cfg`, so
the cap was a hard override a player could change in the menu and never keep.
As a compiled default it applies absent a `user.cfg` and loses to one the
moment there is one. `docs/evidence/m4-config-precedence/` has the
before/after.
It is still not `requestAnimationFrame`-aligned: `emscripten_sleep` is
`setTimeout`, which browsers clamp to ~4ms once timeouts nest, so expect uneven
pacing and treat 60 as a ceiling rather than a cadence. Converting the render
loop to rAF — which would pace properly and remove the need for a frame limiter
at all — is M2/M5's.

**For M2.** `tDelay()` and `tDelayForce()` are safe (§3) and need no special
handling, including on paths that already reach `SwapGL()` —
`uMenu::OnEnter`'s `tDelay(10000)` idle branch and `SwapGL()`'s own
recorder-playback `tDelayForce()` are both fine, and neither needs counting.
The thing to grep for before adding a sleep is `SDL_Delay`; the thing to check
after linking is the `WebAssembly.Module.imports()` one-liner above.

---

## 9. The WebGL error console goes silent 1.4 s into boot — fix this first in M2

**This should be M2's first commit, before any gameplay-rendering work.** M2 is
the milestone that has to debug WebGL — walls, cycles, the floor, the font
atlas, alpha test, fog — and it would start with its most important diagnostic
already switched off.

In the committed Chrome transcript
(`docs/evidence/m1-task7/chrome-console.log`), the client emits **256** copies
of

```
WebGL: INVALID_ENUM: hint: invalid target
```

between `6310ms` and `7409ms` — about 1.1 s of errors, 1.4 s after the module's
first output — and Chrome then prints, at line 280:

```
WebGL: too many errors, no more errors will be reported to the console for this context.
```

That is per WebGL *context*, and it is permanent for the life of that context.
Everything after that point — every genuinely useful `INVALID_OPERATION`,
`INVALID_VALUE` or incomplete-framebuffer complaint M2 might cause — is
discarded before it reaches the console. The tab looks quiet because the budget
is spent, not because nothing is wrong.

### The cause is one line, and it is not ambiguous

`src/render/rScreen.cpp:1099`, in `sr_ResetRenderState()`'s `if (menu)` branch:

```cpp
glHint (GL_PERSPECTIVE_CORRECTION_HINT, GL_FASTEST);
```

- It is the **only** `glHint` call in the entire tree (`grep -rn glHint src/`).
- `GL_PERSPECTIVE_CORRECTION_HINT` is `0x0C50`
  (`cache/sysroot/include/GL/gl.h:583`). WebGL 1 accepts exactly one hint
  target, `GENERATE_MIPMAP_HINT` — perspective correction is not optional in
  WebGL and there is nothing to hint at.
- Emscripten does not filter it. `libglemu.js` wraps `glHint` and drops only
  `GL_TEXTURE_COMPRESSION_HINT` (`0x84EF`), passing everything else straight to
  `GLctx.hint()` — `src/lib/libglemu.js`, grep `orig_glHint`.
- `sr_ResetRenderState(true)` runs per menu frame, which is why one bad call
  becomes 256 errors in a second and exhausts the budget so fast.

The obvious fix is a guarded no-op at that call site, the same shape as every
other patch in this note. Do not "fix" it by suppressing console output.

### Two things not to conclude from this

**The picture is correct.** The hint is rejected, so nothing is applied, and
perspective correction is always on in WebGL anyway. This is a diagnostics
problem, not a rendering bug — M1's screenshots are what the game intends.

**The Firefox transcript proves nothing here.** It contains no WebGL warnings
at all, and that is a harness artifact: `drive-browser.mjs` receives Chrome's
browser-level `Log` entries over CDP, while `drive-firefox.mjs` captures only
`console.*` and network events over BiDi. Firefox's own WebGL warnings were
never being collected. Do not read its clean transcript as a clean run.

### 9a. M2 went looking for those warnings and they are not there

Written after the M2 gate, which needed a Firefox transcript that meant
something. Three things were tried and the third is the one that works.

1. **The labelling was wrong, and that is fixed.** `drive-firefox.mjs` printed
   *every* `log.entryAdded` entry of type `javascript` as `[EXCEPTION]` and
   ignored `entry.level`. So even if a warning had arrived it would have been
   reported as an exception, failing the gate for the wrong reason. It now
   prints non-error levels as `[browser.LEVEL/javascript]`, matching Chrome.

2. **The per-context warning cap was raised.** Firefox stops reporting after
   `webgl.max-warnings-per-context` warnings (32 by default) and then goes
   silent for the life of the context — indistinguishable, in a minutes-long
   run, from a clean one. The driver now writes a `user.js` into its throwaway
   profile raising it to 100000.

3. **Neither helped, and that is the finding.** Measured with a positive
   control in `web/tools/gameplay-gate.steps` — a deliberate
   `glHint(GL_PERSPECTIVE_CORRECTION_HINT, GL_FASTEST)` on a throwaway canvas,
   i.e. the exact call this section is about:

   | | deliberate bad `glHint` | deliberate uncaught `TypeError` |
   |---|---|---|
   | Chrome 152 | `[browser.warning/rendering] WebGL: INVALID_ENUM: hint: invalid target` | `[EXCEPTION]` |
   | Firefox 154.0.1 | **nothing at all** | `[EXCEPTION]` |

   So Firefox's BiDi `log.entryAdded` subscription is alive — it reports
   browser-generated JS errors fine — and simply does not carry WebGL warnings.
   Raising the cap and fixing the labelling could not have helped.

**What to use instead, in either engine.** Read `glGetError()` back off the
game's own context. It is the same WebGL state machine in both browsers, so
the same defect gives the same line, and it is free here: `sr_CheckGLError()`
(`rGL.cpp:36`) is the only `glGetError` caller in the tree and compiles to an
empty inline without `DEBUG` — verified against the artifact, the string
`glGetError` does not occur in `armagetronad.wasm` at all — so nothing else can
have an error stolen from it. The M2 sampler polls it every 30th frame from
inside the `glFlush`/`glFinish` hook it already installs; every frame would be
too expensive to do while also measuring the frame rate. Keep the `glHint`
control anyway: it is what will notice the day Firefox starts reporting these.

## 10. One glBegin/glEnd block, one vertex format

`src/render/rGLRender.cpp`, `src/tron/gWall.cpp`, `src/tron/gCycle.cpp`,
`src/tron/gSparks.cpp`. This is the largest single class of porting defect found
so far, it has two distinct shapes, and one of them is silent. Read this before
adding a `Begin*()` call site or moving a colour/texcoord near one.

### The rule

Real OpenGL lets a `glBegin`/`glEnd` block mix vertices freely. `glVertex`
captures whatever the current colour and texcoord state happens to be, so a
block may contain vertices that were preceded by a `glTexCoord` and vertices
that were not, and it may set a colour once for a whole run of vertices.

Emscripten cannot express that. `libglemu.js` appends every attribute call to
one flat `Float32Array` **in call order** and derives a *single* interleaved
layout for the entire block:

| call | slots written (4 bytes each) | component | size registered |
|---|---|---|---|
| `glVertex2f` / `glVertex3f` / `glVertex4f` / `glVertex3fv` | 4 | `VERTEX` | 16 B |
| `glTexCoord2f` / `glTexCoord2i` | 2 | `TEXTURE0` | 8 B |
| `glColor3f` / `glColor4f` (inside a block) | 1 (4 packed ubytes) | `COLOR` | 4 B |

`addRendererComponent` sums the sizes of the components it has seen into
`GLImmediate.stride`, and `glEnd` asserts:

```js
var numVertices = 4 * GLImmediate.vertexCounter / GLImmediate.stride;   // :3025
assert(numVertices % 1 == 0, '`numVertices` must be an integer.');      // :3028
```

> **Every vertex in a block must emit exactly the same attribute calls, in the
> same order.** A colour, if used at all, must be sent before *every* vertex —
> not once per triangle, not once per line, not once per loop iteration.

A `glColor*` issued while `GLImmediate.mode == -1` (no block open) is *state*
and costs no slots — that is the harmless form. Inside a block it becomes a
per-vertex attribute.

### Two failure modes, and only one of them is loud

1. **Non-integral → abort.** `Aborted(Assertion failed: `numVertices` must be an
   integer.)`, thrown from `glEnd`. This is the good case: `ASSERTIONS` is on
   precisely so it happens. **Do not "fix" it by adding `-O`** — that turns it
   into case 2 everywhere.
2. **Integral by accident → silent garbage.** If the slot count happens to
   divide by the stride, nothing complains, but the writer's and reader's
   per-vertex periods still differ, so from the second vertex on, attributes are
   read out of the wrong words. `gSparks.cpp` was doing exactly this.

### The two shapes

**(A) Cross-batch contamination.** `glRenderer::BeginPrimitive`
(`rGLRender.cpp:70`) makes a `Begin*()` a **no-op** when the same primitive is
already current — that is its batching optimisation. So a function that returns
without calling `RenderEnd()` leaves a live block that the *next* piece of code
silently joins, whatever format that code uses.

Note this is bounded: it needs an actual open block to reach the site. Many
things close one, so a colour merely appearing before a `Begin*()` is **not** by
itself a bug. `End(true)` is called by `ProjMatrix`, `ModelMatrix`, `TexMatrix`,
`PopMatrix`, `MultMatrix`, `IdentityMatrix`, `ScaleMatrix` and
`TranslateMatrix` — a matrix operation anywhere on the path makes the site safe.
Check reachability before reporting one of these.

### Reachability has TWO dimensions, and the compile-time one is easy to forget

Before calling any site live, latent or dangerous, check **both**:

1. **Compile-time.** Is the code in this build at all? Large parts of this tree
   sit behind `#ifdef`s that the wasm build never defines: `DEBUG`, `DEBUGLINE`
   (which is itself only defined inside `#ifdef DEBUG`, at `eDebugLine.cpp:29`),
   `XDEBUG`, `USE_HEADLIGHT`, `USE_PARTICLES`, `MACOSX`. `src/emscripten/config.h`
   defines only `AA_WEB_CLIENT`/`DEDICATED`, and `web/Makefile`'s `CLIENT_DEFS`
   and `BASE_CXXFLAGS` add no `-D` beyond `-DAA_WEB_CLIENT`. Code behind any of
   the others compiles to nothing and **cannot** be latent.
2. **Runtime.** Given that it compiles, can an open batch actually reach it, and
   can the guarding conditions be true?

Both of the entries this section originally listed as "keyboard-triggered latent
aborts" failed test 1, and it took two review rounds to notice, because the
`#ifdef` was tens of lines above the code and the runtime guard (`if
(debug_grid)`, a key binding) looked convincing on its own. Do not read a
guarding `if` and stop.

The cheap mechanical version of test 1, which is what should have been run the
first time:

```sh
em++ -std=gnu++14 -O2 -fexceptions -DAA_WEB_CLIENT -sUSE_SDL=1 -sUSE_LIBPNG=1 \
     -I src/emscripten -iquote src -iquote src/render -iquote src/engine \
     -iquote src/tron -iquote src/tools -iquote src/network -iquote src/ui \
     -E src/engine/eDisplay.cpp > /tmp/pp.i        # CHECK THE EXIT STATUS
grep -c debug_grid /tmp/pp.i                       # 0 -> the block is not in the build
```

Check `em++ -E`'s exit status explicitly — section 1 records that it can exit
non-zero while still emitting plausible-looking output, so "the token is absent"
only means something if the run succeeded. Preprocessing `eDisplay.cpp` and
`gGame.cpp` this way returns 0 hits for `debug_grid` in both; preprocessing
`eDebugLine.cpp` shows `eDebugLine::Render()` reduced to an empty body.

The only functions that currently leak an open block are:

- `gWallRim_helper` (`gWall.cpp:203`) — `BeginQuads()` + 4 `TexVertex`, no
  `RenderEnd`. This caused the M2 abort; see below.
- `gNetPlayerWall::RenderNormal` (`gWall.cpp:1173`) — leaves `GL_QUADS` open with
  a `{COLOR, TEXTURE0, VERTEX}` / 28-byte format. Safe *today* only because the
  code that can follow it is either another `RenderNormal` quad block with the
  identical format, or `RenderBegin`, whose `BeginLineStrip`/`BeginQuadStrip` are
  different primitives and so force a real `glEnd`. Fragile — do not add a
  differently-shaped `GL_QUADS` emitter after it.
- `rViewportConfiguration::DemonstrateViewport` (`rViewport.cpp:240`) — see the
  latent list.
- `rRenderer::Line` (`rRender.cpp:67`) — dead; `glRenderer::Line` overrides it
  and does call `End()`.

**(B) Intra-batch non-uniformity.** A block the code opened itself emits
attributes at a rate other than one per vertex. No inherited batch is involved,
so this fires wherever the code runs. This is the shape that is easy to miss by
grepping, because the colour is *inside* the `Begin`/`RenderEnd` pair and looks
perfectly reasonable.

### Fixed

- **`gWall.cpp` (shape A)** — `gWallRim::RenderReal` drew a rim wall's textured
  quad, returned with the block open, and the *next* wall's shadow quad appended
  a `Color(0,0,0)` plus four texcoord-less vertices to it. 24 slots + 1 + 16 =
  41 against stride 28 (`VERTEX 16 + TEXTURE0 8 + COLOR 4`) → `4*41/28 = 5.857`.
  Aborted ~8.6 s into every round. Fixed with `RenderEnd(true)` before the
  colour, so the colour becomes state and the shadow gets its own block.
- **`gCycle.cpp` (shape B)** — the chat/inactive/just-spawned pyramid set one
  colour per *triangle*: 2 × (1 + 3×4) = 26 slots against stride 20 →
  `4*26/20 = 5.2`. Fixed by repeating the colour before every vertex.
- **`gSparks.cpp` (shape B)** — one colour per *line segment*: 9 slots per
  iteration against a 5-slot stride. With `SPARKS == 10` that is 90/20 = 18, an
  integer, so it never asserted — it drew garbage. Fixed the same way.

### Still latent — one site, and it is reachable today

- **`rViewport.cpp:246`** (shape A+B) — `BeginLineLoop()`, four `glVertex2f`,
  then `glColor3f(1,1,1)` **with the block still open**, then `DisplayText()`
  whose `RenderEnd(true)` flushes it: 17 slots against stride 20 → `3.4`. Would
  abort.

  It compiles (`rViewportConfiguration::DemonstrateViewport`, called from
  `gMenus.cpp:805` and `:857`) and it is **reachable in the shipped build right
  now**, through the viewport-configuration screen in the settings menu. It does
  not depend on any keycode work: menu navigation switches on raw `SDLK_UP` /
  `SDLK_DOWN` / `SDLK_LEFT` / `SDLK_RIGHT` (`uMenu.cpp:419-448`), which the
  `KEYBOARD`-line remapping in `config/default.cfg` does not touch. This is a
  pre-existing hazard, not one a later task introduces.

  It was left unfixed only because nothing in M2 opens that screen, so a fix
  could not be verified by the browser harness. Whoever next touches the
  settings menus should fix it (a `RenderEnd(true)` before the `glColor3f`) and
  verify it by actually opening the screen.

### Compiled out of this build entirely — NOT latent

Both of these look like keyboard-triggered aborts and are not. They are listed
here so the next reader does not rediscover them and file them as live, which is
what happened twice during M2.

- **`eDisplay.cpp:586`** (shape B) — the `debug_grid` overlay sets one colour per
  *six* vertices in one loop and per two in another, which would indeed be
  ragged. But the whole `if (debug_grid)` block (`eDisplay.cpp:578-622`) is
  inside `#ifdef DEBUG`, **and so is the only key that can set the flag**
  (`case('d')`, `gGame.cpp:4255-4282`). `DEBUG` is defined nowhere in this build.
  Preprocessing either file with the client flags yields 0 hits for
  `debug_grid`.
- **`eDebugLine.cpp:105`** (shape B) — one colour per two vertices. `DEBUGLINE`
  is **not** defined: the `#define DEBUGLINE` at `eDebugLine.cpp:33` is itself
  inside `#ifdef DEBUG` (`eDebugLine.cpp:29-31`). `eDebugLine::Render()`
  preprocesses to an empty body.

If `DEBUG` is ever turned on — for a debugging build of the client — **both of
these become live aborts immediately**, and so does anything else behind
`XDEBUG`, `USE_HEADLIGHT` or `USE_PARTICLES` that has never been checked against
this rule. Re-run the sweep before trusting such a build.

### How to find these

Three steps, in this order. Each of them was skipped at least once during M2 and
each omission produced a wrong entry in this list.

**1. Grep for the raw forms too.** `glColor*`/`glTexCoord*`/`glVertex*` are
frequently called **raw**, not through `glRenderer::Color`/`TexCoord` —
`gCycle.cpp:4621`, `gWinZone.cpp:474`, `rViewport.cpp:246` and both cycle-wall
renderers all bypass the renderer. A sweep that greps only for `Color(` and
`TexCoord(` misses most of the codebase, and for the same reason a fix inside
`glRenderer::Color()` would not catch them.

**2. Compare counts per block, then read every hit.** For each `Begin*()` block,
compare the colour and texcoord counts against the vertex count; a block is
uniform only if each is either 0 or equal to the vertex count. Loops make
per-source-line counts misleading and `/* */` comments fool a line-comment
filter, so the count is a way to make a *miss* impossible, not a verdict —
read every hit.

`web/tools/sweep-immediate-mode.py` does the counting. It is the script that
produced the site lists above — the M2 task-5 working notes called it
`sweep.py` — and it is committed so that M5's obligation to re-run this sweep
before any `-O` reaches the link (`PLAN.md`, M5 inherited item 1) can actually
be discharged by whoever inherits it:

```sh
python3 web/tools/sweep-immediate-mode.py src
```

**Every line it currently prints is accounted for below, and that is what makes
running it useful: a hit that is not in this table is new.** As of this commit
it prints 19. Match them on the file and function, not on the line number,
which is the `Begin*()` and moves whenever anything above it does.

| hit | why it is not a new bug |
|---|---|
| `eDebugLine.cpp:101`, `eDisplay.cpp:586` | compiled out of this build entirely — see above |
| `rGLRender.cpp:163`–`:207` | the `Begin*()` wrapper definitions themselves. There is no block for them to close |
| `rRender.cpp:67` | dead `rRenderer::Line`; see the leak list above |
| `rViewport.cpp:240` | the one still-latent site; see above |
| `gCycle.cpp:4468` | **fixed.** The repeated colours are behind an `AA_PYRAMID_COLOR` macro that the regex does not match, so it still counts 3 colours against 6 vertices. A block this script calls ragged can be one a human already made uniform |
| `gHud.cpp:100`, `gWall.cpp:172` | blocks that sit inside `/* */` comments, which the line-comment filter does not catch |
| `gWall.cpp:203` | `gWallRim_helper`, the known leaker; see the leak list above |
| `gWall.cpp:1152`, `:1173`, `:1269` | the cycle-wall renderers, whose colour/vertex counts span two functions so the per-region count is meaningless. `:1173` is `RenderNormal`, the second known leaker |

**3. Check reachability in both dimensions before writing anything down** — the
`#ifdef` test first, because it is one command and it eliminates whole files,
then the open-batch/runtime-guard test. See "Reachability has TWO dimensions"
above. Reporting a dead site as live is not a harmless over-report: it sends
whoever reads this next after code that does not exist.

---

## 11. The camera never turns: `gluLookAt` is a no-op

`src/engine/eCamera.cpp`, `config/default.cfg`. **Nothing in this port fixes
either half of this section.** Both are recorded here because they are cheap to
rediscover expensively: the first makes every screenshot of this port misleading,
and the second makes a set of shipped bindings look broken for no visible reason.

### The no-op

`libglemu.js:3888` (grep `gluLookAt:`):

```js
gluLookAt: (ex, ey, ez, cx, cy, cz, ux, uy, uz) => {
  GLImmediate.matricesModified = true;
  GLImmediate.matrixVersion[GLImmediate.currentMatrix] = (... + 1)|0;
  GLImmediate.matrixLib.mat4.lookAt(GLImmediate.matrix[GLImmediate.currentMatrix],
                                    [ex, ey, ez], [cx, cy, cz], [ux, uy, uz]);
},
```

The bundled gl-matrix declares `mat4.lookAt = function (eye, center, up, dest)`
(`src/gl-matrix.js:1356`) — **destination last**. So this passes the current
matrix as `eye`, the real eye as `center`, the real centre as `up`, and writes
the sixteen-float result into the three-element array literal `[ux, uy, uz]`,
where it is discarded. **The current matrix is read and never written.**

Contrast `gluPerspective` eight lines above (`:3880`), which *does* assign its
result back into `GLImmediate.matrix[...]`. This is one buggy function, not a
design decision, and it is not something the app can work around by calling it
differently.

### What it costs this game

`eCamera::Render` (`eCamera.cpp:1415-1426`) sets the entire view orientation with
a single `gluLookAt` on the projection matrix, followed by
`glTranslatef(-pos.x, -pos.y, -z)`. With the rotation half inert, the view is
always straight down −Z from wherever the camera is: **a top-down view,
permanently, in every camera mode.**

That is a measurement, not an inference. Three independent signatures, all from
M2 gate frames:

- the floor grid shows **no perspective convergence** in any in-round frame —
  what looking perpendicular at a plane produces;
- a cycle's wall projects to a **one-pixel vertical line at x = 511** in a
  1024-wide canvas, i.e. exactly the screen centre, which is where a wall passing
  under the camera lands when you look straight down;
- the default camera is `CAMERA_CUSTOM` (`ePlayer.cpp:1169`), which sits
  `6 + 0.5·speed` ≈ 13.5 units *behind* the cycle at ≈ 10 up
  (`config/settings_visual.cfg:67-71`). Looking straight down from there puts the
  cycle just outside the frame — half the visible ground width is ~13.3 units.
  Moving the camera to 3 units back makes it appear.

Consequences to carry:

- **No screenshot of this port has ever shown a correct 3D view**, and none will
  until this is fixed. Do not write a gate that depends on one; the M2 gate
  deliberately does not.
- `CAMERA_IN` is not a workaround: `eCamera.cpp:1429-1433` removes the centred
  object from the render list when the camera is within 1 unit of it.
- The fix is small — implement `gluLookAt` correctly in `eCompat.cpp`, the way it
  already shims `glRectf` — but it is **new behaviour rather than a bug-for-bug
  port**, so it belongs to a task that owns it and can verify the result visually.

### The other half: `SDLK_LAST` moved, so the mouse-camera binds are dead

`config/default.cfg:31-35` binds `LOOK_LEFT`, `LOOK_RIGHT`, `BANK_UP`,
`BANK_DOWN` and `ZOOM_IN` to keycodes 324-336. Those are not SDL keysyms at all:
they are this program's own mouse pseudo-keys, `SDLK_MOUSE_X_PLUS` and friends,
defined in `uInput.h` as `SDLK_LAST+1 … SDLK_LAST+13`. **SDL 1.2's `SDLK_LAST`
was 323; in this build it is 1536** (measured, not assumed — see the comment on
`su_TranslateSDL12Keysym` in `uInput.cpp`), so the shipped literals point at
nothing.

This is the same defect as the arrow keys, which §Task 6 of M2 fixed by
re-encoding keysyms at config-parse time. It was deliberately **not** included in
that translation table: 324-336 → 1537-1549 is idempotent-safe (the ranges are
disjoint, same as the rest of the table), but enabling mouse camera control in a
browser needs pointer-lock behaviour verified first, and turning on bindings that
have never been exercised is not a thing to do blind.

Whoever fixes the camera should fix this at the same time — they are the same
feature from a player's point of view, and a correct `gluLookAt` with no way to
turn the camera is only half a result.
