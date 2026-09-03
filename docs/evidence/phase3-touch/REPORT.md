# Phase 3 — minimal touch support: report

**Status: complete, committed on `m5-exit`, not deployed.**
The overlay is built, measured playable under Chrome phone emulation, and has
never run on a physical device. Nothing was published; `web/dist-m1` still holds
exactly the five-file release set and `npm run deploy` was not invoked.

## Commits (on `m5-exit`, on top of `d2559d1f`)

| SHA | what |
|---|---|
| `b572fcfe` | **Step 1, the gate**: a synthesized `KeyboardEvent` does reach the game. Adds `web/tools/synthetic-key-gate.steps` + evidence. No page or source change. |
| `c52161be` | **Steps 2–3**: the overlay in `web/shell.html`; `--mobile` / `tap:` / `metrics:` in `web/tools/drive-browser.mjs`; `touch-gate.steps`, `touch-portrait-probe.steps`, evidence. |
| `db22a302` | **Step 4, the regression half**: the M4 milestone gate re-run on the rebuilt page, Chrome 22/22 and Firefox 22/22. |
| `ee9023ca` | `PLAN.md` open item 1 closed and handover items 7–10 annotated; `README.md` says built-not-deployed. |

## Step 1: **PASSED**, and it was not close

`new KeyboardEvent(...)` + `dispatchEvent(...)` — `isTrusted: false` throughout —
spends the game's own `uActionTooltip` counters exactly as a real key press does:

| phase | `tip_left` | `tip_right` |
|---|---|---|
| baseline | `0 2 1 1 1` | `0 3 1 1 1` |
| 3x synthetic ArrowLeft at `document` | `0 0 1 1 1` | `0 3 1 1 1` |
| 4x synthetic ArrowRight at the canvas | `0 0 1 1 1` | `0 0 1 1 1` |

`uBindPlayer::DoActivate` decrements those only when the press resolved through
`keymap[]` to that action for player 1 *and* the player's cycle object accepted
and executed the turn. The two counters were spent separately so one run
answered both targets. The menus went the same way: on that boot the only inputs
before `[L] NEW_ROUND` were three dispatched events — Enter, ArrowDown, Enter.

**What has to be set on the event.** Exactly one property is load-bearing:
**`keyCode`**. The path is short — `_SDL_Init` sets `keyboardListeningElement =
document`; `SDL.receiveEvent` pushes the event object into `SDL.events` and
never reads `isTrusted`; `SDL.lookupKeyCodeForEvent` reads `event.keyCode` and
`event.location` and maps through `SDL.keyCodes`, where `37 -> 1104` and
`39 -> 1103` — precisely the keysyms `user.cfg` binds the turn actions to.
**`bubbles: true` is required** for anything dispatched at the canvas, because
the listener is on `document`. `key`, `code`, `which` and `cancelable` were all
set and were *not* individually falsified; `key` is consulted only for the
Backspace/Tab `preventDefault` decision. `defaultPrevented` reads `false` after
dispatch, which is not a failure signal — `receiveEvent` skips `preventDefault`
for `keydown` while `SDL.textInput` is set.

Firefox was **not** measured for this. The same code is in the same generated
`armagetronad.js` and nothing in it is Chrome-specific, but that is an argument.

## What I built

**All of it is `web/shell.html`. No C++ was changed.** Six keys:

- **Turn left / turn right = the left and right HALVES of the viewport**, full
  height, transparent but for one faint chevron each. Justification: the whole
  game is two actions, so the correct target is the largest one available — a
  player steering at 30 units/s should never have to look at or aim for a
  control; in landscape both halves are already under a thumb; and the mapping
  needs no explaining. Discrete buttons would be smaller targets bought with
  nothing.
- **A four-button strip at the top centre** — `ArrowUp`, `ArrowDown`, `Enter`,
  `Escape` — on its own dark backdrop. The top centre is the one region a
  steering hand cannot reach by accident, and the one band of this game's screen
  that never holds anything the player must act on (the HUD is along the
  bottom). The backdrop is legibility, not decoration: the first gate run put
  four translucent rectangles across the words "Language Settings".

Enabled by `(hover: none) and (pointer: coarse)`, with `?touch=1` / `?touch=0`
overrides and one machine-readable `[TOUCH] enabled=...` line. On a desktop both
overlay roots keep `hidden` and no listener is registered.

Orientation is a **prompt**: portrait raises a full-screen "turn your phone
sideways" (over the loading overlay, so it is useful while the wasm downloads),
and a rotation after load raises a chip saying the picture is being stretched
from the size it loaded at, with a Reload button.

Two page-only changes that are not cosmetic: a **`<meta name="viewport">`**
(without it Android Chrome lays the page out against a ~980 px virtual viewport,
so the sizing block would size a window that does not exist) and a **second
`width:` on `#canvas` using `100dvh`** (on a phone `100vh` is the large viewport
while the sizing block reads the small one; a second declaration degrades
safely, an edit to the first would not).

**Where I went one key past the brief, and why.** The brief said arrows and
Enter, and it is right about getting *in*: measured, the first-run flow is
Enter, Enter, Enter, because "Accept" is First Setup's pre-selected top item and
every menu on the route to a round carries its own Exit/Back item. The gap is
getting *out*: `Escape` is `INGAME_MENU` and there is no other way to leave a
running match. It costs one button, and the footgun it adds (Escape at the main
menu is Exit Game) is a faster path to a hazard already on screen as a menu
item. No brake, no camera, no chat, no settings; `f` and the unbound camera
actions were left alone.

## What I measured

**Under Chrome device emulation at 915x412 CSS px, dpr 3, with REAL taps** —
`Input.dispatchTouchEvent`, `isTrusted: true`, so the only synthetic thing in
the run is the `KeyboardEvent` under test.

- **The whole first-run flow by tapping**, with no `key:` step anywhere in the
  script: language menu → First Setup → welcome message → `[L] NEW_ROUND`.
- **Steering by tapping the halves**: `tip_left` 2 → 0 from three taps on the
  left half; `tip_right` 3 → 0 from four taps on the right half.
- **Canvas sizing at a phone aspect**, checked for the first time: 2745x1236 =
  **3.39 Mpx**, CSS 915x412 — a 1:1 fit with nothing scaled.
- **Frame rate at 3.39 Mpx**: median **60.24 fps**, p50 frame time **16.6 ms**,
  worst whole second **53 fps**, mean 57.74 over 7.07 s, **0 GL errors in 69
  polls**. Sampled by the counter copied verbatim from
  `fps-resolution-probe.steps`.
- **Orientation, as a table**: loaded in portrait → 1236x2745 backing store,
  prompt shown; rotated to landscape → still 1236x2745, CSS **186x412** (a
  sliver), chip shown; tap Reload → 2745x1236, no chip.
- **Desktop regression**: the M4 milestone gate on the rebuilt page,
  **Chrome 22/22, Firefox 22/22**, both opening `[TOUCH] enabled=false`.
- **The byte tripwire, forced** (outputs deleted so Make could not
  short-circuit): **2,488,298 bytes**, md5
  **`9718a2a64978cb6e9b95ea2f0454cca5`**. That a page change cannot touch it is
  *structural*, not assumed — the dedicated `em++` line contains no
  `--shell-file` and `web/shell.html` is in no `dedicated` prerequisite.
  `check-publish-set.mjs` passes; `-O2 -sASSERTIONS=1` untouched.

**Emulation is not a device**, and the frame rate especially must not be read as
one. It gives the viewport, the device pixel ratio and touch events, and nothing
about phone GPU throughput, memory, thermals or Android Chrome's compositor. An
M1 Max rendering 3.4 Mpx is not a phone rendering 3.4 Mpx — and because this
port's per-frame cost is the CPU side of `-sLEGACY_GL_EMULATION`'s
immediate-mode translation rather than fill, **a phone's single-thread CPU is
exactly the axis still unmeasured**. The sample is also one round, 7.07 s, 408
frames, and it is the lighter *tutorial* match.

## What a real device would still have to confirm

1. Frame rate and thermal behaviour on an actual Android phone.
2. Memory: ~27 MB of drawing buffer at dpr 3 (colour+depth+stencil with
   `preserveDrawingBuffer`) on top of a 4.33 MB wasm, on a device that kills tabs.
3. That a finger behaves like `Input.dispatchTouchEvent` — palm rejection,
   multi-touch during a fast left-right-left, and Android's edge gestures
   (notification pull-down starts exactly where the menu strip is).
4. The URL bar's show/hide behaviour against a page that never scrolls.
5. Whether ~5 MB downloads acceptably over cellular with only "Loading…".
6. Firefox for Android; iOS Safari (reopens the WebKit question).
7. Whether left/right halves are the right ergonomics for someone actually
   holding a phone rather than reasoning about one.

## Was the dispatch wrong anywhere?

Only in one small place, and it is item 10 of the handover rather than the
brief: **"arrows and Enter" is right for reaching a round and not for leaving
one.** Everything else in the dispatch held — including the warning that trust
might matter, which was the right thing to test first even though it came back
negative. Handover item 8 gained two facts it did not have (no viewport meta at
all; `100vh` is the wrong viewport on a phone), and item 9's offer of
`sr_ReinitDisplay` was declined again on the grounds it was declined at M5.
