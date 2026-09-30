#!/bin/sh
# sh web/tools/run-text-net-gate.sh <out-dir>
#
# The mobile-keyboard network gate (docs/superpowers/plans/2026-09-30-
# mobile-keyboard.md, Task 4). A phone (emulated, portrait) names itself in
# the first-visit dialog, joins the local aa-dedicated container
# (bridge/test-server/text-var: waits for a second player, and writes chat and
# renames to the ladder log, echoed into the server's output), sends a chat
# line from the 💬 bar and renames itself from the Name button while
# connected. The checks read the page's console and the server's own log.
# Run from the repository root, with a static server on 8008 and the
# aa-dedicated image built:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-text-net-gate.sh docs/evidence/mobile-keyboard/net
set -eu
OUT=${1:-}
[ -n "$OUT" ] || { echo "usage: $0 <out-dir>" >&2; exit 2; }
ROOT=$(pwd)
[ -f "$ROOT/web/tools/text-net-gate.steps" ] || { echo "run me from the repository root" >&2; exit 2; }
pgrep -f 'http.server 8008' >/dev/null || { echo "no static server on 8008" >&2; exit 2; }
docker image inspect aa-dedicated >/dev/null 2>&1 || { echo "no aa-dedicated image (bridge/test-server/README.md)" >&2; exit 2; }
mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT/console.log" "$OUT/relay.log" "$OUT/server.log" "$OUT/driver.txt"

cleanup() { pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker rm -f aa-server >/dev/null 2>&1 || true
docker create --name aa-server -p 4534:4534/udp \
  -v "$ROOT/bridge/test-server/text-var:/gatevar" \
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
  --mobile 412,915,3 --url "http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010" \
  --script-file "$ROOT/web/tools/text-net-gate.steps" > "$OUT/driver.txt" 2>&1 \
  || echo "(driver exited non-zero, see $OUT/driver.txt)"
sleep 3
docker logs aa-server > "$OUT/server.log" 2>&1 || true
docker stop aa-server >/dev/null 2>&1 || true

C="$OUT/console.log"
FAILS=0
check() { # check <name> <command...>
  name=$1; shift
  if "$@" >/dev/null 2>&1; then echo "PASS $name"; else echo "FAIL $name"; FAILS=$((FAILS + 1)); fi
}
check "N0: the saved name, no prompt after the reload" sh -c "grep -F '[TEXTGATE] N0' '$C' | grep -q '\"PASS\":true'"
check "N1: no chat button before joining" grep -qF '[TEXTGATE] N1 no-chat-before-joining' "$C"
check "N1 passed" sh -c "grep -F '[TEXTGATE] N1' '$C' | grep -q '\"PASS\":true'"
check "N2: chat button once connected" sh -c "grep -F '[TEXTGATE] N2' '$C' | grep -q '\"PASS\":true'"
check "the server saw the chosen name join" grep -q 'phoneplayer entered the game' "$OUT/server.log"
check "the server logged the chat line" grep -qE 'CHAT phoneplayer hello from a phone' "$OUT/server.log"
check "the server logged the rename" grep -qE 'PLAYER_RENAMED phoneplayer phonerenamed' "$OUT/server.log"
check "no Emscripten abort" sh -c "! grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' '$C'"
echo "server log, the client's lines:"
grep -E 'phoneplayer|phonerenamed|CHAT|RENAMED' "$OUT/server.log" | sed 's/^/  /' || true
if [ "$FAILS" -gt 0 ]; then echo "--- text-net gate: $FAILS FAILED ---"; exit 1; fi
echo "--- text-net gate: ALL PASSED ---"
