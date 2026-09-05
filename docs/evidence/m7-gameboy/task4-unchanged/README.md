# M7 Task 4 -- rotation, and proof that landscape and desktop did not move

Three runs of the same build, one per shape the page can be loaded in. The
first proves what M7 ADDED behaves on a rotation; the other two prove M7 added
nothing to the two shapes that already worked.

Build: `web/dist-m1/armagetronad.html` from `web/shell.html` at this commit
(the shell is embedded at link time, so these runs are of this shell and no
other). Served with `python3 -m http.server 8008 --directory web/dist-m1`.

    node web/tools/drive-browser.mjs --headed --mobile 412,915,3 \
         --out docs/evidence/m7-gameboy/task4-unchanged/portrait \
         --url http://localhost:8008/armagetronad.html \
         --script-file web/tools/portrait-boot-gate.steps

    node web/tools/drive-browser.mjs --headed --mobile 915,412,3 \
         --out docs/evidence/m7-gameboy/task4-unchanged/landscape \
         --url http://localhost:8008/armagetronad.html \
         --script-file web/tools/touch-gate.steps

    node web/tools/drive-browser.mjs --headed \
         --out docs/evidence/m7-gameboy/task4-unchanged/desktop \
         --url http://localhost:8008/armagetronad.html \
         --script-file web/tools/menu-gate.steps

`../landscape-visible-reference.txt` holds the `visible` string L1 measured in
the landscape run below. **It is the reference future runs compare against**:
a run whose L1 line carries a different string has added, lost or re-hidden a
control in the landscape overlay, and the diff says which -- except where the
element has no name to give: the gate maps each element to `e.id||e.className`,
so the two empty fields between `touchpad` and `pad-cross` are the two
`#touchpad` buttons, which carry neither an id nor a class, and a change to
either of them moves a comma and nothing else. Read it as a tree rather than a
picture -- it lists every descendant of `#touch` whose OWN computed display is
not `none`, so the pad's six buttons appear in it even though `#pad` is
`display:none` and none of it is painted. What it does show directly is what the
cascade hides itself: `tz-left`/`tz-right` are absent, because `.aa-driving` is
off at the language menu where the snapshot is taken.

## portrait/ -- 412x915 dpr 3, `web/tools/portrait-boot-gate.steps`

`[DISPLAY] layout=gameboy`, `[L] NEW_ROUND` reached **2 times**, no
`[EXCEPTION]`, no stack overflow, no full SDL queue, no 404 but `/favicon.ico`.
(Counted as `grep -c '\[console.log\] \[L\] NEW_ROUND' console.log`. A bare
`grep -c NEW_ROUND` reads 6 here: the harness echoes the `until:` pattern it is
waiting for and the line it matched, so each game round can appear three times
in the transcript. Every round count in this directory uses the `[console.log]`
form.)

    [M7GATE] PB1 portrait-boot-no-hold {"rotate_element":false,"touch_visible":true,"PASS":true}
    [M7GATE] PB2 square {"backing_w":1236,"backing_h":1236,"css_w":412,"css_h":412,"css_top":0,"inner_w":412,"gameboy":true,"square_var":"412px","PASS":true}
    [M7GATE] PB3 pad-geometry {"pad_top":412,"square_bottom":412,"pad_bottom":915,"inner_h":915,"buttons":[{"key":"ArrowUp","w":64,"h":64,"top":556},{"key":"ArrowLeft","w":64,"h":64,"top":624},{"key":"ArrowRight","w":64,"h":64,"top":624},{"key":"ArrowDown","w":64,"h":64,"top":692},{"key":"Escape","w":80,"h":80,"top":660},{"key":"Enter","w":80,"h":80,"top":572}],"PASS":true}
    [M7GATE] PB4 turn-counters-before {"left":2,"right":3}
    [M7GATE] PB4 pad-turns-sent {"ctx":0,"before":{"left":2,"right":3},"after":{"left":1,"right":2},"PASS":true}
    [M7GATE] PB5 menu-opened-via-B {"ctx":3,"menu":true,"cycle_alive":true}
    [M7GATE] PB5 menu-roundtrip-via-pad {"opened_ctx":3,"opened_menu":true,"ctx":2,"menu":false,"cycle_alive":true,"driving_class":true,"PASS":true}
    [M7GATE] PB6 rotate-after-portrait-boot {"chip_visible":true,"still_gameboy":true,"canvas_w":1236,"canvas_h":1236,"PASS":true}

PB6 is Task 4's own: rotating to landscape AFTER a portrait boot offers the
chip and moves nothing else. The backing store is still 1236x1236 because
`sizeCanvas()` runs once, at parse time, and `html.aa-gameboy` is still on
because nothing clears it -- the layout stays the one the page loaded in until
the player takes the offer. Screenshot: `portrait/pb-05-landscape-after-portrait-boot-chip.png`.

READ THAT SCREENSHOT CAREFULLY, because it shows more than PB6 asserts. The
picture has SHRUNK -- `html.aa-gameboy #canvas { width: min(100vw, 60dvh) }` is
live CSS, and 60dvh of a 412 px-tall viewport is 247 px, so a 1236x1236 backing
store is being drawn into 247x247 CSS px. And the pad is GONE: its top edge is
`var(--aa-square)`, which sizeCanvas fixed at 412 px, and the rotated viewport
is only 412 px tall, so the whole pad sits below the bottom edge. Both follow
from "the layout is decided at load and nothing after it moves", both are the
cost the chip is offering to remove, and neither is a new defect -- but the
consequence is that a rotated Game Boy load has no controls except the chip
until the player reloads or rotates back. Dismissing the chip with the `x` is
sticky for the life of the page, so a player who does that is left with the
small picture and no pad; rotating back restores the pad, and Reload is still a
browser refresh away.

PB5 gained its opening half here: `menu-opened-via-B` reads ctx 3 (menu on
screen, cycle alive) before the trip back, so the closing `ctx 2` is a menu
that was really opened and not a B that did nothing.

The rotation also exercised the `via` on the orientation log line, which now
names the event that fired instead of dropping it:

    [     66ms] [console.log] [TOUCH] orientation portrait=true (sized for portrait: true) via load
    [     84ms] [console.log] [TOUCH] orientation portrait=true (sized for portrait: true) via resize
    [  29882ms] [console.log] [TOUCH] orientation portrait=false (sized for portrait: true) via resize
    [  29882ms] [console.log] [TOUCH] orientation portrait=false (sized for portrait: true) via media query

Four lines, not three, and quoted with their timestamps because the count is the
point: the page logs one at load and a second `via resize` 18 ms later, before
anything has turned, and then two at the rotation itself -- the emulated turn
arrives as a `resize` and as a media-query change in the same millisecond, and
both handlers log. `sized for portrait: true` stays true through all four, which
is the state PB6 asserts.

## landscape/ -- 915x412 dpr 3, `web/tools/touch-gate.steps`

`[DISPLAY] layout=full` on both boots (the script reloads for T1c),
`[TOUCH] enabled=true`, `[L] NEW_ROUND` **3 times** (the `[console.log]` count;
a bare `grep -c` reads 10), the only two `[EXCEPTION]` lines are the script's own
positive control at the end, no stack overflow, no full SDL queue, no 404 but
`/favicon.ico`.

L1 is Task 4's own; everything below it was already passing and still is.

    [M7GATE] L1 landscape-unchanged {"layout":"full","visible":"tapzone,escbtn,touchpad,,,pad-cross,pad-btn pad-up,pad-btn pad-left,pad-btn pad-right,pad-btn pad-down,pad-ab,pad-btn pad-b,pad-btn pad-a","pad_display":"none","square_var":"0px","PASS":true}
    [SPARKSGATE] T1b sparks-off-on-touch {"read":true,"sparks_lines":1,"ends_with_sparks_0":true,"PASS":true}
    [SPARKSGATE] T1c precondition saved-config-holds-sparks-0 {"read":true,"line":"                      SPARKS 0","value":"0","PASS":true}
    [SPARKSGATE] T1c sparks-1-overrides-the-saved-0 {"save":"saved","autoexec_sparks_lines":["SPARKS 1"],"ends_with_sparks_1":true,"live_sparks_in_user_cfg":"1","PASS":true}
    [TOUCHGATE] T2b menu-side collision check {"ctx":1,"driving_class":false,"turn_zones_have_no_box":true,"tap_layer_area":376980,"PASS":true}
    [TOUCHGATE] T3b round-side collision check {"ctx":2,"driving_class":true,"tap_layer_has_no_box":true,"turn_zone_areas":[197915,197915],"PASS":true}
    [M7GATE] T4 rotate-to-portrait {"chip_visible":true,"rotate_element":false,"canvas_w":2745,"canvas_h":1236,"PASS":true}
    [M7GATE] T4 back-in-landscape {"chip_hidden":true,"PASS":true}
    [TOUCHGATE] T6 escape corner {"rect":"54x46@10,10","at_least_44px":true,"inset_from_left_px":10,"inset_from_top_px":10,"centre_x_px":37}

The three `[SPARKSGATE]` lines above are **abridged**, and nothing else here is:
each drops a read flag (`err` or `autoexec_read`), a byte count of the file, and
in two of them a `tail` excerpt of it. The `[M7GATE]` and `[TOUCHGATE]` lines are
whole. Nothing quoted is edited -- T1c's `line` really is
`"                      SPARKS 0"`, leading spaces and all, because that is how
the game writes the value into `user.cfg` and the gate's regex allows the
padding.

`square_var:"0px"` is the half of `--aa-square` no committed run had proven
before: `sizeCanvas` writes the variable in BOTH branches, and `0px` is its
true answer when there is no square. T4 and PB6 are the two directions of the
same offer -- a landscape load rotated into portrait, and a portrait load
rotated into landscape -- and both show the chip and nothing else.

## desktop/ -- 1024x768, no `--mobile`, `web/tools/menu-gate.steps`

`[TOUCH] enabled=false`, `[DISPLAY] layout=full`, ten screenshots and all ten
different (md5), no `[EXCEPTION]`, no stack overflow, no full SDL queue, no 404
but `/favicon.ico`.

    [SPARKSGATE] D1 desktop-autoexec-untouched {"read":true,"bytes":12376,"sparks_occurrences":0,"PASS":true}
    [M7GATE] D2 desktop-unchanged {"layout":"full","pad_display":"none","touch_hidden":true,"PASS":true}

D1 is abridged the same way as the landscape ones: `err` and `tail` dropped.

D2 is Task 4's own. `touch_hidden:true` is the whole of "nothing on this page
changes for the browsers the Demo currently runs on": the `hidden` attribute
`web/shell.html` ships on `#touch` is still there, because only the touch
branch removes it and this browser never took it.

## The chip's buttons, measured

The 44 px touch-target minimum moved onto `#reloadchip button` this commit (it
used to sit on the rotate prompt's button, which M7 deleted). The chip is
`hidden` whenever the three gates above look at it, so it was measured on its
own, on the same build, by un-hiding it in a two-step run at 412x915 dpr 3.

**This one is not a transcript line from any committed run.** It is an
UNCOMMITTED side measurement -- the two-step script was not kept and its `--out`
directory is not in this repository -- so unlike every other quote on this page
it cannot be re-read from a file here. It is recorded because the number is
worth having and re-measurable in two steps, not because it is evidence:

    [SMOKE44] {"buttons":[{"id":"reloadchip-go","w":63,"h":44},
                          {"id":"reloadchip-x","w":29,"h":44}],
               "all_at_least_44":true}

Reload is 63x44 and clears the minimum on both axes. The dismiss `x` clears it
on height only -- 29 px wide -- at this commit. The final fix commit (76fcc331)
added `min-width:44px` to the same rule, so both buttons now clear 44 px on
both axes; `docs/evidence/m7-gameboy/final-fixes/` and the index's "Final
fixes" section carry that state.

## What these runs do NOT show

Chrome's device emulation, not a device. It supplies a viewport, a device pixel
ratio and trusted touch events; it supplies no phone GPU, no Android system
gestures and no browser UI bars that move after load. The three shapes are
CSS-viewport shapes, and "desktop" here is a 1024x768 window that happens to be
landscape -- what makes it desktop is `[TOUCH] enabled=false`, not its shape.

The pad's `align-items:safe center` overflow guard is also unmeasured by these
runs: 412x915 leaves 503 px below the square against the 216 the cross and the
padding need (PB3 measured `pad_top:412, pad_bottom:915`), so it never comes
near the case the guard is for -- see the `#pad` comment in `web/shell.html`.
