#!/bin/sh
# sh web/tools/run-login-gate.sh <out-dir>
#
# Global ID login through the relay (web/tools/login-gate.steps): the local
# aa-dedicated container with GLOBAL_ID 1 (bridge/test-server/login-var) asks
# the real forums authority, so this needs internet access. Proves the login
# round trip works for web players, and that the phone keyboard treats the
# game's password prompt as a password field.
# Run from the repository root, with a static server on 8008 and the
# aa-dedicated image built:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-login-gate.sh /tmp/login
set -eu
OUT=${1:-}
[ -n "$OUT" ] || { echo "usage: $0 <out-dir>" >&2; exit 2; }
ROOT=$(pwd)
[ -f "$ROOT/web/tools/login-gate.steps" ] || { echo "run me from the repository root" >&2; exit 2; }
pgrep -f 'http.server 8008' >/dev/null || { echo "no static server on 8008" >&2; exit 2; }
docker image inspect aa-dedicated >/dev/null 2>&1 || { echo "no aa-dedicated image (bridge/test-server/README.md)" >&2; exit 2; }
mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT/console.log" "$OUT/relay.log" "$OUT/server.log" "$OUT/driver.txt"

cleanup() { pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker rm -f aa-server >/dev/null 2>&1 || true
docker create --name aa-server -p 4534:4534/udp \
  -v "$ROOT/bridge/test-server/login-var:/gatevar" \
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
  --script-file "$ROOT/web/tools/login-gate.steps" > "$OUT/driver.txt" 2>&1 \
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
check "the server got the login request" grep -qF 'requests authentication as "nosuchuser12345@forums"' "$OUT/server.log"
check "the server sent a password request back" grep -qF 'Password request sent to user' "$OUT/server.log"
check "the keyboard opened as a password field" sh -c "grep -F '[LOGINGATE] L1' '$C' | grep -q '\"PASS\":true'"
check "the authority answered (made-up user)" grep -qF 'User does not exist' "$OUT/server.log"
check "after the prompt, the keyboard field is plain text again" sh -c "grep -F '[LOGINGATE] L2' '$C' | grep -q '\"PASS\":true'"
check "the password never appears in the page's log" sh -c "! grep -v 'harness\] eval' '$C' | grep -q wrongpassword"
check "no Emscripten abort" sh -c "! grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' '$C'"
echo "server log, the client's lines:"
grep -iE 'authentication|password|login failed' "$OUT/server.log" | sed 's/^/  /' || true
if [ "$FAILS" -gt 0 ]; then echo "--- login gate: $FAILS FAILED ---"; exit 1; fi
echo "--- login gate: ALL PASSED ---"
