# M1 — Client Boots to a Main Menu in a Browser

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Armagetron Advanced's real client, compiled to WebAssembly, loads in Chrome and Firefox and reaches a navigable main menu — rendering through WebGL, accepting keyboard and mouse input.

**Architecture:** The same hand-written `web/Makefile` grows a second target. `src/emscripten/config.h` gains a client variant selected by `-DAA_WEB_CLIENT` (absent = M0's dedicated build, byte-identical). Rendering goes through Emscripten's `-sLEGACY_GL_EMULATION=1`; windowing, input and audio through its SDL 1.2 emulation; the game's blocking loops survive via `-sASYNCIFY=1` with one yield point at the top of `rSysDep::SwapGL()`. Assets are baked into the page with `--preload-file`.

**Tech Stack:** Emscripten 6.0.8 (pinned), libxml2 2.12.10 (prebuilt), SDL 1.2 emulation, WebGL 1 via LEGACY_GL_EMULATION, Asyncify.

## Global Constraints

- Every change to an existing game source file must be `#ifdef __EMSCRIPTEN__`-guarded, with the original code preserved in the `#else` branch. Native builds must remain unaffected. **M0 needed zero such guards; M1 will need several — that is expected and is the milestone's nature.**
- New files ONLY under `src/emscripten/`, `web/`, `deps/`, `docs/`.
- **The M0 dedicated build must keep working, byte-identically.** Every task ends with `make -f web/Makefile dedicated` still producing a 2,488,298-byte wasm. If that number moves, something leaked into the shared path.
- `-fexceptions` is mandatory in every configuration, compile and link. Emscripten's default silently discards every `catch`; this codebase uses exceptions as control flow.
- Never define: `HAVE_LIBPTHREAD`, `HAVE_LIBZTHREAD`, `TOP_SOURCE_DIR`, platform macros, `USE_PARTICLES`, `USE_HEADLIGHT`, or `DEBUG`. Each of those turns dead code live, and `-DDEBUG` additionally defines `NOSOUND`, silently changing behaviour.
- The source set stays **exactly M0's 100 files**. Do not add `src/thirdparty/particles` (see Task 1) and do not remove `src/render/rConsoleCout.cpp` from `EXCLUDES`.
- This repository has NO automated test suite and none is to be created. Verification is command-output evidence and, from Task 6 on, what appears in a browser.
- Toolchain: `source deps/emsdk/emsdk_env.sh` from the worktree root. `deps/emsdk`, `deps/build` and `web/node_modules` are symlinks to the main checkout — do not reinstall them.
- Work happens in the worktree `.worktrees/m1-browser-client` on branch `m1-browser-client`. Commit after every green step.

## Known landmines — established by reconnaissance, do not rediscover

The full investigation is at `.superpowers/m1-recon.md` (git-ignored). It syntax-checked all 104 client translation units, so the compile-error list below is **fact, not prediction**.

> **Read that claim narrowly — one of these was false.** "Fact, not prediction" holds for the compile errors, because reconnaissance actually compiled them. The rest is very good reading of the emsdk sources, and #2 shows what reading can miss: it was wrong, it was trusted because of the sentence above, and unpicking it took most of Task 7. Entries M1 falsified now carry their correction inline; nothing is deleted, because the wrong version is what a reader may have already acted on.

1. **The Asyncify yield goes at the TOP of `SwapGL()`, not the end.** `rSysdep.cpp:626-639` returns early whenever `sr_glOut` is false — reachable via console auto-scroll, recorder frame-skip and fast-forward — bypassing everything after it including `sr_LimitFPS()`. Only a top-of-function yield is once-per-call for every caller.
2. **FALSE — corrected in Task 7; do not act on this entry.** ~~`sr_LimitFPS()` needs no patch. Under Asyncify, `SDL_Delay` is already aliased to `emscripten_sleep` (`libsdl.js:1712-1713`). It is also an unreliable yield: at the default `MAX_FPS 360` its delay branch is usually not taken.~~

   > **Correction.** The alias in `libsdl.js` is real, and it is **JS-side only**. `src/jsifier.mjs` resolves aliases without copying the target's `__async` decorator (grep `LibraryManager.isAlias`, then `asyncFuncs.push`), so `SDL_Delay` never enters `ASYNCIFY_IMPORTS` and Binaryen never instruments the wasm call site. The two halves then disagree: the JS side starts a real unwind, the wasm caller was never instrumented and returns normally, and `__stack_pointer` is restored from an asyncify slot nothing wrote. The client booted, drew exactly one frame, then stopped rendering and stopped seeing keystrokes — and usually died with `Attempt to set SP to 0xffffffb0`.
   >
   > **The rule that replaces this entry: never call `SDL_Delay` in the client. Only call sleeps that appear in `ASYNCIFY_IMPORTS`.** `sr_LimitFPS()` *did* need a patch — its `SDL_Delay` is now `emscripten_sleep` under `__EMSCRIPTEN__` — and with it `MAX_FPS` is live in the browser.
   >
   > The second sentence was beside the point rather than wrong: how often the delay branch is taken decides how often the bug fires, not whether it exists. That is also why the first bisection (flipping `MAX_FPS` 60 ↔ 0) pointed at yield *counting* instead of at the primitive.
   >
   > Full argument, the reduction that proved it, and the `-sASYNCIFY_IMPORTS=SDL_Delay` escape hatch: `docs/porting/browser-runtime-notes.md` § 8.
3. **`rConsoleCout.cpp` stays excluded, but for a NEW reason.** In a client build `DEDICATED` is undefined, so `rConsoleGraph.cpp:30`'s `#ifndef` takes the graphical branch and the `#include "rConsoleCout.cpp"` at `:274` never compiles. Adding the file would cause three duplicate-symbol errors (`DoCenterDisplay`, `DisplayAtNewline`, `sr_InputForScripts`). M0's `EXCLUDES` comment explains the dedicated-build reason and is now wrong for the client — update it.
4. **`src/thirdparty/particles` must NOT be built.** `USE_PARTICLES` is commented out (`gParticles.h:32`), so it is dead code. Native tolerates it only because it becomes a `.a` whose unreferenced members are dropped; passing the objects directly introduces `glCallList`, `glPushClientAttrib` and `glPopClientAttrib` as undefined symbols for zero benefit.
5. **`sr_LoadDefaultConfig()` sniffs the GPU vendor and turns on two dangerous features.** `rScreen.cpp:1010-1015`: if `glGetString(GL_VENDOR)` contains `NVIDIA`, it sets `sr_infinityPlane=true` and `sr_useDisplayLists=rDisplayList_CAC`. Under WebGL that string is browser-dependent (Chrome can report `Google Inc. (NVIDIA)`). It runs under `if (st_FirstUse)` — every page load until M4's persistence — and **after** config parsing, so `settings_web.cfg` cannot defend against it. *(That filename is dead — Task 6 Step 4's correction has the detail; the file shipped as `autoexec.cfg`. The point survives the rename: no `.cfg`, under any name, loads late enough to win.)*
6. **`GL_QUAD_STRIP` hard-aborts the runtime.** `libglemu.js:3062` aborts on primitive mode 8; `gWall.cpp:1242` uses it every frame in gameplay and it is not configurable (`gWall.cpp:1066` is `static const bool`). Not reachable from the menu, so it does not block M1 — but it is one line while `rGLRender.cpp` is open.
7. **A NULL mutex is passed every frame and that is fine.** `rSysDep::StartNetSyncThread()` returns unconditionally at `rSysdep.cpp:500`, so `sr_netLock` is never created and `SwapGL()` calls `SDL_mutexV(NULL)`/`SDL_mutexP(NULL)`. Emscripten's mutex functions are no-op stubs returning 0 (`libsdl.js:2602-2605`). No patch needed — noted because it looks alarming in a stack trace.
8. **`DIRTY` is undefined, which deletes a large GLX/wgl block** (`rSysdep.cpp:93-248`). This is good luck; do not "fix" the config in a way that defines it.
9. **The first `-sUSE_SDL=1 -sUSE_LIBPNG=1` link downloads and builds zlib and libpng ports from the network.** One-time, cached into the shared emsdk, but it is a network dependency M0 did not have.
10. **`gluLookAt` needs only a declaration** — the implementation exists at `libglemu.js:3888`. It fails to compile only because `rGL.h`'s `<GL/glu.h>` include sits inside a commented-out block (`rGL.h:14-35`).

---

### Task 1: Client build configuration

**Files:**
- Modify: `src/emscripten/config.h`
- Modify: `web/Makefile`

**Interfaces:**
- Produces: `make -f web/Makefile client` — a target that compiles the same 100 files with client flags. It is EXPECTED TO FAIL at this task with exactly six compile errors; Tasks 2 and 3 fix them.
- Produces: `AA_WEB_CLIENT` as the macro selecting the client variant of `config.h`. Absent ⇒ dedicated, so M0 is untouched.

- [ ] **Step 1: Make config.h serve both variants**

In `src/emscripten/config.h`, replace the unconditional `#define DEDICATED 1` with a variant switch. Keep every other macro exactly as it is:

```c
/* Two build variants share this file. The dedicated server (M0) is the
   default so that build is unaffected; the browser client (M1) is selected
   by -DAA_WEB_CLIENT on the compiler command line. */
#ifdef AA_WEB_CLIENT
/* Client: SDL for window/input/audio, libpng for screenshots, SDL_image for
   texture loading. DEDICATED must stay undefined — it is what selects the
   headless code paths throughout the tree. */
#  define HAVE_LIBSDL 1
#  define HAVE_SDL_SDL_IMAGE_H 1
#  define HAVE_LIBSDL_IMAGE 1
#  define HAVE_LIBPNG 1
#else
#  define DEDICATED 1
#endif
```

Do NOT define `HAVE_LIBSDL_MIXER`: `eSound.cpp:46-48` only defines it for WIN32, so the `<SDL_mixer.h>` include at `:52` is dead and must stay dead.

- [ ] **Step 2: Verify the dedicated build is untouched**

```bash
source deps/emsdk/emsdk_env.sh
make -f web/Makefile clean && make -f web/Makefile dedicated -j8
ls -l web/dist-m0/armagetronad-dedicated.wasm
```

Expected: exactly `2488298` bytes. Any other number means the variant switch leaked into the dedicated path — stop and fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/emscripten/config.h
git commit -m "build: let config.h serve both the dedicated and client variants"
```

- [ ] **Step 4: Add the client target to web/Makefile**

Add alongside the existing dedicated target. Note what is deliberately absent: no `-sENVIRONMENT=node`, no `-sNODERAWFS=1` (the browser has no real filesystem), and no `-sEXIT_RUNTIME=1` (`MainMenu()` at `gArmagetron.cpp:860` never returns, so the runtime must persist).

```makefile
# ---- M1: browser client -------------------------------------------------
# Same 100 source files as the dedicated build. Deliberately NOT adding
# src/thirdparty/particles: USE_PARTICLES is commented out at
# gParticles.h:32, so it is dead code, and linking its objects directly
# (native hides them in a .a) would add glCallList, glPushClientAttrib and
# glPopClientAttrib as undefined symbols for no benefit.
CLIENT_OBJDIR := web/build-m1
CLIENT_OBJS   := $(SRCS:src/%.cpp=$(CLIENT_OBJDIR)/%.o)
CLIENT_DEFS   := -DAA_WEB_CLIENT
# SDL and libpng are needed at COMPILE time for their headers, not just at link.
CLIENT_PORTS  := -sUSE_SDL=1 -sUSE_LIBPNG=1
# $(EXCEPTIONS) is required at COMPILE time as well as link — see the
# comment on its definition above; omitting it here silently discards catches.
CLIENT_CXXFLAGS := -std=gnu++14 -O2 -MMD -MP $(EXCEPTIONS) \
                   $(CLIENT_DEFS) $(CLIENT_PORTS) $(INCLUDES)

CLIENT_LDFLAGS := $(CLIENT_PORTS) -sLEGACY_GL_EMULATION=1 \
                  -sALLOW_MEMORY_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
                  $(EXCEPTIONS)

web/dist-m1/armagetronad.js: $(CLIENT_OBJS) $(LIBXML2)/lib/libxml2.a
	@mkdir -p web/dist-m1
	$(EMXX) $(CLIENT_OBJS) $(LIBXML2)/lib/libxml2.a $(CLIENT_LDFLAGS) -o $@

$(CLIENT_OBJDIR)/%.o: src/%.cpp web/Makefile
	@mkdir -p $(dir $@)
	$(EMXX) $(CLIENT_CXXFLAGS) -c $< -o $@

-include $(CLIENT_OBJS:.o=.d)

.PHONY: client
client: data web/dist-m1/armagetronad.js
```

Extend the `clean` target to remove `web/build-m1` and `web/dist-m1` as well.

- [ ] **Step 5: Update the rConsoleCout exclusion comment**

Its `EXCLUDES` comment explains the dedicated-build reason only. Both builds exclude it, for opposite reasons — say so:

```
# rConsoleCout.cpp — excluded from BOTH builds, for opposite reasons.
#   dedicated: rConsoleGraph.cpp:274 #includes it textually (the #else of
#              #ifndef DEDICATED), so compiling it too would duplicate it.
#   client:    that #else is dead, so the file contributes nothing — and
#              compiling it would collide with the graphical console
#              (DoCenterDisplay, DisplayAtNewline, sr_InputForScripts).
```

- [ ] **Step 6: Add web/build-m1 and web/dist-m1 to .gitignore**

```
web/build-m1
web/dist-m1
```

(No trailing slashes, matching the convention already established in that file.)

- [ ] **Step 7: Run the client compile and confirm the expected six failures**

```bash
# -k is essential: without it make stops dispatching after the first failure,
# so a parallel build surfaces only one error and hides the rest.
make -f web/Makefile client -j8 -k 2>&1 | grep -E "^src/.*error:" | sort -u
```

Expected: compilation stops with errors in exactly these files — `rTexture.cpp` (`gluBuild2DMipmaps`), `eCamera.cpp` (`gluLookAt`), `rScreen.cpp` (`SDL_GL_SWAP_CONTROL`), `gArmagetron.cpp` (`SDL_SetEventFilter`), `uInputQueue.cpp` (`SDL_Scancode`), `uMenu.cpp` (`SDLMod`). Record the actual output in your report.

If a file fails that is NOT on this list, that is new information — report it rather than fixing it silently.

- [ ] **Step 8: Commit**

```bash
git add web/Makefile .gitignore
git commit -m "build: add the M1 browser-client target"
```

---

### Task 2: The five small compile fixes

**Files:**
- Modify: `src/render/rGL.h`, `src/render/rScreen.cpp`, `src/tron/gArmagetron.cpp`, `src/ui/uInputQueue.cpp`, `src/ui/uMenu.cpp`

**Interfaces:**
- Consumes: Task 1's client target.
- Produces: 99 of 100 translation units compiling. Only `rTexture.cpp` still fails, which Task 3 owns.

Every change here is `#ifdef __EMSCRIPTEN__`-guarded with the original preserved. Commit each fix separately.

- [ ] **Step 1: Declare `gluLookAt`**

`eCamera.cpp:1415` calls it; the implementation exists in Emscripten (`libglemu.js:3888`). Only the declaration is missing, because `rGL.h`'s GLU include sits in a commented-out block (`rGL.h:14-35`).

**Corrected during execution:** emsdk *does* ship `GL/glu.h` (`cache/sysroot/include/GL/glu.h`), which declares `gluLookAt` at `:314`. Include the real header rather than hand-writing a declaration — a hand-written one risks a signature or linkage mismatch with the actual implementation, and the header also supplies `gluPerspective` and `gluOrtho2D`, which Emscripten likewise implements.

Add to `src/render/rGL.h` after the existing GL includes:

```c
#ifdef __EMSCRIPTEN__
// The <GL/glu.h> this file would normally include sits in the commented-out
// block above. Emscripten ships the header and implements gluLookAt,
// gluPerspective and gluOrtho2D (libglemu.js).
#include <GL/glu.h>
#endif
```

**Consequence for Task 3, deliberate:** that header also declares `gluBuild2DMipmaps` (`glu.h:296`), which Emscripten does NOT implement. So including it makes `rTexture.cpp` compile and moves its failure from compile time to link time. That is consistent with this plan's approach of treating the linker as the authority (Task 4), and Task 3's verification is written accordingly.

- [ ] **Step 2: Guard `SDL_GL_SWAP_CONTROL`**

`rScreen.cpp:410,414` use an SDL 1.2 attribute that emsdk's `SDL_GLattr` does not define. The block compiles because emsdk reports version 1.3.0 and the guard is `#if SDL_VERSION_ATLEAST(1,2,10)`. Wrap both uses:

```cpp
#ifndef __EMSCRIPTEN__
    // SDL_GL_SWAP_CONTROL does not exist in Emscripten's SDL_GLattr.
    // Behaviourally free here: the default vSync setting takes neither branch,
    // and the browser paces presentation itself.
    ... original lines 410 and 414 ...
#endif
```

- [ ] **Step 3: Fix `SDL_SetEventFilter`**

`gArmagetron.cpp:814` passes one argument (SDL 1.2); emsdk declares two (`SDL_events.h:589`) and does not implement it. Emscripten's equivalent is `emscripten_SDL_SetEventHandler` (`libsdl.js:2050`).

```cpp
#ifdef __EMSCRIPTEN__
    // Emscripten's SDL provides no SDL_SetEventFilter; this is its
    // equivalent, and it takes the userdata argument SDL 1.3 added.
    extern "C" void emscripten_SDL_SetEventHandler(int (*)(void *, SDL_Event *), void *);
    emscripten_SDL_SetEventHandler(&filter, NULL);
#else
    SDL_SetEventFilter(&filter);
#endif
```

Widen `filter`'s signature to match under the same guard. Check its current definition before editing and preserve its behaviour exactly.

- [ ] **Step 4: Fix the two enum-strictening errors**

SDL 1.3 made `scancode` and `mod` typed enums where 1.2 had integers.

`uInputQueue.cpp:206` assigns `0` to `key.keysym.scancode`; cast it. The same type also cascades into `tRecorder.h:1142` through `Archive(key.keysym.scancode)` at `:120` — archive through a `Uint32` temporary so the recorder's stream operators still work.

`uMenu.cpp:839` and `:1019` do `SDLMod mod = c.mod;` where `keysym.mod` stayed `Uint16`; add `static_cast<SDLMod>`.

- [ ] **Step 5: Verify all 100 now compile**

```bash
# -k is essential: without it make stops dispatching after the first failure,
# so a parallel build surfaces only one error and hides the rest.
make -f web/Makefile client -j8 -k 2>&1 | grep -E "^src/.*error:" | sort -u
```

Expected: **no compile errors at all.** Including `<GL/glu.h>` in Step 1 also satisfies `rTexture.cpp`'s reference to `gluBuild2DMipmaps`, so the build now proceeds to the link stage and fails there instead — on undefined symbols. That is expected and is Task 4's subject. Confirm the failure is a *link* failure by checking that `web/build-m1` contains 100 `.o` files:

```bash
find web/build-m1 -name '*.o' | wc -l   # expect 100
```

- [ ] **Step 6: Verify the dedicated build still produces 2,488,298 bytes**

```bash
make -f web/Makefile dedicated -j8 && ls -l web/dist-m0/armagetronad-dedicated.wasm
```

- [ ] **Step 7: Commit each fix separately**

```bash
git add -p
git commit -m "port: <the specific fix>"
```

---

### Task 3: Texture upload without GLU

**Files:**
- Modify: `src/render/rTexture.cpp`

**Interfaces:**
- Consumes: Task 2's compiling tree — all 100 translation units already compile after Task 2 included `<GL/glu.h>`.
- Produces: `gluBuild2DMipmaps` gone from the undefined-symbol list, and a texture upload path that is actually correct under WebGL. This is the only texture upload path in the game — there is no other `glTexImage2D` call anywhere in `src/` — so getting it wrong breaks every texture.

**Note on the failure mode:** because Task 2 included the real GLU header, `gluBuild2DMipmaps` is now *declared* but still not *implemented* by Emscripten. So this file compiles and the symbol shows up at link time. You are fixing a link error and a correctness problem, not a compile error.

- [ ] **Step 1: Check whether the shipped textures are power-of-two**

This decides whether the replacement needs a rescaler or an assert, and it is cheap to settle first:

```bash
cd textures && for f in *.png *.jpg; do
  python3 -c "
import struct,sys
p='$f'
d=open(p,'rb').read()
if d[:8]==b'\x89PNG\r\n\x1a\n':
    w,h=struct.unpack('>II',d[16:24])
else:
    import subprocess;sys.exit(0)
pot=lambda n:(n&(n-1))==0
print(('POT ' if pot(w) and pot(h) else 'NPOT'),w,h,p)"
done | sort | tee /tmp/m1-texture-sizes.txt
cd ..
```

Record the result in your report. If everything is POT, the replacement may assert rather than rescale — say so explicitly, because it becomes a documented assumption a later texture could violate.

- [ ] **Step 2: Replace the GLU call**

At `rTexture.cpp:518-519`, `gluBuild2DMipmaps` currently does three things `glTexImage2D` does not: it builds the mipmap chain, it silently rescales non-power-of-two sources, and it accepts sized internal formats. All three must be handled or textures render black.

Under `#ifdef __EMSCRIPTEN__`, with the original preserved in `#else`:

```cpp
    // WebGL1 requires internalformat == format from the UNSIZED set, so the
    // sized enums chosen above (GL_RGBA8/GL_RGB8/GL_RGBA4/GL_RGB5) collapse:
    GLenum internalFormat = ( format == GL_RGBA8 || format == GL_RGBA4 )
                            ? GL_RGBA : GL_RGB;
    glTexImage2D( GL_TEXTURE_2D, 0, internalFormat, tex->w, tex->h, 0,
                  texformat, GL_UNSIGNED_BYTE, tex->pixels );
    // The min filter defaults to GL_LINEAR_MIPMAP_LINEAR (rTexture.cpp:784,
    // applied at :569-570). A mipmapped texture with no mip chain is
    // incomplete in WebGL1 and samples as solid black.
    glGenerateMipmap( GL_TEXTURE_2D );
```

If Step 1 found NPOT textures, add rescaling before the upload — WebGL1 forbids NPOT with `GL_REPEAT` (set at `:498`/`:502`) and with mipmaps, so such a texture would be doubly illegal.

- [ ] **Step 3: Fix the external-format bug at `rTexture.cpp:261`**

`rSurface::Create` sets `format_ = GL_LUMINANCE8_ALPHA8` — a *sized internal* enum being passed as the `format` argument at `:519`. Desktop GLU tolerated it; WebGL rejects it with `GL_INVALID_ENUM`. Change it to `GL_LUMINANCE_ALPHA` under an `#ifdef __EMSCRIPTEN__` guard.

This branch is *probably* dead (Emscripten's `IMG_Load` returns 32-bit RGBA via the preload plugin, making `BytesPerPixel==4`), but it becomes live if the STB_IMAGE path is taken. One line; take it.

- [ ] **Step 4: Remove the `IMG_InvertAlpha` call**

`rTexture.cpp:223`. Emscripten declares it in `SDL/SDL_image.h` but implements it nowhere — a link error, not a compile error. In SDL_image 1.2 it was already a deprecated no-op, so removing it is expected to be behaviourally free. Guard it, and note in your report that if that assumption is wrong every texture renders with inverted alpha — which is obvious on sight and instantly diagnosable.

- [ ] **Step 5: Verify the symbol is gone**

All 100 files already compiled before you started, so the check is on the link stage:

```bash
make -f web/Makefile client -j8 -k 2>&1 | tee /tmp/m1-t3-link.log
grep -c "gluBuild2DMipmaps" /tmp/m1-t3-link.log   # expect 0
grep -oE "undefined symbol: [A-Za-z_0-9]+" /tmp/m1-t3-link.log | sort -u
```

Expected: `gluBuild2DMipmaps` no longer appears anywhere. The link still fails on other undefined symbols — that is Task 4's subject, and the list you just printed is useful input to it. Record it in your report.

- [ ] **Step 6: Verify the dedicated build is still 2,488,298 bytes, then commit**

```bash
git add src/render/rTexture.cpp
git commit -m "port: upload textures without GLU"
```

---

### Task 4: First link, and the compatibility shims

**Files:**
- Create: `src/emscripten/eCompat.cpp`
- Modify: `web/Makefile` (add the new file to the client source list)

**Interfaces:**
- Consumes: Task 3's fully-compiling tree.
- Produces: a linking client — `web/dist-m1/armagetronad.{js,wasm}`.

**The linker is the authority here.** Reconnaissance verified symbols individually and explicitly warns that an automated diff produced false positives. Do not write shims from the list below alone; get the real list first.

- [ ] **Step 1: Attempt the link and capture the authoritative undefined-symbol list**

```bash
make -f web/Makefile client -j8 2>&1 | tee /tmp/m1-link.log
grep -oE "undefined symbol: [A-Za-z_0-9]+" /tmp/m1-link.log | sort -u | tee /tmp/m1-undefined.txt
```

This is expected to fail. `-sERROR_ON_UNDEFINED_SYMBOLS=1` is what makes the failure a complete, trustworthy list rather than a runtime surprise. Put that list in your report verbatim — it is the most valuable artifact of this task.

- [ ] **Step 2: Write the shims**

Create `src/emscripten/eCompat.cpp`. Implement exactly what Step 1 reported — no more. Reconnaissance predicts these, grouped by why they exist:

```cpp
// Compatibility shims for the browser build. Everything here exists because
// Emscripten's SDL 1.2 emulation or its GL emulation omits a symbol this
// codebase calls. Nothing here implements game behaviour.
#ifdef __EMSCRIPTEN__
#include <GL/gl.h>
#include <SDL/SDL.h>

extern "C" {

// --- GL entry points absent from Emscripten, ON the boot-to-menu path ---

// uMenu.cpp:557 (menu dim overlay), rConsoleGraph.cpp:208, rViewport.cpp:237,
// gMenus.cpp:913. Immediate-mode rectangle; LEGACY_GL_EMULATION handles QUADS.
void glRectf( GLfloat x1, GLfloat y1, GLfloat x2, GLfloat y2 )
{
    glBegin( GL_QUADS );
    glVertex2f( x1, y1 ); glVertex2f( x2, y1 );
    glVertex2f( x2, y2 ); glVertex2f( x1, y2 );
    glEnd();
}

// gFloor.cpp:206-215 — the menu background quad, every menu frame.
void glTexCoord2d( GLdouble s, GLdouble t ) { glTexCoord2f( (GLfloat)s, (GLfloat)t ); }

// rModel.cpp:305 — not on the menu path, but must link.
void glTexCoord3fv( const GLfloat * v ) { glTexCoord3f( v[0], v[1], v[2] ); }

// --- Display lists: OFF by default and patched out in Task 5, but the
// --- call sites in rDisplayList.cpp must still link.
GLuint glGenLists( GLsizei ) { return 0; }
void   glNewList( GLuint, GLenum ) {}
void   glEndList( void ) {}
void   glCallList( GLuint ) {}
void   glDeleteLists( GLuint, GLsizei ) {}

// --- SDL audio: se_SoundInit() runs via RAII at gArmagetron.cpp:824, before
// --- the display is even initialised, and sound_quality defaults to
// --- SOUND_MED (eSound.cpp:78). So these link even though M1 ships silent;
// --- M3 replaces them with a real Web Audio implementation.
SDL_AudioSpec * SDL_LoadWAV_RW( SDL_RWops *, int, SDL_AudioSpec *,
                                Uint8 **, Uint32 * ) { return NULL; }
void SDL_FreeWAV( Uint8 * ) {}
int  SDL_BuildAudioCVT( SDL_AudioCVT *, Uint16, Uint8, int,
                        Uint16, Uint8, int ) { return -1; }
int  SDL_ConvertAudio( SDL_AudioCVT * ) { return -1; }

} // extern "C"
#endif
```

Anything in Step 1's list that is not above is new information: implement it, and call it out in your report.

- [ ] **Step 3: Add eCompat.cpp to the client build**

It lives outside `src/`, so it is not swept up by the wildcards. Add it to the client objects explicitly in `web/Makefile`, with a rule that compiles it from `src/emscripten/`.

- [ ] **Step 4: Link**

```bash
make -f web/Makefile client -j8 && ls -lh web/dist-m1/
```

Expected: `armagetronad.js` and `armagetronad.wasm` exist. Note the wasm size in your report; M0's dedicated build is 2,488,298 bytes for comparison.

Note that this link is the first `-sUSE_SDL=1 -sUSE_LIBPNG=1` build, so Emscripten will download and build zlib and libpng ports from the network. One-time, cached into the shared emsdk.

- [ ] **Step 5: Verify the dedicated build still produces 2,488,298 bytes, then commit**

```bash
git add src/emscripten/eCompat.cpp web/Makefile
git commit -m "port: add browser compatibility shims and link the client"
```

---

### Task 5: Survive the browser — Asyncify and the runtime traps

**Files:**
- Modify: `src/render/rSysdep.cpp`, `src/tools/tSysTime.cpp`, `src/render/rScreen.cpp`, `src/render/rGLRender.cpp`
- Modify: `web/Makefile` (Asyncify link flags)

**Interfaces:**
- Consumes: Task 4's linking client.
- Produces: a client that yields to the browser instead of freezing the tab, with the two vendor-sniffing and primitive-mode traps disarmed.

- [ ] **Step 1: Add the yield point at the TOP of `SwapGL()`**

`rSysdep.cpp`, at the very start of `rSysDep::SwapGL()` (before line 568) — NOT at the end:

```cpp
#ifdef __EMSCRIPTEN__
    // THE browser yield point. It must be here, at the top: the early return
    // at :626-639 when sr_glOut is false bypasses everything below it,
    // including sr_LimitFPS(). Every blocking loop in the game reaches
    // SwapGL() once per iteration (uMenu::Enter at uMenu.cpp:390 calls it
    // unconditionally), so a top-of-function yield is the only placement
    // that is provably once-per-iteration for every caller.
    emscripten_sleep( 0 );
#endif
```

Add `#include <emscripten.h>` under the same guard.

~~Do NOT patch `sr_LimitFPS()`: under Asyncify `SDL_Delay` is already `emscripten_sleep` (`libsdl.js:1712-1713`), and its delay branch usually is not taken at `MAX_FPS 360` anyway.~~

> **Correction (Task 7). Ignore that instruction — `sr_LimitFPS()` does need the patch.** It repeats landmine #2, which is false: the `SDL_Delay` → `emscripten_sleep` alias is JS-side only and never reaches `ASYNCIFY_IMPORTS`, so Binaryen leaves the call site uninstrumented and the unwind corrupts the stack pointer. `sr_LimitFPS()`'s `SDL_Delay` is now `emscripten_sleep` under `__EMSCRIPTEN__`, `SDL_Delay` kept for native, and `MAX_FPS` works in the browser. Two Asyncify yields per `SwapGL()` — this one and the top-of-function one above — were measured to be fine; yield *count* was never the problem. `docs/porting/browser-runtime-notes.md` § 8.

- [ ] **Step 2: Make `tDelay` and `tDelayForce` yield**

`tSysTime.cpp`. Both call libc `usleep` directly — `tDelay` at `:293`, `tDelayForce` at `:302` — and Emscripten's `usleep` busy-waits on the main thread without yielding. `tDelay` is the main-menu loop's own sleep (`uMenu.cpp:386`).

Patch the `usleep(...)` call inside each, leaving the surrounding logic alone. This placement is deliberate and load-bearing for the recorder: `tDelay` checks `tRecorder::IsPlayingBack()` first, and `tDelayForce` checks `s_delayedInPlayback` first and then rewinds `timeStart` — that rewind is how recordings stay deterministic across machines of different speeds. Patching libc `usleep` globally, or hoisting the sleep above those guards, would break demo playback.

```cpp
#ifdef __EMSCRIPTEN__
    emscripten_sleep( usecdelay / 1000 );
#else
    usleep( usecdelay );
#endif
```

- [ ] **Step 3: Disarm the GPU-vendor branch**

`rScreen.cpp:1010-1015` turns on `INFINITY_PLANE` and `USE_DISPLAYLISTS` when `glGetString(GL_VENDOR)` contains `NVIDIA`. Under WebGL that string is browser-dependent, this runs on every page load until M4's persistence lands, and it runs *after* config parsing so `settings_web.cfg` cannot override it *(dead filename — see Step 4 of Task 6; shipped as `autoexec.cfg`, and no config file of any name loads late enough)*. `INFINITY_PLANE` makes `glTexCoord4f` live (`libglemu.js:3218` aborts); display lists would call the Task 4 stubs, which return 0 and silently render nothing.

Guard the whole `else if(strstr(gl_vendor,"NVIDIA"))` branch out with `#ifndef __EMSCRIPTEN__`, with a comment explaining that WebGL vendor strings are not GPU-driver vendor strings.

- [ ] **Step 4: Make `GL_QUAD_STRIP` survive**

`rGLRender.cpp:161-163`, `BeginQuadStrip()`. `libglemu.js:3062` aborts the entire runtime on primitive mode 8, and `gWall.cpp:1242` uses it every frame in gameplay via a `static const bool` that cannot be configured. Not reachable from the main menu, so M1 could ship without it — but the file is already open and quad-strip and triangle-strip have identical vertex ordering:

```cpp
#ifdef __EMSCRIPTEN__
    // libglemu.js:3062 aborts on GL_QUAD_STRIP. Vertex ordering is identical
    // for GL_TRIANGLE_STRIP, so this is a faithful substitution — and it is
    // what keeps gameplay (gWall.cpp:1242) from killing the runtime in M2.
    glBegin( GL_TRIANGLE_STRIP );
#else
    glBegin( GL_QUAD_STRIP );
#endif
```

- [ ] **Step 5: Turn on Asyncify**

In `web/Makefile`, add to `CLIENT_LDFLAGS`:

```
-sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072
```

- [ ] **Step 6: Link and record the size cost**

```bash
make -f web/Makefile client -j8 && ls -l web/dist-m1/armagetronad.wasm
```

Report the size before and after Asyncify — the instrumentation is expected to be substantial and M5 will want the number.

- [ ] **Step 7: Verify the dedicated build is still 2,488,298 bytes, then commit each patch separately**

---

### Task 6: Assets and the page

**Files:**
- Create: `web/shell.html`, ~~`web/webdefaults/settings_web.cfg`~~ → **`web/webdefaults/autoexec.cfg`** (see Step 4's correction)
- Modify: `web/Makefile` (preload flags, shell file)

**Interfaces:**
- Consumes: Task 5's Asyncify client.
- Produces: `web/dist-m1/armagetronad.html` — a page that loads the game.

- [ ] **Step 1: Add the preload flags, excluding what is never read at runtime**

The full asset tree is 1.9 MB, but ~970 KB of it is never read by any milestone. Excluding it roughly halves the payload for zero functional cost:

| Excluded | Size | Why |
|---|---|---|
| `textures/*.xcf` | 165 KB | GIMP sources, not runtime assets |
| `language/{deutsch,polish,polish_transliterated,spanish,french,portugese}.txt` | 803 KB | The Demo is English-only |
| `language/update.py` | 9 KB | Build-time script |
| `config/settings_dedicated.cfg` | 26 KB | Server-only |

Add to `CLIENT_LDFLAGS`:

```
--use-preload-plugins \
--preload-file config@/data/config \
--preload-file language@/data/language \
--preload-file textures@/data/textures \
--preload-file models@/data/models \
--preload-file sound@/data/sound \
--preload-file resource/included@/data/resource/included \
--exclude-file '*.xcf' --exclude-file 'update.py' \
--exclude-file 'settings_dedicated.cfg' \
--exclude-file 'deutsch.txt' --exclude-file 'polish.txt' \
--exclude-file 'polish_transliterated.txt' --exclude-file 'spanish.txt' \
--exclude-file 'french.txt' --exclude-file 'portugese.txt' \
--shell-file web/shell.html
```

Verify the exclusions actually took effect by checking the generated `.data` file's size, and report it.

- [ ] **Step 2: Point the game at the preloaded paths**

The game already supports this at runtime — no path patches needed, exactly as M0 relied on. In `web/shell.html`:

```js
Module.arguments = ['--datadir','/data','--userdatadir','/persist',
                    '--userconfigdir','/data/webdefaults'];
```

`/persist` will become an IDBFS mount in M4; for M1 it is an ordinary in-memory directory and settings simply do not survive reload.

- [ ] **Step 3: Write `web/shell.html`**

A minimal page: a canvas, a loading indicator, and a start button. The button matters for M3 — browsers require a user gesture before audio can start — and costs nothing now.

```html
<!-- Shell page for the wasm client. Emscripten wraps this: it injects the
     generated armagetronad.js, which looks for `Module` on the way up. -->
<style>
  body { margin:0; background:#111; color:#eee;
         font:14px/1.4 system-ui, sans-serif; }
  #canvas { display:block; margin:0 auto; background:#000; }
  #overlay { position:fixed; inset:0; display:grid; place-content:center;
             gap:1rem; text-align:center; background:#111; }
  #start[disabled] { opacity:.5; }
</style>

<div id="overlay">
  <h1>Armagetron Advanced</h1>
  <p id="status">Loading…</p>
  <button id="start" disabled>Play</button>
</div>
<canvas id="canvas" tabindex="-1" oncontextmenu="event.preventDefault()"></canvas>

<script>
  const statusEl = document.getElementById('status');
  const startEl  = document.getElementById('start');

  var Module = {
    canvas: document.getElementById('canvas'),
    // The game reads its data from the preloaded /data tree and writes user
    // config to /persist. Both are runtime switches the game already has —
    // no path patches needed. /persist becomes an IDBFS mount in M4; until
    // then it is in-memory, so settings do not survive a reload.
    arguments: ['--datadir','/data','--userdatadir','/persist',
                '--userconfigdir','/data/webdefaults'],
    // callMain is invoked from the button, not automatically.
    noInitialRun: true,
    setStatus: (text) => { statusEl.textContent = text || 'Ready'; },
    print:    (text) => console.log(text),
    printErr: (text) => console.error(text),
    onRuntimeInitialized: () => {
      statusEl.textContent = 'Ready';
      startEl.disabled = false;
    }
  };

  startEl.addEventListener('click', () => {
    document.getElementById('overlay').remove();
    Module.canvas.focus();          // so the menu receives key events
    Module.callMain(Module.arguments);
  });
</script>
```

Keep it plain and commented — its reader is a JavaScript developer, which is the one part of this stack that is home turf.

- [ ] **Step 4: Write ~~`web/webdefaults/settings_web.cfg`~~ `web/webdefaults/autoexec.cfg`**

```
MAX_FPS 60
INFINITY_PLANE 0
USE_DISPLAYLISTS 0
SOUND_BUFFER_SHIFT 3
```

Note the setting is `USE_DISPLAYLISTS` (`rModel.cpp:45`). This file is defence in depth only — Task 5 patched out the code that would override it, because `sr_LoadDefaultConfig()` runs after config parsing.

> **Correction (Task 6). The filename in this step is dead — `settings_web.cfg` is opened by no code path in the tree.** `st_LoadConfig()` (`tConfiguration.cpp:959-1000`) opens a fixed handful of names, and that is not one of them, so every setting above would have been silently ignored. The file shipped as `autoexec.cfg`, which `st_LoadConfig()` opens unconditionally in both build variants, with no first-use gate, and which loads *after* `user.cfg` and `settings.cfg` so its values win. Two consequences carried into `PLAN.md`'s M2 entry and into the file's own header comment: `/data/webdefaults` **replaces rather than merges** (never drop a `settings.cfg` or `keys_*.cfg` there — it would shadow the shipped one whole), and these are hard overrides a user cannot change back, which is right for `USE_DISPLAYLISTS`/`INFINITY_PLANE` and worth re-thinking for `MAX_FPS` once M4 persists settings. `default.cfg` was considered and rejected: it is gated on `st_FirstUse` and would also shadow the shipped `config/default.cfg` entirely.
>
> The same dead filename appears in landmine #5 and in Task 5 Step 3, where it is used only to make the point that no `.cfg` can defend against `sr_LoadDefaultConfig()`. That point survives the rename — no config file, whatever its name, loads late enough.

- [ ] **Step 5: Build and confirm the page exists**

```bash
make -f web/Makefile client -j8
ls -lh web/dist-m1/
```

Expected: `armagetronad.html`, `.js`, `.wasm`, `.data`.

- [ ] **Step 6: Commit**

---

### Task 7: Boot to the main menu

**Files:**
- Modify: whatever the browser proves necessary, guarded as always

**Interfaces:**
- Consumes: Task 6's page.
- Produces: THE MILESTONE — a navigable main menu in Chrome and Firefox.

- [ ] **Step 1: Serve the page and open it**

```bash
python3 -m http.server 8000 --directory web/dist-m1
```

Then open `http://localhost:8000/armagetronad.html`. (A plain `file://` open will not work: `.wasm` and `.data` are fetched over XHR.)

- [ ] **Step 2: Capture what actually happens**

Record, from the browser devtools console: every error and warning, how far the boot got, and whether anything renders. ~~If the tab hangs, the first thing to check is the `SDL_GetAppState` loops at `rScreen.cpp:811-815` and `:823-827` — they are not routed through `SwapGL()` or `tDelay()` and depend on `SDL_Delay` being Asyncify-aliased.~~

> **Correction (done in Task 7).** The right instinct, the wrong reason: those two loops are dangerous *because* `SDL_Delay` cannot be depended on at all. The alias is JS-side only, never reaches `ASYNCIFY_IMPORTS`, and its call site is never instrumented — see landmine #2's correction and `docs/porting/browser-runtime-notes.md` § 8. Both loops are now compiled out under `__EMSCRIPTEN__`; there is no ALT-Tab in a browser. They never actually spun, and only by luck: Emscripten's `SDL_GetAppState` ORs in `SDL_APPACTIVE` unconditionally, so the condition was never true. `llvm-nm` over every client object confirmed these two were the whole client's only undefined `SDL_Delay`.

- [ ] **Step 3: Log what the browser reports as its GPU vendor**

`rScreen.cpp:763-765` prints `renderer_identification`. Report the exact strings for Chrome and Firefox. This settles an open question from reconnaissance: whether the vendor-sniffing branch Task 5 disarmed was a latent bug or an active one.

- [ ] **Step 4: Fix what the browser finds**

Same discipline as always: config problems in `config.h`, build problems in `web/Makefile`, genuine portability problems as guarded source patches with the original preserved. Commit each fix separately with a descriptive message — this history is the port's documentation of what a browser demanded.

Escalate rather than improvise if a fix would require restructuring code the plan did not anticipate.

- [ ] **Step 5: Verify the gate in both browsers**

The menu must appear and be navigable with the arrow keys and Enter in **Chrome and Firefox**. ~~Navigate into a submenu and back out.~~ Screenshot both.

> **Correction (Task 7). The submenu criterion is not achievable at M1, and it is not a shortfall — there is no submenu on the path this milestone reaches.** Both menus reachable before gameplay were enumerated from the source and neither contains a `uMenuItemSubmenu` (`uMenu.h:468`): the language menu (`gLanguageMenu.cpp:125-141`) holds only `uMenuItemLanguage`, and First Setup (`gArmagetron.cpp:152-226`) holds `uMenuItemExit`, `uMenuItemString` and three `uMenuItemSelection`. "Controls:" looks like a submenu and is not — it is a left/right chooser over `keys_*.cfg` templates (`gArmagetron.cpp:175`). The real main menu, where the submenus live (`gMenus.cpp`), is only reached after `welcome()` runs a tutorial single-player game (`gArmagetron.cpp:391`), because `st_FirstUse` is true on every load until M4 adds persistence — so reaching it means playing, which is M2's gate, not M1's.
>
> **What was demonstrated instead**, in both browsers, ten screenshots each, committed at `docs/evidence/m1-task7/`: every menu input path M1 can reach — Down, Up, Left/Right, Enter and Escape — each with a before/after pair, plus Enter leaving one menu for another and Escape leaving First Setup entirely. That covers the same underlying capability the submenu round trip was standing in for: input reaches the game, the game re-renders, and menu state changes both ways.
>
> Recorded for whoever revisits this: `st_FirstUse` is exposed as the config item `FIRST_USE` (`tConfiguration.cpp:402`), so `FIRST_USE 0` would boot straight to the main menu. That changes what every real user sees on first load, so it is a product decision, not a test fix.
>
> The re-runnable script and the full reasoning are in `web/tools/menu-gate.steps`.

Note for later, not for now: `config/keys_cursor.cfg` binds SDL 1.2 numeric keycodes (274/275/276) while Emscripten emits 1105/1103/1104, so default arrow-key *steering* bindings will silently not fire in gameplay. Menu navigation uses `SDLK_*` constants and is unaffected. This is an M2 problem — record it, do not fix it here.

- [ ] **Step 6: Commit**

---

### Task 8: M1 exit

**Files:**
- Modify: `web/README.md`, `README.md`
- Create: ~~`docs/m1/`~~ **`docs/evidence/m1-task7/`** — evidence

> **Correction (Task 8).** Steps 1 and 2 were overtaken by events. Task 7 committed the evidence as it captured it, under `docs/evidence/m1-task7/` rather than `docs/m1/` — 20 screenshots and 2 console transcripts, from a run of `web/tools/menu-gate.steps` in each browser. That evidence is the milestone gate, so Task 8 did **not** re-run Step 1's clean rebuild: a rebuild that produced different screenshots would replace the gate with an unreviewed one, and one that produced identical screenshots would prove nothing the committed set does not. Task 8 was executed as documentation only, no rebuild and no relink, and re-verified the dedicated wasm by measuring the existing artifact (2,488,298 bytes). Every command written into the docs was executed first.

- [ ] **Step 1: Verify the gate from a clean rebuild** — *not run; see the correction above*

```bash
make -f web/Makefile clean
make -f web/Makefile client -j8
make -f web/Makefile dedicated -j8
ls -l web/dist-m0/armagetronad-dedicated.wasm   # must still be 2488298
```

Then re-serve and re-confirm the menu in both browsers.

- [ ] **Step 2: Commit durable evidence** — *done in Task 7, at `docs/evidence/m1-task7/`*

Screenshots of the menu in Chrome and Firefox into `docs/m1/`, plus the devtools console output as a text file. M0 established that the reports live in a git-ignored workspace, so evidence that is not committed does not exist.

- [ ] **Step 3: Document building and running the client**

Extend `web/README.md`'s Quickstart with the client target and the local-server step, and note the network dependency on first link (zlib and libpng ports). Update the root `README.md` status.

Be as scrupulous about scope as M0's status is: a main menu is not a playable game, and M2 is what makes it one.

- [ ] **Step 4: Commit, then STOP**

Do not merge or open a PR. The controller runs a whole-branch review first, then the integration decision goes to the user.
