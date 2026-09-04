# Task 4 — four settings-only levers, A/B against Task 2's baseline

Twelve runs and one probe on 2026-09-03 between 22:56 and 23:40, one after
another, against the baseline of `docs/evidence/m6-lag/task2-repro` (ten
measured rounds, five runs). Same binary as Tasks 1–3 (`web/dist-m1`,
`armagetronad.wasm` 4,333,093 bytes, md5
`8531ea5dd60138a534147e222ba56007`; `make -f web/Makefile client` reported
nothing to do and **no build ran**), same server
(`python3 -m http.server 8006 --directory web/dist-m1`; the plan's 8000 is
another worktree's server on this machine), Chrome headed at
`--mobile 915,412,3`, CPU throttle 6× from round 1, harness `web/tools/perf/`
unchanged from Task 3 — no file under `web/tools/perf/` was touched by this
task.

Eleven of the twelve runs and the probe printed `VALID`. The twelfth,
`fps30-r3`, was killed 6 s into round 3 and has **no `[PERF]` line at all**;
it is `INCOMPLETE`, it is in this tree for the record, and it is excluded
from every table below. **`fps30` therefore has four measured rounds (r1 and
r2), not six.**

**These are one desktop's numbers.** Every millisecond is a frame interval
at `MAX_FPS 1000` under a 6× CPU throttle at a phone's pixel count, and a
frame interval contains a fixed event-loop yield the throttle does not scale
(`web/tools/perf/README.md`, "What a frame time contains"). The `fps30` arm
is the exception that proves it: at `MAX_FPS 30` the limiter's own
`emscripten_sleep` lands inside `ms_to_first_draw`, so that arm's frame parts
are not comparable to the others'. The early-vs-late ratios and the deltas
between arms are what travels; the milliseconds are not a phone's.

**Two facts about the machine, recorded and not gated.** (1) A Time Machine
backup (`backupd`) ran through the whole Task 4 window and XProtect scans
fired inside it; the 1-minute load in each run's `uptime.txt` — 5.47 to
12.66 before, 6.10 to 12.63 after — is that background, not this work. Ratios
and per-arm deltas tolerate it; absolute milliseconds tolerate it less. (2)
**Chrome updated in the middle of the sweep**: the probe and all four `-r1`
runs ran on Chrome/152.0.7977.75 (the version all of Tasks 2 and 3 ran on),
every `-r2` and `-r3` run on 152.0.7977.77 (`chrome:` line at the head of each
`console.log`). The split is balanced across arms — one `.75` run and two
`.77` runs for each of `walls400`, `walls150` and `nomirror`, one each for
`fps30` — so it cannot bias one arm against another, but it does sit between
every arm and `base`. That is what the `walls400` arm is for: it is the
same configuration as `base`, run inside this sweep, and it is the honest
control for a `.75`-only baseline.

## Commands

    D=docs/evidence/m6-lag/task4-levers
    C='SP_SIZE_FACTOR 6\\nSP_NUM_AIS 7'
    sh web/tools/perf/run-arm.sh $D sp-walls150-probe 6 "$C"'\\nSP_WALLS_LENGTH 150'
    for k in 1 2 3; do
      sh web/tools/perf/run-arm.sh $D walls400-r$k  6 "$C"'\\nSP_WALLS_LENGTH 400'
      sh web/tools/perf/run-arm.sh $D walls150-r$k  6 "$C"'\\nCYCLE_DIST_WALL_SHRINK 0.00025\\nCYCLE_DIST_WALL_SHRINK_OFFSET 1000000'
      sh web/tools/perf/run-arm.sh $D nomirror-r$k  6 "$C"'\\nFLOOR_MIRROR_INT 0'
      sh web/tools/perf/run-arm.sh $D fps30-r$k     6 "$C"'\\nMAX_FPS 30'
    done
    python3 web/tools/perf/summarise.py $D | tee $D/table.txt

The order actually run is the probe, then the four arms in that loop order,
`-r1` pass, `-r2` pass, `-r3` pass — so a machine-state drift shows up as a
difference between passes, not between arms. Each run started only after the
previous `run-arm.sh` had exited and `pgrep` for a foreign
`drive-browser.mjs`, an `em++` compile and an `aa-chrome-*` profile all came
back empty; no waiting was ever needed. The config lines in the table above
are exactly what is in each run's `steps.txt` (`grep` them: `run-arm.sh`
writes the arm's `autoexec` additions into the script it runs).

## What each arm actually set, and what it actually did

Every arm plays the **tutorial match** — a first-use boot, so `welcome()`
(`src/tron/gArmagetron.cpp`) runs — and `welcome()` overwrites part of what
`autoexec.cfg` just set: it saves and then assigns `speedFactor = -2`,
`autoNum = 0`, `sizeFactor -= 2`, **`wallsLength = 400`**, `sg_rubberCycle = 5`,
`sg_delayCycle = 0.05`, calls `sg_SinglePlayerGame()` and restores them
afterwards. That single fact decides three of the four levers.

**`SP_WALLS_LENGTH` is inert here — measured, not argued.** `sg_copySettings()`
(`src/tron/gGame.cpp`) copies `sg_currentSettings->wallsLength` into
`gCycle::SetWallsLength()`, whose body is `c_pwl->Set(length)` on the
`CYCLE_WALLS_LENGTH` setting item, and it is called from `sg_EnterGameCore()`
— after `welcome()` has forced 400. So `SP_WALLS_LENGTH 150` cannot take in
this match. The probe `sp-walls150-probe` set it literally and read
**exactly 107.0 draws per frame over seconds 15–44 in both of its measured
rounds** — the same value as all ten base rounds — with late KB/frame 179.06
and 181.86, inside the base spread. A 150-unit cap holding fewer segments
than a 400-unit one would not read identically. `walls400` (`SP_WALLS_LENGTH
400`) is therefore literally `base`'s configuration re-run inside this sweep,
which is why it is the control and not a lever.

**`walls150` had to use a different setting than the plan named.** What
`welcome()` does *not* touch is `sg_CycleWallLengthFromDist()`
(`src/tron/gCycle.cpp`): `len = gCycle::WallsLength(); if (len <= 0) return
len; d = CYCLE_DIST_WALL_SHRINK_OFFSET - distance; if (d > 0) len -=
CYCLE_DIST_WALL_SHRINK * d;` — used by `gCycle::ThisWallsLength()`, which is
where the trail's end is placed. With `CYCLE_DIST_WALL_SHRINK 0.00025` and
`CYCLE_DIST_WALL_SHRINK_OFFSET 1000000`, `len = 400 − 0.00025 × (10⁶ −
distance) = 150 + 0.00025 × distance`, i.e. **150.0–150.4 units** over a
round (a cycle at speed 15.0 covers under 1500 units in 60 s). Both are
`nSettingItemWatched<REAL>`, the same class as Task 3's `CYCLE_RUBBER_TIME`,
which took. It took here too, and the picture is the proof: in
`walls150-r2/r2-50s.png` against `walls400-r1/r2-50s.png` (same camera, same
second of the round, both viewed) the long grey trail that spans 8–27 % of
the frame width in `walls400` **is not there at all** in `walls150`, and the
cyan trail across the horizon runs 43–53 % of the width instead of 43–82 %.
`WallEndSpeed()` scales the trail end's recession by `(1 − 0.00025)`:
negligible. `MaxWallsLength()`'s `len = wallsLength` branch needs shrink > 1
and is not taken.

**`FLOOR_MIRROR_INT 0` is a null lever in this build**, so `nomirror` is a
second base replicate rather than a lever arm. `sr_floorMirror`
(`src/render/rScreen.cpp`) is `int sr_floorMirror=0` = `rMIRROR_OFF`, and
`sr_LoadDefaultConfig()` in the same file sets it to `rMIRROR_OFF`
unconditionally — that call runs *inside* `welcome()` on a first-use boot,
i.e. after `autoexec.cfg`. The NVIDIA branch that could raise it is compiled
out under `__EMSCRIPTEN__`. The entire mirrored pass in
`src/engine/eDisplay.cpp` (`display_simple` called a second time under
`glScalef(1,1,-1)`) sits inside `if (sr_floorMirror)`, and `FLOOR_MIRROR_INT`
is `tSettingItem<REAL> f_m("FLOOR_MIRROR_INT", sr_floorMirror_strength)` in
that same file, read only as the `1 − sr_floorMirror_strength` alpha of that
second pass. (The `st_Dummy9` alias that swallows the setting in
`src/tools/tConfiguration.cpp` is `#ifdef DEDICATED`, so in the client the
value really is stored — into a variable nothing reads.) The shipped config
has `FLOOR_MIRROR_INT .1` and no `FLOOR_MIRROR` line anywhere in `config/` or
`web/`, and the base screenshots show a plain grid floor with no reflection.
**Setting it to 0 changes the alpha of a pass that is not rendered.**

**`MAX_FPS 30` is a real lever, and a smoothness one.**
`tConfItem<int> sr_maxFPSConf("MAX_FPS", sr_maxFPS, val >= 0)`
(`src/render/rSysdep.cpp`); `sr_LimitFPS()` waits with
`emscripten_sleep(round(1000 × (target − now)))` when a frame arrives early.
Config lines apply in order, so the arm's `MAX_FPS 30` overrides the
template's `MAX_FPS 1000` — and it took: the HUD in
`fps30-r1/r1-after-tutorial-keys.png` (kept for this reason) reads
**`FPS: 30`** in round 1, before the throttle even goes on, and the arm
sampled 5763 and 5787 frames per run against 11,539–12,168 in every other
arm of this task. `welcome()` does not touch it.

## The table

Per arm over all its measured rounds. `late` is the five seconds before the
human's death (59.07–59.13 s in every round of every run); `ratio_ms` is that
window's `ms_p50` over the early window's. Hitches are frames over 50 ms,
counted twice: over the whole measured span and inside the late window
alone. `base` is Task 2's ten rounds. Every figure is computed from the
`[PERF]` JSON at the end of each `console.log` — the same objects
`summarise.py` prints into `table.txt` — and none is copied from a report.
The `ratio_ms` means are printed to three decimals: the per-round values are
two-decimal, and two of the arm means (`walls400` 1.265, `walls150` 1.095)
sit exactly on a two-decimal tie.

| arm | rounds | late ms p50 mean / worst | late p90 mean / worst | `ratio_ms` mean / worst | hitches, span mean / worst | hitches, late window mean / worst | late draws/frame mean | Δ late p50 vs `base` | Δ late p90 | Δ `ratio_ms` |
|---|---|---|---|---|---|---|---|---|---|---|
| `base` (Task 2) | 10 | 28.59 / 36.1 | 37.09 / 46.4 | 1.264 / 1.63 | 14.4 / 42 | 3.2 / 11 | 171.8 | — | — | — |
| `walls400` (control) | 6 | 27.40 / 32.1 | 34.80 / 40.6 | 1.265 / 1.57 | 5.7 / 10 | 1.3 / 2 | 160.6 | −1.19 | −2.29 | +0.001 |
| `walls150` | 6 | 24.88 / 26.0 | 29.82 / 30.7 | 1.095 / 1.16 | 6.8 / 13 | 1.8 / 3 | 113.4 | −3.71 | −7.27 | −0.169 |
| `nomirror` (null) | 6 | 25.07 / 27.8 | 31.07 / 37.0 | 1.157 / 1.34 | 4.7 / 8 | 1.0 / 2 | 113.8 | −3.52 | −6.02 | −0.107 |
| `fps30` | 4 | 33.65 / 34.6 | 41.00 / 42.8 | 1.010 / 1.04 | 10.8 / 15 | 1.8 / 2 | 147.7 | +5.06 | +3.91 | −0.254 |
| `sp-walls150-probe` | 2 | 25.40 / 26.0 | 31.65 / 32.0 | 1.145 / 1.24 | 4.5 / 6 | 1.5 / 2 | 112.7 | −3.19 | −5.44 | −0.119 |

Read the mean columns knowing what is inside them: a draw-spike round differs
from a flat one by more than any of these levers moves a flat round, and the
spikes are not evenly spread (next table but one). The same rounds with every
spike round removed:

| arm | flat rounds | late ms p50 median | late p90 median | `ratio_ms` median | hitches span / late, median | late KB/frame median |
|---|---|---|---|---|---|---|
| `base` | 7 of 10 | 25.8 | 34.5 | 1.15 | 7 / 1 | 181.59 |
| `walls400` | 4 of 6 | 25.05 | 31.8 | 1.16 | 4.0 / 1.5 | 180.62 |
| `walls150` | 5 of 6 | 24.6 | 29.7 | 1.14 | 5 / 1 | 179.00 |
| `nomirror` | 6 of 6 | 24.5 | 30.35 | 1.13 | 4.5 / 1.0 | 180.58 |
| `fps30` | 3 of 4 | 33.5 | 40.1 | 1.00 | 10 / 2 | 179.48 |
| `sp-walls150-probe` | 2 of 2 | 25.4 | 31.65 | 1.15 | 4.5 / 1.5 | 180.46 |

"Flat" here means the round had no draw spike in any whole second of its measured span
(`spike_any`, defined two tables down) — a stricter test than Task 2's
late-window `ratio_draws`, and it moves exactly one round: `walls150-r3`
round 3, whose spike was over before the late window opened. Task 2's
run-to-run spread of the *level* was about 4 ms; every flat median in this
table is inside 1.3 ms of `base`'s except `fps30`'s, which is the cap.

**The flat seconds and the second-45 event.** Seconds 15–44 of each round are
the plateau: the draw count is **exactly 107.0 per frame there in all 24
measured rounds of this task and all 10 of Task 2's** — no arm changed it.
`bump length` counts the seconds in 45–58 whose `ms_to_first_draw_p50` is
more than 2 ms above the round's own seconds-15–44 median.

| arm | plateau `ms_p50` s15–44, median (Δ `base`) | plateau `ms_to_first_draw` (Δ) | plateau `ms_first_draw_to_swap` (Δ) | plateau draws | bump length, s: median (every round) | mean `ms_to_first_draw`, s45–55 |
|---|---|---|---|---|---|---|
| `base` | 23.67 | 7.20 | 16.35 | 107 | 11 (11,11,11,11,11,11,11,12,14,14) | 12.38 |
| `walls400` | 22.52 (−1.15) | 6.97 (−0.23) | 15.57 (−0.78) | 107 | 11 (11,11,11,11,12,12) | 11.53 |
| `walls150` | 24.50 (+0.83) | 7.35 (+0.15) | 16.95 (+0.60) | 107 | **4** (4,4,4,4,4,5) | **9.65** |
| `nomirror` | 23.88 (+0.21) | 7.20 (0.00) | 16.55 (+0.20) | 107 | 11 (7,10,11,11,11,11) | 11.07 |
| `fps30` | 33.33 (+9.66) | 15.70 (+8.50) | 17.43 (+1.08) | 107 | 1 (0,0,2,11) — see below | 15.86 |
| `sp-walls150-probe` | 24.70 (+1.03) | 7.30 (+0.10) | 17.27 (+0.92) | 107 | 10 (9,11) | 10.79 |

`fps30`'s bump column is not a measurement of the event: the limiter's sleep
lands in `ms_to_first_draw`, which is why that arm's plateau reads 15.70 ms
there, and a 2 ms excursion above a 15.7 ms plateau is a different test than
above a 7.2 ms one. Its `ms_p50` per second says what happened instead: the
event peeks 1–2 ms above the cap (34.0–35.7 ms in seconds 45–55 of
`fps30-r2` round 2) rather than doubling.

**Draw spikes.** `spike_any` is true when the peak draws per frame in any
whole second from 10 through 58 — the whole seconds inside the measured
span; the partial last second, 59.0 s to the death at 59.1, also holds
post-death frames and is excluded — reaches **≥ 200** (Task 2's late-window
`ratio_draws ≥ 2` misses a spike that ends before second 54, and
`walls150-r3` round 3 is exactly that case). `length` counts seconds at
≥ 150 draws in the same range; `peak ms` is the highest per-second `ms_p50`
in it.

| arm | spike rounds | which | peak draws (second) | length | peak ms |
|---|---|---|---|---|---|
| `base` | **3 of 10** | r1/2, r4/2, r4/3 | 503 (49), 511 (49), 393 (49) | 13, 13, 13 s | 43.0, 45.3, 51.6 |
| `walls400` | **2 of 6** | r2/2, r3/3 | 343 (49), 338 (50) | 13, 13 s | 38.7, 36.5 |
| `walls150` | **1 of 6** | r3/3 | 394 (49) | **6 s** | 42.0 |
| `nomirror` | **0 of 6** | — | — | — | — |
| `fps30` | **1 of 4** | r1/3 | 442 (49) | 13 s | 39.5 |
| `sp-walls150-probe` | **0 of 2** | — | — | — | — |

Every spike in every arm starts at second 45 or 46 and peaks at 49 or 50.
Seven spike rounds over 34 measured rounds is not enough to rank arms by
incidence — `nomirror`'s 0 of 6 is the same configuration as `base`'s 3 of
10 — but the *shape* of the one `walls150` spike is a measurement: 6 seconds
instead of 13, over by second 52, which is why the late window never saw it
(`ratio_draws` 1.26).

**The `[SND]` limiter marker is not what changed.** In round 2 of all 18 runs
of Tasks 2 and 4, `[SND] voice limiter STARTED cutting` prints **45.44–45.56 s
after that round's `NEW_ROUND`** — the same second in every arm, including
the incomplete `fps30-r3`. What differs is how long it stays cutting, and
that tracks the spike exactly: of the 17 *measured* round 2s, the three whose
`stopped` line comes after 56 s (`base-r1` 56.92, `base-r4` 56.94,
`walls400-r2` 56.62) are precisely the three round-2 draw spikes, and the
other fourteen stop at 47.07–47.34 s and are flat. (`fps30-r3`'s round 2 also
stopped at 56.95 s; with no `[PERF]` line it cannot be counted either way.)
This is a correlate with timestamps, as Task 2 said — the marker is the same
in every arm, so no lever here moved it, and none of the four is a sound
lever.

## What each lever costs the player

- **`walls150` — trails end 150 units behind you instead of 400.** That is
  the whole cost, and it is a gameplay change, not a rendering one: a shorter
  trail is a smaller obstacle for everyone, yours and the AIs'. Today it can
  only be had through the shrink pair (`CYCLE_DIST_WALL_SHRINK` /
  `_OFFSET`), because the tutorial match forces 400 over `SP_WALLS_LENGTH`;
  on the post-tutorial path `SP_WALLS_LENGTH` is the direct setting and the
  shrink pair is not needed. The shrink pair also has a side effect worth
  naming: the length grows with distance driven (150.0 → 150.4 units over a
  round), so it is a *floor* of 150 rather than a flat cap.
- **`nomirror` — nothing, in either direction.** The floor mirror is already
  off in this build, so there is no reflection to lose and no milliseconds to
  gain. Do not ship it as a fix; it would be a no-op with a changelog entry.
- **`fps30` — half the frames.** The plateau is pinned at the cap (33.33 ms
  median against `base`'s 23.67) and the on-screen rate is 29 fps mean over
  the late windows against 33.8. What the player gets back is steadiness:
  `ratio_ms` 1.010 mean and 1.04 worst against 1.264 and 1.63, and the one
  spike round the arm caught peaked at 39.5 ms against `base`'s spike rounds
  at 43.0, 45.3 and 51.6, with p90 42.8 against 42.7–46.4 — a spike that is
  no worse than a flat frame is by much. It does not remove the spikes (1 of
  4 rounds still had one); it removes the *difference* between a spike and
  the rest.
- **`sp-walls150-probe` — nothing was set.** Kept as evidence that it was
  nothing.

## Ranking, on the metric Task 3 said matters

Task 3's two verdicts put the growth in the **simulation**: the pre-draw part
of the frame (`ms_to_first_draw`) doubles at second 45 in 10 of 10 baseline
rounds, and it is 2.3–3.7 ms of the 1.0–4.4 ms that the seven flat rounds
grow, against the render part's −1.5 to +1.1 ms. Ranked on that:

1. **Trail length (`walls150`) — the only lever that moved it.** Mean
   `ms_to_first_draw` over seconds 45–55: **9.65 ms against the control's
   11.53** and `base`'s 12.38, and the bump lasts **4–5 s in 6 of 6 rounds
   against 11–12 in 6 of 6 control rounds** (`base`: 11–14 in 10 of 10). It
   shortens the second-45 event; it does not remove it.
2. **A frame cap (`fps30`) — moves the *variance*, not the cost.** The work
   is still there; the limiter absorbs it into a sleep. Nothing about the
   event goes away.
3. **`FLOOR_MIRROR_INT 0` — null.** Not a lever in this build.
4. **`SP_WALLS_LENGTH` — inert in this match.** Not a lever *here*; possibly
   the most important one elsewhere (next section).

**And nothing cheap touched the flat cost.** Over seconds 15–44 the plateau
`ms_to_first_draw` is 6.97–7.35 ms in every arm but `fps30` — a 0.38 ms
spread that straddles `base`'s 7.20 in both directions, with the control
*below* `base` and the lever *above* it. The trail length costs nothing in
the flat seconds. Neither does anything else here.

**The renderer barely noticed the shorter trail, and that is informative.**
`walls150` cut the visible trail by roughly two thirds and the per-frame
upload fell by at most 1 KB of 179 (round 2: 178.48–179.00 KB against the
control's 179.15–179.28; round 3: 181.25–181.71 against 181.95–181.98), with
the draw count unmoved at 107 on the plateau. That is what
`display-lists-pricing.md` §1 predicts: `gNetPlayerWall::RenderNormal` emits
its 152 bytes **per segment**, `glRenderer::BeginPrimitive` batches a
cycle's segments into one block per pass, and a cycle driving straight has
few segments whatever its trail's length. Cutting length removes *area*, not
*submissions*. Consistent with, not proof of — no segment count was taken.
It also means mechanism 2 is untouched by every lever here, exactly as Task 3
predicted.

## The gap the maintainer must read

**Every arm above measured the tutorial match.** First-use boot, `welcome()`
in force: walls 400, rubber 5, speed factor −2, size factor −2, and
`SP_WALLS_LENGTH` overwritten before the round starts. The phone plays the
**post-tutorial** game — the second and every later launch, where `welcome()`
does not run, `SP_` settings are live, and the shipped `SP_WALLS_LENGTH` is
−1, which is `gCycle::wallsLength = -1.0f`: **trails that never expire.**

No arm in this task, or in Tasks 1–3, has measured that path. Which means:

- The wall-length lever's real effect lives there and is unmeasured here.
  What this task measured is the difference between a 400-unit trail and a
  150-unit one in a match that caps both. On the uncapped path the difference
  is between a trail that grows for the whole round and a capped one, and it
  is the only scenario in which the maintainer's *"the more I drive"* can be
  literally about the trail.
- The 107-draw plateau — the flat thirty seconds that make every render-side
  reading in Tasks 2–4 come out small — is an artefact of the 400-unit cap.
  It is not what the phone does.
- Conversely, nothing here says the lever *will* help there. It says the
  measurement does not exist.

What such an arm needs is written down in the package index
(`docs/evidence/m6-lag/README.md`, "Three options"): a `FIRST_USE 0` boot so
`welcome()` is skipped, and its own menu walk, because the harness's current
template drives the tutorial's key presses and the tutorial is what would no
longer be there.

## Files

- Per run, `<arm>/`: `console.log` (the transcript; the last
  `[PERF] <arm> {…}` line is the result), `steps.txt` (the driver script that
  ran, config lines included), `uptime.txt`, `r2-50s.png` and `r3-50s.png`
  (the late-window pictures, ~50.4 s into each measured round), and
  `<arm>-driver.txt` beside the directory. The five other screenshots each
  run took (`r1-after-tutorial-keys`, `r2-06s`, `r2-30s`, `r3-06s`, `r3-30s`)
  are not committed — Task 2's policy, and thirteen runs at Task 1's would
  have added about 45 MB of PNG. `check-arm.mjs` was re-run on each trimmed
  directory.
  Two exceptions, both deliberate: `fps30-r1/` also keeps
  `r1-after-tutorial-keys.png`, the `FPS: 30` HUD in round 1 that is this
  arm's proof its condition held — the same standard the milestone's own
  lesson asks for and that `walls150`'s `r2-50s.png` meets; and `fps30-r3/`
  has no `r3-50s.png` because the run died before it.
- `sp-walls150-probe/` — the probe. Two measured rounds, `VALID`, and its
  result is that the setting did nothing.
- `fps30-r3/` — `INCOMPLETE`. No `[PERF]` line; `summarise.py` prints it as
  `fps30-r3 (no [PERF] line)` and it is in no table. Its `uptime.txt`
  `after:` line reads 10:03 the next morning, which is when the orphaned
  driver was killed, not when the run ended.
- `table.txt` — `python3 web/tools/perf/summarise.py
  docs/evidence/m6-lag/task4-levers`, generated on this tree: per measured
  round the early/late windows and the ratios, the frame-part split, and the
  full per-second series (`ms_p50`, `draws_per_frame`,
  `ms_to_first_draw_p50`, `ms_first_draw_to_swap_p50`, `raw_ms_max`) that
  every derived number in this README is computed from.
- The derived columns above, spelled out so they can be recomputed from
  `table.txt` without the scratch script that produced them (a scratch tool,
  as Task 3's was): *plateau* = the median over seconds 15–44 of that
  round's per-second series; *bump length* = seconds in 45–58 whose
  `ms_to_first_draw_p50` exceeds the round's seconds-15–44 median by more
  than 2 ms; *mean s45–55* = the arithmetic mean of the eleven per-second
  `ms_to_first_draw_p50` values; *`spike_any`* = the maximum
  `draws_per_frame` over seconds 10 through 58 (the whole seconds inside the
  measured span; the partial last second, index 59 of `per_second`, starts
  before `measured_to_s` 59.1 and also holds post-death frames, and is
  excluded — read to `measured_to_s` instead, it would flag `base-r2` round
  2 and `walls150-r3` round 2 on that second alone) is ≥ 200; *length* = the
  count of those seconds at ≥ 150; *peak ms* = the maximum `ms_p50` over the
  same range. Per-arm means and medians are over that arm's measured
  rounds, `fps30-r3` excluded because it has none.
