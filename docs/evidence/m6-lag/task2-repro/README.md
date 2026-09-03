# Task 2 — reproducibility: five `base` runs, ten measured rounds

Five runs of the same arm, one after another, on 2026-09-03 between 20:59
and 21:17: this worktree's `web/dist-m1` (the 17:17 build Task 1 measured;
`make -f web/Makefile client` reported nothing to do before the first run)
served by `python3 -m http.server 8006 --directory web/dist-m1`, Chrome
152.0.7977.75 headed at `--mobile 915,412,3`, CPU throttle 6× from round 1
on, `MAX_FPS 1000`, `SP_SIZE_FACTOR 6`, `SP_NUM_AIS 7`. Harness unchanged
from Task 1 (`web/tools/perf/`, commit `68810502`). Every run printed
`VALID`; none was re-run.

**These are one desktop's numbers.** Every millisecond is a frame interval
at `MAX_FPS 1000` under a 6× CPU throttle at a phone's pixel count, and a
frame interval contains a fixed event-loop yield the throttle does not scale
(`web/tools/perf/README.md`, "What a frame time contains"). The early-vs-late
ratios and the deltas between arms are what travels; the milliseconds are
not a phone's.

**The match is `welcome()`'s tutorial match** — every run is a first-use
boot — so the trails are capped at 400 units, the speed factor is −2 and the
arena is size factor 4 (`web/tools/perf/README.md`, "What an arm is"). The
measured rounds are AI-driven with an idle human: in all ten the human cycle
drove straight at 15.0 and died to `notepad`'s wall 59.10–59.13 s after
`NEW_ROUND` (`[L] DEATH_FRAG web_user notepad` in every `console.log`), and
no AI died in any round (each `ROUND_WINNER` lists all seven). The two key
presses landed 5.38–5.39 s and 5.72 s after round 1's `NEW_ROUND` in every
run, after the 4 s countdown.

## Commands

    for k in 1 2 3 4 5; do
      sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task2-repro "base-r$k" 6 'SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7'
    done
    python3 web/tools/perf/summarise.py docs/evidence/m6-lag/task2-repro | tee docs/evidence/m6-lag/task2-repro/table.txt

Run one at a time, each started only after the previous `run-arm.sh` had
exited and `pgrep -fl 'drive-browser[.]mjs|em[+][+] '` and a check for
`aa-chrome-*` profile processes both came back empty (no waiting was ever
needed; no build ran during the session). `AA_PERF_PORT` was left at its
default 8006 — the plan's 8000 is another worktree's server on this machine.
Load (`uptime`, 1-minute, from each run's `uptime.txt`, before / after):
r1 8.88 / 10.90; r2 12.49 / 11.51; r3 12.82 / 11.71; r4 14.06 / 9.74;
r5 8.83 / 12.61. Recorded, not gated: this desktop idles at 9–13 from the
maintainer's own apps.

## The ten measured rounds

Frame costs at `MAX_FPS 1000`; `cpu` = the CDP throttle rate. `early` is
the five seconds from the first world frame after `NEW_ROUND` (0.53–0.54 s),
`late` the five seconds before the human's death (to 59.10–59.13 s). Hitches
are frames over 50 ms; the first figure is over the measured span, the
second inside the late window. `frames_excluded` is 0 in every window (the
50 s screenshots fell at 50.40–50.56 s).

| run | round | cpu | early ms p50 | late ms p50 | ratio_ms | late ms p90 | early draws | late draws | ratio_draws | late KB/frame | hitches span / late |
|---|---|---|---|---|---|---|---|---|---|---|---|
| base-r1 | 2 | 6 | 22.8 | 33.1 | **1.45** | 42.7 | 95.4 | 355.7 | 3.73 | 274.0 | 23 / 4 |
| base-r1 | 3 | 6 | 21.3 | 24.5 | 1.15 | 30.8 | 89.6 | 112.7 | 1.26 | 181.7 | 7 / 1 |
| base-r2 | 2 | 6 | 21.6 | 25.8 | 1.19 | 34.5 | 95.9 | 114.8 | 1.20 | 179.5 | 6 / 1 |
| base-r2 | 3 | 6 | 20.6 | 24.8 | 1.20 | 31.7 | 90.1 | 112.7 | 1.25 | 182.0 | 2 / 1 |
| base-r3 | 2 | 6 | 24.3 | 27.0 | 1.11 | 36.2 | 95.9 | 112.2 | 1.17 | 179.4 | 9 / 2 |
| base-r3 | 3 | 6 | 24.1 | 25.1 | 1.04 | 31.7 | 90.3 | 111.5 | 1.23 | 181.6 | 8 / 0 |
| base-r4 | 2 | 6 | 22.3 | 34.1 | **1.53** | 45.6 | 95.2 | 336.9 | 3.54 | 266.8 | 32 / 11 |
| base-r4 | 3 | 6 | 22.1 | 36.1 | **1.63** | 46.4 | 89.8 | 234.7 | 2.61 | 229.3 | 42 / 9 |
| base-r5 | 2 | 6 | 23.8 | 27.4 | 1.15 | 34.5 | 95.0 | 114.2 | 1.20 | 179.4 | 7 / 2 |
| base-r5 | 3 | 6 | 23.6 | 28.0 | 1.19 | 36.8 | 89.8 | 112.8 | 1.26 | 182.1 | 8 / 1 |

Every value is from the `[PERF]` line at the end of that run's
`console.log` (`table.txt` is `summarise.py` over the five). Sampled frames
per run: 11576, 12052, 11619, 11358, 11378, every one ending in `glFinish`;
`ms_in_swap` p50 0 and max ≤ 2.0 ms in every window, so no GPU wait hides in
these intervals.

**Three sentences.**

1. `ratio_ms ≥ 1.2` in **4 of 10** rounds (1.20, 1.45, 1.53, 1.63). Two more
   read 1.19 (1.194 and 1.186 before rounding) and two read 1.15 (1.150 and
   1.151), so **8 of 10** are ≥ 1.15; 3 of 10 are ≥ 1.45. Counted over the
   ten `ratio_ms` values in the table above; the unrounded figures are each
   row's late p50 divided by its early p50. (An earlier revision of this
   sentence said 7 of 10; no reading of the ten values gives 7.)
2. Median `ratio_ms` **1.19** (the ten sorted: 1.04, 1.11, 1.15, 1.15, 1.19,
   1.19, 1.20, 1.45, 1.53, 1.63); worst **1.63**, run 4 round 3, 22.1 → 36.1 ms
   p50 with the p90 at 46.4 ms and 42 hitches over 50 ms in the span.
3. `ratio_draws` moves with `ratio_ms` **only in the three rounds where the
   draw count spiked**: Pearson r over the ten (`ratio_ms`, `ratio_draws`)
   pairs in the table is 0.86, but over the seven rounds without a spike it is
   0.28 — there `ratio_draws` is 1.17–1.26 in every round regardless of
   `ratio_ms` (1.04–1.20), because the early window starts before the trails
   have reached their 400-unit cap (90–96 draws/frame) and every late window
   without a spike sits at 111.5–114.8. Read: the draws track the
   milliseconds when a spike happens (1.45–1.63 ↔ 2.61–3.73) and carry no
   information about the 4–20 % growth of the other seven rounds.

**Cross-round drift.** Round-3-early minus round-2-early, per run: −1.5,
−1.0, −0.2, −0.2, −0.2 ms — round 3 never opened slower than round 2, so
nothing carries over between rounds. Between runs the early window ranged
20.6–24.3 ms (runs 3 and 5 sat 2–3 ms above runs 1, 2 and 4 in both of
their rounds, with no matching pattern in the load figures above): the
run-to-run spread of the *level* is about 4 ms, or 17 %. A lever that
changes the level by less than that in one run has not been shown to do
anything; ratios and paired deltas are what to compare.

## The shape: an event at second 45, not a slope

The per-second series (`table.txt`, and `per_second` in each `[PERF]` line)
say the same thing in all ten rounds. From second 15 to second 44 the draw
count is **exactly 107 per frame** in every round of every run and the
per-second `ms_p50` sits at 22.4–25.4 (medians over those thirty seconds;
no single second above 28.1). Then, at second 45, the part of the frame
before its first draw call (`ms_to_first_draw`: the yield, input, the
simulation, the AIs' thinking) jumps from 6.6–7.7 ms to a peak of 11.9–16.7
ms and stays high until about second 55 — in **10 of 10** rounds, spike or
not. In **3 of 10** rounds (run 1 round 2, run 4 rounds 2 and 3) the draw
count climbs at the same moment, from 107 to a peak of 503, 511 and 393
calls per frame at second 49, and the render part of the frame
(`ms_first_draw_to_swap`) goes from 17–18 ms to 27.6, 30.4 and 34.8 before
both decay by second 58; `kb_per_frame` rises with it (179–182 → 229–274).
In the other seven the draw count moves 107 → 111–119 and the render part
rises by at most 2.8 ms.

| run / round | ms p50, seconds 15–44 (median) | ms p50, second 44 | peak ms p50, seconds 45–55 (at) | `ms_to_first_draw`, s44 → peak | `ms_first_draw_to_swap`, s44 → peak | draws/frame peak (at) | ms p50, seconds 56–58 |
|---|---|---|---|---|---|---|---|
| r1 / 2 | 24.6 | 25.4 | 43.0 (49) | 7.5 → 15.6 | 17.9 → 27.6 | 503 (49) | 32.6, 29.5, 27.9 |
| r1 / 3 | 23.1 | 23.4 | 32.3 (48) | 7.2 → 13.8 | 16.2 → 18.2 | 115 (58) | 23.0, 23.2, 24.2 |
| r2 / 2 | 22.9 | 22.9 | 30.9 (47) | 7.0 → 13.1 | 15.8 → 18.6 | 119 (58) | 23.4, 23.3, 28.4 |
| r2 / 3 | 22.4 | 21.7 | 27.2 (48) | 6.6 → 11.9 | 14.8 → 16.4 | 115 (58) | 25.5, 24.6, 23.4 |
| r3 / 2 | 24.6 | 23.9 | 32.5 (49) | 7.4 → 14.0 | 16.7 → 19.4 | 114 (58) | 23.9, 26.8, 27.2 |
| r3 / 3 | 23.1 | 22.9 | 30.0 (46) | 7.0 → 13.1 | 15.7 → 17.7 | 113 (58) | 25.2, 23.6, 23.9 |
| r4 / 2 | 23.7 | 24.3 | 45.3 (49) | 7.3 → 14.7 | 17.1 → 30.4 | 511 (49) | 33.8, 31.6, 28.6 |
| r4 / 3 | 24.8 | 25.5 | 51.6 (49) | 7.5 → 16.7 | 17.8 → 34.8 | 393 (49) | 35.5, 31.9, 35.5 |
| r5 / 2 | 23.7 | 25.4 | 32.4 (46) | 7.7 → 14.3 | 17.6 → 19.0 | 117 (58) | 26.2, 25.1, 26.9 |
| r5 / 3 | 25.4 | 25.4 | 34.2 (51) | 7.7 → 13.5 | 18.2 → 20.4 | 116 (58) | 27.1, 27.1, 29.4 |

Same units and caveats as the first table; seconds are on the round clock
from `NEW_ROUND`. The draws peak "(58)" in the flat rounds is the ordinary
107 → 119 creep of the round's last seconds, not a spike.

Two consequences for reading `ratio_ms`. First, the late window (54–59 s)
catches only the *tail* of the bump: in the seven flat rounds seconds 56–58
have already returned to 23.0–29.4 ms, and their `ratio_ms` of 1.04–1.20 is that
tail plus a 2–3 ms rise in `ms_to_first_draw` between the windows (early
5.6–6.2, late 8.1–9.3 ms) — not an accumulation over the round. Second, the
three large ratios are the spike overlapping the late window (run 1 round 2:
355.7 draws/frame in the late window against 107 at second 44). The rounds
2 and 3 of the same run do not agree with each other (run 1: 1.45 then 1.15;
run 4: 1.53 then 1.63; runs 2, 3, 5 flat in both), so the incidence — 3 of
10 — is per round, not per run.

What the second-45 event *is* was not established here, and it is the
question Task 3 inherits. What is recorded:

- It starts at the same second in every round with the human on the same
  straight line, and no cycle dies until 59.1 s.
- The 50 s screenshots of a spike round (`base-r4/r3-50s.png`, FPS 19 on the
  HUD, 365 draws/frame in that second) and of a flat round
  (`base-r2/r2-50s.png`, FPS 37) show the same forward view — three trails at
  the horizon, the cycle at 15.0 — so the geometry the draw count reports is
  not in the camera's view.
- **The transcript carries a same-second marker.** In round 2 of all five
  runs the sound engine's voice limiter (the bottom of `fill_audio`,
  `eSound.cpp`) printed `[SND] voice limiter STARTED cutting: N live voices`
  45.45–45.56 s after `NEW_ROUND` — second 45 on the round clock, the second
  in which `ms_to_first_draw` jumps (s44 6.6–7.7 → s45 11.0–14.9 ms in all
  ten rounds) — with N = 12–14. How long it then stayed cutting separates the
  two spike round-2s from the three flat ones: `stopped` at 56.92 s (run 1)
  and 56.94 s (run 4), in the second their draw count is falling (s55 → s56:
  481 → 396 and 456 → 375 draws/frame); `stopped` at 47.08, 47.08 and 47.34 s
  in runs 2, 3 and 5. Every run then has one more `STARTED` at 58.77–58.84 s
  (12–13 voices), about a third of a second before the human's death at
  59.10–59.13 s, i.e. inside the last second of the late window, and a
  `stopped` at 60.3–62.9 s. Round 2 of each run, seconds after `NEW_ROUND`:

  | run | round 2 | `STARTED` (voices) | `stopped` (voices) | `STARTED` again (voices) | `stopped` |
  |---|---|---|---|---|---|
  | base-r1 | spike | 45.56 (14) | 56.92 (8) | 58.84 (12) | 62.88 |
  | base-r2 | flat | 45.47 (12) | 47.08 (8) | 58.81 (13) | 62.91 |
  | base-r3 | flat | 45.46 (12) | 47.08 (8) | 58.80 (12) | 61.10 |
  | base-r4 | spike | 45.50 (13) | 56.94 (8) | 58.77 (12) | 60.32 |
  | base-r5 | flat | 45.45 (12) | 47.34 (8) | 58.83 (12) | 60.32 |

  What the marker means, from `fill_audio`: the count it prints,
  `real_sound_sources`, is zeroed at the top of the callback and incremented
  only by `eSoundPlayer::Mix`, once per voice mixed, so it is the complete
  count of voices mixed in the callback that printed the line. The limiter
  starts cutting (`loudness_thresh` leaves 0) in the first callback whose
  count exceeds `SOUND_SOURCES + 1` = 11, and the transition prints in that
  same callback while the budget lasts. So from the round-start burst (next
  bullet) until 45.45–45.56 s no callback mixed more than 11 voices, and in
  that second one mixed 12–14. Voices are sounds being played; which sounds
  is not recorded.
- **Why round 3 is silent, and round 1.** The transition line has a budget of
  16 per process (`se_limiterBudget`, `eSound.cpp`), and every run spent all
  16 in round 2: twelve in its first 1.8 s (`live voices peaked at 16` at
  0.04–0.05 s, then six start/stop oscillations ending 1.75–1.79 s) and the
  four in the table. Round 3 — whose `ms_to_first_draw` jumps at second 45 in
  all five runs just as round 2's does — logged nothing because nothing was
  left to log with: a log cap, not evidence that its voice count stayed put.
  Round 1 logged nothing because its peak was 11 (`live voices peaked at
  11`), which does not exceed 11.
- **Where that work is counted.** `fill_audio` is the SDL audio callback, and
  in this port it runs on the main thread (`web/README.md`, the cockpit-HUD
  bullet — "per-callback mixing work landing on the main thread" — and "Sound
  is produced, but nobody has heard it", which also says the limiter had
  never engaged at the shipped AI count and that raising `SP_NUM_AIS` would
  be the first time that code ran with real voices in it; this harness's
  `SP_NUM_AIS 7` is that configuration). The sampler's split puts everything
  between a swap's return and the next frame's first draw call — the
  event-loop yield included — into `ms_to_first_draw`, so whatever a callback
  costs lands in that part, the part that doubles in 10 of 10 rounds, and
  never in `ms_first_draw_to_swap`. That follows from where the split is cut,
  not from a measurement of the callback; how much of the 5.3–9.2 ms rise at
  the peak is mixing work, if any, is not known from these runs.

This is a correlate with timestamps, not a cause: the same second could hold
an AI behaviour that both makes more noise and costs more simulation. Task 3
has a lever that needs no game-source change: `SOUND_QUALITY 0` in the
autoexec lines (`SOUND_OFF`: `se_SoundInit` opens no device, so `fill_audio`
never runs) against `base`, read on `ms_to_first_draw` at seconds 44–55 and
on spike incidence over as many rounds as it runs; `SOUND_SOURCES` is a
config item too, and raising it keeps the mixing while stopping the cutting,
which separates the two. Raising `se_limiterBudget` so round 3 logs as well
is a `src/engine/eSound.cpp` change, outside what Tasks 1–5 may touch. A
cycle turning many times in a few seconds would add a wall segment per turn
and remove them again as the 400-unit cap moves on, which fits the rise and
the decay of the draw count; that is a reading, not a measurement.

## The baseline Tasks 3–5 compare against

Ten rounds, as distributions. Each list is the ten measured values, sorted;
the median of ten values is the mean of the 5th and 6th and is not itself a
measured round, so it has its own column. (An earlier revision of this table
printed the rounded median in place of the 5th value in four rows; these
lists are regenerated from the five `[PERF]` lines.)

| statistic | ten rounds, sorted | median | the seven without a draw spike | the three with one |
|---|---|---|---|---|
| `ratio_ms` | 1.04, 1.11, 1.15, 1.15, 1.19, 1.19, 1.20, 1.45, 1.53, 1.63 | **1.19** | 1.04–1.20 (median 1.15) | 1.45, 1.53, 1.63 |
| late ms p50 | 24.5, 24.8, 25.1, 25.8, 27.0, 27.4, 28.0, 33.1, 34.1, 36.1 | **27.2** | 24.5–28.0 (median 25.8) | 33.1–36.1 |
| late ms p90 | 30.8, 31.7, 31.7, 34.5, 34.5, 36.2, 36.8, 42.7, 45.6, 46.4 | **35.35** | 30.8–36.8 (median 34.5) | 42.7–46.4 |
| hitches > 50 ms, span | 2, 6, 7, 7, 8, 8, 9, 23, 32, 42 | **8** | 2–9 (median 7) | 23–42 |
| hitches > 50 ms, late window | 0, 1, 1, 1, 1, 2, 2, 4, 9, 11 | **1.5** | 0–2 (median 1) | 4–11 |
| early ms p50 | 20.6, 21.3, 21.6, 22.1, 22.3, 22.8, 23.6, 23.8, 24.1, 24.3 | **22.55** | 20.6–24.3 (median 23.6) | 22.1–22.8 |
| `ratio_draws` | 1.17, 1.20, 1.20, 1.23, 1.25, 1.26, 1.26, 2.61, 3.54, 3.73 | **1.255** | 1.17–1.26 (median 1.23) | 2.61–3.73 |
| spike incidence | 3 of 10 rounds; 2 of 5 runs had at least one | | | |

Same units and caveats as above. For Tasks 3–4: with the spike in 3 of 10
rounds, a two-round A/B can land on 0, 1 or 2 spike rounds by chance, and a
spike round differs from a flat one by more (late p50 +7–10 ms and p90 +8–12
against the flat medians, span hitches 23–42 against 2–9) than any cheap lever is likely to move a flat round; read a
lever's flat rounds against the flat column, its spike rounds against the
spike column, and its spike *incidence* over as many rounds as it ran. A
lever that acts on the renderer should move the render part of the spike
(27.6–34.8 ms at peak) and the draw peak (393–511); one that acts on the
simulation should move the 10-of-10 pre-draw bump (11.9–16.7 ms at peak
against 6.6–7.7 before). On the level, a change under about 4 ms in one run
is inside the run-to-run spread seen here.

**Against the plan's gate** ("if `ratio_ms ≥ 1.2` in fewer than 3 of 10
rounds, the framing changes"): 4 of 10, so the growth reproduces at the
threshold — but not with the shape the milestone's story assumed. It is not
a curve that climbs with wall length (the trails are capped at 400 in this
match and the draw count is flat at 107 for thirty seconds); it is a
ten-second event at second 45 in every round, large in three rounds of ten.
Whether the maintainer's "the more I drive" is this event, a human-turning
effect this idle-human template cannot produce, or an uncapped-walls effect
of the non-tutorial match, Task 3 has to separate.

## Files

Per run, `base-rK/`: `console.log` (the transcript; the last
`[PERF] base-rK {…}` is the result), `steps.txt` (the driver script that
ran), `uptime.txt`, `r2-50s.png` and `r3-50s.png` (the late-window pictures,
50.4–50.6 s into each measured round), and `base-rK-driver.txt` beside it.
`table.txt` is `summarise.py` over the five, generated on this tree. The
other five screenshots each run took (`r1-after-tutorial-keys`, `r2-06s`,
`r2-30s`, `r3-06s`, `r3-30s`) are not committed: five runs at Task 1's policy
would have added 19 MB of PNG for pictures that repeat Task 1's; the gate
needs one second-half screenshot per measured round on disk, the 50 s shots
are those, and `check-arm.mjs` was re-run on the trimmed tree — `VALID` for
all five, as the `gate` column of `table.txt` shows.
