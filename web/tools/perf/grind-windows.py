#!/usr/bin/env python3
"""Window statistics for grind arms, the M6 task-3 way: 'before' = round seconds
8-17 (throttled free driving), 'rim' = seconds 20-59 (held against the wall).
Reads the LAST [PERF] <arm> {...} that the harness echoes in <set>/<arm>/console.log.
Usage: grind-windows.py <set-dir> <arm> [<arm> ...]"""
import json, statistics, sys

def perf(path, arm):
    last = None
    for l in open(path):
        if '=> "[PERF] ' + arm + ' ' in l:
            last = l
    if last is None:
        raise SystemExit('no [PERF] ' + arm + ' in ' + path)
    s = json.loads(last[last.index('=> "') + 3:].strip())
    return json.loads(s[s.index('{'):])

def med(v):
    return statistics.median(v) if v else float('nan')

def window(ps, lo, hi, pred=lambda i: True):
    idx = [i for i in range(lo, min(hi + 1, len(ps['ms_p50']))) if pred(i)]
    out = {}
    for k in ('ms_p50', 'ms_to_first_draw_p50', 'ms_first_draw_to_swap_p50', 'draws_per_frame'):
        v = [ps[k][i] for i in idx]
        out[k] = (med(v), min(v) if v else None, max(v) if v else None)
    out['raw_ms_max'] = max(ps['raw_ms_max'][i] for i in idx) if idx else None
    out['secs'] = len(idx)
    return out

def fmt(w):
    m = w['ms_p50']; p = w['ms_to_first_draw_p50']; r = w['ms_first_draw_to_swap_p50']; d = w['draws_per_frame']
    return (f"{w['secs']:3d}s  ms {m[0]:5.2f} ({m[1]:.1f}-{m[2]:.1f})  pre {p[0]:4.1f}  ren {r[0]:4.1f}  "
            f"draws {d[0]:6.1f} ({d[1]:.0f}-{d[2]:.0f})  worst-frame {w['raw_ms_max']:.1f}")

setdir = sys.argv[1]
for arm in sys.argv[2:]:
    j = perf(f'{setdir}/{arm}/console.log', arm)
    r = j['rounds'][0]
    ps = r['per_second']
    n = len(ps['ms_p50'])
    death = r.get('human_death_s')
    print(f"== {arm}: cpu {j['cpu_rate']}x, frames {j['frames']}, round {r['round']} span "
          f"{r['measured_from_s']}-{r['measured_to_s']} s (death {death}), hitches>50ms {r['hitches_over_50ms']}, "
          f"per-second entries {n}")
    before = window(ps, 8, 17)
    rim = window(ps, 20, 59)
    rim_quiet = window(ps, 20, 59, lambda i: ps['draws_per_frame'][i] <= 70)
    sparking = sum(1 for i in range(20, min(60, n)) if ps['draws_per_frame'][i] >= 100)
    print('   before (free) ', fmt(before))
    print('   rim, all      ', fmt(rim))
    print('   rim, draws<=70', fmt(rim_quiet))
    print(f"   rim seconds with draws >= 100: {sparking} of {min(60, n) - 20};  rim-free = {rim['ms_p50'][0] - before['ms_p50'][0]:.2f} ms")
