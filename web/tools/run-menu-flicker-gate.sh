#!/bin/sh
# shellcheck disable=SC2119 # gate_drive and gate_stop_server take optional arguments
# sh web/tools/run-menu-flicker-gate.sh <out-dir>
#
# The menu-flicker gate: open the in-game menu while the local aa-dedicated
# container waits for players, and count the frames the canvas shows black.
# Run from the repository root, with a static server on 8008 and the
# aa-dedicated image built:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-menu-flicker-gate.sh docs/evidence/menu-flicker/after
#
# PASS: at most MAX_DARK dark frames in the in-game menu segment (see
# web/tools/menu-flicker-gate.steps for what a dark frame is). The tolerance
# covers the menu opening; before the fix (web/library_present.js) the same
# segment had 46, after it 0 (docs/evidence/menu-flicker/).
#
# Hermetic: the server is the local container (bridge/test-server/wait-var:
# two players needed, no AIs, so it stays in "waiting"), the relay is local,
# and the server's resources are copied in so it downloads nothing.
set -eu
MAX_DARK=2
# shellcheck source=web/tools/gate-env.sh
. web/tools/gate-env.sh
gate_init "${1:-}" menu-flicker-gate.steps
gate_server wait-var
gate_relay
gate_drive
gate_stop_server

echo "frame brightness per segment:"
grep -o '\[console.log\] \[FLICKER\] .*' "$C" | sed 's/^\[console.log\] /  /' || true
LINE=$(grep -o '\[console.log\] \[FLICKER\] ingame-menu-while-waiting .*' "$C" || true)
DARK=$(echo "$LINE" | sed -n 's/.* dark=\([0-9]*\).*/\1/p')
FRAMES=$(echo "$LINE" | sed -n 's/.* frames=\([0-9]*\).*/\1/p')
if [ -n "$FRAMES" ] && [ "$FRAMES" -gt 100 ]; then echo "PASS the menu segment was measured ($FRAMES frames)"; else echo "FAIL the menu segment was not measured"; FAILS=$((FAILS + 1)); fi
if [ -n "$DARK" ] && [ "$DARK" -le "$MAX_DARK" ]; then echo "PASS dark frames in the in-game menu: $DARK (max $MAX_DARK)"; else echo "FAIL dark frames in the in-game menu: ${DARK:-?} (max $MAX_DARK)"; FAILS=$((FAILS + 1)); fi
if grep -qE 'web_[0-9]{4} entered the game' "$OUT/server.log"; then echo "PASS the client joined the waiting server"; else echo "FAIL the client never joined"; FAILS=$((FAILS + 1)); fi
if grep -qiE 'abort\(|Aborted\(|RuntimeError: abort' "$C"; then echo "FAIL Emscripten abort in the transcript"; FAILS=$((FAILS + 1)); else echo "PASS no Emscripten abort"; fi
echo "look at $OUT/ingame-menu-while-waiting.png"
gate_finish "menu-flicker gate"
