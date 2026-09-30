#!/bin/sh
# Ask a relay whether it would admit a browser from ORIGIN, without opening a
# game session: attempt the WebSocket upgrade and print the HTTP status only.
#
#   sh web/tools/relay-admits.sh wss://armagetronad-bridge.fly.dev/ https://escapedcat.github.io
#   -> 101   admitted (bridge/relay.mjs switched protocols)
#   -> 403   that origin is not on BRIDGE_ORIGINS
#   -> 401   the path is not the token, and the bare path is not open
#   -> 000   nothing answered
#
# Used by .github/workflows/deploy-relay.yml after a relay deploy, and by
# deploy-pages.yml before a page deploy -- the page dials the relay with no
# token (web/library_bridge.js), so it must never go live while the relay
# still refuses it.
#
# curl does not speak WebSocket past the handshake: on a 101 it keeps the
# connection open until --max-time, and exits non-zero. The status it printed
# is still the answer, so the exit code is deliberately ignored.
set -u
url=${1:?usage: relay-admits.sh <wss://relay/path> <origin>}
origin=${2:?usage: relay-admits.sh <wss://relay/path> <origin>}
case $url in
  wss://*) http="https://${url#wss://}" ;;
  ws://*)  http="http://${url#ws://}" ;;
  *) echo "not a ws:// or wss:// URL: $url" >&2; exit 2 ;;
esac
code=$(curl -s -o /dev/null -w '%{http_code}' --http1.1 --max-time 5 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H "Origin: $origin" "$http") || true
echo "${code:-000}"
