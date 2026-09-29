#!/usr/bin/env python3
"""Turn a UDP trace from web/tools/bridge-rtt-relay.mjs into round-trip times.

    python3 web/tools/bridge-rtt.py <udp-trace.jsonl> [--peer 188.245.106.232]

WHAT IS PAIRED, AND WHY IT IS A ROUND TRIP AND NOT A GAP.  Armagetron
acknowledges every reliable message by id: nWaitForAck::Ackt
(src/network/nNetwork.cpp:846) computes `netTime - ack->timeFirstSent` when the
ack arrives, and that is the number the score table prints as "ping".  The
tracer records every datagram crossing the relay's UDP socket with its parsed
messages, so the same pairing is recoverable from outside the game.

TWO DIRECTIONS, TWO DIFFERENT QUESTIONS.  Both are measured at the relay's
socket, so each excludes the half of the path on the other side of it:

  forward  a message the CLIENT sent (relay -> server) and the server's ack
           coming back (server -> relay).  This is the network and the server:
           it contains no browser and no WebSocket at all.

  reverse  a message the SERVER sent (server -> relay) and the client's ack
           going back out (relay -> server).  The datagram had to cross the
           WebSocket, be drained by the page, be processed by the wasm game
           loop, and come back.  This is THE BRIDGE'S OWN COST, and it is the
           same quantity in a local run and a remote one -- which is what
           makes the local arm a control rather than a curiosity.

WHAT NEITHER NUMBER IS.  An ack is not sent the instant a message arrives: the
game collects acks and flushes them on its next send opportunity, so both
columns carry one send-cadence of batching delay on top of the wire time.  That
delay is a property of the game, not of the bridge, and it is present in both
arms -- so compare arms, and do not read either absolute figure as pure wire
latency.  Message ids are 16 bits and wrap; the pairing keeps one outstanding
send per raw id and drops it once paired, so a wrap can misattribute at most a
sample or two.  `n` is printed so a reader can weigh that.
"""
import json
import sys


def pct(xs, p):
    if not xs:
        return None
    i = min(len(xs) - 1, int(p * len(xs)))
    return round(xs[i], 3)


def summarise(name, xs):
    xs = sorted(xs)
    return {
        'what': name,
        'n': len(xs),
        'min': round(xs[0], 3) if xs else None,
        'p50': pct(xs, .5),
        'p90': pct(xs, .9),
        'p99': pct(xs, .99),
        'max': round(xs[-1], 3) if xs else None,
        'mean': round(sum(xs) / len(xs), 3) if xs else None,
        'over100ms': sum(1 for x in xs if x > 100),
        'over250ms': sum(1 for x in xs if x > 250),
    }


def main():
    path = sys.argv[1]
    peer = None
    if '--peer' in sys.argv:
        peer = sys.argv[sys.argv.index('--peer') + 1]

    recs = []
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                recs.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    peers = {}
    for r in recs:
        peers[r.get('addr')] = peers.get(r.get('addr'), 0) + 1
    if peer is None and peers:
        peer = max(peers, key=peers.get)

    # Only datagrams to/from the peer under test.  A run that also did a LAN
    # browse has datagrams to other destinations in the same trace, and mixing
    # them would pair an id across two conversations.
    recs = [r for r in recs if r.get('addr') == peer]

    fwd_pending, rev_pending = {}, {}
    fwd, rev = [], []
    out_pkts = in_pkts = out_msgs = in_msgs = 0
    for r in recs:
        pkt = r.get('pkt')
        if not pkt:
            continue
        t = r['t']
        msgs = pkt.get('msgs') or []
        if r['dir'] == 'out':
            out_pkts += 1
            for m in msgs:
                if m.get('truncated'):
                    continue
                out_msgs += 1
                if m['d'] == 1:
                    for a in m.get('acks') or []:
                        if a in rev_pending:
                            rev.append(t - rev_pending.pop(a))
                elif m.get('id'):
                    fwd_pending.setdefault(m['id'], t)
        else:
            in_pkts += 1
            for m in msgs:
                if m.get('truncated'):
                    continue
                in_msgs += 1
                if m['d'] == 1:
                    for a in m.get('acks') or []:
                        if a in fwd_pending:
                            fwd.append(t - fwd_pending.pop(a))
                elif m.get('id'):
                    rev_pending.setdefault(m['id'], t)

    span = round((recs[-1]['t'] - recs[0]['t']) / 1000.0, 2) if recs else 0
    out = {
        'trace': path,
        'peer': peer,
        'other_destinations_in_trace': {k: v for k, v in peers.items() if k != peer},
        'seconds_of_traffic': span,
        'udp_out_datagrams': out_pkts,
        'udp_in_datagrams': in_pkts,
        'messages_out': out_msgs,
        'messages_in': in_msgs,
        'unpaired_forward': len(fwd_pending),
        'unpaired_reverse': len(rev_pending),
        'forward_relay_to_server_ms': summarise('client message -> server ack (network + server)', fwd),
        'reverse_relay_to_browser_ms': summarise('server message -> client ack (websocket + page + wasm)', rev),
    }
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
