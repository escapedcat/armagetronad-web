# M8 — cheap sparks: the shower back on the phone, at the price of none

Chrome device emulation on a 10-core desktop, CPU throttled 6×, the M6 rig
(`web/tools/perf/`). Four arms of one new template, then the page's gates on the
rebuilt client. Everything quoted is in a committed file in this directory.

## Why a new arm

The M6 grind arm (`grind.steps.tmpl`) drives the cycle head-on into the rim and
holds it there. Its first M8 sweep — four arms, `SPARKS 1` explicit — showed
**draws flat at 60 for all forty rim seconds and not one spark**, because
`gCycle::Timestep`'s spark condition is `fabs(skew) < fabs(lr*.8)` with
`lr = (fl.hit-fr.hit)/extension`, the asymmetry of the two side sensors, and
head-on they are equal. (The M6 grind runs that did spark did so when the cycle
slid along the rim by accident, which is why one sparked in 29 rim seconds and
its rerun in 11.) Those four runs are not committed; they measured nothing.

`hug.steps.tmpl` is the grind arm with one `key:Left:1` at ~20.3 s, two seconds
after contact: the cycle turns while it touches the wall and then drives along
it with the wall on its right, `lr ≈ 1`, both spark blocks firing every frame,
the wall's own acceleration taking the speed up — until the corner, where it is
head-on again and the sparks stop; the stall at ~60 s ends the round as before.
Same 4th-argument config as the grind arm (`SP_SIZE_FACTOR 0`, `SP_NUM_AIS 0`,
`CYCLE_RUBBER_TIME 0.1`, `TIMESTEP_MAX 10`) plus the arm's sparks lines, which
come after the page's own and therefore win. `steps.txt` in each arm is the
script as run, `console.log` the transcript with the `[PERF]` JSON at the end,
`<arm>-runner.txt` run-arm.sh's stdout (check-arm.mjs says INVALID by design:
an arm with no AI has one round, as the M6 grind README explains).

## The arms

| arm | sparks lines appended |
|---|---|
| `hug-stock` | `SPARKS 1`, `SPARKS_LIFETIME 4`, `SPARKS_INTERVAL 0` (the upstream behaviour, written out) |
| `hug-cheap` | `SPARKS 1`, `SPARKS_LIFETIME 1`, `SPARKS_INTERVAL 0.05` (what the page ships on touch) |
| `hug-cheaper` | `SPARKS 1`, `SPARKS_LIFETIME 0.6`, `SPARKS_INTERVAL 0.1` |
| `hug-off` | `SPARKS 0` (what M6 shipped on touch) |

## Windows (`windows.txt`, from `web/tools/perf/grind-windows.py`)

`before` = round seconds 8–17, throttled free driving; `rim` = seconds 20–59.
`ms` is the frame interval's per-second p50 (median over the window, range in
brackets), `pre` = ms to first draw, `ren` = first draw to swap, `draws` = draw
calls per frame, `worst-frame` = the largest single frame in the window.

```
== hug-stock: cpu 6x, frames 8745, round 1 span 0.53-66.34 s (death 66.34), hitches>50ms 0, per-second entries 69
   before (free)   10s  ms  9.35 (9.1-10.4)  pre  5.2  ren  4.2  draws   53.0 (52-55)  worst-frame 24.5
   rim, all        40s  ms 13.70 (13.2-25.0)  pre  8.6  ren  4.9  draws   62.0 (62-456)  worst-frame 34.5
   rim, draws<=70  27s  ms 13.60 (13.2-13.9)  pre  8.6  ren  4.9  draws   62.0 (62-62)  worst-frame 34.5
   rim seconds with draws >= 100: 13 of 40;  rim-free = 4.35 ms
== hug-cheap: cpu 6x, frames 8841, round 1 span 0.54-66.35 s (death 66.35), hitches>50ms 0, per-second entries 69
   before (free)   10s  ms 10.20 (10.0-10.7)  pre  5.7  ren  4.5  draws   53.0 (52-55)  worst-frame 14.5
   rim, all        40s  ms 13.45 (12.7-15.5)  pre  8.6  ren  4.9  draws   62.0 (62-73)  worst-frame 30.9
   rim, draws<=70  31s  ms 13.40 (12.7-15.5)  pre  8.6  ren  4.9  draws   62.0 (62-66)  worst-frame 30.9
   rim seconds with draws >= 100: 0 of 40;  rim-free = 3.25 ms
== hug-cheaper: cpu 6x, frames 9180, round 1 span 0.54-66.3 s (death 66.3), hitches>50ms 0, per-second entries 69
   before (free)   10s  ms  9.85 (9.3-10.7)  pre  5.5  ren  4.4  draws   53.0 (52-55)  worst-frame 21.3
   rim, all        40s  ms 12.30 (10.8-13.9)  pre  7.8  ren  4.4  draws   62.0 (60-63)  worst-frame 29.5
   rim, draws<=70  40s  ms 12.30 (10.8-13.9)  pre  7.8  ren  4.4  draws   62.0 (60-63)  worst-frame 29.5
   rim seconds with draws >= 100: 0 of 40;  rim-free = 2.45 ms
== hug-off: cpu 6x, frames 9266, round 1 span 0.53-66.26 s (death 66.26), hitches>50ms 0, per-second entries 69
   before (free)   10s  ms  9.40 (8.9-10.5)  pre  5.2  ren  4.2  draws   53.0 (52-55)  worst-frame 21.4
   rim, all        40s  ms 13.30 (11.1-13.9)  pre  8.5  ren  4.8  draws   62.0 (54-62)  worst-frame 32.4
   rim, draws<=70  40s  ms 13.30 (11.1-13.9)  pre  8.5  ren  4.8  draws   62.0 (54-62)  worst-frame 32.4
   rim seconds with draws >= 100: 0 of 40;  rim-free = 3.90 ms
```

## The seconds that matter: while the sparks fly

Per-second, round seconds 20–40, from the `[PERF]` JSON:

```
stock  draws  111 229 333 415 456 404 387 391 395 364 278 192 109  62  62  62 …
stock  ms    14.4 17.3 22.4 25.0 24.7 23.5 22.6 23.3 24.5 24.2 20.5 17.5 15.3 13.7 13.6 13.4 …
cheap  draws   66  72  72  72  72  72  72  72  73  73  62  62  62  62  62  62 …
cheap  ms    12.7 13.7 13.6 13.9 14.3 12.9 12.8 13.1 13.0 14.3 14.1 14.1 14.6 14.2 13.6 13.5 …
off    ms    (13.3 median over the rim, 11.1–13.9)
```

Stock sparks nearly double the frame while the cycle hugs the wall — 22–25 ms
against 13.6 pressed — and the draw count says why: up to 456 spark objects
drawn in one frame, each its own call (M6 had measured 171 at most; a hug is
worse than a press). Cheap sparks hold the hug at 12.7–14.3 ms with 66–73
draws, which is what **no sparks** costs (13.3, 62). The `cheaper` arm reads
12.30 over the rim, the same within the ~1 ms run-to-run noise the `before`
windows show (9.35 to 10.20 across four identical free-driving spans); the two
settings trade visible density, not cost. `hug-stock/g-24s-grinding.png` and
`hug-cheap/g-24s-grinding.png` are the shower in both, four seconds into the
hug; `g-34s-grinding.png` is after the corner.

## What the code change is

`src/tron/gSparks.cpp`, client-only (`#ifndef DEDICATED`): `SPARKS_LIFETIME`
(seconds, default 4 = upstream) and `SPARKS_INTERVAL` (seconds between spawns,
per cycle since M8.1 — see the last section — default 0 = upstream), and `gSpark::MayCreate(time)`,
which `gCycle.cpp`'s two spawn sites ask. A desktop that sets nothing draws
exactly what it always drew. The dedicated wasm built from the same tree:

    dedicated: 2488298 bytes md5 9718a2a64978cb6e9b95ea2f0454cca5  (pin 2488298 / 9718a2a64978cb6e9b95ea2f0454cca5)

## The page

`web/shell.html`'s `applyTouchSparksTuning` writes the three-line block on a
touch device (`SPARKS 1`, `SPARKS_LIFETIME 1`, `SPARKS_INTERVAL 0.05`) where M6
wrote `SPARKS 0`; `?sparks=1` writes the stock `SPARKS 1` alone, `?sparks=0`
writes `SPARKS 0`. Gates, on the rebuilt client (`gates/`):

Landscape (`--mobile 915,412,3`, `touch-gate.steps`), the two sparks checks
verbatim (tails elided):

    [SPARKSGATE] T1b cheap-sparks-on-touch {"read":true,"err":null,"bytes":12804,"sparks_lines":1,"ends_with_cheap_block":true,"PASS":true}
    [SPARKSGATE] T1c precondition saved-config-holds-sparks-1 {"read":true,"err":null,"bytes":22767,"line":"                      SPARKS 1","value":"1","PASS":true}
    [SPARKSGATE] T1c sparks-0-overrides-the-saved-1 {"save":"saved","autoexec_read":true,"autoexec_bytes":12748,"autoexec_sparks_lines":["SPARKS 0"],"ends_with_sparks_0":true,"live_sparks_in_user_cfg":"0","PASS":true}

T1c is flipped from M6's version: the touch default now saves `SPARKS 1`, so
the override that has to beat the saved value is `?sparks=0` — same defect
class, mirror image. PASS tallies over the three logs: landscape 8 true /
0 false (L1, T1b, T1c ×2, T2b, T3b, T4 ×2; T6 reports `at_least_44px:true`),
desktop 2 / 0 (D1: the shipped file has no SPARKS line — `[SPARKSGATE] D1 desktop-autoexec-untouched {"read":true,"err":null,"bytes":12376,"sparks_occurrences":0,"PASS":true}…`; D2),
portrait 8 / 0 (PB1–PB8). Logs only; nothing visual changed on the page.

## M8.1 — the interval is per cycle (same day)

The first cut's `SPARKS_INTERVAL` was global: one spawn per 50 ms whoever
asked. The maintainer's phone showed the flaw within the hour — sparks on the
AIs' cycles, none on his own. `eGameObject.cpp` steps the grid's objects from
the END of the list (the `Len()-1` loops at lines 848 and 871); the human's
cycle is the first object made and therefore the last one stepped, and three
AIs hugging walls had spent the budget before his turn came, every frame.
`gSpark::MayCreate(time, owner)` now keeps one timestamp per cycle (keyed by
address, compared only, cleared past 256 entries): twenty live spark objects
per grinding cycle, eighty if four grind at once, against the ~480 the stock
rules give a single cycle. The single-cycle arm, re-run on the rebuilt client
(`hug-cheap-percycle/`), reads the same as the first cut:

```
== hug-cheap-percycle: cpu 6x, frames 8979, round 1 span 0.53-66.27 s (death 66.27), hitches>50ms 0, per-second entries 69
   before (free)   10s  ms  9.90 (9.7-10.2)  pre  5.5  ren  4.3  draws   53.0 (52-55)  worst-frame 26.1
   rim, all        40s  ms 13.00 (12.3-14.6)  pre  8.4  ren  4.8  draws   62.0 (62-72)  worst-frame 34.6
   rim, draws<=70  31s  ms 13.30 (12.3-14.6)  pre  8.5  ren  4.7  draws   62.0 (62-68)  worst-frame 34.6
   rim seconds with draws >= 100: 0 of 40;  rim-free = 3.10 ms
```

The dedicated wasm built from the same tree is still the pin
(2488298 bytes, md5 9718a2a64978cb6e9b95ea2f0454cca5). Not measured: four
cycles grinding at once on a phone — the ceiling is arithmetic, not a run.
