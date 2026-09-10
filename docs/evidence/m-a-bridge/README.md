# M-A: the multiplayer bridge — evidence

The browser client's UDP is carried over a WebSocket to a local Node relay
(`bridge/relay.mjs`), which speaks UDP to a stock Armagetron server. Everything
here was measured against `aa-dedicated`, a dedicated server built from **this**
source tree and run in Docker on the same machine; nothing in this directory
touched a community server — that is task 6, and it needs the maintainer's
explicit permission first.

| directory | what it holds |
| --- | --- |
| `task2/` | the relay, the client interception, and the address-mapping fix |
| `b1/`, `b2/` | Task 3: a browser player joins a real server and finishes a round |
| `task4/steer/`, `task4/steer2/` | **did a steering keypress reach the server** — the control and steering arms, run twice |
| `task4/loss/` | what 5 % packet loss costs, and what a dropped connection does |
| `task4/prove-*.log` | the checks in this task, run against the case they are meant to catch, failing |
| `task5/single-player/` | Task 5: the four pre-existing single-player gates, run on this build with **no** `?bridge=` at all |

---

## 0. The letters, what was run, and the counting rule

The design spec (`docs/superpowers/specs/2026-09-10-m-a-multiplayer-bridge-design.md`,
"Gates and evidence") names six verdicts, **B1 through B6**. `web/tools/bridge-gate.steps`
was written before all six existed and uses its own internal labels — `B0`, `B1`, `A1`, `B2`,
`B3`, `B4`, `B5` — which do **not** line up one-to-one with the spec's numbering; Tasks 3 and 4
both record why (Task 2 had already used `B0`/`B1`/`A1` inside the file before the spec's `B1`
and `B2` existed, so the new verdicts continued the sequence rather than falsifying the labels
already committed in `task2/`). The mapping, stated once here so nobody has to reconstruct it
from three task reports:

| spec verdict | claim | `bridge-gate.steps` label(s) | evidence |
| --- | --- | --- | --- |
| **B1** — it connects | server log shows a login and a join | internal `B2` (the connect half of it) | `b1/` |
| **B2** — it plays | a full round completes, scored by the server | internal `B2`/`B3`, plus the steering instrument below | `b1/`, `b2/`, `task4/steer*/` |
| **B3** — it survives loss | round completes under `--drop 0.05` | the whole file re-run, internal `B0`…`B5` | `task4/loss/` |
| **B4** — it survives a drop | a clean disconnect, no crash | internal `B5` (`the-far-end-went-away-and-the-module-is-still-running`) | `task4/loss/` |
| **B5** — nothing else changed | pin + four single-player gates, no `?bridge=` | (not in this file — a separate run, below) | `task5/single-player/` |
| **B6** — a real server | one unmodified community server | not attempted | — |

**The counting rule for everything inside `bridge-gate.steps`:**
`grep -c '\[console.log\].*BRIDGEGATE.*"PASS":true' console.log`, counting `[console.log]`
lines only — the harness's own `[harness] until` echo repeats every needle it is waiting on,
so a raw grep over the whole file over-counts roughly threefold. Expected 7 as of Task 4 (`B0`,
`B1`, `A1`, `B2`, `B3`, `B4`, `B5`); a run of the first three alone (before a real server exists)
is still 3. For `B1`/`B2` specifically, the grep that matters is not inside the page at all —
it is `grep -iE 'Received login|entered the game' server.log`, the server's own word that a
datagram arrived from somewhere and gave that somewhere a player; every `PASS:true` line above
is a claim the *client* makes about itself, and this is the one made by the *server*.

**The counting rule for the four single-player gates (`task5/single-player/`, B5) is
different, because those gates predate this milestone and were never written to print a
single, greppable `PASS` line per check.** Some assertions print via `console.log` inside the
page; others (`SPARKSGATE D1` on desktop, most of `portrait-boot-gate.steps`) print only as the
return value of the harness's own `eval:` step, visible in the transcript as `... => "D1 true"`
after the call. The M9 reference tallies (portrait 10, landscape 8, layout-boot 3, desktop 2)
already count both forms; counting `[console.log]` lines alone under-counts (desktop reads 1,
not 2). The rule applied here, and re-derivable from any of the four committed logs: take the
text after the **last** `` => `` on a line if there is one, otherwise the whole line; find
`\[(\w+GATE)\]\s+(\S+).*?"PASS":\s*(true|false)` in it (the JSON may carry escaped quotes,
`\"PASS\":true`, when it is itself inside a quoted return value); tally `true` and `false`
separately. Applied to the **committed M9 reference logs**
(`docs/evidence/m9-layout-lock/gates/*/console.log`) it reproduces 2, 8, 10, 3 exactly, which is
what makes it the rule and not a guess.

**Exact commands, Task 5:**

```bash
docker ps                                   # aa-server up (not needed for this step, but running)
python3 -m http.server 8008 --directory web/dist-m1 &

U='http://localhost:8008/armagetronad.html'
node web/tools/drive-browser.mjs --headed                    --out .../desktop     --url "$U"              --script-file web/tools/menu-gate.steps
node web/tools/drive-browser.mjs --headed --mobile 915,412,3 --out .../landscape   --url "$U"              --script-file web/tools/touch-gate.steps
node web/tools/drive-browser.mjs --headed --mobile 412,915,3 --out .../portrait    --url "$U"              --script-file web/tools/portrait-boot-gate.steps
node web/tools/drive-browser.mjs --headed --mobile 412,915,3 --out .../layout-boot --url "${U}?autostart=0" --script-file web/tools/layout-boot-gate.steps
```

Run **one at a time**, not concurrently — the first attempt ran all four together and one
(`layout-boot`) genuinely timed out waiting on its data-file dependency for the full 90 s
budget, purely from resource contention between four headed Chrome instances on one machine;
killed and re-run alone, it passed in the low tens of seconds. That failure is not in this
directory; it was never a reading of the build, only of running four browsers at once, and is
recorded here so nobody re-learns it by repeating the mistake.

---

## 1. B1 and B2 — it connects, and it plays

**The server's own log is the claim, not the client's screen.** `grep -c 'Received login'
b1/server.log` → **1**; `grep -iE 'Received login|entered the game' b1/server.log` shows
`web_user` joining alongside three AIs (`LaTeX`, `Gcc`, `Gdb`). `b2/server.log` (a second,
longer run against the same bookmarked address) then shows the round state machine going all
the way round with the browser player scored in it: `[L] ROUND_SCORE_TEAM` names `web_user`,
not `[L] ROUND_WINNER` — `gGame::Analysis` returns immediately for `nCLIENT`, so that needle is
server-only and would time out on a browser transcript. Both directories carry the matching
`console.log`; `grep -c '\[console.log\].*BRIDGEGATE.*"PASS":true'` reads **5** in each
(`B0`, `B1`, `A1`, `B2`, `B3`) — Task 3's run, before Task 4 appended `B4` and `B5` to the same
file. The rule that produces that number is the one in §0; the file-wide total of 7 is a later
run's, not this one's.

A steering keypress reaching the server specifically — not just packets in general — needed a
second instrument, because nothing in this tree logs per-turn state. That instrument, and what
it found, is below.

## 1.1. A steering keypress reaches the server

**This is the question Task 3 left open and it is now closed.** Task 3 proved,
from the server's own log, that a browser player logs in, joins the roster,
plays and dies. It did not prove that a *steering keypress* arrived, and it said
so: nothing in this tree logs per-turn state.

### Why the obvious instruments do not work

- **There is no per-turn or position ladder-log entry.** The writers are
  enumerable — for example `gGame.cpp`'s `sg_newRoundWriter`, `gCycle.cpp`'s
  `sg_deathFragWriter`, `ePlayer.cpp`'s `se_onlinePlayerWriter` and
  `eTeam.cpp`'s `se_teamRenamedWriter` — and none fires on a turn.
- **A round's duration says nothing**, because with the shipped config the
  round ends when the AIs are done. `b2/server.log` has three of them (LaTeX,
  Gcc, Gdb) entering the game.
- **The death cause does not separate the cases.** `gCycle::KillAt` credits a
  death as suicide whenever no enemy influence is attributed, which covers the
  rim and one's own wall alike — and an AI's wall can cross a straight path
  anyway.

### The instrument that does work: the server's own simulation clock

`bridge/test-server/steer-var/autoexec.cfg` is mounted as the server's var
directory, which `st_LoadConfig` reads last (its final `Load()` call, in
`src/tools/tConfiguration.cpp`), so every line in it is a hard override. It
does two things:

1. **Empties the arena of AIs** (`TEAM_BALANCE_WITH_AIS 0`, `MIN_PLAYERS 1`), so
   the arena holds exactly one cycle: the browser player's. The only things that
   can kill it are the rim and its own wall. The server's own log confirms the
   emptiness — one `entered the game` line, for `web_user`, and no other.
2. **Timestamps its own ladder-log** (`LADDERLOG_GAME_TIME_INTERVAL 0.25`,
   `CONSOLE_LADDER_LOG 1`), so `gGame::GameLoop` writes `[L] GAME_TIME <t>`
   every quarter second with `se_GameTime()` — the server's simulation clock,
   reset each round.

The observable is therefore **how long, in server game-seconds, the server kept
the browser player's cycle alive**, read off the last `[L] GAME_TIME` line
before the server's own `[L] DEATH_SUICIDE web_user`. Nothing about that reading
passes through the browser, and it is collected from `docker logs aa-server`
after the browser is gone.

### The arena's size and the cycle's speed drop out of the argument

Neither is ever needed, and it does not matter that `SIZE_FACTOR 0` taking
effect was never confirmed. The bound is *measured*, in the same configuration,
on the same geometry, round after round:

- the server logs `Creating grid...` and `Deleting grid...` once per round, so
  the spawn points are reconstructed every round;
- a fresh `gSpawnPoint` has `lastTimeUsed = se_GameTime()-1000000` and
  `numberOfUses = 0`, set in the `gSpawnPoint::gSpawnPoint` constructor
  (`src/tron/gSpawn.cpp`), so
  `Danger() = numberOfUses + 100/(se_GameTime()+10-lastTimeUsed)`
  (`gSpawnPoint::Danger`) is **identical** for every spawn point on a cleared
  grid;
- `gArena::LeastDangerousSpawnPoint` replaces its candidate only on
  `newDanger < mindanger - EPS` — a strict
  improvement — so on a tie the **first** spawn point wins.

Every round is therefore the same spawn on a cleared grid. Whatever the
straight-line time to the rim is, it is the same number every round, and the
comparison is between two arms that share it.

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

### The proof, and what actually carries it

1. **The steering arm outlived the no-steer bound** — 21.66 s against a measured
   5.50 s ceiling. The server simulates that cycle, so for its clock to record a
   longer life the server's cycle must have turned, whatever the browser was
   drawing on its own screen.
2. **Some steering rounds ended *sooner* than the control's fastest** (2.63 s
   against 5.19 s). Nothing else is in the arena, so a cycle going straight
   cannot reach a wall before the rim: an early death is a direction change.

**One binding has to explain both tails, and that is the force of the result.**
A key bound to the *brake* explains the long survivals only — braking can delay
the rim, never bring a wall closer. Anything that merely killed the cycle early
explains the short ones only. Only a change of **direction** explains 21.66 s
and 2.63 s coming out of the same key. **One early round is sufficient for
that**, which is why the analyser requires one of each rather than a majority of
either. The per-arm counts are printed for completeness and are *not* a
statistic; they should not be quoted as one.

### The same comparison on a four-times-finer clock

The survival figures above are quantised to the 0.25 s
`LADDERLOG_GAME_TIME_INTERVAL`, so the control's **0.30 s "spread" is very
nearly the sampling floor, not measured variation** — the instrument cannot
resolve anything smaller. The server also prints its own per-round
`Time: N seconds` to four decimals, and with the AIs gone and `GAME_TYPE 0` the
round ends when the sole player dies, so `Time = survival + a fixed inter-round
overhead`. The overhead cancels in a difference. Same log, equally
server-authored, about four times finer:

| | comparable rounds | per-round `Time:` | spread |
| --- | --- | --- | --- |
| control, run 1 | 10 | 14.7138 s – 14.7787 s | **0.0649 s** |
| control, run 2 | 10 | 14.7028 s – 14.8170 s | **0.1142 s** |
| control, run 3 | 11 | 14.6871 s – 14.7849 s | **0.0978 s** |
| steer, run 1 | 9 | longest **30.8223 s** | — |
| steer, run 2 | 10 | longest **19.7447 s** | — |
| steer, run 3 | 9 | longest **24.7693 s** | — |

The three steering arms beat their control's longest round by **+16.0436 s**,
**+4.9277 s** and **+9.9844 s**, against a threshold the data set fixes for
itself: five times the control's own spread, i.e. 0.5000 s, 0.5710 s and
0.5000 s. "Comparable" excludes
a round with no logged death and the last round of a match, whose `Time` includes
the match teardown (23.8 s against its neighbours' 14.7 s).

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
| control, run 3 | 12 | 5.18 s – 5.46 s | 0.28 s |
| steer, run 1 | 10 | 2.63 s – **21.66 s** | 19.03 s |
| steer, run 2 | 11 | 2.84 s – **11.38 s** | 8.54 s |
| steer, run 3 | 10 | 2.62 s – **15.49 s** | 12.87 s |

The two controls land in the same 0.25 s sampling bucket at both ends, over 24
rounds between them, with no key pressed in either — and on the finer per-round
clock they agree to 0.11 s. That agreement is worth as much as the differential:
it says the no-steer bound is a property of the arena and the cycle's speed, not
a lucky run. Run 2's steering arm beat it by +5.88 s on the coarse clock and
+4.93 s on the fine one, with rounds falling on both sides of the control band.
Both runs prove it on both counts; `task4/steer2/verdict.log` is the second run's
full output, and `task4/steer3/` is a third pair, run after the gating fix in fix round 1 and
the one the committed template actually produced.

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

## 2. B3 — it survives loss, and what packet loss costs

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

### Round-trip cost — and M-A ships WITHOUT a defensible figure for it

Read the caveat before the table, because it applies to every row and not just
to the one I disowned first.

**These rows are single-sample and confounded, and no number in them should be
planned around.** Confounded, specifically: the loss arms ran against the
*shipped* server config, which fills the arena with three AIs
(`ai_team gcc/latex/gdb` appears in both console logs). With AIs in it a round
ends when the AI play ends, not when the browser player does — so round length
is largely set by a game the browser player is not driving. The two arms did not
even play the same game: round 1 scored **−4** in the loss arm against **−2** in
the clean arm, i.e. different deaths, different rounds. Subtracting one from the
other measures the difference between two games at least as much as it measures
loss.

That is not repaired by re-running, and it was a deliberate decision not to:
`--drop` cannot induce the head-of-line stall that the cost-of-loss question is
ultimately being asked about (see below), so a cleaner number would be a
cleaner answer to a question this instrument cannot answer. **The load-bearing
result in this section is the tail, which did not move; the round-time rows are
recorded as observations and are not a cost model.**

Both arms reached all seven verdicts, `PASS:true`, no `PASS:false`, and no
Emscripten abort. From the driver's own elapsed-ms stamps:

| | clean | 5 % loss | delta |
| --- | --- | --- | --- |
| connect → the server sent a roster | 0.73 s | 1.05 s | **+0.32 s (+44 %)** |
| connect → round 1 started | 0.61 s | 0.67 s | +0.07 s (+11 %) |
| round 1 started → round 1 scored | 14.03 s | 15.86 s | **+1.82 s (+13 %)** |
| round 2 → round 3 | 12.69 s | 13.24 s | +0.55 s (+4 %) |
| connect → two full rounds scored | 27.33 s | 29.77 s | **+2.44 s (+9 %)** |

Every one of those deltas is a difference of single measurements between two
arms that played different rounds. The +44 % roster figure is one sub-second
interval measured once and should be ignored entirely; the +13 % round and +9 %
two-round figures are the same kind of number with a bigger denominator, and are
**not** a cost of loss.

The one thing here that is not confounded by round content is the datagram
count, because it counts what the client had to send rather than how long a game
took: the client sent **336** datagrams on its live handle in the clean arm
against **376** under loss (+12 %), and the server's own counters agree — 374
packets received against 398. That is the resend layer doing its job, and it is
a direct consequence of the discards rather than of what the AIs did. The relay
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
argument for WebTransport is head-of-line blocking on the *browser* leg, and
`--drop` cannot exercise it by construction: it discards at the relay, so it
models loss on the relay→server UDP leg, while the browser→relay leg is TCP
where a datagram cannot be lost, only delayed behind a retransmitting segment.
**M-D needs an option that stalls the WebSocket leg, not one that drops on the
UDP leg.** Until it has one, the case for WebTransport here rests on the
mechanism rather than on a measurement.

And **M-A therefore ships without a defensible cost-of-loss figure.** What it
ships instead, stated as narrowly as the evidence allows: the client survives 5 %
far-leg loss, completes rounds under it, sends about 12 % more datagrams to do
so, and the delivery tail does not move. Anyone who needs a number for the cost
of a lossy path has to build the instrument first.

---

## 3. B4 — it survives a drop: a dropped connection, mid-round

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

---

## 4. B5 — nothing else changed

Two independent claims: the dedicated wasm is still the pin, and the four gates that predate
this milestone still behave exactly as M9 left them when the bridge is not asked for at all.

### The byte pin

Rebuilt clean — `rm -rf web/build-m0 web/dist-m0` first, so nothing is short-circuited from an
earlier link — from `HEAD` of this branch:

```
$ make -f web/Makefile dedicated -j8   # exit 0
$ python3 -c "import hashlib,os; p='web/dist-m0/armagetronad-dedicated.wasm'; \
              print('size', os.path.getsize(p)); \
              print('md5', hashlib.md5(open(p,'rb').read()).hexdigest())"
size 2488298
md5 9718a2a64978cb6e9b95ea2f0454cca5
```

Both halves **match the pin exactly**: 2,488,298 bytes, md5 `9718a2a64978cb6e9b95ea2f0454cca5`.
Measured from this rebuild, not assumed from an earlier one still sitting in `web/dist-m0/` —
that directory was deleted first specifically so this number could not be stale.

### The four single-player gates, no `?bridge=` at all

Run with the exact commands in §0, on `python3 -m http.server 8008 --directory web/dist-m1`
serving this build, one gate at a time:

| gate | tally (true/false) | M9 reference | assertion-name set vs M9 | `ws://`, `WebSocket`, `[BRIDGE]` | `program exited` / `TIMED OUT` |
| --- | --- | --- | --- | --- | --- |
| desktop (`menu-gate.steps`) | 2 / 0 | 2 | identical (`SPARKSGATE D1`, `M7GATE D2`) | 0 | 0 |
| landscape (`touch-gate.steps`) | 8 / 0 | 8 | identical | 0 | 0 |
| portrait (`portrait-boot-gate.steps`) | 10 / 0 | 10 | identical | 0 | 0 |
| layout-boot (`layout-boot-gate.steps`) | 3 / 0 | 3 | identical | 0 | 0 |

Every count is exact against the M9 reference logs (`docs/evidence/m9-layout-lock/gates/`),
using the counting rule in §0. The negative-control command, stated so the absence means
something: `grep -c 'ws://\|\[BRIDGE\]' console.log` for each of the four transcripts, all four
zero. **None of these four gates ever reaches `net_game()`** — `menu-gate.steps` stays in
"Play Game", `touch-gate.steps` and `portrait-boot-gate.steps` walk the first-run tutorial
flow, `layout-boot-gate.steps` only opens the layout switch — so this zero is a bare zero, not
a refusal that happened to go unlogged. (Contrast `bridge-absent-gate.steps`, §0's mapping
table, where `[BRIDGE]` is expected precisely because that gate does walk into the network
menu and the refusal is the thing under test.)

**One reading differed from the M9 reference on the first attempt, and the investigation is
part of the evidence.** Portrait's `PB8` (`haptic-pulse-per-press`) read
`{"before":2,"after":4,...,"PASS":false}` against the M9 reference's `{"before":3,"after":5,
...,"PASS":true}` — one of the three early menu taps produced no counted vibration pulse. This
build touches no touch or haptics code at all (M-A is confined to `src/network/`,
`src/emscripten/eWebNet.*`, `web/library_bridge.js`, `web/Makefile`), so a code-caused
regression there has no mechanism. An immediate same-build re-run reproduced the M9 reading
exactly (`{"before":3,"after":5,...,"PASS":true}`), and the ten-true-zero-false row above is
that second, clean run — committed at `task5/single-player/portrait/`. The first, anomalous
run is committed too, at `task5/single-player/portrait-pb8-flake-first-attempt/`, precisely so
this is a documented flake and not a quietly discarded bad reading. Read together with the
resource-contention timeout in §0 (the same first attempt, run with all four gates
concurrently), the most likely explanation is machine load affecting the delivery timing of a
synthetic touch event, not anything this milestone changed.

## 5. B6 — a real server: not attempted

No community server has been contacted, at any point in this milestone. Every reading in this
directory is against `aa-dedicated`, a container on this machine. That is deliberate and it is
task 6, which needs the maintainer's explicit permission before it can run at all — nothing
here should be read as implying otherwise.

---

## What this milestone does not claim

Stated together, because burying any one of them would make the rest of this document
misleading:

- **There is no defensible cost-of-loss figure.** §2's round-time deltas are single-sample and
  confounded by three AIs setting round length in both arms, and `--drop` discards on the
  relay→server UDP leg — it cannot induce the WebSocket TCP head-of-line stall that the
  question is actually about. A later milestone needs an option that **stalls** the WebSocket
  leg, not one that drops packets on the UDP leg, before that question can be measured rather
  than argued from the mechanism.
- **No third-party server has ever been contacted.** Everything measured here is a local
  container built from this source tree. That is task 6, and it needs the maintainer's explicit
  permission first.
- **iOS, Firefox and real touch devices are untested**, exactly as they were before this
  milestone — every gate in this directory runs Chrome device emulation. So is the client's own
  behaviour after a socket closes for good, beyond "it neither hangs nor crashes" (§3): what the
  player actually sees, and whether a reload or a reconnect works, has not been checked.
