# One player on a phone — plan

**Goal:** on a phone, Player Setup offers only what a phone can use: Player 1.
Desktop keeps local split-screen, which works.

**Status:** proposal, for the maintainer to approve before building.

## What was found (2026-10-01, headless desktop Chrome)

- **Player Setup** (`sg_PlayerMenu()`, `src/tron/gMenus.cpp:1147`) lists:
  - Player 1–4 Settings;
  - Viewports, the split-screen layout, saved as `VIEWPORT_CONF`
    (`src/render/rViewport.cpp:211`; 0 = single, 1 = horizontal split);
  - Assign Viewports to Players.
- **Split-screen works in the browser on desktop.** With Viewports set to
  Horizontal Split, a local game shows two views with two HUDs. The
  per-player turn counters (`CYCLE_TURN_RIGHT_TOOLTIP`) show both players
  steer:
  - before: `0 3 1 1 1`;
  - after F, player 2's turn key: `0 3 0 1 1`, so player 2 turned;
  - after Right, player 1's key: `0 2 0 1 1`, so player 1 turned.
- **On a phone it can't work.**
  - The pad's arrows are player 1's keys, so players 2–4 can't be steered.
  - A split screen halves the picture and adds a cycle nobody steers.
  - Online, that extra player would also join from the relay's shared
    address.

## Design

- **Phones:** Player Setup shows only **Player 1 Settings** and Exit Menu.
  Players 2–4, Viewports and Assign Viewports are not shown.
- **Phones boot single-screen.** The page appends `VIEWPORT_CONF 0` to the
  startup config on a touch device, as it does for the camera hints. That
  file is read after `user.cfg`, so a phone already set to split goes back to
  one screen.
- **Desktop:** unchanged.

### The game side

- **Is this a touch device?** The game asks the page:
  `EM_JS(int, aa_js_is_touch, (), { return window.AA_TOUCH ? 1 : 0; })`, in
  a client-only file (`src/emscripten/eWebTouch.cpp`, in `CLIENT_OBJS`). It's
  a call from the game into the page, so it can't re-enter the game.
- **The menu edit** goes in `sg_PlayerMenu()`, guarded
  `#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)`:
  - On touch, players 2–4 aren't added. `names[i]` is only created for
    `i == 0`, and the delete loop already copes with null.
  - The two viewport items, today stack objects, are created only off-touch.
  - `gMenus.cpp` is compiled into the dedicated server, so the edit must be
    line-neutral: the guarded lines take the place of blank lines in the same
    function. The pin check proves it.

## Constraints

- **The dedicated wasm stays at 2488298 bytes / `9718a2a64978cb6e9b95ea2f0454cca5`.**
- **The native build doesn't change:** the guard keeps the edit out of it.

## Tasks

1. **Test first:** `web/tools/one-player-gate.steps`.
   - **Phone** (`--mobile 412,915,3`):
     - P1: Player Setup lists Player 1 Settings and Exit Menu only. Read from
       a screenshot, and from `[MENU]` lines the hook logs per item if
       needed.
     - P2: the startup config has `VIEWPORT_CONF 0`.
     - P3: a phone whose saved config says `VIEWPORT_CONF 1` boots
       single-screen.
   - **Desktop:** all four players and both viewport items are listed, and
     the split from this analysis still works (the turn counters move for
     both players).
2. **Build:** `eWebTouch.cpp`, the `gMenus.cpp` edit, the `VIEWPORT_CONF 0`
   append, the Makefile.
3. **Regression:** portrait, keyboard, look and desktop menu gates, the pin,
   and the README's phone notes.
