# M7 — portrait as a Game Boy

The maintainer's phone plays this game in landscape because that is the only
shape the page was built around. (Portrait was offered before M7 — badly, at the
~131° vertical field of view the full-portrait load gave it, behind a prompt and
a remembered answer: [`../portrait-choice/`](../portrait-choice/README.md).)

M7 makes portrait its own layout: a **square picture at the top of the screen
and a pad below it**, decided once at load, on a touch device only. The square
is the point — `rViewport::Perspective` gives an
aspect-1 viewport 90° × 90°, against ~111° × 67° at a phone's landscape and ~131°
vertical at the full-portrait load this page used to build
([`../phone-round2/fov/`](../phone-round2/fov/README.md)).

The whole change is `web/shell.html` and the gates in `web/tools/`. **No C++**,
and nothing outside the `html.aa-gameboy` branch: the two shapes that already
worked are asserted unchanged rather than assumed so (L1, D2).

| | what it establishes | where |
|---|---|---|
| Task 1 | portrait **boots**: the hold, the prompt, the remembered answer and `?portrait=ask` are gone | [`task1-no-hold/`](task1-no-hold/) |
| Task 2 | the **square**, in the element box and in the backing store, and the HUD still fits inside it | [`task2-square/`](task2-square/README.md) |
| Task 3 | the **pad**: six keys below the square, and the game's own counters say the turns arrived | [`task3-pad/`](task3-pad/README.md) |
| Task 4 | **rotation** is an offer in both directions, and landscape and desktop did not move | [`task4-unchanged/`](task4-unchanged/README.md) |

**Everything here was measured under Chrome device emulation, not on a device.**
Emulation supplies a viewport, a device pixel ratio and trusted touch events; it
supplies no phone GPU, no Android system gestures and no browser UI bars that
move after load. It is said once here and once more where it bites, at the end
of [`task4-unchanged/README.md`](task4-unchanged/README.md).

Every run is one invocation of `web/tools/drive-browser.mjs --headed` against
`python3 -m http.server 8008 --directory web/dist-m1`, with `--mobile 412,915,3`
for a portrait phone, `--mobile 915,412,3` for a landscape one and no `--mobile`
for the desktop; the exact commands are in each task's own README. The shell is
embedded in `armagetronad.html` at link time, so each transcript is of the shell
at that commit and no other.

**Round counts in these pages are `grep -c '[console.log] [L] NEW_ROUND'`, not
`grep -c NEW_ROUND`.** The driver echoes the pattern an `until:` step is waiting
for and the line that satisfied it, so one game round can appear three times in
a transcript; the bare count reads about three times high.

---

## Task 1 — portrait boots (`a7719401`)

The hold is gone: no `#rotate` element, no "turn your phone sideways", no "Play
in portrait" button, no `localStorage aa.portrait` read and no `?portrait=ask`.
A portrait load starts the game. This commit does not yet reshape it — the
square is Task 2 — so the picture here is still the full portrait viewport.

`task1-no-hold/portrait-boot/console.log` — 412×915 dpr 3, 1 round:

    [DISPLAY] at load: viewport 412x915 dpr 3 -> canvas 1236x2745 aspect 0.4503 gpu-axis-limit 16384
    [M7GATE] PB1 portrait-boot-no-hold {"rotate_element":false,"touch_visible":true,"PASS":true}

PB1 is two assertions and no more: the prompt element does not exist in the
document, and the touch overlay is not `hidden`. Screenshots
`pb-00-portrait-boot.png` (the language menu, no overlay over it) and
`pb-01-portrait-round.png` (a round, drawn at 0.4503).

`task1-no-hold/landscape-touch-gate/console.log` — 915×412 dpr 3, 3 rounds. T4
is the rewritten section of `web/tools/touch-gate.steps`. It used to rotate the
emulated phone mid-game, dump the overlay's state and take a screenshot named
`07-portrait-shows-rotate-prompt`; there is no prompt to show any more, so it now
**asserts** — the chip is visible and the prompt element is absent, which is the
whole of its PASS — and **records** the backing store beside them, and the shot is
named for what it does show:

    [DISPLAY] at load: viewport 915x412 dpr 3 -> canvas 2745x1236 aspect 2.2209 gpu-axis-limit 16384
    [M7GATE] T4 rotate-to-portrait {"chip_visible":true,"rotate_element":false,"canvas_w":2745,"canvas_h":1236,"PASS":true}
    [M7GATE] T4 back-in-landscape {"chip_hidden":true,"PASS":true}

Screenshots `07-portrait-mid-game-shows-only-the-chip.png` and
`08-back-in-landscape.png`. The gate's **T7** section — the six `PORTRAITGATE`
checks that drove the prompt and the stored answer — was deleted with the thing
it tested; its last passing run is preserved at
[`../portrait-choice/`](../portrait-choice/README.md).

## Task 2 — the square (`4c36c827`)

Full write-up, including why `--aa-square` is published in both layouts:
[`task2-square/README.md`](task2-square/README.md).

`task2-square/portrait-boot/console.log` — 412×915 dpr 3, 1 round:

    [TOUCH] enabled=true (media query -> true) maxTouchPoints=5
    [DISPLAY] layout=gameboy
    [DISPLAY] at load: viewport 412x915 dpr 3 -> canvas 1236x1236 aspect 1.0000 gpu-axis-limit 16384 gameboy square 412css
    [M7GATE] PB1 portrait-boot-no-hold {"rotate_element":false,"touch_visible":true,"PASS":true}
    [M7GATE] PB2 square {"backing_w":1236,"backing_h":1236,"css_w":412,"css_h":412,"css_top":0,"inner_w":412,"gameboy":true,"square_var":"412px","PASS":true}

PB2 measures the drawn element with `getBoundingClientRect` and the backing store
separately, so a CSS rule that disagreed with the buffer would fail on
`css_w !== css_h` even with a square buffer. 412 is
`min(412, floor(915 × 0.6)) = min(412, 549)`: the width wins on a phone and the
60 % cap is inert.

`pb-01-portrait-round.png` is the HUD check: the whole bottom bar — Scores / Me /
Top, Rubber Used, Speed, Brakes, `Fastest: web_user 10.0`,
`Enemies: 3 Friends: 1 Ping: 0 ms` — is legible and unclipped inside the square,
with about ten pixels to spare, and `FPS: 60` is inside the top edge.
`pb-00-portrait-boot.png` is the language menu in the square.

`task2-square/landscape-touch/console.log` — 915×412 dpr 3, 3 rounds, the
control. `[DISPLAY] layout=full`, the backing store still
`2745x1236 aspect 2.2209` — the number `touch-gate.steps` has named since
Phase 3 — and the T4 pair unchanged from Task 1. Thirteen screenshots,
`00-language-menu-with-touch-controls.png` through
`10-after-tapping-escape-in-the-corner.png` plus
`15-booted-with-sparks-1.png`, all of the landscape page.

## Task 3 — the pad (`b9f98669`)

Full write-up, including the two timing facts the run measured:
[`task3-pad/README.md`](task3-pad/README.md).

`task3-pad/portrait-boot/console.log` — 412×915 dpr 3, 2 rounds:

    [M7GATE] PB1 portrait-boot-no-hold {"rotate_element":false,"touch_visible":true,"PASS":true}
    [M7GATE] PB2 square {"backing_w":1236,"backing_h":1236,"css_w":412,"css_h":412,"css_top":0,"inner_w":412,"gameboy":true,"square_var":"412px","PASS":true}
    [M7GATE] PB3 pad-geometry {"pad_top":412,"square_bottom":412,"pad_bottom":915,"inner_h":915,"buttons":[{"key":"ArrowUp","w":64,"h":64,"top":556},{"key":"ArrowLeft","w":64,"h":64,"top":624},{"key":"ArrowRight","w":64,"h":64,"top":624},{"key":"ArrowDown","w":64,"h":64,"top":692},{"key":"Escape","w":80,"h":80,"top":660},{"key":"Enter","w":80,"h":80,"top":572}],"PASS":true}
    [M7GATE] PB4 turn-counters-before {"left":2,"right":3}
    [M7GATE] PB4 pad-turns-sent {"ctx":0,"before":{"left":2,"right":3},"after":{"left":1,"right":2},"PASS":true}
    [M7GATE] PB5 menu-roundtrip-via-pad {"ctx":2,"menu":false,"cycle_alive":true,"driving_class":true,"PASS":true}

- **PB3** is the geometry: `pad_top 412 === square_bottom 412`, and every
  button's `top` is at or below 412, so nothing the pad adds is over the picture.
  64 px is the cross's `4rem` and 80 px is A/B's `5rem`, both above the 56 px
  floor.
- **PB4** is the game's answer, not the page's: `uActionTooltip::Count`
  decrements a counter once per turn the local cycle actually executed, and one
  tap on the cross's left and one on its right moved 2 → 1 and 3 → 2.
- **PB5** is B → in-game menu → cross → B, walked in the countdown of a second
  round. Task 4 adds the opening half of this gate.

Screenshots: `pb-00-portrait-boot.png` and `pb-01-portrait-round.png` (Tasks 1
and 2's, unchanged), `pb-02-pad.png` (the language menu in the square, the cross
on the left, A above B on the right, and no control in the picture area),
`pb-03-after-pad-turns.png` (the game's own turn tooltip), and
`pb-04-in-game-menu-via-B.png`.

Two facts the run established are recorded in the task README and one of them is
**not** from a committed transcript: a turn tapped during the 4 s `PREPARE_TIME`
countdown is discarded, and the timings behind that — a left tap at
`NEW_ROUND+3.03 s` dropped and a right tap at `+4.60 s` counted — come from an
**uncommitted first run** of the gate, before the extra `wait:3000` was added.
The committed run above has both taps counting. The other fact is in the log
here: `[L] DEATH_FRAG web_user word` lands about 8.3 s after `NEW_ROUND`, which
is why PB5 uses a second round.

## Task 4 — rotation, and the two shapes that did not move (`2f90984a`)

Full write-up, including what the rotated screenshot shows beyond what PB6
asserts: [`task4-unchanged/README.md`](task4-unchanged/README.md).

`task4-unchanged/portrait/console.log` — 412×915 dpr 3, 2 rounds. PB1–PB5 as
above, plus:

    [M7GATE] PB5 menu-opened-via-B {"ctx":3,"menu":true,"cycle_alive":true}
    [M7GATE] PB5 menu-roundtrip-via-pad {"opened_ctx":3,"opened_menu":true,"ctx":2,"menu":false,"cycle_alive":true,"driving_class":true,"PASS":true}
    [M7GATE] PB6 rotate-after-portrait-boot {"chip_visible":true,"still_gameboy":true,"canvas_w":1236,"canvas_h":1236,"PASS":true}

PB6: rotating to landscape after a portrait boot raises the chip, keeps
`html.aa-gameboy` and leaves the 1236×1236 backing store alone, because
`sizeCanvas()` runs once at parse time. Screenshot
`pb-05-landscape-after-portrait-boot-chip.png`, and read it with the task
README's paragraph beside it — it shows the cost the chip is offering to remove.
The six shots are `pb-00` through `pb-05`.

`task4-unchanged/landscape/console.log` — 915×412 dpr 3, 3 rounds:

    [M7GATE] L1 landscape-unchanged {"layout":"full","visible":"tapzone,escbtn,touchpad,,,pad-cross,pad-btn pad-up,pad-btn pad-left,pad-btn pad-right,pad-btn pad-down,pad-ab,pad-btn pad-b,pad-btn pad-a","pad_display":"none","square_var":"0px","PASS":true}

`square_var:"0px"` is the half of `--aa-square` no earlier run had proven. The
thirteen screenshots are the same set as Task 2's landscape run.

`task4-unchanged/desktop/console.log` — 1024×768, no `--mobile`, the M1 menu
gate, no rounds:

    [M7GATE] D2 desktop-unchanged {"layout":"full","pad_display":"none","touch_hidden":true,"PASS":true}

`touch_hidden:true` is the whole of "nothing changes for the browsers the Demo
runs on today": the `hidden` attribute `web/shell.html` ships on `#touch` is
still there, because only the touch branch removes it. Ten screenshots,
`01-language-menu.png` through `10-welcome-message.png`, all ten different by
md5.

## `landscape-visible-reference.txt`

One line, and it is the committed reference a future landscape run's L1 string is
**logged for comparison against**. The gate logs the string and passes on
`layout`/`pad_display`/`square_var`; the comparison with this file is a diff a
reader runs, not a check the gate makes:

    tapzone,escbtn,touchpad,,,pad-cross,pad-btn pad-up,pad-btn pad-left,pad-btn pad-right,pad-btn pad-down,pad-ab,pad-btn pad-b,pad-btn pad-a

It is the `visible` field of the L1 line above. The gate walks every descendant
of `#touch`, keeps the ones whose **own** computed display is not `none`, and
maps each to `e.id||e.className`. A future run whose L1 string differs has added,
lost or re-hidden a control in the landscape overlay — with one caveat: the two
empty fields between `touchpad` and `pad-cross` are the two `#touchpad` buttons,
which carry neither an id nor a class, so a change to either of them moves a
comma and names nothing.

Read it as a tree and not as a picture. The pad's six buttons are in the string
even though `#pad` is `display:none` and none of it is painted, because
`getComputedStyle` answers for the element it is given and not for its
ancestors — which is why `pad_display` is a separate field and is the one in the
PASS. What the string does show directly is what the cascade hides itself:
`tz-left` and `tz-right` are absent, because `.aa-driving` is off at the language
menu where the snapshot is taken.

## Open items

- **A Game Boy load rotated to landscape has no controls but the chip.** The CSS
  side, `min(100vw, 60dvh)`, is live and shrinks the picture to 247 CSS px; the
  backing store stays 1236×1236 and the pad's top edge stays at the 412 px the
  square had, below a 412 px-tall viewport. Both follow from "the layout is
  decided at load and nothing after it moves", both are what the chip's Reload
  removes, and dismissing the chip is sticky for the life of the page. **Live
  re-layout (`sr_ReinitDisplay`) is the follow-up** — it is measured and
  available (M5 task 4c) and has now been declined three times.
- **A phone rotated DURING THE DOWNLOAD boots into the layout it started in.**
  `AA_GAMEBOY` and the backing store are both fixed at parse time, seconds before
  `main()`, and nothing after that re-measures. A page that loads in portrait and
  is turned to landscape while the ~5 MB wasm is still arriving therefore starts
  the game as a Game Boy in a landscape viewport — the `pb-05` state above, but on
  first boot, before the player has done anything — with the chip's Reload as the
  exit. The portrait hold M7 deleted re-measured before `main()` for exactly that
  direction. The fix is the live re-layout in the bullet above and not a second
  `sizeCanvas()` caller.
- **The spec's A/B glyphs were not shipped.** The layout section asked for
  "A ⏎" and "B ⎋" on the two round buttons; the pad reads **A** and **B**. ⎋
  (U+238B) has uncertain font coverage on Android, and the `aria-label`s —
  `Enter` and `Back or in-game menu` — carry the meaning for anything that reads
  them.
- **The 60 % cap and the pad's `align-items: safe center` are unexercised.** At
  412×915 the width wins the cap and the pad has 503 px for the 216 the cross and
  its padding need. A tablet-shaped arm would exercise both; none was run.
- ~~**The chip's dismiss `×` is 29 px wide**~~ — **closed.** It was 29 px wide
  against the 44 px its Reload button clears; that number is an **uncommitted
  side measurement** — see the `[SMOKE44]` note in
  [`task4-unchanged/README.md`](task4-unchanged/README.md) — but it now has a
  committed follow-up: [Final fixes](#final-fixes) below gave `#reloadchip
  button` a `min-width:44px`, so both chip buttons clear 44 px on both axes, and
  `final-fixes/portrait/pb-05-landscape-after-portrait-boot-chip.png` is the
  wider `×`.
- **No brake button.** Phase 3 dropped brake as not minimal and M7 kept the six
  keys; the pad has room for a seventh.
- **iOS is untested**, as it has been since Phase 3. Every browser there is
  WebKit, which this port does not target.
- **Chrome device emulation, not a device** — the caveat at the top, and the one
  that bounds every number on this page.

---

## Final fixes

One commit after the branch review, closing its minor findings. **Six changes to
the code**, none of them a feature:

1. `web/shell.html` — `#reloadchip button` gains `min-width:44px` beside the
   `min-height:44px` it already had, so the dismiss `×` clears the touch-target
   minimum on both axes instead of the one it happened to reach. This is the one
   CSS rule on the branch a landscape page can see — the chip is `hidden` until
   the orientation stops matching the one the page sized for, but its rules are
   not `html.aa-gameboy`-scoped — and the comment above it now says so.
2. `web/shell.html` — `window.AA_RUNTIME_READY = true;` and the comment that
   explained it are **deleted**. It was write-only:
   `grep -rn AA_RUNTIME_READY web/ --include='*.html' --include='*.mjs'
   --include='*.steps'` found the assignment and nothing that read it. The other
   hits in the tree are historical: the two files under
   `docs/evidence/phone-feedback/` are transcripts of the pre-M7 portrait hold, in
   which a harness eval read the flag, and `web/dist-m1/` is the build output —
   a copy of this same assignment. Nothing live reads it.
3. `web/tools/touch-gate.steps` — the navigation comment named
   `touch-portrait-probe.steps`, which Task 5 deleted. It now names what is
   actually true: T1c is this file's only navigation, and M7's portrait gate
   (`web/tools/portrait-boot-gate.steps`) has none.
4. `web/tools/portrait-boot-gate.steps` — PB1's `const held=performance.now();`
   was unused and is gone. Nothing else in that eval changed.
5. `web/shell.html` — the `--aa-square` comment said the `var(--aa-square, 100vw)`
   fallback covers "sizeCanvas threw"; **three** paths reach the pad's rules with
   the variable unset (the `AA_CANVAS_SIZE` override returns, the
   no-usable-viewport guard returns, the `catch` swallows a throw), and the
   comment now names all three.
6. `web/shell.html` — the comment above `window.AA_TOUCH = touchDecision.on;`
   said "three later blocks" and then listed four things. It counts what it
   lists.

**All three gates were re-run against the rebuilt `web/dist-m1`** — the same
three commands the tasks above used, with `--out docs/evidence/m7-gameboy/final-fixes/…`.

`final-fixes/portrait/console.log` — 412×915 dpr 3, 2 rounds:

    [M7GATE] PB1 portrait-boot-no-hold {"rotate_element":false,"touch_visible":true,"PASS":true}
    [M7GATE] PB2 square {"backing_w":1236,"backing_h":1236,"css_w":412,"css_h":412,"css_top":0,"inner_w":412,"gameboy":true,"square_var":"412px","PASS":true}
    [M7GATE] PB3 pad-geometry {"pad_top":412,"square_bottom":412,"pad_bottom":915,"inner_h":915,"buttons":[{"key":"ArrowUp","w":64,"h":64,"top":556},{"key":"ArrowLeft","w":64,"h":64,"top":624},{"key":"ArrowRight","w":64,"h":64,"top":624},{"key":"ArrowDown","w":64,"h":64,"top":692},{"key":"Escape","w":80,"h":80,"top":660},{"key":"Enter","w":80,"h":80,"top":572}],"PASS":true}
    [M7GATE] PB4 turn-counters-before {"left":2,"right":3}
    [M7GATE] PB4 pad-turns-sent {"ctx":0,"before":{"left":2,"right":3},"after":{"left":1,"right":2},"PASS":true}
    [M7GATE] PB5 menu-opened-via-B {"ctx":3,"menu":true,"cycle_alive":true}
    [M7GATE] PB5 menu-roundtrip-via-pad {"opened_ctx":3,"opened_menu":true,"ctx":2,"menu":false,"cycle_alive":true,"driving_class":true,"PASS":true}
    [M7GATE] PB6 rotate-after-portrait-boot {"chip_visible":true,"still_gameboy":true,"canvas_w":1236,"canvas_h":1236,"PASS":true}

`final-fixes/landscape/console.log` — 915×412 dpr 3, 3 rounds, `[DISPLAY] layout=full`:

    [M7GATE] L1 landscape-unchanged {"layout":"full","visible":"tapzone,escbtn,touchpad,,,pad-cross,pad-btn pad-up,pad-btn pad-left,pad-btn pad-right,pad-btn pad-down,pad-ab,pad-btn pad-b,pad-btn pad-a","pad_display":"none","square_var":"0px","PASS":true}
    [M7GATE] T4 rotate-to-portrait {"chip_visible":true,"rotate_element":false,"canvas_w":2745,"canvas_h":1236,"PASS":true}
    [M7GATE] T4 back-in-landscape {"chip_hidden":true,"PASS":true}

The touch gate's other checks passed in the same run and are returned as eval
values rather than logged, so they are read from the transcript's `=> "…"`
column: `T1b` `PASS:true`, `T1c` precondition and override both `PASS:true`,
`T2b` `PASS:true`, `T3b` `PASS:true`, and `T6 escape corner`
`{"rect":"54x46@10,10","at_least_44px":true,…}` — that one measures `#escbtn`,
which this commit did not touch.

`final-fixes/desktop/console.log` — 1024×768, no `--mobile`, no rounds (the M1 menu gate):

    [M7GATE] D2 desktop-unchanged {"layout":"full","pad_display":"none","touch_hidden":true,"PASS":true}

`[SPARKSGATE] D1 desktop-autoexec-untouched` is `PASS:true` in the same
transcript.

**One screenshot is committed from these runs**,
`final-fixes/portrait/pb-05-landscape-after-portrait-boot-chip.png`: the rotated
Game Boy state the open items describe, with the chip's `×` now as wide as it is
tall. The other screenshots the three runs produced are left uncommitted — they
are the same pictures the task sections above already commit.
