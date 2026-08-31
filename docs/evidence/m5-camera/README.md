# M5 task 2b — the camera

`docs/porting/browser-runtime-notes.md` § 11 recorded, since M2, that
Emscripten's `gluLookAt` is a no-op, so the browser client had a permanently
top-down view in every camera mode and the player's own cycle sat just outside
the frame. It was carried as a footnote through four milestones. This is the
fix and the measurements that show it landed.

The fix is one function, `gluLookAt` in `src/emscripten/eCompat.cpp`. Its own
comment carries the diagnosis, the second bug underneath it, and the reference
it was written against; this file is only the evidence.

## Before / after, in numbers

`measure-camera.py` turns § 11's signatures into countable things; its
docstring says what each one measures and why it has the shape it does.
`measure-camera.asrun` is the run.

The BEFORE frames are not staged. They are
`docs/evidence/m5-o2-assertions/gates/m2-gameplay-{chrome,firefox}/05-round1-after-LEFT.png`,
committed by task 2 before this task touched anything: the same gate script,
the same step, the same build minus this one shim.

| | Chrome before | Chrome after | Firefox before | Firefox after |
|---|---|---|---|---|
| columns holding a ≥300-row vertical ridge | **34** | **0** | **31** | **0** |
| longest ridge in x=505..517 | 476 rows, y 95..570 | 116 rows, y 582..697 | 46 rows | 95 rows, y 624..718 |
| mean luma, rows 100..250 | 7.07 | **64.99** | 6.58 | **65.28** |

Read as: the floor grid was thirty-odd exactly-vertical lines running most of
the frame's height, which is what a perpendicular view of a plane produces.
It now has none — every grid line is slanted, i.e. it converges. And the top
of the frame, which used to be more floor, now holds sky and the arena rim,
because there is a horizon in it.

**Two honest qualifications on the middle row**, because § 11's second
signature is the weakest of the three and a report that claimed it flipped
cleanly would be overstating:

- It is frame-dependent. It measures a wall that happens to pass under the
  camera, and the Firefox before-frame does not have one — 46 rows, not 476.
  Only the Chrome before-frame shows the full-height centre line § 11
  describes.
- It does not go to zero after the fix, and should not. With the camera behind
  the cycle, the player's own wall is still seen nearly edge-on and still
  projects near the centre column. What changes is its extent and where it
  ends: it now stops at the cycle (rows 582..697 / 624..718, the lower half of
  the frame) instead of running off the top (rows 95..570), because the cycle
  is in front of it and a horizon is above it.

§ 11 says the line lands at x = 511. Measured, the ridge peak is at x = 508
(Chrome) and x = 507 (Firefox). Same conclusion, and the exact column is a
detail of where the ridge test puts its peak on a one-pixel line.

## Before / after, in pictures

`gameplay-{chrome,firefox}/` — six frames per browser from
`web/tools/gameplay-gate.steps`, plus that run's `console.log`, `driver.txt`
and `checker.txt`.

The maintainer's actual test was "is the bike in frame". Shot
`04-round1-driving-HUD-shows-enemies.png` answers it: the player's own cycle,
its wall, three opponents with theirs, the arena corners, the rim wall and the
sky, all in one frame at the default `CAMERA_CUSTOM`. Compare the Chrome
before-frame, which is a flat grid, one wall band, and no cycle at all.

`CAMERA_IN` was not used and is not a substitute — `eCamera::Render` drops the
centred object from the render list within 1 unit of the camera.

**On mirroring**, since a mirrored projection would also converge and would
also be wrong: the world-space cockpit gauge ("15.0", drawn by
`RenderCockpitVirtual` under this same projection matrix) reads left-to-right
in `12-round3-driving-HUD-shows-enemies.png`. It would read backwards if the
handedness were flipped.

## The M2 gate itself

Re-run in full in both browsers, because this change alters every rendered
frame and that gate is the one that would notice.
`docs/evidence/m2-gate/check-transcript.mjs` reports **ALL CHECKS PASSED** on
both — see each browser's `checker.txt`. Three rounds started, three won, no
GL errors over 126 (Chrome) / 122 (Firefox) polls, and the only 404 is
`/favicon.ico`.

Frame rate is not measurably worse for drawing a real 3D scene instead of a
flat one: worst whole second 53 fps in Chrome, 56 in Firefox, medians 60 and
58.

## The dedicated build

`invariant/` — the dedicated wasm is unchanged, plus the control that shows
that statement is not vacuous. See `invariant/README.md`.
