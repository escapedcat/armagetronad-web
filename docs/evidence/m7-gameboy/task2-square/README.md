# M7 Task 2: the Game Boy square

Two driver runs on one build (`web/shell.html` is embedded at link time, so both
ran against the same `web/dist-m1/armagetronad.html`). The claim under test is
narrow and has two halves that have to be measured separately: a touch device
that LOADS in portrait gets a square picture anchored at the top, and nothing
else changes.

```
python3 -m http.server 8008 --directory web/dist-m1 &

# portrait (the change)
node web/tools/drive-browser.mjs --headed --mobile 412,915,3 \
     --out docs/evidence/m7-gameboy/task2-square/portrait-boot \
     --url http://localhost:8008/armagetronad.html \
     --script-file web/tools/portrait-boot-gate.steps

# landscape (the control)
node web/tools/drive-browser.mjs --headed --mobile 915,412,3 \
     --out docs/evidence/m7-gameboy/task2-square/landscape-touch \
     --url http://localhost:8008/armagetronad.html \
     --script-file web/tools/touch-gate.steps
```

Two `--out` directories rather than one because the driver always writes
`console.log` into the directory it is given; a single `--out` would have left
one transcript on top of the other.

## portrait-boot/ -- 412x915 at dpr 3

```
[TOUCH] enabled=true (media query -> true) maxTouchPoints=5
[DISPLAY] layout=gameboy
[DISPLAY] at load: viewport 412x915 dpr 3 -> canvas 1236x1236 aspect 1.0000 gpu-axis-limit 16384 gameboy square 412css
[M7GATE] PB1 portrait-boot-no-hold {"rotate_element":false,"touch_visible":true,"PASS":true}
[M7GATE] PB2 square {"backing_w":1236,"backing_h":1236,"css_w":412,"css_h":412,"css_top":0,"inner_w":412,"gameboy":true,"square_var":"412px","PASS":true}
[L] NEW_ROUND 2026-09-05 19:35:04 UTC+0200
```

412 is `min(412, floor(915 * 0.6)) = min(412, 549)`, i.e. the width wins on this
phone and the 60 % cap is inert -- it exists for a tablet wide enough that the
width would eat the pad's half of the screen. 1236 = 412 x 3 is under
MAX_CANVAS_PIXELS (3840 x 2160) and under this machine's 16384 axis limit, so
neither the area cap nor the axis clamp touched it; on a device where one of
them did, both scale w and h by the same factor and the square survives.

PB2 measures the ELEMENT (`getBoundingClientRect`) and not the variables that
set it, so a CSS rule disagreeing with the backing store would show up as
`css_w !== css_h` even with `backing_w === backing_h`.

`pb-01-portrait-round.png`: the round is drawn in the top square, and the HUD is
LEGIBLE AND UNCLIPPED -- the whole bottom bar (Scores / Me / Top, Rubber Used,
Speed, Brakes, `Fastest: web_user 10.0`, `Enemies: 3 Friends: 1 Ping: 0 ms`)
sits inside the square with about ten pixels to spare, and the console text and
`FPS: 60` are inside the top edge. No open item for Task 5 from this shot.

Two things in that screenshot belong to Task 3 and are expected: the two turn
chevrons are still `position:fixed` over the whole viewport rather than in the
pad area below the square, and the Esc button still sits in the picture's
top-left corner where it overlaps the console text. Task 3 owns the pad and its
controls.

## landscape-touch/ -- 915x412 at dpr 3, the control

Landscape is the proof that nothing outside the Game Boy branch moved:

```
[DISPLAY] layout=full
[DISPLAY] at load: viewport 915x412 dpr 3 -> canvas 2745x1236 aspect 2.2209 gpu-axis-limit 16384
[SPARKSGATE] T1b sparks-off-on-touch {... "sparks_lines":1,"ends_with_sparks_0":true,"PASS":true}
[TOUCHGATE] T2b menu-side collision check {"ctx":1,"driving_class":false,"turn_zones_have_no_box":true,"tap_layer_area":376980,"PASS":true}
[TOUCHGATE] T3b round-side collision check {"ctx":2,"driving_class":true,"tap_layer_has_no_box":true,"turn_zone_areas":[197915,197915],"PASS":true}
[M7GATE] T4 rotate-to-portrait {"chip_visible":true,"rotate_element":false,"canvas_w":2745,"canvas_h":1236,"PASS":true}
[M7GATE] T4 back-in-landscape {"chip_hidden":true,"PASS":true}
[TOUCHGATE] T6 escape corner {"rect":"54x46@10,10","at_least_44px":true,...}
[SPARKSGATE] T1c precondition saved-config-holds-sparks-0 {... "value":"0","PASS":true}
[SPARKSGATE] T1c sparks-1-overrides-the-saved-0 {... "live_sparks_in_user_cfg":"1","PASS":true}
```

2745x1236 aspect 2.2209 is the number `web/tools/touch-gate.steps` has named
since Phase 3, unchanged. The only new line in this transcript is
`[DISPLAY] layout=full`, and the `[TOUCH] enabled=` line moved earlier in the
page (22 ms rather than after the sizing) because the decision was hoisted --
same text, same inputs.

T4 rotates the emulated phone to portrait MID-GAME and still reads canvas
2745x1236: the Game Boy decision is made once, at load, so turning a running
game does not reshape its backing store. That is the same rule the reload chip
already existed for.

`--aa-square` in landscape was checked separately (a three-line steps file at
`--mobile 915,412,3`, not committed): `{"layout_class":"","square_var":"0px",
"aspect_var":"2.220873786407767","canvas_css":"915x412@top0"}`. No `aa-gameboy`
class, the variable is published as `0px` rather than left unset, and the canvas
is still the whole viewport.

The only browser exception in either transcript is the touch gate's own
deliberate positive control at the end, and the only network error is
`favicon.ico` 404, which the static server has always returned.
