# Browser runtime notes

Long-form reasoning behind the M1 changes that make the client survive a
browser. The source files carry short pointers here rather than the whole
argument; this is the file to read before undoing one of them.

Scope: the Asyncify yield, the two `usleep` replacements, the rule about which
sleep primitives are safe at all (§8 — read that one before adding any sleep),
and the three GL traps. Each section is named so a comment can cite it.

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

The mechanical check, rather than eyeballing `#endif`s:

```bash
awk '/^[ \t]*#[ \t]*(if|ifdef|ifndef)/ {d++; s[d]=NR"|"$0; next}
     /^[ \t]*#[ \t]*endif/ {d--; next}
     NR==822 {for(i=1;i<=d;i++) print "depth "i": "s[i]}' src/render/rScreen.cpp
```

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

### What this costs, and what to watch for

The frame rate is capped again, at `MAX_FPS` (60 in `web/webdefaults/autoexec.cfg`).
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
