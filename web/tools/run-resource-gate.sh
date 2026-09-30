#!/bin/sh
# sh web/tools/run-resource-gate.sh <out-dir> <download|refused|bundled>
#
# The map-download gate (docs/superpowers/plans/2026-09-30-map-downloads.md,
# Task 4): the browser client joins the local aa-dedicated container, whose
# map is NOT in the client's bundle, and has to download it through the
# relay's /resource route. Run from the repository root, with a static server
# on 8008 and the aa-dedicated image built:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-resource-gate.sh docs/evidence/map-downloads/refused  refused
#   sh web/tools/run-resource-gate.sh docs/evidence/map-downloads/download download
#   sh web/tools/run-resource-gate.sh docs/evidence/map-downloads/bundled  bundled
#
# HERMETIC. The "resource repository" is python3 -m http.server 8009 over
# bridge/test-server/resource-repo, and the relay is told exactly which hosts
# it may fetch from with BRIDGE_RESOURCE_HOSTS. The client tries the server's
# repository first and then its own, which is always the official
# http://resource.armagetronad.net/resource/ -- so NO arm runs the relay with
# its default host list, or a refused first URI would fall through to the real
# repository. Nothing this script starts talks to anything off this machine.
#
# THE ARMS.
#   download  relay may fetch from 127.0.0.1:8009 only. PASS: the page fetched
#             the map (200), it is in the IndexedDB-backed cache, the relay
#             served it, and the server saw the player enter the game.
#   refused   relay may fetch from nowhere (none.invalid). PASS: both URIs the
#             client tries -- the server's repository and the official
#             fallback -- come back 403 with a status the page could read
#             (never 0), the relay never answered 200/404, and the relay
#             refused both. r1-end.png should show the "Map load failure"
#             screen; look at it -- the game's failure text never reaches the
#             browser console, so no check below can read it.
#   bundled   the server runs a map that is in the client's preloaded bundle
#             (web/resource-bundle/); relay may fetch from nowhere. PASS: the
#             page asked for no download at all -- not one [RESOURCE] line --
#             and the server saw the player enter. r1-end.png shows the round.
#
# FRESH PROFILE PER ARM: web/tools/drive-browser.mjs makes a new Chrome
# profile with mkdtemp for every run and deletes it after, so a map the
# download arm cached cannot make a later arm pass or fail.
set -eu
OUT=${1:-}; ARM=${2:-}
if [ -z "$OUT" ] || [ -z "$ARM" ]; then
  echo "usage: $0 <out-dir> <download|refused|bundled>" >&2
  exit 2
fi
case $ARM in download|refused|bundled) ;; *) echo "arm must be download, refused or bundled, got '$ARM'" >&2; exit 2;; esac
ROOT=$(pwd)
[ -f "$ROOT/web/tools/resource-gate.steps" ] || { echo "run me from the repository root" >&2; exit 2; }
pgrep -f 'http.server 8008' >/dev/null || { echo "no static server on 8008" >&2; exit 2; }
docker image inspect aa-dedicated >/dev/null 2>&1 || { echo "no aa-dedicated image (bridge/test-server/README.md)" >&2; exit 2; }
MAP=gate/resource/sumo_gate-0.1.0.aamap.xml
VAR=resource-var
SERVER_MAPS="$ROOT/bridge/test-server/resource-repo"
if [ "$ARM" = bundled ]; then
  MAP=tourney/sumobar/8player_sumo-1.aamap.xml
  VAR=resource-var-bundled
  SERVER_MAPS="$ROOT/web/resource-bundle"
  [ -f "$SERVER_MAPS/$MAP" ] || { echo "no $SERVER_MAPS/$MAP: run sh web/tools/fetch-resource-bundle.sh" >&2; exit 2; }
fi
mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT/console.log" "$OUT/relay.log" "$OUT/server.log" "$OUT/repo.log" "$OUT/driver.txt"

REPO_PID=
cleanup() {
  pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true
  [ -n "$REPO_PID" ] && kill "$REPO_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ---- the server: the local container, on the gate's map ------------------
# The server's own install does not carry the DTDs or the default maps: left
# alone it DOWNLOADS them into /data/resource/automatic from the official
# repository. So that directory is filled BEFORE the server starts -- this
# repo's resource/included (DTDs, default maps) plus the gate map -- with
# docker cp, not a mount: the server must also be able to write there, and a
# read-only mount made it fail even its default-map fallback. Nothing is left
# for it to download.
docker rm -f aa-server >/dev/null 2>&1 || true
docker create --name aa-server -p 4534:4534/udp \
  -v "$ROOT/bridge/test-server/$VAR:/gatevar" \
  aa-dedicated /opt/aa/bin/armagetronad-dedicated --userdatadir /data --vardir /gatevar >/dev/null
STAGE=$(mktemp -d)
mkdir -p "$STAGE/resource/automatic"
cp -R "$ROOT/resource/included/." "$SERVER_MAPS/." "$STAGE/resource/automatic/"
docker cp "$STAGE/resource" aa-server:/data/ >/dev/null
rm -rf "$STAGE"
docker start aa-server >/dev/null
sleep 5
[ "$(docker inspect -f '{{.State.Status}}' aa-server)" = running ] || { echo "the server did not stay up" >&2; docker logs aa-server; exit 1; }

# ---- the stand-in repository -------------------------------------------
python3 -m http.server 8009 --bind 127.0.0.1 --directory "$ROOT/bridge/test-server/resource-repo" > "$OUT/repo.log" 2>&1 &
REPO_PID=$!

# ---- the relay for this arm --------------------------------------------
pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true
sleep 1
if [ "$ARM" = download ]; then HOSTS=127.0.0.1:8009; else HOSTS=none.invalid; fi
BRIDGE_RESOURCE_HOSTS=$HOSTS nohup node bridge/relay.mjs --port 8010 --allow-private > "$OUT/relay.log" 2>&1 &
sleep 2
grep -q 'listening on ws://127.0.0.1:8010' "$OUT/relay.log" || { echo "the relay did not come up" >&2; cat "$OUT/relay.log"; exit 1; }
echo "relay: $(head -1 "$OUT/relay.log")"

echo "--- arm $ARM: driving ---"
node web/tools/drive-browser.mjs --out "$OUT" \
  --url "http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010" \
  --script-file "$ROOT/web/tools/resource-gate.steps" > "$OUT/driver.txt" 2>&1 \
  || echo "(driver exited non-zero, see $OUT/driver.txt)"
docker logs aa-server > "$OUT/server.log" 2>&1 || true

# ---- the verdict ---------------------------------------------------------
FAILS=0
check() { # check <name> <command...>
  name=$1; shift
  if "$@" >/dev/null 2>&1; then echo "PASS $name"; else echo "FAIL $name"; FAILS=$((FAILS + 1)); fi
}
C="$OUT/console.log"
resource_lines() { grep -o '\[console.log\] \[RESOURCE\] .*' "$C" | sed 's/^\[console.log\] //'; }
echo "[RESOURCE] lines the page logged:"
resource_lines | sed 's/^/  /' || true
echo "relay resource lines:"
grep '^\[bridge\] resource ' "$OUT/relay.log" | sed 's/^/  /' || true

if [ "$ARM" = download ]; then
  check "page fetched the map (200)" grep -qF "[RESOURCE] 200 http://127.0.0.1:8009/$MAP" "$C"
  check "no [RESOURCE] line with another status" sh -c "! grep -o '\[RESOURCE\] [0-9]*' '$C' | grep -vq '\[RESOURCE\] 200'"
  check "the map is in the page's cache" grep -qF 'cached=true' "$C"
  # The size check is what catches a download that "succeeded" with no body --
  # the first run of this gate passed every other check with an empty map.
  WANT_BYTES=$(wc -c < "$ROOT/bridge/test-server/resource-repo/$MAP" | tr -d ' ')
  check "the cached map is the whole file ($WANT_BYTES bytes)" grep -qF "cachedBytes=$WANT_BYTES" "$C"
  check "the relay served it" grep -q '^\[bridge\] resource 200 ' "$OUT/relay.log"
  check "the stand-in repository was asked for it" grep -qF "GET /$MAP" "$OUT/repo.log"
  check "the server saw the player enter the game" grep -q 'web_user entered the game' "$OUT/server.log"
elif [ "$ARM" = bundled ]; then
  # [console.log] only: the harness's own "until ... <<[RESOURCE]>>" line is
  # in the same transcript and would match a bare [RESOURCE].
  check "the page asked for no download at all" sh -c "! grep -q '\[console.log\] \[RESOURCE\]' '$C'"
  check "the relay was never asked" sh -c "! grep -q '^\[bridge\] resource ' '$OUT/relay.log'"
  check "the server saw the player enter the game" grep -q 'web_user entered the game' "$OUT/server.log"
else
  check "server repository URI refused, readable (403)" grep -qF "[RESOURCE] 403 http://127.0.0.1:8009/$MAP" "$C"
  check "official fallback URI refused locally (403)" grep -qF "[RESOURCE] 403 http://resource.armagetronad.net/resource/$MAP" "$C"
  check "never status 0" sh -c "! grep -q '\[RESOURCE\] 0 ' '$C'"
  check "no [RESOURCE] line with another status" sh -c "! grep -o '\[RESOURCE\] [0-9]*' '$C' | grep -vq '\[RESOURCE\] 403'"
  check "the relay refused both" sh -c "test \"\$(grep -c '^\[bridge\] resource 403 ' '$OUT/relay.log')\" -ge 2"
  check "the relay never fetched anything" sh -c "! grep -qE '^\[bridge\] resource (200|404|502|504) ' '$OUT/relay.log'"
  check "the stand-in repository was never asked" sh -c "! grep -qF 'GET /' '$OUT/repo.log'"
fi
check "the server downloaded nothing itself" sh -c "! grep -qE 'not found in cache|Downloading ' '$OUT/server.log'"
check "no Emscripten abort" sh -c "! grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' '$C'"
echo "look at $OUT/r1-end.png: the download and bundled arms must show the arena, the refused arm the failure screen"
if [ "$FAILS" -gt 0 ]; then echo "--- arm $ARM: $FAILS FAILED ---"; exit 1; fi
echo "--- arm $ARM: ALL PASSED ---"
