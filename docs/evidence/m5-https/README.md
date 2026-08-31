# M5 task 3 — the multiplayer menu over `https:`

**Conclusion: leave the behaviour alone, and this directory is why.** Over
HTTPS the wasm client makes ~5x as many blocked WebSocket attempts as it does
over HTTP, and **nothing a visitor can see changes** — same screens, same
order, same ~20 seconds. The extra attempts exist only in devtools. The one
alternative fix that would have removed them was measured working and declined
on other grounds; see "The one alternative that works" below.

Everything below was measured on this branch's client build
(`web/dist-m1/armagetronad.wasm`, the `-O2 -sASSERTIONS=1` link from task 2).

## Re-derive the numbers

    node docs/evidence/m5-https/count-ws-attempts.mjs

Reads the seven committed transcripts and counts each run twice — once from the
page's own wrapped `WebSocket` constructor, once from the browser's log lines.
Exits non-zero if any run's two counts disagree. They all agree.

## Re-run the measurement

    node web/tools/make-rig-cert.mjs /tmp/rig
    node web/tools/serve-https.mjs --dir web/dist-m1 --port 8443 \
         --cert /tmp/rig/cert.pem --key /tmp/rig/key.pem &
    python3 -m http.server 8000 --directory web/dist-m1 &

    # https, Chrome, page NOT in a certificate-error state
    node web/tools/drive-browser.mjs --headed --out /tmp/mp-https \
         --url https://localhost:8443/armagetronad.html \
         --chrome-flag "--ignore-certificate-errors-spki-list=$(cat /tmp/rig/spki.txt)" \
         --script-file web/tools/https-multiplayer.steps

    # the http control -- identical except for the URL
    node web/tools/drive-browser.mjs --headed --out /tmp/mp-http \
         --script-file web/tools/https-multiplayer.steps

`web/tools/https-multiplayer.steps` carries the route and why it is three
Enters and no Downs.

## What was counted, and on what basis

**Connection attempts** = invocations of the page's `WebSocket` constructor,
which the steps file wraps before `callMain`. That is the count of attempts the
**wasm module made**, independent of what the browser logged. The browser's own
log lines are counted separately and agree with it in all seven runs.

**Span** = first to last attempt, from `performance.now()` inside the page.

| run | origin | browser | certificate | attempts | span | distinct URLs |
|---|---|---|---|---|---|---|
| `mp-http`            | `http://localhost:8000`   | Chrome 152  | n/a                       |  **19** | 16.4 s | 4 |
| `mp-http-ff`         | `http://localhost:8000`   | Firefox     | n/a                       |  **27** | 18.7 s | 4 |
| `mp-https`           | `https://localhost:8443`  | Chrome 152  | SPKI-list (**valid**)     |  **98** | 20.0 s | 4 |
| `mp-https-certerr`   | `https://localhost:8443`  | Chrome 152  | blanket ignore (**error state**) | **100** | 20.0 s | 4 |
| `mp-https-demohost`  | `https://demo.example:8444` | Chrome 152 | SPKI-list, `--host-resolver-rules=MAP` | **100** | 20.0 s | 4 |
| `mp-https-ff`        | `https://localhost:8443`  | Firefox     | `acceptInsecureCerts` (**override**) |  **97** | 20.0 s | 4 |
| `mp-wss`             | `https://localhost:8443`  | Chrome 152  | SPKI-list, **scheme rewritten to `wss://`** | **19** | 17.9 s | 4 |

The four distinct URLs are the four masters in `config/master.srv` (as
`wss://` in `mp-wss`). Among the four unmodified https runs the spread — 97,
98, 100, 100 — is run-to-run jitter in a 0.25 s resend loop, not a difference
of kind. `mp-wss` is a deliberate intervention and is not part of that group.

## Two dispatch claims this corrects

- **"5 failed `ws://master*` attempts" over `http:` is wrong.** It is **19** in
  Chrome and **27** in Firefox, by both counting methods. 5 is close to the
  number of *distinct* things in the transcript (4 masters, or 4 "closed before
  the connection is established" warnings), which is probably where it came
  from.
- **"97 blocked mixed-content retries in 26 s"** — the count reproduces (97-100
  across three https runs); the **26 s does not**. First-to-last attempt is
  **20.0 s** in every https run, and 20.0 s is not a coincidence: it is
  `sn_Connect`'s `tSysTimeFloat()+5` timeout (`nNetwork.cpp`) once per master,
  four masters.

## What the visitor actually sees — the same thing on both schemes

In **all seven runs**, after Enter on "Online Multiplayer":

1. **A black screen**, sampled black at +2 s, +5 s, +10 s and +15.5 s.
2. **"Master servers do not answer"**, a fullscreen message, present in the
   +20.6 s shot. It **blocks until a key is pressed** — `GetFromMaster`
   (`nServerInfo.cpp`) passes a 3600-second timeout to `tConsole::Message`.
3. **Enter** → the Server Browser, showing **"Sorry, no server found :-("**.
4. **Enter** again → the "Host Network Game" menu, because "Host Game" is the
   selected row. The client is alive, `glGetError` 0x0.

Shots 06 / 10 / 11 / 17 in each run directory are those four states. The black
period is bracketed by measurement at [+15.5 s, +20.6 s] and pinned by the last
connection attempt at **+20.0 s**, which is the moment the fourth master times
out and the message goes up.

**The black screen is not an HTTPS problem and is not task 3's.** It is
identical on `http:`, it is the same duration, and it is what this port does
today on this route — `BrowseSpecialMaster` sets `sr_con.fullscreen = true` and
the game's own "Connecting to Master Server N..." lines are not visible on the
canvas. Recorded here because "what the user sees" was the question; **not
diagnosed**, because nothing was measured about *why*.

## Why the two schemes differ by 5x, mechanically

Emscripten maps the game's UDP socket onto one WebSocket per destination
(`SOCKFS.websocket_sock_ops.createPeer`, `deps/emsdk/upstream/emscripten/src/lib/libsockfs.js`).
`sendmsg` in that same file re-creates the peer whenever its socket is
`CLOSING` or `CLOSED`:

    if (!dest || dest.socket.readyState === dest.socket.CLOSING
              || dest.socket.readyState === dest.socket.CLOSED) {
      dest = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
    }

The game resends its login packet every 0.25 s for 5 s per master
(`sn_Connect`, `nNetwork.cpp`: `static REAL resend = .25`).

- Over `http:` the socket goes to **CONNECTING** and stays there while the TCP
  connect is in flight, so most resends reuse the same peer. All four masters
  eventually answer with `net::ERR_CONNECTION_REFUSED` — **TCP 4533 is
  refused**, measured for all four hosts in `mp-http/console.log`.
- Over `https:` the mixed-content check fails the socket immediately, so it is
  `CLOSED` by the next resend and every resend creates a new one. ~24 per
  master x 4 masters.

**The 5 s-per-master timeout is what bounds the wall clock, not the socket
failure mode** — which is why the visible timing is the same on both schemes.

## Was the self-signed rig a valid stand-in for GitHub Pages?

Two controls, because "a self-signed cert only affects that connection" is the
kind of thing that should be checked rather than asserted.

- **Certificate state.** `mp-https` used
  `--ignore-certificate-errors-spki-list`, which makes Chrome consider the key
  **valid** — the transcript contains **no certificate diagnostic of any kind**.
  `mp-https-certerr` repeated the run with blanket
  `--ignore-certificate-errors`, which leaves the tab in a certificate-**error**
  state. 98 vs 100 attempts, same message, same screens. **The certificate does
  not enter into it.**
- **Hostname.** `localhost` is a potentially trustworthy origin on its own, so a
  measurement taken only there cannot rule out the hostname as the cause.
  `mp-https-demohost` served the same files at `https://demo.example:8444` with
  `--host-resolver-rules=MAP demo.example 127.0.0.1` and a cert for that name:
  **100 attempts, same block message.** And in the other direction,
  `http://localhost:8000` — also potentially trustworthy — was **not** blocked
  at all. So the block follows the **scheme**, not the host.

**What the rig still cannot answer, and only a deploy can:** whether the Pages
edge does anything of its own on this path. It serves static files and cannot
affect a WebSocket the page opens to a third-party host, so there is no
mechanism by which it could — but that is reasoning, not a measurement, and
task 5's live gate should run `https-multiplayer.steps` against the real URL
and confirm the count lands in the 97-100 band. **No number in this directory
came from a real deployment.**

## The one alternative that works, and was still declined

`mp-wss` is the probe. `docs/evidence/m5-https/wss-rewrite-probe.steps` is
`web/tools/https-multiplayer.steps` with one change — the WebSocket wrapper
rewrites `ws:` to `wss:` before delegating, which is exactly the URL string
`Module.websocket = { url: 'wss://' }` would produce, since `createPeer` builds
`<prefix><addr>:<port>/` from whichever prefix it is handed. (It cannot be done
by setting `Module.websocket` from a step: `SOCKFS.websocketArgs` is captured at
`mount()`, during `initRuntime`, before any step runs.)

**It works.** Chrome drops from **98 attempts to 19** — exactly the `http:`
figure — with **zero** mixed-content lines, and shots 06/10/11/17 are the same
four screens in the same order at the same times.

It is declined anyway, and the reasons are in
`docs/porting/browser-runtime-notes.md` § 12. The short form: it does not make
the console clean, it trades 98 security errors for 19 network errors, and the
ones it removes are the informative ones — "this endpoint must be available
over WSS" is the complete explanation of why browser multiplayer cannot work,
and "connection refused" is not. It would also apply to every socket the client
opens, send TLS handshakes to third-party ports measured refused, make the page
behave differently depending on how it is served, and pre-empt Phase 2, whose
design routes sockets through a bridge host rather than through a scheme
rewrite.

## For task 5: this route trips two existing pass criteria

- The Firefox driver records these as **`[EXCEPTION]`** lines (194 of them over
  https: two texts per attempt). Every gate this project has written says "no
  `[EXCEPTION]`". A gate covering this route needs to allow exactly these two
  texts, by text, rather than loosening the rule.
- Chrome records 98 **`[browser.error/security]`** lines. Firefox prints **no
  mixed-content message at all** — just "Firefox can't establish a connection
  to the server at ws://...". A gate that greps for "Mixed Content" would find
  nothing in Firefox and could be read as "Firefox does not block it". It does:
  Firefox's own http control makes 27 attempts and its https run makes 97.
