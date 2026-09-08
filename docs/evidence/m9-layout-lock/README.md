# M9 — the layout is decided at start, and a bar instead of bytes

Chrome device emulation, the four gate scripts on one build. Everything quoted
below is in a committed `console.log` in this directory.

## What changed

M7 shipped "rotation after load offers a reload" and two known costs: a Game Boy
load tilted to landscape shrank to a 247 px picture with the pad off the bottom,
and a phone turned during the download booted into the wrong layout. The plan for
M9 was a live re-layout. **The maintainer rejected the premise** (2026-09-08):
"if I decide to start a game in portrait I stay; if I tilt the phone, well, just
stay in portrait", with the switch offered "as an obvious button". So:

- **The layout is decided when the game starts and stays.** The square's CSS
  width is `var(--aa-square)` — the number `sizeCanvas` published — not
  `min(100vw, 60dvh)`, so a tilted phone keeps its square and nothing reshapes.
  `html.aa-gameboy` is never toggled after `startGame()`. The reload chip is gone.
- **The decision is made twice, both before `main()`:** at parse time, and again
  inside `startGame()` right before `Module.callMain`. The second call is what
  makes a phone turned during the ~5 MB download boot into the orientation it is
  held in.
- **The switch is a button** (`#layoutbtn`), shown only while the game is not
  driving, below the picture in the Game Boy layout and top-right in the full
  one. It reloads with `?layout=portrait|landscape`, the other of the two. The
  parameter sizes for the layout asked for (`sizeCanvas` swaps vw/vh when the
  held viewport disagrees), rides on the URL for the visit, and is stored nowhere.
- **The loading screen is a bar**, in the pad's palette: a dark trough with a
  cyan rim, a cyan fill, and a magenta sweep while no total is known.

## The new gate: `web/tools/layout-boot-gate.steps`

Opens in portrait with `?autostart=0`, so `main()` is held with the loading
overlay up, rotates the emulated phone to landscape, then releases `main()`:

      [M9GATE] LB0 parse-time {"layout":"gameboy","canvas_w":1236,"canvas_h":1236,"inner":"412x915"}
      [M9GATE] LB3 boots-into-held-orientation {"layout":"full","canvas_w":2745,"canvas_h":1236,"css_w":915,"css_h":412,"inner":"915x412","square_var":"0px","PASS":true}

The game comes up **full**, with a 2745×1236 backing store for the landscape
viewport it is now in — before M9 it came up as a Game Boy in that viewport.
Then the switch, in the menu it booted into, and a tap on it:

      [M9GATE] LB1b layout-button-in-landscape-menu {"present":true,"display":"flex","label":"Portrait layout","PASS":true}
      [M9GATE] LB4 switch-reloads-into-the-other-layout {"url_layout":"portrait","layout":"gameboy","canvas_w":1236,"canvas_h":1236,"css_w":412,"css_h":412,"inner":"915x412","square_var":"412px","label":"Landscape layout","PASS":true}

Still held landscape, the page reloads with `?layout=portrait` and comes up as a
Game Boy with a **square** backing store sized as if upright, and the button now
offers the way back. `lb-00-loading-overlay-while-held.png` is the bar,
`lb-01…png` and `lb-02…png` the two boots.

## Rotation mid-game changes nothing

Portrait load rotated to landscape (`portrait/`), and the mirror in the landscape
gate (`landscape/`), each snapshotting the canvas before the rotation:

      [M7GATE] PB6 rotate-after-portrait-boot {"chip_element":false,"still_gameboy":true,"canvas_w":1236,"canvas_h":1236,"css_w":412,"css_h":412,"before":{"w":1236,"h":1236,"css_w":412,"css_h":412},"inner":"915x412","pad_top":412,"PASS":true}
      [M7GATE] T4 rotate-to-portrait {"chip_element":false,"rotate_element":false,"layout":"full","canvas_w":2745,"canvas_h":1236,"before":{"w":2745,"h":1236,"layout":"full"},"layoutbtn_display":"none","ctx":2,"PASS":true}

No chip element exists any more, the layout class holds, and the backing store
and the drawn box are identical to the snapshot. `pb-05-…-stays.png` and
`07-portrait-mid-game-changes-nothing.png` are those states.

## The switch is a menu control

      [M9GATE] LB1 layout-button-in-menu {"present":true,"display":"flex","label":"Landscape layout","top":420,"square_bottom":412,"ctx":1,"PASS":true}
      [M9GATE] LB2 layout-button-hidden-in-round {"present":true,"display":"none","ctx":2,"PASS":true}

LB1 also asserts the button sits below the picture (`top >= square_bottom`): the
first run put it top-right, where it covered the menu's own title
(`pb-02-pad.png` in this directory is the corrected placement). LB2 is the same
`.aa-driving` class that hides the tap layer in rounds, so a thumb cannot reload
the page mid-round.

## Everything else unchanged

Portrait PB1–PB8 pass as before, landscape L1 with every pre-existing assertion
(T1b, T1c ×2, T2b, T3b, T4 ×2, T6), desktop D1 and D2. Totals over the four
logs: layout-boot 3 PASS, portrait 10, landscape 8, desktop 2, none false.
Page-only change: no file under `src/` was touched, so the dedicated byte pin is
not in play. iOS untested; Chrome device emulation, not a device.
