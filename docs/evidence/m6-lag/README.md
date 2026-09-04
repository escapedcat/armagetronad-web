# M6 — the phone lag, measured

The maintainer's report was *"it lags — starts smooth, gets laggier the more
I drive, and when I'm fast and close to a wall."* M6 built a rig that can
tell whether that is happening, reproduced it ten times, put a number on both
candidate mechanisms, A/B'd four settings-only levers against the baseline,
and priced the one structural fix anybody had proposed. **Nothing was built.
No source file outside `web/tools/perf/` was changed on this branch, and no
decision is taken here** — this document ends in three options and stops.

| | what it established | where |
|---|---|---|
| Task 1 | the harness proves its own condition, and a negative control fails | [`task1-rig/`](task1-rig/README.md) |
| Task 2 | ten measured rounds: the growth is real, and it is an **event at second 45**, not a slope | [`task2-repro/`](task2-repro/README.md) |
| Task 3 | both mechanisms measured; six skeptics then narrowed one of the verdicts | [`task3-mechanisms/`](task3-mechanisms/README.md) |
| Task 4 | four levers, eleven completed runs of twelve: one moves the event, one moves the variance, two are not levers | [`task4-levers/`](task4-levers/README.md) |
| Task 5 | display lists priced, written before Task 4 ran: **not yet** | [`display-lists-pricing.md`](display-lists-pricing.md) |
| Task 7 | the game the phone actually plays, measured: unlimited trails do **not** grow the render work, and a trail cap still shortens the second-45 event | [`task7-posttutorial/`](task7-posttutorial/README.md) |

**Every millisecond in this milestone is one desktop's**, at `MAX_FPS 1000`
under a 6× CPU throttle at a phone's pixel count, with a fixed event-loop
yield inside each frame interval that the throttle does not scale
(`web/tools/perf/README.md`, "What a frame time contains"). Ratios and
per-arm deltas travel; the milliseconds are not a phone's.

## 1. The baseline

Five runs, ten measured rounds, one configuration
([`task2-repro/README.md`](task2-repro/README.md)):

1. **`ratio_ms ≥ 1.2` in 4 of 10 rounds; ≥ 1.15 in 8 of 10; median 1.19;
   worst 1.63** (22.1 → 36.1 ms p50, p90 46.4, 42 hitches over 50 ms).
   The plan's gate was "fewer than 3 of 10 changes the framing": it clears.
2. **But not with the shape the story assumed.** From second 15 to second 44
   the draw count is *exactly 107 per frame* in every round of every run and
   the per-second `ms_p50` sits at 22.4–25.4. There is no slope. At second
   45 the part of the frame before its first draw call — the yield, input,
   the simulation, the AIs — jumps from 6.6–7.7 ms to 11.9–16.7 and stays up
   until about second 55, in **10 of 10 rounds**.
3. **In 3 of 10 rounds the draw count spikes** at the same moment, 107 → 393,
   503, 511 calls per frame at second 49, with the render part going
   17–18 → 27.6–34.8 ms and `kb_per_frame` 179–182 → 229–274. Those three are
   the three large ratios. The other seven grow 1.0–4.4 ms, of which the
   render part is a median 0.4 ms.
4. **Run-to-run spread of the level is about 4 ms (17 %)**, and round 3 never
   opened slower than round 2 in any run: nothing accumulates across rounds.
   A lever that moves the level by less than 4 ms in one run has not been
   shown to do anything.
5. **A same-second marker sits in the transcript**: the sound engine's voice
   limiter starts cutting 45.44–45.56 s after `NEW_ROUND` in round 2 of all
   18 runs of Tasks 2 and 4. How long it *stays* cutting separates spike
   rounds from flat ones exactly (past 56 s in the three round-2 spikes,
   47.07–47.34 s in the other fourteen). A correlate with timestamps, not a
   cause; no lever tested moved it.

## 2. The two mechanisms

Measured in Task 3, then put to three independent skeptics each — every one
instructed to refute — and recorded verbatim in
[`task3-mechanisms/README.md`](task3-mechanisms/README.md), "Adversarial
check".

**Mechanism 2 — the simulation at the wall: confirmed. 3 of 3 skeptics did
not refute it.** An arm that holds one cycle against the rim with nothing
else in the arena costs **+20, +26 and +37 %** of the frame (three runs,
11.1–11.4 → 13.7–15.3 ms p50) at the *same draw count* as free driving, and
the whole rise is before the first draw call: `ms_to_first_draw` +2.5 to
+3.2 ms (+41 to +55 %), render +0.0 to +0.9. Closing the sound device does
not remove it. The grind also throws sparks, which are a separate *render*
cost: +110 draw calls at 22–31 µs each. This is the maintainer's *"fast and
close to a wall"*, and it is a per-frame cost that stops the moment the
cycle leaves the wall — not an accumulation. It is sound as *"wall proximity
costs about a quarter of the frame in the simulation part"*, not as a
line-level attribution to `TimestepCore`'s recursion.

**Mechanism 1 — the renderer re-submitting trails: confirmed as a cost, and
narrower than it was first written.** 2 of 3 skeptics did not refute it; the
third did, and all three raised the same limits, which the README now
carries. What is confirmed: where the draw count moved, the render part
moved with it and nothing else did (r = 0.95–0.98), at **24–47 µs per extra
draw call**. What is *not* confirmed: that the geometry behind those spikes
was walls — the trails are capped at 400 units in this match, the draw count
is flat at 107 for thirty seconds in 10 of 10 rounds, and `gSparks.cpp`'s
own bursts give the same coefficient from a non-wall source. Three numbers
to keep straight, because the first write-up conflated them: the render part
is **62–69 % of the late frame** (median 65.4); the render part's *growth*
is **a median 3.1 % of the late frame time** (−6 to +4 % in the seven flat
rounds, 17–21 % in the three spike rounds — the median of two populations,
not a point estimate); and its share of the growth itself, Δrender ÷ Δms,
is **a median 21 %** (12.5 % in the flat rounds, 54–61 % in the spike
rounds).

Together: **the growth this milestone reproduced lives in the simulation, and
the renderer is most of the frame's cost but, in the seven flat rounds,
almost none of its growth — in this match.** In the three spike rounds it is
54–61 % of the growth.

## 3. The levers

Eleven completed runs of twelve, plus a probe, A/B against the baseline
([`task4-levers/README.md`](task4-levers/README.md)). Ranked on the metric
Task 3 identified — the pre-draw (simulation) part that actually grows:

| rank | lever | what it does, measured | what it costs the player |
|---|---|---|---|
| 1 | **trail length** (150 units instead of 400) | the only lever that moved the growth: mean `ms_to_first_draw` over seconds 45–55 **9.65 ms against the control's 11.53**, and the second-45 event lasts **4–5 s in 6 of 6 rounds against 11–12** in the control. Its one draw spike was 6 s long instead of 13. | your trail ends 150 units behind you, and so does everyone's — a real gameplay change. Today only reachable through `CYCLE_DIST_WALL_SHRINK` + `_OFFSET`, because the tutorial match forces `SP_WALLS_LENGTH` to 400. |
| 2 | **`MAX_FPS 30`** | pins the plateau at the cap (33.33 ms median) and removes the *difference* between a spike round and a flat one: `ratio_ms` 1.010 mean and 1.04 worst against 1.264 and 1.63; its one spike round peaked at 39.5 ms against the baseline spikes' 43.0, 45.3 and 51.6. It does not remove the spikes. (4 measured rounds; `fps30-r3` INCOMPLETE, no `[PERF]`. Its pre-draw part carries the limiter's `emscripten_sleep` — plateau 15.70 ms — and is not comparable to the other arms', so this rank rests on `ratio_ms`, not on the pre-draw split.) | half the frames — 29 fps mean over its four late windows against 33.8. Steadier, slower. |
| 3 | **`FLOOR_MIRROR_INT 0`** | **null.** `sr_floorMirror` is already `rMIRROR_OFF` in this build and the mirrored pass is not rendered; the setting only supplies that pass's alpha. Its six rounds are a second `base` replicate. | nothing gained, nothing lost. Do not ship it as a fix. |
| 4 | **`SP_WALLS_LENGTH`** | **inert in the match every arm played** — `welcome()` overwrites it with 400. Proved by a probe that read the identical 107.0 draws/frame. | — but see §5: this is the setting the phone's real path actually uses. |

**Nothing cheap touched the flat cost.** Over seconds 15–44 the plateau
`ms_to_first_draw` is 6.97–7.35 ms in every arm but `fps30` — a 0.38 ms
spread that straddles the baseline's 7.20 in both directions, with the
control *below* it and the lever *above*. And **nothing here touches
mechanism 2**, exactly as Task 3 predicted.

One result worth carrying into any renderer work: cutting the visible trail
by roughly two thirds removed **at most 1 KB of 179 per frame and no draw
calls at all**, because a cycle's wall segments batch into one draw per pass
and a cycle driving straight has few segments whatever its trail's length.
Trail *length* is not trail *cost* in this scene.

## 4. Display lists

[`display-lists-pricing.md`](display-lists-pricing.md) (Task 5, a design
note, no code) prices the only structural fix anyone proposed, and its
verdict is **not yet**.

Written before Task 4 ran (at `172066e8`, when the evidence tree had no
`task4-levers`): its Task-4 comparison is a named gap, and its "3.1 % share
of the late frame" is the growth share (Task 3, "Adversarial check",
item 1). Task 4's result — the cap removed almost no render work — does not
trip its no-go condition and has not been folded back in.

- The only shape that touches the priced cost is a JS-library override that
  wraps the emulation's `GLImmediate.flush` (~250–400 lines of new
  `web/library_displaylists.js`, a Makefile flag, the five `eCompat.cpp`
  stubs removed, an `autoexec.cfg` change). The C++-side shape saves nothing
  that was measured. That is a milestone with its own gate, in the layer that
  produced M2's largest defect class.
- **The ceiling**: the difference between a scene with the walls, models and
  floor and one without is 10–13 ms of a 24.5–28.0 ms flat late frame —
  36–53 %, unsplit, an upper bound over three things of which lists could
  capture two. Of the *growth* the maintainer feels, the part a wall list
  could remove is a median 0.4 ms of 3.6.
- Its own build-it-if: a same-arena split showing walls alone at ≥ 5 ms of a
  flat late frame **on the post-tutorial boot path** and growing. That
  measurement does not exist.
- It also corrects four beliefs the plan carried (`rDisplayList_CAC` is
  compile-then-call, not compile-and-execute; forcing `USE_DISPLAYLISTS`
  does not trip `tASSERT` in this build; models and the HUD *do* own display
  lists while the floor and sparks do not; plain wall segments do not each
  cost a draw call). Read them before designing anything here.

## 5. What was NOT measured

Three gaps. Every option in §6 turns on the first — and **the first has since
been measured**: Task 7 took it, and the paragraph under item 1 says what it
found. The other two stand, and gap 2 is now the one that matters.

1. **The game the phone actually plays.** Every arm in Tasks 1–4 measured
   the **tutorial match**: a first-use boot, so `welcome()`
   (`src/tron/gArmagetron.cpp`) runs and forces `wallsLength = 400`,
   `rubber = 5`, `speedFactor = -2`, `sizeFactor -= 2` for the duration. The
   phone plays the **post-tutorial** game — every launch after the first,
   where `welcome()` returns early at its `else` branch, `SP_` settings are
   live, and the shipped `SP_WALLS_LENGTH` is −1: `gCycle::wallsLength =
   -1.0f`, **trails that never expire**. That is the only configuration in
   which *"the more I drive"* can be literally about the trail, and it is the
   configuration in which the wall-length lever is a direct setting rather
   than a workaround. **No arm in Tasks 1–4 ever booted it.**

   **Measured, Task 7**
   ([`task7-posttutorial/README.md`](task7-posttutorial/README.md)): ten runs
   on that boot path, eight of them VALID, each with a mid-round probe that
   saves the live config and reads `SP_WALLS_LENGTH -1`, `SP_SPEED_FACTOR 0`
   and `SP_SIZE_FACTOR 6` back out of the running game. **Unlimited trails do
   not make the render work grow.** From second 15 to second 44 the draw count
   is exactly **114.00 per frame in all eighteen measured rounds** — whether
   the trail is capped at 150 units, at 400, or not at all — and the plateau
   frame cost (23.30 ms), its simulation part (7.25) and its render part
   (15.95) all sit inside Task 2's own spread (23.67 / 7.20 / 16.35). So the
   sentence this item used to end with is withdrawn: the 107-draw plateau is
   **not** an artefact of the 400-unit cap; with the cap gone the plateau is
   114 and just as flat, because a cycle driving straight lays one wall
   segment however long its trail grows. What a cap does move on that path is
   the same second-45 event Task 4 found on the tutorial one — bump length a
   median 13 s uncapped, 6 s at 400 units, 2 s at 150, with late p90 35.60 →
   28.50 → 27.05 ms. Two things that arm could not reach: the human is still
   idle (gap 2), and the **shipped** configuration cannot be measured by this
   rig at all — its rounds last 8.1 s because an idle human dies 6.5 s into an
   AI's wall, and Task 7 records that rather than changing shipped values to
   open its own gate.

2. **The human never drives in a measured round.** The two tutorial key
   presses are sent and Task 1 proved the browser delivers them as trusted
   events — but nothing in the transcript or the screenshots shows the cycle
   turning, and Task 1 says so explicitly: the "Press `<right>` …" hint
   reappears whether or not the turn happened. In all ten baseline rounds
   the human drove straight at 15.0 and died to an AI's wall at 59.1 s. A
   human turning many times in a few seconds — which adds a wall segment per
   turn — is a shape this template cannot produce.
3. **Desktop only.** Chrome on macOS at `--mobile 915,412,3` with a 6× CPU
   throttle is a stand-in for a phone's regime, not a phone. Nothing here ran
   on the maintainer's device. (Chrome also updated mid-sweep in Task 4,
   between the `-r1` and `-r2` passes — balanced across arms, but one more
   reason the same-configuration control matters more than the cross-task
   baseline — and a Time Machine backup plus XProtect scans ran through the
   whole Task 4 window, 1-minute load 5.47–12.66 in each run's `uptime.txt`:
   another reason to read ratios and same-sweep deltas, not milliseconds.)

## 6. Three options for the maintainer

Costed, not ranked. **The decision is the maintainer's, and the work stops
here.**

### A. Ship the trail cap on touch

*What:* cap the trail length for phone players. On the post-tutorial path
that is `SP_WALLS_LENGTH <n>`; on any path where `welcome()` runs it has to
be the shrink pair (`CYCLE_DIST_WALL_SHRINK 0.00025`,
`CYCLE_DIST_WALL_SHRINK_OFFSET 1000000` for an effective 150 units), because
`SP_WALLS_LENGTH` is overwritten there.

*Cost to build:* one or two lines in `web/webdefaults/autoexec.cfg`, which
the port already ships and which loads after both `user.cfg` and
`settings.cfg`. No source change, no rebuild of the game. Making it
conditional on touch rather than global is **not** settings-only and has not
been designed.

*Cost to the player:* trails end 150 units behind every cycle, the player's
and the AIs'. That changes how the game plays for everyone on that build.

*What the evidence says:* it is the only lever that moved the growth, and it
moved it by shortening the second-45 event from 11–12 s to 4–5. It did not
move the flat cost, it did not remove the spikes, and it removed almost no
render work. **Task 7 has now tested it on the path the phone plays, and it
survives.** Against unlimited trails as the baseline there, `SP_WALLS_LENGTH
150` shortens the second-45 event from a median 13 s to **2 s** (`400`: 6 s)
and takes late p90 from **35.60 to 27.05 ms**, while moving the flat cost by
−0.25 ms, which is inside that arm's own round-to-round spread. It did **not**
matter more there, as "should" had it: the cap removes 8 draw calls and 1.08 KB
of 179 per frame, because trail length is not what sets the draw count
([`task7-posttutorial/README.md`](task7-posttutorial/README.md) §4). Two
things to re-cost with: on that path the setting is live — the probe reads it
back from inside a measured round — so the one-line `SP_WALLS_LENGTH` form is
the one that applies to the phone, and the shrink pair is still what any path
where `welcome()` runs would need.

### B. Ship nothing, and measure the post-tutorial path first

**Taken — this is Task 7** ([`task7-posttutorial/`](task7-posttutorial/README.md)).
Re-cost as done, not as pending.

*What it cost to build:* `web/tools/perf/posttut.steps.tmpl` (the measured
structure on a `FIRST_USE 0` boot, with the three render settings a returning
phone has and the two turn binds `sg_StartupPlayerMenu` would have written),
`check-arm.mjs --posttut` (three checks on top of the existing gate: the menu
walk, the patched `autoexec.cfg`, and a mid-round probe that saves the live
config and reads the `SP_` values back out of it), and `run-posttut.sh`. Ten
runs at about four minutes each, one machine, one morning.

*What it bought:* the answer, and it is **no** — trail length is not a cost
that grows with driving time on the real path (§5 item 1 above). It also
bought option A its missing evidence, and it bought a *narrower* case for
option C than the milestone had before.

*What it did not buy, and what a next measurement would have to:* a human who
**turns** — gap 2, and now the one that matters, because draw calls follow
turns and a turning player is the case where they would actually grow; a phone
(gap 3); and the **shipped** configuration, whose 8.1-second rounds this rig
cannot measure with an idle driver at all.

### C. Ship nothing, and build display lists as M8

*What:* the JS-library override of §4, as its own milestone with its own gate.

*Cost to build:* 250–400 lines of new `web/library_displaylists.js` plus a
Makefile flag, the `eCompat.cpp` stubs, and `autoexec.cfg`; the
`GL_UNSAFE_OPTS` bookkeeping around a persistent vertex buffer; record/replay
semantics for `Cancel()` and `ClearAll()`; and it lives in the layer that
produced this port's largest defect class
(`docs/porting/browser-runtime-notes.md` § 10).

*Cost to the player:* none by design — the scene is drawn as today. The risk
is that layer's defect class: a replay that leaves the emulation's
`lastArrayBuffer` incoherent makes the next immediate-mode flush read its
attributes off the list's buffer ("odd glitches", in the emulation's own
warning; Task 5 §2b).

*What it buys:* the wall pass's per-segment cost — 16 wasm→JS calls and
152 bytes of upload per plain segment per frame (the persistent-buffer
variant; the cheap variant saves the calls and not the bytes) — for every
listed wall of every cycle, amortised over the manager's rebuilds; models are
list-able by the same mechanism. Its ceiling is §4's unsplit 36–53 % of a
flat late frame, and Task 5 §3 says the wall share "can only be larger" on
the unlimited-trail path — which Task 7 has now measured, and where it is not
larger (below).

*What the evidence says:* Task 5's own verdict is **not yet** — the growth
this milestone measured is in the simulation, which no list touches, and the
render-side ceiling has never been split into walls versus floor versus
models. Task 4's result (the cap removed at most 1 KB of 179 and no draw
calls) did not trip Task 5's no-go condition, and Task 5 was not revisited
after it (§4). **Task 7 has now measured the path Task 5 §3 expected the wall
share to be larger on, and it is not larger:** with trails that never expire
the render part of the flat frame is **15.95 ms**, no worse than the
tutorial's 16.35, the draw count is exactly **114.00 per frame from second 15
to 44 whether the trail is capped at 150, at 400, or not at all**, and the
render part does not grow through the round
([`task7-posttutorial/README.md`](task7-posttutorial/README.md) §3–§4). That
answers the "and growing" half of §4's build-it-if in the negative and makes
this option's case weaker, not stronger; the wall-versus-floor-versus-model
split that would answer the other half still does not exist.

## 7. Evidence weight, and the seed

**About 49 MB across the five task directories** — 259 committed files, 93
of them PNG (`task1-rig` 5.4 MB, `task2-repro` 6.0 MB, `task3-mechanisms`
7.6 MB, `task4-levers` 16 MB, `task7-posttutorial` 14 MB). Every run keeps its `console.log` (the
transcript, ending in the `[PERF]` JSON that every number here is computed
from), its `steps.txt` (the exact script that ran, config lines included),
its `uptime.txt` and its driver log; screenshots were trimmed to the ones
that prove something — the 50 s picture of each measured round, plus the
handful that show a lever's or an arm's condition actually holding. Each
directory's `table.txt` is `web/tools/perf/summarise.py` over it, generated
on this tree.

**The M6 seed stash is still there and still unused**:
`stash@{0}` — *"On m5-exit: M6 seed: first perf sweep (INVALID: never drove
the cycle) + its tooling"*. It was never applied, never dropped, and nothing
in this milestone cites it; the harness in `web/tools/perf/` was built new in
Task 1 for the reason the stash's own title gives. Drop it when this branch
merges, or keep it as the record of what an unvalidated sweep looks like.
