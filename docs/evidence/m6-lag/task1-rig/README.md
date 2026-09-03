# Task 1 rig — the harness proves itself

One validated `base` arm, one negative control, one measurement of what a
no-game scene draws, one probe of the swap mode, one key-delivery check.
2026-09-03, this worktree's `web/dist-m1` (built here at 17:17 from an
unchanged `src/`; `make -f web/Makefile client` then reported nothing to do),
served by `python3 -m http.server 8006 --directory web/dist-m1`. Chrome
152.0.7977.75, headed, `--mobile 915,412,3`. The `base` and `negative-no-keys`
runs here replaced the ones from the rig's first version after review moved
both edges of the measured window and added the frame split; the schema they
carry is the one Tasks 2–4 read (`web/tools/perf/README.md`, "The `[PERF]`
schema").

**These are one desktop's numbers**: frame intervals at `MAX_FPS 1000` under
a 6× CPU throttle at a phone's pixel count, and a frame interval contains a
fixed event-loop yield the throttle does not scale. The early-vs-late ratios
and the deltas between arms are the transferable results; the milliseconds
are not a phone's.

**The match is `welcome()`'s tutorial match** (first-use boot every run):
walls capped at 400, speed factor −2, size factor 4 (`SP_SIZE_FACTOR 6` − 2),
rubber 5. `web/tools/perf/README.md`, "What an arm is", has the consequences.

## Commands

    sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task1-rig base 6 'SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7'
    sed '/^key:/d' web/tools/perf/arm.steps.tmpl > <scratch>/no-keys.tmpl
    sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task1-rig negative-no-keys 6 'SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7' <scratch>/no-keys.tmpl
    sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task1-rig no-game-scenes 6 'SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7' <scratch>/menu-scene.tmpl
    sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task1-rig swap-mode-probe 6 'SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7\\nSWAP_MODE 1' <scratch>/swap-probe.tmpl
    node web/tools/drive-browser.mjs --headed --mobile 915,412,3 --out docs/evidence/m6-lag/task1-rig/key-delivery \
         --url 'http://localhost:8006/armagetronad.html?autostart=0&touch=1' --script-file <scratch>/key-delivery.steps
    python3 web/tools/perf/summarise.py docs/evidence/m6-lag/task1-rig | tee docs/evidence/m6-lag/task1-rig/table.txt

The two scratch templates are the arm template with the round-2/3 block
replaced by scene evals (`no-game-scenes/steps.txt` and
`swap-mode-probe/steps.txt` are what ran, substituted).

Hygiene: before each run `pgrep -fl 'drive-browser[.]mjs|em[+][+] '` showed
no process of ours; no build ran; the runs went one after the other, the
negative control chained to start only after the base driver had exited and
a second `pgrep` came back empty. One negative run was stopped a minute in
(to add a field to the schema before, not after, the committed runs); its
Chrome survived the driver's kill and was killed by profile directory before
anything else started. Load (`uptime`, 1-minute) from each run's
`uptime.txt`: no-game-scenes 12.50 before / 16.65 after; swap-mode-probe
15.55 / 13.70; base 13.60 / 11.77; negative 10.83 / 17.94. This machine
idles at 9–13 from the maintainer's own apps; load is recorded, not gated on.

## base — VALID

`check-arm.mjs`: `VALID: 2 rounds at cpu 6x; late ms p50 26.6/27; late
draws/frame 113.81/113.98 (floor 18.05); spans 0.53-59.1 s/0.53-59.1 s; late
shots r2-30s,r2-50s / r3-50s; swaps finish 11504 / flush 0`

Run 20:39–20:42. Keys at 5.39 s and 5.73 s after `NEW_ROUND` (after the 4 s
countdown); throttle on at 7.7 s. 0 `EXCEPTION`/`FAILED` lines.

| round | cpu | span s (ends at) | early ms p50/p90 | late ms p50/p90 | ratio_ms | early draws | late draws | ratio_draws | early→late KB/frame | hitches >50 ms | late frames |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 (setup; throttle on at 7.7 s) | 1→6 | 0.54–46.1 (death) | 7.0/7.7 | 17.3/19.9 | (throttle) | 77.4 | 83.5 | — | 120.9→121.3 | 0 | 280 |
| 2 | 6 | 0.53–59.1 (death) | 21.2/24.1 | 26.6/35.0 | 1.25 | 96.0 | 113.8 | 1.19 | 180.8→179.3 | 7 | 177 |
| 3 | 6 | 0.53–59.1 (death) | 22.6/25.9 | 27.0/37.1 | 1.19 | 90.2 | 114.0 | 1.26 | 184.0→182.2 | 4 | 174 |

Frame costs at `MAX_FPS 1000`; `cpu` = the CDP throttle rate. `span` is the
measured span: from the first world frame after `NEW_ROUND` to the human's
death (`[L] DEATH_FRAG web_user …`). Round 1's early→late ratio is the
throttle switching on, not a result. Cross-round drift: round-3-early 22.6
vs round-2-early 21.2.

The frame split (p50, ms; in swap / to first draw / first draw to swap):

| round | early | late | in-swap p90 / max, late |
|---|---|---|---|
| 1 unthrottled early → throttled late | 0 / 5.1 / 1.8 | 0 / 6.5 / 10.8 | 0.1 / 1.3 |
| 2 | 0 / 5.8 / 15.4 | 0 / 8.8 / 17.5 | 0.1 / 1.2 |
| 3 | 0 / 6.1 / 16.6 | 0 / 8.9 / 17.5 | 0.1 / 1.2 |

Pre-round overlay-only frames skipped (the `gtime <= -PREPARE_TIME + .5`
frames, HUD only): round 1, 91 frames at 5.1 ms and 18.05 draws/frame;
round 2, 77 at 6.3 ms and 16.18; round 3, 69 at 6.8 ms and 11.06 (the HUD
text differs per round). Every one of the 11504 sampled frames ended in
`glFinish`.

Per-second draws/frame, round 2 (61 entries, round clock): 30.2, 76.0, 94.6,
95, 118.7, 122.7, 118, 118, 114.4, 114, 111.3, 111, 108.4, 108, 107.1, then
**exactly 107 from second 15 to second 44**, then 109.1, 107, 107, 107.1,
109.1, 110.8, 111 ×6, 113.2, 115, 117.3, 117.8, 119. Round 3 sat at 107 from
second 15 to 44 too, 107–118 to second 58, then 219.5 and 364.3 in the last
two seconds — after the human's death at 59.1 s, outside the span. What
moved inside the span is the *first* part of the frame: per-second
`ms_to_first_draw` p50 in round 2 is 6.9–7.9 from second 4 to 44 and 13.4,
13.5, 13.4, 14.8, 12.4, 11.3, 11.2, 11.2, 11.1, 11.7, 11.6 for seconds 45–55
while `ms_first_draw_to_swap` stays at 16–19 and draws at 107–111; round 3
the same (12.2, 13.1, 13.0, 11.2, 10.8 … for seconds 45–55 against 7.1–7.8
before). The full series are in `table.txt` and in the `[PERF]` line at the
end of `base/console.log`.

Screenshots: `r2-30s.png`, `r2-50s.png`, `r3-30s.png`, `r3-50s.png` show a
live round — trails at the horizon, "Enemies: 7", FPS 33–40 on the HUD —
with the human cycle at speed 15.0 under the hint text, score −2 in round 2
and −4 in round 3. `r1-after-tutorial-keys.png`, 1.5 s after the two presses,
shows the "Press <right> or <o> to turn right." hint up, a straight trail,
four of seven AIs joined, FPS 141 unthrottled; a right-left jog 1.5 s earlier
would be behind the camera, so the picture says nothing either way.

## The floor: 18.05

`check-arm.mjs` requires each late window to draw more than 1.25× the larger
of the round's own `pre_round.draws_per_frame` and a calibrated constant,
`EMPTY_ARENA_DRAWS_PER_FRAME = 18.05` — round 1's pre-round figure here
(`rounds[0].pre_round.draws_per_frame`, 91 overlay-only frames). ×1.25 =
22.6. The rig's first version used round 1's first-second *mean* (36.99),
which mixed those frames with world frames: not a bound on anything, since
throttled rounds 2 and 3 read 25–29 in their first second. What the floor
must reject was measured rather than inferred, below.

## no-game-scenes — what a scene with no arena draws

`no-game-scenes/` (20:30; load 12.50 before, 16.65 after; `console.log`,
`steps.txt`, `uptime.txt`, two screenshots). Same autoexec patch as an arm
(`MAX_FPS 1000`, `SP_SIZE_FACTOR 6`, `SP_NUM_AIS 7`), sampler armed, no
throttle, no keys; each `[SCENE]` eval reads the sampler's frames from the
last 3 s (2 s for scene b) on the page clock, ending 0.4 s before the eval.

| scene | what is on screen (screenshot) | cpu | frames | draws/frame | ms p50 |
|---|---|---|---|---|---|
| held boot (`?autostart=0`, before `AA_START()`) | nothing; no GL context yet | 1 | 0 | — | — |
| a, boot + 9 s | Language Settings menu (`scene-a-9s.png`) | 1 | 559 in 3 s | 6 (min 6, max 6) | 5.3 |
| b, 2.5 s after the first tap | First Setup menu (`scene-b-after-tap1.png`) | 1 | 378 in 2 s | 14 (13–14) | 5.2 |

Frame costs at `MAX_FPS 1000`, unthrottled (`cpu` 1). Every one of the 2296
frames in this run ended in `glFinish`. Both menus are under the floor; the
overlay-only pre-round frames (11–18) draw more than either, which is why
the floor comes from them. `check-arm.mjs` on this run: `INVALID` (no keys,
no throttle, no measured round) — it is a measurement of scenes, not an arm.

## swap-mode-probe — `SWAP_MODE 1` does not survive a first-use boot

`swap-mode-probe/` (20:31; load 15.55 before, 13.70 after; `console.log`,
`steps.txt`, `uptime.txt`). The arm's autoexec patch plus `SWAP_MODE 1` (the
`glFlush` mode; `swapModeCI` in `gMenus.cpp`), then the sampler's swap
counters read three times:

| when | `swaps` | frames |
|---|---|---|
| boot + 2 s | `{flush: 0, finish: 397}` | 397 |
| menu, boot + 9 s | `{flush: 0, finish: 1716}` | 1716 |
| round 1 + 6 s | `{flush: 0, finish: 4303}` | 4303 |

Not one `glFlush`. `st_LoadConfig` (`tConfiguration.cpp`) reads
`autoexec.cfg` before `welcome()` (`gArmagetron.cpp`) runs
`sr_LoadDefaultConfig()` under `st_FirstUse`, and that function sets
`rSysDep::swapMode_ = rSwap_glFinish` — after the config, on every boot the
harness makes. So a `glFlush` control cannot be set from `CONFIGLINES`;
`FIRST_USE 0` there would skip the whole first-use path, including the
tutorial match every arm measures, and is a different arm, not a control.
What the control was for — bounding the GPU-wait share of a frame — is
answered directly instead: the sampler times the swap call in every frame,
and in every window of every run here `ms_in_swap_p50` is 0, p90 0–0.1 and
max 1.1–1.5 ms. On this machine and Chrome 152, `finish()` returns at once.

## negative-no-keys — INVALID, as it must be

Same arm, template with the two `key:` lines deleted (`steps.txt` in the
directory is what ran; it has no `key:` step). Run 20:42–20:45.
`check-arm.mjs`: `INVALID: only 0 tutorial key presses logged (need Right and
Left)` — one check, the key count. Kept: `console.log`, `steps.txt`,
`uptime.txt`, `r2-50s.png`, `r3-50s.png` (the late screenshots); the other
five screenshots were not committed.

What the match did without the keys:

| round | cpu | span s (ends at) | early ms p50 | late ms p50 | ratio_ms | early draws | late draws | ratio_draws | hitches >50 ms |
|---|---|---|---|---|---|---|---|---|---|
| 1 (setup) | 1→6 | 0.54–45.8 (death) | 7.0 | 18.2 | (throttle) | 77.4 | 83.5 | — | 0 |
| 2 | 6 | 0.53–59.1 (death) | 21.4 | 33.0 | 1.54 | 96.2 | 246.5 | 2.56 | 17 |
| 3 | 6 | 0.53–59.1 (death) | 21.2 | 24.7 | 1.17 | 90.3 | 112.7 | 1.25 | 3 |

Frame costs at `MAX_FPS 1000`; `cpu` = the CDP throttle rate.

- The match started and ran three rounds. The human died 59.1 s after
  `NEW_ROUND` in rounds 2 and 3, as in the base run (59.1/59.1), as in both
  runs of the rig's first version (59.1 ×4): eight measured rounds, keys or
  not, to the tenth of a second.
- Per-second draws/frame in rounds 2 and 3 match the base run to within one
  call for the first 45 s (30.9, 76.0, 94.6, 95, 119.2, 122.8 … 107 flat from
  second 15 to 44); early windows 96.2/90.3 against 96.0/90.2.
- This run's round 2 carried the draw spike inside its span: seconds 46–56
  read 157, 208, 263, 307, 311, 310, 314, 311, 317, 307, 261 draws/frame,
  with `ms_first_draw_to_swap` up from 16 to 20–26 ms and `ms_to_first_draw`
  from 7 to 11–16 in the same seconds — hence `ratio_draws` 2.56 and
  `ratio_ms` 1.54. In the base run the same spike fell in round 3's last two
  seconds, after the human's death. In four measured rounds over two runs it
  appeared once inside the span and once outside; its timing, not its
  existence, is what varies.
- `r2-50s.png` is indistinguishable from `base/r2-50s.png`: the same centre
  text, cycle at 15.0, "Me: −2", "Enemies: 7", the same three trails at the
  horizon.
- The draws floor did not reject this arm (late 112.7 and 246.5 against
  22.6); the key count did.
- Round 1 lasted 45.8 s here (the human killed by `gcc`), 45.8 s in the first
  version's no-keys run, 46.1 s in the base run with the presses after the
  countdown, and 17.9 s in the first version's base run, whose presses landed
  *during* the countdown. One sample each of the last two.

So "without the keys the match never starts and the arena stays empty" (the
plan's reconnaissance item 1) did not reproduce, twice. The keys are sent
and counted; the measured rounds are AI-driven with a human cycle that
drives straight until it dies at 59.1 s, keys or not.

## key-delivery — the presses do reach the page

`key-delivery/console.log` (from the rig's first version; unchanged): page
loaded with `?autostart=0` (game held), a capture-phase `keydown` listener
installed on `window`, then the same `key:Right:1`, `key:Left:1` steps. The
page saw `["ArrowRight/ArrowRight/trusted","ArrowLeft/ArrowLeft/trusted"]`.
The browser delivers the presses as trusted events; whether the game's input
path turns the cycle on them is not shown by anything the transcript
records, and the screenshots cannot show it either: `ePlayer::Render`
re-displays the tooltip every second while the game time is past 1 s and no
other centre text is up, and `uActionTooltip::Count` takes one of the two
activations per press, so the "Press <right> …" hint is up after one press
whether or not the cycle turned.

## Screenshot timing — did not bite

Design: each `shot:` is bracketed on the page's clock and `report.js` drops
the frames between the brackets (100 ms before, 250 ms after) from every
statistic; `raw_ms_max` keeps them visible. Measured: every `late_5s` window
in both runs has `frames_excluded: 0` (the 50 s shots fell at 50.4–50.5 s;
the spans end at 59.1 s). In the second of base's `r2-30s` capture (30.29 s,
187 ms bracket), `raw_ms_max` = 29.1 ms against 28.3 and 28.8 in the
neighbouring seconds and `ms_p50` = 24.3 beside 24.4 and 24.2: there was no
hitch to exclude. The exclusion cost 61 frames over three shots in each
measured round of the base run (about 20 per shot).

## What Tasks 2–4 inherit

1. `ratio_ms` 1.25 and 1.19 with `ratio_draws` 1.19 and 1.26 in the valid
   run; 1.54/1.17 with 2.56/1.25 in the no-keys run. With the pre-round
   frames and the post-death seconds out of the windows, the rise that is
   left has two parts that the split now separates: a rise in
   `ms_to_first_draw` (7.5 → 10–16 ms) from about second 45 in **all four**
   measured rounds with draws flat at 107–111, and a draw spike to ~310
   calls/frame for about ten seconds that raises `ms_first_draw_to_swap` by
   about a third and appeared in one measured round per run, sometimes
   before the human's death and sometimes after it. Five runs (Task 2) are
   what will say how often each lands inside the span.
2. The human does not drive in a measured round. A lever aimed at mechanism 2
   (the rubber path) cannot be judged by this template, and a driving
   template must prove the turn happened — nothing here does.
3. The match is the tutorial match: walls are already capped at 400, so a
   `walls400` arm is the base arm and `SP_WALLS_LENGTH` in `CONFIGLINES` does
   not reach the game (`welcome()` overwrites it). Task 4's `walls*` levers
   need a different mechanism or a different boot path before they are run.
4. Round length is fixed at 59.1 s by the human's straight run; `late_5s` is
   seconds 54–59 of the round, before the death, and `early_5s` is seconds
   0.5–5.5, which is the countdown plus a second and a half of movement.
5. Every frame ends in `glFinish`, which costs nothing measurable here, and
   about 5 ms of every frame is the event-loop yield the throttle does not
   scale: a rate-6 frame is ~25 ms where a rate-1 frame is ~7.
