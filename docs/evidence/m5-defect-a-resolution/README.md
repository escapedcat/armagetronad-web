# Defect A — "I picked 1024x768 and the screen did not change"

**`sr_ReinitDisplay` is not the defect. It works.** The defect is that the
Screen Mode menu's **top item, the one the cursor lands on, is inert in this
port** — and it is inert on *both* halves, live and across a reload.

Four Chrome runs against a local server on the committed `web/dist-m1` build
(`4bc7cd4a`), each on a fresh throwaway profile. Every run's full transcript and
its `probe.steps` are in the subdirectory named below.

## What was measured

| run | what it did | canvas before | canvas after | GL context |
|---|---|---|---|---|
| `reinitA` | **Screen Resolution** -> 640x480, Apply Changes | 1024x768 | **640x480** | alive, `isContextLost()==false`, 0 events |
| `reinitB` | **Screen Resolution** -> 1024x768, Apply Changes | 1024x768 | 1024x768 (**no change, and correctly so**) | alive |
| `reinitB` (same session) | then **Screen Resolution** -> 800x600, Apply Changes | 1024x768 | **800x600** | alive |
| `reinitC` | Screen Resolution -> 800x600, Apply, then play | 1024x768 | **800x600** | alive, **0 GL errors in 3832 polls**, two full rounds played |
| `winsizeD` | **Window Size** -> 320x200, Apply Changes, then reload | 1024x768 | **1024x768 — nothing, ever** | alive |

No `Aborted(`, no `numVertices`, no `[EXCEPTION]`, no `webglcontextlost` in any
of the four transcripts.

## 1. The live reinit path works

`sr_ReinitDisplay` (`rScreen.cpp`) is `sr_ExitDisplay()` then `sr_InitDisplay()`,
i.e. a second `SDL_SetVideoMode` on a live context. PLAN.md called this
"completely untested … the half that could still need hiding". It is now tested
and it does not need hiding:

    reinitA console.log
    [ 53163ms] [RES] canvas-changed 1024x768 -> 640x480
    [ 53174ms] [harness] key Enter (1/1)
    [ 54915ms] [RES] {"phase":"after-apply-1s","w":640,"h":480,...,"lost":false,"dbw":640,"dbh":480}

(The canvas-change line precedes the `key` line because the driver logs a key
after keyDown + 30 ms + keyUp — see `drive-browser.mjs`. The resize is the
keydown's effect.)

The reason it survives is `SDL_SetVideoMode` in Emscripten's
`src/lib/libsdl.js`: it does **not** create or destroy a GL context. It calls
`Browser.setCanvasSize`, frees the old `SDL.screen` surface and makes a new one.
`sr_ExitDisplay` on the C++ side only runs `rCallbackBeforeScreenModeChange`
and nulls `sr_screen`; it touches no GL object. So "tearing down and rebuilding
a live WebGL context mid-run" is not what this port actually does.

`reinitC` closes it: after a live reinit the game plays two complete rounds at
800x600 with a clean error queue (`06-round1-at-800x600.png`).

## 2. 1024x768 specifically is a no-op because it is already the size

`web/shell.html` gives the canvas `width="1024" height="768"`, and the game
boots on the **Desktop** row (`ARMAGETRON_SCREENMODE 0`), whose size Emscripten's
`SDL_GetVideoInfo` answers with `canvas.width`/`canvas.height`. So the shipped
Demo already renders at exactly 1024x768, and picking the literal "1024 x 768"
row changes nothing — correctly. `reinitB` shows the same session then picking
800x600 and the canvas moving, so this is a no-op by arithmetic, not a broken
path.

## 3. The actual defect: **"Window Size" is dead in this port**

`sg_ScreenModeMenu` (`gMenus.cpp`) builds two `gResMenEntry` items, and `uMenu`
renders in reverse construction order, so the **last-constructed one is the top
row and is the initially selected row**. That is `winsize`, bound to
`currentScreensetting.windowSize`. `01-screen-mode-cursor-is-on-WINDOW-SIZE.png`
shows it: "Window Size: 640 x 480", highlighted, top of the list. "Screen
Resolution" is the row *below* it.

But `lowlevel_sr_InitDisplay` (`rScreen.cpp`) opens with

    rScreenSize & res = currentScreensetting.fullscreen ? currentScreensetting.res
                                                        : currentScreensetting.windowSize;

and this port runs with **`FULLSCREEN 1`** — the game's own default, unchanged,
recorded in every transcript here and in `docs/evidence/m4-persistence/`. So
`windowSize` is never read. Emscripten's `SDL_SetVideoMode` ignores the
`SDL_FULLSCREEN` bit entirely (the canvas is never actually fullscreened), so
the flag's only remaining effect in the browser is to choose **which of the two
menu rows is the live one**.

`winsizeD` proves it end to end. Window Size set to 320x200 — the most extreme
row in the list — Apply Changes pressed, menu left, page reloaded:

    {"phase":"window-size-chosen",       "w":1024,"h":768,"changes":0,"FULLSCREEN":"1","WINSIZE_W":"640","WINSIZE_H":"480"}
    {"phase":"after-apply-windowsize",   "w":1024,"h":768,"changes":0,"FULLSCREEN":"1","WINSIZE_W":"320","WINSIZE_H":"200"}
    {"phase":"after-menu-leave",         "w":1024,"h":768,"changes":0,"FULLSCREEN":"1","WINSIZE_W":"320","WINSIZE_H":"200"}
    {"phase":"boot3-after-boot",         "w":1024,"h":768,"changes":0,"FULLSCREEN":"1","WINSIZE_W":"320","WINSIZE_H":"200"}

The setting is chosen, applied, saved and reloaded, and the canvas never moves.
`changes` is the count of canvas-size transitions the polling probe saw: zero.

This is the report. A player opens Screen Mode, the cursor is already on a
resolution-looking row, they change it, they press Apply Changes, and nothing
happens — with no error anywhere.

## Why M4 did not see it

`persistence-milestone-gate.steps` presses **Down once** before its twenty
Lefts, with the comment "Window Size is the top item; Screen Resolution is one
row below it". It therefore drove the row that works. Nothing was wrong with
that gate; it just never touched the other row.
