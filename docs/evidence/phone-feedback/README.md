# The phone report: stretched, tiny, and not smooth

Three complaints from the first run of this port on real Android hardware. This
directory is the measurements; `web/shell.html` carries the fixes and their
arguments; `web/README.md` documents the switches.

**The headline is that the first complaint's leading hypothesis was wrong.** The
CSS does not stretch the picture and cannot: measured at 0.00 % aspect error in
five configurations, including one where the page's own state is falsified on
purpose. What *was* wrong is narrower and completely fixable, and there is
exactly one mechanism left that could still stretch a real phone's picture,
which no machine in this repo can test.

---

## 1. "It looks stretched"

### The projection is honest at every aspect ratio, and here is why

`rViewport::Perspective` builds the frustum from

```
aspectratio   = (width·sr_screenWidth·currentScreensetting.aspect) / (height·sr_screenHeight)
ensureverticalfov = fmax(aspectratio/1.5, 1.0)
xmul = ensureverticalfov · tan(fov·π/360)
ymul = xmul / aspectratio
```

Screen pixels per world unit come out at `(W/2)/xmul` horizontally and
`(H/2)/ymul = (H/2)·aspectratio/xmul` vertically. With `aspectratio = W/H` those
are **the same number**, so a square in the world is a square on the screen at
any viewport shape. The only term that could break that is
`currentScreensetting.aspect` — the *pixel* aspect ratio — and `rScreen.cpp`'s
`aspect[]` table is `1` for every one of its sixteen entries, and
`lowlevel_sr_InitDisplay` is the only thing that reads it. It is 1 here.

What the formula *does* do above 1.5 is hold the vertical field of view constant
and widen the horizontal one without limit. At a phone's landscape 2.61 that is
a **120° horizontal** field of view against a desktop 16:9's 100°. That is a
wide-angle *look*, not a stretch — and it is the same mechanism that makes the
cycle small, so it is answered in §2.

### The CSS does not stretch it either — and the control proves the test works

`web/tools/phone-aspect-probe.steps`, at 915×350 CSS px at dpr 3 (a Pixel-class
phone in landscape with the URL bar showing). `aspect_err_pct` is the displayed
box's shape against the **backing store's** shape.

| phase | backing store | displayed box | aspect error | whole image on screen |
|---|---|---|---|---|
| A load, URL bar showing | 2745×1050 (2.6143) | 915×350 (2.6143) | **0.00 %** | yes |
| B visible height grows to 412 after load | 2745×1050 (2.6143) | 915×350 (2.6143) | **0.00 %** | yes, letterboxed |
| C back to 350 | 2745×1050 (2.6143) | 915×350 (2.6143) | **0.00 %** | yes |
| **D falsified: 4:3 backing store, stale 2.61 `--aa-aspect`** | 1024×768 (1.3333) | 915×686.25 (**1.3333**) | **0.00 %** | **no — cropped** |
| E restored | 2745×1050 (2.6143) | 915×350 (2.6143) | **0.00 %** | yes |

Row D is the point. It sets the backing store to 4:3 while leaving the custom
property the stylesheet reads at the 2.61 published at load — the worst case any
drift between the two could produce — and the box still comes out at exactly the
backing store's ratio, overflowing instead. `height:auto` on a replaced element
takes its height from the element's own intrinsic ratio, so **a stretch is not
representable in this stylesheet**; a wrong aspect produces a crop. A probe that
only measured healthy states would have printed 0.00 % whether or not the
mechanism existed.

### What genuinely did draw the wrong shape: a portrait boot

A phone is held in portrait. A link opens in portrait. Phase 3 sized the backing
store from that portrait viewport, started the game, and *then* asked the player
to rotate. So the projection was built at an aspect near **0.45**, and below 1.5
the formula above keeps the horizontal field of view and divides the vertical by
the aspect: `ymul = xmul/0.45`, a **vertical field of view near 131°**. That is a
distortion in the render. The CSS that lays the result out afterwards is correct
and cannot undo it. `../phase3-touch/portrait-02-rotated-to-landscape-after-loading-in-portrait.png`
is what it produced: a pillarboxed strip of a fisheyed portrait frame.

**Fixed by holding `main()`**, not by resizing anything.
`web/tools/phone-portrait-hold.steps`:

| step | held? | viewport | backing store |
|---|---|---|---|
| loaded in portrait, 2 s | yes | 412×782 | 1236×2346 (0.53) |
| runtime ready, 12 s | **still yes** | 412×782 | 1236×2346 |
| rotated to landscape | released after **89 ms**, by `resize` | 915×350 | **2745×1050 (2.6143)** |
| game started | — | 915×350 | `err 0.00 %`, `gl … MATCH` |

The reload chip stays hidden afterwards, because the backing store now *is* for
the orientation on screen.

### The word "stretched" was in our own UI, and it was wrong

The Phase 3 reload chip read *"Rotated — the picture is being stretched from the
size it loaded at."* That was the only place this port used the word, and the
table above says it is false: a rotation costs **size and sharpness**, not
shape. The chip now says so.

### The one mechanism left, which no machine here can test

`canvas.width/height` is what the page asks for and what the game reads back
through `SDL_GetVideoInfo` to build `glViewport` and `glFrustum`.
`gl.drawingBufferWidth/Height` is what the driver actually allocated. **A WebGL
drawing buffer larger than `MAX_RENDERBUFFER_SIZE` or `MAX_VIEWPORT_DIMS` is
silently clamped**, leaving the two disagreeing: the game renders for a shape
that does not exist and the browser scales the buffer that does over the element
box. If the clamp is not proportional, that is a stretched picture.

Every GPU in this repo's loop reports **16384**, so a phone-sized request is four
times under the limit and this code path is dead here — which is precisely why no
desktop test could ever have found it. It is now both **prevented** (both axes
scaled by one factor before boot, so the aspect survives the clamp) and
**reported** (`?diag=1`'s `gl` row says `MATCH` or `CLAMPED`).

### Not measured, and not claimed to be

Chrome's device emulation reports `vh == dvh == svh == lvh == innerHeight` in
every configuration this rig can produce, so **the real phone case — a URL bar
that changes the visible height — is not covered by anything above.** Phase B
moves the viewport after load, which is the closest this gets and is not the same
thing. `body` now carries a `100dvh` second declaration so the canvas is centred
inside what is visible rather than inside an initial containing block a phone
browser does not promise is on screen. That is correct by construction, not by
experiment.

---

## 2. "The bike is tiny"

Six arms, same shipped page, no rebuild and no control page:
`run-camera-sweep.sh`. Geometry as above. The number is the player's own cycle's
bounding box in backing-store pixels during the round-start countdown, by the
saturated-pixel method of `../m5-texture/make-texprobe-page.mjs`.

| arm | cycle bbox | saturated px | vs stock (height) | predicted | arena rim in frame? |
|---|---|---|---|---|---|
| stock (`?cam=1`) | 23 × 63 | 933 | 1.00× | 1.00× | yes |
| `START_FOV_1 78` | 29 × 75 | 1,395 | 1.19× | 1.24× | yes |
| `START_FOV_1 69` | 33 × 80 | 1,832 | 1.27× | 1.46× | only at the corners |
| `START_FOV_1 60` | 40 × 58 | 1,313 | *(clipped)* | 1.73× | **no — floor only** |
| **camera ×0.5** | **47 × 122** | 3,598 | **1.94×** | 2.00× | **yes** |
| camera ×0.35 | 68 × 118 | 4,296 | *(clipped)* | 2.86× | yes |

**Read the "predicted" column against the measured one, because it exposes the
probe's own limit.** Field-of-view magnification is `tan(45°)/tan(fov/2)`;
camera magnification is the distance ratio, `sqrt(11²+8²)/sqrt(5.5²+4²) = 2.00`.
The camera arm lands within 3 % of prediction. The field-of-view arms fall
short and then collapse, because narrowing the field of view **moves the cycle
down the screen** and out of the probe's fixed crop rectangle — the `fov60` and
`cam035` rows are under-measured for that reason and are marked, not quoted.

**The camera is the lever, and the last column is why.** Narrowing the field of
view zooms into the centre of the frame and pushes the horizon off the top: at
60° the picture is floor and nothing else, with no arena rim to navigate by
(`fov60/f01-round2-countdown.png`). Moving the camera closer and lower magnifies
by more *and* keeps the rim, because the pitch is unchanged
(`cam050/f01-round2-countdown.png`). ×0.35 is bigger again but the cycle starts
to occlude the near floor, so **×0.5 ships** and `?cam=` is exposed so the next
opinion can be a measurement.

### Where the setting had to go, and why it is not a compiled default

M4 task 3 established the rule: a preference belongs in the binary, a
never-change-this belongs in `web/webdefaults/autoexec.cfg`. **Neither applies,
because for these four settings the player has no choice to protect:**

- `config/settings_visual.cfg` names all of `CAMERA_CUSTOM_BACK`, `_RISE`,
  `_BACK_FROMSPEED`, `_RISE_FROMSPEED`, and `st_LoadConfig` loads
  `config/settings.cfg` (which `include`s it) **after** `user.cfg`. So a
  compiled default in `eCamera.cpp` is overwritten on every boot — and so is
  anything a player could put in `user.cfg`.
- They are `tSettingItem`, so they are never written back to `user.cfg` anyway.
- There is no menu row for any of them. `START_FOV_1` *is* a real preference —
  `tConfItem`, on the Player/Camera menu, named nowhere under `config/` — which
  is exactly why the shipped change does **not** touch it.

So the tuning is applied by the page, by appending to the preloaded
`/data/webdefaults/autoexec.cfg` before `main()`, **only on a touch device**.
That is what keeps it off the desktop: a desktop visitor's copy of that file is
byte for byte the one the build shipped, and the page logs `[CAMERA] stock
camera (factor 1)` to say so.

---

## 3. "Not going smoothly fast"

**Not answerable from here, and the honest output is an experiment rather than a
guess.** `?dpr=N` overrides the device pixel ratio used to size the backing
store, so the same build can be loaded at one ninth of the pixels on a dpr-3
phone. `dpr/` is the A/B run on *this machine* at a phone's geometry:

| | backing store | pixels | p50 frame time | p90 | p99 | per-second median | worst second |
|---|---|---|---|---|---|---|---|
| `?dpr=3` | 2745×1050 | 2.88 Mpx | 16.7 ms | 17.8 | 19.0 | 60 | 58 |
| `?dpr=1` | 915×350 | 0.32 Mpx | 16.7 ms | 17.9 | 19.0 | 60 | 58 |

A nine-fold cut in pixels moves **nothing**, which is the same result
`docs/evidence/m5-startup` got sweeping 0.79 → 33.2 Mpx on the desktop, and it
confirms the knob really does change the pixel count (the `[DISPLAY]` line in
each transcript). **It says nothing about a phone GPU.** That is the maintainer's
measurement to take, and it is one comparison: same round, twice, once with
`?dpr=1`.

An in-page frame-rate readout costs **nothing**, because the game already draws
one — `sr_FPSOut` defaults to `true` in `src/render/rScreen.cpp` and "FPS: 60"
is in the top right of every screenshot in this directory. `?diag=1` adds a
larger `swaps/s` row only because that text is small on a phone; the two agree.

---

## Re-running everything here

```sh
python3 -m http.server 8000 --directory web/dist-m1 &

node web/tools/drive-browser.mjs --headed --mobile 915,350,3 \
     --out docs/evidence/phone-feedback/aspect \
     --url http://localhost:8000/armagetronad.html \
     --script-file web/tools/phone-aspect-probe.steps

node web/tools/drive-browser.mjs --headed --mobile 412,782,3 \
     --out docs/evidence/phone-feedback/portrait \
     --url 'http://localhost:8000/armagetronad.html?diag=1' \
     --script-file web/tools/phone-portrait-hold.steps

sh docs/evidence/phone-feedback/camera/run-camera-sweep.sh

for D in 3 1; do
  node web/tools/drive-browser.mjs --headed --mobile 915,350,3 \
       --out docs/evidence/phone-feedback/dpr/dpr$D \
       --url "http://localhost:8000/armagetronad.html?dpr=$D" \
       --script-file web/tools/fps-resolution-probe.steps
done

kill %1
```

**EMULATION IS NOT A DEVICE.** `--mobile` supplies a viewport, a pixel ratio and
touch events. It says nothing about a phone's GPU throughput, memory, thermal
behaviour or compositor. Read the header of `web/tools/drive-browser.mjs` before
quoting any frame rate from this directory.

## The desktop gates, re-run against this build

| gate | Chrome | Firefox |
|---|---|---|
| M4 persistence milestone (`gates/m4-milestone-*`) | PASS 22/22 | PASS 22/22 |
| M2 gameplay (`gates/m2-gameplay-*`) | ALL PASSED — median 60 fps, worst second 58 | ALL PASSED — median 60 fps, worst second 39 |

`make -f web/Makefile dedicated`, forced to relink by deleting its output first:
**2,488,298 bytes, md5 `9718a2a64978cb6e9b95ea2f0454cca5`.** Only
`web/shell.html` changed in the code, and it is a `--shell-file` for the client
link alone — it compiles into nothing.

## One measurement that was wrong here before, and is corrected

`../m5-texture/README.md` says "the defaults are `CAMERA_CUSTOM_BACK 30`,
`CAMERA_CUSTOM_RISE 20`, `CAMERA_CUSTOM_ZOOM 0.5`". Those are the C++
initialisers in `eCamera.cpp`, and they are **not** what runs:
`config/settings_visual.cfg` is loaded after them and sets `6`, `4`, `.5`, `.4`,
`-.58` and `0`. The effective stock camera at 10 m/s is 11 back and 8 up, not 30
and 20.
