# "I want portrait" means they get portrait

The maintainer, after playing the deployed build on his Android phone:
**"i always see 'turn your phone sideways' even when i selected portrait
mode."** He is right, and both halves of it were `web/shell.html`'s orientation
block:

- `applyOrientation()` sets `rotateEl.hidden = !portrait`, so the full-screen
  prompt is raised for **any** portrait viewport — before the boot and after it.
  That part is deliberate and is kept: a player who turns the phone mid-round is
  looking at a letterboxed sliver, and "turn your phone sideways" is more use to
  them than a chip at the bottom of it.
- `anywayEl.hidden = !window.AA_BOOT_HELD_FOR_PORTRAIT` hid the button that
  dismissed the prompt as soon as the game started, because it was written as an
  escape hatch for a device that misreports its orientation rather than as a
  choice a player is allowed to make.

Together: turning the phone mid-session put a full-screen overlay over a running
game with no exit but turning back. The rule that decides it is the maintainer's
own — **the user decides**.

## What is here

Everything below is one run of `web/tools/touch-gate.steps` (its new **T7**
section), plus one run of the **unchanged** desktop `web/tools/menu-gate.steps`.

    python3 -m http.server 8001 --directory web/dist-m1 &
    node web/tools/drive-browser.mjs --headed --mobile 915,412,3 \
         --out docs/evidence/portrait-choice \
         --url http://localhost:8001/armagetronad.html \
         --script-file web/tools/touch-gate.steps

`915x412 dpr 3` is a Pixel-class phone in landscape; `metrics:412:915:3` turns
it. The taps are real (`Input.dispatchTouchEvent`), which matters here more than
anywhere else in this file: the thing under test is a button a player has to hit
while an overlay is over a running game.

| file | what it proves |
|---|---|
| `touch-gate-console.log` | the whole run, 15 screenshots' worth of transcript. The four `[PORTRAITGATE]` lines are the checks; everything before them is the touch gate as it already was, still passing (`T2b`, `T3b`, `T6`). |
| `00-language-menu-with-touch-controls.png` | the landscape boot, unchanged. No prompt, controls up, canvas 2745x1236. |
| `11-portrait-prompt-after-boot-has-the-button.png` | **P1.** The phone turned to portrait with the game already running. The prompt is up and **the button is on it** — this is exactly the state the maintainer could not get out of. |
| `12-portrait-boot-after-choosing-play-in-portrait.png` | **P2/P3.** One tap later: the page reloaded and booted in portrait. No prompt, no chip, touch controls up, and the canvas is 1236x2745 — the game is drawn **for** portrait, not letterboxed into it. |
| `13-portrait-ask-restores-the-prompt.png` | **P4.** `?portrait=ask` cleared the stored answer; the prompt is back, the boot is held again, and the "the game starts by itself" line is showing again because it is true again. |
| `desktop-menu-gate-console.log` | the desktop gate, **unchanged**, against the same build: ten screenshots, zero `[EXCEPTION]`s, one 404 and it is `/favicon.ico`. Its one relevant line is `[TOUCH] enabled=false (media query -> false)` — the touch block returns before any of this exists, so the transcript contains no `play in portrait`, no `aa.portrait` and no `portrait at load` line at all. A desktop visitor sees no change, by construction rather than by inspection. |

## The four checks, as the transcript records them

    [PORTRAITGATE] P1 prompt-after-boot {"rotate_hidden":false,"button":"128x44@142,536",
      "label":"Play in portrait","held_note_hidden":true,"boot_held":false,
      "stored":null,"PASS":true}

    [PORTRAITGATE] P2/P3 portrait-boot {"stored":"play","boot_held":false,
      "rotate_hidden":true,"chip_hidden":true,"inner":"412x915","canvas":"1236x2745",
      "canvas_portrait":true,"aspect":0.45,"css":"412x915","touch_hidden":false,
      "PASS":true}

    [PORTRAITGATE] P4 portrait=ask {"search":"?portrait=ask","stored":null,
      "boot_held":true,"rotate_hidden":false,"held_note_hidden":false,
      "button_present":true,"PASS":true}

**P1** is the regression test for the defect itself: the prompt raised *after*
the boot carries the button, at 128x44 CSS px — past the 44 px touch-target
minimum on both axes, which it was **not** when this gate was first run. The
first run measured it at **128x38** and failed; `min-height:44px` in the
stylesheet is that failure, fixed. The `held_note_hidden:true` is the other half
of the prompt being state-aware: "the game starts by itself the moment you turn
the phone" is true only while the boot is held, and the game is already running
behind this overlay.

**P2** is the answer being honoured. The tap stored `aa.portrait=play` and
reloaded; the reloaded page read the answer, held nothing, and sized the backing
store for the viewport it was actually in. Two lines from the page say it:

    [  55745ms] [TOUCH] play in portrait chosen (stored for next load: true)
    [  55745ms] [BOOT] reloading to size the canvas for portrait
    [  55774ms] [DISPLAY] at load: viewport 412x915 dpr 3 -> canvas 1236x2745 aspect 0.4503
    [  55776ms] [TOUCH] play in portrait: true (localStorage aa.portrait)
    [  55776ms] [TOUCH] orientation portrait=true (sized for portrait: true, boot held: false, play in portrait: true)
    [  55836ms] [BOOT] autostart: calling main

**P3** is `chip_hidden:true` in the same line. The reload chip is not the prompt
in miniature and was left alone: its sentence is "the backing store is for the
other orientation, so this is letterboxed and soft" and its button is the reload
that fixes exactly that. On the boot the stored answer produces, the orientation
on screen and the one the canvas was measured for agree, so it stays hidden.

**The absence is proved by a counter, not by an assertion.** A gate cannot wait
for a line that never comes, so `until:` is used the other way round:
`[BOOT] portrait at load: HOLDING main()` appears **exactly once** in the whole
transcript, and it is at 65180 ms — *after* the `P4-PORTRAIT-ASK` mark at
65157 ms. The portrait boot at 55836 ms therefore held nothing, which is the
claim. `[BOOT] autostart: calling main` appears twice, at 342 ms and 55836 ms:
one boot before the tap and one after.

## One driver run, not two

The mid-script `location.reload()` did **not** need splitting. `drive-browser.mjs`
attaches to a *target*, not to a document, so the console stream and
`Runtime.evaluate` carry on into the new page (`touch-portrait-probe.steps` has
reloaded mid-script since Phase 3). Two consequences are written into the steps
file because they are easy to get wrong:

1. `until:` counts the **whole** transcript and does not reset at a navigation,
   so the second boot is `until:2:...:[BOOT] autostart`. That same property is
   what makes the absence proof above work.
2. The page globals do not survive. `window.__fps` and `window.__tg` — the frame
   sampler and the dump probe the rest of the gate uses — are gone after the
   reload, which is why T7 is the **last** section and why its own checks are
   self-contained one-liners.

## What is NOT claimed

**Emulation is not a device.** Chrome's device emulation supplies the viewport,
the pixel ratio and trusted touch events. It supplies nothing about the phone GPU,
and it is not the instrument that found this defect — the maintainer's phone was.

**Portrait still looks wrong, and the prompt says so.** At a 0.45 aspect
`rViewport::Perspective` keeps the horizontal field of view and divides the
vertical by the aspect, giving a **vertical field of view near 131°**. That is a
distortion in the render, not in the layout, and nothing in this change touches
it: the fix is a portrait *layout* — a square viewport with the controls below,
which returns the field of view to 90° x 90° — and that is planned, not built.
What this change fixes is that the player is allowed to choose it anyway.
