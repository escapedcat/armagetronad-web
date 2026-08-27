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

## Re-check it rather than believing this file

    node docs/evidence/m2-gate/check-transcript.mjs docs/evidence/m2-gate/chrome-console.log
    node docs/evidence/m2-gate/check-transcript.mjs docs/evidence/m2-gate/firefox-console.log

Both exit 0. The script counts completed rounds from `ROUND_WINNER` (not
`NEW_ROUND`), reconstructs the AI team's roster from the `TEAM_*` ladder-log
events, checks the forbidden strings, and checks the positive controls. It is
the arbiter; everything below is a description of what it is checking.

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

## Frame rate

Measured in-page by counting `glFlush`/`glFinish` calls — `rSysDep::SwapGL()`
makes exactly one per rendered frame — over the whole span from round 1's
`NEW_ROUND` to round 3's `ROUND_WINNER`. Full numbers, method and caveats are
in `.superpowers/sdd/2026-08-27-m2-playable/task-8-report.md`.

|  | Chrome | Firefox |
|---|---|---|
| span measured | 39.64 s, 2369 frames | 39.41 s, 2324 frames |
| frames per whole second, median | **60** | **59** |
| frames per whole second, minimum | **53** | **56** |
| worst single frame | 43.8 ms (= 22.8 fps instantaneous) | 41.0 ms (= 24.4 fps instantaneous) |

The game's own HUD counter reads `FPS: 60` in every Chrome screenshot that has
a cockpit in it, and `FPS: 60` in Firefox's `12`. (Firefox's `08` shows a
two-digit value in the high fifties whose second glyph is not crisp enough at
this resolution to read off with confidence, so it is not quoted as a number.)
That counter is a coarse, independent second opinion on the same runs, not the
measurement — the measurement is the table above.
