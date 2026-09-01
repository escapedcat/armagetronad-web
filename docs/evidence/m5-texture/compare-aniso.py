#!/usr/bin/env python3
"""Signal vs noise floor for the mid-run anisotropy flip.

    python3 docs/evidence/m5-texture/compare-aniso.py docs/evidence/m5-texture/inframe

A = aniso off, B = aniso off 200 ms later, C = aniso on 200 ms after that.
|A-B| is what this run's own scene drift costs; |B-C| is the flip. A signal that
does not clear the floor is not a signal.
"""
import sys, os
import numpy as np
from PIL import Image

RECTS = ["cycle", "floor_far", "floor_mid", "wall_left"]
GENS = {"A": "crop-a-aniso-off", "B": "crop-b-aniso-off-noise-floor", "C": "crop-c-aniso-on"}


def load(run, gen, rect):
    return np.array(Image.open(os.path.join(run, "textures", f"{GENS[gen]}__{rect}.png"))
                    .convert("RGB")).astype(int)


def stats(a, b):
    d = np.abs(a - b)
    m = d.max(axis=2)
    return dict(changed_pct=100 * (m > 0).mean(), over8_pct=100 * (m > 8).mean(),
                mean=d.mean(), mx=int(d.max()))


def main(run):
    print(f"{'rect':11} {'size':>11} | {'A vs B  (noise floor)':^34} | {'B vs C  (anisotropy 1 -> 16)':^34}")
    print(f"{'':11} {'':>11} | {'changed':>8} {'>8':>7} {'mean':>8} {'max':>6} | "
          f"{'changed':>8} {'>8':>7} {'mean':>8} {'max':>6}")
    print("-" * 104)
    for r in RECTS:
        A, B, C = (load(run, g, r) for g in "ABC")
        n, s = stats(A, B), stats(B, C)
        print(f"{r:11} {f'{A.shape[1]}x{A.shape[0]}':>11} | "
              f"{n['changed_pct']:7.2f}% {n['over8_pct']:6.2f}% {n['mean']:8.3f} {n['mx']:6d} | "
              f"{s['changed_pct']:7.2f}% {s['over8_pct']:6.2f}% {s['mean']:8.3f} {s['mx']:6d}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "docs/evidence/m5-texture/inframe")
