#!/bin/bash
# bash web/tools/run-browser-gates.sh <out-dir> [gate ...]
#
# The browser gates that need no server (no Docker, no relay), one after
# another, against web/dist-m1, headless. Writes <out-dir>/<gate>/ (each
# gate's console.log and screenshots) and <out-dir>/summary.txt: every check's
# label and PASS value, in order -- so a branch and main can be run and the
# two summaries diffed:
#
#   bash web/tools/run-browser-gates.sh /tmp/gates-main     # on main's build
#   bash web/tools/run-browser-gates.sh /tmp/gates-branch   # on the branch's
#   diff /tmp/gates-main/summary.txt /tmp/gates-branch/summary.txt
#
# A summary lists checks, it does not judge them: some gates have a check that
# fails on main too (touch-gate's T1b/T1c, see its header), and persist-gate is
# judged by docs/evidence/m4-persist/check-persist-transcript.mjs, run here.
#
# Starts its own static server. The ports are web/tools/gate-env.sh's, with its
# defaults (GATE_HTTP_PORT 8008, GATE_DEVTOOLS_PORT 9222); to run beside a
# run-*-gate.sh, give this one others, e.g. GATE_HTTP_PORT=8208
# GATE_DEVTOOLS_PORT=9422.
set -u
OUT=${1:-}
[ -n "$OUT" ] || { echo "usage: $0 <out-dir> [gate ...]" >&2; exit 2; }
shift
[ -f web/tools/drive-browser.mjs ] || { echo "run me from the repository root" >&2; exit 2; }
[ -f web/dist-m1/armagetronad.html ] || { echo "no build in web/dist-m1 (make -f web/Makefile client)" >&2; exit 2; }
# shellcheck source=web/tools/gate-env.sh
. web/tools/gate-env.sh
HTTP=$GATE_HTTP_PORT
DEV=$GATE_DEVTOOLS_PORT
GATES=("$@")
[ ${#GATES[@]} -eq 0 ] && GATES=(touch-gate portrait-boot-gate drive-pad-gate look-gate
  game-keyboard-gate default-name-gate menu-gate touch-hints-gate-phone touch-hints-gate-desk
  synthetic-key-gate layout-boot-gate persist-gate)
mkdir -p "$OUT"
pgrep -f "http.server $HTTP" >/dev/null && { echo "a static server is already on $HTTP; set GATE_HTTP_PORT" >&2; exit 2; }
python3 -m http.server "$HTTP" --directory web/dist-m1 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
wait_for 10 curl -sf -o /dev/null "http://localhost:$HTTP/armagetronad.html" ||
  { echo "the static server on $HTTP did not answer" >&2; exit 1; }
U="http://localhost:$HTTP/armagetronad.html"
PHONE=412,915,3   # --mobile W,H,DPR: a phone in portrait

run() { # run <name> <steps> <url> [driver args...]
  local name=$1 steps=$2 url=$3; shift 3
  rm -rf "${OUT:?}/$name"
  node web/tools/drive-browser.mjs --port "$DEV" --out "$OUT/$name" --url "$url" \
    --script-file "web/tools/$steps.steps" "$@" > "$OUT/$name.driver.log" 2>&1
  echo "$name driver exit $?" >> "$OUT/exits.txt"
}
: > "$OUT/exits.txt"
for g in "${GATES[@]}"; do
  case $g in
    touch-gate)             run $g touch-gate "$U" --mobile 915,412,3 ;;
    portrait-boot-gate)     run $g portrait-boot-gate "$U" --mobile "$PHONE" ;;
    drive-pad-gate)         run $g drive-pad-gate "$U" --mobile "$PHONE" ;;
    look-gate)              run $g look-gate "$U" --mobile "$PHONE" ;;
    game-keyboard-gate)     run $g game-keyboard-gate "$U" --mobile "$PHONE" ;;
    default-name-gate)      run $g default-name-gate "$U" ;;
    menu-gate)              run $g menu-gate "$U" ;;
    touch-hints-gate-phone) run $g touch-hints-gate "$U" --mobile "$PHONE" ;;
    touch-hints-gate-desk)  run $g touch-hints-gate "$U" ;;
    synthetic-key-gate)     run $g synthetic-key-gate "$U?autostart=0" ;;
    layout-boot-gate)       run $g layout-boot-gate "$U?autostart=0" --mobile "$PHONE" ;;
    persist-gate)           run $g persist-gate "$U?autostart=0" ;;
    *) echo "unknown gate $g" >&2 ;;
  esac
done

{
  for g in "${GATES[@]}"; do
    f="$OUT/$g/console.log"
    echo "== $g ($(grep "^$g " "$OUT/exits.txt" | cut -d' ' -f2-))"
    [ -f "$f" ] || { echo "   no console.log"; continue; }
    grep -E 'PASS' "$f" | while IFS= read -r line; do
      label=$(printf '%s' "$line" | grep -o -E '\[[A-Z]+GATE\] [A-Za-z0-9_-]+' | head -1)
      vals=$(printf '%s' "$line" | grep -o -E '\\?"PASS\\?":(true|false)' | tr -d '\\"' | tr '\n' ' ')
      [ -n "$vals" ] && echo "   ${label:-eval} $vals"
    done
    if [ "$g" = persist-gate ]; then
      echo "   $(node docs/evidence/m4-persist/check-persist-transcript.mjs "$f" 2>&1 | grep -E '^RESULT')"
    fi
    echo "   uncaught errors: $(grep -c -E 'exceptionThrown|Uncaught' "$f")"
  done
} > "$OUT/summary.txt"
cat "$OUT/summary.txt"
