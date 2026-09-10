# The bridge

A WebSocket-to-UDP relay. The browser build of the game speaks to this; this
speaks UDP to a stock Armagetron server.

The game speaks UDP and nothing else, and a browser page can never open a UDP
socket — every browser transport needs the far end to perform a handshake it
understands, and a 2003 game server understands none of them. So something
outside the page has to carry the datagrams.

## Running it

    npm install
    node relay.mjs --port 8010

Then open the client with `?bridge=ws://localhost:8010`.

For a server on your own machine (a Docker container, say), add
`--allow-private` — without it the relay refuses to send to loopback and
private ranges, which is what stops it being pointed at things it shouldn't be.

## `--drop <fraction>` is a testing aid and nothing else

    node relay.mjs --port 8010 --allow-private --drop 0.05

throws away that fraction of the datagrams passing through, in both
directions, and logs a running count every 25 of them. It exists so a gate can
ask what the game does when datagrams go missing — the question WebSocket makes
interesting, because WebSocket is TCP: a lost segment stalls everything queued
behind it, so the game's own resend layer is what has to cope, and the cost of
that is a measurement rather than a guess. `web/tools/bridge-gate.steps` uses
it for B4, and `docs/evidence/m-a-bridge/README.md` has the numbers.

It is not a network emulator, it is not a fault injector for anything else,
and it must never be on in a run whose purpose is anything but measuring loss:
the option is silent from inside the page (a datagram that never arrives leaves
no trace there), so the relay's own log is the only place the loss shows up.
BIND/BOUND/CLOSE/ERROR are never dropped — those are the relay's control
channel, not the network path being modelled.

## Scope

This is the M-A relay: local only. No TLS, no authentication, no rate limits,
no metrics. It binds to 127.0.0.1 and is not meant to be reachable from
anywhere else. Making it safe to expose is M-C.

## Layout

- `frame.mjs` — the wire format, shared with `web/library_bridge.js`
- `policy.mjs` — which destinations are allowed
- `relay.mjs` — the server itself
- `test/` — `node --test`
