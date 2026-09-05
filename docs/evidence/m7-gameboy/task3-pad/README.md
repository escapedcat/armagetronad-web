# M7 Task 3: the pad

One driver run, on the build that carries the pad (`web/shell.html` is embedded
at link time, so the transcript below is of the committed markup and CSS).

```
python3 -m http.server 8008 --directory web/dist-m1 &

node web/tools/drive-browser.mjs --headed --mobile 412,915,3 \
     --out docs/evidence/m7-gameboy/task3-pad/portrait-boot \
     --url http://localhost:8008/armagetronad.html \
     --script-file web/tools/portrait-boot-gate.steps
```

No landscape control here: every rule the pad adds is scoped to
`html.aa-gameboy`, and `#pad { display:none }` is the unscoped half of that
pair. Task 4 runs the landscape gate against a DOM reference.

## portrait-boot/ -- 412x915 at dpr 3

```
[M7GATE] PB1 portrait-boot-no-hold {"rotate_element":false,"touch_visible":true,"PASS":true}
[M7GATE] PB2 square {"backing_w":1236,"backing_h":1236,"css_w":412,"css_h":412,"css_top":0,"inner_w":412,"gameboy":true,"square_var":"412px","PASS":true}
[M7GATE] PB3 pad-geometry {"pad_top":412,"square_bottom":412,"pad_bottom":915,"inner_h":915,"buttons":[{"key":"ArrowUp","w":64,"h":64,"top":556},{"key":"ArrowLeft","w":64,"h":64,"top":624},{"key":"ArrowRight","w":64,"h":64,"top":624},{"key":"ArrowDown","w":64,"h":64,"top":692},{"key":"Escape","w":80,"h":80,"top":660},{"key":"Enter","w":80,"h":80,"top":572}],"PASS":true}
[M7GATE] PB4 turn-counters-before {"left":2,"right":3}
[M7GATE] PB4 pad-turns-sent {"ctx":0,"before":{"left":2,"right":3},"after":{"left":1,"right":2},"PASS":true}
[M7GATE] PB5 menu-roundtrip-via-pad {"ctx":2,"menu":false,"cycle_alive":true,"driving_class":true,"PASS":true}
```

PB2 now also gates `--aa-square` against the drawn box (`square_var === css_w +
'px'`), which it did not before Task 3: the pad's top edge is that variable and
nothing else, so PB3's `pad_top === square_bottom` would otherwise be measuring
a coincidence between two numbers that happen to agree.

`pad_top 412 === square_bottom 412` is the geometry claim. 64 px is the cross's
`4rem` and 80 px is A/B's `5rem`; both are above the 56 px floor the markup
argues for, and every button's `top` is at or below 412, so nothing the pad adds
is over the picture.

`[L] NEW_ROUND` is reached by `tap:.pad-a` three times and nothing else -- the
language menu, First Setup and the welcome message all confirm on A. The three
taps were `tap:#tapzone` before this task.

## PB4: the turns are the game's own answer, not the page's

`uActionTooltip::Count` decrements `activationsLeft_[player]` once per turn the
local cycle accepted and executed (`src/ui/uInput.cpp:1299`, reached from
`uBindPlayer::DoActivate` only when `Act` returned true), and `uActionTooltip`
is a `tConfItemBase`, so forcing `st_SaveConfig` writes the live counters into
`/persist/var/user.cfg`. One tap on the cross's left and one on its right moved
them 2 -> 1 and 3 -> 2. This is the same witness `web/tools/touch-gate.steps` T3
uses for the landscape turn zones.

`pb-03-after-pad-turns.png` shows the game's own tooltip on screen -- "Press
&lt;right&gt; or &lt;o&gt; to turn right." -- which is what `Count` displays as
it decrements.

`ctx:0` in that line is informational and not part of the PASS: the counters
record turns that already happened, and the AI fragged the idle human between
the second tap and the read-back.

## The two timing facts this run measured

**A turn tapped during the countdown is discarded.** `gGame.cpp:1698` resets the
game timer to `-PREPARE_TIME` (4, `gGame.cpp:1172`) at round start and
`ePlayer::Act` drops every player action while `se_GameTime()<0`
(`ePlayer.cpp:4064`). The first run of this gate, with the pre-existing
`wait:2500` alone, put the left tap at `NEW_ROUND+3.03 s` and it was dropped
(2 -> 2) while the right tap at `+4.60 s` counted (3 -> 2). The extra `wait:3000`
in the steps file is that countdown and not padding.

**The human does not live long enough for both proofs in one round.**
`[L] DEATH_FRAG web_user word` lands at `NEW_ROUND+8.3 s`, about 4.8 s after the
countdown ends, and PB4 spends most of that. So PB5 walks its B -> menu ->
Down/Up -> B round trip in the COUNTDOWN OF A SECOND ROUND, the way
`web/tools/touch-gate.steps` uses extra rounds for the same reason: nothing
moves before game time 0, and `gGame.cpp:2801` pauses the timer for as long as a
standalone in-game menu is up, so the whole round trip happens in a stopped
world. Escape is a global action and is not gated on `se_GameTime()` the way a
turn is, so the state under test is the same one it would be mid-round:

```
[  24266ms] [harness] tap .pad-b at 262,700 (1/1)
[  24291ms] [console.log] [TOUCH] context 3 (menu yes, cycle alive) -> TAP=ENTER
[  28665ms] [harness] tap .pad-b at 262,700 (1/1)
[  28792ms] [console.log] [TOUCH] context 2 (menu no, cycle alive) -> STEERING
```

Context 3 is the one case the overlay's `isDriving()` rule exists for -- a live
cycle with a menu over it -- and B put the page in it and took it back out.

## The screenshots

- `pb-00-portrait-boot.png`, `pb-01-portrait-round.png` -- Task 1 and 2's shots, unchanged.
- `pb-02-pad.png` -- the square holds the language menu; below it the cross is on
  the left and A (upper) and B (lower) on the right. The picture area carries no
  control: the top strip (`#touchpad`), the corner Escape and the two turn-zone
  chevrons are all `display:none` under `html.aa-gameboy`.
- `pb-03-after-pad-turns.png` -- the turn tooltip, and the pad unchanged during a round.
- `pb-04-in-game-menu-via-B.png` -- the In-Game Menu, opened by B, over the second round.
