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

Every number here is a frame interval in milliseconds with MAX_FPS lifted to
1000, so none of them is a frame rate anyone would see -- they are the COST per
frame with the limiter out of the way (README.md, "What a frame time contains":
throttled work, the glFinish wait, a fixed event-loop yield). They are this
desktop's cost, CPU-throttled by the rate in the `cpu` column, at a phone's
pixel count; not a phone's. Round 1 is never in the table: it is where the
tutorial is cleared and the throttle is switched on. `early` is the five seconds
from the first WORLD frame after NEW_ROUND (the overlay-only pre-round frames are
skipped and counted under each round), `late` the five seconds before the
human's death (ROUND_WINNER when the human outlives the round). The `gate`
column is check-arm.mjs's verdict; an INVALID row is printed so the reader can
see WHY it is not a number, not so it can be used.

Any further arguments beginning with `--` are passed to check-arm.mjs, so a set
that has to be judged in another mode says which:

    python3 web/tools/perf/summarise.py docs/evidence/m6-lag/task7-posttutorial --posttut
"""
import sys, os, json, re, subprocess

root = sys.argv[1] if len(sys.argv) > 1 else 'docs/evidence/m6-lag/task1-rig'
GATE_ARGS = [a for a in sys.argv[2:] if a.startswith('--')]
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
    r = subprocess.run(['node', os.path.join(HERE, 'check-arm.mjs')] + GATE_ARGS + [log],
                       capture_output=True, text=True)
    text = (r.stdout or r.stderr).strip()
    # check-arm.mjs names its mode on the first line before it judges anything,
    # so the verdict is the first line that IS one. (Taking text.split(':')[0]
    # printed "check-arm.mjs" in the gate column of every row of every set.)
    verdict = next((ln.split(':')[0] for ln in text.splitlines()
                    if ln.startswith('VALID') or ln.startswith('INVALID')), 'INVALID')
    return verdict, text


def num(x, w, p):
    return f'{x:{w}.{p}f}' if isinstance(x, (int, float)) else f'{"-":>{w}s}'


arms = [a for a in sorted(os.listdir(root))
        if os.path.isdir(os.path.join(root, a))]

print('round 1 (the two key presses sent, throttle switched on) is not measured and is not listed. '
      'early = 5 s from the first world frame after NEW_ROUND; late = 5 s before the human\'s death '
      '(ROUND_WINNER if none). ms are frame COSTS at MAX_FPS 1000; cpu = CDP throttle rate.')
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
    if d.get('swaps'):
        print(f'{"":14s}   swaps: finish {d["swaps"].get("finish")}, flush {d["swaps"].get("flush")} '
              f'(which of glFinish/glFlush ended the {d.get("frames")} sampled frames); human: {d.get("human")}')
    for r in rounds:
        ps = r['per_second']
        if r.get('measured_to_s') is not None:
            pr = r.get('pre_round') or {}
            print(f'{"":14s}   round {r["round"]} measured {r.get("measured_from_s")} s -> {r["measured_to_s"]} s '
                  f'(ends at {r.get("ends_at")}; human death at {r.get("human_death_s")} s); '
                  f'pre-round overlay-only frames skipped: {pr.get("frames")} at {pr.get("draws_per_frame")} draws/frame, '
                  f'{pr.get("ms_p50")} ms p50, split at {pr.get("split_at_draws")} draws')
            e, l = r['early_5s'], r['late_5s']
            print(f'{"":14s}   round {r["round"]} frame split p50 (in swap / to first draw / first draw to swap) ms: '
                  f'early {e.get("ms_in_swap_p50")} / {e.get("ms_to_first_draw_p50")} / {e.get("ms_first_draw_to_swap_p50")}; '
                  f'late {l.get("ms_in_swap_p50")} / {l.get("ms_to_first_draw_p50")} / {l.get("ms_first_draw_to_swap_p50")}; '
                  f'in-swap p90/max early {e.get("ms_in_swap_p90")}/{e.get("ms_in_swap_max")}, late {l.get("ms_in_swap_p90")}/{l.get("ms_in_swap_max")}')
        print(f'{"":14s}   round {r["round"]} per-second ms_p50:        {ps["ms_p50"]}')
        print(f'{"":14s}   round {r["round"]} per-second draws/frame:   {ps["draws_per_frame"]}')
        if 'ms_to_first_draw_p50' in ps:
            print(f'{"":14s}   round {r["round"]} per-second ms to first draw p50 (yield + input + simulation): {ps["ms_to_first_draw_p50"]}')
            print(f'{"":14s}   round {r["round"]} per-second ms first draw to swap p50 (render submission):    {ps["ms_first_draw_to_swap_p50"]}')
        if 'raw_ms_max' in ps:
            print(f'{"":14s}   round {r["round"]} per-second raw_ms_max (screenshot hitches stay visible here, '
                  f'excluded from every statistic): {ps["raw_ms_max"]}')
        if r.get('shots'):
            print(f'{"":14s}   round {r["round"]} screenshots excluded: '
                  + ', '.join(f'{s["name"]} at {s["at_s"]} s ({s["dur_ms"]} ms)' for s in r['shots']))
    r1 = [r for r in d['rounds'] if r['round'] == 1]
    if r1 and r1[0].get('pre_round'):
        pr = r1[0]['pre_round']
        print(f'{"":14s}   round 1 (setup) pre-round overlay-only frames: {pr.get("frames")} at '
              f'{pr.get("draws_per_frame")} draws/frame -- the no-geometry scene the floor is calibrated from')
    print(f'{"":14s}   {verdict_text}')
