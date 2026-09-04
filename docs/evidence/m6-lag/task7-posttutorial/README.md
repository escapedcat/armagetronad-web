# M6 option B — the post-tutorial path, measured

**The instrument, its proving run, and the sweep. Ten runs: eight VALID, and
two INVALID because the shipped configuration's rounds last eight seconds —
which is section 2's result, not a defect. Results are at the bottom.**

Every arm of Tasks 1–4 measured the **tutorial match**. `drive-browser.mjs`
boots a fresh browser profile, so `st_FirstUse` is true, so `welcome()`
(`src/tron/gArmagetron.cpp:269`) takes its first-use branch and runs
`sg_SinglePlayerGame()` itself with six settings forced for the duration
(`gArmagetron.cpp:375-395`): `speedFactor = -2`, `autoNum = 0`,
`sizeFactor -= 2`, **`wallsLength = 400`**, `sg_rubberCycle = 5`,
`sg_delayCycle = 0.05`, all restored afterwards. The trail cap is the one that
shapes every render-side number in the milestone: it is why the draw count in
all ten measured rounds plateaus near 107.

The phone plays the other branch. On every launch after the first,
`welcome()` shows a splash and returns (`gArmagetron.cpp:302-350`), `MainMenu()`
runs (`gArmagetron.cpp:911`), the `SP_` settings are live, and the shipped
`SP_WALLS_LENGTH` is **−1** — `wallsLength = -1.0f`, `gGame.cpp:219` —
trails that never expire. `../README.md` §5.1 names that as the milestone's
first gap and §6 option B as the way to close it.

Nothing here decides anything. It builds the arm, its gate and its runner,
proves them once, and then takes the measurement `../README.md` §5.1 said was
missing. The decision stays the maintainer's.

## Files

| | |
|---|---|
| `web/tools/perf/posttut.steps.tmpl` | the template; its header carries the source symbol for every config line and for the menu walk |
| `web/tools/perf/check-arm.mjs --posttut` | the gate; it prints which mode judged the log |
| `web/tools/perf/run-posttut.sh` | the serial runner over the ten arms, one arm at a time if asked |
| `smoke-posttut-base/` | the one proving run (below) |
| `posttut-default-r1..2/`, `posttut-base-r1..3/`, `posttut-walls150-r1..3/`, `posttut-walls400-r1..2/` | the sweep, one directory per run, with `<run>-driver.txt` beside it |
| `run-log.txt` | the runner's own log: one block per arm with `uptime` before and after and the verdict |
| `table.txt` | `summarise.py … --posttut` over this directory: per measured round the early/late windows, the frame-part split and the full per-second series every derived number below is computed from |

## What the template sets, and why

Everything below is prefixed to the arm's own config lines inside the
`autoexec.cfg` patch, so an arm can override any of it by naming it again.

| line | source symbol | why |
|---|---|---|
| `FIRST_USE 0` | `tConfItem<bool> fu("FIRST_USE", st_FirstUse)`, `tConfiguration.cpp:402` | puts `welcome()` on its early-return branch. `st_LoadConfig` reads `autoexec.cfg` **last** (`tConfiguration.cpp:991`), after `user.cfg`, `settings.cfg` and `default.cfg`, and `welcome()` runs after all of it. One wanted side effect of that ordering: `default.cfg` is loaded under `if (st_FirstUse)` at `tConfiguration.cpp:983`, i.e. *before* this line is parsed, so the shipped `default.cfg` (camera keys, `INGAME_MENU` on Escape) still loads exactly as on any boot. |
| `SWAP_MODE 2` | `rSysDep::swapMode_ = rSwap_glFinish`, `rScreen.cpp:1029`; enum value 2 at `rSysdep.h:38`; static default `rSwap_glFlush` = 1 at `rSysdep.cpp:459`; `tConfItem swapModeCI`, `gMenus.cpp:630` | see below |
| `FLOOR_DETAIL 3` | `sr_floorDetail = rFLOOR_TWOTEXTURE`, `rScreen.cpp:1023`; `rFLOOR_TWOTEXTURE` = 3 at `rScreen.h:134`; static default `rFLOOR_TEXTURE` = 2 at `rScreen.cpp:984`; `tConfItem fd`, `gMenus.cpp:169` | see below |
| `TEXT_OUT 1` | `sr_textOut = true`, `rScreen.cpp:1012`; static default `false` at `rScreen.cpp:999`; `tConfItem to`, `gMenus.cpp:164` | see below |
| `KEYBOARD 276 PLAYER_BIND CYCLE_TURN_LEFT 1`<br>`KEYBOARD 275 PLAYER_BIND CYCLE_TURN_RIGHT 1` | `config/keys_cursor.cfg` lines 2–3 verbatim, in the SDL 1.2 numbering the shipped files use; `su_TranslateSDL12Keysym` cases 275/276 at `uInput.cpp:215-216` converts them on read and is idempotent | see below |

**The three render settings are what a returning phone actually has in its
`user.cfg`, and that is the whole reason they are written out.**
`sr_LoadDefaultConfig()` (`rScreen.cpp:1007`) is called from exactly two places:
`welcome()` on the first-use path (`gArmagetron.cpp:296`), and
`lowlevel_sr_InitDisplay` under `software_renderer && !last_software_renderer`
(`rScreen.cpp:854`), which never fires under WebGL. So a first-use boot applies
it and `st_SaveConfig()` writes every `tConfItem` back — which is Task 1's
finding that the shipped client swaps with `glFinish` *only* because `welcome()`
ran (`web/tools/perf/README.md`, "What a frame time contains"). A boot with
`FIRST_USE 0` and no `user.cfg` would apply none of it and would not be
comparable with Tasks 1–4 at all. Three lines and not eleven because three is
how many of the variables that function touches differ from their static
initialisers; the other eight (`sr_alphaBlend`, `sr_useDisplayLists`,
`sr_dither`, `sr_smoothShading`, `sr_floorMirror`, `sr_infinityPlane`,
`sr_lowerSky`, `sr_upperSky`, `sr_keepWindowActive`) and the four texture modes
(`rTexture.cpp:1143` against `rScreen.cpp:1017-1021`) already hold the value it
would assign. Checked one by one against `rScreen.cpp:978-1003`.

**The two turn binds are a hole this path has and the tutorial path does not.**
`keys_cursor.cfg` has exactly one caller, `sg_StartupPlayerMenu`
(`gArmagetron.cpp:257`), and `FIRST_USE 0` skips it — the hazard
`web/webdefaults/autoexec.cfg`'s closing comment records as its own reason for
not setting `FIRST_USE 0`. A real returning visitor ran that menu once and has
the binds in their `user.cfg` (bindings are saved: `tConfItem_key::WriteVal`,
`uInput.cpp:271`), so writing them here is what makes the arm a returning
visitor rather than a visitor with no controls. The probe reports the binds it
finds back, so this is checked every run: the smoke run read
`CYCLE_TURN_LEFT 1104` and `CYCLE_TURN_RIGHT 1103`, the SDL 2 arrow keysyms.

**Deliberately not set:** anything else, and in particular no
`SP_SPEED_FACTOR` and no `SP_SIZE_FACTOR` unless an arm asks for one — the gap
between what the config asked for and what the game is running is the gate's
proof.

## The menu walk

With no tutorial there is no automatic match, so the arm starts one. `uMenu`
draws its items with the **last-added at the top** and starts with that one
selected (`uMenu.cpp:67` sets `selected` huge, `:219` clamps it to
`items.Len()-1`; `YPos(num)` at `:111` puts a higher index higher on screen),
and `SDLK_DOWN` *decrements* the index (`uMenu.cpp:432`). The last item added to
`MainMenu` is `gamemenuitem` (`gGame.cpp:2717`), rendered **Play Game**; the
last added to `game_menu` is `connect` (`gGame.cpp:2553`), rendered
**Multiplayer**; one Down reaches `start` (`gGame.cpp:2549`), rendered **Local
Game**, whose function is `&sg_SinglePlayerGame` — the very function `welcome()`
calls on the tutorial path. Hence **Enter, Down, Enter**, the same walk
`docs/evidence/phase3-touch/synthetic-key-gate.steps.asrun` recorded shot by
shot.

The waits before it are blind, and the template says why: there is no console
marker for "the main menu is up" (`[PERSISTSAVE]` fires on menu *leave*, and the
splash is not a `uMenu` but `welcome()`'s own 6 s event loop, which ends on any
`SDL_KEYDOWN` and then drains the queue — so a key sent early is both early and
eaten). `m0-main-menu.png` is the picture that proves the wait was long enough,
and it is a picture the tutorial path can never produce.

## What `--posttut` proves

It keeps every check the default mode makes — two key presses, the throttle at
the claimed rate before round 2, rounds 2 and 3 with a measured span ≥ 30 s,
≥ 30 frames per late window, late draws/frame above the no-geometry floor by a
quarter, and a second-half screenshot per round on disk — and adds three.

1. **walk** — the harness's own `key`/`tap` lines must contain a `Down` before
   the first `[L] NEW_ROUND`, with an Enter-or-tap on each side of it. The
   tutorial template reaches its match with three taps and **no `Down` at all**.
   The window ends at the `ROUND-1-SETUP-NOT-MEASURED` mark rather than at the
   first `NEW_ROUND`, because the driver records a `key:` step *after* keyUp
   while the game acts on keyDown: in the smoke run the closing Enter is written
   34 ms **after** the `NEW_ROUND` it caused (23187 ms against 23221 ms).
2. **patched** — the recorded `autoexec.cfg patched:` result must contain
   `FIRST_USE 0`, `SWAP_MODE 2`, `FLOOR_DETAIL 3` and `TEXT_OUT 1`.
3. **settings** — the tutorial's forced settings must be **absent while a
   measured round is running**, and this needed a mechanism rather than a grep,
   because nothing the game prints says so. The template's
   `window.__posttut(phase)` calls `Module._aa_web_save_config()`
   (`eWebPersist.cpp:205`, the non-yielding `EMSCRIPTEN_KEEPALIVE` export
   `web/shell.html`'s unload backstop already uses and which
   `synthetic-key-gate.steps.asrun` already calls mid-round), which runs
   `st_SaveConfig()` and serialises every live `tConfItem` to
   `/persist/var/user.cfg`; it then reads that file back through `Module.FS` and
   logs `[POSTTUT] {...}` with the live value beside the value the patched
   `autoexec.cfg` asked for. `SP_WALLS_LENGTH`, `SP_SPEED_FACTOR` and
   `SP_SIZE_FACTOR` are `tConfItem`s on `singlePlayer.*` (`gGame.cpp:601`,
   `:583`, `:584`) and `sg_currentSettings` points **at** `singlePlayer` in a
   single-player game, so they are the very fields `welcome()` assigns. The gate
   requires the probe taken inside round 2 to report live == asked for all
   three. The probe call is bracketed as `r2-probe` so `report.js` drops the
   frames its ~22 KB serialise disturbs (69 ms in the smoke run).

**The gate can fail.** Run it over any Task 1–4 transcript and it reports
INVALID on all three grounds, because those runs are the tutorial match:

```
$ node web/tools/perf/check-arm.mjs --posttut docs/evidence/m6-lag/task1-rig/base/console.log
check-arm.mjs: mode posttut -- the POST-TUTORIAL path (FIRST_USE 0, menu walk, live SP_ settings)
INVALID [posttut]: no menu walk before the first NEW_ROUND: 3 harness input(s), none of them
Down (the tutorial path reaches its match with no Down at all); the patched autoexec.cfg does
not contain "FIRST_USE 0"; ... ; no [POSTTUT] probe line at all (window.__posttut never ran)
```

On a tutorial transcript that *did* carry a probe, the three settings checks
would read −2 against 0, asked-minus-2 against asked, and 400 against −1: three
independent failures, and at least two of them survive even for the
`posttut-walls400` arm, whose asked value happens to be the tutorial's own.

## The shipped `SP_` defaults, read out

`posttut-default` sets no `SP_` override, so it plays whatever the shipped
tree makes. Read from the source and the two config files this build preloads:

| setting | value | where |
|---|---|---|
| `SP_SIZE_FACTOR` | **−3** | `gGameSettings singlePlayer(...)`, `gGame.cpp:518-524`, the `sizeFactor` argument |
| `SP_SPEED_FACTOR` | **0** | same constructor, the `speedFactor` argument |
| `SP_WALLS_LENGTH` | **−1** (unlimited) | `wallsLength = -1.0f` in the constructor body, `gGame.cpp:219` |
| `SP_WALLS_STAY_UP_DELAY` | 2.0 | `gGame.cpp:218` |
| `SP_AI_IQ` | 30 | constructor, `AI_IQ` |
| `SP_MIN_PLAYERS` | 0 | constructor, `minPlayers` |
| `SP_NUM_AIS` | **3** | `web/webdefaults/autoexec.cfg` (overrides the constructor's 1) |
| `SP_AUTO_AIS` | **0** | `web/webdefaults/autoexec.cfg` (overrides the constructor's `true`) |
| `SP_LIMIT_ROUNDS` | **3** | `web/webdefaults/autoexec.cfg` (overrides `config/settings.cfg`'s 10) |
| `SP_SCORE_WIN` / `SP_LIMIT_SCORE` / `SP_LIMIT_TIME` | 10 / 100000 / 30 | `config/settings.cfg:419-422` |

`config/settings_dedicated.cfg` — the file that spells most of these out with
comments — is `--exclude-file`d from the preload by `web/Makefile` and is
`#ifdef DEDICATED` anyway, so none of its values reach this client.

**`posttut-default` is expected to be reported INVALID, and that is a result,
not a defect** — it was, twice, and Results §2 has the round lengths. `SP_SIZE_FACTOR -3` is a 0.35× arena (`exponent(i) = 2^(i/2)`)
and `SP_SPEED_FACTOR 0` is twice the tutorial's −2, so its rounds should be far
under the 30 s span an early-vs-late comparison needs — `run-arm.sh`'s own
header records eight-second rounds at the shipped size factor. The shipped
values are **not** to be changed to make the gate open; record the round
lengths the sweep measures here and leave them alone.

## The arms

All at `MAX_FPS 1000` (from the template) and CPU throttle rate 6.

| arm | runs | extra config lines |
|---|---|---|
| `posttut-default` | 2 | none (a comment line, because `run-arm.sh` requires a non-empty 4th argument) |
| `posttut-base` | 3 | `SP_SIZE_FACTOR 6`, `SP_NUM_AIS 7`, `SP_WALLS_LENGTH -1` |
| `posttut-walls150` | 3 | the same with `SP_WALLS_LENGTH 150` |
| `posttut-walls400` | 2 | the same with `SP_WALLS_LENGTH 400` |

`posttut-base` is Tasks 2/4's scene on the real path — except that here
`SP_SIZE_FACTOR` really is 6 (nothing subtracts 2) and `SP_WALLS_LENGTH` really
is −1 instead of being overwritten with 400. `posttut-walls150` is option A's
cap as a direct setting rather than the `CYCLE_DIST_WALL_SHRINK` pair Task 4 had
to use. `posttut-walls400` ties this path back to Tasks 1–4's numbers.

## The smoke run — `smoke-posttut-base/`

One run of `posttut-base`'s configuration, 2026-09-04 10:58–11:02, this
worktree's `web/dist-m1` on port 8007, Chrome 152.0.7977.77, `--mobile
915,412,3`, cpu 6; load 11.54 before and 10.43 after. It exists to prove the
template, the walk and the gate, **not** to be a datum: n = 1.

`VALID [posttut]` — two measured rounds, spans 0.53–58.82 s and 0.53–58.79 s,
late shots on disk, and the probe reading `SP_WALLS_LENGTH -1`,
`SP_SPEED_FACTOR 0`, `SP_SIZE_FACTOR 6`, `SP_NUM_AIS 7` live inside round 2,
every one of them as asked.

| round | span s | early ms p50 | late ms p50 | ratio_ms | early draws | late draws | ratio_draws | late KB/frame | hitches >50 ms |
|---|---|---|---|---|---|---|---|---|---|
| 1 (setup, throttle switched on inside it) | 0.53–45.46 | 6.8 | 18.0 | 2.65 | 84.4 | 90.0 | 1.07 | 122.2 | 0 |
| 2 | 0.53–58.82 | 21.9 | 26.6 | 1.21 | 103.6 | 122.1 | 1.18 | 179.1 | 7 |
| 3 | 0.53–58.79 | 21.6 | 26.1 | 1.21 | 98.1 | 122.1 | 1.24 | 182.5 | 6 |

Round 1's row is the setup round and is in the table only for the record: the
throttle goes on part-way through it (hence `ratio_ms` 2.65, which is the
throttle and not a growth curve), and the round-1 probe is left unbracketed on
purpose, so its ~70 ms shows up in round 1's `raw_ms_max` series. Neither
touches rounds 2 and 3.

Frame split, round 2: `ms_to_first_draw` 5.9 → 10.5, `ms_first_draw_to_swap`
15.9 → 15.8. Round 3: 5.9 → 9.6 and 15.6 → 16.4. `ms_in_swap` p50 0 in every
window, as everywhere else in this milestone. Rounds 1/2/3 ran 47.4 / 60.8 /
59.8 s and the human died at 45.5 / 58.8 / 58.8 s.

**The draw count does not grow the way the milestone expected it to.** Option B
was framed on the premise that unlimited trails would make the render work grow
through the round instead of sitting at the tutorial's 107. It did not: per
second, round 2's draws/frame climb to 130 in the first five seconds, *fall* to
a plateau of **114** by second 14, sit there flat for thirty seconds, step to
**122** at second 46 and stay, ending at 130. Round 3 has the same shape. That
is the tutorial's shape at a slightly higher level — Task 1's base run
plateaued at 107 and ended its late window at 114 — and the step at second 45-46
lands where Task 2's "event at second 45" does. `kb_per_frame` is the tell:
179.1 and 182.5 in the late windows here against 179.3 and 182.2 in Task 1's
tutorial run, i.e. **the same bytes per frame with the trail cap removed and the
cycles moving twice as fast**. One run, so this is a thing to look at in the
sweep and not a finding; the obvious hypothesis is that what is drawn is bounded
by the view frustum rather than by trail length, and `r2-50s.png` — a huge arena
with the AI trails a long way off at the horizon — is consistent with it.
**The sweep found the same shape in all sixteen of its own measured rounds,
and in these two** (Results §3): the plateau is exactly 114.00 draws per frame
and it does not depend on the trail cap at all. The frustum half of that hypothesis is still
untested — nothing in this task varied the camera or the arena — so what is
established is the negative: trail *length* does not set the draw count.

The screenshot also carries a second, independent, *visible* proof that this is
not the tutorial: the HUD reads **Speed 30.0**, exactly twice the 15.0 every
tutorial round in Tasks 1–4 recorded, because `welcome()`'s `speedFactor = -2`
is not running. And **Enemies: 7**, so `SP_NUM_AIS 7` was honoured with
`SP_AUTO_AIS 0`.

Kept, following Task 2's policy: `console.log`, `steps.txt`, `uptime.txt`,
`r2-50s.png`, `r3-50s.png` and `m0-main-menu.png`. The other eight screenshots
(splash, the two menu-walk pictures, `r1-after-keys`, the 06 s and 30 s shots)
were deleted — 3 MB of PNG the gate does not need and the argument does not use.
The two menu pictures are described above; if the walk ever has to be
re-diagnosed, re-run the arm and look at them before pruning.

## How the sweep was run

Exactly this, on 2026-09-04 between 09:09 and 09:43 UTC, one arm at a time:

```sh
python3 -m http.server 8007 --directory web/dist-m1 &
AA_PERF_PORT=8007 sh web/tools/perf/run-posttut.sh                   # all ten, in order
AA_PERF_PORT=8007 sh web/tools/perf/run-posttut.sh posttut-base-r1   # or one at a time
python3 web/tools/perf/summarise.py \
  docs/evidence/m6-lag/task7-posttutorial --posttut | tee \
  docs/evidence/m6-lag/task7-posttutorial/table.txt
```

Each arm is about four minutes of wall clock. The runner refuses to start an arm
while a `drive-browser.mjs`, an `em++` or an orphaned `aa-chrome-*` is running,
and records `uptime` around every drive.

## Results

Ten runs, 2026-09-04 09:09–09:43 UTC, one arm at a time through
`run-posttut.sh`, on this worktree's `web/dist-m1` served on port 8007; Chrome
**152.0.7977.77** headed at `--mobile 915,412,3`, CPU throttle **6×**,
`MAX_FPS 1000` — stated once here and true of every number below. **These are
one desktop's milliseconds**, throttled, at a phone's pixel count, with a fixed
event-loop yield inside each frame interval that the throttle does not scale
(`web/tools/perf/README.md`, "What a frame time contains"): the ratios and the
per-arm deltas travel, the milliseconds are not a phone's. The 1-minute load
(`uptime.txt`, before and after every run) ran **9.44–27.41** across the sweep,
because a Time Machine backup ran through all of it (the single highest figure,
27.41, was recorded after `posttut-walls150-r2`). The highest load recorded
*before* any run, 25.20, belongs to `posttut-walls150-r3` — the run that then
produced the fastest two rounds of the whole task, 22.6 and 22.4 ms late p50 —
so the load did not order the arms. Every figure is computed from
the `[PERF]` JSON at the end of each run's `console.log`; `table.txt` is
`python3 web/tools/perf/summarise.py docs/evidence/m6-lag/task7-posttutorial
--posttut` over this directory, and nothing here is copied from a report.

### 1. What this path is, and what proves each run was on it

One line per proof, and the file that carries it.

| the claim | what proves it | where |
|---|---|---|
| `welcome()` took its early-return branch — no tutorial, none of its forced settings | there is a main menu, and it had to be walked: an Enter, a **`Down`**, an Enter before the first `[L] NEW_ROUND` (the tutorial template reaches its match with three taps and no `Down` at all) | `m0-main-menu.png` in all ten runs; the `walk` check in `check-arm.mjs --posttut` |
| the three render settings a returning phone really has | the run's own recorded `autoexec.cfg patched:` result contains `FIRST_USE 0`, `SWAP_MODE 2`, `FLOOR_DETAIL 3` and `TEXT_OUT 1` | `steps.txt` and `console.log` of all ten runs; the `patched` check |
| the tutorial's forced settings were **not** running while a round was measured | the probe calls `Module._aa_web_save_config()` mid-round, reads `/persist/var/user.cfg` back and logs each live value beside the asked one: `SP_WALLS_LENGTH`, `SP_SPEED_FACTOR`, `SP_SIZE_FACTOR` and `SP_NUM_AIS` all as asked in **10 of 10** runs (`posttut-default` asks for none of them, so "as asked" there is the shipped default, and it read `-1`, `0`, `-3`, `3`) | the `[POSTTUT] {"phase":"round2-measured",…}` line, logged 6.26–6.42 s into measured round 2 of every run |
| the two turn binds exist on a path that skips `sg_StartupPlayerMenu` | the same probe reads them back out of the saved `user.cfg`: `CYCLE_TURN_LEFT` **1104**, `CYCLE_TURN_RIGHT` **1103**, in **10 of 10** runs | same line, `turn_left_bound` / `turn_right_bound`; `posttut-base-r1/r1-after-keys.png` is round 1 just after the two presses |
| …and one proof that needs no log at all | the HUD reads **Speed 30.0** and **Enemies: 7** — exactly twice the 15.0 of every tutorial round in Tasks 1–4, because `welcome()`'s `speedFactor = -2` is not running | `posttut-base-r1/r2-50s.png` |

The ten verdicts, re-run with `node web/tools/perf/check-arm.mjs --posttut`
**after** the screenshots were trimmed, so they judge exactly what is committed
here (the only difference from `run-log.txt`'s copies is that the `late shots`
list now names the two pictures still on disk):

| run | verdict | late ms p50, rd 2 / 3 | late draws/frame |
|---|---|---|---|
| `posttut-default-r1` | **INVALID**: 0 measured round(s) with a span ≥ 30 s | — | — |
| `posttut-default-r2` | **INVALID**: 0 measured round(s) with a span ≥ 30 s | — | — |
| `posttut-base-r1` | VALID | 25.6 / 26 | 122.15 / 122.09 |
| `posttut-base-r2` | VALID | 25.9 / 26.7 | 122.14 / 122.06 |
| `posttut-base-r3` | VALID | 25.6 / 28.9 | 122.09 / 122.13 |
| `posttut-walls150-r1` | VALID | 23.6 / 24.3 | 114.04 / 114.06 |
| `posttut-walls150-r2` | VALID | 24 / 24.6 | 114.1 / 114.07 |
| `posttut-walls150-r3` | VALID | 22.6 / 22.4 | 114.11 / 114.04 |
| `posttut-walls400-r1` | VALID | 24.5 / 23.8 | 122.05 / 120.02 |
| `posttut-walls400-r2` | VALID | 24.5 / 23.1 | 120.05 / 120.03 |
| `smoke-posttut-base` (the proving run) | VALID | 26.6 / 26.1 | 122.07 / 122.07 |

Sixteen measured rounds in the sweep, plus the smoke run's two. **The smoke run
is reported beside `posttut-base` everywhere below and is in none of its
figures**: it is the run that proved the template, taken before the sweep, and
n = 1.

**"Measured round" means one round the `[PERF]` report measured**, and it is
used twice below with two different populations: the **eighteen** rounds 2 and
3 of the nine valid runs, which every figure in §3 and §4 is computed over, and
the **fourteen** rounds 2–8 of the two `posttut-default` runs, which the report
also measured but which the gate rejects (§2). Where the count matters the
population is named.

In all nine valid runs the same three things happened: three deaths per run,
all of them `web_user`'s (`[L] DEATH_FRAG web_user <ai>`), no AI died in any
measured round (every round-2 and round-3 `ROUND_WINNER` lists all seven), and
the human died **58.79–58.85 s** after `NEW_ROUND` — 58.79–58.82 across
`posttut-base` and the smoke run, with the four latest deaths all in the capped
arms (`walls150-r1` round 3 at 58.85 is the latest).

### 2. The shipped configuration: eight-second rounds, which this rig cannot measure

`posttut-default` overrides nothing, so it plays what the shipped tree makes,
and the probe read that back live in both runs: `SP_SIZE_FACTOR` **−3**,
`SP_SPEED_FACTOR` **0**, `SP_WALLS_LENGTH` **−1**, `SP_NUM_AIS` **3**. That is
a **0.35× arena** (`exponent(i) = pow(2, i/2)`, `gGame.cpp:1296`, applied to
`sizeFactor` at `:1379`) at **twice** the tutorial's cycle speed, with three
AIs.

What the two transcripts measured, from `[L] NEW_ROUND` to `[L] ROUND_WINNER`
and to `[L] DEATH_FRAG web_user`:

| | `posttut-default-r1` | `posttut-default-r2` |
|---|---|---|
| rounds started / with a winner | 9 / 8 | 9 / 8 |
| round length, `NEW_ROUND` → `ROUND_WINNER` | **8.06–8.10 s** (8 rounds) | **8.07–8.12 s** (8 rounds) |
| the idle human's death | **6.54–6.56 s** after `NEW_ROUND`, every round | **6.54–6.60 s**, every round |
| measured span (first world frame → that death) | 0.52–6.56 s, i.e. **≈ 6.0 s** | 0.52–6.60 s |
| `NEW_ROUND` → next `NEW_ROUND` | 12.1 s, except rounds 3 and 6 at 20.2 s (`SP_LIMIT_ROUNDS 3`, the between-match screen) | the same |

All eight shipped rounds of a run put together are 48 s of measured driving;
one `posttut-base` round is 58. **The gate says `INVALID [posttut]: 0 measured
round(s) with a span >= 30 s`, and that is the result**, not a defect: an
early-vs-late comparison needs a round long enough to have an early and a late,
and the shipped configuration does not give one **to an idle human**. The
maintainer's rounds last because he steers; this rig's human drives straight
into the nearest AI wall at speed 30 in an arena a third the size.
`posttut-default-r1/r2-50s.png` is what that looks like — taken 50 s after
measured round 2 began, by which time the game is three rounds further on
("Go (round 2 of 3)!" of the second match): the rim wall is a few cycle lengths
off, two AI trails cross the frame, and the HUD reads Speed 30.0, Enemies: 3.
**The shipped values are not to be changed to open the gate.** They are the
game; the rig is what cannot reach them.

The frames it *did* measure are worth one line, because they are M6's only
picture of the shipped scene. Over the fourteen measured rounds (rounds 2–8 of
both runs): late `ms_p50` **14.4–16.7** (median 15.4), late p90 16.2–20.9,
`ratio_ms` **1.01–1.08** (median 1.04), draws/frame 66.3–70.2,
**102.2–105.1 KB/frame**, and **0–2 hitches over 50 ms in a whole round**. A
small arena with three AIs is a light scene, it does not grow inside eight
seconds, and nothing in it resembles the maintainer's report — which is why the
arms below give it seven AIs and an arena to drive in.

### 3. The base on the real path

`posttut-base` is `SP_SIZE_FACTOR 6`, `SP_NUM_AIS 7`, `SP_WALLS_LENGTH -1`:
Tasks 2 and 4's scene, on the boot path the phone uses, with trails that never
expire. Three runs, and the smoke run beside them.

| run | rd | span s | early ms p50 | late ms p50 | ratio_ms | late p90 | early draws | late draws | ratio_draws | late KB/frame | hitches span / late |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `posttut-base-r1` | 2 | 0.53–58.82 | 21.2 | 25.6 | 1.21 | 35.4 | 102.54 | 122.15 | 1.19 | 178.91 | 9 / 1 |
| `posttut-base-r1` | 3 | 0.53–58.80 | 19.8 | 26.0 | 1.31 | 34.5 | 97.35 | 122.09 | 1.25 | 182.62 | 12 / 2 |
| `posttut-base-r2` | 2 | 0.53–58.81 | 22.2 | 25.9 | 1.17 | 35.8 | 103.13 | 122.14 | 1.18 | 178.92 | 9 / 1 |
| `posttut-base-r2` | 3 | 0.53–58.80 | 21.3 | 26.7 | 1.25 | 37.1 | 97.54 | 122.06 | 1.25 | 182.48 | 7 / 1 |
| `posttut-base-r3` | 2 | 0.54–58.79 | 21.9 | 25.6 | 1.17 | 35.4 | 102.58 | 122.09 | 1.19 | 178.86 | 11 / 2 |
| `posttut-base-r3` | 3 | 0.54–58.80 | 21.4 | 28.9 | 1.35 | 39.3 | 97.88 | 122.13 | 1.25 | 182.54 | 17 / 3 |
| `smoke-posttut-base` † | 2 | 0.53–58.82 | 21.9 | 26.6 | 1.21 | 35.7 | 103.60 | 122.07 | 1.18 | 179.07 | 7 / 2 |
| `smoke-posttut-base` † | 3 | 0.53–58.79 | 21.6 | 26.1 | 1.21 | 34.3 | 98.11 | 122.07 | 1.24 | 182.50 | 6 / 1 |

† the proving run, listed for comparison and counted in no `posttut-base`
figure anywhere below.

`ms_in_swap` p50 is **0 in every window of all eighteen measured rounds** of
the nine valid runs, and the largest single-window maximum among them is
**1.7 ms** (`posttut-walls150-r1` round 2, early); across `posttut-base` and
the smoke run alone it is 1.5, and counting the two INVALID `posttut-default`
runs as well it is 1.8. So no GPU wait hides in these intervals, and every
sampled frame of every run ended in `glFinish`. KB/frame is ~179 in round 2 and ~182 in round 3 **in every arm
of this task**, so a round 2 is only comparable with a round 2.

**The per-second shape: a plateau at 114, and a step at second 46.** Round 2 of
`posttut-base-r1`, draws per frame second by second: 31.5, 82.0, 100.7, 101,
127.7, 129.1 while the AIs enter, a *fall* to 114.2 by second 14, then
**exactly 114.00 in every second from 15 to 44** — thirty consecutive seconds —
then 117.7 at second 45, **122 at second 46**, and 122 held to the end (123.7,
128.1, 130 in the last three seconds, the end-of-round creep Task 2 records
too). The shape is not one run's: **the plateau is exactly 114.00 in every
second from 15 to 44 of all eighteen measured rounds of this task, in all three
arms**, and — counted over the whole seconds 10–57, the same window §4's spike
rule uses — the first second at or above 120 draws is **second 46** in all six
`posttut-base` rounds and both smoke rounds. The window matters: outside it the
count is above 120 in every round of every arm, at second 4 (121.3–129.1) while
the AIs are still entering, and again in the partial seconds after 57 as the
round ends.

Two consequences, pointing opposite ways. Trails that never expire do **not**
make the draw count climb: across those thirty seconds it does not move by a
single call while every cycle's trail grows by 30 units a second. But this path
does have something the tutorial path does not — a **step of +8 draw calls at
second 46 that never comes back down**, where the tutorial's flat rounds step
107 → 111 gradually over seconds 45–50 and end with a late window (the five
seconds before the death) of **111.46–114.82** draws; their last whole second,
58, reads 112.66–119.25.

**Against the tutorial, in one table.** Same seven AIs, same rig, same
throttle; `posttut-base` from this task, `base` from Task 2, `walls400` from
Task 4 — the tutorial arm that asked for the 400-unit cap the tutorial forces
anyway, so it is the same scene twice.

| | `posttut-base` (this path) | (`smoke`, n=1) | Task 2 `base` (tutorial) | Task 4 `walls400` (tutorial) |
|---|---|---|---|---|
| rounds / runs | 6 / 3 | 2 / 1 | 10 / 5 | 6 / 3 |
| `SP_WALLS_LENGTH` in force | **−1, unlimited** | −1 | 400 (forced by `welcome()`) | 400 (asked for, and forced) |
| cycle speed multiplier | **1.0** (HUD 30.0) | 1.0 | 0.5 (HUD 15.0) | 0.5 |
| arena size multiplier | **8** (`SP_SIZE_FACTOR` 6) | 8 | 4 (6 − 2) | 4 |
| `CYCLE_RUBBER` / `CYCLE_DELAY` | **1.0 / 0.1 s** (shipped) | 1.0 / 0.1 | 5 / 0.05 s (forced by `welcome()`) | 5 / 0.05 |
| plateau draws/frame, s15–44 | **114.0** in 6 of 6 | 114.0 | **107.0** in 10 of 10 | **107.0** in 6 of 6 |
| plateau ms p50, s15–44 | 22.80–23.65 (23.30) | 22.60, 23.65 | 22.40–25.35 (23.675) | 21.70–24.70 (22.525) |
| plateau `ms_to_first_draw` | 7.20–7.30 (7.25) | 7.15, 7.35 | 6.95–7.55 (7.20) | 6.70–7.35 (6.975) |
| plateau `ms_first_draw_to_swap` | 15.70–16.15 (15.95) | 15.50, 16.20 | 15.40–17.60 (16.35) | 14.90–17.20 (15.575) |
| early ms p50 | 19.8–22.2 (21.35) | 21.6, 21.9 | 20.6–24.3 (22.55) | 20.5–23.1 (21.6) |
| late ms p50 | 25.6–28.9 (25.95) | 26.1, 26.6 | 24.5–36.1 (27.2) | 24.7–32.1 (26.0) |
| late ms p90 | 34.5–39.3 (35.6) | 34.3, 35.7 | 30.8–46.4 (35.35) | 30.7–40.6 (33.05) |
| `ratio_ms` | 1.17–1.35 (1.23) | 1.21, 1.21 | 1.04–1.63 (1.19) | 1.15–1.57 (1.16) |
| late draws/frame | 122.06–122.15 | 122.07 | 111.46–355.66 (113.525) | 113.35–255.77 (114.22) |
| late KB/frame, rd 2 / rd 3 | 178.86–178.92 / 182.48–182.62 | 179.07 / 182.50 | 179.38–273.99 / 181.59–229.34 | 179.15–234.01 / 181.95–237.98 |
| second-45 bump length, s (window below) | 11–13 (**12**) | 12, 13 | 11–14 (11) | 11–12 (11) |
| draw-spike rounds (≥ 200 draws in one whole second from 10 on) | **0 of 6** | 0 of 2 | 3 of 10 | 2 of 6 |
| hitches > 50 ms per span | 7–17 (10) | 6, 7 | 2–42 (8) | 2–10 (6) |

Ranges are min–max over that arm's measured rounds, median in parentheses; the
tutorial columns' wide late figures are the three and two draw-spike rounds
inside them. **Two printing rules hold for every table in this document.** A
median that falls exactly halfway between two recorded values is printed with
one more decimal than the values themselves rather than rounded onto one side
of the tie (so 23.675, not 23.67 or 23.68); this is Task 4's rule for its
`ratio_ms` means, applied here to every column. And **the bump-length window is
each column's own whole seconds**: 45–57 for this task, whose measured spans
end at 58.79–58.85 s, and 45–58 for Tasks 2 and 4, whose spans end at
59.07–59.13 s and whose second 58 is therefore complete. It is the same rule
the spike test uses, and it reproduces Tasks 2 and 4's published bump lengths
exactly (11,11,11,11,11,11,11,12,14,14 and 11,11,11,11,12,12).

**Reading down that table: almost nothing changed.** Removing the trail cap,
doubling the cycle speed and doubling the arena's linear size moved the plateau
frame cost by less than the tutorial's own run-to-run spread (23.30 ms against
23.675 and 22.525), moved the plateau's render part by less than half a
millisecond (15.95 against 16.35 and 15.575), left the plateau's simulation
part where it was (7.25 against 7.20 and 6.975) and moved the plateau draw
count by **+7 calls, 107 → 114**. Where the flat frame is concerned this is the
same scene at the same price. What *did* change is that the second-45 event now
steps the draw count and leaves it stepped, that the bump lasts a median 12 s
instead of 11 — and that **no round on this path spiked**: the draw
excursions that hit 3 of Task 2's 10 rounds (peaks 503, 511 and 393 at second
49) and 2 of Task 4 `walls400`'s 6 (343 and 338) did not happen once in
eighteen rounds here. The `[SND]` marker agrees: the voice limiter starts
cutting **45.43–45.48 s** after `NEW_ROUND` in round 2 of all nine valid runs —
the same second as Tasks 2 and 4's 45.44–45.56 — but *stops* at
**46.69–46.96 s** in all nine, where in Tasks 2 and 4 the three round 2s whose
limiter stayed cutting past 56 s were precisely the three round-2 draw spikes.

**Three confounds to carry from here on**, all of them consequences of the
same `welcome()` block, and the third bears directly on this document's own
causal claim.

1. **Speed.** The cycles run at **twice** the tutorial's speed
   (`SP_SPEED_FACTOR` 0 → multiplier 1.0, HUD 30.0, against −2 → 0.5, HUD
   15.0). A cycle at twice the speed lays trail twice as fast and reaches a
   wall in half the time.
2. **Arena.** It is **twice the linear size** (`SP_SIZE_FACTOR` really is 6
   here → multiplier 8; the tutorial's `sizeFactor -= 2` makes it 4), so four
   times the floor area.
3. **Rubber and turn delay.** `welcome()` also forces `sg_rubberCycle = 5` and
   `sg_delayCycle = 0.05` for the tutorial's duration and restores them after
   (`gArmagetron.cpp`, the block quoted at the top of this file). `FIRST_USE 0`
   skips that block and no arm here sets either, so every post-tutorial round
   ran the **shipped** `CYCLE_RUBBER 1.0` and `CYCLE_DELAY .1`
   (`config/settings.cfg:157` and `:152`, bound to those two variables by
   `nSettingItem` at `gCycleMovement.cpp:329` and `:183`): **a fifth of the
   tutorial's rubber, and twice its minimum time between turns.** Read from
   the source and the shipped config file, not from a probe — the arm's probe
   reports the four `SP_` keys and the two binds, not these. It matters here
   more than the other two, because `CYCLE_DELAY` is a floor on how often any
   cycle, AI or human, can turn, and this document's own reading of the draw
   counts is that **draw calls follow turns**. A path whose cycles may turn
   only half as often is not a neutral place to conclude that trail length
   does not drive the draw count — it is a place where turns themselves are
   rate-limited.

None of the three was varied in this task, so nothing here separates "the
post-tutorial path" from "faster cycles that turn less often in a bigger
arena" — the columns differ by four things at once. What the table does
support is narrower and more useful: **on the configuration the phone boots
into, the flat frame costs what the tutorial's flat frame costs, and its render
part is no worse.**

### 4. The wall-length lever where it is a real setting

`SP_WALLS_LENGTH` is inert in the tutorial match — Task 4 proved it with a
probe that read back the identical 107.0 draws per frame — so Task 4 had to
reach a 150-unit trail through `CYCLE_DIST_WALL_SHRINK`. Here it is one config
line, and the probe reads it back live. Three arms, sixteen measured rounds;
the smoke run's two are beside `posttut-base` and in none of its figures.

| | `posttut-base` (−1) | `posttut-walls400` | `posttut-walls150` | (`smoke`, n=1) |
|---|---|---|---|---|
| rounds / runs | 6 / 3 | 4 / 2 | 6 / 3 | 2 / 1 |
| plateau draws/frame, s15–44 | **114.0** | **114.0** | **114.0** | 114.0 |
| plateau ms p50, s15–44 | 22.80–23.65 (23.30) | 23.35–23.90 (23.825) | 22.45–24.45 (23.05) | 22.60, 23.65 |
| plateau `ms_to_first_draw` | 7.20–7.30 (7.25) | 7.20–7.30 (7.20) | 7.10–7.50 (7.225) | 7.15, 7.35 |
| early ms p50 | 19.8–22.2 (21.35) | 21.7–23.2 (22.25) | 19.8–22.6 (21.6) | 21.6, 21.9 |
| late ms p50 | 25.6–28.9 (**25.95**) | 23.1–24.5 (**24.15**) | 22.4–24.6 (**23.8**) | 26.1, 26.6 |
| late ms p90 | 34.5–39.3 (**35.6**) | 26.3–29.7 (**28.5**) | 24.5–30.5 (**27.05**) | 34.3, 35.7 |
| `ratio_ms` | 1.17–1.35 (**1.23**) | 1.03–1.13 (**1.07**) | 1.07–1.15 (**1.095**) | 1.21, 1.21 |
| late draws/frame | 122.06–122.15 | 120.02–122.05 | 114.04–114.11 | 122.07 |
| late KB/frame, rd 2 (mean) | 178.86–178.92 (**178.90**) | 178.84–178.90 (**178.87**) | 177.78–177.85 (**177.82**) | 179.07 |
| late KB/frame, rd 3 (mean) | 182.48–182.62 (**182.55**) | 182.49–182.53 (**182.51**) | 181.73–181.93 (**181.80**) | 182.50 |
| second-45 bump length, s (45–57) | 11–13 (**12**) | **6** in 4 of 4 | **2** in 6 of 6 | 12, 13 |
| mean `ms_to_first_draw`, s45–55 | 10.43–13.20 (10.73) | 9.25–10.23 (9.595) | 7.79–8.34 (8.02) | 10.30, 10.89 |
| first second ≥ 120 draws, s10–57 | **s46**, 6 of 6 | **s51**, 4 of 4 | never, 6 of 6 | s46, 2 of 2 |
| draw-spike rounds | 0 of 6 | 0 of 4 | 0 of 6 | 0 of 2 |
| hitches > 50 ms per span | 7–17 (10) | 6–11 (6) | 2–6 (5) | 6, 7 |

Definitions are Task 4's, unchanged, so the two tasks' rows mean the same
thing: *plateau* = the median over seconds 15–44 of that round's per-second
series; *bump length* = the count of that round's **whole** seconds from 45 on
whose `ms_to_first_draw_p50` exceeds its own seconds-15–44 median by more than
2 ms — 45–57 here, 45–58 in Tasks 2 and 4, for the reason given under the
previous table; *mean s45–55* = the arithmetic mean of those eleven per-second
values; a *draw spike* = the maximum `draws_per_frame` over that round's whole
seconds from 10 on — 10–57 here, 10–58 in Tasks 2 and 4, the same per-column
window as the bump — reaching ≥ 200. Recomputing that spike rule over
Tasks 2 and 4 reproduces their published counts exactly — `base` 3 of 10 with
peaks 503, 511 and 393 at second 49, `walls400` 2 of 6, `walls150` 1 of 6 with
a 6-second spike, `nomirror` 0 of 6, `fps30` 1 of 4 — which is why it can be
carried over here. It reproduces Task 4's *mistake* case too: reading to
`measured_to_s` instead of to the last whole second flags `base-r2` round 2 and
`walls150-r3` round 2 on their partial final second alone, which are the two
rounds `task4-levers/README.md` names for exactly that reason. This task's
spans end at 58.79–58.85 s, so its last whole second is 57, where Tasks 2 and
4's spans end at 59.07–59.13 s and theirs is 58.

One printing note, following Task 4's: `posttut-walls150`'s median `ratio_ms`
is **1.095**, the midpoint of two two-decimal per-round values, so it is
printed to three decimals rather than rounded onto one side of a tie. No two
arms of this task tie at two decimals in any column.

**The deltas, against the spread that has to swallow them.** `posttut-base`'s
own six rounds range 3.3 ms in late `ms_p50`, 4.8 ms in late p90, 0.18 in
`ratio_ms` and 0.85 ms in the plateau; Task 2's run-to-run spread of the
*level* was about 4 ms. Median deltas from `posttut-base`:

| | Δ `walls400` | Δ `walls150` | `posttut-base`'s own round-to-round range |
|---|---|---|---|
| late ms p50 | −1.80 | −2.15 | 3.3 |
| late ms p90 | −7.10 | −8.55 | 4.8 |
| `ratio_ms` | −0.160 | −0.135 | 0.18 |
| plateau ms p50 | +0.525 | −0.25 | 0.85 |
| bump length, s (45–57) | −6 | −10 | 2 |
| mean `ms_to_first_draw` s45–55 | −1.135 | −2.710 | 2.77 |
| late draws/frame | −2.070 | −8.045 | 0.09 |
| late KB/frame, rd 2 | −0.03 | −1.08 | 0.06 |

Those rows fall into three groups. **The non-result** is the plateau: **no cap
changed the flat cost of a frame** in either direction, exactly as Task 4 found
on the tutorial path. **The two results** clear the spread by a wide margin —
the **late p90** (−8.55 ms against a 4.8 ms spread; the capped arms' worst
frames beat the uncapped arm's *typical* worst frames) and the **bump length**,
which is disjoint across all three arms with no overlap whatever: 11–13 s
uncapped, exactly 6 s in every `walls400` round, exactly 2 s in every
`walls150` round. **The two that have to be stated carefully** are the late
`ms_p50` delta (−2.15 ms) and the `ratio_ms` delta (−0.135): both are
*smaller* than the base
arm's own round-to-round range, so by Task 4's rule neither is a result on its
own — but the two sets do not overlap. All six `posttut-base` rounds are at or
above 25.6 ms and all ten capped rounds at or below 24.6 (the smoke run's 26.1
and 26.6 fall with the uncapped six), and the same clean separation holds for
p90 (34.5 minimum uncapped against 30.5 maximum capped) and for `ratio_ms`
(1.17 against 1.15).

**`walls400` against `walls150` is a narrower question, and the answer differs
by column.** In the late-window millisecond columns they are not separable:
0.35 ms of median late `ms_p50` apart, and their ranges overlap in `ms_p50`
(23.1–24.5 against 22.4–24.6), p90 (26.3–29.7 against 24.5–30.5) and
`ratio_ms` (1.03–1.13 against 1.07–1.15). But three columns *are* disjoint —
late draws/frame (120.02–122.05 against 114.04–114.11), bump length (6 in every
`walls400` round against 2 in every `walls150` round) and the **mean
`ms_to_first_draw` over seconds 45–55** (9.25–10.23 against 7.79–8.34, a
−1.575 ms median gap). That last one is Task 4's own ranking metric, and its
being disjoint here supports an ordering of the two caps *on the simulation
part during the event* — 150 units costs less pre-draw time in seconds 45–55
than 400 does, in 6 rounds against 4, with no overlap. It does **not** support
a claim that a player would feel the difference: the frame time the player
actually gets, in the window where the two are compared, is the column where
they overlap.

**Draw calls follow turns, not trail length — three independent ways.** First,
the plateau: seconds 15 to 44 read exactly 114.00 draws per frame in all
eighteen rounds of all three arms, while across those thirty seconds a cycle at
speed 30 lays 900 more units of trail under `-1`, is pinned at 400 under
`walls400`, and at 150 under `walls150`. A trail nine times longer costs
**zero** extra draw calls, because a cycle driving straight lays one wall
segment however long it grows, and a segment is not a draw call
(`display-lists-pricing.md`'s fourth correction). Second, the bytes:
`walls150`'s late window carries **1.08 KB/frame less than `posttut-base`'s in
round 2 (177.82 against 178.90) and 0.75 KB less in round 3** — under 1 KB of
179, for two thirds of the visible trail removed, the same result Task 4 got on
the tutorial path through a different setting. Third, the shape of the
difference: it is not a slope but a **step at the second-45 event**, and the cap
moves *when the step arrives*, not how fast anything grows. Counted over the
whole seconds 10–57: 114 → 122 at second 46 with no cap (6 of 6 rounds, and
both smoke rounds), 114 → 120 arriving at second 51 with the 400 cap (4 of 4,
five seconds later), and **never reaching 120 with the 150 cap** (6 of 6).
What the 150 cap does instead is smaller and not uniform: in **4 of its 6
rounds** the count lifts to 116–118.4 for **four or five seconds** inside
seconds 47–51 and is back at 114 by second 53; in the other two
(`walls150-r1` and `-r3`, both round 3) it never exceeds **114.9** after second
44 at all.
**The 400-unit cap and no cap at all draw essentially the same scene** — 2 calls
and 0.03 KB per frame apart — and only the 150-unit cap moves the count, by 8
calls and 1.08 KB.

### 5. The verdict on option B's question

**No: on the path the phone actually plays, trail length is not a cost that
grows with driving time.** For thirty consecutive seconds of every one of the
eighteen measured rounds the draw count is exactly 114.0 per frame and the
frame costs 22.45–24.45 ms — with trails that never expire, at twice the
tutorial's speed — and capping the trail at 400 or at 150 units moves that flat
cost by less than the base arm's own round-to-round spread (+0.525 and −0.25 ms
against 0.85). What a cap does move is the **second-45 event**, the same event
Task 2 found and Task 3 attributed to the simulation — a median 12 s uncapped,
6 s at 400 units and 2 s at 150, with the worst frames coming down with it
(late p90 median 35.6 → 28.5 → 27.05 ms, well clear of the 4.8 ms spread) — so
**the trail cap is worth what Task 4 said it was worth, for the reason Task 4
gave, and option A's "its effect on the path the phone actually plays is
untested" caveat is now tested and survives.**

What this cannot say, and no reading of it should. The human is idle in every
one of these rounds — Task 1's caveat is unchanged: nothing here shows the
cycle ever turned, and a player who turns often adds wall segments, which is
precisely the case where draw calls, following turns, *would* grow. Turning is
also **rate-limited differently here**: these rounds ran the shipped
`CYCLE_DELAY .1` against the tutorial's forced 0.05, so every cycle in them may
turn at most half as often (§3, confound 3). These are
one desktop's milliseconds under a 6× CPU throttle at a phone's pixel count,
not a phone's, and the machine was loaded throughout (1-minute load 9.44–27.41,
a Time Machine backup running the whole time). And n is 6, 4 and 6 rounds from
3, 2 and 3 runs: enough for a bump-length ordering with no overlap, not enough
to rank two capped arms that overlap in every late-window millisecond column
(§4).

### 6. What this changes in the package

`../README.md` §5 item 1 — "the game the phone actually plays" — is no longer a
gap: it now says what the measurement found and links here. §6's options A, B
and C have had their "untested on the real path" caveats replaced by what the
test said, **without choosing between them**, which is still the maintainer's
call. The summary table at the top of that file gains a Task 7 row, and
`PLAN.md`'s M6 paragraph gains one sentence. Nothing else in the package was
rewritten.
