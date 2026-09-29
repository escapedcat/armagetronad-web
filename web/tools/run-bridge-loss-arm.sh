#!/bin/sh
# sh web/tools/run-bridge-loss-arm.sh <out-dir> <clean|loss> [drop-fraction]
#
# Runs the whole of web/tools/bridge-gate.steps once, against a relay that is
# either clean or discarding datagrams, and collects both ends' logs. Run it
# from the repository root, once per arm:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-bridge-loss-arm.sh docs/evidence/m-a-bridge/task4/loss clean
#   sh web/tools/run-bridge-loss-arm.sh docs/evidence/m-a-bridge/task4/loss loss 0.05
#   python3 web/tools/bridge-loss-timings.py docs/evidence/m-a-bridge/task4/loss
#
# IT STARTS AND KILLS THE RELAY ITSELF, because B5 at the end of the gate needs
# the relay to die mid-round and the gate cannot kill it from inside the page.
# So do NOT have your own relay on 8010 when you run this; it will be replaced.
#
# THE KILL IS TIMED OFF THE TRANSCRIPT, NOT OFF A STOPWATCH. B5's wait opens at
# an unpredictable wall-clock moment -- it is after however long two rounds took
# under whatever loss is set -- so a fixed sleep would land in the wrong place
# and the difference between "killed mid-round" and "killed at a menu" is the
# whole test. The watcher below waits for B5's own mark to appear in the
# driver's transcript and then kills the relay four seconds into B5's window.
set -e
OUT=$1; ARM=$2; DROP=${3:-0.05}
case $ARM in clean) DROP=0 ;; loss) ;; *) echo "arm must be clean or loss, got '$ARM'" >&2; exit 2;; esac
[ -n "$OUT" ] || { echo "usage: $0 <out-dir> <clean|loss> [drop-fraction]" >&2; exit 2; }
ROOT=$(pwd)
[ -f "$ROOT/web/tools/bridge-gate.steps" ] || { echo "run me from the repository root" >&2; exit 2; }
pgrep -f 'http.server 8008' >/dev/null || { echo "no static server on 8008" >&2; exit 2; }
D="$OUT/$ARM"; mkdir -p "$D"
rm -f "$D/console.log"

# ---- a fresh server, its own log. THE SHIPPED CONFIG, not steer-var: B2..B4
# are Task 3's gates and were written against the server as it ships, AIs and
# all. Mounting the steering config here would change what a "round" is and
# make the two tasks' numbers incomparable.
docker rm -f aa-server >/dev/null 2>&1 || true
docker run -d --name aa-server -p 4534:4534/udp aa-dedicated >/dev/null
sleep 5
[ "$(docker inspect -f '{{.State.Status}}' aa-server)" = running ] || { echo "the server did not stay up" >&2; docker logs aa-server; exit 1; }

# ---- the relay for this arm ------------------------------------------
pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true
sleep 1
if [ "$ARM" = loss ]; then
  nohup node bridge/relay.mjs --port 8010 --allow-private --drop "$DROP" > "$D/relay.log" 2>&1 &
else
  nohup node bridge/relay.mjs --port 8010 --allow-private > "$D/relay.log" 2>&1 &
fi
sleep 2
grep -q 'listening on ws://127.0.0.1:8010' "$D/relay.log" || { echo "the relay did not come up" >&2; cat "$D/relay.log"; exit 1; }
if [ "$ARM" = loss ]; then
  grep -q 'DISCARDING' "$D/relay.log" || { echo "the loss arm's relay is not discarding anything" >&2; cat "$D/relay.log"; exit 1; }
fi
echo "relay: $(head -1 "$D/relay.log")"

# ---- the watcher that kills it during B5 ------------------------------
( until grep -q '=== B5-THE-RELAY-PROCESS-IS-KILLED-FROM-THE-SHELL' "$D/console.log" 2>/dev/null; do
    sleep 1
    pgrep -f 'drive-browser.mjs' >/dev/null || exit 0   # the run ended without reaching B5
  done
  sleep 4
  pkill -f 'relay.mjs --port 8010' && echo "[runner] relay killed $(date -u +%H:%M:%S)" >> "$D/relay.log"
) &
WATCHER=$!

echo "--- arm $ARM: driving ---"
node web/tools/drive-browser.mjs --headed --out "$D" \
  --url "http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010" \
  --script-file "$ROOT/web/tools/bridge-gate.steps" > "$D/driver.txt" 2>&1 \
  || echo "(driver exited non-zero, see $D/driver.txt)"
kill "$WATCHER" 2>/dev/null || true
docker logs aa-server > "$D/server.log" 2>&1

# ---- what the run produced -------------------------------------------
echo "--- arm $ARM done: $D ---"
# [AB][0-9], NOT B[0-9]: the seven verdicts are B0 B1 A1 B2 B3 B4 B5, and a
# B-only pattern silently tallied six of them against an "expected 7".
echo "verdicts (expected 7):"
grep -o '\[BRIDGEGATE\] [AB][0-9] [a-z-]*' "$D/console.log" | sed 's/^/  /' || true
echo "PASS true count: $(grep -c '\[console.log\].*BRIDGEGATE.*"PASS":true' "$D/console.log" || true)"
echo "PASS false count: $(grep -c '\[console.log\].*BRIDGEGATE.*"PASS":false' "$D/console.log" || true)"
echo "the server's side of it:"
grep -icE 'Received login|entered the game' "$D/server.log" | sed 's/^/  login+entered lines: /'
echo "the relay's side of it:"
grep -c 'discarded' "$D/relay.log" | sed 's/^/  discard-count lines: /'
tail -2 "$D/relay.log" | sed 's/^/  /'
echo "Emscripten abort in the transcript (must be 0):"
grep -icE 'abort\(|Aborted\(|RuntimeError: abort' "$D/console.log" | sed 's/^/  /'
