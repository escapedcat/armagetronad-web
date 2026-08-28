# M2 gate evidence — three complete rounds vs three AIs, Chrome and Firefox

One run per engine, both driven by the same unmodified script
(`gameplay-gate.steps.asrun`, a copy of `web/tools/gameplay-gate.steps` as it
was executed), against `web/dist-m1` built with no `-O` added to
`CLIENT_LDFLAGS` and `ASSERTIONS` still on.

    python3 -m http.server 8000 --directory web/dist-m1 &
    node web/tools/drive-browser.mjs --headed --out /tmp/gate-chrome \
         --script-file web/tools/gameplay-gate.steps
    node web/tools/drive-firefox.mjs          --out /tmp/gate-firefox \
         --script-file web/tools/gameplay-gate.steps

Chrome 152.0.7977.65 (headed, real GPU). Firefox 154.0.1 (headless).
Canvas 1024x768 in both.

## The match these numbers come from is the tutorial match

Read this before quoting any figure below. The gate drives a first-time
visitor's path unmodified, so the match it plays is the one `welcome()` starts
— and `welcome()` (`gArmagetron.cpp:378-395`) temporarily changes six settings
for that one match, restoring them afterwards:

| | during this match | shipped single-player value |
|---|---|---|
| `speedFactor` | -2 | 0 |
| `sizeFactor` | -5 | -3 |
| `wallsLength` | 400 | -1 (unlimited) |
| `sg_rubberCycle` | 5 | 3 |
| `sg_delayCycle` | 0.05 | 0.1 |
| `autoNum` | 0, forced | whatever `SP_AUTO_AIS` says |

It is therefore a slower, smaller, shorter-walled arena than a normal
single-player game: **the frame rates below are tutorial-parameter frame
rates**, and a busier scene would produce lower ones. The ≥30 fps bar is
cleared by a wide margin — the worst whole second of either run is 53 and 56
against a 60 fps cap — so the conclusion survives easily. But do not lift the
number out of here and quote it as "the client runs at 60 fps".

**What `welcome()` does *not* touch is `numAIs` or `limitRounds`.** That is
what keeps the two counts attributable: three opponents is `SP_NUM_AIS 3`
alone, three rounds is `SP_LIMIT_ROUNDS 3` alone. The only setting the tutorial
framing masks is `SP_AUTO_AIS`, and masking it can only work against the gate,
never for it.

## Re-check it rather than believing this file

    node docs/evidence/m2-gate/check-transcript.mjs docs/evidence/m2-gate/chrome-console.log
    node docs/evidence/m2-gate/check-transcript.mjs docs/evidence/m2-gate/firefox-console.log

Both exit 0. The script counts completed rounds from `ROUND_WINNER` (not
`NEW_ROUND`), reconstructs the AI team's roster by replaying the `TEAM_*`
ladder-log events, checks the frame rate against the ≥30 bar (median *and*
minimum), checks the forbidden strings, checks that no `until:` wait expired,
and checks the positive controls. It is the arbiter; everything below is a
description of what it is checking.

### The `.asrun` copy is deliberately stale, and here is what changed

`gameplay-gate.steps.asrun` is the script **exactly as executed** for these
transcripts (`md5 76567cb89e88041761d86b4ef8348004`). It is not updated when
`web/tools/gameplay-gate.steps` is, because then it would stop being a record
of what produced these numbers.

Do not take this list on trust either — run the diff:

    diff docs/evidence/m2-gate/gameplay-gate.steps.asrun web/tools/gameplay-gate.steps

**Exactly one non-comment line differs.** Everything else is comment text:

    diff <(grep -v '^[[:space:]]*#' docs/evidence/m2-gate/gameplay-gate.steps.asrun) \
         <(grep -v '^[[:space:]]*#' web/tools/gameplay-gate.steps)

#### Three things were corrected

1. **Its "WHAT PASSES" header told you to count `TEAM_PLAYER_ADDED` lines per
   round.** That is wrong — see the "three AIs" section below. The header in
   the live script now describes the roster replay instead.
2. **Its per-second bucketing dropped empty seconds** rather than reporting
   them as zero, so a full-second stall would have vanished from the series
   instead of setting the minimum to 0. It did not happen in these runs (every
   second of both windows has frames in it, which the committed series show),
   but the live script now enumerates every whole second explicitly. This is
   the one non-comment line: the `eval:` expression that dumps the frame-rate
   statistics.
3. **Its header said `welcome()` sets `sizeFactor -2`.** It does
   `sizeFactor -= 2` against `sizeFactor`'s own `-3` default, so the value
   during the tutorial match is **−5**, which is what the live script now says.
   The parameters table at the top of this file has always had −5; the `.asrun`
   header is the only place the −2 appears.

#### And one thing was added, plus supporting prose

4. **A `WHAT THIS CONTROL DOES NOT TEST` block** on the WebGL positive
   control, recording that it does not exercise the `glGetError` poll: the
   throwaway canvas is not the game's context, and the step calls `getError()`
   itself to print the code, consuming the error a poll would have read. It
   tests the browser's warning channel and nothing else. (The other channel was
   established separately during review, by injecting the same invalid call on
   the game's live context mid-run, which did produce
   `[GLERR] frame 540 glGetError=0x500`.)

The rest of the added text argues for things this file already says, and none
of it corrects a claim: a paragraph on what `welcome()` does *not* touch
(`numAIs`, `limitRounds`) and why that keeps the two counts attributable; two
more forbidden strings spelled out in the "cleanliness" list (`[GLERR]` and
`until TIMED OUT`); a pointer to `check-transcript.mjs` as the arbiter and as
the reference implementation of the roster replay; the note that
`ROUND_WINNER`'s player list is an independent second census; the comment above
the bucket loop explaining why correction 2 is load-bearing rather than style;
and the phrase "a frame rate measured here is a TUTORIAL-PARAMETER frame rate".

**No correction changes any number or any conclusion in this directory.**
Re-running the *live* script reproduces the same measurements by the same
method, with the second-bucket hole closed.

## Three rounds, and three AIs — how these are counted

**Rounds completed = `[L] ROUND_WINNER` lines.** Not `[L] NEW_ROUND`, which
counts rounds *started*. Each transcript has exactly three, then one
`MATCH_WINNER`. Since `SP_LIMIT_ROUNDS` ships as 10, a match that stops at
three is itself the setting having been read.

**Opponents = the AI team's roster, replayed.** `eTeam`'s ladder-log writers
(`eTeam.cpp:220-224`, on by default) emit `TEAM_CREATED`, `TEAM_DESTROYED`,
`TEAM_PLAYER_ADDED` and `TEAM_PLAYER_REMOVED`. Replaying them into a set gives
`ai_team`'s membership at any instant. Both transcripts give:

```
round 1: ai_team roster = 3 [word, excel, notepad]
round 2: ai_team roster = 3 [word, excel, outlook]
round 3: ai_team roster = 3 [word, excel, outlook]
```

**Do not count `TEAM_PLAYER_ADDED` lines per round.** This is the trap, and an
earlier version of the steps file's own header fell into it. Those writers log
the **delta**, not a census: round 1 logs three adds, round 2 logs one remove
and one add, and round 3 logs **nothing at all**, because its roster was
already correct. Counting adds reports round 3 as having zero opponents.

Two independent cross-checks on the same rosters:

- `ROUND_WINNER <team> <p1> <p2> <p3>` appends the winning team's full
  membership (`gGame.cpp:3944-3946` → `eTeam::WritePlayers`). The AI team won
  all three rounds, so each of those three lines is its own census, and each
  lists three players.
- The HUD's `Enemies: 3 Friends: 1` (`gHud.cpp:238-251, 479`), legible in
  Chrome's `04`, `08`, `12` and Firefox's `08`, `12`.

## What each screenshot actually shows

Numbering is identical in both engines; the `chrome-` and `firefox-` files are
the same moment in the same script.

| file | what is in the frame |
|---|---|
| `01-language-menu` | the language menu, first thing after Play |
| `02-first-setup-menu` | the First Setup menu (Enter chose a language and left) |
| `03-welcome-message` | "Welcome to Armagetron Advanced!" (Escape left First Setup) |
| `04-round1-driving-HUD-shows-enemies` | round 1, 5.5 s after `NEW_ROUND`. Console in both: "Word / Excel / Notepad entered the game.", "Go (round 1 of 3)!". **Chrome** also has the cockpit up: `Enemies: 3 Friends: 1`, `FPS: 60`. **Firefox's 04 has no cockpit in it** — that run was a few hundred ms behind and the frame landed before the HUD was first drawn. Its `Enemies: 3` frames are 08 and 12. The filename describes the intent of the step, and for Firefox's 04 the picture does not match it |
| `05-round1-after-LEFT` | ~1.2 s after one Left press |
| `06-round1-after-RIGHT` | ~1.2 s after one Right press |
| `07-round1-ended` | the frame taken right after `[L] ROUND_WINNER` #1 |
| `08`–`11` | the same four for round 2 (`Go (round 2 of 3)!`). `08` shows `Enemies: 3 Friends: 1` in **both** engines |
| `12`–`15` | the same four for round 3 (`Go (round 3 of 3)!`). `12` shows `Enemies: 3 Friends: 1` and `FPS: 60` in **both** engines |
| `16-after-the-match` | **"Overall Winner: AI team after 3 rounds." / "Match Winner: AI team"** — the match ended at three rounds, which the shipped default of 10 would not have done |
| `17-final-state` | post-match spectator view; an AI cycle (Excel) with its model and trail, HUD `Enemies: 0 Friends: 3` |
| `18-after-deliberate-uncaught-error` | the page AFTER the script deliberately throws. The red failure banner is `web/shell.html:99` doing its job and is **expected in this shot only** |

Nothing in 01–17 is staged or edited. 18 is a deliberate fault; see below.

## The two positive controls at the end of each transcript

Everything after the harness mark `positive-control-deliberate-...` is the
script breaking things on purpose, to establish that the transcript above it
could have shown a problem if there had been one. M1's Firefox transcript was
read as clean when it was merely deaf (`docs/porting/browser-runtime-notes.md`
section 9); these two lines are what stops that happening again.

1. **An invalid `glHint`** on a throwaway canvas — the exact call
   `rScreen.cpp:1099` used to make every menu frame.
   - Chrome: `[browser.warning/rendering] WebGL: INVALID_ENUM: hint: invalid target`
   - Firefox: **nothing.** Firefox 154 emits no `log.entryAdded` for it over
     WebDriver BiDi, with `webgl.max-warnings-per-context` raised and every
     entry level recorded. This is measured, not assumed.
2. **An uncaught `TypeError`** — reported as `[EXCEPTION]` by **both**
   engines. So Firefox's silence in control 1 is specific to WebGL warnings,
   not a dead subscription.

Because of 1, the WebGL claim in the Firefox transcript rests on a third
channel instead: the sampler reads `glGetError()` off the game's own context
every 30th frame and logs a `[GLERR]` line for any non-zero result. Both
engines: **0 non-zero out of 126 (Chrome) and 123 (Firefox) polls.**

## Frame rate (tutorial-parameter — see the caveat at the top)

### What was counted, and why it is the frame rate rather than a proxy for it

Calls to `glFlush`/`glFinish` on the live WebGL context, wrapped from the page
before the module starts. `rSysDep::SwapGL()` (`rSysdep.cpp:747-758`) ends every
rendered frame with exactly one of the two — chosen by `swapMode_`, immediately
before the buffer swap and after the early `!sr_glOut` return — and Emscripten
compiles both to a single method call on the real context
(`_glFlush = () => GLctx.flush()`, `armagetronad.js:14460-14464`).
`grep -rn 'glFlush\|glFinish' src/` finds no other **call** to either anywhere
in the program — the remaining hits are the `rSwapMode` enum
(`rSysdep.h:37-38`), assignments to `swapMode_` (`rScreen.cpp:1029`, `:1069`,
`:1075`) and the two menu entries that let a player choose between them
(`gMenus.cpp:605-606`). So one call through the wrapper is one frame the game
finished drawing. Both are wrapped because `swapMode_` is `glFlush` by default
(`rSysdep.cpp:459`) and `sr_LoadDefaultConfig()` switches it to `glFinish`
(`rScreen.cpp:1029`), which is what the first-use path this script drives
actually runs with.

This replaced M1's estimator, which counted `setTimeout` calls and divided by
two on a theory of two Asyncify yields per frame. The second yield is
`sr_LimitFPS()`'s and only happens when the frame finished *early*
(`rSysdep.cpp:606-614`) — so that estimator silently halved exactly when the
frame rate dropped, which is the one case a gate is about.

**Window:** round 1's `[L] NEW_ROUND` to round 3's `[L] ROUND_WINNER` — the
entire length of the three rounds, not a sampled slice. The same hook
timestamps every `[L] ` line with `performance.now()`, so the round boundaries
are in the same clock as the frame samples. `check-transcript.mjs` then
cross-checks that span against the driver's own wall-clock stamps, which are
recorded outside the page: Chrome 22233 ms → 61874 ms = 39.641 s against a
reported 39.64.

**Cost of measuring:** one `performance.now()` and one array store per frame,
plus one `getError()` every 30th frame. About 62 extra operations a second.

### The numbers

|  | Chrome 152 (headed) | Firefox 154.0.1 (headless) |
|---|---|---|
| span measured | 39.64 s, 2369 frames | 39.41 s, 2324 frames |
| mean | 59.76 fps | 58.97 fps |
| frames per whole second, median | **60** | **59** |
| frames per whole second, minimum | **53** | **56** |
| instantaneous fps: median / p10 / p01 | 59.88 / 55.56 / 50.25 | 58.82 / 50.00 / 38.46 |
| worst single frame | 43.8 ms (= 22.8 fps instantaneous) | 41.0 ms (= 24.4 fps instantaneous) |
| frame interval p50 / p90 / p99 / max | 16.7 / 18.0 / 19.9 / 43.8 ms | 17 / 20 / 26 / 41 ms |

Per round, frames-per-whole-second minimum / median:

|  | round 1 | round 2 | round 3 |
|---|---|---|---|
| Chrome | 53 / 60 | 60 / 60 | 60 / 60 |
| Firefox | 57 / 58 | 58 / 59 | 60 / 60 |

The full per-second series for every window is in the transcripts themselves.
Chrome's overall: `[53,60,60,60,59,60,59,60,…,60,59,61,60]`.

### The caveats, in full

- **These are tutorial-parameter numbers.** See the top of this file. It is the
  most important caveat and the easiest to drop when quoting.
- **Two statistics, because either alone misleads.** `fps_per_second` is frames
  actually completed in each *whole* wall-clock second — "the frame rate" in the
  sense a player means, and what the ≥30 bar is judged on. `inst_fps` is
  percentiles of `1000/(gap between consecutive frames)`; its `min` is the single
  worst frame in the run, which one 44 ms hitch anywhere sets.
- **A bucket occasionally reads `61`.** That is bucket-boundary rounding in a
  fixed 1000 ms histogram at a 59.9 fps mean, not the `MAX_FPS 60` cap being
  exceeded.
- **The last, partial second of each window is dropped** rather than reported as
  a dip.
- **"≥30 fps" is read here as a rate, not as a bound on any single frame.** Read
  the other way — no frame ever taking longer than 33 ms — *neither* browser
  meets it, and it is doubtful any browser build would. Both readings are in the
  table above; apply your own. The only figures below 30 anywhere are the worst
  single frames, one per engine, both in round 1, both consistent with
  first-round arena and texture work.

The game's own HUD counter is a coarse, independent second opinion on the same
runs — not the measurement, which is the table above. Of the Chrome shots read
off individually, it is `FPS: 60` in `04`, `06`, `08`, `12` and `17`, and
**`FPS: 59` in `05`**. (An earlier revision of this file said "60 in every
Chrome screenshot with a cockpit", which was both off by one and an
exhaustive-sounding claim about frames nobody had checked one by one; the
59 is a normal sample of a series whose median is 60 and whose minimum whole
second is 53, not an anomaly.) In Firefox, `12` reads `FPS: 60`; `08` shows a
two-digit value in the high fifties whose second glyph is not crisp enough at
this resolution to read off with confidence, so it is not quoted as a number.
