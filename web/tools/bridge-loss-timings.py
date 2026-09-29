#!/usr/bin/env python3
"""What packet loss costs, read off the two runs' transcripts.

    python3 web/tools/bridge-loss-timings.py <set-dir>

where <set-dir> holds clean/console.log and loss/console.log from
web/tools/run-bridge-loss-arm.sh.

WHAT IS AND IS NOT MEASURED HERE, stated first because it bounds every number
below. `bridge/relay.mjs --drop` discards datagrams at the RELAY, so what it
models is loss on the relay-to-server UDP leg. The browser-to-relay leg is a
WebSocket and was lossless throughout: WebSocket is TCP, so a datagram cannot
be lost there -- it can only be DELAYED, behind whatever segment is being
retransmitted. That head-of-line stall is the actual argument for WebTransport
and THIS MEASUREMENT DOES NOT CONTAIN IT. These numbers are therefore a lower
bound on what a lossy path costs a browser player, not the whole bill.

The timings are the driver's own elapsed-ms stamps (web/tools/drive-browser.mjs
`record`), and harness-written lines are excluded from every count for the same
reason the driver excludes them from `until:`: an `until:` step echoes the
string it is waiting for, so counting those would count the harness.
"""
import json, os, re, sys

STAMP = re.compile(r'^\[\s*(\d+)ms\] (.*)$')


def load(path):
    out = []
    for raw in open(path, errors='replace'):
        m = STAMP.match(raw.rstrip('\n'))
        if m:
            out.append((int(m.group(1)), m.group(2)))
    return out


def first_at(lines, needle, nth=1):
    n = 0
    for t, text in lines:
        if '[harness] ' in text:
            continue
        if needle in text:
            n += 1
            if n == nth:
                return t
    return None


def mark_at(lines, needle):
    for t, text in lines:
        if text.startswith('[harness] === ') and needle in text:
            return t
    return None


def gaps(lines):
    found = []
    for t, text in lines:
        if '[harness] ' in text:
            continue
        i = text.find('[BRIDGEGATE] GAPS ')
        if i >= 0:
            try:
                found.append(json.loads(text[i + len('[BRIDGEGATE] GAPS '):]))
            except ValueError:
                pass
    return found


def arm(path):
    lines = load(path)
    d = {'path': path, 'lines': len(lines)}
    d['connect'] = mark_at(lines, 'B2-ENTER-CONNECTS')
    for k, needle, nth in (('round1_start', '[L] NEW_ROUND', 1),
                           ('round2_start', '[L] NEW_ROUND', 2),
                           ('round3_start', '[L] NEW_ROUND', 3),
                           ('round1_scored', '[L] ROUND_SCORE_TEAM', 1),
                           ('round2_scored', '[L] ROUND_SCORE_TEAM', 2),
                           ('roster', '[L] TEAM_PLAYER_ADDED', 1),
                           ('bridge_open', '[BRIDGE] open', 1),
                           ('bridge_closed', '[BRIDGE] closed', 1)):
        d[k] = first_at(lines, needle, nth)
    d['gaps'] = gaps(lines)
    d['verdicts'] = {}
    for t, text in lines:
        if '[harness] ' in text:
            continue
        m = re.search(r'\[BRIDGEGATE\] (B\d) \S+ (\{.*\})', text)
        if m:
            try:
                d['verdicts'][m.group(1)] = json.loads(m.group(2)).get('PASS')
            except ValueError:
                pass
    return d


def ms(a, b):
    return None if a is None or b is None else (b - a) / 1000.0


def fmt(v, unit='s'):
    return 'n/a' if v is None else f'{v:.2f}{unit}'


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    base = sys.argv[1]
    arms = {}
    for a in ('clean', 'loss'):
        p = os.path.join(base, a, 'console.log')
        if not os.path.exists(p):
            sys.exit(f'no {a} arm at {p} -- run web/tools/run-bridge-loss-arm.sh for it')
        arms[a] = arm(p)

    print(__doc__.split('\n\n', 1)[1].strip())
    print()
    rows = [
        # NOT "connect -> socket opened": the socket is opened much earlier, by
        # the LAN walk, so that subtraction is negative and means nothing. What
        # is worth reading is HOW MUCH earlier, which says the connect reused a
        # socket rather than dialling one.
        ('the socket was already open this long before the connect',
         lambda d: ms(d['bridge_open'], d['connect'])),
        ('connect -> the server sent a roster', lambda d: ms(d['connect'], d['roster'])),
        ('connect -> round 1 started', lambda d: ms(d['connect'], d['round1_start'])),
        ('round 1 started -> round 1 scored', lambda d: ms(d['round1_start'], d['round1_scored'])),
        # ROUND_SCORE_TEAM and NEW_ROUND land in the same millisecond on this
        # build -- the score for the round that ended and the start of the next
        # arrive together -- so this row and the one above it are the same
        # number by construction. Both are printed because they are read for
        # different reasons and a reader who sees them differ has found a bug.
        ('round 1 -> round 2 (server cadence)', lambda d: ms(d['round1_start'], d['round2_start'])),
        ('round 2 -> round 3 (server cadence)', lambda d: ms(d['round2_start'], d['round3_start'])),
        ('connect -> round 2 scored (two full rounds)', lambda d: ms(d['connect'], d['round2_scored'])),
    ]
    w = max(len(r[0]) for r in rows)
    print(f'{"":<{w}}   {"clean":>10}   {"5% loss":>10}   delta')
    for label, f in rows:
        c, l = f(arms['clean']), f(arms['loss'])
        delta = 'n/a' if c is None or l is None else f'{l - c:+.2f}s ({(l / c - 1) * 100:+.0f}%)' if c else 'n/a'
        print(f'{label:<{w}}   {fmt(c):>10}   {fmt(l):>10}   {delta}')
    print()
    print('THE TAIL. Inter-arrival gaps between datagrams delivered to the page, in ms,')
    print('from the sampler installed on the live WebSocket. A mean would hide exactly')
    print('the thing loss does, so these are percentiles and a maximum.')
    for phase in ('through-B3', 'through-B4'):
        print(f'  phase {phase}:')
        for a in ('clean', 'loss'):
            g = [x for x in arms[a]['gaps'] if x.get('phase') == phase]
            if not g:
                print(f'    {a:<6}: not reported')
                continue
            g = g[-1]
            print(f'    {a:<6}: n={g["datagrams"]:<6} p50={g["p50"]:<8} p90={g["p90"]:<8} '
                  f'p99={g["p99"]:<8} max={g["max"]:<9} '
                  f'>100ms={g["over100ms"]} >250ms={g["over250ms"]} >500ms={g["over500ms"]}')
    print()
    for a in ('clean', 'loss'):
        v = arms[a]['verdicts']
        print(f'{a:<6} verdicts: ' + ', '.join(f'{k}={v[k]}' for k in sorted(v)) or 'none')
    bad = [f'{a}:{k}' for a in arms for k, p in arms[a]['verdicts'].items() if p is not True]
    if bad:
        print('\nFAILED VERDICTS: ' + ', '.join(bad))
        return 1
    if len(arms['clean']['verdicts']) < 6 or len(arms['loss']['verdicts']) < 6:
        print('\nNOT ALL VERDICTS WERE REACHED - a run stopped early, read its transcript')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
