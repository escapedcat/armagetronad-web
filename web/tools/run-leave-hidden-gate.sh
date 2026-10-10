#!/bin/sh
# shellcheck disable=SC2119 # gate_drive and gate_stop_server take optional arguments
# sh web/tools/run-leave-hidden-gate.sh <out-dir>
#
# The hidden-page leave gate (src/emscripten/eWebPage.cpp, web/shell.html
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
# shellcheck source=web/tools/gate-env.sh
. web/tools/gate-env.sh
gate_init "${1:-}" leave-hidden-gate.steps
gate_server wait-var
gate_relay
GATE_QUERY='&leaveafter=5' gate_drive
gate_stop_server 3

# Anchored on eval RESULTS ('=> "..."'): the harness also logs each eval's source.
check "connected before the test" grep -qF '=> "connected-at-start=1"' "$C"
check "arm 1: hidden for 2 s, still connected" grep -qF '=> "connected-after-brief-hide=1"' "$C"
check "arm 2: hidden past the timeout, disconnected" grep -qF '=> "connected-after-long-hide=0"' "$C"
check "arm 2: the page asked for the leave exactly once" sh -c "test \"\$(grep -c '\[console.log\] \[LEAVE\] hidden for' '$C')\" -eq 1"
check "arm 2: the game logged out" grep -qF '[LEAVE] page hidden: leaving the server with a regular logout' "$C"
check "the server saw the player leave" grep -qE 'web_[0-9]{4} left the game' "$OUT/server.log"
# "Killing user N ... <reason>" is the server's line for EVERY disconnect
# (sn_DisconnectUser); what matters is the reason. A regular logout is not a
# kick and adds nothing to the autoban count (nMachine::OnKick is only called
# by sn_KickUser, with severity > 0).
check "the server recorded a regular logout" grep -q 'received logout from' "$OUT/server.log"
check "the reason is a regular logout" grep -q 'You logged out regularly' "$OUT/server.log"
check "no kick reason anywhere (idle, vote, spam, ban)" sh -c "! grep -qiE 'idle|kicked|autoban|banned' '$OUT/server.log'"
check_no_abort
echo "server log, the client's lines:"
grep -iE 'web_[0-9]{4}|login|logout|logged|timed out|kill|kick' "$OUT/server.log" | sed 's/^/  /' || true
echo "look at $OUT/after-leave.png: the main menu, with the leave message in the console"
gate_finish "leave-hidden gate"
