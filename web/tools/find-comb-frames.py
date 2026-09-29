#!/usr/bin/env python3
"""Find the one-frame "comb" artifact in a phone screen recording.

    python3 web/tools/find-comb-frames.py recording.mp4 [--crop W:H:X:Y]

WHAT IT LOOKS FOR. On an Android phone, single frames showed a comb of thin
lines in a wall's colour shooting from the wall to the edge of the screen
(docs/evidence/phone-wall-comb/). It lasts one or two frames, 17-33 ms, which
is too short to judge by eye: a bisect done by watching produced a "cure"
that later recordings disproved. This counts it from the recording instead.

HOW. Two stages, both over the part of the picture given by --crop:

 1. Blip score. Each frame is compared with the median of its two neighbours,
    so steady motion scores low and something present for ONE frame scores
    high. A candidate is a frame scoring >= 3.0 and >= 1.5 x both neighbours.
    Camera swings, explosions and banners also pass this; it only narrows.

 2. Anisotropy. For each candidate, the frame-minus-neighbours difference is
    measured for left-right against up-down gradient energy. A comb is many
    thin VERTICAL lines: strong left-right change, weak up-down. Explosions
    (radial lines) and turns (everything moves) change in both directions.

CALIBRATION, measured on the first recording (2026-09-29): the two known comb
frames scored anisotropy 2.69 and 2.61, and a later one 3.05. Across seven
recordings, nothing that was not a comb went above 1.51 (a candidate in that
same first recording); turns, menus and explosions sit around 0.4-1.3. The
threshold, 1.8, sits in that gap -- a margin of about 0.3 on the low side. Re-check it against a known comb before
trusting a result on a different phone or layout.

--crop defaults to the Game Boy layout in a 1080x2280 portrait recording,
below the band where the ?diag=1 readout box would sit (its text changing
every 500 ms would otherwise register as blips of its own).

Needs ffmpeg on PATH and numpy.
"""
import argparse
import subprocess
import sys

import numpy as np

BLIP_MIN = 3.0
BLIP_RATIO = 1.5
COMB_MIN = 1.8


def blip_scores(video, crop):
    """Per-frame mean difference from the median of each frame's neighbours."""
    w, h, x, y = crop.split(':')
    graph = (f"crop={w}:{h}:{x}:{y},scale=iw/2:ih/2,split[a][b];"
             "[b]tmedian=radius=1[m];[a][m]blend=all_mode=difference,signalstats,"
             "metadata=print:key=lavfi.signalstats.YAVG:file=-")
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-filter_complex', graph,
                          '-an', '-f', 'null', '-'], capture_output=True, text=True).stdout
    scores, t = [], None
    for line in out.splitlines():
        if 'pts_time:' in line:
            t = float(line.split('pts_time:')[1].split()[0])
        elif 'YAVG=' in line and t is not None:
            scores.append((t, float(line.split('=')[1])))
    return scores


def candidates(scores):
    for i in range(1, len(scores) - 1):
        s = scores[i][1]
        m = max(scores[i - 1][1], scores[i + 1][1])
        if s >= BLIP_MIN and s >= BLIP_RATIO * m:
            yield scores[i][0]


def frames_around(video, t, crop):
    w, h, x, y = crop.split(':')
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{max(0.0, t - 0.06):.3f}', '-i', video,
                          '-t', '0.12', '-vf', f'crop={w}:{h}:{x}:{y},scale=iw/2:ih/2,format=gray',
                          '-fps_mode', 'passthrough', '-f', 'image2pipe', '-vcodec', 'pgm', '-'],
                         capture_output=True).stdout
    frames, i = [], 0
    while i < len(raw):
        end = raw.index(b'255\n', i) + 4
        fw, fh = map(int, raw[i:end].split()[1:3])
        frames.append(np.frombuffer(raw[end:end + fw * fh], np.uint8).reshape(fh, fw).astype(np.float32))
        i = end + fw * fh
    return frames


def anisotropy(video, t, crop):
    f = frames_around(video, t, crop)
    if len(f) < 3:
        return None
    best = None
    for k in range(1, len(f) - 1):
        d = np.abs(f[k] - np.median(np.stack([f[k - 1], f[k + 1]]), axis=0))
        if best is None or d.mean() > best.mean():
            best = d
    gx = np.abs(np.diff(best, axis=1)).mean()
    gy = np.abs(np.diff(best, axis=0)).mean()
    return gx / (gy + 1e-6)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('video')
    ap.add_argument('--crop', default='1080:776:0:420',
                    help='ffmpeg crop W:H:X:Y of the part of the picture to examine')
    a = ap.parse_args()

    scores = blip_scores(a.video, a.crop)
    if not scores:
        sys.exit('no frames scored -- is ffmpeg on PATH, and does --crop fit the video?')
    cands = list(candidates(scores))
    combs, highest = [], []
    for t in cands:
        an = anisotropy(a.video, t, a.crop)
        if an is None:
            continue
        highest.append((an, t))
        if an >= COMB_MIN:
            combs.append((t, an))

    duration = scores[-1][0]
    print(f'{a.video}: {len(scores)} frames, {duration:.0f} s, {len(cands)} candidates')
    print(f'combs (anisotropy >= {COMB_MIN}): {len(combs)}')
    for t, an in combs:
        print(f'  {t:8.3f} s   anisotropy {an:.2f}')
    top = sorted(highest, reverse=True)[:3]
    print('highest anisotropy seen: ' + ', '.join(f'{an:.2f} at {t:.2f} s' for an, t in top))


if __name__ == '__main__':
    main()
