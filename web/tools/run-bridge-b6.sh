#!/bin/sh
# sh web/tools/run-bridge-b6.sh <out-dir> <address> <port> <local|remote>
#
# Runs web/tools/bridge-gate-b6.steps once and collects both ends' evidence.
# Run it from the repository root, with a static server already on 8008:
#
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   sh web/tools/run-bridge-b6.sh docs/evidence/m-a-bridge/b6/local  127.0.0.1       4534 local
#   sh web/tools/run-bridge-b6.sh docs/evidence/m-a-bridge/b6/remote 188.245.106.232 4537 remote
#
# THE ADDRESS ARGUMENT IS NOT A SETTING, IT IS AN ASSERTION. This script does
# not point the client anywhere -- that is CUSTOM_SERVER_NAME in
# web/webdefaults/autoexec.cfg, which is baked into the preloaded bundle at
# LINK time and therefore needs a relink to change. What the argument does is
# say where the run was SUPPOSED to go, so that afterwards the peer lines the
# page logged and the destinations in the relay's UDP trace can both be checked
# against it. A gate that only asserted "some server answered" would pass
# against the local container while claiming a community server.
#
# THE TWO ARMS DIFFER IN EXACTLY ONE FLAG, AND DELIBERATELY:
#   local   relay WITH --allow-private, because bridge/policy.mjs refuses
#           loopback and the local control arm is loopback.
#   remote  relay WITHOUT it, because that is the shipped posture and the run
#           is then also evidence that the destination policy ADMITS a genuine
#           public address while still refusing private ranges.
# So a remote run that quietly fell back to the container could not work: the
# policy would refuse 127.0.0.1 and new_dataErrors in the B6 verdict would be
# non-zero. The arms cannot be confused for each other.
set -e
OUT=$1; ADDR=$2; PORT=$3; ARM=$4
if [ -z "$OUT" ] || [ -z "$ADDR" ] || [ -z "$PORT" ] || [ -z "$ARM" ]; then
  echo "usage: $0 <out-dir> <address> <port> <local|remote>" >&2
  exit 2
fi
case $ARM in local|remote) ;; *) echo "arm must be local or remote, got '$ARM'" >&2; exit 2;; esac
ROOT=$(pwd)
[ -f "$ROOT/web/tools/bridge-gate-b6.steps" ] || { echo "run me from the repository root" >&2; exit 2; }
pgrep -f 'http.server 8008' >/dev/null || { echo "no static server on 8008" >&2; exit 2; }
mkdir -p "$OUT"
rm -f "$OUT/console.log" "$OUT/udp-trace.jsonl" "$OUT/relay.log" "$OUT/serverlist-watch.txt"

# The address the client will actually dial comes from the bundle, so check the
# bundle rather than trusting the argument. armagetronad.data is the preloaded
# archive and the setting is plain text inside it.
BAKED=$(strings -a web/dist-m1/armagetronad.data 2>/dev/null | grep -E '^CUSTOM_SERVER_NAME ' | tail -1 | awk '{print $2}')
BAKEDPORT=$(strings -a web/dist-m1/armagetronad.data 2>/dev/null | grep -E '^CLIENT_PORT ' | tail -1 | awk '{print $2}')
echo "bundle is built for: $BAKED:$BAKEDPORT   this arm expects: $ADDR:$PORT"
if [ "$BAKED" != "$ADDR" ] || [ "$BAKEDPORT" != "$PORT" ]; then
  echo "REFUSING TO RUN: the built bundle dials $BAKED:$BAKEDPORT, not $ADDR:$PORT." >&2
  echo "Edit web/webdefaults/autoexec.cfg and relink (make -f web/Makefile client)." >&2
  exit 1
fi

if [ "$ARM" = local ]; then
  docker inspect -f '{{.State.Status}}' aa-server 2>/dev/null | grep -q running || {
    docker rm -f aa-server >/dev/null 2>&1 || true
    docker run -d --name aa-server -p 4534:4534/udp aa-dedicated >/dev/null
    sleep 5; }
  [ "$(docker inspect -f '{{.State.Status}}' aa-server)" = running ] || { echo "the container is not up" >&2; exit 1; }
fi

pkill -f 'relay.mjs --port 8010' >/dev/null 2>&1 || true
pkill -f 'bridge-rtt-relay.mjs' >/dev/null 2>&1 || true
sleep 1
if [ "$ARM" = local ]; then
  nohup node web/tools/bridge-rtt-relay.mjs --port 8010 --allow-private --trace "$OUT/udp-trace.jsonl" > "$OUT/relay.log" 2>&1 &
else
  nohup node web/tools/bridge-rtt-relay.mjs --port 8010 --trace "$OUT/udp-trace.jsonl" > "$OUT/relay.log" 2>&1 &
fi
sleep 2
grep -q 'listening on ws://127.0.0.1:8010' "$OUT/relay.log" || { echo "the relay did not come up" >&2; cat "$OUT/relay.log"; exit 1; }
if [ "$ARM" = remote ]; then
  grep -q 'private destinations ALLOWED' "$OUT/relay.log" && { echo "the remote arm must NOT allow private destinations" >&2; exit 1; }
fi
echo "relay: $(head -1 "$OUT/relay.log")"

# ---- the master list, watched WHILE we are on the server ---------------
# The far end's own account of who is on it, from a third party. Two things it
# settles that nothing on this machine can: that the server was empty when we
# arrived, and that nobody else joined while we were there. It is a courtesy
# check as much as an evidence one -- the rule for this gate is never to take a
# slot on a server someone is playing on.
#
# THIS ONE SMALL BLOCK GOT THREE THINGS WRONG IN A ROW, and all three are named
# because it is a CONDUCT guard -- the check that says "nobody else is on this
# server" -- which is the worst possible place for a reading nobody looks at
# twice.
#
#   1. It polled every 20 s. That is a third-party service this project is a
#      guest on, exactly like the game server, and the same restraint applies.
#      It is once a minute now, and capped at fifteen polls.
#   2. The reading was silently wrong even when the fetch worked. A <Server>
#      element in that document puts each attribute ON ITS OWN LINE, so the
#      original shell pipeline, which required host= and port= to match the same
#      line, could only ever print "?". It never once reported a number.
#   3. The python replacement got HTTP 403 every time and I wrote that down as
#      rate-limiting. IT WAS NOT, and that diagnosis is corrected here rather
#      than quietly dropped: corsapi.armanelgtron.tk rejects the default
#      `Python-urllib/3.x` User-Agent and answers 200 to a curl-like one --
#      measured both ways, side by side, same second. Hence the header below.
#      Do not remove it, and do not re-diagnose a 403 here as "we polled too
#      hard" without testing the User-Agent first.
#
# It prints the server's NAME alongside the count, so a mis-identified server is
# visible rather than inferred, and it prints an HTTP failure with its status
# code, so that a future 403 cannot be waved away as "the service was busy".
if [ "$ARM" = remote ]; then
  ( python3 - "$ADDR" "$PORT" "$OUT/serverlist-watch.txt" <<'PY'
import re, sys, time, urllib.request
addr, port, path = sys.argv[1], sys.argv[2], sys.argv[3]
out = open(path, 'a', buffering=1)
URL = 'https://corsapi.armanelgtron.tk/servers_link/serverlist.php'
for _ in range(15):
    try:
        req = urllib.request.Request(URL, headers={'User-Agent': 'curl/8.7.1'})
        x = urllib.request.urlopen(req, timeout=25).read().decode('utf-8', 'replace')
        row = 'not listed'
        for b in re.findall(r'<Server\b(.*?)>', x, re.S):
            g = lambda k: (re.search(k + r'="([^"]*)"', b) or [None, ''])[1]
            if g('host') == addr and g('port') == port:
                row = 'numplayers=%s of %s  %s' % (
                    g('numplayers'), g('maxplayers'),
                    re.sub(r'0x[0-9a-fA-F]{6}', '', g('name')))
                break
    except Exception as e:
        row = 'fetch failed: %s %s' % (type(e).__name__, getattr(e, 'code', ''))
    out.write(time.strftime('%H:%M:%SZ', time.gmtime()) + ' ' + row + '\n')
    time.sleep(60)
PY
  ) &
  WATCH=$!
fi

echo "--- arm $ARM: driving ($ADDR:$PORT) ---"
node web/tools/drive-browser.mjs --headed --out "$OUT" \
  --url "http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010" \
  --script-file "$ROOT/web/tools/bridge-gate-b6.steps" > "$OUT/driver.txt" 2>&1 \
  || echo "(driver exited non-zero, see $OUT/driver.txt)"
[ -n "$WATCH" ] && { kill "$WATCH" 2>/dev/null || true; }
pkill -f 'bridge-rtt-relay.mjs' >/dev/null 2>&1 || true
if [ "$ARM" = local ]; then docker logs aa-server > "$OUT/server.log" 2>&1; fi

python3 web/tools/bridge-rtt.py "$OUT/udp-trace.jsonl" --peer "$ADDR" > "$OUT/rtt.json" 2>&1 || true

echo "--- arm $ARM done: $OUT ---"
echo "verdicts:"
grep -o '\[BRIDGEGATE\] [A-Z0-9-]* [a-z-]*' "$OUT/console.log" | sed 's/^/  /' || true
echo "PASS true:  $(grep -c '\[console.log\].*BRIDGEGATE.*"PASS":true' "$OUT/console.log" || true)"
echo "PASS false: $(grep -c '\[console.log\].*BRIDGEGATE.*"PASS":false' "$OUT/console.log" || true)"
echo "the address the page says it talked to (must be $ADDR, and nothing else):"
grep -o '\[BRIDGE\] peer [^ ]* -> [^ ]* ([a-z]*)' "$OUT/console.log" | sort -u | sed 's/^/  /' || true
echo "the destinations the relay's own UDP socket used:"
python3 -c "import json,sys,collections;c=collections.Counter();
[c.update([json.loads(l)['addr']+':'+str(json.loads(l)['port'])]) for l in open(sys.argv[1]) if l.strip()];
[print('  %s %d datagrams'%(k,v)) for k,v in c.most_common()]" "$OUT/udp-trace.jsonl" || true
echo "round trip (see $OUT/rtt.json):"
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));
print('  udp leg  ', json.dumps(d['forward_relay_to_server_ms']));
print('  browser leg', json.dumps(d['reverse_relay_to_browser_ms']))" "$OUT/rtt.json" 2>/dev/null || echo "  (no rtt.json)"
echo "full-path round trip, as the page measured it:"
grep -o '\[console.log\] \[BRIDGEGATE\] RTT .*' "$OUT/console.log" | tail -1 | sed 's/^/  /' || true
echo "Emscripten abort in the transcript (must be 0):"
grep -icE 'abort\(|Aborted\(|RuntimeError: abort' "$OUT/console.log" | sed 's/^/  /'
if [ "$ARM" = remote ]; then
  echo "what the master list said about $ADDR:$PORT while we were on it:"
  sed 's/^/  /' "$OUT/serverlist-watch.txt" 2>/dev/null || true
fi
