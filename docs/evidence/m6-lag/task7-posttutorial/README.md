# M6 option B — the post-tutorial path

**This directory is the instrument and one proving run. The sweep has not been
taken; the Results section below is empty on purpose.**

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

Nothing here decides anything. It builds the arm, its gate and its runner, and
proves them once.

## Files

| | |
|---|---|
| `web/tools/perf/posttut.steps.tmpl` | the template; its header carries the source symbol for every config line and for the menu walk |
| `web/tools/perf/check-arm.mjs --posttut` | the gate; it prints which mode judged the log |
| `web/tools/perf/run-posttut.sh` | the serial runner over the ten arms, one arm at a time if asked |
| `smoke-posttut-base/` | the one proving run (below) |
| `run-log.txt` | the runner's own log: one block per arm with `uptime` before and after and the verdict |

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
not a defect.** `SP_SIZE_FACTOR -3` is a 0.35× arena (`exponent(i) = 2^(i/2)`)
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

## How to run the sweep

```sh
python3 -m http.server 8007 --directory web/dist-m1 &
AA_PERF_PORT=8007 sh web/tools/perf/run-posttut.sh                   # all ten, in order
AA_PERF_PORT=8007 sh web/tools/perf/run-posttut.sh posttut-base-r1   # or one at a time
```

Each arm is about four minutes of wall clock. The runner refuses to start an arm
while a `drive-browser.mjs`, an `em++` or an orphaned `aa-chrome-*` is running,
and records `uptime` around every drive.

## Results

*Not taken yet.* The sweep writes one directory per arm beside
`smoke-posttut-base/`, and its verdicts accumulate in `run-log.txt`. Fill in the
table, the per-arm spread and the comparison against Tasks 2 and 4 here.
