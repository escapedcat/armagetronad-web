# Final whole-branch review — the fixes, and what was run against them

Everything here was produced after the branch's last commit (`13957020`), in one
pass, against the same local-only setup every other directory under
`docs/evidence/m-a-bridge/` used: a relay on `127.0.0.1:8010` and a dedicated
server built from this tree in Docker. **No community server, no master server
and no third-party host was contacted by anything in this directory.**

## What is here

| file / directory | what it holds |
| --- | --- |
| `hosting-refused/` | `web/tools/bridge-hosting-gate.steps` on the fixed build: **H1 true**, the refusal screen, and the handle table not growing |
| `hosting-unfixed/` | the same gate on a build with the two `AA_NO_HOSTING_FROM_A_PAGE` call sites deleted and nothing else changed: **H1 false** — and shot 05 is the "Host Network Game" menu that used to open |
| `no-bridge-console.log` | `web/tools/bridge-absent-gate.steps`, case (a) no `?bridge=` at all: **N1 true**, refusal in 17 ms, no `WebSocket` ever constructed |
| `bridge-gate/clean/` | the whole of `web/tools/bridge-gate.steps` re-run against a clean relay and a live `aa-dedicated` container |
| `npm-test.log` | `cd bridge && npm test` — 37/37, two of them new |
| `prove-relay-checks-can-fail.log` | the two new relay checks run against the code they fix, failing |
| `pin.log` | the dedicated wasm rebuilt from scratch, size and md5 |

## The hosting refusal is the one that mattered

`sg_HostGame()` calls `nServerInfo::TellMasterAboutMe()` whenever
`sg_TalkToMaster` is set, and `gServerBrowser::BrowseMaster()` sets it for a
whole Internet browse. The "Host Game" item sits in **every** browsed server
list, LAN and master alike, so the browser tab was a few keypresses from
publishing itself on the community's public master list as a live server that
answers nothing. A page cannot listen for UDP, so it can never actually be one.

The two runs differ in two source lines and nothing else:

|  | `hosting-refused/` | `hosting-unfixed/` |
| --- | --- | --- |
| `refusals` | 2 | 0 |
| `handles_before` → `handles_after` | 1 → 0 | 1 → **2** |
| `PASS` | true | false |

`handles_after: 2` in the unfixed run is the finding, measured: a **second**
socket was bound, which is `sn_SetNetState(nSERVER)` asking `nSocket::Create`
for something to listen on. The fixed run's handle count goes *down* instead,
because backing out of the LAN browse closes the one socket it had.

Both runs also read `sent_before: 0, sent_after: 0` — no datagram left the page
in either, so neither run could have reached a master even if one had been
configured. The refusal is what stops the announcement; the relay's destination
policy is not, and must not be mistaken for it, because master port 4533 is
inside the allowed range on purpose (M-B has to *read* the list).

## The relay's two defects were the same defect class, one step apart

`prove-relay-checks-can-fail.log` shows the echo-token check failing with
`actual: 'localhost'` where `127.0.0.1` was the destination — two names on one
IP, the reply attributed to the wrong one. Latent in M-A, which talks to one
server at a time; live at M-B, which pings twenty through one socket.
