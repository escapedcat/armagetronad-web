# M7 — Portrait as a Game Boy: a square picture above, a pad below

**Status:** design for the maintainer's review, 2026-09-05. Nothing implemented.

## What the maintainer asked for

> "how would it feel if it's a real gameboy kinda handling? so crossarrows and button on the lower 50% of the screen and screen above? instead of full screen portrait mode?"

Portrait on a phone becomes a first-class layout: the game draws in a **square** at the top of the screen, and the bottom of the screen is a **pad** — a cross for the four arrow keys and two round buttons for Enter and Escape. Landscape is untouched. Today's portrait machinery — the boot hold, the "turn your phone sideways" prompt, the "Play in portrait" button and its remembered choice, `?portrait=ask` — is removed, because portrait is simply supported.

## Why this shape (facts, not taste)

1. **The picture gets better, not just smaller.** `rViewport::Perspective` derives the field of view from the viewport aspect: at a phone's landscape aspect (~2.2) it opens to ~111° horizontal with the vertical pinned at 67°, which is why the bike looks small and far away; at full-screen portrait (~0.45) it becomes a ~131° vertical squeeze (what the maintainer saw and called "drawn far too tall"). At **1:1** it is 90° by 90° — the closest of the three to the 4:3 desktop the game was drawn for. `docs/evidence/phone-round2/fov/README.md` has the table. No C++: the projection follows the canvas shape.
2. **Thumbs come off the picture.** Today's turn zones are the two halves of the view; the pad puts both thumbs where a handheld's are and nothing occludes the action. It also retires the class of defect Phase 3 shipped once (turn zones live inside menus changed the selected row's value on a stray tap).
3. **The controls are honest buttons.** The game is four keys plus Enter and Escape — exactly a cross and two buttons. Each button synthesizes the same `KeyboardEvent` the current overlay does (`web/shell.html`, the `document.dispatchEvent(new KeyboardEvent(...))` path Phase 3 proved delivers regardless of `isTrusted`), so each is assertable in the gate by the key it sends.
4. **Fewer pixels.** The square is ~45 % of a 412×915 portrait screen. The port is CPU-bound, so this is a small win, not the point.

## Layout

- **When:** the page's existing touch decision (`window.AA_TOUCH`, `web/shell.html`) is true AND the viewport is portrait (`viewportIsPortrait()`, the existing helper) at load. Desktop windows, however tall, are unchanged. Landscape on a phone is unchanged.
- **The picture:** width = the full CSS viewport width; height = width (aspect 1, i.e. `--aa-aspect: 1` for the existing contain-fit rule `width: min(100vw, calc(100dvh * var(--aa-aspect)))`, anchored to the top instead of centred). Backing store = side × `devicePixelRatio` on both axes, under the existing 3840×2160 area cap. On a 412×915 CSS phone at dpr 3 that is a 1236×1236 drawing buffer and a 412 px CSS square.
- **The pad:** everything below the square — 503 CSS px on that phone. If the remainder would be under 40 % of the viewport height (very wide portrait tablets), the square's side is capped at 60 % of the height so the pad keeps its room. Left half: a cross of four buttons (Up, Left, Right, Down) with the pad's centre for the thumb; right half: two round buttons, **A = Enter**, **B = Escape**, in the handheld arrangement (A right and slightly above B). Every hit target ≥ 56 CSS px on both axes (the file's own 44 px minimum comfortably cleared). Labels on the buttons say what they send (arrows, "A ⏎", "B ⎋").
- **Tapping the picture:** in a menu, a tap on the picture is Enter — today's tap layer, gated by `aa_web_input_context()` (`src/emscripten/eWebInput.cpp`, already exported), stays; during a round the picture is inert — the pad turns. The `#escbtn` corner button and the `#touchpad` Up/Down strip are not shown in portrait; the pad replaces them.
- **Timing:** Left/Right send keydown on touchstart and keyup on touchend (the game turns on keydown, as the tap/Escape work established); Up/Down/A/B the same. Multi-touch: the cross and the buttons are independent touch targets, so Left held plus A works.
- **HUD:** at 1:1 the game's HUD (score, speed gauge, the FPS line) was designed for wider aspects. Acceptance is a committed screenshot of a round in the square showing the HUD legible and unclipped; if it clips, the fix is sought in existing config items first (HUD scale / font), never in C++ for this milestone.

## Boot and rotation

- **Boot in portrait:** no hold, no prompt. The canvas is sized square before `main()` (the existing `sizeCanvas()` path, which already sizes once before boot), and the game starts. The `aa.portrait` localStorage key, `?portrait=ask`, `#rotate`, `#rotate-play`, `#rotate-held`, `#rotate-restart` and `AA_BOOT_HELD_FOR_PORTRAIT` / `AA_RELEASE_PORTRAIT_HOLD` are removed; a stale `aa.portrait` key in a returning visitor's storage is ignored (read nowhere).
- **Rotation after load:** the backing store is built once; a rotation is offered as a reload through the existing bottom chip (`#reloadchip`), in both directions — portrait→landscape and landscape→portrait. **This is the assumption to overrule:** live re-layout via `sr_ReinitDisplay` was measured to work in M5 (context survives, the game plays on at the new size) and declined twice as a larger claim than a reload; it is the natural follow-up if reloading grates. The round is lost on reload; the chip says so.
- **Landscape boot:** byte-for-byte today's behaviour — the same DOM, the same zones, the same strip and corner button. The gate asserts the landscape box tree is unchanged.

## What does not change

No C++ (the dedicated byte pin is untouched by construction; the CI check enforces it anyway). No new URL parameters beyond the removal of `?portrait=ask`; `?touch=`, `?cam=`, `?sparks=`, `?dpr=` keep their meaning. The desktop experience is not touched (the maintainer's standing constraint). Sparks, trail length and every M6 lever are out of scope.

## Gates (extend `web/tools/touch-gate.steps`; evidence under `docs/evidence/m7-gameboy/`)

1. Portrait boot at `--mobile 412,915,3`: `canvas.width === canvas.height` (backing store square), the CSS square's top at 0 and its width the viewport width, the pad's box entirely below it, six pad buttons each ≥ 56×56 CSS px, no `#rotate` element, no hold in the console (`HOLDING main()` absent), `[L] NEW_ROUND` reached by the pad alone (A through the menus).
2. Delivery: Left and Right on the pad spend the game's own turn-tooltip counters (the `uActionTooltip` counters Phase 3's gate reads); Up/Down/A/B navigate into a submenu and back out (screenshots).
3. Rotate to landscape after load: the chip appears; rotate back: it hides. Landscape boot: the existing landscape assertions pass unchanged, and a DOM snapshot of the landscape overlay equals a committed reference.
4. Desktop (`menu-gate.steps`): no pad, no square; the existing assertions pass.
5. Two screenshots for the eye: a round in the square (HUD legibility; the bike visibly larger than in the landscape shot beside it) and the pad.

## Files

- `web/shell.html`: the layout CSS (a portrait rule setting `--aa-aspect: 1`, top-anchored, and the pad's grid), the pad markup, the pad's touch handlers (reusing the existing key-synthesis function), the portrait branch in the sizing block, removal of the hold/prompt/choice code and markup, the reload chip made two-directional.
- `web/tools/touch-gate.steps`: the gates above. `docs/evidence/m7-gameboy/`: logs, screenshots, README.
- `README.md` ("On a phone" section), `web/README.md` (the parameter table loses `?portrait=ask`; the portrait paragraph rewritten), `PLAN.md` (an M7 block under Phase 3).

## Out of scope, recorded

Live re-layout on rotation (follow-up if reload grates). A brake button (the game has one, `V`; Phase 3 dropped it as not minimal; the pad has room — a later decision). Cheaper sparks (fewer particles instead of none — an engine change, parked from M6). iOS Safari remains untested.
