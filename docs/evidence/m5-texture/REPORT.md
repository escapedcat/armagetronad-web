# M5 — "can you check the texture of the car again? the native game looks somewhat clearer"

**Status: complete, diagnosis only. No source change, no rebuild, nothing
deployed.** Branch `m5-gate`, BASE `26d2ddb0`. Two commits, both evidence:

| sha | what |
|---|---|
| `0f2e8a5a` | what the Demo actually asks WebGL for when it draws the cycle |
| `9132abf7` | the anisotropy A/B, with the run's own noise floor |

`git diff --stat 26d2ddb0..HEAD -- src/ web/Makefile config/ resource/` is
**empty**. No input to the dedicated build changed, so 2,488,298 bytes / md5
`9718a2a64978cb6e9b95ea2f0454cca5` is preserved by construction rather than by
measurement. `-O2 -sASSERTIONS=1` untouched. Nothing redeployed.

---

## The short answer

**I could not reproduce a texture defect, and I could not reproduce the gap.**
Every property of the cycle texture that can be measured is either identical to
what the native desktop build does or better than it. Specifically: the filter
bound at draw time is the desktop default, the mip chain is complete, and the
uploaded texels are bit-identical to a libpng decode of the shipped PNG.

The port **does** leave one real quality improvement on the table —
**anisotropic filtering**, which is available here (max 16) and never requested.
Turning it on visibly sharpens both the cycle and the receding floor, and costs
nothing measurable. **But it does not explain the maintainer's report**, because
`grep -rn "ANISOTROP\|anisotrop" src/` returns **0 hits across the whole tree**:
the native game does not ask for it either, and macOS has no driver control
panel to force it on. So AF is a thing we could add, not a thing native has and
we lost.

That leaves the difference most likely coming from **the conditions of the
comparison**, not from the port. Two concrete questions at the end.

---

## What I measured, in the browser, at draw time

All of it against `web/dist-m1/`, whose four artefacts were confirmed
md5-identical to the four served from the live Demo before the runs — so these
are the Demo's numbers, not a local build's. The probe is the shipped page plus
one injected `<script>` (same `.js`/`.wasm`/`.data`), following the pattern
`docs/evidence/m5-startup/make-resolution-pages.mjs` established.

| question | measured |
|---|---|
| `GL_VENDOR` / `GL_RENDERER` | **`WebKit`** / `WebKit WebGL` (unmasked `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)`) |
| cycle body `MIN`/`MAG` at draw time | **`LINEAR_MIPMAP_LINEAR` / `LINEAR`**, stable across the whole run |
| `TEXTURE_MAX_ANISOTROPY_EXT` | **1** on every texture |
| mip chain for `cycle_body` | **complete and sampled** |
| `EXT_texture_filter_anisotropic` | **supported, max 16**, never requested |
| MSAA | `antialias:false` requested *and* granted; the game asks for none anywhere |
| uploaded texels vs shipped PNG | cycle body **bit-identical**, all four colours |
| canvas on this display, maximised | **3600x2086, uncapped** |

### Your item 2 — the vendor-string downgrade: **dead, confirmed**

`GL_VENDOR` is the literal string `WebKit`. Emscripten's `_glGetString` forwards
`GL_VENDOR` (7936) to `GLctx.getParameter` verbatim, so `rScreen.cpp`'s
`gl_vendor` *is* that string, and `strstr(gl_vendor,"ATI")` cannot match. The
same check clears `software_renderer` (no `Mesa`, no `Software Rasterizer`) and
`rISurfaceTexture::storageHack_` (no `SavageMX`). `default_texturemode` stays at
`GL_LINEAR_MIPMAP_LINEAR`. Nothing is downgraded.

### Your item 3 — is the mip chain real: **yes, and the test has a control**

`glGenerateMipmap` returning without error does not establish a usable chain, so
I drew each texture into a 1x1 framebuffer minified by its own width, forcing
the smallest level. The four cycle bodies return their average colour
(`84,130,130` / `130,84,130` / `99,99,99` / `130,99,73`) — a complete chain.

The control is `title.jpg`, the one NPOT texture: bound `MIN=LINEAR` with no
chain, and **forcing a mipmapped filter onto it returns opaque black**. That is
exactly the failure the NPOT demotion in `rITexture::OnSelect` exists to
prevent, so that demotion is live and load-bearing, not dead code.

### A hypothesis of my own, killed: the PNG decode path

Emscripten's SDL does **not** use libpng for `IMG_Load`. `libsdl.js`'s
`IMG_Load_RW` takes the browser-decoded image, `drawImage()`s it onto a 2D
canvas, and `SDL_LockSurface` `getImageData()`s it back — a premultiplied-alpha
round trip native does not have, and lossy for every texel with alpha < 255.
`cycle_body.png` is gray+alpha, so it is squarely in scope.

`compare-uploaded-texels.py` reads the uploaded texels back through a
framebuffer and predicts them from the shipped PNG through
`gTextureCycle::ProcessImage`'s `(alpha*px + (255-alpha)*C) >> 8`, recovering the
player colour `C` from the fully transparent texels. Result: **all four
recoloured cycle bodies are bit-identical — 0 of 196,608 channel samples differ,
each.** The wheels, whose alpha never reaches 0, differ by **at most 1/255**.
The decode is not it.

---

## Your live hypothesis — anisotropic filtering

**Real, measurable, worth having — and not the explanation.**

The two-page A/B failed as a control and is committed as such: two runs of this
game are not the same scene. One drew a **green** cycle, the next a **yellow**
one (the local player's colour is not stable across first-run boots), and the
cycles were not in the same place. That diff is scene divergence, not filtering.

The measurement is one run with its own noise floor. During the ~5 s countdown
after `NEW_ROUND` the cycles are placed but stationary: crop, crop again 200 ms
later, flip anisotropy on every live texture, crop a third time.

**The noise floor came out at exactly zero** — the four crops are bit-identical
across 200 ms — so every changed pixel afterwards is attributable to the flip.

| rect | noise floor | anisotropy 1 → 16 |
|---|---|---|
| cycle | 0.00 %, max 0 | 9.35 % changed, 1.00 % by >8, max 109 |
| floor_far | 0.00 %, max 0 | 27.07 % changed, 3.10 % by >8, max 31 |
| floor_mid | 0.00 %, max 0 | 12.86 % changed, 2.24 % by >8, max 33 |
| wall_left | 0.00 %, max 0 | 30.63 % changed, 0.36 % by >8, max 66 |

Split by surface, because the cycle and the floor are not the same question — on
the cycle's own 3,337 saturated pixels **21.9 % change and 13.1 % change by more
than 8**; on the floor inside that same crop, 9.2 % and 0.8 %. Both improve; the
cycle improves more, proportionally.

`inframe/compare-cycle.png` (4x nearest-neighbour) is the plate: the machine's
flank highlights are visibly better resolved. `inframe/compare-floor_far.png`
shows the receding grid staying brighter further back.

**Frame-rate cost: none measurable**, at 3600x2086, driven by the *unmodified*
`web/tools/fps-resolution-probe.steps` against pages carrying the shim and none
of the probe's hooks:

| | median | worst whole second | p50 | p90 | p99 |
|---|---|---|---|---|---|
| anisotropy 1 | 60 | 57 | 16.8 ms | 18.1 | 19.6 |
| anisotropy 16 | 60 | **58** | 16.7 ms | 17.9 | 19.2 |

Read honestly: **p50 is pinned at the `MAX_FPS 60` cap in both**, so this shows
anisotropy does not eat the existing headroom — not that it is free. The tails
do not degrade. The bar is 30.

**Why it is still not the answer.** `grep -rn "ANISOTROP\|anisotrop" src/`
returns 0 across the entire tree. The native build never requests anisotropy
either, and on macOS there is no driver control panel that forces it — Apple's
GL/Metal stack applies what is asked for. So on a like-for-like comparison the
native game is trilinear-only too. Adding AF would make the browser **better
than** native, which is a fine thing to want and is not a fix for this report.

---

## What I could not reproduce, said plainly

**I have no native build to compare against, and every mechanism I could measure
favours the browser or ties.** I could not construct a path by which the native
game is sharper:

- **Filtering** is identical (`LINEAR_MIPMAP_LINEAR`, the desktop default).
- **Texture data** is bit-identical to the source PNG.
- **Colour depth favours the browser.** `sr_texturesTruecolor` defaults to
  `false` (`TEXTURES_HI` in the menu), so native at stock settings uploads the
  cycle at `GL_RGB5` — 5 bits per channel. WebGL 1 cannot express a sized
  internal format, so the port always uploads 8-bit. The browser has *more*
  colour precision here, not less.
- **Resolution favours the browser.** Measured with no CDP override: this
  display is a 3024x1964 Liquid Retina XDR in a scaled mode reporting CSS
  1800x1169 at devicePixelRatio 2. A maximised window is 1800x1043, so
  `web/shell.html`'s rule yields a **3600x2086 backing store and the 3840x2160
  area cap does not bite**. That is *more* pixels than the panel has; macOS then
  downsamples, which is supersampling and if anything cleans the image up. A
  native app at panel resolution renders fewer.
- **MSAA** is off on both; the game requests none on any platform.
- **The camera is stock.** `src/engine/eCamera.cpp` carries no `__EMSCRIPTEN__`
  guard, `ePlayer.cpp` sets `startCamera = CAMERA_CUSTOM`, defaults
  `CAMERA_CUSTOM_BACK 30` / `RISE 20` / `ZOOM 0.5`. The port has not moved it.

One thing worth flagging about what the maintainer is looking at: at the default
`CAMERA_CUSTOM` the cycle is about **38 px wide** even at 3600x2086, viewed
almost end-on, and most of its visible surface is flat player colour rather than
texture. There is not much texture on screen to judge.

---

## Recommendation

**1. Do not ship anisotropic filtering as a fix for this report.** It does not
answer it. It is new behaviour in the same category as task 2b's `gluLookAt`,
but 2b closed a gap against what a player expects *and* against native; this
would open one in our favour. Offer it to the maintainer as an optional
enhancement, with the numbers above, and let them choose.

**2. If they want it, here is where it goes and what it costs.** Not
`eCompat.cpp` — the decision is per-texture at the moment the min filter is
chosen, and `eCompat.cpp` holds process-wide shims. The right site is the
existing `#ifdef __EMSCRIPTEN__` block in **`rISurfaceTexture::OnSelect`**
(`src/render/rTexture.cpp`), which already computes `minFilter` and already
handles the NPOT demotion. Three lines beside the existing
`glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, minFilter)`, applying
`GL_TEXTURE_MAX_ANISOTROPY_EXT` only when `minFilter` is one of the four
mipmapped values — which is exactly the rule the shim used, and which keeps it
off `title.jpg`. Emscripten has already called
`getExtension('EXT_texture_filter_anisotropic')` in `GL.initExtensions`
(`libwebgl.js`), so the enum is enabled with no page cooperation.

That whole function body is inside `#ifndef DEDICATED`, so the dedicated build
cannot see it — but per this repo's own rule the byte-identity must still be
demonstrated with a substitute-in-place control, not argued from the guard.

**3. What would actually settle the report — two questions for the maintainer:**

- **How big is the browser window?** The canvas is `innerWidth x dpr`, so a
  half-height window halves the rendered resolution while a native fullscreen
  game keeps all of it. Maximised, the Demo renders 3600x2086 here. This is the
  largest single lever and the cheapest to check: maximise, reload (the canvas
  is sized at load), and compare again.
- **What does their native install differ in?** Specifically the camera
  (`CAMERA_CUSTOM_BACK`/`RISE`/`ZOOM`, or a different camera mode entirely — a
  smart or in-cycle camera shows the machine far larger), and `TEXTURES_HI`. A
  native `user.cfg` accumulated over years is not the port's stock defaults, and
  "the bike is bigger on my machine" would explain the report completely without
  any filtering being involved.

---

## Housekeeping

`web-evidence/` in the worktree is **not mine**: it is `web/tools/live-gate.sh`'s
default `OUT` (line 42) from task 5's live-gate run, 83 files / 16 MB. Task 5
already curated its results into `docs/evidence/m5-launch/`, which holds the
checkers, the `.asrun` transcripts and the wire facts that directory does not.
It is redundant scratch from another task's tooling default. I left it alone
rather than delete another task's output, but nothing depends on it.

**Five generated pages are sitting in `web/dist-m1/`** — `texprobe.html`,
`aniso-off.html`, `aniso-on.html`, `fps-aniso-off.html`, `fps-aniso-on.html`.
`dist-m1/` is gitignored and they are regenerable with one command
(`node docs/evidence/m5-texture/make-texprobe-page.mjs`), but **the next
`npm run deploy` would publish them**, because `deploy` publishes the whole
directory. That is not a new hazard — task 5's `res-*.html` control pages went
live the same way and `https://escapedcat.github.io/armagetronad-web/res-1920x1080.html`
answers 200 today — so I left mine in place rather than change an established
pattern behind the maintainer's back. Delete them before deploying if that is
not wanted.
