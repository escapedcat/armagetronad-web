# Menu flicker — measured, explained, fixed

**2026-09-30.** Reported from real play: the screen flickered a lot while the
menu fetched servers, and while the in-game menu was open on a server waiting
for players.

## How it was measured

A `requestAnimationFrame` loop copies the game canvas into a 64×48 thumbnail on
every browser frame and records its mean brightness: what the browser could
show at that moment. The canvas keeps its drawing buffer
(`preserveDrawingBuffer`), so the copy is exactly what was on screen. The
sampler is in `web/tools/menu-flicker-gate.steps`.

## What causes it

The browser shows the canvas whenever the game hands it control. This game
hands it control in the **middle** of frames: the menu loop clears the canvas
right after each swap, then does its network work before drawing, and that
work pauses (Asyncify) in `tDelay`, `eWebNet::Poll`, the client's sync-ack
wait, and the socket waits. Every one of those pauses showed a cleared or
half-drawn canvas.

A diagnostic build tagged every pause site. During the in-game menu, 100 % of
the black frames fell inside `tDelay` or `eWebNet::Poll` pauses; during the
connect-and-fetch phase, inside the master-server connection's waits. Some of
those waits cannot be removed, because the browser has to deliver the data
they wait for. So the fix does not try to avoid pausing. It makes a pause
harmless.

## The fix

**The game draws into a hidden framebuffer, and the visible canvas is updated
only when a frame is finished** (`web/library_present.js`, plus
`-sOFFSCREEN_FRAMEBUFFER=1` in `web/Makefile`). A pause anywhere now shows the
last finished frame.

This is the idea PR #43 shipped and #44 reverted, because it squeezed the
picture. Two bugs in how it used Emscripten's helper caused that, and both are
fixed here:

1. **The copy ran through whatever viewport the game had left set.** The game
   draws into sub-rectangle viewports, so the copy landed in a sub-rectangle.
   It now sets a full-canvas viewport for the copy and restores the game's.
2. **The hidden framebuffer kept its startup size,** because only
   `emscripten_set_canvas_element_size` resizes it, and this page never calls
   that. It now follows the drawing buffer's size, colour and 24-bit depth
   together (`[PRESENT] hidden framebuffer startup -> 1236x1236, depth bits 24`
   on the phone layout).

## Results

**In-game menu while the server waits for players** — the hermetic gate
(`sh web/tools/run-menu-flicker-gate.sh`, a local server needing two players,
no AIs):

| build | black frames in the menu | while waiting, no menu |
|---|---|---|
| before (`before/`) | **46** of 529 | 21 |
| after (`after/`) | **0** of 569 | 0 |

**Fetching the server list** — against the live relay and real servers
(`scan-series.txt`). Before, the log screen was mostly pure black, with its
text flashing up for a single frame at a time. After, the log text stays
visible, steadily, until the server browser appears. The scan itself, once the
list is in, showed no black frames on either build.

## Regression checks

- **Phone portrait gate:** 10/10, and the screenshots were compared side by
  side with the old build's (in a round and in the in-game menu): same square,
  same proportions. That is the check #43 lacked.
- **Desktop menu gate:** 10/10 distinct screenshots; the picture is normal.
- **Dedicated wasm:** 2,488,298 bytes, md5 `9718a2a64978cb6e9b95ea2f0454cca5`,
  unchanged.
- **Bridge tests:** 87/87.

## Not measured here

The cost of the extra full-screen copy on a real phone. Headless Chrome renders
in software, so its frame rates say nothing about a phone's GPU. Check the
in-game FPS readout on the phone after deploying.

## Two dead ends, recorded so they are not tried again

- **Skipping mid-frame pauses** (don't yield if the last frame is under 50 ms
  old, with a safety valve). This removed the black frames in the in-game menu
  from 46 to 7, but did nothing for the fetch. Real network waits there run
  longer than any safe threshold. Dropped in favour of the hidden framebuffer,
  which covers every case.
- **Switching off the console's per-line frames after the list fetch.** A
  measurement first seemed to blame them for the scan's black frames. Logging
  every line that triggered one showed they only happen during the fetch
  screen, by design, and switching them off afterwards changed nothing.
  Reverted.
