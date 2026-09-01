#!/usr/bin/env python3
"""Do the texels the browser UPLOADED match a libpng decode of the shipped PNG?

    python3 docs/evidence/m5-texture/compare-uploaded-texels.py docs/evidence/m5-texture/run-chrome

This is the test that decides whether the maintainer's "the native game looks
somewhat clearer" can be a DECODE difference. Emscripten's SDL does not use
libpng for IMG_Load: libsdl.js's IMG_Load_RW takes the browser-decoded image out
of Browser.preloadedImages, drawImage()s it onto a 2D canvas, and SDL_LockSurface
then getImageData()s it back. A 2D canvas stores premultiplied alpha, so that
round trip is lossy for every texel with alpha < 255 -- which native libpng's
path is not. This measures how much is actually lost, on the game's own texels.

WHAT IS COMPARED. gTextureCycle::ProcessImage (src/tron/gCycle.cpp) rewrites the
cycle textures in place before upload:

    px = (alpha*px + (255-alpha)*C) >> 8   per channel, then alpha := 255

with C the player colour. So the prediction for texel i is computable from the
shipped PNG alone once C is known, and C is recovered from the texels where
alpha == 0, at which the expression collapses to (255*C) >> 8. Textures with no
fully transparent texel (cycle_wheel.png's alpha floor is 58) fall back to
choosing the C that minimises total absolute error.

ORIENTATION. The dumps are read back with glReadPixels from a framebuffer, whose
row 0 is the BOTTOM of the image, and the probe's dump() flips into image order
before encoding the PNG -- so a dump is upside down with respect to the source
file. Rather than hard-code that, the script tries all four flips and keeps the
one where the alpha==0 texels agree on a single value per channel, which only
the correct alignment can produce. If no alignment is consistent, it says so
instead of quietly reporting a bogus C.
"""
import sys, os
import numpy as np
from PIL import Image

PAIRS = [("tex-08", "cycle_body"), ("tex-10", "cycle_body"),
         ("tex-12", "cycle_body"), ("tex-14", "cycle_body"),
         ("tex-09", "cycle_wheel"), ("tex-11", "cycle_wheel"),
         ("tex-13", "cycle_wheel"), ("tex-15", "cycle_wheel")]


def align(d0, a):
    """Pick the flip under which every alpha==0 texel maps to one dump value."""
    z = a == 0
    for name, d in (("as-dumped", d0), ("vflip", d0[::-1]),
                    ("hflip", d0[:, ::-1]), ("both", d0[::-1, ::-1])):
        if z.sum() and all(len(np.unique(d[:, :, c][z])) == 1 for c in range(3)):
            return name, d
    return (None, d0[::-1])   # no alpha==0 texels to align on; assume vflip


def main(run):
    src_root = os.path.join(os.path.dirname(__file__), "..", "..", "..", "textures")
    print(f"{'dump':8} {'source':16} {'align':10} {'C':>16} {'mismatched':>12} {'of':>9}  max|d|")
    print("-" * 84)
    worst = 0
    for dump, src in PAIRS:
        p = os.path.join(run, "textures", dump + ".png")
        if not os.path.exists(p):
            print(f"{dump:8} (absent)"); continue
        d0 = np.array(Image.open(p).convert("RGBA")).astype(int)
        s = np.array(Image.open(os.path.join(src_root, src + ".png")).convert("RGBA")).astype(int)
        gray, a = s[:, :, 0], s[:, :, 3]
        how, d = align(d0, a)
        C = []
        for c in range(3):
            if (a == 0).sum():
                v = int(np.unique(d[:, :, c][a == 0])[0])
                cand = [k for k in range(256) if (255 * k) >> 8 == v]
                C.append(cand[-1])
            else:
                C.append(min(((int(np.abs(d[:, :, c] - ((a * gray + (255 - a) * k) >> 8)).sum()), k)
                              for k in range(256)))[1])
        nz, mx = 0, 0
        for c in range(3):
            diff = d[:, :, c] - ((a * gray + (255 - a) * C[c]) >> 8)
            nz += int((diff != 0).sum()); mx = max(mx, int(np.abs(diff).max()))
        worst = max(worst, mx)
        print(f"{dump:8} {src+'.png':16} {str(how):10} {str(tuple(C)):>16} "
              f"{nz:>12} {3*a.size:>9}  {mx}")
    print()
    print(f"largest per-channel deviation anywhere: {worst} of 255")
    print("0 == the upload is bit-identical to a libpng decode put through ProcessImage.")
    print("1 == the premultiplied-alpha round trip in the canvas decode, and nothing else.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docs/evidence/m5-texture/run-chrome")
