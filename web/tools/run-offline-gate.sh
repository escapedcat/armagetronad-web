#!/bin/bash
# bash web/tools/run-offline-gate.sh <out-dir> [--no-sw]
#
# The installed app plays with no network (web/tools/offline-gate.steps says
# what each check proves). Headless, a phone, against a COPY of web/dist-m1
# served by web/tools/serve-switchable.mjs on GATE_HTTP_PORT (8008) with its
# switch on GATE_HTTP_PORT+1. A second copy, with a changed page and its own
# stamped sw.js, is the "newer build" O5 switches to.
#
# --no-sw is the negative control: the same run with sw.js not served. O1, O3,
# O4, O5 and O6 must FAIL and O2 must PASS -- the proof the gate can fail.
set -u
OUT=${1:-}
[ -n "$OUT" ] || { echo "usage: $0 <out-dir> [--no-sw]" >&2; exit 2; }
MODE=${2:-}
[ -f web/tools/drive-browser.mjs ] || { echo "run me from the repository root" >&2; exit 2; }
[ -f web/dist-m1/sw.js ] || { echo "no offline build in web/dist-m1 (make -f web/Makefile client)" >&2; exit 2; }
# shellcheck source=web/tools/gate-env.sh
. web/tools/gate-env.sh
HTTP=$GATE_HTTP_PORT
CTL=$((HTTP + 1))
curl -s -o /dev/null "http://127.0.0.1:$HTTP/" && { echo "something already answers on $HTTP; set GATE_HTTP_PORT" >&2; exit 2; }

rm -rf "$OUT"; mkdir -p "$OUT"
cp -R web/dist-m1 "$OUT/site"
cp -R web/dist-m1 "$OUT/next"
printf '\n<!-- the next build -->\n' >> "$OUT/next/armagetronad.html"
node web/tools/stamp-sw.mjs "$OUT/next" > /dev/null
if [ "$MODE" = --no-sw ]; then rm "$OUT/site/sw.js" "$OUT/next/sw.js"; fi

node web/tools/serve-switchable.mjs --dir "$OUT/site" --next "$OUT/next" --port "$HTTP" --control "$CTL" \
  > "$OUT/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
wait_for 10 grep -q '^listening' "$OUT/server.log" ||
  { echo "the gate server did not come up" >&2; cat "$OUT/server.log" >&2; exit 1; }

drive_page "$OUT" "http://127.0.0.1:$HTTP/armagetronad.html?autostart=0" web/tools/offline-gate.steps \
  --mobile 412,915,3 || echo "(driver exited non-zero, see $OUT/driver.txt)"

C="$OUT/console.log"
FAILS=0
passed() { grep -F "[OFFGATE] $1 " "$C" | grep -q '"PASS":true'; }
check "O1 a tab visit saves the offline copy"            passed O1
check "O2 a tab reload still uses the network"           passed O2
check "O3 the app online uses the copy"                  passed O3
check "O4 the app offline boots and drives"              passed O4
check "O5 a newer build waits; the running copy is kept" passed O5
check "O6 the newer copy takes over; the older is deleted" passed O6
check_no_abort
gate_finish "offline-gate${MODE:+ $MODE}"
