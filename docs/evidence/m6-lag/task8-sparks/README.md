# M6 task 8 — the crash sparks: measured, and turned off on touch

**Nine runs and one setting. The two `crash_sparks` guards in `gCycle.cpp` are
about a quarter of the frame of a cycle that is sparking against a wall
(median second 17.15 → 13.1 ms, worst second 20.3 → 13.8), and they are the
geometry behind the end-of-round draw spikes Task 3's skeptic could not
identify: with `SPARKS 0` the spikes are 0 of 10 rounds against 3 of 10.
Nothing else moved, and the second-45 simulation bump is untouched. The change
that ships from this is one appended config line on touch devices — no source
change.**

Every arm here is its comparator's arm plus **one config line**. The step
files prove it: after substituting the arm name, `tut-nosparks-r1/steps.txt`
differs from Task 2's `base-r1/steps.txt` in the patch line, where
`SPARKS 0` is inserted, and in the report expression (below);
`posttut-nosparks-r1/steps.txt` differs from Task 7's `posttut-base-r1` in
that one insertion and nothing else at all; the grind arms differ from Task
3's `grind` in the same insertion.

**Every millisecond here is one desktop's**, at `MAX_FPS 1000` under a 6× CPU
throttle at a phone's pixel count (Chrome mobile emulation, 915×412 CSS px at
dpr 3), the same rig as every M6 arm — `../README.md`'s standing caveat
applies unchanged. Two things about the background, because this is a
cross-day comparison and not a same-sweep one:

- **Chrome moved.** All nine runs here and all of Task 7's ran
  **Chrome/152.0.7977.77**; Task 2's ten baseline rounds and Task 3's two
  grind arms ran **152.0.7977.75**, the day before. Where it matters — the
  grind — the comparison below is stated as *rim minus free within the same
  run*, which cancels any such offset; the raw free-driving windows differ by
  0.6–0.7 ms between the two days and that is written out rather than hidden.
- **The machine was not quiet.** The nine `uptime.txt` files read a 1-minute
  load of **8.00–19.24** before and after each run, the same busy background
  Task 4 recorded. One more reason to read within-run deltas.

**How a median is printed here.** Every median below is computed on unrounded
values and printed with the decimals it needs. An even-length window has no
middle observation — the grind's rim window is 40 seconds — so its median is
the midpoint of two, and the milestone's rule is that such a tie median keeps
the extra decimal rather than being rounded away: the grind arm's rim median
is **17.15 ms**, not 17.1, and `grind-nosparks-r2`'s is **13.65**. Pooled
figures over rounds (§3, §4) are medians of the unrounded per-round medians,
not of rounded ones. `compare.txt` prints every one of them the same way.

## Files

| | |
|---|---|
| `grind-nosparks-r1/`, `-r2/` | Task 3's grind arm + `SPARKS 0`. **INVALID by design**, exactly as Task 3's are |
| `tut-nosparks-r1/` … `-r5/` | Task 2's baseline arm + `SPARKS 0`; five runs, ten measured rounds, all VALID |
| `posttut-nosparks-r1/`, `-r2/` | Task 7's `posttut-base` arm + `SPARKS 0`; two runs, four measured rounds, all VALID under `--posttut` |
| `<run>-driver.txt` | the driver log beside each run |
| `table.txt` | `summarise.py` over this directory |
| `table-posttut.txt` | the same, `--posttut` — the mode that judges the two `posttut-` runs |
| `compare.txt` | every derived number below, with the window definitions in its header |
| `gates/` | the two browser gates for the shipped change, and their own README |

    python3 web/tools/perf/summarise.py docs/evidence/m6-lag/task8-sparks           > table.txt
    python3 web/tools/perf/summarise.py docs/evidence/m6-lag/task8-sparks --posttut > table-posttut.txt

Both files list all nine runs, because `summarise.py` takes a directory and
this directory holds arms of both gate modes. `table.txt` is authoritative for
the `grind-` and `tut-` runs; `table-posttut.txt` is authoritative for the two
`posttut-` runs, whose three extra checks (the menu walk, the patched
`autoexec.cfg`, the mid-round probe) only `--posttut` applies. The `tut-` rows
of `table-posttut.txt` read `INVALID [posttut]` for the reason the mode
exists — they are the tutorial match — and are not a result.

**One methodological difference to declare.** Task 2's runs printed their
`[PERF]` object with an older report expression than every run since; the
current one closes a round on `ROUND_WINNER` *when one is written* and adds a
`closed_by` field, so that Task 3's winnerless grind rounds could be reported
at all. **The two expressions can differ only on a round that has no
`ROUND_WINNER`, and there is no such round in either set** — which is what was
actually checked, since Task 2's older object carries no `closed_by` field to
read: in all five Task 2 runs and all five `tut-nosparks` runs,
`rounds_started` and `rounds_won` are both 3, and every measured round reports
`ends_at: human_death` with a span of 0.53–0.54 s → 59.09–59.13 s. The
stronger sentence — that each round *closed on* its `ROUND_WINNER` — is not
recoverable from Task 2's JSON, so it is not claimed.

## 1. Why this task exists

The maintainer re-tested on the phone and came back with two sensations, not
one: it is worst **when driving fast and close to a wall with the sparks
visible**, and it is worst **at the end of a round, when there are lots of
walls about**. M6 had a mechanism for the first (Task 3's mechanism 2, the
simulation at the wall) and an unidentified geometry for the second (Task 3's
mechanism 1: the render part moved with the draw count, but *what* was drawn
was never established — the trails are capped at 400 units in that match and
the draw count is flat at 107 for thirty seconds). Sparks are the one thing
that is present in both sensations, and they are a setting:

- **`SPARKS` already exists as a config item.** `static tConfItem<bool>
  cs2("SPARKS", crash_sparks)`, `src/tron/gMenus.cpp:513`, over the `extern
  bool crash_sparks` declared at `gMenus.cpp:511` and defined in
  `src/tron/gCycle.cpp:2508-2513`. It is also a Preferences toggle
  (`uMenuItemToggle cs`, `$pref_sparks_text`, `gMenus.cpp:584-587`).
- **Its shipped default is on in this build, and upstream already turns it off
  for a performance reason on one platform.** `gCycle.cpp:2508-2513` reads
  `#ifdef MACOSX` → `false` — with the comment *"Sparks have a large
  performance problem on Macs"* and a forum link — `#else` → `true`. The
  wasm build is not `MACOSX`, so it ships them on.
- **`crash_sparks` is read at exactly two places**, both in
  `gCycle::TimestepCore`'s wall-contact block: `if (crash_sparks && animts>0)`
  at `gCycle.cpp:3085` and again at `gCycle.cpp:3108`, each guarding a
  `new gSpark(...)` (four call sites, two per guard: one coloured by the wall's
  owner, one white). The guard is the *creation* of the spark, so with the
  setting off nothing is allocated, simulated or drawn.
- **A live spark is a draw call.** `gSpark::Render` (`src/tron/gSparks.cpp:110`)
  opens one immediate-mode block per spark — `BeginLines()` at line 120,
  vertices, `RenderEnd()` at line 196 — which the GL emulation flushes as one
  draw call. N sparks in the arena is N extra draw calls per frame, which is
  why the effect shows up in `draws_per_frame` at all.

So the lever is settings-only: no source change, no rebuild of the game, and
the number below is the cost of a visual effect, not of a bug.

## 2. The grind: sparks are the render half of the frame at the wall

Two arms, against Task 3's two. The arm holds one cycle against the arena rim
with `SP_NUM_AIS 0` and nothing else in the arena, so **every spark in the
window comes from the human's own cycle grinding the wall** and there is no
other geometry to confuse it. Like Task 3's, both runs are **INVALID by
design** — a lone cycle with no AI wins no round, so the gate's "rounds 2 and
3" check cannot pass:

    $ node web/tools/perf/check-arm.mjs docs/evidence/m6-lag/task8-sparks/grind-nosparks-r1/console.log
    check-arm.mjs: mode default -- the tutorial match (the default; it cannot tell that match from any other)
    INVALID [default]: 0 measured round(s) with a span >= 30 s (need rounds 2 and 3)

Free driving is seconds 8–17 of the round, the rim is seconds 20–59; a median
or a maximum below is over that window's **per-second** series, so "20.3 ms"
is the worst *second*, not the worst frame (`compare.txt` header).

| arm | sparks | free ms | rim ms (worst second) | rim − free | rim draws (worst second) | rim pre − free pre | rim render − free render |
|---|---|---|---|---|---|---|---|
| `task3-mechanisms/grind` | on | 11.15 | **17.15** (20.3) | **+6.0** | 113.34 (171.24) | +3.5 | **+2.45** |
| `task3-mechanisms/grind-r2` | on | 11.4 | **14.0** (18.3) | **+2.6** | 60.0 (173.59) | +2.55 | +0.2 |
| `grind-nosparks-r1` | off | 10.5 | **13.1** (13.8) | **+2.6** | 60.0 (60.0) | +2.5 | +0.15 |
| `grind-nosparks-r2` | off | 10.7 | **13.65** (15.0) | **+2.95** | 60.0 (60.0) | +2.6 | +0.3 |

**The draw count is the cleanest reading.** Counting whole seconds 20–59 of
each run's round: with sparks on, **40 of 80 rim seconds draw more than 60
calls per frame** (29 of 40 in `grind`, 11 of 40 in `grind-r2`; 27 of them at
100 or more). With sparks off, **0 of 80** — the draws/frame series is the
literal integer 60 in every one of the 80 seconds, minimum and maximum alike.
Sixty is what this scene costs with the cycle parked at the rim — free driving
in the same round reads 53.0, with sparks and without, so that step is not
sparks either — and everything above 60 was.

**What that is worth in milliseconds.** In `grind` — the arm whose cycle
actually sat sparking for most of its window — the median rim second falls
**17.15 → 13.1 ms (−23.6 %)** and the worst rim second **20.3 → 13.8
(−32.0 %)**; subtracting the 0.65 ms the two days differ by in the free
window, −20.6 % and −29.8 %. In `grind-r2`, which sparked in only 11 of its 40
rim seconds, the median second falls just 14.0 → 13.65 (−2.5 %) but the worst
falls 18.3 → 15.0 (−18.0 %). So *"about a quarter of the frame"* is the price
of a cycle that is sparking, and the honest range over these four runs is
**2.5 % of a median second to 32 % of a worst one**. It is also the
*variance*: the two stock arms disagree by 3.15 ms at the median (17.15 vs
14.0) and the two spark-free ones by 0.55 (13.1 vs 13.65).

**Mechanism 2 is untouched, exactly as Task 3 predicted.** The part of the
frame before its first draw call still rises by the same amount when the cycle
reaches the wall: **+3.5 and +2.55 ms with sparks, +2.5 and +2.6 without**
(free 5.8–5.95 → rim 8.3–9.4). The +26 % simulation cost of being at a wall is
not a spark and no setting here removes it.

**The render part is where the sparks were — and it tracks how much of the
window actually sparked, not the setting.** Rim render minus free render is
**+2.45 ms** in `grind`, whose cycle sparked in 29 of its 40 rim seconds, and
**+0.15 / +0.3** in the two spark-free arms — but it is **+0.2** in
`grind-r2`, which had sparks *on* and sparked in only 11 of 40. That is the
honest four-run picture: an arm that barely sparks pays what a spark-free arm
pays, so the on/off split is not as clean as two of the four runs alone would
make it look, and the quantity that predicts the render cost is the number of
sparking seconds. Where the shower is continuous it costs 2.45 ms of render;
where there is no shower at all, rendering a cycle pressed against a wall
costs what rendering a cycle in the open costs. `grind-nosparks-r1`'s render
series over its 40 rim seconds sits at 4.5–5.2 ms against `grind`'s 5.5–10.3
(`compare.txt`, "GRIND per-second detail").

**And it is visible.** `grind-nosparks-r1/g-24s-grinding.png` is the same
second of the same arm as Task 3's `grind/g-24s-grinding.png`, which the Task 3
README cites for its *"spark shower at the cycle's front wheel"*. The two
pictures agree in every respect the HUD reports — rubber gauge **1.5**, Speed
**15.0**, `Enemies: 0 Friends: 1`, the cycle against the same rim under the
same tutorial hint — and differ in two things: the shower is gone, and the
game's own FPS counter reads **57** with sparks and **75** without. That
counter is one frame's reading on two different days, so it corroborates the
per-second numbers above rather than adding to them.
`grind-nosparks-r2/g-24s-grinding.png` is the second run's.

## 3. The end-of-round spikes: they were AI sparks

Five runs of Task 2's baseline arm plus `SPARKS 0`, ten measured rounds, all
VALID:

    VALID [default]: 2 rounds at cpu 6x; late ms p50 24.7/25; late draws/frame 113.79/114.15
    (floor 18.05); spans 0.53-59.11 s/0.53-59.12 s; late shots r2-50s / r3-50s; swaps finish 12050 / flush 0

A **spike round** is Task 2's definition: the peak of the per-second
`draws_per_frame` series over whole seconds 10–58 reaches 200 or more.
Counting the twenty measured rounds of the two sets:

| | spike rounds | peak draws/frame, range over rounds | seconds at ≥ 150 draws |
|---|---|---|---|
| Task 2 base, sparks on | **3 of 10** (in 2 of 5 runs) | 112.7–510.6 | 0, 0, 0, 0, 0, 0, 0, 13, 13, 13 |
| `tut-nosparks`, sparks off | **0 of 10** (in 0 of 5 runs) | 114.7–118.0 | 0 in all ten |

The ten spark-free peaks (114.7–118.0) sit inside the seven flat Task 2 peaks
(112.7–119.2). **The binomial sentence, honestly:** if the per-round spike
rate were unchanged at 3 in 10, the chance of seeing none in ten rounds is
0.7¹⁰ ≈ **0.028**. But rounds are not independent — two rounds share a run,
and Task 2's `base-r4` spiked in both of its — so the run-level figure is the
fairer one: 2 of 5 runs spiked, and 0.6⁵ ≈ **0.078**. Neither is proof; both
say the same thing, and the mechanism (§1: sparks are draw calls, and the end
of a round is when seven AIs are grinding each other's walls) says which way
to read it.

**Sparks cost nothing when nobody grinds.** Comparing flat rounds with flat
rounds — Task 2's seven, against all ten spark-free ones — the late five
seconds are the same window:

| late 5 s | Task 2 flat (n = 7) | `tut-nosparks` (n = 10) |
|---|---|---|
| `ms_p50` | 25.8 (24.5–28.0) | 25.0 (24.3–26.4) |
| `ms_p90` | 34.5 (30.8–36.8) | 31.35 (29.4–34.2) |
| pre-draw p50 | 8.8 (8.1–9.3) | 8.35 (8.1–8.7) |
| render p50 | 16.7 (15.4–18.7) | 16.6 (15.7–17.5) |
| draws/frame | 112.72 | 113.17 |
| hitches > 50 ms | 7 (2–9) | 4.5 (2–9) |

Every one of those differences is inside the ±4 ms run-to-run spread
`../README.md` §1.4 warns about, and the draw count is *higher* without
sparks. A round in which the human drives straight and nothing grinds costs
the same with the effect and without it.

**The second-45 bump is NOT removed, and it is not supposed to be.** The
per-second median of the pre-draw part over the flat rounds of each set,
seconds 40 to 56:

    second          40    41    42    43    44    45    46    47    48    49    50    51    52    53    54    55    56
    sparks on      7.5   7.2   7.2   7.1   7.2  12.1  13.0  13.1  11.9  11.5  11.2  10.8  10.9  10.9  11.1  11.0   7.8
    sparks off     7.2   7.2   7.2   7.4   7.3  12.2  12.6  12.4  10.8  10.8  10.6  10.6  10.6  10.6  10.6  10.1   7.4

Second 44 → second 45 is 7.2 → 12.1 with sparks and 7.3 → 12.2 without: the
event that `../README.md` §1.2 found in 10 of 10 rounds is **simulation**, it
arrives on time, and turning the effect off does not touch it. Over the same
seconds the render part is flat in both (16.2–17.7 on, 16.4–16.9 off).

**An independent, non-frame-time witness agrees.** `../README.md` §1.5 records
a same-second marker: the sound engine's voice limiter starts cutting
45.45–45.56 s into round 2 of every run, and *how long it stays cutting*
separated Task 2's spike rounds from its flat ones exactly — `stopped` at
56.92 and 56.94 s in the two spike round-2s, at 47.08–47.34 s in the three
flat ones. In all five spark-free runs the limiter starts at 45.46–45.48 s
with 12 voices and **stops at 47.07–47.35 s**: the flat pattern, 5 of 5, from
a signal that has nothing to do with the draw count (`compare.txt`, "THE
SAME-SECOND SOUND MARKER"; every run spends its 16-transition
`se_limiterBudget` exactly, which is why two of the five have no 58.8 s pair).

**So the geometry Task 3 could not identify is identified.** Task 3's
adversarial check refused to call the spike geometry "walls" and noted that
*"`gSparks.cpp`'s own bursts give the same coefficient from a non-wall
source"*. Turning off that non-wall source removes the spikes in 10 of 10
rounds. Mechanism 1's *coefficient* — 24–47 µs per extra draw call — stands
untouched; what changes is the answer to "extra draw calls of what".

## 4. The real path: no effect measured, because nothing grinds there

Two runs of Task 7's `posttut-base` arm plus `SPARKS 0` — the post-tutorial
boot the phone actually plays, `FIRST_USE 0`, live `SP_` settings,
`SP_WALLS_LENGTH -1` — four measured rounds, both VALID under the mode that
checks them:

    VALID [posttut]: 2 rounds at cpu 6x; late ms p50 27.1/25.8; late draws/frame 122.16/122.05
    (floor 18.05); spans 0.53-58.82 s/0.53-58.8 s; late shots r2-50s / r3-50s; swaps finish 12918 /
    flush 0; live in round 2: SP_WALLS_LENGTH -1, SP_SPEED_FACTOR 0, SP_SIZE_FACTOR 6, SP_NUM_AIS 7
    (all as asked); turn binds L["1104"] R["1103"]

| | Task 7 base, sparks on (n = 6 rounds) | `posttut-nosparks`, off (n = 4) |
|---|---|---|
| plateau s15–44 `ms_p50` | 23.3 (22.8–23.65) | 23.625 (23.25–24.4) |
| plateau pre-draw / render | 7.25 / 15.95 | 7.3 / 16.2 |
| plateau draws/frame | 114.0 in all six | 114.0 in all four |
| late `ms_p50` / `ms_p90` | 25.95 / 35.6 | 26.45 / 36.55 |
| late draws/frame | 122.11 | 122.125 |
| hitches > 50 ms | 10 (7–17) | 9.5 (9–11) |
| spike rounds | 0 of 6 | 0 of 4 |

**Nothing moved.** Two of those rows are exactly equal: the plateau draw count
is 114.0 in every one of the ten measured rounds across both arms, and neither
arm has a spike round. On every row that does differ, except the hitch count,
the spark-free arm is fractionally *slower* — plateau 23.3 → 23.625 ms, late
p50 25.95 → 26.45, late p90 35.6 → 36.55, and the late draw count 122.11
against 122.125, close but not identical. Only the hitch count favours it
(10 → 9.5). Every one of those differences is inside Task 7's own
round-to-round spread, and the ones that are not ties point the wrong way for
a win.

The reason is not that sparks are free on this path; it is that **this arm
never produces one**. The human is idle (`../README.md` §5, gap 2), and Task
7's own three confounds say why the AIs do not pile up either: the arena is twice the linear size, the cycles run at
twice the speed, and `CYCLE_RUBBER 1.0` / `CYCLE_DELAY .1` let every cycle turn
at most half as often as the tutorial's forced 5 / 0.05. The base arm spiked in
0 of 6 rounds, so there was nothing here for the setting to remove.

**What this measures, therefore, is a cost — and it is zero.** Turning sparks
off on the real path does not make it slower and does not make it faster in
four rounds. The win measured in §2 and §3 is carried onto that path by the
code, not by this arm: the same two `crash_sparks` guards in
`gCycle::TimestepCore` throw on any path, and `gSpark::Render` costs one draw
call per spark on any path. **The size of the win on the phone's real game,
with a human who turns and AIs that grind, is not measured** — that would need
gap 2 (a human who drives) closed first.

## 5. What ships

A **touch-only** append, already on this branch, gated in a browser both ways
(`gates/README.md` has the full transcripts):

- `applyTouchSparksTuning()` in `web/shell.html`, called from
  `onRuntimeInitialized` right after `applyTouchCameraTuning()` and before
  `main()`, appends `SPARKS 0` to `/data/webdefaults/autoexec.cfg` through
  `Module.FS` when `window.AA_TOUCH` is true. It follows the camera
  precedent exactly, and a throw is logged and swallowed — a failure here is a
  game with sparks in it, never a broken game.
- `?sparks=0` appends `SPARKS 0` on any device; **`?sparks=1` appends `SPARKS 1`
  on any device**, which is how a phone player gets the effect back. Both
  directions *write* — see "the override has to write", below, for why the one
  that first shipped as silence was a defect.
- The touch gate's **T1b** reads the file back through `Module.FS` — what the
  config parser will see, not what the page logged — on the first of the run's
  four boots (the `[SPARKS]` line itself prints on all four, at 286, 56020,
  69036 and 82488 ms):

      [    286ms] [SPARKS] SPARKS 0 written to /data/webdefaults/autoexec.cfg before main() (touch device)
      [SPARKSGATE] T1b sparks-off-on-touch {"read":true,"err":null,"bytes":12746,
        "sparks_lines":1,"ends_with_sparks_0":true,
        "tail":"ROMSPEED 0.2\n\n# appended at runtime by web/shell.html: crash sparks off (touch device)\nSPARKS 0\n",
        "PASS":true}

  `sparks_lines` counts `/^SPARKS\b/gm` and is exactly one, so a double append
  cannot hide behind a last-one-wins parser.
- The desktop gate's **D1** asserts the other half — that nothing arrives
  anywhere else:

      [    278ms] [SPARKS] stock sparks, nothing written
      [SPARKSGATE] D1 desktop-autoexec-untouched {"read":true,"err":null,"bytes":12376,
        "sparks_occurrences":0,
        "tail":"time visitor sees.\nSP_NUM_AIS 3\nSP_AUTO_AIS 0\nSP_LIMIT_ROUNDS 3\n","PASS":true}

  Zero occurrences of `SPARKS` in the file — not the setting, not the comment
  the touch path writes above it. The 370-byte difference (12746 − 12376) is
  the camera block plus the sparks block, both touch-only.

**One consequence worth knowing, and the override has to write.**
`st_LoadConfig` reads the config directory's `autoexec.cfg` **last** — after
`user.cfg`, `settings.cfg` and `default.cfg` (`src/tools/tConfiguration.cpp:992`,
with `user.cfg` at 975) — so the append wins over the game's own Preferences
toggle on every boot: a touch player who switches sparks back on in the menu
gets them for that session, and the next launch turns them off again.
`?sparks=1` is the durable way to keep them — **and it only works because it
writes `SPARKS 1`**. It first shipped writing nothing, on the model of `?cam=1`,
and the maintainer found the hole on his phone: `SPARKS` is a `tConfItem` and
`tConfItemBase::Save()` returns `true` (`tConfiguration.h:296`), so
`st_SaveConfig` puts it in `/persist/var/user.cfg` — right-aligned in a
28-column field by `SaveAll` (`tConfiguration.cpp:473`), i.e.
`"                      SPARKS 0"`. One session with the touch append in effect
is enough. After that, silence is not an override: `user.cfg` is read first and
its `0` stands. The `CAMERA_*` items are `tSettingItem`s, whose `Save()` returns
`false` (`tConfiguration.h:497`), so they never reach `user.cfg` at all — which
is why the camera could get away with the silence that sparks could not.
`gates/README.md` has the run that proves the fix, `T1c`.

**`EXPLOSION` is deliberately untouched.** It is the neighbouring setting in
the same file (`tConfItem<bool> crexp("EXPLOSION", sg_crashExplosion)`,
`gMenus.cpp:517`, over the `extern` at 516 and `gExplosion.cpp`), it is a
plausible second arm, and **it was not measured here**. It should get its own
runs rather than this one's number.

## 6. What the maintainer acts on

1. **Ship it, on touch, as it stands.** It is one config line appended at
   runtime, gated in both directions, reversible per-load with `?sparks=1`,
   and it costs a visual effect that upstream already turns off by default on
   Macs for the same reason. What it buys, measured: a cycle that is grinding
   a wall gets back **about a quarter of its frame** (17.15 → 13.1 ms median
   second in the sparking arm, worst second 20.3 → 13.8, and 40 of 80 rim
   seconds with excess draw calls become 0 of 80), and the end-of-round draw
   spikes go from **3 of 10 rounds to 0 of 10**, while a flat round's late p90
   is unchanged within the run-to-run spread (34.5 → 31.35 ms).
2. **Do not expect it to fix the two things it does not touch.** The
   simulation cost of being at a wall (+26 % of the frame, mechanism 2) is
   unchanged at +2.5 / +2.6 ms of pre-draw with sparks off, and the second-45
   simulation bump still arrives on the same second and reaches the same
   height (second 44 → 45, 7.2 → 12.1 ms with sparks and 7.3 → 12.2 without). If the phone still feels heavy at a wall after
   this, that is the part that is left, and no setting in M6 has moved it.
3. **The unmeasured half is the real game.** Every number above is a desktop
   at a phone's pixel count, and the arm that ran the phone's actual boot path
   showed nothing, because an idle human on a double-size arena never grinds
   (§4). The mechanism carries by code, not by measurement; the size of the
   win on a phone is a claim, not a result.
