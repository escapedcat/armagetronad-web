#!/usr/bin/env python3
# Consecutive-frame statistics for the turn burst, because a one-frame artifact
# is not something to eyeball across six 1024x768 PNGs.
#
# Two columns matter. "mean" is the whole frame; "top20% mean" is the top fifth
# of the image, which in a working perspective view contains the sky/ceiling
# band and in a TOP-DOWN view does not -- so a single frame rendered top-down
# (the failure mode a degenerate gluLookAt would produce, per §11) shows up
# there as an outlier even when the whole-frame mean barely moves.
#
#   python3 docs/evidence/m5-deploy/turn-flicker/frame-stats.py [dir]
import sys, glob, os
from PIL import Image
import numpy as np

d = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
files = sorted(glob.glob(os.path.join(d, '2*.png')))
prev = None
print(f"{'file':28} {'mean':>7} {'top20% mean':>12} {'diff vs prev':>13}")
for f in files:
    a = np.asarray(Image.open(f).convert('RGB'), dtype=np.float32)
    top = a[:int(a.shape[0] * 0.20)]
    diff = float(np.abs(a - prev).mean()) if prev is not None else float('nan')
    print(f"{os.path.basename(f):28} {a.mean():7.2f} {top.mean():12.2f} {diff:13.2f}")
    prev = a
