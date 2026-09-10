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

## Scope

This is the M-A relay: local only. No TLS, no authentication, no rate limits,
no metrics. It binds to 127.0.0.1 and is not meant to be reachable from
anywhere else. Making it safe to expose is M-C.

## Layout

- `frame.mjs` — the wire format, shared with `web/library_bridge.js`
- `policy.mjs` — which destinations are allowed
- `relay.mjs` — the server itself
- `test/` — `node --test`
