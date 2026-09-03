#!/bin/sh
# M5's gate, run against the PUBLIC deployment rather than a local server.
#
#   sh web/tools/live-gate.sh                       # everything, with the proxy
#   sh web/tools/live-gate.sh --no-proxy            # if your Firefox can reach Pages
#   sh web/tools/live-gate.sh --only wire           # one part
#
# WHY THIS EXISTS. Every gate this project has built serves `web/dist-m1` from
# `python3 -m http.server` on localhost. Not one of them has ever exercised the
# things a real deployment adds: a remote origin, an https scheme, a CDN
# deciding what to compress, a MIME type chosen by someone else's server, and a
# 404 page that is not ours. This runs the existing gates against the real
# thing and adds the assertions that only make sense there.
#
# WHAT IT RUNS, and where each part comes from:
#
#   wire    web/tools/wire-facts.sh + check-wire-facts.mjs         (new in M5 task 5)
#   play    web/tools/gameplay-gate.steps, UNMODIFIED, in both
#           engines, arbitrated by M2's own check-transcript.mjs   (M2, re-aimed)
#   mp      web/tools/https-multiplayer.steps in both engines +
#           check-live-multiplayer.mjs                             (M5 task 3, re-aimed)
#
# THE FIREFOX PROXY. On the machine M5 was verified on, Firefox cannot open a
# connection to ANY *.github.io host -- including GitHub's own pages.github.io
# -- while Chrome and curl reach the same URL in the same second. That is a
# local outbound restriction (Little Snitch), not a fact about this deployment;
# the controls are in docs/evidence/m5-launch/firefox-github-io-still-blocked.txt.
# So by default this script starts docs/evidence/m5-deploy/tunnel-proxy.mjs and
# points Firefox at it with --pref. The proxy tunnels CONNECT byte-for-byte and
# never sees plaintext, so Firefox still validates GitHub's real certificate and
# the document origin is unchanged. Pass --no-proxy on a machine that does not
# need it.
#
# TIMING. The two gameplay runs are three real Armagetron rounds each and the
# two multiplayer runs are bounded by the master-server timeout, so a full pass
# is roughly eight minutes of wall clock. Nothing here is a unit test.
set -eu

URL=${URL:-https://escapedcat.github.io/armagetronad-web}
PAGE=armagetronad.html
DIST=web/dist-m1
# Default output goes under docs/evidence/, not a new top-level directory.
# An earlier default of `web-evidence/live-gate` put 16 MB of run artefacts
# untracked in the repo root, one `git add -A` away from being committed and
# duplicating what docs/evidence/m5-launch/ already holds. Anything written
# here is scratch by default; pass --out to put a run somewhere you intend to
# keep.
OUT=docs/evidence/m5-launch/.runs/live-gate
PROXY_PORT=8890
USE_PROXY=1
ONLY=all

while [ $# -gt 0 ]; do
  case $1 in
    --url) URL=$2; shift 2 ;;
    --dist) DIST=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    --proxy-port) PROXY_PORT=$2; shift 2 ;;
    --no-proxy) USE_PROXY=0; shift ;;
    --only) ONLY=$2; shift 2 ;;      # wire | play | mp | all
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

HERE=$(dirname "$0")
ROOT=$HERE/../..
mkdir -p "$OUT"
FAILED=0
SUMMARY=$OUT/summary.txt
: > "$SUMMARY"

record() { # record <name> <status>
  printf '%-28s %s\n' "$1" "$2" >> "$SUMMARY"
  [ "$2" = PASS ] || FAILED=$((FAILED+1))
}
run() { # run <name> <cmd...>; records PASS/FAIL from the exit status
  name=$1; shift
  echo "--- $name"
  if "$@"; then record "$name" PASS; else record "$name" FAIL; fi
}

want() { [ "$ONLY" = all ] || [ "$ONLY" = "$1" ]; }

FF_PREFS=""
PROXY_PID=""
if [ "$USE_PROXY" = 1 ]; then
  # Reuse a proxy that is already listening rather than failing on EADDRINUSE:
  # a long live-gate run is often driven alongside a hand-started proxy, and
  # killing someone else's is worse than sharing it.
  if nc -z 127.0.0.1 "$PROXY_PORT" 2>/dev/null; then
    echo "reusing the proxy already listening on 127.0.0.1:$PROXY_PORT"
  else
    node "$ROOT/docs/evidence/m5-deploy/tunnel-proxy.mjs" --port "$PROXY_PORT" \
         > "$OUT/tunnel-proxy.log" 2>&1 &
    PROXY_PID=$!
    # listen() is asynchronous, so wait for the banner rather than sleeping a
    # guessed interval -- and fail loudly instead of pointing Firefox at a dead
    # port, where every navigation would look like the outbound block this
    # proxy exists to work around.
    i=0
    while [ $i -lt 50 ]; do
      if grep -q 'tunnel proxy on' "$OUT/tunnel-proxy.log" 2>/dev/null; then break; fi
      i=$((i+1)); sleep 0.1
    done
    grep -q 'tunnel proxy on' "$OUT/tunnel-proxy.log" || {
      echo "proxy did not start; see $OUT/tunnel-proxy.log" >&2; exit 3; }
    trap 'kill $PROXY_PID 2>/dev/null || true' EXIT
  fi
  FF_PREFS="--pref network.proxy.type=1
--pref network.proxy.ssl=\"127.0.0.1\"
--pref network.proxy.ssl_port=$PROXY_PORT
--pref network.proxy.http=\"127.0.0.1\"
--pref network.proxy.http_port=$PROXY_PORT"
fi

# Firefox prefs have to survive word splitting with an embedded quoted value,
# which is why they are fed through "$@" rather than interpolated.
firefox_run() { # firefox_run <outdir> <steps>
  # shellcheck disable=SC2086
  set -- --out "$1" --url "$URL/$PAGE" --script-file "$2" $FF_PREFS
  node "$ROOT/web/tools/drive-firefox.mjs" "$@"
}

if want wire; then
  echo "=== wire facts"
  sh "$ROOT/web/tools/wire-facts.sh" "$URL" "$DIST" > "$OUT/wire-facts.json"
  run "wire facts"            node "$ROOT/docs/evidence/m5-launch/check-wire-facts.mjs" \
                                   "$OUT/wire-facts.json"
fi

if want play; then
  echo "=== gameplay, chrome"
  node "$ROOT/web/tools/drive-browser.mjs" --headed --out "$OUT/play-chrome" \
       --url "$URL/$PAGE" --script-file "$ROOT/web/tools/gameplay-gate.steps" \
       > "$OUT/play-chrome.driver.txt" 2>&1
  run "gameplay chrome"       node "$ROOT/docs/evidence/m2-gate/check-transcript.mjs" \
                                   "$OUT/play-chrome/console.log"

  echo "=== gameplay, firefox"
  firefox_run "$OUT/play-firefox" "$ROOT/web/tools/gameplay-gate.steps" \
       > "$OUT/play-firefox.driver.txt" 2>&1
  run "gameplay firefox"      node "$ROOT/docs/evidence/m2-gate/check-transcript.mjs" \
                                   "$OUT/play-firefox/console.log"
fi

if want mp; then
  echo "=== multiplayer over https, chrome"
  node "$ROOT/web/tools/drive-browser.mjs" --headed --out "$OUT/mp-chrome" \
       --url "$URL/$PAGE" --script-file "$ROOT/web/tools/https-multiplayer.steps" \
       > "$OUT/mp-chrome.driver.txt" 2>&1
  run "multiplayer chrome"    node "$ROOT/docs/evidence/m5-launch/check-live-multiplayer.mjs" \
                                   "$OUT/mp-chrome/console.log"

  echo "=== multiplayer over https, firefox"
  firefox_run "$OUT/mp-firefox" "$ROOT/web/tools/https-multiplayer.steps" \
       > "$OUT/mp-firefox.driver.txt" 2>&1
  run "multiplayer firefox"   node "$ROOT/docs/evidence/m5-launch/check-live-multiplayer.mjs" \
                                   "$OUT/mp-firefox/console.log"
fi

echo
echo "=== summary  ($URL)"
cat "$SUMMARY"
echo
if [ "$FAILED" = 0 ]; then echo "LIVE GATE PASSED"; else echo "LIVE GATE FAILED ($FAILED)"; fi
exit $([ "$FAILED" = 0 ] && echo 0 || echo 1)
