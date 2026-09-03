# Four buttons become one, and the check that a tap can only mean one thing

The maintainer asked for it in a line: *"instead of showing 4 buttons, return
can just be 'tap the screen'? esc can be top left?"*

| | before (Phase 3) | after |
|---|---|---|
| Enter | button in the top strip | **a tap anywhere on the screen** |
| Escape | button in the top strip | **a button in the top-left corner** |
| Up / Down | buttons in the top strip | unchanged, and now **hidden during a round** |
| Turn left / right | left and right halves, **always live** | left and right halves, **only while driving** |

On screen during a round there is now exactly **one** control, the Esc corner,
plus the two faint steering chevrons Phase 3 already had.

## The signal that makes it possible

`src/emscripten/eWebInput.cpp` exports `aa_web_input_context()`, two bits: a
`uMenu` is on screen (`uMenu::MenuActive()`), and a **local** player has an
object that is `Alive()`. The page cannot derive either -- a menu item can start
the game, a round can end by itself, and Escape mid-round opens the in-game
menu, none of which reaches the script. The policy lives in `web/shell.html`:
"driving" is a live cycle **and** no menu, so the in-game menu gets Enter rather
than the turn zones even though the cycle is alive underneath it.

`?diag=1` gained a `ctx` row, so the state is readable on a phone.

## The collision check the change needed

The gate asserts it **structurally** rather than by sampling behaviour: the two
surfaces are never in the box tree at the same time, because `.aa-driving` on
the container `display:none`s whichever one the game is not asking for. Two
controls with no box cannot be tapped.

| check | ctx | `.aa-driving` | tap layer | turn zones | PASS |
|---|---|---|---|---|---|
| T2b, at a menu | 1 (menu, no cycle) | false | 915x412 | **0x0 and 0x0** | **true** |
| T3b, in a round | 2 (no menu, cycle alive) | true | **0x0** | 480x412 and 480x412 | **true** |

This also closes a defect Phase 3 shipped and nobody had noticed: the turn zones
used to be live in menus, and `uMenu::HandleEvent` routes `SDLK_LEFT` /
`SDLK_RIGHT` to `items[selected]->LeftRight()` -- so on the build the maintainer
is playing, **a tap anywhere in a settings menu silently changes the value of
whatever row is selected.**

## The gate

`web/tools/touch-gate.steps`, Chrome, `--mobile 915,412,3`. Every menu below was
reached by tapping and there is no `key:` step in the file.

| | result |
|---|---|
| language menu -> First Setup -> welcome -> round 1 | reached by **taps on the screen** alone |
| `CYCLE_TURN_LEFT_TOOLTIP` | `0 2 1 1 1` -> **`0 0 1 1 1`** |
| `CYCLE_TURN_RIGHT_TOOLTIP` | `0 3 1 1 1` -> **`0 0 1 1 1`** |
| T2b / T3b collision checks | **PASS / PASS** |
| Escape corner (T6) | 54x46 px at (10, 10), centre at x=37; tap opened a menu (`ctx` 0 -> 1) |
| rotate to portrait mid-game | prompt shown, chip shown, as Phase 3 |
| `until` timeouts | **0** |
| `glGetError` | **0** over 97 polls |
| frame rate, 3 rounds | p50 16.7 ms, per-second median **60**, worst second **50** |
| positive control (deliberate uncaught error) | recorded |

The counters need three rounds now where Phase 3 needed two: the right-hand
counter starts at 3 and the human dies to the AI in a few seconds, so round 3
taps right only. That is how long the AI takes to win, not a property of the
overlay.

## What is NOT verified here, and cannot be

**Whether the top-left corner fights Android's back gesture.** Chrome's device
emulation has no Android system gestures to collide with. What is known: the
back gesture is an edge *swipe* -- a drag starting inside a system gesture strip
down the left and right edges, typically 20-40 dp -- and a stationary tap does
not trigger it. The button is inset `.6rem`, measured above at 10 px from the
edge with its centre at **x = 37 px**, which is where a thumb actually lands.
`env(safe-area-inset-*)` moves it clear of a notch. If the corner turns out to
fight the gesture on a real device the fix is to raise that one number.

**A cosmetic clash worth naming:** the Esc button sits over the top-left corner
of the game's own console messages ("Word entered the game...") for the first
seconds of a round. They scroll away; the button does not move.
