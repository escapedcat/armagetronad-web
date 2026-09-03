#!/usr/bin/env python3
"""Where, and how wide, is the startup title picture on the screen?

    python3 docs/evidence/phone-round2/logo/moments.py <png> [<png> ...]

Prints, per image, the intensity-weighted centroid and standard deviation of
the picture's own blue content, AS FRACTIONS OF THE SCREEN. It is the same
quantity web/tools/logo-aspect-probe.steps computes inside the page; this
script exists so the committed screenshots can be re-measured without a
browser, and so the BEFORE images -- captured against the previous build,
which no longer exists in the tree -- stay comparable with the after ones.

THE WEIGHT IS BLUE DOMINANCE, max(0, B - max(R, G)). The animated menu grid
behind the title is grey, the menu text is red and white, and the touch overlay
is HTML rather than canvas, so all of them weigh exactly zero: what is left is
the blue lightcycle and the blue caption of textures/title.jpg.

WHY A MOMENT AND NOT A BOUNDING BOX. gLogo fades the quad in and out through
its alpha (sg_DisplayStatus), so a threshold measures the fade as much as the
shape. Scaling every weight by the same factor leaves a normalised central
moment unchanged, so this number does not care where in the fade it was taken.

READING IT. textures/title.jpg is 800x600. If the quad is not aspect-corrected
the picture covers the whole viewport and sx_frac is the same number at every
screen shape. If it is corrected, sx_frac on a screen wider than 4:3 falls by
(4/3)/aspect and cx moves toward 0.5 by the same pillarbox.
"""
import sys
from PIL import Image

print(f'{"image":58s} {"canvas":11s} {"aspect":>7s} {"cx":>8s} {"cy":>8s} {"sx_frac":>8s} {"sy_frac":>8s}')
for path in sys.argv[1:]:
    im = Image.open(path).convert('RGB')
    W, H = im.size
    px = im.load()
    s = sx = sy = sxx = syy = 0.0
    for j in range(H):
        for i in range(W):
            R, G, B = px[i, j]
            w = B - (R if R > G else G)
            if w <= 0:
                continue
            u, v = i / W, j / H
            s += w; sx += w * u; sy += w * v; sxx += w * u * u; syy += w * v * v
    if s <= 0:
        print(f'{path:58s} {W}x{H}  no blue content (sampled after the fade)')
        continue
    mx, my = sx / s, sy / s
    vx, vy = max(0.0, sxx / s - mx * mx), max(0.0, syy / s - my * my)
    print(f'{path:58s} {W}x{H:<6d} {W/H:7.4f} {mx:8.5f} {my:8.5f} '
          f'{vx**0.5:8.5f} {vy**0.5:8.5f}')
