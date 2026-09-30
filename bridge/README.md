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

Then open the client with `?bridge=ws://127.0.0.1:8010`.

**`127.0.0.1` and not `localhost`, in the `?bridge=` value.** The relay binds
127.0.0.1 on IPv4 only. A browser that resolves `localhost` to `::1` first gets
ECONNREFUSED and reports it as a WebSocket error, which reads exactly like a
bridge defect and is not one. The page's own origin may stay `localhost`; it is
the `ws://` URL the game dials that has to be numeric.

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

## Who may connect

On 127.0.0.1 (the default) the relay trusts whoever can reach it, because only
this machine can. Anywhere else it refuses to start unless it has at least one
way to tell who is asking:

- **`BRIDGE_TOKEN`** — a shared secret carried as the URL path,
  `wss://relay/<token>`. Whoever holds the link may connect, from anywhere.
- **`BRIDGE_ORIGINS`** — a comma-separated list of pages whose visitors may
  connect to `wss://relay/` with no token, e.g. `https://escapedcat.github.io`.
  An entry ending in `:*` allows any port (`http://localhost:*`). A connection
  from any other page, or with no `Origin` at all, gets 403.

The allowlist keeps other *websites* off the relay. It is not a lock against
anyone else: a program outside a browser can send whatever `Origin` it likes.
What bounds everybody, token or not, are the limits in `limits.mjs`:

| limit | default | on breach |
|---|---|---|
| connections from one client IP | 4 | 429 |
| connections in total | 200 | 503 |
| UDP sockets per connection | 8 | ERROR frame |
| datagrams sent per second, per connection | 200, burst 600 | dropped silently, counted in the log |
| bytes sent per second, per connection | 100 kB, burst 300 kB | dropped silently, counted in the log |
| new destinations per minute, per connection | 300 | ERROR frame, and the name is never resolved |

The burst and destination figures are sized for the in-game server browser,
which pings every listed server (~140) at once.

Behind a proxy, set **`BRIDGE_CLIENT_IP_HEADER`** to the header carrying the
player's address (`Fly-Client-IP` on Fly), or every player shares the proxy's
address and the per-IP limit becomes one global limit. Only set it behind a
proxy that overwrites that header.

## Deploying to Fly

`fly.toml` sets the allowlist and the client-IP header; the token is a secret:

    fly secrets set BRIDGE_TOKEN=<at least 16 characters> -a armagetronad-bridge
    fly deploy

The published page connects to `wss://armagetronad-bridge.fly.dev/` by
default (`web/library_bridge.js`); `?bridge=<url>` overrides it and
`?bridge=0` turns online play off.

## Layout

- `frame.mjs` — the wire format, shared with `web/library_bridge.js`
- `policy.mjs` — which destinations are allowed
- `limits.mjs` — the rate and connection limits, and the origin allowlist
- `relay.mjs` — the server itself
- `test/` — `node --test`
