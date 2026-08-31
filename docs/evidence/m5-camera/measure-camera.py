#!/usr/bin/env python3
"""
Measures the three signatures browser-runtime-notes.md section 11 recorded for
the broken (top-down) camera, so "the camera is fixed" is a number rather than
an impression. Run it over any two gate frames of the same step:

    python3 docs/evidence/m5-camera/measure-camera.py BEFORE.png AFTER.png

WHAT IT MEASURES, and why each one is the shape it is.

vertical_ridges
    THE CONVERGENCE TEST, inverted into something countable. A grid line that
    is exactly vertical on screen occupies one column for hundreds of rows; a
    grid line under a real perspective projection is slanted and occupies each
    column for only a few rows. So: mark every pixel that is a horizontal
    RIDGE -- brighter than the pixels two columns either side by more than
    THRESH -- and report, per column, the longest unbroken vertical run of
    them. `long` counts columns whose longest run is at least MINRUN.

    Ridge detection rather than plain brightness, because the arena rim wall
    and the sky are large BRIGHT areas that a brightness threshold would count
    and a ridge test ignores: they have no horizontal structure. That is the
    whole reason for the -2/+2 neighbour comparison.

    Broken camera: every vertical grid line scores, so `long` is in the tens.
    Working camera: only a line that happens to pass through the vanishing
    point stays vertical, plus the player's own wall when the camera is
    directly behind it. `long` collapses to 0-2.

centre_column_run
    Section 11's second signature: "a cycle's wall projects to a ONE-PIXEL
    VERTICAL LINE at x = 511 in a 1024-wide canvas". Reports the longest ridge
    run in columns 505..517 and the rows it spans. Looking straight down, the
    wall under the camera is a full-height line. With the camera behind the
    cycle the player's own wall is still near-vertical -- so this number does
    not go to zero, and a report that claimed it did would be wrong. What
    changes is its EXTENT: it stops at the cycle instead of running off the top
    of the frame, because there is now a horizon above it.

sky_band_luma
    Not one of section 11's three, added because it is the most direct
    consequence of the fix and the hardest to argue with: mean luma of rows
    100..250. Looking straight down there is no horizon and no sky, so the top
    of the frame is more floor. Once the camera looks along the ground that
    band holds sky and the arena rim.
"""
import sys
from PIL import Image

THRESH = 12      # ridge prominence, 0..255 luma
MINRUN = 300     # rows; ~40% of a 768-high frame
BAND   = (95, 768)   # skip the console text at the very top

def luma(im):
    px = im.convert('RGB').load()
    w, h = im.size
    return [[(px[x,y][0]*299 + px[x,y][1]*587 + px[x,y][2]*114)//1000
             for x in range(w)] for y in range(h)], w, h

def measure(path):
    im = Image.open(path)
    L, w, h = luma(im)
    y0, y1 = BAND[0], min(BAND[1], h)

    runs = [0]*w          # longest vertical ridge run per column
    for x in range(2, w-2):
        cur = best = 0
        for y in range(y0, y1):
            row = L[y]
            if row[x] - max(row[x-2], row[x+2]) > THRESH:
                cur += 1
                if cur > best:
                    best = cur
            else:
                cur = 0
        runs[x] = best

    long_cols = [x for x in range(w) if runs[x] >= MINRUN]

    # centre-column signature, columns 505..517
    c0, c1 = 505, min(518, w)
    cbest, cx, cy0, cy1 = 0, None, None, None
    for x in range(c0, c1):
        cur = 0; start = None
        for y in range(y0, y1):
            row = L[y]
            if row[x] - max(row[x-2], row[x+2]) > THRESH:
                if start is None: start = y
                cur += 1
                if cur > cbest:
                    cbest, cx, cy0, cy1 = cur, x, start, y
            else:
                cur = 0; start = None

    sky = [L[y][x] for y in range(100, min(251, h)) for x in range(0, w, 4)]
    return {
        'file': path,
        'size': f'{w}x{h}',
        'vertical_ridges_long': len(long_cols),
        'vertical_ridge_columns': long_cols[:40],
        'centre_column_run': cbest,
        'centre_column_x': cx,
        'centre_column_rows': None if cx is None else f'{cy0}..{cy1}',
        'sky_band_luma': round(sum(sky)/len(sky), 2),
    }

for p in sys.argv[1:]:
    r = measure(p)
    print(f"--- {r['file']}  ({r['size']})")
    print(f"    vertical_ridges_long (columns with a >= {MINRUN}-row vertical ridge) : {r['vertical_ridges_long']}")
    print(f"    columns                                                             : {r['vertical_ridge_columns']}")
    print(f"    centre_column_run (longest ridge in x=505..517)                     : {r['centre_column_run']} rows at x={r['centre_column_x']}, rows {r['centre_column_rows']}")
    print(f"    sky_band_luma (mean luma, rows 100..250)                            : {r['sky_band_luma']}")
