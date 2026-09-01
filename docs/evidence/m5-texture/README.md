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
