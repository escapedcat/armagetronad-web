#!/bin/sh
# shellcheck disable=SC2119 # gate_drive and gate_stop_server take optional arguments
# sh web/tools/run-text-net-gate.sh <out-dir>
#
# The phone keyboard against a real server (docs/superpowers/plans/
# 2026-09-30-game-text-keyboard.md). An emulated phone (portrait) joins the
# local aa-dedicated container (bridge/test-server/text-var: waits for a
# second player, so it stays connected, and writes chat to the ladder log,
# echoed into the server's output), crashes, opens the game's own chat line
# with the pad's Enter (labelled Chat by then),
# pastes into the keyboard's hidden field and sends with the keyboard's Enter.
# Look at chat-label.png, chat-typing.png and chat-sent.png.
# Run from the repository root, with a static server on 8008 and the
# aa-dedicated image built:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-text-net-gate.sh docs/evidence/mobile-keyboard/net
set -eu
# shellcheck source=web/tools/gate-env.sh
. web/tools/gate-env.sh
gate_init "${1:-}" text-net-gate.steps
gate_server text-var
gate_relay
gate_drive --mobile 412,915,3
gate_stop_server 3

# Anchored on eval RESULTS ('=> "..."'): the harness also logs each eval's source.
check "connected to the server" grep -qF '=> "connected=1"' "$C"
# The display name, last on the line: the log name before it spells 0 as o.
check "the server saw a web_NNNN player join" grep -qE 'PLAYER_ENTERED .* web_[0-9]{4}$' "$OUT/server.log"
check "while driving the pad says Enter" grep -qF '=> "driving-label=Enter"' "$C"
check "after the crash the pad says Chat" grep -qF '=> "crashed-label=Chat"' "$C"
check "a tap on the picture after the crash opened no chat" grep -qF '=> "picture-tap-chat=0,0"' "$C"
check "a tap on the picture hid the keyboard and closed the chat line" grep -qF '=> "picture-tap-closes-chat=0,0"' "$C"
check "Chat opened it again, with the keyboard" grep -qF '=> "reopened-keyboard=1"' "$C"
check "folding the keyboard closed the open chat line" grep -qF '=> "fold-closes-chat=1,0,0"' "$C"
check "tapping Chat opened the chat line and the keyboard" grep -qF '=> "after-tap-keyboard=1"' "$C"
check "the server logged the pasted link" grep -qF 'Play it on your phone: https://escapedcat.github.io/armagetronad-web/' "$OUT/server.log"
check "the chat line was open for the empty test" grep -qF '=> "empty-test-keyboard=1"' "$C"
check "Enter on an empty chat line closed it" grep -qF '=> "after-empty-enter-menu=0"' "$C"
check "the empty line was not sent (one CHAT line in all)" sh -c "test \"\$(grep -c 'CHAT web_' '$OUT/server.log')\" -eq 1"
check "the keyboard closed after sending" grep -qF '=> "after-send-keyboard=0"' "$C"
check_no_abort
echo "server log, the client's lines:"
grep -E 'PLAYER_ENTERED|CHAT' "$OUT/server.log" | sed 's/^/  /' || true
gate_finish "text-net gate"
