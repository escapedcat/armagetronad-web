#!/usr/bin/env python3
"""Decide, from the SERVER's own log, whether a steering keypress reached it.

    python3 web/tools/steer-differential.py <set-dir>

where <set-dir> holds control/server.log and steer/server.log, each produced by
web/tools/run-steer-arm.sh. Read the header of
web/tools/bridge-steer-gate.steps.tmpl for what is being measured and why.

THE OBSERVABLE is how long, in SERVER game-seconds, the server's copy of the
browser player's cycle stayed alive. It is read off the server's own console:
bridge/test-server/steer-var/autoexec.cfg sets LADDERLOG_GAME_TIME_INTERVAL, so
gGame::GameLoop writes `[L] GAME_TIME <t>` every 0.25 s with se_GameTime() --
the server's simulation clock, reset each round (src/tron/gGame.cpp:4340) -- and
CONSOLE_LADDER_LOG puts both that and the `[L] DEATH_*` lines on stdout
(src/engine/ePlayer.cpp:6181). The value on the last GAME_TIME line before the
player's DEATH line is therefore the server's own reading of how long it kept
that cycle alive, to a quarter second.

WHY THE COMPARISON IS PROOF. The same config empties the arena of AIs, so the
only things that can kill the one cycle in it are the rim and its own wall. A
cycle that never turns drives straight from its spawn to the rim and dies
there, after an interval fixed by the arena and the cycle's speed; the control
arm measures that interval over every round it gets, so its spread is a reading
and not an assumption. For the SERVER's clock to record a longer life in the
steering arm, the SERVER's cycle must have turned -- and the only thing that
turns it is a turn command arriving over the socket. What the browser was
drawing on its own screen cannot enter this number.
"""
import re, sys, os

GAME_TIME = re.compile(r'^\[L\] GAME_TIME\s+(-?[\d.]+)')
DEATH     = re.compile(r'^\[L\] (DEATH_SUICIDE|DEATH_FRAG|DEATH_TEAMKILL)\s+(\S+)')
NEW_ROUND = re.compile(r'^\[L\] NEW_ROUND')
GO        = re.compile(r'^\[0\] Go \(round (\d+) of')
WALL      = re.compile(r'^\[0\] Time:\s+([\d.]+) seconds')
RECV      = re.compile(r'^Received:\s+(\d+) bytes in (\d+) packets')
ENTERED   = re.compile(r'^\[L\] PLAYER_ENTERED\s+(\S+)')
# THE PREFIX IS [N], NOT [0]. The dedicated server's console decorates each
# line with the owner id of whatever produced it, and a join is announced by
# the joining client's own id: `[1] web_user entered the game.`, not `[0]`.
# The first cut of this file anchored on [0] and so matched nothing, which
# made the "more than one cycle in the arena" guard below unable to fire -- it
# reported an empty player list for a run that plainly had a player in it.
# Proved fixed by running this file against a server log from the SHIPPED
# config, which has three AIs in it: see
# docs/evidence/m-a-bridge/task4/prove-steer-guard-can-fail.log.
AI_JOIN   = re.compile(r'^\[\d+\] (\S+) entered the game\.')


def parse(path):
    """-> dict with per-round survivals and the server's own traffic counters."""
    rounds = []          # [{'round': n, 'survival': t, 'bracket': (lo, hi), 'cause': str}]
    wall = []            # the server's per-round `Time: N seconds`
    recv_bytes = recv_pkts = 0
    cur = None           # the round being accumulated
    last_gt = None
    humans, joins = set(), []
    for raw in open(path, errors='replace'):
        line = raw.rstrip('\n')
        m = GO.match(line)
        if m:
            cur = {'round': int(m.group(1)), 'survival': None, 'bracket': None, 'cause': None}
            rounds.append(cur)
            last_gt = None
            continue
        if NEW_ROUND.match(line) and cur is None:
            cur = {'round': 0, 'survival': None, 'bracket': None, 'cause': None}
            rounds.append(cur)
            last_gt = None
            continue
        m = GAME_TIME.match(line)
        if m:
            t = float(m.group(1))
            if cur is not None and cur['survival'] is not None and cur['bracket'][1] is None:
                cur['bracket'] = (cur['bracket'][0], t)   # first reading AFTER the death
            last_gt = t
            continue
        m = DEATH.match(line)
        if m and cur is not None and cur['survival'] is None:
            cur['cause'] = m.group(1)
            cur['who'] = m.group(2)
            cur['survival'] = last_gt
            cur['bracket'] = (last_gt, None)
            continue
        m = WALL.match(line)
        if m:
            wall.append(float(m.group(1)))
            continue
        m = RECV.match(line)
        if m:
            recv_bytes += int(m.group(1)); recv_pkts += int(m.group(2))
            continue
        m = ENTERED.match(line)
        if m:
            humans.add(m.group(1)); continue
        m = AI_JOIN.match(line)
        if m:
            joins.append(m.group(1)); continue
    return {'rounds': rounds, 'wall': wall, 'recv_bytes': recv_bytes,
            'recv_pkts': recv_pkts, 'humans': sorted(humans), 'joins': joins,
            'path': path}


def report(name, d):
    done = [r for r in d['rounds'] if r['survival'] is not None]
    print(f"--- arm {name}  ({d['path']})")
    print(f"    players the server logged entering: {d['joins']}")
    print(f"    rounds the server started: {len(d['rounds'])}, with a logged death: {len(done)}")
    for r in done:
        lo, hi = r['bracket']
        hi_s = 'no later reading' if hi is None else f'{hi:.2f}'
        print(f"      round {r['round']:>3}: died at server game-time {r['survival']:>7.2f}s "
              f"(bracketed {lo:.2f}..{hi_s})  {r['cause']} {r.get('who')}")
    if d['wall']:
        print(f"    the server's own per-round Time: lines: "
              + ', '.join(f'{w:.1f}s' for w in d['wall']))
    print(f"    the server received {d['recv_bytes']} bytes in {d['recv_pkts']} packets "
          f"across the rounds it reported")
    return [r['survival'] for r in done]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    base = sys.argv[1]
    paths = {a: os.path.join(base, a, 'server.log') for a in ('control', 'steer')}
    for a, p in paths.items():
        if not os.path.exists(p):
            sys.exit(f'no {a} arm at {p} -- run web/tools/run-steer-arm.sh for it')
    data = {a: parse(p) for a, p in paths.items()}

    print('=' * 78)
    print('THE STEERING DIFFERENTIAL, decided from the server\'s own log')
    print('=' * 78)
    surv = {a: report(a, data[a]) for a in ('control', 'steer')}
    print()

    problems = []
    for a in ('control', 'steer'):
        if not surv[a]:
            problems.append(f'the {a} arm produced no round with a logged death, so there is '
                            f'nothing to compare; the run did not happen')
        if data[a]['joins'] and len(data[a]['joins']) > 1:
            problems.append(f'the {a} arm had more than one cycle in the arena '
                            f'({data[a]["joins"]}); an AI wall can end a round early and the '
                            f'rim bound stops meaning anything')
    if problems:
        print('THIS COMPARISON CANNOT BE MADE:')
        for p in problems:
            print('  - ' + p)
        print('\nVERDICT: INVALID')
        return 2

    c_max, c_min = max(surv['control']), min(surv['control'])
    s_max = max(surv['steer'])
    # A ROUND THAT DIED EARLY IS PROOF TOO, AND IT IS THE STRONGER HALF.
    # The arena holds one cycle and two things that can kill it: the rim, at a
    # fixed distance from the spawn, and its own wall, which is behind it. A
    # cycle that goes straight therefore CANNOT die before it reaches the rim,
    # and the control arm measured when that is. So a steering round that ended
    # sooner than the control's fastest round is a cycle that left the straight
    # line -- it turned into something.
    #
    # This closes the one alternative reading of "survived longer" on its own:
    # a key bound to the BRAKE rather than to a turn would also extend the
    # server's clock, by slowing the cycle's approach to the rim. Braking
    # cannot make it die sooner. An early death can only be a direction change.
    early = [t for t in surv['steer'] if t < c_min]
    # The margin is stated rather than tuned: the reading is quantised to the
    # 0.25 s GAME_TIME interval, so anything under 0.5 s could be quantisation,
    # and 20 % of the control bound is well outside the control's own spread.
    margin = max(0.5, 0.20 * c_max)
    beat = s_max - c_max
    print(f'control: {len(surv["control"])} rounds, survival {c_min:.2f}s..{c_max:.2f}s '
          f'(spread {c_max - c_min:.2f}s)  <- the no-steer bound, MEASURED')
    print(f'steer  : {len(surv["steer"])} rounds, best survival {s_max:.2f}s')
    print(f'the steering arm beat the no-steer bound by {beat:+.2f}s '
          f'(required: more than {margin:.2f}s)')
    rb = {a: data[a]["recv_bytes"] for a in ('control', 'steer')}
    print(f'corroboration, the server\'s own byte counters: it received '
          f'{rb["control"]} bytes in the control arm and {rb["steer"]} in the steering arm')
    print(f'and {len(early)} of its {len(surv["steer"])} rounds ended SOONER than the '
          f'control\'s fastest ({c_min:.2f}s): '
          + (', '.join(f'{t:.2f}s' for t in early) if early else 'none'))
    ok = beat > margin and len(early) > 0
    print()
    if ok:
        print('VERDICT: A STEERING KEYPRESS REACHED THE SERVER, ON TWO INDEPENDENT COUNTS.')
        print('  1. The server kept the cycle alive for longer than a cycle that never turns')
        print('     can survive in this arena -- a bound the control arm measured with no key')
        print('     pressed at all. The server simulates that cycle, so the extra life is the')
        print('     server\'s cycle having turned.')
        print('  2. And some rounds ended SOONER than the control\'s fastest. Nothing else is')
        print('     in the arena: a cycle going straight cannot reach a wall before the rim,')
        print('     so an early death is a direction change. This is what rules out the key')
        print('     having been bound to the brake, which could only ever delay the rim.')
    else:
        print('VERDICT: NOT PROVEN.')
        if beat <= margin:
            print('  The steering arm did not outlive the no-steer bound by enough to rule')
            print('  out the cycle having gone straight.')
        if not early:
            print('  And no round ended sooner than the control\'s fastest, so a key bound to')
            print('  the brake rather than to a turn is not excluded.')
        print('  That is either an input that never arrived or a steering program that did')
        print('  not exercise the arena; the per-round table above says which, and neither')
        print('  may be reported as a pass.')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
