#!/bin/sh
# sh web/tools/run-leave-hidden-gate.sh <out-dir>
#
# The hidden-page leave gate (src/emscripten/eWebLeave.cpp, web/shell.html
# "LEAVE A SERVER CLEANLY WHEN THE PAGE HAS BEEN HIDDEN"). The browser client
# joins the local aa-dedicated container (bridge/test-server/wait-var: waits for
# a second player, so it stays connected), then:
#   arm 1  the page is hidden for 2 s and comes back -> it must STAY connected
#   arm 2  the page stays hidden past ?leaveafter=5  -> it must LEAVE, with a
#          regular logout the server does not count as a kick
# Run from the repository root, with a static server on 8008 and the
# aa-dedicated image built:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-leave-hidden-gate.sh docs/evidence/leave-hidden/run
set -eu
OUT=${1:-}
[ -n "$OUT" ] || { echo "usage: $0 <out-dir>" >&2; exit 2; }
ROOT=$(pwd)
[ -f "$ROOT/web/tools/leave-hidden-gate.steps" ] || { echo "run me from the repository root" >&2; exit 2; }
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
  --url "http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010&leaveafter=5" \
  --script-file "$ROOT/web/tools/leave-hidden-gate.steps" > "$OUT/driver.txt" 2>&1 \
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
check "connected before the test" grep -qF '=> "connected-at-start=1"' "$C"
check "arm 1: hidden for 2 s, still connected" grep -qF '=> "connected-after-brief-hide=1"' "$C"
check "arm 2: hidden past the timeout, disconnected" grep -qF '=> "connected-after-long-hide=0"' "$C"
check "arm 2: the page asked for the leave exactly once" sh -c "test \"\$(grep -c '\[console.log\] \[LEAVE\] hidden for' '$C')\" -eq 1"
check "arm 2: the game logged out" grep -qF '[LEAVE] page hidden: leaving the server with a regular logout' "$C"
check "the server saw the player leave" grep -q 'web_user left the game' "$OUT/server.log"
# "Killing user N ... <reason>" is the server's line for EVERY disconnect
# (sn_DisconnectUser); what matters is the reason. A regular logout is not a
# kick and adds nothing to the autoban count (nMachine::OnKick is only called
# by sn_KickUser, with severity > 0).
check "the server recorded a regular logout" grep -q 'received logout from' "$OUT/server.log"
check "the reason is a regular logout" grep -q 'You logged out regularly' "$OUT/server.log"
check "no kick reason anywhere (idle, vote, spam, ban)" sh -c "! grep -qiE 'idle|kicked|autoban|banned' '$OUT/server.log'"
check "no Emscripten abort" sh -c "! grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' '$C'"
echo "server log, the client's lines:"
grep -iE 'web_user|login|logout|logged|timed out|kill|kick' "$OUT/server.log" | sed 's/^/  /' || true
echo "look at $OUT/after-leave.png: the main menu, with the leave message in the console"
if [ "$FAILS" -gt 0 ]; then echo "--- leave-hidden gate: $FAILS FAILED ---"; exit 1; fi
echo "--- leave-hidden gate: ALL PASSED ---"
