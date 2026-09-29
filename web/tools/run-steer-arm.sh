#!/bin/sh
# sh web/tools/run-steer-arm.sh <out-dir> <control|steer> [turn-interval-s] [window-s]
#
# Runs ONE arm of the steering differential. Read the long header of
# web/tools/bridge-steer-gate.steps.tmpl first; it says what is being measured
# and why. Run this from the repository root, once per arm, then compare the
# two server logs with web/tools/steer-differential.py.
#
# It needs the relay and the static server already up, and it starts its OWN
# container so that each arm gets a log with nothing but its own rounds in it:
#
#   node bridge/relay.mjs --port 8010 --allow-private > /tmp/relay-t4.log 2>&1 &
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-steer-arm.sh docs/evidence/m-a-bridge/task4/steer control
#   sh web/tools/run-steer-arm.sh docs/evidence/m-a-bridge/task4/steer steer 2.0
#   python3 web/tools/steer-differential.py docs/evidence/m-a-bridge/task4/steer
#
# NO --rm ON THE CONTAINER, DELIBERATELY. Task 3 lost a crashed server's log to
# it once: --rm deletes the corpse, and the log with it, exactly when the log
# is the only thing that would say why the run failed. This removes the
# previous container by name instead, so the last arm's corpse is always still
# there to read until the next arm starts.
#
# 127.0.0.1 AND NOT localhost IN ?bridge=. bridge/relay.mjs is IPv4-only; a
# browser that resolves localhost to ::1 first gets ECONNREFUSED and reports it
# as a WebSocket error, which reads exactly like a bridge defect and is not one.
set -e
OUT=$1; ARM=$2; IVAL=${3:-2.0}; WINDOW=${4:-180}
case $ARM in control|steer) ;; *) echo "arm must be control or steer, got '$ARM'" >&2; exit 2;; esac
[ -n "$OUT" ] || { echo "usage: $0 <out-dir> <control|steer> [turn-interval-s] [window-s]" >&2; exit 2; }
ROOT=$(pwd)
[ -f "$ROOT/web/tools/bridge-steer-gate.steps.tmpl" ] || { echo "run me from the repository root" >&2; exit 2; }
D="$OUT/$ARM"; mkdir -p "$D"

pgrep -f 'relay.mjs --port 8010' >/dev/null || { echo "no relay on 8010" >&2; exit 2; }
pgrep -f 'http.server 8008' >/dev/null || { echo "no static server on 8008" >&2; exit 2; }

# ---- the steps file for this arm ---------------------------------------
# Substituted in python3 rather than sed or awk on purpose: the template's body
# is full of lines that start with # and full of & and \ inside the eval:
# one-liners, and both of those have bitten this repo's shell preprocessors.
AA_ARM=$ARM AA_IVAL=$IVAL AA_WINDOW=$WINDOW python3 - "$ROOT/web/tools/bridge-steer-gate.steps.tmpl" "$D/steps.txt" <<'PY'
import os, sys
arm, ival, window = os.environ['AA_ARM'], float(os.environ['AA_IVAL']), float(os.environ['AA_WINDOW'])
tmpl, out = sys.argv[1], sys.argv[2]

# A `key:` step costs the driver 30 ms of key-down plus a 300 ms settle
# (web/tools/drive-browser.mjs, case 'key'), so a turn every IVAL seconds is a
# key step plus a wait of IVAL minus that 0.33 s. Both arms must hold the
# window open for the SAME length of time or the round counts are not
# comparable, so the control's waits are built from the same arithmetic.
KEY_COST = 0.33
lines = []
if arm == 'control':
    # NOTHING IS PRESSED. Three 60 s waits rather than one 180 s wait only so
    # that there are screenshots through the window; no step here can reach the
    # game.
    n = max(1, int(round(window / 60.0)))
    per = window / n
    for i in range(n):
        lines.append('wait:%d' % int(per * 1000))
        lines.append('shot:i%d-control-no-key-pressed-%ds' % (i + 1, int(per * (i + 1))))
else:
    # ALWAYS THE SAME DIRECTION. Same-direction turns at a fixed interval trace
    # a polygon, which keeps the cycle inside the arena for several sides
    # before it closes onto its own wall; alternating Left/Right traces a
    # staircase that drifts straight into a rim, which is the thing being
    # beaten. The interval is not tuned to the arena because it does not have
    # to be: the window spans many rounds, each round starts at a different
    # phase of this schedule, and the verdict takes the BEST round -- one round
    # that outlives the control bound is the whole claim.
    gap = ival - KEY_COST
    if gap <= 0:
        sys.exit('turn interval must exceed %.2fs, the cost of a key step' % KEY_COST)
    turns = int(window // ival)
    shot_every = max(1, turns // 3)
    for i in range(turns):
        lines.append('key:Left')
        lines.append('wait:%d' % int(gap * 1000))
        if (i + 1) % shot_every == 0 and (i + 1) < turns:
            lines.append('shot:i%d-steer-after-%d-left-turns' % ((i + 1) // shot_every, i + 1))

# The input marker is substituted ONLY on a line that consists of nothing but
# the marker. Substituting it anywhere it appears also hits any comment that
# names it, which drops the input program into the middle of a comment
# paragraph and breaks the leading # of the line after it -- measured, and the
# driver's complaint was a screenshot failure many steps away from the cause.
src = open(tmpl).read().replace('@@ARM@@', arm)
out_lines = []
substituted = 0
for line in src.split('\n'):
    if line.strip() == '@@INPUT@@':
        out_lines.extend(lines)
        substituted += 1
    else:
        out_lines.append(line)
if substituted != 1:
    sys.exit('the template must contain exactly one line that is only the input marker, found %d' % substituted)
text = '\n'.join(out_lines)
open(out, 'w').write(text)
body = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith('#')]
keys = [l for l in body if l.startswith('key:Left')]
print('steps: %d body steps, %d key:Left, window %.0fs, interval %.2fs' % (len(body), len(keys), window, ival))
if arm == 'control' and keys:
    sys.exit('THE CONTROL ARM MUST PRESS NO STEERING KEY. Refusing.')
if arm == 'steer' and not keys:
    sys.exit('THE STEERING ARM PRESSED NOTHING. Refusing.')
# EVERY BODY LINE MUST BE A STEP THE DRIVER KNOWS. This is the tripwire that
# catches a substitution landing somewhere it should not have: a comment that
# stopped being a comment reaches the driver as a step, and the driver's
# complaint about it points at whatever step it happened to break, not at the
# substitution. Checked here, against drive-browser.mjs's own verb list.
VERBS = ('mark:', 'wait:', 'shot:', 'key:', 'eval:', 'until:', 'click:', 'tap:', 'metrics:', 'cpu:')
bad = [l for l in body if not l.startswith(VERBS)]
if bad:
    sys.exit('these generated lines are not driver steps:\n  ' + '\n  '.join(bad[:5]))
# And the control's window must contain no key step at all -- scoped to the
# window, because the menu walk that reaches the server is the same in both
# arms and is nothing but Enter, Down and Escape.
lo = [i for i, l in enumerate(body) if l.startswith('mark:WINDOW-OPEN')]
hi = [i for i, l in enumerate(body) if l.startswith('mark:WINDOW-CLOSE')]
if len(lo) != 1 or len(hi) != 1 or hi[0] < lo[0]:
    sys.exit('the generated steps must open and close exactly one measurement window')
win = body[lo[0] + 1:hi[0]]
if arm == 'control' and any(l.startswith('key:') for l in win):
    sys.exit('THE CONTROL ARM MUST PRESS NO KEY INSIDE ITS WINDOW. Refusing.')
if arm == 'steer' and not any(l.startswith('key:') for l in win):
    sys.exit('THE STEERING ARM PRESSED NOTHING INSIDE ITS WINDOW. Refusing.')
print('window: %d steps, %d of them key presses' % (len(win), len([l for l in win if l.startswith('key:')])))
PY

# ---- a fresh server, its own log --------------------------------------
docker rm -f aa-server >/dev/null 2>&1 || true
docker run -d --name aa-server -p 4534:4534/udp \
  -v "$ROOT/bridge/test-server/steer-var:/steervar" aa-dedicated \
  /opt/aa/bin/armagetronad-dedicated --userdatadir /data --vardir /steervar >/dev/null
sleep 5
[ "$(docker inspect -f '{{.State.Status}}' aa-server)" = running ] || { echo "the server did not stay up" >&2; docker logs aa-server; exit 1; }
docker logs aa-server 2>&1 | grep -q '^\[L\]' || { echo "the server is not writing [L] lines: the var-dir config did not load" >&2; exit 1; }
: > /tmp/relay-t4.log

echo "--- arm $ARM: driving ---"
node web/tools/drive-browser.mjs --headed --out "$D" \
  --url "http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010" \
  --script-file "$D/steps.txt" > "$D/driver.txt" 2>&1 || echo "(driver exited non-zero, see $D/driver.txt)"

docker logs aa-server > "$D/server.log" 2>&1
cp /tmp/relay-t4.log "$D/relay.log" 2>/dev/null || true
echo "--- arm $ARM done: $D ---"
grep -c '^\[L\] NEW_ROUND' "$D/server.log" | sed 's/^/server-side NEW_ROUND lines: /'
grep -cE '^\[L\] DEATH_(SUICIDE|FRAG|TEAMKILL)' "$D/server.log" | sed 's/^/server-side DEATH lines: /'
