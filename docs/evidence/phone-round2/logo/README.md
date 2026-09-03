# "Still stretched": it is the picture at the start, and here is the number

The maintainer's second report said *"still stretched"*, and then narrowed it
himself: *"the stretch might just be the image in the beginning, true."* He is
right, and it is not the 3D view.

`gLogo::Display()` draws `textures/title.jpg` -- **800x600, exactly 4:3** -- as
a quad from `(-1,-1)` to `(1,1)` with the full-screen menu viewport selected
and no projection. The picture is therefore scaled onto the **whole viewport**
whatever shape that viewport is, and every feature of it is widened by
`screenAspect / (4/3)`:

| screen | aspect | horizontal stretch of the title |
|---|---|---|
| desktop 4:3 | 1.333 | **1.00x** -- the shape the art was drawn at |
| desktop 16:9 | 1.778 | 1.33x -- upstream has always looked like this |
| phone 915x350 landscape, dpr 3 | 2.614 | **1.96x** |

It is the first thing on screen after the loading overlay: `MainMenu()` calls
`gLogo::SetDisplayed(true)` and `gFloor.cpp`'s `MenuBackground` draws it behind
every menu frame, so it is the picture behind the language menu of a first run
and behind the main menu of every run after that. It fades out over the first
couple of seconds.

## The measurement

`sx_frac` is the standard deviation of the picture's own blue content along x,
**as a fraction of the screen width**, computed by
`web/tools/logo-aspect-probe.steps` in the page and by `moments.py` here over
the committed screenshots. It is weighted by blue *dominance*, so the grey menu
grid and the red/white menu text weigh zero, and it is a normalised moment, so
it does not move as the title fades. `moments.txt` is its output:

| | aspect | cx | **sx_frac** |
|---|---|---|---|
| before, desktop 4:3 | 1.3333 | 0.3056 | **0.22857** |
| before, phone 2.614 | 2.6143 | 0.3022 | **0.23050** |
| after, desktop 4:3 | 1.3333 | 0.3061 | **0.22956** |
| after, phone 2.614 | 2.6143 | 0.3983 | **0.11736** |

**Before, the two aspects agree to 0.8 %.** That is the whole finding: the
picture occupied the same fraction of the width on a 4:3 screen and on a 2.61
one, which is only possible if nothing corrects for the shape -- so on the
phone it was 1.96x too wide.

**After, the phone reads 0.5112 of the desktop against a prediction of
0.5100** ((4/3)/2.6143), i.e. the picture now occupies 51 % of the width and is
pillarboxed. The centroid moved to 0.3983 against a prediction of 0.4011 for
the same pillarbox. **The desktop moved by 0.4 %, i.e. not at all.**

## The pictures

| file | what |
|---|---|
| `../startup/desktop-4x3/s00-at-boot.png` | before, 4:3 -- the artwork's own shape |
| `../startup/phone-2p61/s00-at-boot.png` | **before, phone -- the two lightcycles at twice their width** |
| `after-desktop/l01-title-early.png` | after, 4:3 -- unchanged |
| `after-phone/l01-title-early.png` | after, phone -- correct shape, grid either side |

The two `after` shots also show round 2's new touch controls (Esc in the corner,
two buttons instead of four); the logo fix and the navigation change were built
and measured together, so every screenshot after this point has both.

## Why it is a pillarbox and not a crop

The other way to keep the aspect is to fill the width and let the top and
bottom fall outside the viewport. At 2.61 that keeps the middle 51 % of the
image and throws away both the "ARMAGETRON ADVANCED" title and the "PRESS ANY
KEY TO START" line. Fitting inside costs screen area and keeps the picture.

## This file's own neighbour already did it right

`gFloor.cpp`'s `MenuBackground` -- the animated grid drawn immediately before
the call to `gLogo::Display()` -- scales its texture matrix by
`(sr_screenWidth*3.0)/(sr_screenHeight*4.0)` precisely so the grid cells stay
square on a widescreen. The grid was corrected for widescreen; the picture on
top of it was not. The fix is the same constant, applied to the quad.

## Scope

`gLogo.cpp` holds the only unaspected picture in the tree. The other
full-viewport quads are `gFloor.cpp`'s grid (corrected, above) and
`rViewport.cpp`'s `DemonstrateViewport` outline, which is a border rather than
an image and has no shape to lose.

The fix is `#ifdef __EMSCRIPTEN__`-guarded because this repository requires it
of any change outside `src/emscripten/`. **Nothing in it is
browser-specific** -- a native 16:9 desktop has the same defect to the same
formula -- so if it is ever sent upstream it should go unguarded.
