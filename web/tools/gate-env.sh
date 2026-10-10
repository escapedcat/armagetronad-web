# shellcheck shell=sh
# web/tools/gate-env.sh -- what every run-*-gate.sh against the local server
# shares. Sourced (". web/tools/gate-env.sh"), not run. POSIX sh.
#
# A runner names its steps file, its server config and its checks; this file
# does the rest: the preflight (repository root, static server, Docker image),
# the aa-dedicated container with the game's resources copied in, the local
# relay, the browser driver, the server's log afterwards, and the PASS/FAIL
# tally.
#
#   . web/tools/gate-env.sh
#   gate_init "$1" login-gate.steps          # out dir, steps file in web/tools
#   gate_server login-var                    # bridge/test-server/<dir> as --vardir
#   gate_relay
#   gate_drive --mobile 412,915,3            # extra driver args; URL params via GATE_QUERY
#   gate_stop_server
#   check "connected" grep -qF '=> "connected=1"' "$C"
#   gate_finish "login gate"
#
# PORTS ARE OVERRIDABLE, so two gates can run at once on one machine: the
# static server GATE_HTTP_PORT (8008), the relay GATE_RELAY_PORT (8010), the
# browser's devtools GATE_DEVTOOLS_PORT (9222), the game server's UDP
# GATE_SERVER_PORT (4534) and its container GATE_CONTAINER (aa-server).
#
# WAITS ARE ON EVENTS, NOT SLEEPS: the server is up when its log says it bound
# the game port, and the relay when its log says it is listening, each with a
# timeout and a clear failure.

GATE_HTTP_PORT=${GATE_HTTP_PORT:-8008}
GATE_RELAY_PORT=${GATE_RELAY_PORT:-8010}
GATE_DEVTOOLS_PORT=${GATE_DEVTOOLS_PORT:-9222}
GATE_SERVER_PORT=${GATE_SERVER_PORT:-4534}
GATE_CONTAINER=${GATE_CONTAINER:-aa-server}
GATE_QUERY=${GATE_QUERY:-}
FAILS=0

gate_die() { echo "$*" >&2; exit 2; }

# wait_for <seconds> <command...>: retry the command every half second.
wait_for() {
  _t=$(( $1 * 2 )); shift
  while [ "$_t" -gt 0 ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.5; _t=$((_t - 1))
  done
  return 1
}

# gate_init <out-dir> <steps-file>: preflight, and a clean output directory.
# Sets OUT, ROOT, STEPS and C (the page's console log).
gate_init() {
  OUT=${1:-}
  [ -n "$OUT" ] || gate_die "usage: $0 <out-dir>"
  ROOT=$(pwd)
  STEPS="$ROOT/web/tools/$2"
  [ -f "$STEPS" ] || gate_die "run me from the repository root"
  pgrep -f "http.server $GATE_HTTP_PORT" >/dev/null ||
    gate_die "no static server on $GATE_HTTP_PORT (python3 -m http.server $GATE_HTTP_PORT --directory web/dist-m1 &)"
  docker image inspect aa-dedicated >/dev/null 2>&1 || gate_die "no aa-dedicated image (bridge/test-server/README.md)"
  mkdir -p "$OUT"
  rm -f "$OUT"/*.png "$OUT/console.log" "$OUT/relay.log" "$OUT/server.log" "$OUT/driver.txt"
  C="$OUT/console.log"
  trap gate_cleanup EXIT
}

gate_cleanup() {
  pkill -f "relay.mjs --port $GATE_RELAY_PORT" >/dev/null 2>&1 || true
  docker stop "$GATE_CONTAINER" >/dev/null 2>&1 || true
}

# gate_server <vardir>: the aa-dedicated container with
# bridge/test-server/<vardir> as its --vardir and this checkout's maps copied
# in, so it downloads nothing. Waits until it has bound the game port.
gate_server() {
  docker rm -f "$GATE_CONTAINER" >/dev/null 2>&1 || true
  docker create --name "$GATE_CONTAINER" -p "$GATE_SERVER_PORT:4534/udp" \
    -v "$ROOT/bridge/test-server/$1:/gatevar" \
    aa-dedicated /opt/aa/bin/armagetronad-dedicated --userdatadir /data --vardir /gatevar >/dev/null
  _stage=$(mktemp -d)
  mkdir -p "$_stage/resource/automatic"
  cp -R "$ROOT/resource/included/." "$_stage/resource/automatic/"
  docker cp "$_stage/resource" "$GATE_CONTAINER:/data/" >/dev/null
  rm -rf "$_stage"
  docker start "$GATE_CONTAINER" >/dev/null
  if ! wait_for 30 sh -c "docker logs $GATE_CONTAINER 2>&1 | grep -qF 'Bound socket to *.*.*.*:4534.'"; then
    echo "the server did not come up" >&2; docker logs "$GATE_CONTAINER" >&2; exit 1
  fi
  [ "$(docker inspect -f '{{.State.Status}}' "$GATE_CONTAINER")" = running ] ||
    { echo "the server did not stay up" >&2; docker logs "$GATE_CONTAINER" >&2; exit 1; }
}

# gate_relay: the local relay, allowed to reach the container.
gate_relay() {
  pkill -f "relay.mjs --port $GATE_RELAY_PORT" >/dev/null 2>&1 || true
  nohup node bridge/relay.mjs --port "$GATE_RELAY_PORT" --allow-private > "$OUT/relay.log" 2>&1 &
  wait_for 10 grep -q "listening on ws://127.0.0.1:$GATE_RELAY_PORT" "$OUT/relay.log" ||
    { echo "the relay did not come up" >&2; cat "$OUT/relay.log" >&2; exit 1; }
}

# drive_page <out-dir> <url> <steps-file> [driver args...]: the browser
# driver, headless, on GATE_DEVTOOLS_PORT; its own output in <out-dir>/driver.txt.
drive_page() {
  _out=$1; _url=$2; _steps=$3; shift 3
  mkdir -p "$_out"
  node web/tools/drive-browser.mjs --out "$_out" --port "$GATE_DEVTOOLS_PORT" "$@" \
    --url "$_url" --script-file "$_steps" > "$_out/driver.txt" 2>&1
}

# gate_drive [driver args...]: the page, joined to the relay, through the steps.
# GATE_QUERY is appended to the URL's query (e.g. "&leaveafter=5").
gate_drive() {
  drive_page "$OUT" \
    "http://localhost:$GATE_HTTP_PORT/armagetronad.html?bridge=ws://127.0.0.1:$GATE_RELAY_PORT$GATE_QUERY" \
    "$STEPS" "$@" || echo "(driver exited non-zero, see $OUT/driver.txt)"
}

# gate_stop_server [settle-seconds]: the server's log into $OUT/server.log.
gate_stop_server() {
  if [ -n "${1:-}" ]; then sleep "$1"; fi
  docker logs "$GATE_CONTAINER" > "$OUT/server.log" 2>&1 || true
  docker stop "$GATE_CONTAINER" >/dev/null 2>&1 || true
}

# check <name> <command...>: one PASS or FAIL line.
check() {
  _name=$1; shift
  if "$@" >/dev/null 2>&1; then echo "PASS $_name"; else echo "FAIL $_name"; FAILS=$((FAILS + 1)); fi
}

# The check every gate ends with.
check_no_abort() {
  check "no Emscripten abort" sh -c "! grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' '$C'"
}

# gate_finish <label>: the verdict line, and the exit status.
gate_finish() {
  if [ "$FAILS" -gt 0 ]; then echo "--- $1: $FAILS FAILED ---"; exit 1; fi
  echo "--- $1: ALL PASSED ---"
}
