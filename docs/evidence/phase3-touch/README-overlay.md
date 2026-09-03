# Phase 3, steps 2-4 — the minimal touch overlay, and what was measured

The overlay is **entirely inside `web/shell.html`**. No C++ was changed, no
source file outside `web/` was touched, and the dedicated server's byte
identity is intact (see "The byte tripwire" below).

## What was built

Six keys, synthesized from touch, and nothing else.

| control | where it is | sends |
|---|---|---|
| turn left | the **left half** of the viewport, full height | `ArrowLeft` |
| turn right | the **right half** of the viewport, full height | `ArrowRight` |
| menu up / down | two buttons in a strip at the **top centre** | `ArrowUp` / `ArrowDown` |
| select | a button in the same strip | `Enter` |
| back / in-game menu | a button in the same strip | `Escape` |

**Why half-screen tap zones for the turns.** The whole game is two actions, so
the right target size is the largest one available: a player steering at 30
units/s should never have to look at, or aim for, a control. Held in landscape
the two thumbs already rest on the lower-left and lower-right, so each half is
under a thumb without moving the grip, and "left half turns left" needs no
explaining. Discrete buttons would be smaller targets bought with nothing. Each
zone carries one faint chevron so a visitor is given a hint rather than a blank
screen.

**Why the menu strip is at the top centre.** In landscape both thumbs live in
the lower corners, so the top centre is the one region a steering hand cannot
reach by accident. It is also the one band of this game's screen that never
holds anything the player must act on: the menus put their *title* there and the
in-game HUD puts scores, speed and rubber along the **bottom** edge (see
`touch-03-round1-driving.png`). The strip has its own dark backdrop, which is
legibility and not decoration — the first run of the gate put four translucent
rectangles across the words "Language Settings" and neither was readable.

**`Escape` is one key more than the brief asked for, and here is the argument
for it.** The brief said "arrows and Enter", and that turns out to be exactly
right for getting *in*: measured, the whole first-run flow — language menu →
First Setup → welcome message → tutorial round — is Enter, Enter, Enter, because
"Accept" is First Setup's top item and is pre-selected on arrival. Every menu on
the route to a round also carries its own "Exit Menu"/"Back" item, so Escape is
never needed to navigate. What Escape *is* needed for is getting **out of a
running match**: `INGAME_MENU` is bound to keysym 27 and there is no other way
to reach it, so without this button a phone visitor who starts a game is stuck
in it until the match ends. It costs one button. The footgun it adds — Escape at
the main menu is Exit Game — is a faster path to a hazard that is already on
screen as a menu item, not a new one.

**What is deliberately absent:** brake, camera, chat, settings, rebinding. Two
of those would also inherit open input defects that are not this page's to fix
(`f` does not work even from a real keyboard; three camera actions have no
binding at all — PLAN.md open items 4 and 8).

**How it is switched on.** `(hover: none) and (pointer: coarse)` — the media
query for "the primary input is a finger". A touchscreen laptop answers `true`
to `navigator.maxTouchPoints > 0` and must not get an overlay over its
keyboard-driven game. `?touch=1` / `?touch=0` override it. The page logs one
`[TOUCH] enabled=...` line so a gate asserts the branch rather than inferring it
from a picture.

**Two other page-only changes were required and are not cosmetic.**

* **`<meta name="viewport">` — the page was not a mobile page without it.** With
  no viewport meta, Android Chrome lays a page out against a ~980 CSS-px virtual
  viewport and scales it down, so `window.innerWidth` reports ~980 and the
  sizing block computes a backing store for a window that does not exist. Every
  desktop browser ignores the element entirely.
* **A second `width:` on `#canvas` using `100dvh`.** On a phone `100vh` is the
  *large* viewport (URL bar scrolled away) while the sizing block reads
  `window.innerHeight`, the *small* one — so the contain-fit was being solved
  against a taller box than exists and the canvas was cropped by
  `overflow:hidden`. It is a second declaration rather than an edit because a
  browser without `dvh` drops the whole declaration, and dropping the only width
  falls back to the canvas's width *attribute*, which is the sea-of-black layout
  that rule exists to remove.

## What was measured

Two committed scripts, both under Chrome device emulation at **915x412 CSS px,
dpr 3** (a Pixel-class Android phone in landscape; 412x915 is its portrait
viewport):

```sh
python3 -m http.server 8000 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --headed --mobile 915,412,3 \
     --out /tmp/touch-chrome --url http://localhost:8000/armagetronad.html \
     --script-file web/tools/touch-gate.steps
node web/tools/drive-browser.mjs --headed --mobile 412,915,3 \
     --out /tmp/touch-portrait --url http://localhost:8000/armagetronad.html \
     --script-file web/tools/touch-portrait-probe.steps
kill %1
```

**The taps are real.** `Input.dispatchTouchEvent` goes through the browser's own
input pipeline, so the page receives `touchstart`/`pointerdown` with
`isTrusted: true` exactly as it would from a finger. The only synthetic thing in
these runs is the thing under test — the `KeyboardEvent` the overlay builds in
response. A test that synthesized the tap too would be watching the page talk to
itself.

### The whole first-run flow, by tapping (`touch-gate-chrome-console.log`)

No `key:` step appears anywhere in `web/tools/touch-gate.steps`. Three taps on
the strip's Enter button carried a fresh profile from the language menu, through
First Setup, past the welcome message, into `[L] NEW_ROUND` — screenshots
`touch-00` through `touch-03`.

### Steering, by tapping the halves

The witness is the game's own `uActionTooltip` counters, as in step 1:

| phase | `tip_left` | `tip_right` |
|---|---|---|
| `round1-before-steering` | `0 2 1 1 1` | `0 3 1 1 1` |
| after **3 taps on the left half** | `0 0 1 1 1` | `0 3 1 1 1` |
| after **4 taps on the right half** | `0 0 1 1 1` | `0 0 1 1 1` |

### Canvas sizing on a phone viewport

`915x412 CSS px x dpr 3` produced a **2745x1236** backing store = **3.39 Mpx**,
CSS size **915x412** — a 1:1 fit filling the viewport with nothing scaled, which
is what the sizing block is supposed to do and had never been checked at a phone
aspect. `[TOUCH] enabled=true (media query -> true) maxTouchPoints=5`.

### Frame rate at a phone-sized backing store — AND THE CAVEAT

Sampled by the frame counter copied verbatim from
`web/tools/fps-resolution-probe.steps`, which counts the game's own
`glFlush`/`glFinish` calls:

```
3.39 Mpx (2745x1236)   median 60.24 fps   p50 frame time 16.6 ms
                       worst whole second 53 fps   mean 57.74 over 7.07 s
                       0 GL errors in 69 polls
```

**AN M1 MAX RENDERING 3.4 Mpx IS NOT A PHONE RENDERING 3.4 Mpx.** Emulation
supplies the viewport, the device pixel ratio and touch events; it supplies
nothing about phone GPU throughput, phone memory, thermal throttling or Android
Chrome's compositor. This number is *this machine's* frame rate at a phone's
pixel count, and it is what it is for the reason M5 already established: the
port is not fill-bound on this machine (60 fps median from 0.79 Mpx to 33.2
Mpx), because the per-frame cost is the CPU side of `-sLEGACY_GL_EMULATION`'s
immediate-mode translation, which does not depend on resolution. That is a datum
for the phone question and not an answer to it — **and the CPU-bound shape of
the cost is precisely why a phone is the open risk**: a phone's weakness against
an M1 Max is single-thread CPU, which is the axis this port is actually loaded
on.

Two further caveats on the number itself: the sample is **one round, 7.07 s,
408 frames**, and it is the *tutorial* match (`sg_SinglePlayerGame` with
`speedFactor -2`, `sizeFactor -2`, `rubber 5`), which is a lighter scene than a
normal local game. The comparable M5 desktop baseline at 1024x768 was
"60 fps median / 52 min".

### Orientation (`touch-portrait-chrome-console.log`)

Loaded in **portrait** at 412x915 dpr 3:

| step | canvas backing store | canvas CSS size | rotate prompt | reload chip |
|---|---|---|---|---|
| loaded in portrait | 1236x2745 | 412x915 | **shown** | hidden |
| rotated to landscape | 1236x2745 | **186x412** | hidden | **shown** |
| after tapping Reload | **2745x1236** | 915x412 | hidden | hidden |

**Stated plainly, because it is the honest limit of this work: a rotation after
load leaves the backing store where it was and needs a reload to be crisp.** The
middle row is that fact as a measurement — a portrait-loaded page rotated to
landscape is a 186x412 sliver in the middle of the screen
(`portrait-02-rotated-to-landscape-after-loading-in-portrait.png`), because the
game initialised at a 1:2.22 aspect and the CSS contain-fit is faithfully
letterboxing it. The chip says so in one sentence and offers the one thing that
fixes it.

Rotating *into* portrait mid-game (`touch-gate.steps` T4) raises the full-screen
prompt and rotating back lowers it; the canvas never moves either way.

**This is a prompt, not a resize, and that was a choice.** `sr_ReinitDisplay` is
now known to work — M5 task 4c measured the canvas resizing live with no context
loss and two full rounds afterwards — so a real resize-and-reinit listener is
*available* to whoever wants it. It was not built here for the same reason it
was not built at M5: it is a live re-init on every orientation flip, which is a
much larger claim than a sentence of honest text. Portrait at 9:19.5 is an
aspect this game has never rendered, and the prompt exists so that nobody has to
find out what it looks like.

## The byte tripwire

`make -f web/Makefile dedicated` was **forced to relink** (its outputs deleted
first, so Make could not short-circuit) and produced **2,488,298 bytes**, md5
**`9718a2a64978cb6e9b95ea2f0454cca5`** — both halves, unchanged.

Saying "a page-only change cannot touch it" is not an assumption here, it is
structural and visible in the link line: the dedicated target's `em++`
invocation contains no `--shell-file` at all, and `web/shell.html` appears in no
prerequisite list of any `dedicated` rule. `make dedicated` after the shell edit
printed "Nothing to be done" before the forced relink, which is the same fact
from the other direction.

`node web/tools/check-publish-set.mjs` passes: `web/dist-m1` still holds exactly
the 5 declared release files. **Nothing was deployed.**

## What a real device would still have to confirm

Everything below is *not measured* by anything in this directory:

1. **Frame rate and thermals on an actual Android phone.** The only honest thing
   said above is that this machine is not fill-bound.
2. **Memory.** The backing store at dpr 3 is colour + depth + stencil with
   `preserveDrawingBuffer` — roughly 8 bytes/pixel, ~27 MB at 3.39 Mpx — on top
   of a ~4.3 MB wasm and its heap, on a device that kills tabs.
3. **That a finger behaves like `Input.dispatchTouchEvent`.** Palm rejection,
   multi-touch during a fast left-right-left, and Android Chrome's own gesture
   handling (back-swipe from the screen edge, notification pull-down from the
   top edge — which is exactly where the menu strip is) are all unexercised.
4. **The URL bar.** Android Chrome hides and shows it on scroll; this page never
   scrolls, so it should stay put, but that is reasoning, not a measurement.
5. **Whether the wasm downloads at all on a mobile connection.** ~5 MB over
   cellular with no progress affordance beyond the existing "Loading…" text.
6. **Firefox for Android, and iOS Safari.** Neither was run. iOS in particular
   reopens the WebKit question this port has deliberately never answered.
7. **Whether the left/right halves are the right ergonomics** for someone
   actually holding a phone, as opposed to someone reasoning about one.

## The desktop Demo is unchanged, and that was checked rather than assumed

`web/shell.html` is the page the live Demo serves, so a touch overlay in it is a
change to a working product. The M4 **milestone** gate — three page loads, real
CDP key presses, a resolution chosen through the menus, three rounds of
steering, and a reload-survival check — was re-run against the rebuilt page in
both target browsers:

```
Chrome   PASS 22/22 checks   docs/evidence/phase3-touch/desktop-regression-milestone-chrome-console.log
Firefox  PASS 22/22 checks   docs/evidence/phase3-touch/desktop-regression-milestone-firefox-console.log
```

Both transcripts open with `[TOUCH] enabled=false (media query -> false)
maxTouchPoints=0`, which is the branch assertion: on a desktop the overlay's
roots keep their `hidden` attribute and none of its listeners are ever
registered.

(The checker prints a NOTE saying the transcript "is NOT the product page"
because the URL carries `?autostart=0`. That fires on every correct run of this
gate — its own header states that URL "is not optional" — and it is a
pre-existing quirk of the checker, not a fact about this run.)

Re-run either with:

```sh
node web/tools/drive-browser.mjs --headed --out /tmp/mile-chrome \
     --url 'http://localhost:8000/armagetronad.html?autostart=0' \
     --script-file web/tools/persistence-milestone-gate.steps
node web/tools/drive-firefox.mjs --out /tmp/mile-firefox \
     --url 'http://localhost:8000/armagetronad.html?autostart=0' \
     --script-file web/tools/persistence-milestone-gate.steps
node docs/evidence/m4-persistence/check-milestone-transcript.mjs /tmp/mile-chrome/console.log
```
