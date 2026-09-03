#!/usr/bin/env python3
"""Side-by-side anisotropy-off / anisotropy-on plates for a human to judge.

    python3 docs/evidence/m5-texture/make-comparison.py docs/evidence/m5-texture/inframe

Writes <run>/compare-<rect>.png: aniso off on the left, aniso on on the right,
and for the cycle a 4x nearest-neighbour zoom on the machine itself, because at
3600x2086 it is about 38x110 px and nothing can be judged from it at 1:1 on a
page. Nearest-neighbour, not smooth: a smooth upscale would invent exactly the
softness the comparison is about.
"""
import sys, os
import numpy as np
from PIL import Image, ImageDraw

def plate(run, rect, zoom=1, box=None, labels=("anisotropy 1 (shipped)", "anisotropy 16")):
    d = os.path.join(run, "textures")
    B = Image.open(os.path.join(d, f"crop-b-aniso-off-noise-floor__{rect}.png")).convert("RGB")
    C = Image.open(os.path.join(d, f"crop-c-aniso-on__{rect}.png")).convert("RGB")
    if box:
        B, C = B.crop(box), C.crop(box)
    if zoom > 1:
        sz = (B.width * zoom, B.height * zoom)
        B, C = B.resize(sz, Image.NEAREST), C.resize(sz, Image.NEAREST)
    pad, top = 12, 22
    out = Image.new("RGB", (B.width * 2 + pad * 3, B.height + top + pad), (24, 24, 28))
    out.paste(B, (pad, top)); out.paste(C, (pad * 2 + B.width, top))
    dr = ImageDraw.Draw(out)
    dr.text((pad, 6), labels[0], fill=(230, 230, 235))
    dr.text((pad * 2 + B.width, 6), labels[1], fill=(230, 230, 235))
    f = os.path.join(run, f"compare-{rect}.png")
    out.save(f)
    print(f"{f}  {out.width}x{out.height}")

def main(run):
    # Tight box on the machine, found from the saturated texels rather than
    # hard-coded, then padded so there is context around it.
    B = np.array(Image.open(os.path.join(run, "textures",
        "crop-b-aniso-off-noise-floor__cycle.png")).convert("RGB")).astype(int)
    m = (B.max(axis=2) - B.min(axis=2)) > 40
    ys, xs = np.nonzero(m)
    box = (max(0, xs.min() - 30), max(0, ys.min() - 20),
           min(B.shape[1], xs.max() + 31), min(B.shape[0], ys.max() + 21))
    plate(run, "cycle", zoom=4, box=box)
    for r in ("floor_far", "floor_mid", "wall_left"):
        plate(run, r)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docs/evidence/m5-texture/inframe")
