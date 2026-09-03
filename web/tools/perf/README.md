# `web/tools/perf/` — the M6 lag harness

Measures the slowdown the maintainer feels on his phone — *"starts smooth,
gets laggier the more I drive"* — in a way that can tell a real number from
an empty arena. Everything here is harness; no game source is touched.

**These are one desktop's numbers.** Every millisecond in a `[PERF]` line is
a *frame interval* on this machine at a phone's pixel count under a CPU
throttle — and a frame interval is not pure game work: it contains a fixed
event-loop yield the throttle does not scale and a swap call that turned out
to cost nothing here (see "What a frame time contains"). The transferable
results are the early-vs-late **ratios** within a round and the **deltas**
between arms; the absolute milliseconds are not a phone's and are never to be
quoted as one.

## What an arm is

One arm is one run of `run-arm.sh`: one set of autoexec lines appended to the
shipped config, one CPU throttle rate, one three-round match of the shipped
`web/dist-m1` client in **headed** Chrome (the key: steps need it — see
`drive-browser.mjs`'s header) at a phone's geometry, `--mobile 915,412,3`.

```
python3 -m http.server 8006 --directory web/dist-m1 &
sh web/tools/perf/run-arm.sh <set-dir> <arm> <cpu-rate> '<autoexec lines, \\n-separated>' [template]
sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task1-rig base 6 'SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7'
python3 web/tools/perf/summarise.py docs/evidence/m6-lag/task1-rig
```

It writes `<set-dir>/<arm>/steps.txt` (the driver script that actually ran),
`<set-dir>/<arm>/console.log` (the transcript; the last `[PERF] <arm> {…}` in
it is the result), `<set-dir>/<arm>/*.png` (screenshots),
`<set-dir>/<arm>/uptime.txt` and `<set-dir>/<arm>-driver.txt`, then prints
the `[PERF]` line and `check-arm.mjs`'s verdict, and exits 0 only for `VALID`.

Round 1 is never measured: it is where the two key presses go and the
throttle is switched on. Rounds 2 and 3 are the measurement. `SP_SIZE_FACTOR 6`
is harness setup, not a lever — at the shipped arena a round is over in eight
seconds, too short to show any growth curve; `run-arm.sh`'s header has the
arithmetic.

**The match every arm plays is the tutorial match.** Every run boots a
fresh browser profile, so the game is on its first-use path, and
`welcome()` (`gArmagetron.cpp`, "start a first single player game") runs a
match with six settings changed for its duration — `speedFactor` −2,
`sizeFactor` lowered by 2 (so `SP_SIZE_FACTOR 6` is a size factor of 4 in
the arena that is measured), **`wallsLength` 400**, `sg_rubberCycle` 5,
`sg_delayCycle` 0.05, `autoNum` 0 — and restores them afterwards. The repo
has known this since M2 (`docs/evidence/m2-gate/README.md`, "The match these
numbers come from is the tutorial match"; PLAN.md's M2 row); the M6 plan did
not carry it. Two consequences for this harness: the trails in a measured
round are capped at 400 units, not unlimited, which is what the flat draw
count in the middle of every round looks like; and `SP_WALLS_LENGTH` in
`CONFIGLINES` cannot take effect, because `welcome()` overwrites it after
`autoexec.cfg` is read. What a returning visitor plays (unlimited walls, the
shipped speed and size) is a different boot path (`FIRST_USE 0`, with the
three render defaults `sr_LoadDefaultConfig` would have set — `SWAP_MODE 2`,
`FLOOR_DETAIL 3`, `TEXT_OUT 1` — written explicitly) and its own menu walk;
no arm here measures it.

## The three invariants — drive, throttle, prove

Each is a rule because a measurement without it produced a number that was
not one.

1. **Drive.** After the first `[L] NEW_ROUND`, the template waits 3 s — past
   the round's 4 s countdown (`PREPARE_TIME` in `gGame.cpp`; the `until:`
   step is satisfied about 2.3 s after the mark) — then dispatches `Right`
   and `Left` through CDP `Input.dispatchKeyEvent`, and `check-arm.mjs`
   counts the two presses in the transcript. The plan made this a global
   constraint on the strength of the first sweep, whose six arms had no
   presses and reported 6.4–8.2 ms flat from an arena read as empty. **This
   rig's own negative control did not reproduce that premise.**
   `docs/evidence/m6-lag/task1-rig/negative-no-keys/` is the same arm with
   the two `key:` lines deleted: the match started and ran anyway, with the
   same round lengths, the same flat 107 draws/frame through the middle of
   each measured round and an indistinguishable late screenshot. The
   presses do reach the page as trusted `keydown` events
   (`task1-rig/key-delivery/console.log`). Whether the game turned on them
   is not shown by anything recorded: the "Press <right> …" hint is
   re-displayed every second by `ePlayer::Render` while the game time is
   past 1 s and no other centre text is up, and one press consumes one of
   its two activations, so the hint stays up either way; and the 1.5 s
   screenshot after the presses looks behind the camera, where a jog would
   be. The one game-side hint is round 1's length: 46.1 s with the presses
   after the countdown, 45.8 s with none, 17.9 s when the earlier template
   pressed *during* the countdown — one sample each.

   So the invariant, stated honestly: the gate proves the input was *sent*,
   and the measured rounds are **AI-driven with an idle human** — in every
   round of every run the human cycle drives straight at speed 15.0 until it
   dies 59.1 s after `NEW_ROUND`, to the tenth of a second, keys or not
   (four rounds in two runs on the old template, four more on this one). That
   is the condition every `base` number describes. The maintainer's *"the
   more I drive"* is a human turning; measuring that is a different template
   (Task 3), which must also prove the turn happened, and the key requirement
   stays in the gate as the plan's constraint and as the hook such a template
   extends.

2. **Throttle.** `cpu:RATE` (CDP `Emulation.setCPUThrottlingRate`) is switched
   on after round 1 and before round 2. Unthrottled, this desktop has roughly
   eight times a phone's headroom, and a cost that grows by half still fits
   inside a 16.7 ms budget and reads flat. Rate 6 is the default; the rate is
   a column in every table. **Rate 6 reads as about 3× on the frame
   interval, not 6×, and the split says why**: the part of a frame before its
   first draw call — which contains the `emscripten_sleep(0)` yield — is
   5.1 ms unthrottled and 7.5 ms at rate 6, while the part from first draw to
   swap goes from 1.8 to about 17 ms. The throttle scales work; it does not
   scale a timer. Report what you see, not the setting. `check-arm.mjs`
   requires the driver's own `CPU throttling rate Nx` line before the second
   `NEW_ROUND`, at the rate the `[PERF]` line claims.

3. **Prove.** `MAX_FPS 1000` is in every arm, so the frame time is the cost
   and not the limiter (`sr_LimitFPS` pins it at 16.7 ms at the shipped 60 and
   would hide every cost below the cliff). Then `check-arm.mjs` refuses the
   number unless the transcript shows: the two key presses; the throttle as
   above; rounds 2 and 3 each with a measured span ≥ 30 s and ≥ 30 frames in
   their late windows; late-window draw calls per frame above the
   no-geometry floor by a quarter (the floor is the larger of the round's
   own overlay-only pre-round frames and a calibrated constant — draw calls
   are the direct measure of geometry pushed through the GL emulation, and a
   scene with no arena has few); and a screenshot from the second half of
   each measured round on disk, so a reader can *see* the trails the draw
   count claims. A gate that cannot fail is not a gate:
   `docs/evidence/m6-lag/task1-rig/negative-no-keys/` is `INVALID: only 0
   tutorial key presses logged`. Note which check caught it: the key count.
   Its late windows draw over a hundred calls per frame against a floor of
   22.6 — the floor rejects a scene with no game in it, not an AI-only round.

## What a frame time contains

A "frame" is one swap call on the WebGL context. `rSysDep::SwapGL` makes
exactly one per swap, and which one depends on `swapMode_`: the static
default is `glFlush`, but `sr_LoadDefaultConfig` (`rScreen.cpp`) sets
`glFinish`, `welcome()` runs it on every first-use boot, and every harness
run is a first-use boot. So the client the harness measures swaps with
**`glFinish`** — the sampler counts both kinds and the `[PERF]` line reports
`swaps`; the base run is `{flush: 0, finish: 11504}`. `SWAP_MODE 1` in
`CONFIGLINES` does not change that (`task1-rig/swap-mode-probe`: all 4303
frames still `finish`), because the config is read before the default is
applied.

The sampler timestamps three points per frame, so a frame interval splits:

| part | from → to | what is in it | base run, rate 6, steady state | unthrottled (round 1) |
|---|---|---|---|---|
| `ms_in_swap` | the swap call itself | `GLctx.finish()` — if the GPU were waited for, it would show here | p50 **0**, p90 0–0.1, max 1.2–1.5 | 0 / 0 / 0.1 |
| `ms_to_first_draw` | swap returns → first `drawArrays`/`drawElements` | the `emscripten_sleep(0)` yield (a nested `setTimeout`, clamped to ~4 ms by the browser), input, the simulation, the AIs' thinking, render setup | ~7.5 | 5.1 |
| `ms_first_draw_to_swap` | first draw → swap | render submission through the GL emulation | ~17 | 1.8 |

The two non-zero parts add up to `ms_p50` (7.5 + 17.5 against 25 in the
middle of a measured round), so nothing is hiding in the swap call: on this
machine and Chrome 152 `finish()` returns at once, and "frame cost" is
CPU time plus the yield, not GPU time. The yield is why a frame at rate 6 is
not six times a frame at rate 1, and why `ms_to_first_draw` never reads below
about 5 ms: that is the floor of the event-loop turn, not simulation. It is
also the term Task 4's frame-cap lever sits on.

## The `[PERF]` schema

`report.js` returns `[PERF] <arm> ` followed by one JSON object; the driver
logs it as the quoted result of the final `eval:` step. Tasks 2–4 read:

```
arm, cpu_rate, frames, human, swaps {flush, finish}, rounds_started, rounds_won,
shots_bracketed, shot_pad_ms
rounds[]:
  round, length_s                 NEW_ROUND → ROUND_WINNER
  measured_from_s, measured_to_s  the measured span, seconds after NEW_ROUND
  human_death_s, ends_at          'human_death' or 'round_winner'
  pre_round:                      frames, ms_p50, draws_per_frame, span_ms, split_at_draws
  early_5s / late_5s:             frames, frames_excluded, ms_p50, ms_p90, fps,
                                  draws_per_frame, kb_per_frame, hitches_over_50ms, raw_ms_max,
                                  ms_in_swap_p50, ms_in_swap_p90, ms_in_swap_max,
                                  ms_to_first_draw_p50, ms_first_draw_to_swap_p50
  ratio_ms                        late_5s.ms_p50 / early_5s.ms_p50
  ratio_draws                     late_5s.draws_per_frame / early_5s.draws_per_frame
  hitches_over_50ms, frames, frames_excluded, raw_ms_max   over the measured span
  shots[]                         {name, at_s, dur_ms} — screenshots taken in this round
  per_second:                     ms_p50[], draws_per_frame[], raw_ms_max[],
                                  ms_to_first_draw_p50[], ms_first_draw_to_swap_p50[]
                                  one entry per second of the whole round, from NEW_ROUND
```

`draws` counts `drawArrays`+`drawElements` between two swaps; `bytes` sums
`bufferData`/`bufferSubData` payloads. `human` is the first
`[L] PLAYER_ENTERED` name (the AIs never enter that way).

**The measured span.** It does not begin at `NEW_ROUND` and it does not end
at `ROUND_WINNER`, and both edges were measured before they were moved:

- *Pre-round frames.* For the first half second of game time after a round
  starts, `gGame.cpp`'s `GameLoop` clears and swaps **without calling
  `Render`** (the `gtime <= -PREPARE_TIME + .5` branch): overlay only, no
  arena. In the base run that is 69–91 frames at 5–7 ms and 11–18 draws each,
  sitting right after `NEW_ROUND`; left in, they made up a third of the
  early window and pulled its draws/frame down (the earlier rig's
  `ratio_draws` of 2.47 and 2.04 fell to about 1.8 and 1.5 once the review
  recomputed them without that second). `report.js` finds them
  by their draw count — the threshold is halfway between the fewest draws of
  any frame in the round's first two seconds and the median of its second
  second — reports them under `pre_round`, and starts the span at the first
  frame after the last of them (`measured_from_s`, 0.53 s in every round so
  far). The frame that straddles `NEW_ROUND` itself, drawn mostly before it,
  is left out of both.
- *The human's death.* `[L] DEATH_FRAG web_user …` precedes `ROUND_WINNER` by
  1.7–1.8 s, and the frames between are the explosion, the death camera and
  the AIs' endgame — in the earlier rig they carried a draw spike to 313 and
  most of one round's `ratio_draws`. The span now ends at the first
  `DEATH_*` mark naming the human (`measured_to_s`, `human_death_s`), or at
  `ROUND_WINNER` when the human outlives the round (`ends_at`).

`early_5s` is the first five seconds of the span, `late_5s` its last five;
`hitches_over_50ms`, `frames`, `frames_excluded` and `raw_ms_max` at the
round level are over the span. `length_s` and `per_second` stay on the round
clock so the pre-round second and the post-death seconds remain visible.

## Reading `ratio_ms` against `ratio_draws` — and the frame split

The two mechanisms in the source leave different fingerprints, and the
harness now records two independent readings of each frame:

- **Both ratios rise together** → the renderer: a growing trail set is being
  re-submitted through the JS GL emulation every frame (mechanism 1; display
  lists are stubs in the port, so `gWall.cpp` re-sends every segment). In the
  split, `ms_first_draw_to_swap` (render submission) is the part that grows.
- **`ratio_ms` rises, `ratio_draws` flat** → not the renderer: the rubber
  path's recursive `TimestepCore`, fed by `gSensor` scans of nearby walls
  (mechanism 2), or anything else before the first draw call — the AIs'
  thinking runs on this client too. In the split, `ms_to_first_draw` is the
  part that grows while `ms_first_draw_to_swap` and the draw count stay put.
- **`ratio_draws` rises, `ratio_ms` flat** → the machine still had headroom;
  the throttle is not deep enough to be in a phone's regime. Do not read it
  as "no problem".

`kb_per_frame` separates "more draw calls" from "bigger draw calls"; a lever
that shortens trails should move both. The split is the more direct
discriminator than the draw count alone, because the draw count cannot see
the AI think time, the grid maintenance or the camera; read the two
together, per second, from `per_second`. For the record, the base run's two
measured rounds both rose in the last quarter with draws flat at 107–111:
`ms_to_first_draw` went from 7.5 to 11–15 ms for about eleven seconds while
`ms_first_draw_to_swap` stayed at 17–18. One run; Task 2 says how often.

## Screenshots and the late window

A `shot:` step spends real time in CDP's `Page.captureScreenshot`, and the
late-window shot at 50 s could land *inside* the `late_5s` window of a round
whose span ends at 52 s. The rig therefore brackets every screenshot on the
page's own clock — `eval:__fps.shot(NAME,'begin')` / `'end'` around each
`shot:` — and `report.js` drops every frame between the two marks, plus a pad
(`shot_pad_ms`, 100 ms before and 250 ms after), from *every* statistic:
`ms_p50`, `ms_p90`, `fps`, `draws_per_frame`, `hitches_over_50ms`, the split.
Frame deltas are only ever taken between adjacent samples, so the gap across
an exclusion is never counted as a frame time. `raw_ms_max` ignores the
exclusions on purpose: it is where a screenshot hitch stays *visible*, so the
per-second `raw_ms_max` series shows what was excluded and the per-second
`ms_p50` series shows it did not leak. Each round's `shots[]` lists what was
excluded and how long the capture took.

The 30 s shot in each measured round exists so `check-arm.mjs` can always find
a second-half picture even when a round ends before its 50 s shot.

Measured, it did not bite — and neither did the exclusion. In the `base` run
every `late_5s` window reports `frames_excluded: 0`: the 50 s shots fell at
50.4–50.5 s, and the spans end at 59.1 s. Where a shot did land, the page's
frame loop did not notice: in the second of the `r2-30s` capture (30.29 s
into round 2, a 187 ms bracket) per-second `raw_ms_max` is 29.1 ms against
28.3 and 28.8 in the neighbouring seconds, and `ms_p50` is 24.3 beside 24.4
and 24.2. The exclusion stays as insurance
— it costs about 20 frames per shot (`frames_excluded` 61 over three shots in
each measured round) — and a round whose span ends at 52 s would still have
its 50 s shot excluded from the late window rather than measured.

## Calibration and proof — `docs/evidence/m6-lag/task1-rig/`

**The floor.** `check-arm.mjs` requires each late window to draw more than
1.25 × the larger of two no-geometry figures: the round's own `pre_round.
draws_per_frame`, and `EMPTY_ARENA_DRAWS_PER_FRAME = 18.05` — the `base`
run's round-1 pre-round figure over 91 overlay-only frames (rounds 2 and 3
of the same run read 16.18 and 11.06; the HUD text differs per round).
Measured no-game scenes (`task1-rig/no-game-scenes`): a held boot has no GL
context and no frames; the Language Settings menu draws exactly 6 calls per
frame; the First Setup menu 13–14. All are under 22.6, so every no-game
scene this rig has seen is rejected; a live late window draws about 114.
The earlier rig used round 1's first-second *mean* (36.99), which mixed
overlay frames with world frames and was a bound on nothing — the first
second of throttled rounds 2 and 3 read 25–29. Re-measure the constant if
the HUD, the centre text or the spawn layout changes.

**The base run** (this worktree's `web/dist-m1` on port 8006, 2026-09-03
20:39, `SP_SIZE_FACTOR 6`, `SP_NUM_AIS 7`; load 13.60 before, 11.77 after):

| round | cpu | span s | early ms p50 | late ms p50 | ratio_ms | early draws | late draws | ratio_draws | late KB/frame | hitches >50 ms |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 6 | 0.53–59.1 | 21.2 | 26.6 | 1.25 | 96.0 | 113.8 | 1.19 | 179.3 | 7 |
| 3 | 6 | 0.53–59.1 | 22.6 | 27.0 | 1.19 | 90.2 | 114.0 | 1.26 | 182.2 | 4 |

Frame costs at `MAX_FPS 1000`; `cpu` = the CDP throttle rate; desktop costs
at a phone's pixel count, and the ratios are what travels. The evidence
README in that directory has the per-second series, the frame split, the
negative control, the no-game scenes, the swap-mode probe and the
key-delivery check.

## Serving and ports

`run-arm.sh` reads `AA_PERF_PORT` (default **8006**) and serves nothing
itself. The M6 plan wrote port 8000, but on the machine this was built on
8000 belongs to another worktree's server with a different build behind it;
measuring that would have measured the wrong binary. Start
`python3 -m http.server 8006 --directory web/dist-m1` from the worktree whose
`web/dist-m1` you mean, and `run-arm.sh` checks the port answers before it
drives.

## Measurement hygiene

`run-arm.sh` refuses to start while another `drive-browser.mjs` is running:
two headed Chromes collide on devtools port 9222, and any browser automation
on the box steals the CPU the throttle is metering. A measurement taken
beside another automation run measures the neighbour, not the game — the
first attempt at this rig ran while two other builds saturated the CPU at
load 27, and was discarded. Never run two arms at once, and never run a
build beside an arm. If a run has to be stopped, kill its Chrome too: the
driver's cleanup does not run when the driver itself is killed, and an
orphaned Chrome (find it by its `aa-chrome-*` profile directory) keeps port
9222 and a GPU process.

The load average is **recorded, not gated**. `uptime` immediately before and
after the drive lands in `<arm>/uptime.txt`, and every evidence README quotes
it. This 10-core desktop idles near load 9–13 from the maintainer's own apps
(a browser, the window server); that is a steady background the early-vs-late
ratio design absorbs, and a gate at a "quiet" load would never open. The one
hard precondition is ours: no build or driver of ours beside the run
(`pgrep -fl 'drive-browser[.]mjs|em[+][+] '` shows nothing but the arm's own;
the brackets are needed because `em++` is not a valid pattern for macOS
`pgrep`). Set `AA_PERF_MAXLOAD` to a number to refuse a run above that
1-minute load, knowingly; unset, nothing is refused for load. Task 2's five
runs are what quantify the noise.

## Files

- `sampler.js` — armed before boot; one expression, block comments only (it
  is flattened to a single `eval:` line). Counts frames by swap kind, times
  the swap call, timestamps the first draw call, counts draw calls and
  buffer bytes, records `[L]` marks and screenshot brackets.
- `report.js` — the `[PERF]` line; same constraints. `TAGHERE`/`CPURATE` are
  substituted by `run-arm.sh`.
- `arm.steps.tmpl` — the driver script with `SAMPLER`, `REPORT`,
  `CONFIGLINES`, `TAGHERE`, `CPURATE` placeholders. A fifth argument to
  `run-arm.sh` names another template.
- `run-arm.sh` — substitution (literal, never `gsub`: the sampler contains
  `&&`), tripwires on the generated script, hygiene checks, the drive, the
  verdict.
- `check-arm.mjs` — the gate. Exit 0 is `VALID`.
- `summarise.py` — the table; its `gate` column is `check-arm.mjs`'s verdict,
  and `INVALID` rows are printed so the reader sees *why*, not so they are used.
