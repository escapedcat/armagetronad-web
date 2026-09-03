#!/usr/bin/env python3
"""Turn the [PERF] lines the arms print into the early-vs-late table.

    python3 web/tools/perf/summarise.py docs/evidence/m6-lag/task1-rig

Reads <set-dir>/<arm>/console.log for each arm and prints, per measured round,
the frame-time p50 over the first five seconds and the last five and their
ratio -- and, beside it, the draw calls per frame over the same two windows
and THEIR ratio. THE RATIO IS THE POINT: the maintainer's report is "starting
smooth but the more i drive the laggier it gets", which a mean over a round
cannot show and a ratio can. The two ratios read together: both rising is the
renderer re-submitting a growing trail set (mechanism 1); ms rising while
draws stay flat is the simulation (mechanism 2). README.md spells this out.

Every number here is a frame time in milliseconds with MAX_FPS lifted to 1000,
so none of them is a frame rate anyone would see -- they are the COST per frame
with the limiter out of the way. They are this desktop's cost, CPU-throttled by
the rate in the `cpu` column, at a phone's pixel count; not a phone's. Round 1
is never in the table: it is where the tutorial is cleared and the throttle is
switched on. The `gate` column is check-arm.mjs's verdict; an INVALID row is
printed so the reader can see WHY it is not a number, not so it can be used.
"""
import sys, os, json, re, subprocess

root = sys.argv[1] if len(sys.argv) > 1 else 'docs/evidence/m6-lag/task1-rig'
HERE = os.path.dirname(os.path.abspath(__file__))
RESULT = re.compile(r' => ("(?:[^"\\]|\\.)*")\s*$')


def perf(log):
    """The LAST [PERF] object an eval: step returned, parsed from the quoted
    result that ends the driver's `eval ... => "..."` line (the eval's source
    text also contains "[PERF] ", so the line is never searched for it)."""
    d = None
    for line in open(log, encoding='utf-8', errors='replace'):
        if '[harness] eval ' not in line or '[PERF] ' not in line:
            continue
        m = RESULT.search(line.rstrip('\n'))
        if not m:
            continue
        try:
            s = json.loads(m.group(1))
        except ValueError:
            continue
        if isinstance(s, str) and s.startswith('[PERF] '):
            try:
                d = json.loads(s[s.index('{'):])
            except ValueError:
                pass
    return d


def gate(log):
    r = subprocess.run(['node', os.path.join(HERE, 'check-arm.mjs'), log],
                       capture_output=True, text=True)
    text = (r.stdout or r.stderr).strip()
    return text.split(':')[0] if text else 'INVALID', text


def num(x, w, p):
    return f'{x:{w}.{p}f}' if isinstance(x, (int, float)) else f'{"-":>{w}s}'


arms = [a for a in sorted(os.listdir(root))
        if os.path.isdir(os.path.join(root, a))]

print('round 1 (tutorial cleared, throttle switched on) is not measured and is not listed; '
      'early/late = first/last 5 s of the round; ms are frame COSTS at MAX_FPS 1000.')
print(f'{"arm":14s} {"rd":>2s} {"len_s":>5s} {"early_ms":>8s} {"late_ms":>7s} {"ratio_ms":>8s} '
      f'{"early_draws":>11s} {"late_draws":>10s} {"ratio_draws":>11s} {"late_kb":>7s} '
      f'{"hitches>50ms":>12s} {"cpu":>3s} {"gate":7s}')
for arm in arms:
    log = os.path.join(root, arm, 'console.log')
    if not os.path.exists(log):
        continue
    d = perf(log)
    if not d:
        print(f'{arm:14s} (no [PERF] line)')
        continue
    verdict, verdict_text = gate(log)
    rounds = [r for r in d['rounds'] if r['round'] >= 2]
    if not rounds:
        print(f'{arm:14s} (no measured round; {d["rounds_started"]} started, '
              f'{d["rounds_won"]} won)  {verdict}')
        continue
    for r in rounds:
        e, l = r['early_5s'], r['late_5s']
        print(f'{arm:14s} {r["round"]:2d} {num(r["length_s"], 5, 1)} '
              f'{num(e["ms_p50"], 8, 2)} {num(l["ms_p50"], 7, 2)} {num(r["ratio_ms"], 8, 2)} '
              f'{num(e["draws_per_frame"], 11, 1)} {num(l["draws_per_frame"], 10, 1)} '
              f'{num(r["ratio_draws"], 11, 2)} {num(l["kb_per_frame"], 7, 1)} '
              f'{r["hitches_over_50ms"]:12d} {d["cpu_rate"]:3g} {verdict:7s}')
    for r in rounds:
        ps = r['per_second']
        print(f'{"":14s}   round {r["round"]} per-second ms_p50:        {ps["ms_p50"]}')
        print(f'{"":14s}   round {r["round"]} per-second draws/frame:   {ps["draws_per_frame"]}')
        if 'raw_ms_max' in ps:
            print(f'{"":14s}   round {r["round"]} per-second raw_ms_max (screenshot hitches stay visible here, '
                  f'excluded from every statistic): {ps["raw_ms_max"]}')
        if r.get('shots'):
            print(f'{"":14s}   round {r["round"]} screenshots excluded: '
                  + ', '.join(f'{s["name"]} at {s["at_s"]} s ({s["dur_ms"]} ms)' for s in r['shots']))
    r1 = [r for r in d['rounds'] if r['round'] == 1]
    if r1 and r1[0]['per_second']['draws_per_frame']:
        print(f'{"":14s}   round 1 first-second draws/frame (idle tutorial arena, the floor '
              f'check-arm.mjs is calibrated from): {r1[0]["per_second"]["draws_per_frame"][0]}')
    print(f'{"":14s}   {verdict_text}')
