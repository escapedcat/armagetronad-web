# M-A — the multiplayer bridge, local only: one browser, one relay, one real server

**Status:** design for the maintainer's review, 2026-09-10. Nothing implemented. First milestone of Phase 2 in `PLAN.md`.

## What the maintainer asked for

> "i played it on the phone quite a bit. it's nice. but multiplayer is the most fun. what's the plan to support this?"
>
> "the biggest fun is to participate in the existing server communities"

That second line is the whole scope decision. It rules out the cheaper shapes — a private server with a single-destination relay, or a bring-your-own-bridge binary — because the fun is on **other people's servers**, which run stock software on machines we do not control.

## The constraint, stated once

`nSocket::Create` opens `socket(PF_INET, SOCK_DGRAM, IPPROTO_UDP)` and the game speaks nothing else. A browser page cannot open a UDP socket, and no browser transport (WebSocket, WebRTC, WebTransport) can reach a peer that does not perform its handshake. Community servers never will. Therefore something outside the browser must translate, for as long as those servers run unmodified. That thing is the bridge. Every other design considered on 2026-09-10 is recorded as rejected in `PLAN.md` under Phase 2.

## What M-A is, and what it is not

**M-A is local.** The bridge is a Node process on the maintainer's own machine, plain `ws`, no TLS, no VPS, no public URL, nothing anyone else can reach. The milestone exists to answer one question cheaply: **is it fun through a relay?** If the answer is no — if the latency is miserable or the game desyncs — the whole of Phase 2 stops here, having cost nothing but time.

**M-A is not** the server browser (M-B), not `wss://` or a deployed service (M-C), not authentication work, and not LAN discovery ever.

## Architecture

```
browser page ──ws──> bridge (Node, localhost) ──udp──> game server (stock, unmodified)
   wasm client            ~200 lines                    Docker locally, then a real one
```

One WebSocket per browser session. Inside it, **one bridge-side UDP socket per socket the C++ code opens**, keyed by a handle the client allocates. This matters: the game may hold more than one socket at a time (the M-B server browser pings twenty servers at once through `sn_Bend`), and a server identifies its clients by source `ip:port`. Giving each C++ socket its own UDP source port on the bridge makes a browser client indistinguishable from a native one, and makes M-B free rather than a redesign.

## Wire protocol

Binary frames, big-endian, on the WebSocket in both directions:

```
byte 0      version  = 1
byte 1      type     = 1 BIND | 2 BOUND | 3 DATA | 4 CLOSE | 5 ERROR
bytes 2-3   handle   u16   the client-allocated socket id
bytes 4-5   port     u16   destination port (client→bridge) / source port (bridge→client)
byte 6      addrLen  u8
bytes 7..   addr     ASCII, addrLen bytes: hostname or dotted quad
rest        payload  the raw UDP datagram (DATA only)
```

`BIND` claims a handle and carries no payload; the bridge answers `BOUND` or `ERROR`. `DATA` in either direction carries one datagram. `CLOSE` releases a handle. **The address travels as the text the client used, and the bridge echoes back the same text** — the client never resolves DNS, and never has to match a returned 32-bit IP against one it could not have computed.

## The C++ shim

All of it inside **`#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)`**. The original Phase 2 note said `#ifdef __EMSCRIPTEN__`; that is wrong and must not be copied — the dedicated server is also an Emscripten build, so the bare guard would rewrite its socket layer, break its ability to listen, and trip the byte pin (2,488,298 bytes / md5 `9718a2a64978cb6e9b95ea2f0454cca5`). The pin is the check that catches it if we slip.

Touched in `src/network/nSocket.cpp`, by symbol (this file's own rule: name symbols, never lines):

| Symbol | Change |
|---|---|
| `nSocket::Create` | allocate a handle from the shim's table instead of calling `socket()` |
| `nSocket::Bind`, every `nSocket::Open` overload | send `BIND`, wait for `BOUND` |
| `nSocket::Read` | pop one datagram from the shim's receive queue; `EWOULDBLOCK` semantics when empty |
| `nSocket::Write` (both overloads) | frame as `DATA` and post to the JS side |
| `nSocket::Close` | send `CLOSE`, release the handle |
| `nSocket::Broadcast` | return failure — LAN discovery cannot work from a page, and must fail quietly rather than hang |
| `nBasicNetworkSystem::Select` | check the queue; if empty, `emscripten_sleep(5)` and check again until `dt` is spent |
| `nAddress::SetHostname` | the fake-address map, below |

New `src/network/nSocketWeb.{cpp,h}` (~300 lines) holds the handle table, the receive queue and the address map. New `web/library_bridge.js` (~250 lines) is the Emscripten JS library that owns the `WebSocket` object.

### The one rule that governs the JS side

**`onmessage` only enqueues.** It never calls into C++. The client runs under Asyncify: C++ is routinely suspended mid-stack, and re-entering it from a JS event handler during an unwind corrupts the rewind. So the WebSocket handler appends bytes to a JS-side queue, and `Select` — running on the C++ stack, where sleeping is legal — drains it. Every bug in this class is invisible until it is catastrophic, so this rule is load-bearing, not stylistic.

### The fake-address map

`nAddress` stores a 32-bit IP and the game compares addresses by value. The browser cannot resolve a hostname to one. So `SetHostname` assigns each distinct host string a synthetic address from **10.42.0.0/16**, remembers `synthetic → text`, and returns success. `Write` looks the synthetic address back up and puts the original text on the wire; the bridge resolves it and echoes it back, and `Read` maps the returned text to the same synthetic address, so every `nAddress` comparison inside the game holds.

Phase 2's milestone sketch put this in M-B. It moves to M-A deliberately: a real community server is normally given as a hostname, the M-A gate needs to reach one, and splitting it would mean editing `SetHostname` twice.

## The bridge

Node, `ws` plus the built-in `dgram`, one file, no build step, no dependencies beyond `ws`. Per WebSocket connection it keeps `Map<handle, dgram.Socket>`; on `BIND` it creates a UDP socket on port 0 and answers `BOUND`; on `DATA` it resolves the address token (Node does the DNS) and sends; on a UDP `message` it frames the datagram with the token that was used and writes it back; on close it tears every socket down.

Even in a local milestone it carries a destination policy, because the habit is the point: private and multicast ranges denied, ports restricted to 4533–4599, with an explicit `--allow-private` flag for the dockerized-server step. The rate caps, Origin allowlist and metrics belong to M-C, where the thing becomes reachable.

## Gates and evidence

Evidence under `docs/evidence/m-a-bridge/`. The existing driver (`web/tools/drive-browser.mjs`) and a new `web/tools/bridge-gate.steps` do the work; the opponent is a stock dedicated server in Docker.

Setting `CUSTOM_SERVER_NAME` and `CLIENT_PORT` in `web/webdefaults/autoexec.cfg` makes `sg_TransferCustomServer` (`src/tron/gServerFavorites.cpp`) turn that address into the first bookmark when the favorites menu opens — so the gate reaches a chosen server with two keypresses and no typing.

1. **B1 — it connects.** Against the dockerized server: the client reaches `[L] NEW_ROUND` as a network client, and the server's log shows one player joining from the bridge's port.
2. **B2 — it plays.** A full round completes; the browser player's cycle moves on the server's authority (asserted from the server log, not only the client's screen).
3. **B3 — it survives loss.** With induced packet loss on the bridge's UDP side, the round still completes; the resend layer's counters are captured. This is where head-of-line blocking on the WebSocket would show, and the numbers get written down whatever they say.
4. **B4 — it survives a drop.** Killing and restarting the WebSocket mid-round produces a clean disconnect in the client, not a hang and not a crash.
5. **B5 — nothing else changed.** Single-player boots and plays with the bridge absent (no WebSocket attempted, no console error), the dedicated wasm build is byte-identical to the pin, and the existing gates — touch, portrait, layout-boot, desktop — pass unchanged.
6. **B6 — a real server.** One unmodified community server, joined from the browser, one round played, with a screenshot and the console log. This is the milestone's actual gate; 1–5 are the road to being allowed to try it.

Alongside the automated gates, one thing only the maintainer can report: **whether it feels good on the phone.** That verdict decides M-B.

## Files

- `src/network/nSocket.cpp` (guarded edits), new `src/network/nSocketWeb.{cpp,h}`
- new `web/library_bridge.js`; `web/Makefile` (`--js-library`)
- new `bridge/` — the Node relay, its `package.json`, and a README saying how to run it
- new `web/tools/bridge-gate.steps`, `docs/evidence/m-a-bridge/`
- `web/README.md` (how to point the page at a bridge), `PLAN.md` (M-A block)
- **Not** `nNetwork.cpp`, `nServerInfo.cpp`, `gServerBrowser.cpp` or `config/master.srv` — the design's claim is that the game above the socket layer needs no changes at all, and any edit to those files is a signal the design went wrong.

## What could make this fail

- **Latency through TCP under loss.** The known one. B3 measures it instead of guessing; WebTransport datagrams are the fix if it bites, and that is M-D, not M-A.
- **Asyncify re-entrancy.** Governed by the enqueue-only rule; the failure mode is a corrupted rewind, which looks like a random crash rather than a network bug, so suspect it first if crashes appear.
- **The byte pin.** Guarded by construction and enforced by CI on every push.
- **The shell preprocessor.** If `web/shell.html` gains lines, no body line may start with `#` outside a `<style>` block — Emscripten reads it as a preprocessor directive and the link fails.
- **An empty server.** The population is small and event-shaped (141 servers, 3 players on a Thursday lunchtime; ~56 on a tournament Sunday). B6 may need to wait for an evening or a Ladle.

## Out of scope, recorded

The in-game server browser and the master list (M-B). `wss://`, Caddy, a VPS, rate limits, metrics, anything public (M-C). Region picking, WebTransport, egress-IP pooling (M-D). Verifying global `user@forums` login — the client's half rides the same connection because all the authority-facing code sits behind `KRAWALL_SERVER` (`src/network/nAuthentication.cpp`), so it is expected to work, but it is not gated here. Contributing a WebSocket transport upstream so the bridge can eventually be retired: the right long-term answer, a multi-year one, and this shim is its prerequisite either way.
