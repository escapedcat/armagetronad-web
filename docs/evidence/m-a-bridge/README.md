# M-A: the multiplayer bridge — evidence

The browser client's UDP is carried over a WebSocket to a local Node relay
(`bridge/relay.mjs`), which speaks UDP to a stock Armagetron server. Everything
here was measured against `aa-dedicated`, a dedicated server built from **this**
source tree and run in Docker on the same machine; nothing in this directory
touched a community server.

| directory | what it holds |
| --- | --- |
| `task2/` | the relay, the client interception, and the address-mapping fix |
| `b1/`, `b2/` | Task 3: a browser player joins a real server and finishes a round |
| `task4/steer/`, `task4/steer2/` | **did a steering keypress reach the server** — the control and steering arms, run twice |
| `task4/loss/` | what 5 % packet loss costs, and what a dropped connection does |
| `task4/prove-*.log` | the checks in this task, run against the case they are meant to catch, failing |

---

## 1. A steering keypress reaches the server

**This is the question Task 3 left open and it is now closed.** Task 3 proved,
from the server's own log, that a browser player logs in, joins the roster,
plays and dies. It did not prove that a *steering keypress* arrived, and it said
so: nothing in this tree logs per-turn state.

### Why the obvious instruments do not work

- **There is no per-turn or position ladder-log entry.** The writers are
  enumerable — `src/tron/gGame.cpp:3130`, `src/tron/gCycle.cpp:3236`,
  `src/engine/ePlayer.cpp:6555`, `src/engine/eTeam.cpp:220` — and none fires on
  a turn.
- **A round's duration says nothing**, because with the shipped config the
  round ends when the AIs are done. `b2/server.log` has three of them (LaTeX,
  Gcc, Gdb) entering the game.
- **The death cause does not separate the cases.** `gCycle::KillAt` credits a
  death as suicide whenever no enemy influence is attributed
  (`src/tron/gCycle.cpp:3276`), which covers the rim and one's own wall alike —
  and an AI's wall can cross a straight path anyway.

### The instrument that does work: the server's own simulation clock

`bridge/test-server/steer-var/autoexec.cfg` is mounted as the server's var
directory, which `st_LoadConfig` reads last (`src/tools/tConfiguration.cpp:993`),
so every line in it is a hard override. It does two things:

1. **Empties the arena of AIs** (`TEAM_BALANCE_WITH_AIS 0`, `MIN_PLAYERS 1`), so
   the arena holds exactly one cycle: the browser player's. The only things that
   can kill it are the rim and its own wall. The server's own log confirms the
   emptiness — one `entered the game` line, for `web_user`, and no other.
2. **Timestamps its own ladder-log** (`LADDERLOG_GAME_TIME_INTERVAL 0.25`,
   `CONSOLE_LADDER_LOG 1`), so `gGame::GameLoop` writes `[L] GAME_TIME <t>`
   every quarter second with `se_GameTime()` — the server's simulation clock,
   reset each round (`src/tron/gGame.cpp:4340`).

The observable is therefore **how long, in server game-seconds, the server kept
the browser player's cycle alive**, read off the last `[L] GAME_TIME` line
before the server's own `[L] DEATH_SUICIDE web_user`. Nothing about that reading
passes through the browser, and it is collected from `docker logs aa-server`
after the browser is gone.

### Both arms were run. The control pressed nothing.

`web/tools/run-steer-arm.sh` refuses to run a control arm whose measurement
window contains any key step, and refuses a steering arm whose window contains
none. Both arms are otherwise the same file, the same menu walk, and the same
180-second window.

| | rounds | survival on the server's clock | spread |
| --- | --- | --- | --- |
| **control** — no key pressed at all | 12 | **5.19 s – 5.50 s** | 0.30 s |
| **steer** — `key:Left` every 2.0 s, 90 times | 10 | **2.63 s – 21.66 s** | 19.03 s |

Per-round, steering: 13.95, 2.63, 3.17, 9.58, 4.65, **21.66**, 4.16, 5.22,
3.63, 9.85 s. Control, all twelve: 5.50, 5.25, 5.26, 5.22, 5.44, 5.44, 5.42,
5.24, 5.21, 5.21, 5.19, 5.22 s.

### Two independent readings of the same proof

1. **The steering arm outlived the no-steer bound by +16.17 s** (21.66 s against
   a measured 5.50 s ceiling — 3.9×). The server simulates that cycle. For the
   server's clock to record a longer life, the server's cycle must have turned,
   whatever the browser was drawing on its own screen.
2. **Five of the ten steering rounds ended *sooner* than the control's fastest
   round** (2.63, 3.17, 4.16, 3.63, 4.65 s against 5.19 s). A cycle going
   straight cannot reach a wall before it reaches the rim, because there is
   nothing else in the arena. An early death is a direction change — and this is
   the reading that rules out the alternative explanation, a key bound to the
   *brake* rather than to a turn: braking can only ever delay the rim, never
   bring a wall closer.

Corroborating, from the server's own byte counters: 70 036 bytes received in the
control arm against 78 588 in the steering arm.

**Verdict: a steering keypress reaches the server through the bridge.** The
turns arrive. Run `python3 web/tools/steer-differential.py
docs/evidence/m-a-bridge/task4/steer` to re-derive all of the above from the two
server logs; it exits 0 only for a proof, 1 for not-proven and 2 when it refuses
to compare the two arms at all.

### Replicated, in a second independent pair of arms

`task4/steer2/` is the whole thing run again — same template, same 2.0 s turn
interval, same 180 s window, a fresh container each arm.

| | rounds | survival on the server's clock | spread |
| --- | --- | --- | --- |
| control, run 1 | 12 | 5.19 s – 5.50 s | 0.30 s |
| control, run 2 | 12 | 5.18 s – 5.50 s | 0.31 s |
| steer, run 1 | 10 | 2.63 s – **21.66 s** | 19.03 s |
| steer, run 2 | 11 | 2.84 s – **11.38 s** | 8.54 s |

The two controls agree to a hundredth of a second at both ends, over 24 rounds
between them, with no key pressed in either. That agreement is worth as much as
the differential: it says the no-steer bound is a property of the arena and the
cycle's speed, not a lucky run. Run 2's steering arm beat it by +5.88 s and had
**7 of 11** rounds finish sooner than the control's fastest. Both runs prove it
on both counts; `task4/steer2/verdict.log` is the second run's full output.

Run 2 also confirms the one defect run 1 exposed in the *client-side context*
line — which is context, never the verdict. Run 1 reported `PASS:false` on it
purely because it asked for an instantaneous `pending === 0` and measured 1: one
datagram the relay had delivered that C++ had not yet drained. The check now
samples twice, and run 2's control reads `"pending_before":1,"pending_after":0,
"draining":true` — the same race, correctly handled.

`task4/prove-steer-guard-can-fail.log` is that refusal, demonstrated: the
steering arm's log is swapped for `b2/server.log`, which has three AIs in it,
and the analyser reports `VERDICT: INVALID` and exits 2 rather than producing a
number from an arena it cannot reason about.

---

## 2. What packet loss costs

`bridge/relay.mjs --drop <fraction>` throws away that fraction of the datagrams
passing through, in both directions, and logs a running count. The whole of
`web/tools/bridge-gate.steps` was then run twice — once against a clean relay,
once against `--drop 0.05` — with everything else identical:
`web/tools/run-bridge-loss-arm.sh`.

**Read this before the numbers, because it bounds all of them.** `--drop`
discards at the relay, so what it models is loss on the **relay-to-server UDP
leg**. The browser-to-relay leg is a WebSocket and was lossless throughout:
WebSocket is TCP, so a datagram cannot be *lost* there — it can only be
*delayed*, behind whatever segment is being retransmitted. **That head-of-line
stall is the actual argument for WebTransport, and this measurement does not
contain it.** These numbers are a lower bound on what a lossy path costs a
browser player, not the whole bill. Producing the other half needs an option
that stalls the WebSocket leg, which `--drop` is not; that belongs to M-D.

### Round-trip cost

Both arms reached all seven verdicts, `PASS:true`, no `PASS:false`, and no
Emscripten abort. From the driver's own elapsed-ms stamps:

| | clean | 5 % loss | delta |
| --- | --- | --- | --- |
| connect → the server sent a roster | 0.73 s | 1.05 s | **+0.32 s (+44 %)** |
| connect → round 1 started | 0.61 s | 0.67 s | +0.07 s (+11 %) |
| round 1 started → round 1 scored | 14.03 s | 15.86 s | **+1.82 s (+13 %)** |
| round 2 → round 3 | 12.69 s | 13.24 s | +0.55 s (+4 %) |
| connect → two full rounds scored | 27.33 s | 29.77 s | **+2.44 s (+9 %)** |

The resend layer is visibly doing the work: the client sent **336** datagrams on
its live handle in the clean arm against **376** under loss (+12 %), and the
server's own counters agree — 374 packets received against 398. The relay
reported discarding 50+ datagrams in the loss arm and 0 in the clean one, which
is the only place the loss shows up at all; nothing inside the page can see a
datagram that never arrived.

### The tail, which is the part worth arguing about

Inter-arrival gaps between datagrams delivered to the page, in ms, from a
sampler wrapped around the live WebSocket. Reported as percentiles and a
maximum, because a mean hides exactly what loss does.

| phase | arm | n | p50 | p90 | p99 | max | >100 ms | >250 ms | >500 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| through B3 | clean | 151 | 20.9 | 146.3 | 919.2 | 996.1 | 25 | 14 | 4 |
| through B3 | loss | 161 | 24.4 | 226.0 | 881.8 | 1007.1 | 34 | 15 | 3 |
| through B4 | clean | 295 | 20.9 | 244.6 | 919.2 | 996.1 | 54 | 29 | 8 |
| through B4 | loss | 311 | 24.9 | 232.1 | 893.7 | 1007.1 | 61 | 28 | 8 |

**Written down as measured: 5 % far-leg loss did not measurably worsen the
delivery tail.** The median moved by 4 ms. p90, p99 and the count over 500 ms
are the same within noise, and p99 is very slightly *better* under loss, which
is noise and not an effect.

And a caveat that matters more than the delta: **the ~900 ms p99 and ~1 s
maximum are present in the clean arm too**, and they are almost certainly
legitimate quiet periods rather than stalls — a round transition tears down and
rebuilds the grid and runs a countdown, during which the server sends nothing,
and there were four of them in each run. Any future version of this measurement
should window the sampler to inside a round. As it stands the tail column says
"the bridge is not adding stalls", not "the bridge has no stalls".

### So what does this say about WebTransport?

Honestly: **less than the brief hoped, and the reason is instructive.** The
game's own resend layer absorbs 5 % loss on the far leg at a cost of roughly a
tenth of a round, which is a good result for playability and a weak argument for
changing transport. The argument for WebTransport is head-of-line blocking on
the *browser* leg, and `--drop` cannot exercise it by construction. M-D needs a
delay/stall option on the WebSocket leg, not a drop option, and until it has one
the case for WebTransport here rests on the mechanism rather than on a
measurement.

---

## 3. A dropped connection, mid-round

B5 kills the **relay process** from the shell — `web/tools/run-bridge-loss-arm.sh`
waits for B5's own mark to appear in the transcript and kills the relay four
seconds into B5's window, so the far end goes away without telling anyone. (The
brief asked for `eval:AABridge.ws.close()`; that would in fact have worked, since
`AABridge` is a page global on this build and every verdict in the gate reads it
— but a scripted close is the client asking politely, and the failure worth
testing is the far end vanishing.)

In both arms, identically:

```
[BRIDGEGATE] B5 the-far-end-went-away-and-the-module-is-still-running
{"ws_readyState":3,"state":2,"raf_ticking":true,"sendFailures":0,
 "dropped":0,"canvas_w":1024,"canvas_h":768,"gl_err":0,"PASS":true}
```

`[BRIDGE] closed` was logged within the window, the browser's own
`readyState` went to 3 (CLOSED), the bridge's own flag went to 2, and
**two nested `requestAnimationFrame` callbacks still arrived** — the module is
still running, not merely still resident. No Emscripten abort in either
transcript, so nothing re-entered C++ from a socket event. The client neither
hung nor crashed.

`raf_ticking` is the check that earns its place: a wedged Asyncify stack leaves
the canvas its old size and GL its old state, so the canvas-and-GL check that
the other verdicts use would have passed straight over a module that had stopped
running. A module that has stopped running does not paint.
