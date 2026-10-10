#!/bin/sh
# shellcheck disable=SC2119 # gate_drive and gate_stop_server take optional arguments
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
# shellcheck source=web/tools/gate-env.sh
. web/tools/gate-env.sh
gate_init "${1:-}" login-gate.steps
gate_server login-var
gate_relay
gate_drive --mobile 412,915,3
gate_stop_server 3

# Anchored on eval RESULTS ('=> "..."'): the harness also logs each eval's source.
check "connected to the server" grep -qF '=> "connected=1"' "$C"
check "the server got the login request" grep -qF 'requests authentication as "nosuchuser12345@forums"' "$OUT/server.log"
check "the server sent a password request back" grep -qF 'Password request sent to user' "$OUT/server.log"
check "the keyboard opened as a password field" sh -c "grep -F '[LOGINGATE] L1' '$C' | grep -q '\"PASS\":true'"
check "the authority answered (made-up user)" grep -qF 'User does not exist' "$OUT/server.log"
check "after the prompt, the keyboard field is plain text again" sh -c "grep -F '[LOGINGATE] L2' '$C' | grep -q '\"PASS\":true'"
check "the password never appears in the page's log" sh -c "! grep -v 'harness\] eval' '$C' | grep -q wrongpassword"
check_no_abort
echo "server log, the client's lines:"
grep -iE 'authentication|password|login failed' "$OUT/server.log" | sed 's/^/  /' || true
gate_finish "login gate"
