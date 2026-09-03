# `web/tools/perf/` — the M6 lag harness

Measures the slowdown the maintainer feels on his phone — *"starts smooth,
gets laggier the more I drive"* — in a way that can tell a real number from
an empty arena. Everything here is harness; no game source is touched.

**These are one desktop's numbers.** Every millisecond in a `[PERF]` line is
this machine's frame *cost* at a phone's pixel count under a CPU throttle. The
transferable results are the early-vs-late **ratios** within a round and the
**deltas** between arms; the absolute milliseconds are not a phone's and are
never to be quoted as one.

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
it is the result), `<set-dir>/<arm>/*.png` (screenshots) and
`<set-dir>/<arm>-driver.txt`, then prints the `[PERF]` line and
`check-arm.mjs`'s verdict, and exits 0 only for `VALID`.

Round 1 is never measured: it is where the two key presses go and the
throttle is switched on. Rounds 2 and 3 are the measurement. `SP_SIZE_FACTOR 6`
is harness setup, not a lever — at the shipped arena a round is over in eight
seconds, too short to show any growth curve; `run-arm.sh`'s header has the
arithmetic.

## The three invariants — drive, throttle, prove

Each is a rule because a measurement without it produced a number that was
not one.

1. **Drive.** After the first `[L] NEW_ROUND`, the template dispatches
   `Right` then `Left` through CDP `Input.dispatchKeyEvent`, and
   `check-arm.mjs` counts the two presses in the transcript. The plan made
   this a global constraint on the strength of the first sweep, whose six
   arms had no presses and reported 6.4–8.2 ms flat from an arena read as
   empty. **This rig's own negative control did not reproduce that premise.**
   `docs/evidence/m6-lag/task1-rig/negative-no-keys/` is the same arm with
   the two `key:` lines deleted: the match started and ran anyway — rounds 2
   and 3 of 60.9 s against 61.0/60.8 s with the keys, per-second draws/frame
   identical to within one call for the first 45 s of each measured round
   (both runs sit at exactly 107 from second 15 to second 44), and its
   `r2-50s.png` is indistinguishable from the base run's. The one difference
   was round 1: 19.2 s with the presses, 47.5 s without — one sample each.
   The presses do reach the page: `task1-rig/key-delivery/console.log` shows
   a `keydown` listener on the page receiving `ArrowRight` and `ArrowLeft`
   with `isTrusted` true. Whether the game turned on them is not shown by
   anything the transcript records.

   So the invariant, stated honestly: the gate proves the input was *sent*,
   and the measured rounds are **AI-driven with an idle human** — in every
   round of both runs the human cycle drives straight at speed 15.0 under a
   re-armed "Press <right> or <o> to turn right" hint until it dies at the
   far side of the arena at ~61 s, which is what ends rounds 2 and 3. That is
   the condition every `base` number describes. The maintainer's *"the more
   I drive"* is a human turning; measuring that is a different template
   (Task 3), and the key requirement stays in the gate as the plan's
   constraint and as the hook such a template extends.

2. **Throttle.** `cpu:RATE` (CDP `Emulation.setCPUThrottlingRate`) is switched
   on after round 1 and before round 2. Unthrottled, this desktop has roughly
   eight times a phone's headroom, and a cost that grows by half still fits
   inside a 16.7 ms budget and reads flat. Rate 6 is the default; the rate is
   a column in every table, and the observed slowdown at rate 6 has been
   about 2.5–3×, not 6× — report what you see, not the setting.
   `check-arm.mjs` requires the driver's own `CPU throttling rate Nx` line
   before the second `NEW_ROUND`, at the rate the `[PERF]` line claims.

3. **Prove.** `MAX_FPS 1000` is in every arm, so the frame time is the cost
   and not the limiter (`sr_LimitFPS` pins it at 16.7 ms at the shipped 60 and
   would hide every cost below the cliff). Then `check-arm.mjs` refuses the
   number unless the transcript shows: the two key presses; the throttle as
   above; rounds 2 and 3 each ≥ 30 s with ≥ 30 frames in their late windows;
   late-window draw calls per frame above the empty-arena floor by a quarter
   (draw calls are the direct measure of trail geometry pushed through the GL
   emulation — an idle tutorial arena has few); and a screenshot from the
   second half of each measured round on disk, so a reader can *see* the
   trails the draw count claims. A gate that cannot fail is not a gate:
   `docs/evidence/m6-lag/task1-rig/negative-no-keys/` is the same arm with the
   two `key:` lines deleted, and it is `INVALID: only 0 tutorial key presses
   logged` (plus `round 3: no screenshot from its second half on disk`, a
   consequence of keeping only one of its screenshots in the tree). Note
   which check caught it: the key count. Its late windows read
   116.4 draws/frame against the floor's 46.2 — the floor rejects a scene
   with no game in it, not an AI-only round.

## The `[PERF]` schema

`report.js` returns `[PERF] <arm> ` followed by one JSON object; the driver
logs it as the quoted result of the final `eval:` step. Tasks 2–4 read:

```
arm, cpu_rate, frames, rounds_started, rounds_won, shots_bracketed, shot_pad_ms
rounds[]:
  round, length_s
  early_5s / late_5s:   frames, frames_excluded, ms_p50, ms_p90, fps,
                        draws_per_frame, kb_per_frame, hitches_over_50ms, raw_ms_max
  ratio_ms              late_5s.ms_p50 / early_5s.ms_p50
  ratio_draws           late_5s.draws_per_frame / early_5s.draws_per_frame
  hitches_over_50ms     over the whole round, screenshot frames excluded
  frames, frames_excluded, raw_ms_max   over the whole round
  shots[]               {name, at_s, dur_ms} — screenshots taken in this round
  per_second:           ms_p50[], draws_per_frame[], raw_ms_max[]  one entry per second
```

A "frame" is one `flush`/`finish` on the WebGL context — `rSysDep::SwapGL`
issues exactly one `glFlush` per swap in the shipped swap mode. `draws` counts
`drawArrays`+`drawElements` between two flushes; `bytes` sums `bufferData`/
`bufferSubData` payloads. `early_5s` is the first five seconds after
`[L] NEW_ROUND`, `late_5s` the last five before `[L] ROUND_WINNER`.

## Reading `ratio_ms` against `ratio_draws`

The two mechanisms in the source leave different fingerprints:

- **Both ratios rise together** → the renderer: a growing trail set is being
  re-submitted through the JS GL emulation every frame (mechanism 1; display
  lists are stubs in the port, so `gWall.cpp` re-sends every segment).
- **`ratio_ms` rises, `ratio_draws` flat** → the simulation: the rubber path's
  recursive `TimestepCore`, fed by `gSensor` scans of nearby walls
  (mechanism 2). It scales with walls *near* the cycle, not with the total.
- **`ratio_draws` rises, `ratio_ms` flat** → the machine still had headroom;
  the throttle is not deep enough to be in a phone's regime. Do not read it
  as "no problem".

`kb_per_frame` separates "more draw calls" from "bigger draw calls"; a
lever that shortens trails should move both.

## Screenshots and the late window

A `shot:` step spends real time in CDP's `Page.captureScreenshot`, and the
late-window shot at 50 s can land *inside* the `late_5s` window of a round
that ends at 52 s. The rig therefore brackets every screenshot on the page's
own clock — `eval:__fps.shot(NAME,'begin')` / `'end'` around each `shot:` —
and `report.js` drops every frame between the two marks, plus a pad
(`shot_pad_ms`, 100 ms before and 250 ms after), from *every* statistic:
`ms_p50`, `ms_p90`, `fps`, `draws_per_frame`, `hitches_over_50ms`. Frame
deltas are only ever taken between adjacent samples, so the gap across an
exclusion is never counted as a frame time. `raw_ms_max` ignores the
exclusions on purpose: it is where a screenshot hitch stays *visible*, so the
per-second `raw_ms_max` series shows what was excluded and the per-second
`ms_p50` series shows it did not leak. Each round's `shots[]` lists what was
excluded and how long the capture took.

The 30 s shot in each measured round exists so `check-arm.mjs` can always find
a second-half picture even when a round ends before its 50 s shot.

Measured, it did not bite — and neither did the exclusion. In the `base` run
every `late_5s` window reports `frames_excluded: 0`: the 50 s shots fell at
50.5 s of 61 s rounds, outside the last five seconds. And where a shot did
land, the page's frame loop did not notice: in the second of the `r2-30s`
capture (30.32 s into round 2, a 175 ms bracket) per-second `raw_ms_max` is
30.2 ms against 31.2 and 27.3 in the neighbouring seconds, and `ms_p50` for
that second is 24.9 beside 26.3 and 25.0. `Page.captureScreenshot` with
`fromSurface: true` reads the compositor's surface and did not stall the
renderer's main thread. The exclusion stays as insurance — it costs about
19–20 frames per shot (`frames_excluded` 56 and 60 over three shots in rounds
2 and 3) — and a round that ends at 52 s would still have its 50 s shot
excluded from the late window rather than measured.

## Calibration and proof — `docs/evidence/m6-lag/task1-rig/`

**The floor.** `EMPTY_ARENA_DRAWS_PER_FRAME = 36.99` in `check-arm.mjs` is
the `base` run's round-1 first-second draws/frame
(`rounds[0].per_second.draws_per_frame[0]`): cycles spawned, no key pressed
yet. The next three seconds of that round read 61, 80, 80 — the AIs launch
at `NEW_ROUND` and their first walls are drawn before any input — so 36.99
is the lowest figure a live arena shows, and the ×1.25 margin (46.2) rejects
a scene with no game in it (a held boot, a menu, a frozen canvas), not an
AI-only round. The negative control's late windows read 116.4 and 116.4 and
passed the floor; its key count failed it. Re-measure the floor if the HUD,
the hint text or the spawn layout changes; the value carries its provenance
in the comment beside it.

**The base run** (cpu 6, `SP_SIZE_FACTOR 6`, `SP_NUM_AIS 7`, `MAX_FPS 1000`,
this worktree's `web/dist-m1` on port 8006, 2026-09-03):

| round | len s | early ms p50 | late ms p50 | ratio_ms | early draws | late draws | ratio_draws | late KB/frame | hitches >50 ms |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 61.0 | 23.7 | 32.3 | 1.36 | 70.7 | 174.9 | 2.47 | 201.8 | 19 |
| 3 | 60.8 | 22.8 | 28.6 | 1.25 | 66.5 | 135.7 | 2.04 | 186.1 | 9 |

Desktop costs at a phone's pixel count under a 6× CPU throttle; the ratios
are what travels. Load 9.21 before, 9.03 after (`base/uptime.txt`). The
evidence README in that directory has the per-second series, the negative
control's table and the key-delivery check.

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
build beside an arm.

The load average is **recorded, not gated**. `uptime` immediately before and
after the drive lands in `<arm>/uptime.txt`, and every evidence README quotes
it. This 10-core desktop idles near load 9–13 from the maintainer's own apps
(a browser, the window server); that is a steady background the early-vs-late
ratio design absorbs, and a gate at a "quiet" load would never open. The one
hard precondition is ours: no build or driver of ours beside the run
(`pgrep -fl 'drive-browser.mjs|em++ '` shows nothing but the arm's own). Set
`AA_PERF_MAXLOAD` to a number to refuse a run above that 1-minute load,
knowingly; unset, nothing is refused for load. Task 2's five runs are what
quantify the noise.

## Files

- `sampler.js` — armed before boot; one expression, block comments only (it
  is flattened to a single `eval:` line).
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
