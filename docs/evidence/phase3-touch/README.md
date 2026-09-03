# Phase 3, step 1 — THE GATE: does a JavaScript-synthesized key reach the game?

**Yes. Unambiguously, in Chrome, for both menus and play, and it costs nothing
to arrange.** The whole "zero C++ changes" premise of Phase 3 holds.

Re-run it with:

```sh
python3 -m http.server 8000 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --headed --out /tmp/synkey-chrome \
     --url 'http://localhost:8000/armagetronad.html?autostart=0' \
     --script-file web/tools/synthetic-key-gate.steps
kill %1
```

`--headed` is required, for the reason every key-pressing gate in this repo
needs it (headless Chrome 152 floods the page with spurious keydowns — see the
header of `web/tools/drive-browser.mjs`). Note that the requirement comes from
the gate's *positive control*, which presses real keys; the synthetic presses
this gate is about would be fine headless.

## Why the question was open

`new KeyboardEvent(...)` + `dispatchEvent(...)` produces an event with
`isTrusted: false`. Trust demonstrably matters elsewhere in this port — a
synthetic click is not a user gesture, which is why M4's audio work routed
around it, and why every gate before this one presses keys with CDP's
`Input.dispatchKeyEvent`. Whether it mattered for *key delivery* had never been
tested, and if it did, Phase 3 would have needed a C++ input path instead of a
page overlay.

## What was measured

One run, fresh Chrome profile, `web/dist-m1` as built (HEAD `d2559d1f`),
transcript in `synthetic-key-gate-chrome-console.log`.

The witness is the game's own tooltip counter, `uActionTooltip` — the same one
`web/tools/persistence-milestone-gate.steps` uses, and its header is the long
argument for why the counter is exact. In one line: `uBindPlayer::DoActivate`
decrements `CYCLE_TURN_{LEFT,RIGHT}_TOOLTIP` **only** when a press resolved
through `keymap[]` to that action for player 1 and the player's cycle object
accepted and executed the turn. `config/default.cfg` ships them as `0 2 1 1 1`
and `0 3 1 1 1`, so 2 and 3 are the budget, and the two counters are spent
separately here so one run answers two questions.

| phase | `tip_left` | `tip_right` |
|---|---|---|
| `boot2-before-play` (baseline) | `0 2 1 1 1` | `0 3 1 1 1` |
| after 3x synthetic ArrowLeft **at `document`** | `0 0 1 1 1` | `0 3 1 1 1` |
| after 4x synthetic ArrowRight **at the canvas** | `0 0 1 1 1` | `0 0 1 1 1` |

Every dispatched event logged `isTrusted=false`. Nothing else pressed a key on
boot 2. The right counter is still 3 in the middle row, which is what makes the
two rows independent measurements rather than one.

**The menus were navigated by synthetic keys too, and that is the second half
of the answer.** On boot 2 the only inputs before the round were three
dispatched events — Enter, ArrowDown, Enter — and the game went main menu → Play
Game submenu → cursor on Local Game → `[L] NEW_ROUND`. Screenshots
`synkey-03-*` and `synkey-04-*` show the submenu opening and the cursor moving.

## What has to be set on the event, and why

The delivery path in the generated `armagetronad.js` is short and reads very
little:

* `_SDL_Init` sets `keyboardListeningElement = document` and registers
  `keydown`, `keyup` and `keypress` there. **The listener is on `document`, not
  on the canvas** — so a canvas-targeted event only arrives by bubbling.
* `SDL.receiveEvent` pushes the event object into `SDL.events` unchanged. It
  reads `event.type` and `event.key` (only to decide whether to call
  `preventDefault`). **It never looks at `isTrusted`.**
* `SDL.lookupKeyCodeForEvent` reads **`event.keyCode`** and `event.location`,
  and maps through `SDL.keyCodes`.

So the load-bearing property is exactly one: **`keyCode`**. `SDL.keyCodes` maps
`37 -> 1104` and `39 -> 1103`, which are precisely the keysyms `user.cfg` binds
`CYCLE_TURN_LEFT` and `CYCLE_TURN_RIGHT` to on this profile (`left_binds`
`["1104","117"]`, `right_binds` `["1103","111"]` in every dump above).

The event this gate dispatched, verbatim:

```js
new KeyboardEvent('keydown', {
  key: 'ArrowLeft', code: 'ArrowLeft',
  keyCode: 37, which: 37,
  bubbles: true, cancelable: true
})
```

Stated honestly about what was and was not isolated: **`keyCode` is required
and `bubbles: true` is required for a canvas-targeted event** (the listener is
on `document`). `key`, `code`, `which` and `cancelable` were all set, and were
*not* individually falsified by this run — `keyCode` is the only one the read
path above touches for an arrow, so they are best read as "set them anyway,
they cost nothing and `key` is consulted for Backspace/Tab".

`defaultPrevented` came back **false** on every press. That is not a failure
signal: `SDL.receiveEvent`'s `preventDefault` is skipped for `keydown` while
`SDL.textInput`/`SDL.unicode` is set. The event still reached `SDL.events` —
the counters are the proof.

## What this does NOT establish

* **Firefox.** Not measured here. The same code path is in the same generated
  `armagetronad.js`, and nothing in it is Chrome-specific, but that is an
  argument, not a measurement.
* **A real touch device.** This gate is about `dispatchEvent`, not about
  touch. See `docs/evidence/phase3-touch/README-overlay.md`.
* **That the cycle was alive.** Same caveat as the milestone gate: a decrement
  proves the press resolved to the right action for the right player and that
  `gCycle::Act` cleared its premature-input guard and called `Turn()`. It does
  not prove the cycle survived.

## Controls in the transcript

* The deliberate uncaught error at the end appears as `[EXCEPTION] TypeError:
  Cannot read properties of null` — so this transcript can see a JS error, and
  the absence of others in it is an observation rather than a silence.
* Only two `[browser.error/network]` lines in the whole run, both `/favicon.ico`.
* The real-key positive control ran (round 3, `key:Left:2 key:Right:3`) and is
  redundant on this outcome: both counters were already 0. It is kept in the
  script because it is what would tell a *failing* run apart from a run whose
  route never reached a live round.
