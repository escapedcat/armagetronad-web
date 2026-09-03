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

Round 1 is never measured: it is where the tutorial is cleared and the
throttle is switched on. Rounds 2 and 3 are the measurement. `SP_SIZE_FACTOR 6`
is harness setup, not a lever — at the shipped arena a round is over in eight
seconds, too short to show any growth curve; `run-arm.sh`'s header has the
arithmetic.

## The three invariants — drive, throttle, prove

Each is a rule because a measurement without it produced a number that was
not one.

1. **Drive.** After the first `[L] NEW_ROUND`, the template presses `Right`
   then `Left` (real key events through CDP). Without them the tutorial
   overlay stays up and the arena stays *empty* for the whole match — the
   first perf sweep lacked them and reported 6.4–8.2 ms flat in all six arms,
   from six screenshots of nothing. `check-arm.mjs` counts the two presses in
   the transcript.

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
   two `key:` lines deleted, and it is `INVALID`.

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

CALIBRATION-AND-PROOF-SECTION

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
