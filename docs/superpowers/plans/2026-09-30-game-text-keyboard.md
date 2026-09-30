# Phone keyboard in the game's own text fields — plan

Replaces the first mobile-keyboard plan
([2026-09-30-mobile-keyboard.md](2026-09-30-mobile-keyboard.md)): its name
dialog and chat bar were a second UI on top of the game. Agreed after a
throwaway spike the maintainer tried on his phone.

## Design

- **The game's own text fields get the typing.** A hidden `<input>` exists only
  to bring up the phone keyboard. Its changes are diffed (common prefix, then
  backspaces for what went, characters for what came) and sent as synthetic
  key events. For each character that's a keydown, then a keypress with
  `charCode`: Emscripten's SDL 1 copies that into `keysym.unicode`, and
  `uMenuItemString::Event` inserts 32–255. The diff handles suggestions and
  autocorrect, which rewrite whole words.
- **The game says when a text field is highlighted.** `uMenuItemString::Render`
  stamps a time when it draws selected. `aa_web_text_selected()` returns 1 if
  that was within 0.3 s. It's client-only, in `src/emscripten/eWebKeyboard.cpp`.
  This covers Player Setup, First Setup, Custom Connect and the in-game chat
  line (Enter during a round, `config/default.cfg`).
- **Open and close.** The page polls every 100 ms. Moving onto a text field
  opens the keyboard: the tap that moved there is the user activation Android
  needs. Moving off closes it. The keyboard's Enter sends Return and closes.
  Folding the keyboard away releases the field, so it doesn't pop back. A tap on
  the game picture (not on the pad) while on a field brings it back.
- **No leaks.** The hidden input's own key events stop at the input. Only the
  synthetic ones reach SDL.
- **Removed from PR #60:**
  - the name dialog and its first-visit prompt, with `?askname=0`;
  - the 💬 bar and button;
  - the Name button and `#aa-corner`;
  - `eWebText.cpp` and the page→game text queue.
- **Kept from PR #60:**
  - `web_NNNN` default names (`Module.ENV.USER`);
  - `interactive-widget=resizes-visual`.
- **Layout button:** icon only, and the `aria-label` names the target layout.

## Constraints

- **Dedicated wasm stays at 2488298 bytes / `9718a2a64978cb6e9b95ea2f0454cca5`.**
  `uMenu.cpp` is compiled into it too.
- **Never call a wasm export with a string from a browser event.** Only
  `aa_web_text_selected()` is read, and it takes no arguments.

## Tasks

1. **Game hook** (`eWebKeyboard.cpp`, the `uMenu.cpp` stamp, the Makefile) and
   removal of `eWebText.cpp`. Check the pin.
2. **Page.** `shell.html` from main, plus: the viewport setting, the default
   name, the icon-only layout button, and the keyboard block. Revert the
   `askname=0` edits in the older gates.
3. **Gates.**
   - `game-keyboard-gate.steps`, portrait:
     - K1: no keyboard on Accept;
     - K2: ▼ onto Name opens it;
     - K3: typed text reaches the game's field;
     - K4: a rewritten suggestion ends up exact;
     - K5: a real key typed into the input arrives exactly once;
     - K6: the keyboard's Enter closes it and doesn't reopen;
     - K7: ▲ off the field closes it.
   - `run-text-net-gate.sh`, rewritten: join the local server, Enter opens the
     game's chat line and the keyboard, type, Enter. The server log must show
     `CHAT web_NNNN …`.
   - Delete `text-bridge-gate` and `text-ui-gate`. Keep `default-name-gate`.
4. **Regression and docs:** the portrait gate, the desktop menu gate, the pin,
   bridge tests, shellcheck; the README and the evidence README.
