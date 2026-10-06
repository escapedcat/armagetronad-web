#!/bin/sh
# sh web/tools/run-relay-retry-gate.sh <out-dir>
#
# The page retries a relay that failed (web/library_bridge.js
# aa_bridge_state): Multiplayer is refused while the relay is down, and opens
# once it is up, without a reload. See web/tools/relay-retry-gate.steps.
# Run from the repository root, with a static server on 8008:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-relay-retry-gate.sh /tmp/retry
set -eu
OUT=${1:-}
[ -n "$OUT" ] || { echo "usage: $0 <out-dir>" >&2; exit 2; }
ROOT=$(pwd)
[ -f "$ROOT/web/tools/relay-retry-gate.steps" ] || { echo "run me from the repository root" >&2; exit 2; }
pgrep -f 'http.server 8008' >/dev/null || { echo "no static server on 8008" >&2; exit 2; }
mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT/console.log" "$OUT/relay.log" "$OUT/driver.txt"

cleanup() { pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true; }
trap cleanup EXIT
pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true
sleep 1

node web/tools/drive-browser.mjs --out "$OUT" \
  --url "http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010" \
  --script-file "$ROOT/web/tools/relay-retry-gate.steps" > "$OUT/driver.txt" 2>&1 &
DRIVER=$!

# Start the relay only when the page asks, i.e. after the first refusal.
i=0
until grep -qF '[RETRYGATE] start-relay' "$OUT/console.log" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -lt 600 ] || { echo "the page never asked for the relay" >&2; break; }
  sleep 0.5
done
nohup node bridge/relay.mjs --port 8010 > "$OUT/relay.log" 2>&1 &
sleep 2
wait "$DRIVER" || echo "(driver exited non-zero, see $OUT/driver.txt)"

C="$OUT/console.log"
FAILS=0
check() { # check <name> <command...>
  name=$1; shift
  if "$@" >/dev/null 2>&1; then echo "PASS $name"; else echo "FAIL $name"; FAILS=$((FAILS + 1)); fi
}
check "refused while the relay was down" grep -qF '[BRIDGE] network menu refused: the ?bridge= relay did not answer' "$C"
check "refused exactly once" sh -c "test \"\$(grep -c '\[console.log\] \[BRIDGE\] network menu refused' '$C')\" -eq 1"
check "asked again, the page retried the relay" grep -qF '[BRIDGE] retrying the relay' "$C"
check "and connected to it" grep -qF '[BRIDGE] open ws://127.0.0.1:8010' "$C"
check "no Emscripten abort" sh -c "! grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' '$C'"
if [ "$FAILS" -gt 0 ]; then echo "--- relay retry gate: $FAILS FAILED ---"; exit 1; fi
echo "--- relay retry gate: ALL PASSED ---"
