# The wide-FOV hypothesis: real geometry, wrong bug

The dispatch's leading hypothesis for "still stretched" was that the 3D view is
geometrically correct and still *looks* stretched, because
`rViewport::Perspective` opens the horizontal field of view on a wide screen.

**The maintainer then narrowed his own report** -- *"the stretch might just be
the image in the beginning, true"* -- and the startup title picture turned out
to be a literal 1.96x horizontal stretch with a measurement behind it
(`../logo/`). So this page is **not** the reported bug. It is recorded because
the geometry is real and the maintainer may want it later.

## The arithmetic, from the source

`rViewport::Perspective`:

```
aspectratio       = width*sr_screenWidth*currentScreensetting.aspect
                    / (height*sr_screenHeight)          // = W/H, aspect[] is 1
ensureverticalfov = fmax(aspectratio/1.5, 1.0)
xmul              = ensureverticalfov * tan(fov*pi/360)
ymul              = xmul/aspectratio
glFrustum(-near*xmul, near*xmul, -near*ymul, near*ymul, near, far)
```

with `fov` = `ePlayer::startFOV` = **90** (`src/engine/ePlayer.cpp`), so
`tan(45 deg)` = 1 and `xmul` is just `max(aspect/1.5, 1)`.

| screen | aspect | horizontal FOV | vertical FOV | edge anisotropy |
|---|---|---|---|---|
| desktop 4:3 | 1.333 | **90.0 deg** | 73.7 deg | 1.414 |
| desktop 16:9 | 1.778 | 99.7 deg | 67.4 deg | 1.551 |
| 19.5:9 phone screen | 2.167 | 110.6 deg | 67.4 deg | 1.757 |
| phone landscape, URL bar hidden (915x412) | 2.221 | 111.9 deg | 67.4 deg | 1.787 |
| phone landscape, URL bar showing (915x350) | 2.614 | **120.3 deg** | 67.4 deg | **2.009** |

Two facts fall out of the formula rather than out of a measurement:

- **The vertical field of view is pinned at 67.38 degrees for every aspect at or
  above 1.5.** Above that threshold `ensureverticalfov` is `aspect/1.5`, so
  `ymul = (aspect/1.5)/aspect = 1/1.5` exactly, whatever the aspect. A phone
  loses 6.4 degrees of vertical view against a 4:3 desktop and then loses no
  more however wide it gets.
- **Edge anisotropy** is `sec(atan(xmul))`: the factor by which a round object
  at the extreme left or right edge is drawn wider than it is tall, which is
  what a perspective projection does to anything off-axis. It goes from
  **1.41x** at 4:3 to **2.01x** at a phone's landscape shape -- 42 % worse.

## What is NOT claimed

**No rendered comparison was made.** The two facts above are exact geometry
derived from the four lines quoted; whether 120 degrees *looks* wrong to a
player is a perception claim and this port cannot measure one. The one thing
that was going to be measured -- a stretch the maintainer could see -- turned
out to have a different and much larger cause, and chasing this one after that
would have been fixing a thing nobody reported.

## Recommendation: do not cap the aspect

The fix the dispatch had in mind was to letterbox the backing store at, say,
16:9 so the projection never sees 2.61. **Do not ship it as a fix for this
complaint**, for three reasons:

1. It addresses something the maintainer did not report, and the thing he did
   report is fixed.
2. It costs real screen area on the device with the least of it: at 2.61 a 16:9
   cap throws away 32 % of the width.
3. A wide horizontal field of view is not only a cost in this game. Armagetron
   is played by watching for walls at the edges of vision; 120 degrees shows
   more of them.

If the maintainer wants to try it anyway, the cheap experiment is
`START_FOV_1` -- it is a real player preference on the Player/Camera menu, and
the previous round measured what narrowing it does (the horizon leaves the top
of the screen below about 69 degrees). An aspect cap is the expensive version of
the same experiment.
