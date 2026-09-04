# Task 3 — two suspects, two measurements: what grows with the trail, and what grows at the wall

The M6 plan names two mechanisms for the phone's slowdown and neither had
a number. This directory gives each one: **mechanism 1** (the renderer
re-submitting every wall segment through the GL emulation each frame) is
read off Task 2's ten baseline rounds without a new run; **mechanism 2**
(the rubber path of `gCycleMovement::TimestepCore` when a wall is near) is
measured by a new arm, `grind`, that holds one cycle against the rim with
nothing else in the arena, run three times on 2026-09-03 between 22:27 and
22:34 (once plainly, once repeated, once with the sound device closed).

**These are one desktop's numbers.** Every millisecond is a frame interval
at `MAX_FPS 1000` under a 6× CPU throttle at a phone's pixel count, and a
frame interval contains a fixed event-loop yield the throttle does not scale
(`web/tools/perf/README.md`, "What a frame time contains"). The
before-vs-at-the-rim ratios, the per-draw-call coefficient and the deltas
are what travel; the milliseconds are not a phone's. Same binary as Tasks 1
and 2 (`web/dist-m1`, `armagetronad.wasm` md5 `8531ea5dd60138a534147e222ba56007`;
`make -f web/Makefile client` reported nothing to do), same server
(`python3 -m http.server 8006 --directory web/dist-m1`; the plan's 8000 is
another worktree's server on this machine), Chrome headed at
`--mobile 915,412,3`, harness `web/tools/perf/` as committed with this
task (`grind.steps.tmpl` is new; `report.js` gained `closed_by`; nothing
else changed since Task 2).

**The two verdicts, in one paragraph each.**

*Mechanism 1 — confirmed as a cost, not as a curve in this match, and
narrower than that after six skeptics read it ("Adversarial check", last
section: what is confirmed is a per-draw-call cost, not that the geometry
was walls).* Where
the draw count moved, the render part of the frame moved with it and
nothing else did (r = 0.95–0.98, 24–47 µs per extra draw call); where it
did not — the seven baseline rounds without a spike, and the tutorial caps
every wall at 400 units so the draw count sits at exactly 107 for thirty
seconds in all ten — the render part's share of the early→late growth is
a median 0.4 ms of 3.6. That **growth**, expressed over the late frame
time, is 17–21 % in the three spike rounds and −6 to +4 % in the seven flat
ones; the median of those ten values is 3.1 %, and it is the median of two
populations rather than one number (see "Adversarial check"). It is not the
render part's *level* share of the frame, which is far larger: 62.1–68.9 %
of the late frame, median 65.4 % over the same ten rounds. Details in
"Mechanism 1".

*Mechanism 2 — confirmed.* Pressed against the rim, at the same draw count
as free driving, the frame costs **+20, +26 and +37 %** (three runs:
11.4 → 13.7, 11.3 → 14.3, 11.1 → 15.3 ms p50) and the rise is in the part of
the frame before the first draw call — `ms_to_first_draw` **+41, +47 and
+55 %** (+2.5, +2.8, +3.2 ms) — while the render part moves +1, +4 and +18 %.
Closing the sound device does not remove it (+47 %). The grind also throws
sparks, which are a *render* cost: bursts of +110 draw calls at 22–31 µs
each. Details in "Mechanism 2".

## Mechanism 1 — what grows with the trail (from Task 2's ten rounds, no new run)

`mech1-baseline-table.txt` is the per-second reading of the ten rounds in
`docs/evidence/m6-lag/task2-repro` (each `[PERF]` line's `per_second`
series; the "moving" seconds are 4 s — the end of the countdown — to the
death second). For every round it correlates `ms_first_draw_to_swap` (the
render part: submission through the GL emulation) with `draws_per_frame`,
fits the slope, and splits the early→late growth of `ms_p50` into its
render part and its pre-draw part.

| round | draws: plateau → peak (s) | render part s44 → peak | r(render, draws) | slope, µs per draw call | early→late Δms | Δrender / Δpre | render Δ as % of late ms | KB/frame early → late |
|---|---|---|---|---|---|---|---|---|
| r1 / 2 | 107 → 503 (49) | 17.9 → 27.5 | 0.98 | 24 | +10.3 | 5.7 / 4.1 | 17 % | 181 → 274 |
| r4 / 2 | 107 → 511 (49) | 17.1 → 30.4 | 0.98 | 31 | +11.8 | 7.2 / 4.1 | 21 % | 181 → 267 |
| r4 / 3 | 107 → 393 (49) | 17.8 → 34.8 | 0.95 | 47 | +14.0 | 7.5 / 5.7 | 21 % | 184 → 229 |
| r1 / 3 | 107 (peak 116 at s5) | 16.2 → 17.1 | 0.13 | — | +3.2 | 0.4 / 2.5 | 2 % | 184 → 182 |
| r2 / 2 | 107 (123 at s5) | 15.8 → 16.6 | 0.40 | — | +4.2 | 1.1 / 2.7 | 4 % | 181 → 179 |
| r2 / 3 | 107 (117 at s5) | 14.8 → 16.0 | 0.01 | — | +4.2 | 0.3 / 3.7 | 1 % | 184 → 182 |
| r3 / 2 | 107 (123 at s5) | 16.7 → 17.6 | 0.25 | — | +2.7 | −0.4 / 2.7 | −2 % | 181 → 179 |
| r3 / 3 | 107 (117 at s5) | 15.7 → 18.5 | 0.53 | — | +1.0 | −1.5 / 2.3 | −6 % | 184 → 182 |
| r5 / 2 | 107 (122 at s5) | 17.6 → 18.3 | 0.50 | — | +3.6 | 0.6 / 2.6 | 2 % | 181 → 179 |
| r5 / 3 | 107 (117 at s5) | 18.2 → 20.2 | 0.49 | — | +4.4 | 1.1 / 2.8 | 4 % | 184 → 182 |

Frame costs at `MAX_FPS 1000`, cpu 6 in every round; the slope is fitted over
the moving seconds and is only meaningful where the draw count actually
moved (the three spike rounds — in the seven flat ones the draws never leave
107 ± 16 and the fit is noise, so it is not printed). "peak 116-123 at s5" is
the first moving second of every flat round, before the trails settle.

**Verdict: confirmed as a cost, not as a curve in this match.** Where the
draw count moved, the render part moved with it and nothing else did:
r = 0.95–0.98 in the three spike rounds, 24–47 µs per extra draw call at
rate 6 (the render part +9.6, +13.3 and +17.0 ms for +396, +404 and +286
calls at the peak second), with `kb_per_frame` up 25–51 %. The renderer's
re-submission is real and it is priced. But in this match it does not grow
with the trail: the tutorial caps every wall at 400 units
(`web/tools/perf/README.md`, "What an arm is"), the draw count sits at
exactly 107 from second 15 to 44 in all ten rounds, and the seven rounds
without a spike grew by 1.0–4.4 ms of which the render part contributed
−1.5 to +1.1 ms (median 0.4) and the pre-draw part 2.3–3.7 (median 2.7).
Its share of the late-window growth: 54–61 % in the three spike rounds,
−150 to +26 % (median 12.5 %) in the seven flat ones, median 21 % over the
ten. **That growth expressed over the late frame time** — the
`ren%late` column of `mech1-baseline-table.txt`, i.e. Δrender ÷ late
`ms_p50` — is 17–21 % in the spike rounds and −6 to +4 % (median 1.6 %) in
the flat ones, median 3.1 % over the ten. **This is a growth share, not a
level share**, and the two must not be swapped: the render part's level
share of the late frame, `ms_first_draw_to_swap_p50` ÷ `ms_p50` in the late
window, is 62.1–68.9 % over the same ten rounds (median 65.4; flat median
64.9, spike median 67.7), recomputed from the same `[PERF]` objects. Read
together they say the renderer is most of the frame and almost none of the
frame's *growth* in this match. What a spike is — a cycle adding wall
segments faster than the 400-unit cap removes them — is still the reading
Task 2 offered, not a measurement; but whatever it is, it moves the
renderer by the coefficient above. **Read "confirmed" narrowly.** All three
skeptics who read this verdict ("Adversarial check") landed on the same
limit, and one refuted it on those grounds: what is confirmed is that extra
draw calls cost 24–47 µs each in the render part of the frame. *Which*
geometry produced the three spikes was never identified — the trails are
capped at 400 units here, and `gSparks.cpp`'s own bursts give the same
22–31 µs coefficient from a non-wall source (see "Mechanism 2"). Wall
re-submission remains the reading, not the measurement.

**What this says about the maintainer's "the more I drive".** The tutorial
match cannot produce a trail-length curve; the post-tutorial match the
phone plays can (`SP_WALLS_LENGTH` −1, `gCycle::wallsLength = -1.0f`:
trails never expire), and no arm has measured that boot path. The
coefficient transfers: every 100 draw calls of wall geometry cost about
2.4–4.7 ms per frame at rate 6 on this desktop, and `kb_per_frame` is the
better predictor when calls differ in size.

**The ceiling for display lists (Task 5).** What the renderer spends on
walls is bounded above by the difference between a scene with them and a
scene without: the baseline's flat late windows submit 111–115 draw calls
and 179–182 KB per frame for a render part of 15.4–18.7 ms; the grind arm's
free-driving seconds (rim, floor, HUD, one straight trail, no other cycle)
submit 52–55 calls and 40 KB for 4.6–6.3 ms. The 10–13 ms between them is
what four 400-unit trails plus the floor of an arena 8× as wide cost
through the emulation at rate 6 — about half of a 25 ms flat late frame — and a
same-arena no-wall arm would be needed to split the floor out of it. It is
an upper bound on what display lists could remove, not a promise.

## Mechanism 2 — the grind arm

### What was run, and why it looks like this

`web/tools/perf/grind.steps.tmpl` (its header carries every reason; the
harness README's "The grind arm" section summarises them):

    sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task3-mechanisms grind         6 'SP_SIZE_FACTOR 0\\nSP_NUM_AIS 0\\nCYCLE_RUBBER_TIME 0.1\\nTIMESTEP_MAX 10' web/tools/perf/grind.steps.tmpl
    sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task3-mechanisms grind-nosound 6 'SP_SIZE_FACTOR 0\\nSP_NUM_AIS 0\\nCYCLE_RUBBER_TIME 0.1\\nTIMESTEP_MAX 10\\nSOUND_QUALITY 0' web/tools/perf/grind.steps.tmpl
    sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task3-mechanisms grind-r2      6 'SP_SIZE_FACTOR 0\\nSP_NUM_AIS 0\\nCYCLE_RUBBER_TIME 0.1\\nTIMESTEP_MAX 10' web/tools/perf/grind.steps.tmpl

One after another, never two at once, each started only after
`pgrep -fl 'drive-browser[.]mjs|em[+][+] '` and a check for `aa-chrome-*`
processes came back empty (no waiting was needed; no build ran). The idle
human — the two tutorial key presses at 5.4 and 5.7 s are the only input —
drives straight from its spawn into the rim, reaches it about 18.5 s after
`NEW_ROUND`, and is held there by the rubber until the harness kills it at
60.1 s; the throttle goes on at 7.7 s. The arm differs from the plan's
sketch in four places, each forced by a fact of the tutorial match that
`welcome()` (`gArmagetron.cpp`) plays on every first-use boot:

1. **`CYCLE_RUBBER 50` is not in the arm** — `welcome()` assigns
   `sg_rubberCycle = 5` after `autoexec.cfg` is read, so the line would do
   nothing. What keeps the cycle alive is `CYCLE_RUBBER_TIME 0.1`:
   `TimestepCore` decays the reservoir by `rubber /= (1 + ts/CYCLE_RUBBER_TIME)`
   every step, so against a wall at speed 15.0 it settles at
   15 × 0.1 = 1.5 of the 5 granted and the HUD's *Rubber Used* gauge reads
   exactly **1.5** (every rim screenshot) and **0** while free
   (`g-12s-free.png`); only a single step over about 0.23 s can kill it,
   and the largest raw frame gap in these three runs is 39.8 ms. The plan's
   `CYCLE_RUBBER_TIME 0` would also keep it alive (the `else` branch sets
   `rubber = 0`) but leaves the gauge at 0, which cannot prove a grind.
2. **`SP_SIZE_FACTOR 0`, not the shipped −3** — `welcome()` lowers it by 2,
   so 0 is a 0.5× arena and the rim is 450 × 0.5 = 225 map units from the
   spawn: 15 s of driving after the 4 s countdown, hence a throttled
   free-driving window of ten seconds (8–17 s) before contact. At −3 (a
   0.177× arena) contact came 9.3 s after `NEW_ROUND` — 1.6 s after the
   throttle — and there was no window (`attempts/1-stall-1s-arena-0.177x`).
3. **The measured round is round 1.** A lone cycle ends no round: with one
   team there is no winner (`gGame.cpp` `Analysis`: a winner needs more
   than one team), and the winnerless path (`alive == 0`, then 4 s) never
   fires either, because `Analysis` counts a human whose cycle object is
   gone as "not yet logged in" and, with `ais == 0`, adds one to `alive`
   for it. Measured: `attempts/2-stall-6s-no-round-2` killed the cycle
   14.8 s into round 1 (`DEATH_SUICIDE` 13 ms after the stall) and no
   `NEW_ROUND` followed in 60 s. `everytime.cfg`, which could have switched
   an AI off between rounds, is read only under `#ifdef DEDICATED`
   (`gGame.cpp`). So an arm with no AI has exactly one round, and this arm
   measures it *after* the throttle — a deviation from the plan's "round 1
   is never measured", whose two reasons (the key presses, the throttle
   switch) are both over before the window opens at 8 s. The alternative,
   one AI so that rounds can end, would put a second rubber path and a
   second trail into the scene, with a cost that varies with the AI's own
   wall proximity — the very thing being measured.
4. **`TIMESTEP_MAX 10` and a 6 s stall as the kill switch.** The harness
   ends the grind by stalling the main thread for 6 s inside an `eval:`
   step. `gGame::Timestep` passes the resulting 6 s step whole
   (`TIMESTEP_MAX`, 0.2 s shipped), `eGameObject::TimestepThis` cuts it
   into its hardcoded ten pieces of 0.6 s, and in each the rubber path
   splits the piece where the reservoir runs out (0.233 s), the reservoir
   decays back to 1.5, and the second half (0.367 s, 5.5 rubber needed
   against 3.5 free, the recursion guard forbidding a further split) moves
   the cycle 2 units through the rim — `Move()` throws, and "prevent it if
   there is rubber left" has none. A *free* cycle survives the same stall
   (it moves 90 units), so the `[L] DEATH_SUICIDE web_user` that follows
   each stall — **16, 10 and 19 ms** after the stall's `eval:` returned, in
   the three runs — is itself proof that the cycle was pressed against a
   wall. A 1 s stall does not kill (five 0.2 s pieces, 3 needed against
   3.5 free): `attempts/1-stall-1s-arena-0.177x` stalled twice and the
   cycle sat at the rim with the gauge at 1.5 for 177 s
   (`g-78s-at-rim-after-1s-stall.png`). The stall is bracketed like a
   screenshot, so `report.js` drops its frame from every statistic, and the
   measured span ends at the death mark.

`check-arm.mjs` reports all three arms **INVALID** by design — it requires
rounds 2 and 3 — and `table.txt` records that verdict. The arm's validity
is: the `DEATH_` mark 10–19 ms after the stall (contact), the gauge at 1.5
in every rim screenshot and at 0 in every free one, the two tutorial key
presses and the `CPU throttling rate 6x` line before the window in every
`console.log`, 0 frames over 50 ms in all three spans, and 4250, 4404 and
4621 measured frames per run (313–336 excluded by the bracketed shots and
stall), every one ending in `glFinish`.

### The reading

`grind-per-second.txt` has, for each run, the window statistics below and
the full per-second series. On the round clock: seconds 0–7 are the
countdown and the unthrottled first seconds (5.3–6.6 ms, draws 21–59, not
used); **before** is seconds 8–17, throttled free driving straight ahead;
contact is at about 18.5 s (`ms_to_first_draw` is halfway up in second 18
in all three runs, `g-18s-approach.png` at 17.9 s shows the rim a few units
ahead and the gauge still at 0); **rim** is seconds 20–59, ending in the
stall's second. The draw count is 52–55 while free and 60 at the rim except
during the sparks (next section), so the rim is also read at "draws ≤ 70"
— the seconds comparable to free driving call for call — and at
"draws ≥ 150".

| run | window | seconds | ms p50, median (range) | `ms_to_first_draw`, median (range) | `ms_first_draw_to_swap`, median (range) | draws/frame, median (range) |
|---|---|---|---|---|---|---|
| grind | before, free | 10 | 11.1 (10.8–11.8) | 5.9 (5.8–6.2) | 5.1 (4.9–5.6) | 53 (52–55) |
| grind | rim, draws ≤ 70 | 14 | **15.3** (14.5–16.5) | **9.1** (8.6–9.8) | 6.0 (5.5–6.7) | 60 (60–69) |
| grind | rim, draws ≥ 150 | 15 | 18.8 (18.2–20.3) | 9.6 (9.1–10.3) | 9.2 (8.8–10.3) | 166 (153–171) |
| grind | rim, all | 40 | 17.1 (14.5–20.3) | 9.4 (8.6–10.3) | 7.6 (5.5–10.3) | 113 (60–171) |
| grind-nosound | before, free | 10 | 11.3 (10.2–12.3) | 5.8 (5.6–6.1) | 5.4 (4.6–6.3) | 53 (52–55) |
| grind-nosound | rim, draws ≤ 70 | 9 | **14.3** (12.1–15.7) | **8.6** (7.4–9.2) | 5.6 (4.5–6.3) | 60 (60–67) |
| grind-nosound | rim, draws ≥ 150 | 20 | 16.9 (15.9–20.7) | 8.4 (7.9–9.9) | 8.2 (7.9–10.3) | 180 (151–184) |
| grind-nosound | rim, all | 40 | 16.2 (12.1–20.7) | 8.6 (7.4–9.9) | 7.9 (4.5–10.3) | 147 (60–184) |
| grind-r2 | before, free | 10 | 11.4 (11.0–11.9) | 6.0 (5.9–6.2) | 5.2 (5.0–5.7) | 53 (52–55) |
| grind-r2 | rim, draws ≤ 70 | 31 | **13.7** (12.8–17.3) | **8.4** (8.0–10.0) | 5.3 (4.7–7.5) | 60 (60–68) |
| grind-r2 | rim, draws ≥ 150 | 2 | 17.9 (17.7–18.2) | 9.2 (9.0–9.3) | 8.8 (8.7–8.9) | 172 (171–174) |
| grind-r2 | rim, all | 40 | 14.0 (12.8–18.3) | 8.5 (8.0–10.0) | 5.5 (4.7–8.9) | 60 (60–174) |

Frame costs at `MAX_FPS 1000`, cpu 6, from the `per_second` arrays of each
run's `[PERF]` line; a window's median is the median of its per-second
medians. `ms_in_swap` is 0 at p50 and ≤ 1.3 ms at max in every window, as
in every arm before.

| run | ms p50, free → rim at ≤ 70 draws | `ms_to_first_draw`, free → rim | `ms_first_draw_to_swap`, free → rim | sparks: draws 60 → ≥ 150, render part | µs per spark draw call |
|---|---|---|---|---|---|
| grind | 11.1 → 15.3, **+37 %** (+4.2 ms) | 5.9 → 9.1, **+55 %** (+3.2 ms) | 5.1 → 6.0, +18 % (+0.9 ms) | 6.0 → 9.2 ms for 60 → 166 | 30 |
| grind-nosound | 11.3 → 14.3, **+26 %** (+3.0 ms) | 5.8 → 8.6, **+47 %** (+2.8 ms) | 5.4 → 5.6, +4 % (+0.2 ms) | 5.6 → 8.2 ms for 60 → 180 | 22 |
| grind-r2 | 11.4 → 13.7, **+20 %** (+2.3 ms) | 6.0 → 8.4, **+41 %** (+2.5 ms) | 5.2 → 5.3, +1 % (0.0 ms) | 5.3 → 8.8 ms for 60 → 172 | 31 |

**Verdict: mechanism 2 is confirmed, at +20 to +37 % of the frame (median
+26 %) with the draw count flat, and it lives where the simulation lives.**
The part of the frame before the first draw call — the yield, input, the
simulation, render setup, and in the plain runs the audio callback — rises
by 2.5–3.2 ms (+41 to +55 %) the moment the cycle meets the rim and stays
up for the whole grind; the render part, read at equal draw counts, moves
by 0.0–0.9 ms. What is in that 2.5–3.2 ms: the rubber path's
`GetMaxSpaceAhead` sensor scan every step and its split-and-recurse when
the wall is inside the needed space (the plan's mechanism), plus whatever
else the game does only against a wall — the spark particles' own
timestep (small: `ms_to_first_draw` in the sparking seconds against the
sparkless ones is 9.6 vs 9.1 in `grind`, 8.4 vs 8.6 in `grind-nosound`,
9.2 vs 8.4 in `grind-r2` — at most 0.8 ms of the 2.5–3.2) and the audio
callback (not it: `grind-nosound`
opened no sound device — no `[SND]` line in its transcript against
`device opened` and `live voices peaked at 3` in `grind`'s — and rose
+47 %, between the two runs with sound). Which of the remaining
in-simulation items is the milliseconds is not separated here; a
`CYCLE_RUBBER_SPEED`/`CYCLE_RUBBER_MINDISTANCE` sweep would be the way, and
none of the plan's three cheap levers (`WALLS_LENGTH`, a frame cap,
`FLOOR_MIRROR_INT`) touches this part of the frame.

**The sparks are the third thing the grind costs, and they are a render
cost.** In every run the draw count climbs from 60 to 166–184 calls in
bursts (twice in `grind`: seconds 21–28 and 35–53; once long in
`grind-nosound`: 22–57; twice short in `grind-r2`: 20–23 and 55–60) and
falls back; `g-24s-grinding.png` and `g-44s-grinding.png` show the spark
shower at the cycle's front wheel in those seconds and `g-34s-grinding.png`
shows none at 60 draws. The render part goes with them, 5.3–6.0 → 8.2–9.2
ms, **22–31 µs per draw call** — the same coefficient the baseline's spike
rounds gave for wall segments (24–47), from an unrelated source. The
tutorial's hint text (`Press <right> or <o> to turn right.`,
`Or review the input configuration…`, visible in the rim screenshots) is
not the excursion: it is up at 34 s with 62 draws. There is no config item
for sparks in this tree (`gSparks.cpp` has none; `white_sparks` only
changes their colour).

**What this says about the maintainer's "fast and close to a wall".** On
this desktop at rate 6 the wall costs a quarter of a frame in the
simulation and, when sparks fly, another quarter in the renderer; both are
per-frame costs, not accumulations, and both stop the moment the cycle
leaves the wall. The ratios transfer, the milliseconds do not.

## Attempts

Two runs preceded the three above and are kept as text (transcript,
steps, uptime) because each measured a fact the design depends on:

- `attempts/1-stall-1s-arena-0.177x/` (22:10–22:13): the plan's arena
  (`SP_SIZE_FACTOR -3`), a 1 s stall. The cycle reached the rim 9.3 s after
  `NEW_ROUND`, the stall did not kill it (twice), and it sat there for 177 s
  with the gauge at 1.5 (`g-78s-at-rim-after-1s-stall.png`, FPS 77 on the
  HUD). Its round 1 also showed the same shape as the measured runs — two
  throttled free seconds at 12.3–13.5 ms, then 13.0–17.0 ms at the rim with
  `ms_to_first_draw` 8.1–10.2 against 6.5–7.5.
- `attempts/2-stall-6s-no-round-2/` (22:21–22:24, stopped by hand): the
  6 s stall killed the cycle (`DEATH_SUICIDE` 13 ms after it) and no round 2
  followed in 60 s — the `Analysis` fact in item 3 above.

## Hygiene

`pgrep -fl 'drive-browser[.]mjs|em[+][+] '` and the `aa-chrome-*` check
were empty before every run and after the last; attempt 2's driver and
Chrome were killed by hand before the next run and confirmed gone. Load
(`uptime`, 1-minute, before / after, from each `uptime.txt`): grind
10.25 / 9.31; grind-nosound 10.89 / 12.51; grind-r2 10.99 / 14.28;
attempts 12.28 / 9.87 and 12.55 / (stopped). Recorded, not gated: this
desktop idles at 9–13 from the maintainer's own apps. Wall clock per run
about 1 min 50 s.

## Files

- `mech1-baseline-table.txt` — mechanism 1's per-round table and the
  per-second series of the three spike rounds, computed from the ten
  `[PERF]` lines in `docs/evidence/m6-lag/task2-repro` (the script is a
  scratch tool; every figure is the arithmetic stated in "Mechanism 1"
  over the `per_second` and `early_5s`/`late_5s` fields).
  Its header now carries a column note added at the adversarial check:
  `ren%late` is a *growth* share (Δrender ÷ late `ms_p50`), not the render
  part's level share of the frame, and its median 3.1 is the median of two
  populations.
- `grind/`, `grind-nosound/`, `grind-r2/` — per run: `console.log` (the
  transcript; the last `[PERF] <arm> {…}` is the result), `steps.txt`,
  `uptime.txt`, and the proof screenshots: `g-12s-free.png` (free, gauge
  0), `g-24s-grinding.png` (rim, gauge 1.5, sparks), `g-54s-grinding.png`
  (rim, late); `grind/` also keeps `g-18s-approach.png` (just before
  contact) and `g-34s-grinding.png` (rim without sparks, 60 draws). Beside
  each, `<arm>-driver.txt`. The other screenshots each run took
  (`r1-after-tutorial-keys`, `g-44s`, and for the two later runs `g-18s`,
  `g-34s`) repeat these and are not committed.
- `grind-per-second.txt` — the window statistics and the full per-second
  series of the three runs.
- `table.txt` — `summarise.py` over this directory: three `INVALID` rows,
  by design (see "What was run").
- `attempts/` — the two runs above.

## Adversarial check

Both verdicts above were put to three independent skeptics each — one
reading the statistics, one hunting for a harness artifact, one testing game
plausibility — every one of them told to **refute** the verdict and to
default to *refuted* when unsure. Six votes, recorded here with their
reasons verbatim from the workflow journal. Nothing in the evidence was
re-run for this; the skeptics recomputed from the same `[PERF]` JSON and the
same source files.

**Tally.** Mechanism 2: **3 of 3 not refuted** — it stands as written.
Mechanism 1: **2 not refuted, 1 refuted** — no majority to overturn, so the
verdict stands, but all three votes (including the two that upheld it)
raised the same three problems, and this section acts on all three. The
verdict that stands is therefore narrower than the one that was written.

### Mechanism 1 (render / trail re-submission) — statistics lens

**refuted: False** (confidence high)

> Recomputed from the raw [PERF] JSON in
> docs/evidence/m6-lag/task2-repro/base-r{1..5}-driver.txt (per_second +
> early_5s/late_5s); every number in task3-mechanisms/mech1-baseline-table.txt
> reproduces. The effect is separable from noise where it is claimed: in the 3
> spike rounds (r1/2, r4/2, r4/3) r(render,draws)=0.98/0.98/0.95 with
> permutation p<0.001 (2000 shuffles), and the early->late render growth of
> +5.7/+7.2/+7.5 ms is 5-12x the second-to-second sd of the render part on the
> 107-draw plateau (0.5-1.3 ms per round). In the 7 flat rounds render growth
> is -1.5..+1.1 ms (mean 0.23, sd 0.92) — inside that same noise band, which is
> exactly what the claim says ("not a curve", 0.4 of 3.6 ms). One caveat for
> the consumer, not a refutation: the headline "3.1 %" is the median of a
> bimodal set (7 values in -6..+4 %, 3 in 17-21 %); its bootstrap 95 % CI over
> ten rounds is 0.1-17.2 %, so it is an unstable point estimate and the
> two-population split (flat ~0, spike ~20 %) is the defensible statement. Also
> note pre-draw time correlates with draws too in spike rounds (r 0.88-0.92),
> so render is the larger but not the only mover there — the claim's own split
> (5.7/4.1 etc.) already reflects this.

### Mechanism 1 — harness artifact lens

**refuted: False** (confidence high)

> No rig mark coincides with the rise. Driver logs
> (task2-repro/base-r1..r5-driver.txt) show `cpu:6`/THROTTLE-ON once at ~25.0
> s, before round 2, never switched again; per-round harness steps are only the
> bracketed shots at 6/30/50 s (report.js excludes [begin-100 ms, end+250 ms];
> frames_excluded 0 in every early/late window, late window 54-59 s lies after
> the 50.4-50.5 s shot). The event starts at s45 in all 10 rounds with no
> harness step within 15 s of it. In the flat rounds the s50 shot second leaves
> no render bump (e.g. base-r2/2 ren s49/50/51 = 16/17/16 ms; table.txt
> per-second). The spike's driver is draws 107->503/511/393 and kb 181->274,
> counted by sampler.js wrapping the game's own drawArrays/drawElements
> (S.cur.draws++) — nothing in the rig can add GL draw calls — and
> ms_first_draw_to_swap rises with them second by second (s45-s55) while flat
> rounds hold draws 107-111 and render 15-19 ms. Sampler uses preallocated
> typed arrays (Float64Array(N), no per-frame allocation), so no sampler GC;
> pre-round overlay frames are skipped before the split and the round-transition
> HUD falls after the 59.1 s death that closes the late window. One caveat
> outside my lens: the JSON key "share_pct_of_late_frame_time 3.1" is the render
> *growth* as a share of late ms (mech1-baseline-table.txt share_ren_of_late
> median 3.1), not the render part's level share (~60-65 %, 16-18 of 25 ms) — a
> wording issue, not a rig artifact.

### Mechanism 1 — game plausibility lens

**refuted: True** (confidence medium)

> Arithmetic holds (draws exactly 107 at s15-44 in 10/10 rounds per the raw
> per_second in task2-repro/base-r*/console.log; welcome() wallsLength=400 at
> src/tron/gArmagetron.cpp:387; deltas and the 3.1 median reproduce), but the
> evidence never shows mechanism 1's condition: trails are capped, so the only
> draw excursions are three spikes (r1/2, r4/2, r4/3, 107->503/511/393 from
> s45) whose geometry is unidentified — task3 README itself calls the
> wall-segment reading "not a measurement", and gSparks.cpp:110-196 (BeginLines
> + per-spark RenderVertex) plus the grind arm's own spark bursts at 22-31
> us/draw give the same coefficient from a non-wall source. Screenshots
> base-r1/r2-50s.png (498 draws) vs r3-50s.png (107) show an identical
> near-empty arena with distant trail lines; grind/g-24s-grinding.png shows
> only the rim grind. "Confirmed" is therefore a per-draw-call cost of unknown
> geometry, not a confirmation of wall re-submission; and the field
> share_pct_of_late_frame_time=3.1 is render growth over late ms, while the
> render part is ~65% of the late frame (15.9/24.5 ms in r1/3) — misleading as
> labeled.

### Mechanism 2 (simulation at the wall) — statistics lens

**refuted: False** (confidence high)

> Evidence shows the claimed condition: grind/g-24s-grinding.png = cycle
> nose-on to the rim, Rubber Used 1.5/5, sparks, Speed 15.0, Enemies 0;
> g-12s-free.png = gauge 0, empty arena; g-54s still at rim, gauge 1.5.
> grind/console.log: stall eval returned 83543 ms, DEATH_SUICIDE 83559 ms (+16;
> nosound +10, r2 +19), [SND] device opened only in grind/r2. Source backs the
> gauge reading: gCycleMovement.cpp:4179-4182 rubber /= (1+ts/sg_rubberCycleTime)
> -> 15*0.1 = 1.5; gHud.cpp:408 GetRubber()/sg_rubberCycle; gArmagetron.cpp:384-388
> welcome() forces rubber 5, size -2, walls 400, autoNum 0. grind-per-second.txt:
> draws 52-55 free vs flat 60 at the rim outside spark bursts (no trail-growth
> confound), and the s8-17 vs rim@<=70 medians reproduce 11.1/11.3/11.4 ->
> 15.3/14.3/13.7 (+37/+26/+20 %, median +26) with pre-draw 5.9/5.8/6.0 ->
> 9.1/8.6/8.4 and render +0.9/+0.2/+0.0 ms. Caveat the README itself states: the
> 2.5-3.2 ms pre-draw rise is "at-the-wall simulation work" (rubber path +
> camera/spark timestep), not isolated to TimestepCore's recursion; the verdict
> is sound as "wall proximity costs ~26 % of the frame in the simulation part",
> not as a line-level attribution.

### Mechanism 2 — harness artifact lens

**refuted: False** (confidence high)

> No rig explanation fits. grind/console.log: "CPU throttling rate 6x" is set
> once at 25107 ms wall (7.7 s round clock, the s7->s8 jump 6.1->11.6 ms) and
> never again; between 18 s and 60 s the only harness actions are the six
> bracketed screenshots, which report.js drops with a [-100,+250] ms pad
> (313/4250 frames excluded). The 12 s shot sits inside the free window and
> leaves s12 at 11.8 vs 11.1 ms, so a shot cannot make a 40 s plateau.
> sampler.js pre-allocates Float64Array/Uint32Array(600000) — no growing arrays,
> no GC drift; marks/shots are dozens of entries. Single round (closed_by
> report), so no round-transition HUD; the hint text is draw calls (render part)
> and is absent at 44 s while pre is still 9.6. The pre-draw step
> (grind-per-second.txt: 5.9->8.8, 5.7->8.0, 6.0->8.0 at s19, flat 5.8-6.2 over
> s8-17) lands at the same second in all three runs, matching g-18s-approach
> (rim ahead) -> g-24s-grinding (gauge 1.5). Caveats that soften the number, not
> the verdict: machine load 10-14 (uptime.txt), within-rim variance (nosound
> s58-60 falls to 12.2; r2 drifts 13.2->16.5 at flat 60 draws), and "same 60
> draws" is really 53->60 (render +0.0-0.9 ms).

### Mechanism 2 — game plausibility lens

**refuted: False** (confidence high)

> Recomputed from the [PERF] JSON in
> docs/evidence/m6-lag/task3-mechanisms/{grind,grind-nosound,grind-r2}/console.log
> and task2-repro/base-r{1..5}/console.log (parsed copies in scratchpad/stat/*.json).
> Grind arms, s8-17 vs s20-59@draws<=70: ms_p50 11.1/11.3/11.4 -> 15.3/14.3/13.7
> (matches the claim); before-window per-second SD only 0.25-0.73 ms, gap = 4-14
> SD; Mann-Whitney P(rim second > free second) = 1.00/0.97/1.00 for ms and
> 1.00/1.00/1.00 for ms_to_first_draw (rim min 8.0-8.6 vs free max 6.1-6.2, zero
> overlap in all three runs); the rise is a step at s18-19 (e.g. grind pre
> 5.9,5.9,6.9,8.8,8.9), coincident with the 18.5 s rim contact, not a drift.
> Noise band from Task 2's ten measured rounds with the SAME window shape (s8-17
> vs s20-59, draws flat 108->107): ms -3..+8 % (-0.6..+1.9 ms), pre-draw
> -0.2..+0.3 ms, P=0.29-0.73, i.e. indistinguishable from zero. Grind's
> +20/+26/+37 % and pre +2.5..+3.2 ms sit well outside that band (pre-draw is 8x
> the largest baseline drift; the weakest run, grind-r2, +2.3 ms total, still
> exceeds every baseline round and its pre-draw part alone is +2.5). The mech2
> effect is distinguishable from run-to-run noise; the +26 % median is
> faithfully reported (rim@<=70 vs rim-all 17.1/16.2/14.0 is the higher,
> spark-inclusive number, so the claim is if anything conservative).

### What was changed because of these votes

Three things, all raised by more than one skeptic, all now fixed in this
directory. No measurement was re-run and no number moved.

1. **"Share of the late frame time 3.1 %" was the wrong label**, and all
   three mechanism-1 skeptics said so independently. The 3.1 % is the render
   part's *growth* (Δrender between the early and late windows) divided by
   the late frame time — the `ren%late` column of
   `mech1-baseline-table.txt`. The render part's **level** share of the late
   frame is a different and much larger number: recomputed from the same ten
   `[PERF]` objects as `ms_first_draw_to_swap_p50 ÷ ms_p50` in each late
   window, it is **62.1–68.9 %, median 65.4** (flat rounds 62.1–66.8, median
   64.9; spike rounds 65.9–68.9, median 67.7). Both wordings are corrected
   above, and `mech1-baseline-table.txt` now carries a column note saying
   which is which. *One place was deliberately left alone:*
   `docs/evidence/m6-lag/display-lists-pricing.md` (Task 5, commit
   `5ada43f0`) inherited the same phrasing — "the ten baseline rounds put the
   render part's share of the late frame at a median 3.1 %". Read it as the
   *growth* share; its go/no-go argument is about what a display list could
   remove from the growth, which is the number it needs, so the conclusion is
   unaffected. That note is Task 5's document and is not edited here.
2. **The 3.1 % median is of a bimodal set** and should not be quoted as a
   point estimate: seven flat rounds at −6 to +4 % and three spike rounds at
   17–21 %, bootstrap 95 % CI over the ten 0.1–17.2 %. The two populations
   are now stated in place of the median wherever the median was leaned on.
3. **"Confirmed" means a per-draw-call cost of unknown geometry.** The
   trails are capped at 400 units in this match, the draw count is flat at
   107 for thirty seconds in all ten rounds, and the only excursions are the
   three spikes, whose geometry was never identified — `gSparks.cpp`'s own
   bursts give the same 22–31 µs coefficient from a non-wall source, as the
   grind arm measured. So mechanism 1 is confirmed as **"extra draw calls
   cost 24–47 µs each in the render part of the frame"**, and *not* as
   "wall re-submission is confirmed". Nothing in Tasks 1–4 shows the walls
   themselves growing; Task 4 later added the reason it could not
   (`task4-levers/README.md`: cutting the trail to 150 units removed at most
   1 KB of 179 per frame and no draw calls, because a cycle's segments batch
   into one draw per pass).

The refuting vote's own conclusion is the one to carry forward: the
condition mechanism 1 describes — a trail that grows without bound,
re-submitted every frame — has never been on screen in any arm of this
milestone, because every arm played the tutorial match. That is the same gap
Tasks 4 and 5 name, and it is M6's open item.
