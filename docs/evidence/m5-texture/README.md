# M5 — "can you check the texture of the car again? the native game looks somewhat clearer"

What the shipped client actually asks WebGL for when it draws the cycle,
measured in a real browser at draw time rather than read off the source.

## How it was produced

    node docs/evidence/m5-texture/make-texprobe-page.mjs
    python3 -m http.server 8000 --directory web/dist-m1 &
    node web/tools/drive-browser.mjs --headed --width 1280 --height 800 \
         --out docs/evidence/m5-texture/run-chrome \
         --url http://localhost:8000/texprobe.html \
         --script-file web/tools/texture-probe.steps
    kill %1
    node   docs/evidence/m5-texture/extract-dumps.mjs        docs/evidence/m5-texture/run-chrome
    python3 docs/evidence/m5-texture/compare-uploaded-texels.py docs/evidence/m5-texture/run-chrome

`texprobe.html` is the shipped page plus one injected `<script>`; it loads the
same `armagetronad.js` / `.wasm` / `.data`. Before the run, all four artefacts in
`web/dist-m1/` were confirmed md5-identical to the four served from
<https://escapedcat.github.io/armagetronad-web/>, so every number here is a
number the live Demo produces:

    armagetronad.wasm  6f835c849bbef4c77896030394cda7a5
    armagetronad.js    65a49a216a58cc05c9c0c6622e677033
    armagetronad.data  59d5aeadf06cc5ca956551250bd740c3
    armagetronad.html  c4384f76efc244155b513bdaabbc3b6d

## Two caveats on reading this run

**The capture is 1280x800, which is NOT what the Demo renders at on this
machine.** `drive-browser.mjs` pins `deviceScaleFactor` to 1, so the canvas is
sized to the harness window. Measured separately in a maximised Chrome with no
metrics override (`dpr.mjs`, scratch): this display is a 3024x1964 Liquid Retina
XDR in a scaled mode reporting **CSS 1800x1169 at devicePixelRatio 2**, a
maximised window is 1800x1043, and `web/shell.html`'s rule therefore produces a
**3600x2086 (7.51 Mpx) backing store, UNCAPPED** — the 3840x2160 area cap does
not bite here. So the cycle in `03-round1-cycle-oblique.png` covers about 1/8 the
pixels it covers in the real Demo. Do not read on-screen sharpness off these
screenshots; read filter state off the JSON.

**`mipLevels()` results for texture ids 1-7 are invalid, and the transcript says
so.** Those are first-run/menu textures that `rITexture::Unload` had already
deleted by the time the end-of-run probes ran, so the probe's retained
`WebGLTexture` handle is stale — hence the two
`INVALID_OPERATION: framebufferTexture2D: attempt to use a deleted object`
warnings, and hence `glGetError 0x502` on those rows. The cycle textures (ids
8-15) were live and report `0x0`. Nothing was concluded from ids 1-7.

## What was measured

| | |
|---|---|
| `GL_VENDOR` / `GL_RENDERER` | `WebKit` / `WebKit WebGL` (unmasked: `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max)`) |
| cycle body at draw time | `MIN=LINEAR_MIPMAP_LINEAR`, `MAG=LINEAR`, `MAX_ANISOTROPY=1`, stable over the whole run |
| mip chain | complete and sampled — forcing the smallest level returns the image's average colour, not black |
| `EXT_texture_filter_anisotropic` | **supported**, `MAX_TEXTURE_MAX_ANISOTROPY_EXT = 16`, **never requested** |
| MSAA | `antialias:false` requested and granted; the game asks for none on any platform |
| uploaded texels vs shipped PNG | cycle body **bit-identical** across all four player colours; cycle wheel differs by at most **±1/255** |

`GL_VENDOR` is `WebKit`, so `rScreen.cpp`'s `strstr(gl_vendor,"ATI")` trilinear
downgrade never fires — confirmed by measurement, not by argument. The filter
bound for the cycle is `GL_LINEAR_MIPMAP_LINEAR`, which is exactly
`default_texturemode`'s desktop value. **The port is not downgrading anything.**

`title.jpg` (id 17, 800x600, the one NPOT texture) is its own positive control:
it is bound `MIN=LINEAR` with no mip chain, and forcing a mipmapped filter onto
it in `mipLevels()` returns **opaque black**, which is the failure the NPOT
demotion in `rITexture::OnSelect` exists to prevent. That demotion is live and
load-bearing.

---

# The anisotropy A/B

`aniso-off.html` / `aniso-on.html` are the shipped page plus the same probe,
differing in the single number `AA_FORCE_ANISO`; `make-texprobe-page.mjs`
asserts that and exits non-zero if it ever stops being true. Same `.js`,
`.wasm`, `.data`. `fps-aniso-off.html` / `fps-aniso-on.html` are the same pair
carrying only the shim and none of the probe's hooks, because a frame-rate
comparison must not be made through an instrument that wraps both draw entry
points.

## The two-page A/B failed as a control, and that is recorded rather than hidden

`ab-off/` and `ab-on/` are a first attempt, kept because the failure is the
point: **two runs of this game are not the same scene.** The aniso-off run drew
a **green** cycle and the aniso-on run a **yellow** one — the local player's
colour is not stable across first-run boots — and the cycles were not in the
same place. The resulting diff (mean |Δ| 2.6–4.8, max 254) is dominated by that,
not by filtering, and no adjustment of the step timings would have fixed it.
Anyone reading those two directories should not take a pixel diff between them
for a measurement.

## `inframe/` is the measurement

One run, one scene. During the ~5 s countdown after `NEW_ROUND` the cycles are
placed but stationary, so: crop, crop again 200 ms later, flip anisotropy on
every live texture with `AA_GLPROBE.setAniso(16)`, crop a third time. The middle
pair is the run's own **noise floor**.

    python3 docs/evidence/m5-texture/compare-aniso.py docs/evidence/m5-texture/inframe

| rect | size | A vs B (noise floor) | B vs C (anisotropy 1 → 16) |
|---|---|---|---|
| cycle | 576x417 | **0.00 %, max 0** | 9.35 % changed, 1.00 % by >8, max 109 |
| floor_far | 1440x250 | **0.00 %, max 0** | 27.07 % changed, 3.10 % by >8, max 31 |
| floor_mid | 1800x334 | **0.00 %, max 0** | 12.86 % changed, 2.24 % by >8, max 33 |
| wall_left | 1080x250 | **0.00 %, max 0** | 30.63 % changed, 0.36 % by >8, max 66 |

The floor is **bit-identical** across 200 ms with nothing changed, so every
changed pixel in the third column is the flip and nothing else.

Splitting the cycle crop by what is in it — the machine is the only saturated
thing, the grid is grey — separates the two surfaces the maintainer might mean:

| | pixels | changed | by >8 | mean |Δ| |
|---|---|---|---|---|
| cycle body + trail | 3,337 | 21.9 % | 13.1 % | 4.77 |
| floor/grid in the same crop | 236,855 | 9.2 % | 0.8 % | 0.42 |

`compare-cycle.png` (4x nearest-neighbour) and `compare-floor_far.png` are the
plates. The cycle's flank highlights are visibly better resolved with
anisotropy on, and the receding floor grid stays brighter further back.

## Frame-rate cost: none measurable

`fps-off/` and `fps-on/`, both at 3600x2086, driven by the **unmodified**
`web/tools/fps-resolution-probe.steps`:

| | median fps | worst whole second | frame_ms p50 | p90 | p99 |
|---|---|---|---|---|---|
| anisotropy 1 | 60 | 57 | 16.8 | 18.1 | 19.6 |
| anisotropy 16 | 60 | 58 | 16.7 | 17.9 | 19.2 |

Read this honestly: **p50 is pinned at the `MAX_FPS 60` cap in both**, so this
shows anisotropy does not eat the existing headroom — not that it is free. The
p90/p99 tails do not degrade either, and the bar is 30.

## The cycle's on-screen footprint

`AA_GLPROBE.cycleFootprint()` at 3600x2086: the machine is about **38 px wide**,
and machine plus trail cover **~3,300 saturated pixels**. Footprint scales with
the vertical resolution for a fixed camera, so the 1280x800 probe run showed it
at roughly an eighth of that area.

The camera is stock: `src/engine/eCamera.cpp` contains no `__EMSCRIPTEN__` guard,
`ePlayer.cpp` sets `startCamera = CAMERA_CUSTOM`, and the defaults are
`CAMERA_CUSTOM_BACK 30`, `CAMERA_CUSTOM_RISE 20`, `CAMERA_CUSTOM_ZOOM 0.5`. The
port has not moved the camera.
