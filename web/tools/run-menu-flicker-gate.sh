#!/bin/sh
# sh web/tools/run-menu-flicker-gate.sh <out-dir>
#
# The menu-flicker gate: open the in-game menu while the local aa-dedicated
# container waits for players, and count the frames the canvas shows black.
# Run from the repository root, with a static server on 8008 and the
# aa-dedicated image built:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-menu-flicker-gate.sh docs/evidence/menu-flicker/after
#
# PASS: at most MAX_DARK dark frames in the in-game menu segment (see
# web/tools/menu-flicker-gate.steps for what a dark frame is). The tolerance
# covers the menu opening; before the fix (web/library_present.js) the same
# segment had 46, after it 0 (docs/evidence/menu-flicker/).
#
# Hermetic: the server is the local container (bridge/test-server/wait-var:
# two players needed, no AIs, so it stays in "waiting"), the relay is local,
# and the server's resources are copied in so it downloads nothing.
set -eu
OUT=${1:-}
[ -n "$OUT" ] || { echo "usage: $0 <out-dir>" >&2; exit 2; }
MAX_DARK=2
ROOT=$(pwd)
[ -f "$ROOT/web/tools/menu-flicker-gate.steps" ] || { echo "run me from the repository root" >&2; exit 2; }
pgrep -f 'http.server 8008' >/dev/null || { echo "no static server on 8008" >&2; exit 2; }
docker image inspect aa-dedicated >/dev/null 2>&1 || { echo "no aa-dedicated image (bridge/test-server/README.md)" >&2; exit 2; }
mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT/console.log" "$OUT/relay.log" "$OUT/server.log" "$OUT/driver.txt"

cleanup() { pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker rm -f aa-server >/dev/null 2>&1 || true
docker create --name aa-server -p 4534:4534/udp \
  -v "$ROOT/bridge/test-server/wait-var:/gatevar" \
  aa-dedicated /opt/aa/bin/armagetronad-dedicated --userdatadir /data --vardir /gatevar >/dev/null
STAGE=$(mktemp -d)
mkdir -p "$STAGE/resource/automatic"
cp -R "$ROOT/resource/included/." "$STAGE/resource/automatic/"
docker cp "$STAGE/resource" aa-server:/data/ >/dev/null
rm -rf "$STAGE"
docker start aa-server >/dev/null
sleep 5
[ "$(docker inspect -f '{{.State.Status}}' aa-server)" = running ] || { echo "the server did not stay up" >&2; docker logs aa-server; exit 1; }

pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true
sleep 1
nohup node bridge/relay.mjs --port 8010 --allow-private > "$OUT/relay.log" 2>&1 &
sleep 2
grep -q 'listening on ws://127.0.0.1:8010' "$OUT/relay.log" || { echo "the relay did not come up" >&2; cat "$OUT/relay.log"; exit 1; }

node web/tools/drive-browser.mjs --out "$OUT" \
  --url "http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010" \
  --script-file "$ROOT/web/tools/menu-flicker-gate.steps" > "$OUT/driver.txt" 2>&1 \
  || echo "(driver exited non-zero, see $OUT/driver.txt)"
docker logs aa-server > "$OUT/server.log" 2>&1 || true
docker stop aa-server >/dev/null 2>&1 || true

C="$OUT/console.log"
echo "frame brightness per segment:"
grep -o '\[console.log\] \[FLICKER\] .*' "$C" | sed 's/^\[console.log\] /  /' || true
LINE=$(grep -o '\[console.log\] \[FLICKER\] ingame-menu-while-waiting .*' "$C" || true)
DARK=$(echo "$LINE" | sed -n 's/.* dark=\([0-9]*\).*/\1/p')
FRAMES=$(echo "$LINE" | sed -n 's/.* frames=\([0-9]*\).*/\1/p')
FAILS=0
if [ -n "$FRAMES" ] && [ "$FRAMES" -gt 100 ]; then echo "PASS the menu segment was measured ($FRAMES frames)"; else echo "FAIL the menu segment was not measured"; FAILS=$((FAILS + 1)); fi
if [ -n "$DARK" ] && [ "$DARK" -le "$MAX_DARK" ]; then echo "PASS dark frames in the in-game menu: $DARK (max $MAX_DARK)"; else echo "FAIL dark frames in the in-game menu: ${DARK:-?} (max $MAX_DARK)"; FAILS=$((FAILS + 1)); fi
if grep -q 'web_user entered the game' "$OUT/server.log"; then echo "PASS the client joined the waiting server"; else echo "FAIL the client never joined"; FAILS=$((FAILS + 1)); fi
if grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' "$C"; then echo "FAIL Emscripten abort in the transcript"; FAILS=$((FAILS + 1)); else echo "PASS no Emscripten abort"; fi
echo "look at $OUT/ingame-menu-while-waiting.png"
if [ "$FAILS" -gt 0 ]; then echo "--- menu-flicker gate: $FAILS FAILED ---"; exit 1; fi
echo "--- menu-flicker gate: ALL PASSED ---"
