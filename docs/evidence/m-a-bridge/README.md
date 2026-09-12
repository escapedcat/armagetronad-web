# M-A: the multiplayer bridge — evidence

The browser client's UDP is carried over a WebSocket to a local Node relay
(`bridge/relay.mjs`), which speaks UDP to a stock Armagetron server. Everything
here was measured against `aa-dedicated`, a dedicated server built from **this**
source tree and run in Docker on the same machine — **with one exception, `b6/`,
which is the only part of this directory that touched a machine this project
does not own.** It was run with the maintainer's explicit prior permission,
against servers checked to be empty first, and **it failed**: neither server
answered the client's login at all. Read §5 before quoting anything here as
evidence that the bridge reaches the real community, because it is not.

| directory | what it holds |
| --- | --- |
| `task2/` | the relay, the client interception, and the address-mapping fix |
| `b1/`, `b2/` | Task 3: a browser player joins a real server and finishes a round |
| `task4/steer/`, `task4/steer2/` | **did a steering keypress reach the server** — the control and steering arms, run twice |
| `task4/steer3/` | a third arm pair, run after fix round 1 closed the steering template's gating hole — the one the committed template actually produced (§1.1) |
| `task4/loss/` | what 5 % packet loss costs, and what a dropped connection does |
| `task4/fix1/clean/` | the whole gate re-run after fix round 1, clean relay: the run that shows the closed gating hole end to end (§1.1) |
| `task4/prove-*.log`, `task4/npm-test.log` | the checks in this task, run against the case they are meant to catch, failing; and the relay's unit tests |
| `task5/single-player/` | Task 5: the four pre-existing single-player gates, run on this build with **no** `?bridge=` at all |
| `final-fixes/` | the final whole-branch review's fixes: the pin re-measured from a clean rebuild, the gates re-run, and the two new relay checks shown failing against the code they fix |
| `b6/local/` | Task 6's **control**: the B6 gate against the container, which passed, and which carries the new ack-paired round-trip instrument (§5) |
| `b6/remote-1-bobs-default-settings/`, `b6/remote-2-unnamed-server/` | Task 6's two attempts at a community server. **Both failed** — 50 datagrams out, none back (§5) |
| `b6/serverlist-*.xml`, `b6/icmp-*.txt` | what the master list said about each server just before it was contacted, and the ICMP round trip to the first one |

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
| **B6** — a real server | one unmodified community server | its own file, `bridge-gate-b6.steps` (`B6-0`, `B6`, `B6-LEFT`) | `b6/` — **FAILED**, see §5 |

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
concurrently), this is not a regression — no code this milestone touched has any mechanism to
move a haptic count — but two data points are not enough to say what actually happened, only
that it was not that. If it recurs, it deserves the harness's own timing instrumentation rather
than a third data point of the same kind.

## 5. B6 — a real server: attempted, with permission, and **it did not work**

**B6 FAILS.** Two community servers were contacted, one after the other, with the maintainer's
explicit prior permission and only after checking that each was empty. Both behaved the same
way: the client sent its login and **nothing came back at all** — not a refusal, not a version
complaint, not one datagram. No round was played on either. There is therefore **no latency
figure from a real network in this milestone**, which was the number this gate existed to
produce.

Evidence: `b6/local/` (the control, which passed), `b6/remote-1-bobs-default-settings/` and
`b6/remote-2-unnamed-server/` (the two that did not), plus `b6/icmp-188.245.106.232.txt` and the
two `serverlist-*.xml` snapshots taken before connecting.

**The screenshot filenames in the two failed arms lie, and they lie because they are the same
filenames the passing arm produces.** All three arms run one steps file, so each shot is named
for the *step* that took it and not for what it found: in the remote arms
`11-on-the-grid.png` is the bookmarks menu the client fell back to, and
`14-the-round-was-scored.png` and `15-a-second-round-started-…png` are that same menu,
photographed after a wait that timed out. Renaming them per arm would have meant two steps files
and a gate that differs between the case it passes and the case it fails, which is worse. Read
`driver.txt` beside any shot: it records which `until:` had just timed out.

### What was run, and the conduct rules it was run under

| | arm | address | when | result |
| --- | --- | --- | --- | --- |
| control | local container | `127.0.0.1:4534` | 2026-09-12 ~11:05Z | **PASS**, a full round |
| 1 | `bob's \| DEFAULT SETTINGS [EU]` | `188.245.106.232:4537` | 2026-09-12 11:28Z | 50 datagrams out, **0 in** |
| 2 | `Unnamed Server` | `185.127.17.61:4537` | 2026-09-12 11:39Z | 50 datagrams out, **0 in** |

Both were confirmed empty from the master list immediately before connecting (`numplayers="0"`,
snapshots in `b6/`), and both accept protocol 17 by their own advertised range (`0`–`18`). Each
arm connected **once**. The client gave up on its own after about ten seconds and roughly
twenty-one retries, and sent nothing to either host afterwards — so the long timeouts visible in
the two `driver.txt` files are the harness waiting, not the gate sitting on a stranger's slot.
Arm 2 was the single retry the task allowed, and it was deliberately a **different host and a
different hosting provider**, so that a host-specific fault and a general one could be told
apart. After it, contact stopped.

One conduct failure of my own, recorded because it is the same class of mistake as the one this
gate is written to avoid: the run's master-list watcher polled
`corsapi.armanelgtron.tk` every 20 s and was rate-limited into HTTP errors within three minutes.
That service is a third party this project is a guest on exactly as the game servers are.
`run-bridge-b6.sh` now polls once a minute and its comment says why; the cost is that arm 2 has
no independent record of the server's player count while it was connected, only the snapshot
taken just before.

### What the two failed arms nevertheless prove

Not nothing, and the parts that are proven are worth separating from the part that is not:

- **The destination policy admits a real public server.** Both remote arms ran the relay
  **without** `--allow-private`. `new_dataErrors` is `0` across the connect in both, and the
  relay's own UDP trace shows the datagrams leaving for `188.245.106.232:4537` and
  `185.127.17.61:4537`. Nothing was refused by `bridge/policy.mjs`; it is only loopback and the
  other reserved ranges that it turns away.
- **The client dialled the right place.** `b6/remote-1-*/10-bookmarks-menu-shows-the-address-about-to-be-dialled.png`
  reads `Connect to 188.245.106.232`, and `udp-trace.jsonl` in each arm contains exactly one
  destination and no other.
- **The page survived the failure.** `B6-LEFT` is `PASS:true` in both remote arms: the socket
  closed, the canvas still has a size, GL reports no error and there is no Emscripten abort. A
  connect that goes nowhere does not take the client down.
- **And the gate's own assertions are demonstrably not vacuous.** This milestone has twice
  shipped a check that could only have passed, so it is worth saying plainly: one steps file
  printed `B6 … "PASS":true` against the container and `B6 … "PASS":false` against both community
  servers, from the same walk, with `rtt_samples` reading 74 in the one case and 0 in the other.
  A gate that has been seen failing against the thing it is meant to catch is the only kind worth
  quoting.

### The one thing that makes this a real result rather than a mystery

The login datagram is **byte-for-byte the same shape in all three arms**. Parsed out of the
relay's UDP trace, the first datagram the client sends is, in every case:

```
len=186   one message: descriptor 11 (login2), message id 0, 89 shorts of payload
```

In the control the container answers that datagram immediately — the next line in the trace is
inbound, `descriptor 5` (`login_accept`) followed by a burst of `descriptor 60` object syncs. In
both remote arms the identical datagram is sent twenty-one times and the trace contains **no
inbound line at all**. So the client is not doing something different when it talks to a
stranger; the difference is entirely at or beyond the far end.

### What was ruled out, and what was not

Ruled out, each with a measurement:

- **Outbound UDP from this machine is not blocked in general.** DNS over UDP to `1.1.1.1` and
  `8.8.8.8` answers, and so does a STUN binding request to `stun.l.google.com:19302`,
  `stun1.l.google.com:19302` and `stun.cloudflare.com:3478` — arbitrary high UDP ports, replies
  returning through the same NAT the relay sits behind, using the same `node:dgram` API.
- **The path to the host is up.** ICMP to `188.245.106.232`: 10 packets, 0 % loss,
  min/avg/max/stddev **123.113 / 126.493 / 133.051 / 2.965 ms**. (A first ICMP sample in the same
  minute showed 80 % loss and a 2.6 s maximum, but a control ping to `1.1.1.1` taken alongside it
  showed a 2.8 s maximum too — that was a transient on *this* machine's link, and it is recorded
  and discarded in `b6/icmp-188.245.106.232.txt` rather than quietly dropped.)
- **The relay is not at fault.** It is `bridge/relay.mjs` unmodified in both arms; the tracing
  front end patches `dgram.createSocket` in its own process and then imports the real
  `startRelay`. The trace is taken at the socket, below any of the bridge's own logic.
- **The servers were not down.** Both were still listed by the master with `numplayers="0"`
  after the attempts, which means they were still registering with it.
- **It is not the protocol version being out of range.** This tree advertises
  `nVersion(0, 17)` — `sn_versionString` in `src/network/nConfig.cpp` ends at index 17
  (`0.2.9_alpha`) and `sn_GetCurrentProtocolVersion()` returns `len - 2`. Both servers advertise
  `version_min="0"`, so 17 is inside the range they claim to accept.

**Not ruled out, and these are the two live hypotheses:**

1. **Protocol 18, and a fork.** 121 of the 138 servers listed advertise `version_max="18"`;
   only 17 advertise 17. Both servers tried were in the 18 group, and neither runs mainline:
   `0.2.9-bob unix dedicated` and `0.2.9-sty+ct+ap.3_alpha_z1 unix dedicated`. The live community
   is essentially all `sty+ct+ap` forks at protocol 18, and this source tree is one protocol
   version behind all of them. An advertised `version_min="0"` is a claim, not a test.
2. **UDP into the game-port range being dropped somewhere on this machine's path.** Both servers
   tried happened to be on port **4537**, and the STUN and DNS checks used 19302, 3478 and 53.
   There is no cooperating endpoint on 4533–4599 that is not somebody's game server, so this was
   not tested — deliberately, because testing it means sending packets to a stranger.

**The experiment that separates them is one connect to a server whose `version_max` is 17**, of
which the same listing had thirteen that were empty — e.g. `216.209.143.245:4534`,
`46.232.251.31:4534`, `80.134.63.146:4534`. If a 17-ceiling server answers, hypothesis 1 is the
answer and M-B needs a protocol bump before it needs anything else. If it also stays silent on
port 4534, hypothesis 2 survives and the next step is a network this port range is not filtered
on. That connect was **not** made: the task allowed one attempt and one retry, and both were
spent.

### The control arm passed, and it carries a new instrument

`b6/local/` is the same gate file against the container, and it reached `PASS:true` on all three
of its verdicts — a roster, two rounds started, one round scored, 250 datagrams on a single live
handle, one peer (`127.0.0.1`, mapped to itself), no new dropped/failed/errored datagrams.

It exists because a remote number is meaningless without a same-day, same-instrument local one
to subtract, and the instrument is new. Task 4 measured inter-arrival **gaps**: how often the far
end speaks. That cannot price a network — a server that syncs every 30 ms reads the same on
loopback and across an ocean. So B6 recovers an actual **round trip** from the wire, the way the
game recovers it: `nWaitForAck::Ackt` (`src/network/nNetwork.cpp:846`) computes
`netTime - ack->timeFirstSent` when an acknowledgement for a message id comes back, and that is
the number the score table prints as ping (`src/engine/ePlayer.cpp:6530`). Remembering when each
message id went out and pairing it with the ack that names it reproduces exactly that, from
outside the game, at two different points on the path.

| measured at | what the leg contains | n | min | p50 | p90 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| in the page (whole path) | page → ws → relay → udp → server → back | 74 | 0.70 | **1.30** | 4.30 | 53.9 | 53.9 |
| at the relay, forward | relay → udp → server → back (no browser) | 75 | 0.41 | **0.66** | 1.24 | 53.4 | 53.4 |
| at the relay, reverse | relay → ws → page → wasm → back (no network) | 538 | 0.71 | **12.87** | 26.95 | 1081.9 | 1081.9 |

All in ms, loopback. Read the third row carefully, because it is the one that will be
misquoted: it is **not** "the bridge costs 13 ms". An ack is not sent the instant a message
lands — the game collects acks and flushes them on its next send, so that row is dominated by
the client's own send cadence (~16 ms at 60 fps) and not by the WebSocket. The row is useful as a
*control value to subtract from the same row measured remotely*, which is why both arms were
always going to be run, and it is why a single absolute figure from this instrument would be
wrong. Its 1081 ms maximum is a round transition, the same artefact §2 already flagged in the gap
tail.

The gap sampler was kept as well, so there is a row comparable with §2's table:

| phase | arm | n | p50 | p90 | p99 | max | >100 ms | >250 ms | >500 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| through B6 | local container | 193 | 33.4 | 121.4 | 957.6 | 961.2 | 50 | 17 | 4 |

**The remote halves of both tables are empty, and that is the result of this gate.** The honest
statement of what M-A now knows about latency on a real network is: the path to one of the
servers is about **126 ms** round trip at the ICMP level, and nothing whatever is known about
what the bridge adds on top of it, because no datagram has ever made the trip.

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
- **It has never been shown to reach a community server, and one attempt each at two of them
  failed outright** (§5). Every working reading in this directory is against a local container
  built from this source tree. The bridge is proven against *that*; nothing here shows it
  carrying a game to a server this project does not own, and the two attempts that were made got
  no reply of any kind. Whether that is this tree being a protocol version behind the live
  community, or this machine's path filtering the game-port range, is **undetermined** — §5 names
  the one experiment that separates them.
- **There is still no latency figure for a real network.** That was B6's whole purpose. The only
  round-trip numbers in this document are loopback (§5), and the local→remote subtraction they
  were built to feed has no remote half.
- **iOS, Firefox and real touch devices are untested**, exactly as they were before this
  milestone — every gate in this directory runs Chrome device emulation. So is the client's own
  behaviour after a socket closes for good, beyond "it neither hangs nor crashes" (§3): what the
  player actually sees, and whether a reload or a reconnect works, has not been checked.
