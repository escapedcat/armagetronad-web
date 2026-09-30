#!/bin/sh
# sh web/tools/run-text-net-gate.sh <out-dir>
#
# The phone keyboard against a real server (docs/superpowers/plans/
# 2026-09-30-game-text-keyboard.md). An emulated phone (portrait) joins the
# local aa-dedicated container (bridge/test-server/text-var: waits for a
# second player, so it stays connected, and writes chat to the ladder log,
# echoed into the server's output), opens the game's own chat line with Enter,
# types into the keyboard's hidden field and sends with the keyboard's Enter.
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
# Anchored on eval RESULTS ('=> "..."'): the harness also logs each eval's source.
check "connected to the server" grep -qF '=> "connected=1"' "$C"
check "the server saw a web_NNNN player join" grep -qE 'PLAYER_ENTERED web_[0-9]{4} ' "$OUT/server.log"
check "Enter in the round opened the keyboard with the chat line" grep -qF '=> "chat-line-keyboard=1"' "$C"
check "the server logged the chat line" grep -qE 'CHAT web_[0-9]{4} hello from a phone' "$OUT/server.log"
check "the keyboard closed after sending" grep -qF '=> "after-send-keyboard=0"' "$C"
check "no Emscripten abort" sh -c "! grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' '$C'"
echo "server log, the client's lines:"
grep -E 'web_[0-9]{4}|CHAT' "$OUT/server.log" | sed 's/^/  /' || true
if [ "$FAILS" -gt 0 ]; then echo "--- text-net gate: $FAILS FAILED ---"; exit 1; fi
echo "--- text-net gate: ALL PASSED ---"
