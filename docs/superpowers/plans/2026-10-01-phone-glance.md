# Glancing on a phone — plan

**Goal:** on a phone in portrait, while driving, look left, right and back,
and switch the camera view. On desktop these are held keys (GLANCE_LEFT,
GLANCE_RIGHT, GLANCE_BACK) and a pressed key (SWITCH_VIEW).

**Status:** proposal, for the maintainer to approve before building.

## Design

### Gestures (portrait, while driving)

While a cycle is alive, the game picture takes no taps today: `#tapzone` is
hidden under `.aa-driving`. That makes it free for looking.

- **Hold the left half of the picture:** look left while held.
- **Hold the right half:** look right while held.
- **Hold with two fingers anywhere on the picture:** look back.
- **Let go:** look ahead again.
- **Camera button:** a small button in the picture's bottom-right corner
  switches the camera view, once per tap. It shows only while driving.

In menus, and after a crash, the picture keeps its current job: a tap is Enter
or Chat. Landscape is unchanged, because both halves of the screen already
steer there.

### Game side: one new client-only file, no edits to game code

`src/emscripten/eWebLook.cpp`, in `CLIENT_OBJS`:

- `aa_web_look(int bits)`. Bit 1 is left, bit 2 is right, bit 4 is back. It
  only stores the value.
- `aa_web_switch_view()` only counts a request.
- A `rPerFrameTask` (called from `SwapGL`, on the game's own stack, the same
  pattern as `eWebLeave.cpp`) compares the bits with what it last applied.
  - For each change it finds the action with `uAction::Find("GLANCE_LEFT")`
    and its siblings.
  - It calls `uPlayerPrototype::PlayerConfig(0)->Act(action, 1 or 0)`, the
    same call a bound key makes (`src/ui/uInput.cpp:1087`).
  - For each counted switch it acts `SWITCH_VIEW` once.
  - It logs `[LOOK] left on (handled 1)` and similar.
- **Why a task and not a direct call:** the page's touch events can fire while
  the game is paused inside an Asyncify sleep, so the game must only be
  entered from its own loop.
- **Releasing:** when the cycle dies or a menu opens, the page sends
  `aa_web_look(0)`. The task releases whatever is held, so a lifted finger the
  page missed can't leave the camera looking sideways.

### Page side (`web/shell.html`)

- `#lookzone`: a layer over the game square, portrait only, shown only under
  `.aa-driving`.
  - `pointerdown`, `pointermove` and `pointerup`/`pointercancel` track the
    fingers on it.
  - Two or more fingers mean back. Otherwise the side of the remaining finger
    decides left or right.
  - The bits are sent only when they change.
- `#camerabtn`: in the corner of the square, also shown only under
  `.aa-driving`. Its `pointerdown` calls `aa_web_switch_view()`.
- Leaving `.aa-driving` sends `aa_web_look(0)`.
- The pad's touch handling is unchanged.

## Constraints

- **The dedicated wasm stays at 2488298 bytes / `9718a2a64978cb6e9b95ea2f0454cca5`.**
  The new file is client-only, and no shared source changes.
- **Never call into the game from a browser event.** The two exports only
  store a value.
- **The look actions apply only to player 1** (`PlayerConfig(0)`), the local
  player on a phone.

## Tasks

1. **Hook** (`eWebLook.cpp`, Makefile). Gate `look-gate.steps`, emulated
   phone, portrait, in the first-run tutorial round:
   - L1: no `#lookzone` in a menu;
   - L2: `#lookzone` and `#camerabtn` while driving;
   - L3: holding the left half logs `[LOOK] left on (handled 1)`;
   - L4: lifting logs `left off`;
   - L5: two fingers log `back on`;
   - L6: the camera button logs `switch (handled 1)` and changes the view
     (screenshots differ);
   - L7: a crash with the look still held releases it.

   The gate drives real touch events. `drive-browser.mjs` needs
   `touch:down/move/up` steps, because its `tap:` is a single quick tap.
2. **Page:** `#lookzone`, `#camerabtn`, and their CSS and handlers.
3. **Regression and docs:**
   - regression: the portrait and touch gates, the desktop menu gate, the
     pin, bridge tests and shellcheck;
   - docs: the README's phone controls and an evidence README.

## Open questions for the maintainer

- **Two fingers for back,** or a third zone, for example the bottom strip of
  the picture?
- **The camera button's look:** an icon, at 44 px minimum like the other
  controls.
- **Landscape:** leave it out for now (proposed), or add small look buttons
  to the top strip?
