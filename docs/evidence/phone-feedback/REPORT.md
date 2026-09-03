# Phone feedback: stretched, tiny, not smooth

**Status: all three addressed. Two fixed, one converted into an experiment the
maintainer can run in ninety seconds.** Both desktop gates re-run and green in
both browsers; the M0 dedicated server byte-identical from a forced relink.
Nothing deployed.

Commits on `m5-exit`:

| SHA | what |
|---|---|
| `ae5a0c69` | the portrait boot hold, the `100dvh` body, the honest chip text, the GPU axis clamp, `?dpr` / `?cam` / `?diag`, the touch camera tuning |
| `728d8aba` | the hold's release made robust after it hung for 69 s; the probes and all the evidence; both gates in both browsers |
| *(this one)* | the report, the evidence README, and `web/README.md`'s parameter documentation |

---

## The dispatch was wrong about the first one, and here is the measurement

> *"The leading hypothesis is a CSS box whose aspect does not match the backing
> store."*

**It is not, and it cannot be.** `web/tools/phone-aspect-probe.steps` measures
the displayed box's aspect ratio against the backing store's in five
configurations at a phone's landscape geometry. It is **0.00 % in all five** —
including phase D, which falsifies the page's own state on purpose by setting a
4:3 backing store while leaving the custom property the stylesheet reads at the
2.61 published at load. That is the worst case any drift between the two could
produce, and the box still comes out at exactly 1.3333: it **overflows** instead.

The reason is structural rather than lucky. `#canvas` constrains `width` and
leaves `height:auto`, and a replaced element with `height:auto` takes its height
from its own intrinsic ratio — which for a canvas is its `width`/`height`
attributes, i.e. the backing store. **A stretch is not representable in this
stylesheet.** A wrong aspect produces a crop.

The dispatch also asked me to verify the projection first. It is honest too:
pixels per world unit come out at `(W/2)/xmul` horizontally and
`(H/2)·aspectratio/xmul` vertically, and with `aspectratio = W/H` those are the
same number at any viewport shape. The only term that could break it is
`currentScreensetting.aspect`, and `rScreen.cpp`'s `aspect[]` table is `1` for
all sixteen entries.

### What was really wrong: a portrait boot

A phone is held in portrait. A link opens in portrait. Phase 3 sized the backing
store from the portrait viewport, **started the game**, and then asked the player
to rotate — so the projection was built at an aspect near 0.45, which below 1.5
means `ymul = xmul/0.45`, a **vertical field of view near 131°**. That is a
distortion in the render, not in the layout, and no CSS afterwards can undo a
frame drawn at the wrong shape. `docs/evidence/phase3-touch/portrait-02-*.png`
is the picture: a pillarboxed strip of a fisheyed portrait frame.

**Portrait now holds `main()`.** The wasm keeps downloading behind the prompt;
the moment the phone is turned, the backing store is re-measured for the real
orientation and the game starts — once, at the right shape, with no re-init and
no reload. Measured: held while portrait even with the runtime already ready,
released 89 ms after the rotation, backing store 1236×2346 → 2745×1050 before
`main()`. "Start in portrait anyway" is the escape hatch for a device whose
orientation this page reads wrongly.

**That fix nearly shipped with a worse bug than it fixed**, and it is worth
naming. The first version released the hold on the `(orientation: portrait)`
media query alone. Under emulation the query's change event did not arrive for
**sixty-nine seconds** after the viewport actually moved — a held page paints
nothing, and the query appears to wait for a paint. A hold that never releases is
a game that never starts. The release now asks `innerWidth`/`innerHeight` first
(the quantity `sizeCanvas()` actually reads), and listens to the media query,
`resize`, `orientationchange` and a 250 ms poll that exists only while held.

### And the word came from us

The Phase 3 reload chip read *"the picture is being stretched from the size it
loaded at."* It is the only place this port ever used the word, the maintainer's
report used it back, and the table above says it is false — a rotation costs size
and sharpness, not shape. The chip now says that instead.

### The one thing I could not settle, and the fix for it

`canvas.width/height` is what the page asks for and what the game reads through
`SDL_GetVideoInfo` to build `glViewport` and `glFrustum`.
`gl.drawingBufferWidth/Height` is what the driver allocated. **A WebGL drawing
buffer over `MAX_RENDERBUFFER_SIZE` / `MAX_VIEWPORT_DIMS` is silently clamped**,
leaving those two disagreeing — and if the clamp is not proportional, that is a
genuinely stretched picture. Every GPU in this repo's loop reports **16384**, so
a phone-sized request is four times under the limit and the path is dead here.
That is exactly why no desktop test could have found it. It is now **prevented**
(both axes scaled by one factor before boot) and **reported** (`?diag=1`'s `gl`
row: `MATCH` or `CLAMPED`).

---

## "The bike is tiny": the camera, not the field of view

Six arms, same shipped page, no rebuild, no control page.

| arm | cycle bbox (px) | vs stock | predicted | arena rim in frame? |
|---|---|---|---|---|
| stock | 23 × 63 | 1.00× | 1.00× | yes |
| `START_FOV_1 78` | 29 × 75 | 1.19× | 1.24× | yes |
| `START_FOV_1 69` | 33 × 80 | 1.27× | 1.46× | only at the corners |
| `START_FOV_1 60` | 40 × 58 | *(clipped)* | 1.73× | **no — floor only** |
| **camera ×0.5** | **47 × 122** | **1.94×** | 2.00× | **yes** |
| camera ×0.35 | 68 × 118 | *(clipped)* | 2.86× | yes |

Narrowing the field of view zooms into the centre and pushes the horizon off the
top — at 60° there is no arena rim left to navigate by. Moving the camera closer
and lower magnifies by more **and** keeps the rim, because the pitch does not
change. ×0.5 ships; ×0.35 is bigger still but the cycle starts to occlude the
near floor.

*(The two `(clipped)` rows are under-measured: narrowing the field of view moves
the cycle down and out of the probe's fixed crop rectangle. They are marked
rather than quoted. The camera arm lands within 3 % of its independent
prediction, which is the check that the probe works.)*

### Where it had to go, and why not a compiled default

The dispatch asked me to prefer a compiled default and to say which and why.
**A compiled default is unreachable for these four settings.**
`config/settings_visual.cfg` names all of them, and `st_LoadConfig` loads
`config/settings.cfg` **after** `user.cfg` — so an `eCamera.cpp` default is
overwritten on every boot, and so is anything a player could save. They are
`tSettingItem` (never written back to `user.cfg`) and have no menu row. The
player has no way to set these today on any platform, so there is no player
choice to protect — which is the "harmless" case
`web/webdefaults/autoexec.cfg`'s own header describes.

So it is **the shell, touch-only**: the page appends to the preloaded
`/data/webdefaults/autoexec.cfg` before `main()`, only when the primary input is
a finger. That is what keeps the desktop Demo untouched — and it is checkable,
not asserted: a desktop run logs `[CAMERA] stock camera (factor 1)` and its copy
of that file is byte for byte the shipped one.

`START_FOV_1` is deliberately **not** touched: it *is* a real preference
(`tConfItem`, on the Player/Camera menu, named nowhere under `config/`), so
overriding it would take something away from the player.

---

## "Not going smoothly fast": the experiment, not a resolution knob

I did not reduce the resolution. **`?dpr=N` is the switch that decides whether
reducing it would help at all**, and it is one comparison on the device.

On this machine at a phone's geometry, a nine-fold cut in pixels moves nothing:

| | backing store | pixels | p50 frame time | per-second median | worst second |
|---|---|---|---|---|---|
| `?dpr=3` | 2745×1050 | 2.88 Mpx | 16.7 ms | 60 | 58 |
| `?dpr=1` | 915×350 | 0.32 Mpx | 16.7 ms | 60 | 58 |

Same result as M5's desktop sweep from 0.79 to 33.2 Mpx. It confirms the knob
changes the pixel count and says **nothing** about a phone GPU.

**An in-page FPS readout costs nothing, because the game already draws one.**
`sr_FPSOut` defaults to `true` in `src/render/rScreen.cpp`; "FPS: 60" is in the
top right of every screenshot in the evidence directory. `?diag=1` adds a bigger
`swaps/s` row only because that text is small on a phone, and the two agree.

**If `?dpr=1` changes nothing on the phone, these are the real levers** — priced,
not implemented, as instructed:

1. **`MAX_FPS`.** Already a compiled default (M4 task 3) and already
   menu-reachable, so this is a *setting*, not a change: capping at 30 trades
   peak for consistency, and `sr_LimitFPS` yields through `emscripten_sleep`
   under Emscripten, so the cap is live. Cost: nothing to try — one menu row.
   Worth trying first precisely because it is free.
2. **The `-sLEGACY_GL_EMULATION` per-frame CPU cost.** This is where the time
   actually goes and it is the expensive one: the immediate-mode translation
   rebuilds vertex buffers per `glBegin`/`glEnd` block, and this game emits many
   small ones. Real work, on the order of a milestone, and §10 of
   `docs/porting/browser-runtime-notes.md` already records that the batching has
   a one-vertex-format-per-batch defect class waiting there.
3. **Optimisation level.** The client is `-O2 -sASSERTIONS=1`. `-O3`/`-Os` are a
   relink away, but `ASSERTIONS=1` is itself a per-call cost in the JS glue and
   is the more likely win of the two; both change a binary that four gates
   certify, so neither is a free experiment.

Do not ship a resolution knob on the strength of a guess. The `?dpr=1`
comparison is what makes it a decision.

---

## What the maintainer must do on the phone, exactly

Nothing is deployed — that decision is yours. When you want it live, `cd web &&
npm run deploy`; it publishes `web/dist-m1` **as built**, and the artefacts in
the tree right now are exactly the ones every number in this report was measured
against, so no rebuild is needed first. Then, in landscape:

1. **Play a round normally.** The camera is now half as far back. Is the cycle
   big enough? If not, try `?cam=0.35`; if it is now too close, `?cam=0.7`.
   `?cam=1` is exactly the build you played before.
2. **Load `?diag=1` and read the four rows**, then send them verbatim. The one
   that matters is `gl`: if it says **`CLAMPED`**, or if `err` is anything other
   than `0.00 %`, that is the stretch and it is a fact no machine here can
   produce. Also worth having: what `dpr` and `vp` say on your device.
3. **Play the same round twice, once with `?dpr=1`.** If it feels smoother, the
   phone is fill-bound and resolution is the lever. If it feels identical, it is
   CPU-bound and cutting pixels would only cost sharpness. **This single
   comparison decides the whole performance question** — please do it before
   anyone writes a resolution setting.
4. **Open the page in portrait**, then turn the phone. It should show "turn your
   phone sideways", start by itself when you turn it, and come up sharp and
   full-screen — not as a narrow strip.
5. **Do you still see stretching?** If yes, with the `?diag=1` numbers showing
   `MATCH` and `0.00 %`, then it is something outside this page (an Android
   display-scaling or browser-zoom setting) and the next step is a photo of the
   screen rather than more code.

## What I could not determine without a device

- **Whether the phone's driver clamps the drawing buffer.** Prevented and
  reported; unmeasurable here (every GPU in the loop reports 16384).
- **Whether a phone is fill-bound or CPU-bound.** `?dpr=1` answers it in one
  comparison; emulation cannot.
- **Whether `100dvh` on `body` was needed.** Chrome's device emulation reports
  `vh == dvh == svh == lvh == innerHeight` in every configuration, so the real
  case — a URL bar changing the visible height — is not reproducible here. The
  declaration is correct by construction, and is not claimed to be measured.
- **What "stretched" actually looked like.** I could not reproduce a stretch at
  all. I fixed the one configuration that genuinely renders the wrong shape
  (portrait boot), removed the word from the UI where it was untrue, and built
  the readout that will answer it if it survives.

## Gates

| | Chrome | Firefox |
|---|---|---|
| M4 persistence milestone | PASS 22/22 | PASS 22/22 |
| M2 gameplay | ALL PASSED — median 60 fps, worst second 58 | ALL PASSED — median 59 fps, worst second 55 |
| Phase 3 touch overlay *(not asked for; it is the one gate this could break)* | menus and both steering halves by real taps, all four tooltip counters spent, 0 timeouts | — |

Running that third one was worth it: it caught the boot hold quietly taking the
full-screen rotate prompt with it, so a player who rotated **mid-game** would
have got only a chip along the bottom of a letterboxed sliver. Fixed, and its
transcript is row-for-row identical to Phase 3's again.

`make -f web/Makefile dedicated`, forced to relink by deleting its output:
**2,488,298 bytes, md5 `9718a2a64978cb6e9b95ea2f0454cca5`.** Only
`web/shell.html` changed in code; it is a `--shell-file` for the client link and
compiles into nothing. `-O2 -sASSERTIONS=1` untouched.

## A correction to a committed measurement

`docs/evidence/m5-texture/README.md` states the camera defaults are
`CAMERA_CUSTOM_BACK 30`, `CAMERA_CUSTOM_RISE 20`, `CAMERA_CUSTOM_ZOOM 0.5`.
Those are the C++ initialisers in `eCamera.cpp` and they are not what runs:
`config/settings_visual.cfg` is loaded afterwards and sets `6`, `4`, `.5`, `.4`,
`-.58`, `0`. The effective stock camera at 10 m/s is 11 back and 8 up, not 30 and
20. The dispatch's own "≈13.5 behind at ≈10 up" was the right family of number.
