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

## Map downloads (`/resource`)

When a server runs a map the client does not have, the game downloads it.
Natively that is a plain TCP connection to `resource.armagetronad.net:80`; a
page can open no TCP at all, and cannot `fetch()` that server directly because
it sends no `Access-Control-Allow-Origin`. So the page asks the relay, which
already faces the internet on its behalf (`resource.mjs`).

    GET /resource?url=<encodeURIComponent(absolute URL)>          loopback, or an allowlisted page
    GET /<token>/resource?url=<encodeURIComponent(absolute URL)>  token holders

**Admission is the same as for a WebSocket upgrade.** A request that is not
admitted gets a bare `404` with no CORS header — the same answer as any other
unknown path, so probing reveals nothing. Every admitted answer, refusals
included, carries `Access-Control-Allow-Origin` (the request's Origin) and
`Vary: Origin`; without it the page would see a network error instead of the
reason.

**What it will fetch:** only hosts on the list (default
`resource.armagetronad.net`), only `http:`/`https:`, no credentials in the URL,
only paths ending `.xml`, at most 1,000,000 bytes, within 10 s, and at most 3
redirects — each hop checked again.

| answer | meaning |
|---|---|
| 200 | the map, `text/xml`, cacheable for a day |
| 400 | no `?url=` |
| 403 | the URL is refused by the policy above (the body says why) |
| 404 | the repository has no such file |
| 429 | this client asked for more than 30 a minute (burst 10) |
| 502 | upstream error, too large, too many redirects, or unreachable |
| 503 | 8 downloads already in flight across all clients |
| 504 | upstream did not answer within 10 s |
| 500 | an unexpected error in the handler — logged; the relay keeps running |

**`BRIDGE_RESOURCE_HOSTS`** — comma-separated `URL.host` values (`host` or
`host:port`). It **replaces** the default, so list `resource.armagetronad.net`
too if it should stay allowed. `none.invalid` refuses everything (the map
gates use it so nothing leaves the machine). The game falls back to the
official repository after a server's own one, so a server that hosts maps
elsewhere is served only once its host is listed.

**The log line** is `resource <status> <bytes> <url> (<client ip>)`, with
anything outside printable ASCII in the URL re-escaped so a URL cannot forge a
line. Maps worth bundling into the page (`web/resource-bundle.txt`):

    fly logs -a armagetronad-bridge | grep -o 'resource 200 [0-9]* [^ ]*' | sort | uniq -c | sort -rn

Repository hosts players were refused, the evidence for widening
`BRIDGE_RESOURCE_HOSTS`:

    fly logs -a armagetronad-bridge | grep -o 'resource 403 0 [a-z]*://[^/ ]*' | sort | uniq -c | sort -rn

## Abuse controls

Every web player reaches game servers from the relay's one address, so a
server can't tell web players apart, and an IP ban there hits all of them. The
relay sees each player's real address and can act on one player instead.

- **`BRIDGE_BLOCK_CLIENTS`**: comma-separated real player addresses the relay
  refuses outright (403, logged as `refused a blocked player (<ip>)`). These
  are personal data: set them as a **secret**, never in `fly.toml` or the
  repository.
- **`BRIDGE_BLOCK_SERVERS`**: comma-separated game servers whose owners asked
  not to receive web players, as `ip` (every port) or `ip:port`. Nothing is
  sent to them, and the client gets an error saying the server does not take
  web players.
- **The playing log:** once a connection has sent 100 datagrams to one
  server, the relay logs `<player ip> is playing on <server ip:port>` once.
  The server browser's pings (one or two each) aren't logged. This is what
  ties an abuse report ("this name, at this time, on my server") to a real
  address:

      fly logs -a armagetronad-bridge | grep 'is playing on <server ip>'

Changing a secret restarts the relay, which drops current games:

    fly secrets set BRIDGE_BLOCK_CLIENTS=198.51.100.23 -a armagetronad-bridge
    fly secrets set BRIDGE_BLOCK_SERVERS=203.0.113.5:4534 -a armagetronad-bridge

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
- `resource.mjs` — the `/resource` map-download route's URL policy and fetcher
- `relay.mjs` — the server itself
- `test/` — `node --test`
