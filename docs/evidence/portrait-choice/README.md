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

One run of `web/tools/touch-gate.steps` (its new **T7** section, P1–P6), plus one
run of the **unchanged** desktop `web/tools/menu-gate.steps`, both against the
same build.

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
| `touch-gate-console.log` | the whole run: four boots, six `[PORTRAITGATE]` checks, and the touch gate as it already was still passing around them (`T2b`, `T3b`, `T6`). Two `[EXCEPTION]` lines, both the script's own positive control; one 404, and it is `/favicon.ico`. |
| `00-language-menu-with-touch-controls.png` | the landscape boot, unchanged. No prompt, controls up, canvas 2745x1236. |
| `11-portrait-prompt-after-boot-has-the-button.png` | **P1.** The phone turned to portrait with the game already running. The prompt is up, **the button is on it**, and it says the game will restart — this is exactly the state the maintainer could not get out of. |
| `12-portrait-boot-after-choosing-play-in-portrait.png` | **P2/P3.** One tap later: the page reloaded and booted in portrait. No prompt, no chip, touch controls up, canvas 1236x2745 — the game is drawn **for** portrait, not letterboxed into it. |
| `12b-landscape-with-the-choice-stored.png` | **P5.** With the answer stored, turning the phone back to landscape: the prompt stays down and the **chip comes up**, offering the reload that would redraw for landscape. The chip is about the orientation the player is *not* in, which is the half P3 cannot show. |
| `13-portrait-ask-restores-the-prompt.png` | **P4.** `?portrait=ask` cleared the stored answer; the prompt is back, the boot is held again, and the "the game starts by itself" line is showing again because it is true again. |
| `13b-portrait-prompt-with-ask-still-in-the-url.png` | **P6, precondition.** The game booted from that `?portrait=ask` page and the phone was turned back to portrait. Byte-identical to `11` — the page looks the same; what differs is the URL, and therefore what the tap used to do. |
| `14-ask-dropped-and-portrait-kept.png` | **P6.** The tap from that URL: the reload dropped `?portrait=ask`, kept the answer, and booted portrait unheld. |
| `desktop-menu-gate-console.log` | the desktop gate, **unchanged**, against the same build: ten screenshots, zero `[EXCEPTION]`s, one 404 and it is `/favicon.ico`. Its one relevant line is `[TOUCH] enabled=false (media query -> false)` — the touch block returns before any of this exists, so the transcript contains no `play in portrait`, no `aa.portrait` and no `portrait at load` line at all. A desktop visitor sees no change, by construction rather than by inspection. |

## The six checks, as the transcript records them

    [PORTRAITGATE] P1 prompt-after-boot {"rotate_hidden":false,"button":"128x44@142,528",
      "label":"Play in portrait","held_note_hidden":true,"restart_note_hidden":false,
      "boot_held":false,"stored":null,"PASS":true}

    [PORTRAITGATE] P2/P3 portrait-boot {"stored":"play","boot_held":false,
      "rotate_hidden":true,"chip_hidden":true,"inner":"412x915","canvas":"1236x2745",
      "canvas_portrait":true,"aspect":0.45,"css":"412x915","touch_hidden":false,"PASS":true}

    [PORTRAITGATE] P5 rotated-to-landscape {"stored":"play","rotate_hidden":true,
      "chip_hidden":false,"inner":"915x412","canvas":"1236x2745","PASS":true}

    [PORTRAITGATE] P4 portrait=ask {"search":"?portrait=ask","stored":null,"boot_held":true,
      "rotate_hidden":false,"held_note_hidden":false,"restart_note_hidden":true,
      "button_present":true,"PASS":true}

    [PORTRAITGATE] P6 precondition {"search":"?portrait=ask","rotate_hidden":false,
      "boot_held":false,"PASS":true}

    [PORTRAITGATE] P6 ask-dropped {"search":"","stored":"play","boot_held":false,
      "rotate_hidden":true,"canvas":"1236x2745","canvas_portrait":true,"PASS":true}

**P1** is the regression test for the defect itself: the prompt raised *after*
the boot carries the button, at 128x44 CSS px — past the 44 px touch-target
minimum on both axes, which it was **not** when this gate was first run. That run
measured **128x38** and failed; `min-height:44px` in the stylesheet is that
failure, fixed. `held_note_hidden:true` with `restart_note_hidden:false` is the
prompt being state-aware in both directions: "the game starts by itself the
moment you turn the phone" is true only while the boot is held, and "the game
restarts to redraw at the new shape" is true only after it. P4 shows the same two
flags the other way round.

**P2** is the answer being honoured, in the page's own words:

    [  55747ms] [TOUCH] play in portrait chosen (stored for next load: true)
    [  55747ms] [BOOT] reloading to size the canvas for portrait
    [  55774ms] [DISPLAY] at load: viewport 412x915 dpr 3 -> canvas 1236x2745 aspect 0.4503
    [  55776ms] [TOUCH] play in portrait: true (localStorage aa.portrait)
    [  55776ms] [TOUCH] orientation portrait=true (sized for portrait: true, boot held: false, play in portrait: true)
    [  55820ms] [BOOT] autostart: calling main

**P3 and P5 are the same claim from both sides.** The reload chip was left alone
on purpose: its sentence is "the backing store is for the other orientation, so
this is letterboxed and soft" and its button is the reload that fixes exactly
that. P3 says it stays hidden when the orientation on screen and the one the
canvas was measured for agree; P5 says it appears when they do not. P3 on its own
would also pass if the chip were simply broken.

**P6 is a defect the review found before a player did.** The post-boot path ends
in a reload, and a bare `location.reload()` re-runs the query string — so a page
entered at `?portrait=ask` would, on that reload, re-run the clear and delete the
answer the tap had just stored, landing HELD with the prompt up. Two taps for one
decision. P6 walks that path end to end: release the hold so the game boots with
the parameter still in the URL (`13b`), turn back to portrait, tap, and check what
comes back. `"search":""` is the parameter gone, `"stored":"play"` is the answer
intact, `"boot_held":false` is the page **not** held, and `1236x2745` is portrait.

**The absence is proved by a counter, not by an assertion.** A gate cannot wait
for a line that never comes, so `until:` is used the other way round.
`[BOOT] portrait at load: HOLDING main()` appears **exactly once** in the whole
transcript, at 68772 ms — after the `P4-PORTRAIT-ASK` mark at 68727 ms and before
P6 releases it. The four boots are at 319 ms (the first load), 55820 ms (P2's
reload), 71918 ms (P6's release) and 82222 ms (P6's reload), and only the page
between P4 and P6 was ever held.

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
