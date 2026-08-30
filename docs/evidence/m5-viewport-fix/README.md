# M5 task 1 — the §10 crash that would have shipped

**What this shows:** `src/render/rViewport.cpp`'s viewport-demo line loop was
left open — four `glVertex2f` calls, then a `glColor3f` and a `DisplayText`
with no `RenderEnd()` between them — so the colour change and the text landed
inside a batch with a changed vertex format. That is this port's §10 defect
class (`docs/porting/browser-runtime-notes.md` §10): Emscripten requires one
vertex format per `glBegin`/`glEnd` block, real OpenGL does not, and a batch
that changes its attribute set part-way either asserts or silently draws
garbage.

**It was not latent.** Four milestones recorded this site as latent. The route
is **main menu → Down → Player Setup → Enter → Down×4**, and it is reached from
`RenderBackground()` via `uMenu::OnEnter` — so *highlighting* the item is
enough, no selection required. Four keystrokes from the main menu, in the build
about to be made public.

## The directories

| directory | what it is |
|---|---|
| `repro-before/` | the crash, at `8fc86835`, before any change. `console.log` carries the `numVertices must be an integer` abort from `_emscripten_glEnd`. |
| `verify-after/` | the same route in Chrome after the fix — 20 distinct screenshots, 0 aborts, 0 exceptions, `glGetError` 0x0, panels and titles drawn. |
| `verify-firefox/` | the same in Firefox. |
| `sweep-after.txt` | `web/tools/sweep-immediate-mode.py` after the fix. |

## Two things a reader needs to know

**The sweep count goes 19 → 18, and that is the correct shape of a fix in this
class.** The script skips regions that are both closed and uniform, so fixing a
site *removes* its line rather than reclassifying it. Tasks 2 and 5 should
expect 18, not a reclassified 19.

**The transcripts appear to show the abort before the keypress that caused it.**
They do not. `web/tools/drive-browser.mjs` logs its `key` line *after*
keyDown + 30 ms + keyUp, so the abort (42226 ms) precedes the key line
(42248 ms) while following that key's *keydown* by 10 ms. Anyone reading this
harness's transcripts needs to know that — it is a property of the driver, not
of the game.

## What this does not show

Nobody played the fixed screen for fun; the route is scripted. One machine, one
GPU. And the new `web/tools/viewport-menu-gate.steps` counts Down-presses to
reach the item, so **if an item is ever added to or removed from
`sg_PlayerMenu()` the script walks past the viewport item and still passes** —
check shot 08's highlighted line before trusting a green run. It is not
self-checking.
