# Task 1 rig — the harness proves itself

One validated `base` arm, one negative control, one key-delivery check.
2026-09-03, this worktree's `web/dist-m1` (built here at 17:17 from an
unchanged `src/`; `make -f web/Makefile client` then reported nothing to do),
served by `python3 -m http.server 8006 --directory web/dist-m1`. Chrome
152.0.7977.75, headed, `--mobile 915,412,3`.

**These are one desktop's numbers**: frame costs at `MAX_FPS 1000` under a 6×
CPU throttle at a phone's pixel count. The early-vs-late ratios and the deltas
between arms are the transferable results; the milliseconds are not a phone's.

## Commands

    sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task1-rig base 6 'SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7'
    sed '/^key:/d' web/tools/perf/arm.steps.tmpl > <scratch>/no-keys.tmpl
    sh web/tools/perf/run-arm.sh docs/evidence/m6-lag/task1-rig negative-no-keys 6 'SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7' <scratch>/no-keys.tmpl
    node web/tools/drive-browser.mjs --headed --mobile 915,412,3 --out docs/evidence/m6-lag/task1-rig/key-delivery \
         --url 'http://localhost:8006/armagetronad.html?autostart=0&touch=1' --script-file <scratch>/key-delivery.steps
    python3 web/tools/perf/summarise.py docs/evidence/m6-lag/task1-rig | tee docs/evidence/m6-lag/task1-rig/table.txt

Hygiene: before each run `pgrep -fl 'drive-browser.mjs|em++ '` showed no
process of ours; no build ran; the arms ran one after the other. Load
(`uptime`, 1-minute) from each arm's `uptime.txt`: base 9.21 before / 9.03
after; negative 8.09 before / 13.83 after. This machine idles at 9–13 from the
maintainer's own apps; load is recorded, not gated on.

## base — VALID

`check-arm.mjs`: `VALID: 2 rounds at cpu 6x; late ms p50 32.3/28.6; late
draws/frame 174.93/135.67 (floor 36.99); late shots r2-50s / r3-30s,r3-50s`

| round | len s | early ms p50/p90 | late ms p50/p90 | ratio_ms | early draws | late draws | ratio_draws | early→late KB/frame | hitches >50 ms | late frames |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 (setup; throttle on at ~6 s) | 19.2 | 7.0/7.7 | 19.6/22.9 | — | 69.1 | 86.1 | — | 107.6→114.9 | 0 | 249 |
| 2 | 61.0 | 23.7/29.2 | 32.3/40.8 | 1.36 | 70.7 | 174.9 | 2.47 | 135.0→201.8 | 19 | 150 |
| 3 | 60.8 | 22.8/26.8 | 28.6/39.0 | 1.25 | 66.5 | 135.7 | 2.04 | 139.3→186.1 | 9 | 162 |

Round 1's early→late ratio (2.8) is the throttle switching on, not a result.
Cross-round drift: round-3-early 22.8 vs round-2-early 23.7.

Per-second draws/frame, round 2 (61 entries): 28.9, 75.0, 93.1, 94, 118.3,
121.9, 117, 117, 114.5, 114, 111.6, 111, 108.5, 108, 107.2, then **exactly 107
from second 15 to second 44**, then 114.0, 158, 211.1, 261.9, 308.0, 313.4,
308.9, 312.6, 312.2, 313.5, 305.3, 260.6, 210.4, 164, 122.4, 119.5. `ms_p50`
in the same seconds: 24–27 while draws sit at 107, 34–39 while draws are above
300, 28.8 in the last second. Round 3 sat at 107–111 from second 15 to second
58 and rose to 158.4, 210.4 only in its last two seconds; its `ms_p50` was
25–34 over the last 15 s. The full series are in `table.txt` and in the
`[PERF]` line at the end of `base/console.log`.

Screenshots: `r2-30s.png`, `r2-50s.png`, `r3-30s.png`, `r3-50s.png` show a
live round — trails at the horizon, "Enemies: 7", FPS 24–38 on the HUD — with
the human cycle at speed 15.0 under the hint text, score −2 in round 2 and −4
in round 3. `r1-after-tutorial-keys.png`, 1.5 s after the two presses, shows
the "Press <right> or <o> to turn right." hint still up, a straight trail,
four of seven AIs joined, FPS 136 unthrottled.

## The floor: 36.99

Round 1, second 0: 36.99 draws/frame (`rounds[0].per_second.draws_per_frame[0]`).
Seconds 1–3: 61, 79.8, 80 — before any key was dispatched (the presses landed
3.9 s and 4.2 s into the round on the driver's clock: `NEW_ROUND` at 17359 ms,
keys at 21249 and 21585 ms). This is the value now in `check-arm.mjs`; ×1.25 = 46.2.

## negative-no-keys — INVALID, as it must be

Same arm, template with the two `key:` lines deleted (`steps.txt` in the
directory is what ran; it has no `key:` step). `check-arm.mjs` on the run's
full output: `INVALID: only 0 tutorial key presses logged (need Right and
Left)`. Kept: `console.log`, `steps.txt`, `uptime.txt`, `r2-50s.png` (the
late screenshot); the other six screenshots were not committed, so on the
committed tree the verdict gains `; round 3: no screenshot from its second
half on disk` — a consequence of the trimming, not of the run.

What the match did without the keys:

| round | len s | early ms p50 | late ms p50 | ratio_ms | early draws | late draws | ratio_draws |
|---|---|---|---|---|---|---|---|
| 1 (setup) | 47.5 | 7.0 | 18.9 | (throttle) | 68.9 | 84.2 | — |
| 2 | 60.9 | 21.8 | 26.5 | 1.22 | 71.4 | 116.5 | 1.63 |
| 3 | 60.9 | 22.1 | 25.8 | 1.17 | 65.9 | 116.4 | 1.77 |

- The match started and ran three rounds. Rounds 2 and 3 lasted 60.9 s each,
  against 61.0 and 60.8 s with the keys.
- Per-second draws/frame in rounds 2 and 3 match the base run to within one
  call for the first 45 s (29.3, 75.0, 93.6, 94, 117.5, 121.8, … 107 flat from
  second 15 to 44); the base run's round-2 late spike (to 313) did not occur
  here (119.7 in the last second).
- `r2-50s.png` is indistinguishable from `base/r2-50s.png`: the same second
  hint text, cycle at 15.0, "Me: −2", "Enemies: 7", the same trails at the
  horizon.
- The draws floor did not reject this arm (late 116.4 > 46.2); the key count did.
- The one difference: round 1 lasted 47.5 s here and 19.2 s with the keys.
  One sample each.

So "without the keys the match never starts and the arena stays empty" (the
plan's reconnaissance item 1) did not reproduce. The keys are sent and
counted; the measured rounds are AI-driven with a human cycle that drives
straight until it dies at ~61 s, keys or not.

## key-delivery — the presses do reach the page

`key-delivery/console.log`: page loaded with `?autostart=0` (game held), a
capture-phase `keydown` listener installed on `window`, then the same
`key:Right:1`, `key:Left:1` steps. The page saw
`["ArrowRight/ArrowRight/trusted","ArrowLeft/ArrowLeft/trusted"]`. The browser
delivers the presses as trusted events; whether the game's input path turns
the cycle on them is not shown by anything the transcript records.

## Screenshot timing — did not bite

Design: each `shot:` is bracketed on the page's clock and `report.js` drops
the frames between the brackets (100 ms before, 250 ms after) from every
statistic; `raw_ms_max` keeps them visible. Measured: every `late_5s` window
in both runs has `frames_excluded: 0` (the 50 s shots fell at 50.4–50.5 s of
60.8–61.0 s rounds). In the second of base's `r2-30s` capture (30.32 s, 175 ms
bracket), `raw_ms_max` = 30.2 ms against 31.2 and 27.3 in the neighbouring
seconds and `ms_p50` = 24.9 beside 26.3 and 25.0: there was no hitch to
exclude. The exclusion cost 56 and 60 frames over three shots in rounds 2 and
3 (about 19–20 per shot).

## What Tasks 2–4 inherit

1. `ratio_ms` 1.36 and 1.25 with `ratio_draws` 2.47 and 2.04 in the one valid
   run; 1.22/1.17 with 1.63/1.77 in the no-keys run. Both ratios rose together
   in all four measured rounds — the renderer fingerprint — but the rise is
   concentrated in the last 5–15 s of a round, after 30 s at exactly 107
   draws/frame, and its size varied (313 vs 120 at the peak) between two
   otherwise identical rounds. Five runs (Task 2) are what will say how often
   and how much.
2. The human does not drive in a measured round. A lever aimed at mechanism 2
   (the rubber path) cannot be judged by this template.
3. Round length is fixed at ~61 s by the human's straight run to the far wall,
   so `late_5s` is always the human's death approach and the AIs' endgame.
