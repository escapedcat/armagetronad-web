# Defect B — the HUD flicker. Reproduced, mechanism identified, control build agrees.

**One in five composited frames shows the world with the HUD not yet drawn.**
The cause is not `glBegin`/`glEnd` and not a GL error. It is
`rSysDep::SwapGL()`'s browser yield: it sits **above**
`rPerFrameTask::DoPerFrameTasks()`, which is where the HUD, the FPS counter and
the graphical console are drawn. So every frame hands the browser a compositing
opportunity at a moment when the world is in the drawing buffer and the overlay
layer is not.

## The mechanism, read off the source

`src/render/rSysdep.cpp`, `rSysDep::SwapGL()`, in order:

    emscripten_sleep( 0 );                 <-- the yield. Buffer = world, NO overlay.
    ... playback/timing, the !sr_glOut early return ...
    rPerFrameTask::DoPerFrameTasks();      <-- the overlay is drawn HERE
    glFlush()/glFinish(); SDL_GL_SwapBuffers();

The overlay layer is entirely `rPerFrameTask`s and nothing else is:

| task | registered in | what it draws |
|---|---|---|
| `display_hud_subby_all` | `gHud.cpp` | Scores, Rubber/Speed/Brakes meters, Fastest, Enemies/Friends/Ping, **and `display_fps_subby`'s "FPS: n"** |
| `sr_ConsolePerFrame` | `rConsoleGraph.cpp` | the graphical console |
| `scores` | `ePlayer.cpp` | the score display |

That table is the match to the report. The maintainer said *"a flicker of the
menu bar during the game. like all displayed information also the fps etc."* —
**everything that flickers is an `rPerFrameTask`, and everything that does not
is drawn before `SwapGL()` is ever called.** The world geometry never flickers
because it is already in the buffer when the yield happens.

Why it is intermittent: `emscripten_sleep(0)` is `setTimeout`, clamped to ~4 ms
once timeouts nest (browser-runtime-notes § 2), so roughly 4 ms of every 16.7 ms
frame is spent inside the yield with the overlay missing, and the compositor's
60 Hz phase drifts against a `setTimeout`-paced loop. Some seconds it lands in
the window repeatedly; some seconds it never does. *"Seems random to me.
Sometimes it's stable."*

## Why every earlier probe missed it, including three of mine

**A sampler that runs at the game's swap cannot see this, by construction.** The
overlay is drawn *before* the swap, so at swap time the frame is always complete.
`negative-swap-time-only/` is that measurement, and it is a clean negative:

    2307 frames, native resolution over the HUD strip (1024x108 at y=660)
    one-frame HUD dropouts: 0
    blip (one-frame outlier vs both neighbours) max 4.45 against a
      normal frame-to-frame change of 18.9 -- i.e. no outlier at all
    glGetError: 0

The same run measured the FPS box (140x40 at 840,44) and its bright-pixel count
never left 114-116 in 2307 consecutive frames. Per-frame draw-call accounting
bucketed by bound texture found no batch ever skipped for a frame either.
**All of that is true and none of it is about what the user sees.** The right
instrument is `requestAnimationFrame`, which runs on the compositor's clock.

## The measurement

`probes/kprobe.steps` — Chrome, local server, fresh profile, into round 2 so the
HUD is up, then 40 s of play with ten turns. A light rAF sampler counts bright
pixels in the HUD strip (y 700..768) and in a world reference box (the arena
ceiling at 380,130). "HUD gone" = HUD ink at or below 15% of its own running
median **while the world reference is up**, so a legitimate HUD-off stretch
(round transition, dead player) is separable from a blink by its length.

The probe does not perturb: game 60 fps, rAF 60 Hz, in both runs.

| | **baseline (shipped `armagetronad.html`)** | **control (`armagetronad-yieldfix.html`)** |
|---|---|---|
| seconds / rAF ticks / game swaps | 40.5 / 2431 / 2429 | 40.5 / 2429 / 2427 |
| game fps, rAF Hz | 60, 60 | 60, 60 |
| composited ticks with the world up | 1751 | 1838 |
| HUD median (bright px) | 857 | 883 |
| **ticks with the HUD gone** | **362 (20.7%)** | 271 (14.7%) |
| **separate gone-runs** | **38** | **3** |
| **median gone-run length** | **2 ticks (~33 ms)** | 90 ticks (~1.5 s) |
| longest gone-run | 94 ticks | 91 ticks |
| frames the live detector captured | **3** | **0** |

Read the two run-shape rows, not the percentage. Both builds have a handful of
**long** HUD-off stretches — 90-odd ticks, ~1.5 s — and those are legitimate:
the HUD is genuinely not drawn between rounds and while the local player is
dead. The baseline has **38** gone-runs and a median length of **2 ticks**; the
control has **3**, all long. So the baseline carries ~35 extra dropouts of
about 33 ms each in 40 seconds — **a blink slightly under once per second** —
and the control carries none. The control's live detector printed *"no
compositor tick showed the world drawn with the HUD gone"*
(`control-yieldfix/03-composites-without-hud.png`).

`baseline-shipped/03-composites-without-hud.png` is the picture: three
compositor ticks, each showing the bottom strip with floor grid, wall and the
player's trail in it and **not one pixel of HUD text**, next to a running median
of ~860 bright pixels.

### The paired run, which is the same fact stated without a control build

`paired-swap-vs-composite/` samples the *same* strip twice per frame — once in
the WebGL `finish` hook (the game's swap) and once in rAF (the compositor) —
inside one run, and pairs each composite with the swap immediately before it:

    3941 paired samples with the HUD up at swap time
    composite showed <= half the swap's HUD ink: 927  (23.5%)
    worst pairs: swap=1263 composite=0, swap=900 composite=0, ...
                 swaps_since_tick = 0 on every one of them

`swaps_since_tick = 0` is the load-bearing column: **no game swap happened
between the previous compositor tick and this one**, so the buffer was not
mid-swap — the game was parked in `emscripten_sleep(0)` with a half-drawn frame
on screen. `03-paired.png` shows four of them. (This run's double sampling
halved the game's frame rate to ~30 fps, which is why its 23.5% is not the
headline number; the light rAF-only run above is unperturbed.)

## The control build

`web/Makefile` gained `client-yieldprobe`, the same shape as M4's
`client-control`: one extra translation unit and one relink, producing
`web/dist-m1/armagetronad-yieldfix.html`. It compiles `rSysdep.cpp` with
`-DAA_WEB_YIELD_AFTER_PERFRAME`, which moves the yield from the top of
`SwapGL()` to just after `rPerFrameTask::DoPerFrameTasks()`, and adds a second
yield in the `!sr_glOut` early-return branch so § 2's "once per call, on every
path" still holds. Nothing else differs.

**Substitute-in-place control, run and checked** (`baseline-md5.txt` holds the
before values, taken before the source was touched):

    dedicated wasm   2,488,298 B   md5 9718a2a64978cb6e9b95ea2f0454cca5   UNCHANGED
    armagetronad.wasm  md5 5f57136cd055635e9201e1887cb9f2e4               UNCHANGED
    armagetronad.js    md5 89bc886c1a74bfe5199c07d0b332bfdf               UNCHANGED
    armagetronad.html  md5 e8fa56d0d76ced5ca141e10a7f9a5973               UNCHANGED
    armagetronad.data  md5 59d5aeadf06cc5ca956551250bd740c3               UNCHANGED

`rSysdep.cpp` was edited and the whole client relinked from it; with
`AA_WEB_YIELD_AFTER_PERFRAME` undefined the preprocessed output is unchanged and
all four shipped artefacts come back byte-identical. `SwapGL()` is inside
`#ifndef DEDICATED` (opened at `rSysdep.cpp:465`), so the dedicated build never
compiles it at all — but the md5 was re-checked rather than argued.

## What this does NOT say

- **It does not say the control's placement is the placement to ship.** It is
  the placement that isolates the variable. In the control the yield lands
  between `DoPerFrameTasks()` and `SDL_mutexV(sr_netLock)`/`sr_LockSDL()`;
  yielding there is harmless in this single-threaded build but it is a
  reordering, and a shipping change should probably sit after the swap block
  instead. Either way it needs M2's gameplay gate re-run in both engines.
- **It does not clear § 10.** Nothing here touches the `gWall.cpp`
  `RenderNormal` open-`GL_QUADS` question; this is a different defect that
  happens to produce the same word.
- **It was measured in Chrome only**, on a local server, at 1024x768. Firefox
  paces `setTimeout` and compositing differently and should be measured before
  anyone quotes 20.7% as a property of the Demo rather than of this run.
