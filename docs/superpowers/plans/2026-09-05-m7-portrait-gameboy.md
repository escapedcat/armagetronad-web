# M7 — Portrait as a Game Boy: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a touch device in portrait, the game draws in a full-width square at the top of the screen and a pad below it (a cross for the four arrows, A = Enter, B = Escape); portrait boots directly into that layout; landscape and desktop are unchanged.

**Architecture:** All in `web/shell.html` (CSS + markup + the sizing block + the touch block) and the gates under `web/tools/`. The pad is six more elements carrying the `data-aakey` attribute inside `#touch`, so the page's existing pointer→`KeyboardEvent` wiring drives them with no new input code. The square is the existing contain-fit rule at aspect 1, top-anchored, and the existing `sizeCanvas()` given a square branch. The portrait hold, prompt, remembered choice and `?portrait=ask` are deleted. Rotation after load keeps the existing bottom chip (reload), now in both directions.

**Tech Stack:** Unchanged — Emscripten 6.0.8 client; the page's own JS; `web/tools/drive-browser.mjs` (CDP) for gates. No C++.

**Spec:** `docs/superpowers/specs/2026-09-05-m7-portrait-gameboy-design.md`

## Global Constraints

- **No C++.** No file under `src/` changes. The dedicated byte pin (2,488,298 / `9718a2a64978cb6e9b95ea2f0454cca5`; Linux 2,488,282 / `ecb69e50…`) is untouched by construction; CI's `checks.yml` enforces it on the PR anyway.
- **Landscape on a phone and everything on a desktop are unchanged.** The gate asserts it (Task 4): with the page NOT in the Game Boy layout, `html` carries no `aa-gameboy` class, `#pad` is not displayed, and every pre-existing touch-gate and menu-gate assertion passes unchanged.
- **The user decides.** A rotation after load never auto-reloads; the chip offers it and says the round restarts.
- New files only under `web/` and `docs/`. Evidence under `docs/evidence/m7-gameboy/`.
- `web/shell.html`'s house style: every non-obvious line carries its reason, and a measurement where one exists. Log lines use the bracketed-tag style (`[DISPLAY]`, `[TOUCH]`, `[BOOT]`).
- Commit messages with backticks go through `git commit -F <file>`; stage named paths only; never `git add -A`; end messages with `Co-Authored-By: Claude <noreply@anthropic.com>`; **never** a `Claude-Session:` trailer or a claude.ai URL. Push after each task.
- **Long commands:** `make client` (a relink, ~1 min; shell.html is embedded at link time — rebuild after every shell.html change) and every gate run go in the background (`nohup … > log 2>&1 &`) and are polled in calls under 2 minutes; the driver writes `<out>/console.log` as it goes. `gh run watch` is forbidden.
- Work in `.worktrees/m7` on branch `m7-gameboy`. Toolchain: `ln -s ../../m5-launch/deps/emsdk deps/emsdk && ln -s ../../m5-launch/deps/build deps/build` once (gitignored), then `source deps/emsdk/emsdk_env.sh && make -f web/Makefile client -j8`. Serve on **port 8008**: `python3 -m http.server 8008 --directory web/dist-m1 &` (8000/8006/8007 belong to other worktrees). Stop the server and leave no Chrome when a task ends.
- Gate runs: `node web/tools/drive-browser.mjs --headed --mobile W,H,DPR --out <dir> --url 'http://localhost:8008/armagetronad.html?autostart=0&touch=1' --script-file <steps>`. Portrait boot = `--mobile 412,915,3`; landscape = `--mobile 915,412,3`. A run must reach `[L] NEW_ROUND` to count; a step file's `eval:` lines are single-line JS.
- No automated test suite exists and none is to be created; verification is console lines, DOM/box measurements read back by `eval:` steps, and screenshots, all committed.

## What reconnaissance established — do not rebuild these assumptions

1. **Key delivery is free.** `web/shell.html` (the touch IIFE, search `const sendKey`) wires every element matching `#touch [data-aakey]` with `pointerdown`/`pointerup`/`pointercancel` → `sendKey('keydown'|'keyup', name)`, dispatching a `KeyboardEvent` at `document`; `KEYCODES` covers ArrowLeft/Right/Up/Down, Enter, Escape. Phase 3 proved the game accepts these regardless of `isTrusted`. New buttons only need `data-aakey`.
2. **Menu/round context is free.** `readContext()` → `Module._aa_web_input_context()`; `touchEl.classList.toggle('aa-driving', driving)` (search `aa-driving`) hides `.tz` in menus and `#tapzone`/`#touchpad` in rounds. The pad must be visible in both states.
3. **Sizing runs before the touch decision.** `sizeCanvas('at load')` (search `function sizeCanvas`) executes at parse time, ~90 lines before the touch IIFE computes `decideTouch()` and sets `window.AA_TOUCH`. The square branch therefore needs the decision hoisted above `sizeCanvas('at load')`. `viewportIsPortrait()` and `readNumberParam` are defined earlier and are usable there.
4. **The contain-fit is a CSS variable.** `#canvas { width: min(100vw, calc(100dvh * var(--aa-aspect, 1.3333))); height:auto }` with a `100vh` fallback line above it; `publishAspect()` inside `sizeCanvas` sets `--aa-aspect` on `<html>` to `canvas.width/canvas.height`. `body` is `display:flex; align-items:center; justify-content:center` — the canvas is centred; portrait needs top-anchoring.
5. **The chip already covers both directions.** `applyOrientation()` sets `chipEl.hidden = (portrait === sizedForPortrait)` (search `applyOrientation`), so the chip appears on any orientation mismatch. Its text says "letterboxed and soft… Reload"; it does not say the round restarts.
6. **What gets deleted** (all in `web/shell.html`): markup `#rotate` with `#rotate-held`, `#rotate-play`, `#rotate-restart` and its comment; CSS `#rotate`, `#rotate .glyph`, `#rotate p`, `#rotate .dim`, `#rotate button`; script `PORTRAIT_KEY`, `readPortraitChoice`, `storePortraitChoice`, `clearPortraitChoice`, `playInPortrait`, `askPortraitAgain`, `window.AA_BOOT_HELD_FOR_PORTRAIT`, `holdPoll`, `window.AA_RELEASE_PORTRAIT_HOLD`, the `rotate-play` click handler, the hold branch inside `onOrientationChange`, and in `onRuntimeInitialized` the `else if (window.AA_BOOT_HELD_FOR_PORTRAIT)` branch. `rotateEl`, `heldNoteEl`, `restartNoteEl` lookups go with them.
7. **Gate files:** `web/tools/touch-gate.steps` (T1…T7; T4 rotates with `metrics:412:915:3` and asserts the rotate prompt — obsolete; T7 is P1–P6 for the "Play in portrait" flow — obsolete) and `web/tools/menu-gate.steps` (desktop; D1 is the sparks check). `docs/evidence/portrait-choice/` documents the flow being removed.
8. **Docs that name the old behaviour:** `README.md` "On a phone it plays…" bullet (portrait prompt sentence); `web/README.md` parameter table row `?portrait=ask` and the "portrait holds the boot" bullet; `PLAN.md` Phase 3 annotations (the M6 paragraph ends the section; the M7 block goes after it, before `### Phase 2`).

---

### Task 1: Portrait boots like landscape — delete the hold, the prompt and the remembered choice

**Files:**
- Modify: `web/shell.html` (markup `#rotate` block; its CSS; the orientation block; `onRuntimeInitialized`)
- Modify: `web/tools/touch-gate.steps` (delete T7; rewrite T4's portrait assertion)
- Evidence: `docs/evidence/m7-gameboy/task1-no-hold/`

**Interfaces:**
- Consumes: recon 6 (the exact deletions), recon 5 (the chip logic that stays).
- Produces: a page whose portrait boot starts `main()` immediately; `applyOrientation()` reduced to the chip; `window.AA_BOOT_HELD_FOR_PORTRAIT` and `window.AA_RELEASE_PORTRAIT_HOLD` no longer exist (Task 2 relies on that: nothing holds the boot).

- [ ] **Step 1: Delete the markup and CSS**

Remove the whole `<div id="rotate" hidden>…</div>` element and the HTML comment block above it that begins `PHONE FEEDBACK: this prompt now HOLDS THE START`. Remove the CSS rules whose selectors start with `#rotate` (five rules). Keep `#reloadchip` markup and CSS.

- [ ] **Step 2: Replace the orientation block**

In the touch IIFE, replace everything from `const PORTRAIT_KEY = 'aa.portrait';` through the `rotate-play` click handler (recon 6 lists every symbol) with:

```js
      // ORIENTATION AFTER LOAD IS A RELOAD, OFFERED, NEVER FORCED. The backing
      // store and the projection are built once, before main() (see sizeCanvas);
      // a rotation after that would need sr_ReinitDisplay, which M5 measured to
      // work and which this page still declines as a larger claim than a reload.
      // The chip below is the offer. It appears whenever the orientation the page
      // is in differs from the one it was sized for -- both directions -- and its
      // text says what the reload costs, which is the round in progress.
      // WHAT USED TO BE HERE: a boot HOLD in portrait, a full-screen "turn your
      // phone" prompt, a remembered "Play in portrait" answer (localStorage
      // aa.portrait) and ?portrait=ask to forget it. M7 made portrait a layout of
      // its own (a square picture, a pad below), so none of that has a job. A
      // returning visitor's stored aa.portrait key is simply never read.
      let mq = null;
      try { mq = window.matchMedia('(orientation: portrait)'); } catch (e) { mq = null; }
      let chipDismissed = false;
      const applyOrientation = () => {
        const portrait = viewportIsPortrait();
        if (!chipDismissed) chipEl.hidden = (portrait === sizedForPortrait);
        console.log('[TOUCH] orientation portrait=' + portrait +
                    ' (sized for portrait: ' + sizedForPortrait + ')');
      };
```

Keep the `reloadchip-go` and `reloadchip-x` handlers. Replace `onOrientationChange` with:

```js
      const onOrientationChange = (why) => { applyOrientation(); };
```

and keep its three registrations (`mq.addEventListener`/`addListener`, `resize`). Delete the `rotateEl`, `heldNoteEl`, `restartNoteEl` lookups near `const touchEl = …`. Find the one remaining call of `applyOrientation()` at the end of the block (after the registrations) and keep it.

- [ ] **Step 3: Remove the hold branch from the runtime start**

In `onRuntimeInitialized` (search `main() HELD in portrait`), delete the `else if (window.AA_BOOT_HELD_FOR_PORTRAIT) { … }` branch so the code reads `if (manual) { … } else { startGame(); }`. Grep the file: `grep -n "AA_BOOT_HELD_FOR_PORTRAIT\|AA_RELEASE_PORTRAIT_HOLD\|PORTRAIT_KEY\|rotate-play\|playInPortrait" web/shell.html` must print nothing.

- [ ] **Step 4: Rebuild and prove it in the gate**

In `web/tools/touch-gate.steps`: delete section T7 entirely (from its `# ====` header to the end of its last step; it is the last section — check the positive-control error step that follows it and keep that). Rewrite T4 so the portrait rotation asserts the new truth:

```
# T4: ORIENTATION. Rotating the emulated phone to portrait MID-GAME shows the
# reload chip and nothing else: no prompt, no hold, the game keeps running.
mark:ROTATE-TO-PORTRAIT
metrics:412:915:3
wait:1500
eval:(()=>{const chip=document.getElementById('reloadchip');const rot=document.getElementById('rotate');const r={chip_visible:!!chip&&!chip.hidden,rotate_element:rot!==null,canvas_w:document.getElementById('canvas').width,canvas_h:document.getElementById('canvas').height};r.PASS=r.chip_visible&&!r.rotate_element;console.log('[M7GATE] T4 rotate-to-portrait '+JSON.stringify(r));return 'T4 '+r.PASS})()
shot:07-portrait-mid-game-shows-only-the-chip
mark:ROTATE-BACK-TO-LANDSCAPE
metrics:915:412:3
wait:1500
eval:(()=>{const chip=document.getElementById('reloadchip');const r={chip_hidden:!!chip&&chip.hidden};r.PASS=r.chip_hidden;console.log('[M7GATE] T4 back-in-landscape '+JSON.stringify(r));return 'T4b '+r.PASS})()
shot:08-back-in-landscape
```

Then a NEW portrait-boot run: copy the steps file's boot prefix (everything up to `mark:GAME-STARTED`) into `web/tools/portrait-boot-gate.steps` and add:

```
# PORTRAIT BOOT, NO HOLD. Before M7 a portrait load held main() until the phone
# turned. Now it boots. (Task 2 makes the picture square; here it is still the
# tall squeeze, which is fine -- the claim under test is only "no hold".)
until:1:90000:[BOOT] autostart
mark:PORTRAIT-BOOTED
eval:(()=>{const held=performance.now();const r={rotate_element:document.getElementById('rotate')!==null,touch_visible:!document.getElementById('touch').hidden};r.PASS=!r.rotate_element&&r.touch_visible;console.log('[M7GATE] PB1 portrait-boot-no-hold '+JSON.stringify(r));return 'PB1 '+r.PASS})()
shot:pb-00-portrait-boot
tap:#tapzone
wait:3000
tap:#tapzone
wait:3500
tap:#tapzone
until:1:120000:[L] NEW_ROUND
mark:PORTRAIT-ROUND-STARTED
shot:pb-01-portrait-round
```

Run: `source deps/emsdk/emsdk_env.sh && make -f web/Makefile client -j8` (background, poll), start the server on 8008, then the touch gate under `--mobile 915,412,3` and the portrait-boot gate under `--mobile 412,915,3`, both into `docs/evidence/m7-gameboy/task1-no-hold/`. Expected in the console logs: no `HOLDING main()` line anywhere; `[M7GATE] PB1 … "PASS":true`; `[M7GATE] T4 … "PASS":true` twice; every pre-existing `PASS":true` of T1b/T1c/T2b/T3b/T6 still present; `[L] NEW_ROUND` reached in both runs.

- [ ] **Step 5: Commit**

Stage `web/shell.html`, `web/tools/touch-gate.steps`, `web/tools/portrait-boot-gate.steps`, and the evidence (console logs + the four screenshots named above). Subject: `Portrait boots: the hold, the prompt and the remembered choice are gone`.

---

### Task 2: The square — CSS aspect 1, top-anchored, and the sizing branch

**Files:**
- Modify: `web/shell.html` (a hoisted touch decision; the `#canvas` CSS; `sizeCanvas`)
- Modify: `web/tools/portrait-boot-gate.steps`
- Evidence: `docs/evidence/m7-gameboy/task2-square/`

**Interfaces:**
- Consumes: Task 1 (portrait boots). Recon 3 and 4.
- Produces: `window.AA_GAMEBOY` (boolean, set before sizing, true iff touch AND portrait at load); `html.aa-gameboy` class; the CSS custom property `--aa-square` (the square's CSS side in px, set by `sizeCanvas`); a square backing store. Task 3 positions the pad with `--aa-square`.

- [ ] **Step 1: Hoist the touch decision above `sizeCanvas('at load')`**

Move the `decideTouch` arrow function out of the touch IIFE to just above `function sizeCanvas`, unchanged, and add immediately after it (before `sizeCanvas`):

```js
    // THE TOUCH DECISION IS MADE HERE, BEFORE SIZING, because the Game Boy
    // layout is a decision about the backing store's SHAPE and sizeCanvas runs
    // at parse time, ~90 lines before the touch block used to decide. Same
    // inputs (?touch= then the media query), same log line, one place.
    const touchDecision = decideTouch();
    window.AA_TOUCH = touchDecision.on;
    console.log('[TOUCH] enabled=' + touchDecision.on + ' (' + touchDecision.why + ')' +
                ' maxTouchPoints=' + (navigator.maxTouchPoints || 0));
    // GAME BOY = a touch device that LOADED in portrait. Landscape keeps the
    // full-screen layout; a desktop never gets this whatever its window shape.
    window.AA_GAMEBOY = window.AA_TOUCH && viewportIsPortrait();
    document.documentElement.classList.toggle('aa-gameboy', !!window.AA_GAMEBOY);
    console.log('[DISPLAY] layout=' + (window.AA_GAMEBOY ? 'gameboy' : 'full'));
```

In the touch IIFE, replace `const decision = decideTouch();` with `const decision = touchDecision;` and delete the IIFE's own `console.log('[TOUCH] enabled=…')` line and its `window.AA_TOUCH = decision.on;` (both now above). Keep `if (!decision.on) return;`.

- [ ] **Step 2: The square branch in `sizeCanvas`**

After `const vw = window.innerWidth, vh = window.innerHeight;` and the `w`/`h` computation, before the `MAX_CANVAS_PIXELS` cap, add:

```js
        // THE GAME BOY SQUARE. Side = the CSS width, capped at 60 % of the CSS
        // height so the pad below keeps at least 40 % on a tall-but-wide tablet.
        // Aspect 1 is the best of the three shapes this game gets on a phone:
        // rViewport::Perspective makes it 90 x 90 degrees (landscape ~111 x 67,
        // full portrait ~131 vertical). docs/evidence/phone-round2/fov/README.md.
        let squareCss = 0;
        if (window.AA_GAMEBOY) {
          squareCss = Math.min(vw, Math.floor(vh * 0.6));
          w = h = Math.floor(squareCss * dpr);
        }
```

After `canvas.width = w; canvas.height = h; publishAspect();` add:

```js
        document.documentElement.style.setProperty('--aa-square',
          window.AA_GAMEBOY ? squareCss + 'px' : '0px');
```

and extend the `[DISPLAY]` log with `(window.AA_GAMEBOY ? ' gameboy square ' + squareCss + 'css' : '')`. The existing area cap and axis clamp still apply after the branch (they keep `w === h` because they scale both axes by one factor).

- [ ] **Step 3: The CSS**

Below the existing `#canvas` rules add:

```css
    /* THE GAME BOY LAYOUT. html.aa-gameboy is set by the script before the
       canvas is sized (see the touch decision above sizeCanvas). The picture is
       a square at the top: the contain-fit rule above already gives height:auto
       from the backing store's aspect, which the sizing block made 1, so only the
       width and the anchoring change. 60dvh is the same cap the sizing block
       applies, so CSS and backing store agree. */
    html.aa-gameboy body    { align-items:flex-start; }
    html.aa-gameboy #canvas { width: min(100vw, 60vh); }
    @supports (height: 100dvh) {
      html.aa-gameboy #canvas { width: min(100vw, 60dvh); }
    }
```

- [ ] **Step 4: Rebuild and prove the square**

Append to `web/tools/portrait-boot-gate.steps`, right after `mark:PORTRAIT-BOOTED`:

```
eval:(()=>{const c=document.getElementById('canvas');const b=c.getBoundingClientRect();const r={backing_w:c.width,backing_h:c.height,css_w:Math.round(b.width),css_h:Math.round(b.height),css_top:Math.round(b.top),inner_w:window.innerWidth,gameboy:document.documentElement.classList.contains('aa-gameboy'),square_var:getComputedStyle(document.documentElement).getPropertyValue('--aa-square').trim()};r.PASS=r.gameboy&&r.backing_w===r.backing_h&&Math.abs(r.css_w-r.css_h)<=1&&r.css_top===0&&r.css_w===r.inner_w;console.log('[M7GATE] PB2 square '+JSON.stringify(r));return 'PB2 '+r.PASS})()
```

Rebuild, serve, run the portrait-boot gate at `--mobile 412,915,3` into `docs/evidence/m7-gameboy/task2-square/`. Expected: `[DISPLAY] layout=gameboy`, `[DISPLAY] at load: … gameboy square 412css`, `[M7GATE] PB2 … "backing_w":1236,"backing_h":1236,"css_w":412,"css_h":412,"css_top":0 … "PASS":true`, and `[L] NEW_ROUND` reached. Also run the LANDSCAPE touch gate at `--mobile 915,412,3` into the same directory: it must print `[DISPLAY] layout=full` and every existing PASS. Open `pb-01-portrait-round.png`: the round is drawn in the top square, the HUD is legible and unclipped (if it is clipped, record it in the README as the open item for Task 5 — do not fix it with C++).

- [ ] **Step 5: Commit**

Stage `web/shell.html`, `web/tools/portrait-boot-gate.steps`, the evidence. Subject: `The Game Boy square: aspect 1 at the top of a portrait phone, backing store to match`.

---

### Task 3: The pad — a cross and two buttons below the square

**Files:**
- Modify: `web/shell.html` (markup inside `#touch`; CSS)
- Modify: `web/tools/portrait-boot-gate.steps`
- Evidence: `docs/evidence/m7-gameboy/task3-pad/`

**Interfaces:**
- Consumes: Task 2's `html.aa-gameboy` and `--aa-square`; recon 1 (any `#touch [data-aakey]` is a key button) and recon 2 (`.aa-driving`).
- Produces: `#pad` with six buttons whose `data-aakey` are `ArrowUp`, `ArrowLeft`, `ArrowRight`, `ArrowDown`, `Escape`, `Enter`; visible only under `html.aa-gameboy`, in both menu and round states.

- [ ] **Step 1: Markup**

Inside `<div id="touch" hidden>`, after the `#touchpad` div, add:

```html
    <!--
      M7, THE PAD. Six elements that carry data-aakey and therefore ride the
      same pointer -> KeyboardEvent wiring as every control above; nothing else
      about them is new. Shown only under html.aa-gameboy (portrait on a touch
      device), in BOTH the menu and the round state -- the cross is Up/Down for
      the menus and Left/Right for the turns, A is Enter, B is Escape. The
      picture above stays a tap-for-Enter surface in menus (#tapzone, clipped to
      the square in the stylesheet) and is inert in a round.
      Every target is >= 56 CSS px on both axes -- above the 44 px this file
      already argues for the menu pad -- because these are held with thumbs, not
      tapped with fingertips.
    -->
    <div id="pad" aria-hidden="true">
      <div id="pad-cross">
        <button type="button" class="pad-btn pad-up"    data-aakey="ArrowUp"    aria-label="Menu up">&#9650;</button>
        <button type="button" class="pad-btn pad-left"  data-aakey="ArrowLeft"  aria-label="Turn left">&#9664;</button>
        <button type="button" class="pad-btn pad-right" data-aakey="ArrowRight" aria-label="Turn right">&#9654;</button>
        <button type="button" class="pad-btn pad-down"  data-aakey="ArrowDown"  aria-label="Menu down">&#9660;</button>
      </div>
      <div id="pad-ab">
        <button type="button" class="pad-btn pad-b" data-aakey="Escape" aria-label="Back or in-game menu">B</button>
        <button type="button" class="pad-btn pad-a" data-aakey="Enter"  aria-label="Enter">A</button>
      </div>
    </div>
```

- [ ] **Step 2: CSS**

Add after the `#touchpad`/`#escbtn` rules:

```css
    /* THE PAD (M7). Hidden unless the html carries aa-gameboy; then it owns
       everything below the square, whatever the menu/round state -- the
       .aa-driving rules above hide the full-screen zones and the strip, and the
       pad replaces them. --aa-square is written by sizeCanvas, so the pad's top
       edge is the square's bottom edge to the pixel. */
    #pad { display:none; }
    html.aa-gameboy #pad {
      display:grid; position:absolute; left:0; right:0;
      top:var(--aa-square, 100vw); bottom:0;
      grid-template-columns: 1fr 1fr; align-items:center; justify-items:center;
      padding: 0 4vw calc(1rem + env(safe-area-inset-bottom, 0px));
      background:#111; }
    html.aa-gameboy .tz, html.aa-gameboy #touchpad, html.aa-gameboy #escbtn { display:none !important; }
    html.aa-gameboy #tapzone { bottom:auto; height:var(--aa-square, 100vw); }
    #pad-cross { display:grid; grid-template-columns:repeat(3, 4rem); grid-template-rows:repeat(3, 4rem); gap:.25rem; }
    .pad-up    { grid-area:1 / 2; }
    .pad-left  { grid-area:2 / 1; }
    .pad-right { grid-area:2 / 3; }
    .pad-down  { grid-area:3 / 2; }
    #pad-ab { display:grid; grid-template-columns:repeat(2, 5rem); grid-template-rows:repeat(2, 5rem); gap:.5rem; }
    .pad-b { grid-area:2 / 1; }
    .pad-a { grid-area:1 / 2; }
    .pad-btn { min-width:56px; min-height:56px; width:100%; height:100%;
               font:700 1.4rem/1 system-ui, sans-serif; color:#eee;
               background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.28);
               border-radius:.6rem; touch-action:none; -webkit-user-select:none; user-select:none; }
    .pad-a, .pad-b { border-radius:50%; }
    .pad-btn.aa-down { background:rgba(255,255,255,.34); }
```

The `#touch [data-aakey]` query in the IIFE picks the six buttons up at load with no script change; `aa-down` is added/removed by the existing handlers.

- [ ] **Step 3: Rebuild and prove the pad, including delivery**

Append to `web/tools/portrait-boot-gate.steps` after `mark:PORTRAIT-BOOTED` (after PB2):

```
eval:(()=>{const sq=document.getElementById('canvas').getBoundingClientRect();const pad=document.getElementById('pad').getBoundingClientRect();const btns=[...document.querySelectorAll('#pad .pad-btn')].map(b=>{const r=b.getBoundingClientRect();return {key:b.dataset.aakey,w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top)}});const r={pad_top:Math.round(pad.top),square_bottom:Math.round(sq.bottom),pad_bottom:Math.round(pad.bottom),inner_h:window.innerHeight,buttons:btns};r.PASS=Math.abs(r.pad_top-r.square_bottom)<=1&&btns.length===6&&btns.every(b=>b.w>=56&&b.h>=56&&b.top>=r.square_bottom)&&['ArrowUp','ArrowLeft','ArrowRight','ArrowDown','Escape','Enter'].every(k=>btns.some(b=>b.key===k));console.log('[M7GATE] PB3 pad-geometry '+JSON.stringify(r));return 'PB3 '+r.PASS})()
shot:pb-02-pad
```

Replace the three `tap:#tapzone` menu taps with the pad: `tap:.pad-a` (three times, same waits) — the menus must be reachable by A alone — and after `mark:PORTRAIT-ROUND-STARTED` add the delivery proof, modelled on T3's counters:

```
wait:2500
tap:.pad-left
wait:1200
tap:.pad-right
wait:1200
eval:(()=>{const r={ctx:Module._aa_web_input_context()|0};console.log('[M7GATE] PB4 pad-turns-sent '+JSON.stringify(r));return 'PB4'})()
shot:pb-03-after-pad-turns
```

The delivery assertion is the game's own: read `web/tools/touch-gate.steps` T3 for how it reads the turn tooltip counters (`uActionTooltip`, via the eval it already uses) and copy that eval here as PB4's PASS — both counters must have decreased by one after the two taps. Then Escape/menu round-trip: `tap:.pad-b`, `wait:1500`, `shot:pb-04-in-game-menu-via-B`, `tap:.pad-down`, `wait:800`, `tap:.pad-up`, `wait:800`, `tap:.pad-b`, `wait:1500`, eval asserting `readContext()`-equivalent (`Module._aa_web_input_context()` has the DRIVING bit and not the MENU bit) → `[M7GATE] PB5 menu-roundtrip-via-pad {"PASS":true}`.

Rebuild, serve, run at `--mobile 412,915,3` into `docs/evidence/m7-gameboy/task3-pad/`. Expected: PB2, PB3, PB4, PB5 all `"PASS":true`; `[L] NEW_ROUND` reached by A alone; `pb-02-pad.png` shows the cross left and A/B right below the square.

- [ ] **Step 4: Commit**

Stage `web/shell.html`, `web/tools/portrait-boot-gate.steps`, the evidence. Subject: `The pad: a cross and two buttons below the square, six keys and no new input code`.

---

### Task 4: Rotation, and proof that landscape and desktop did not move

**Files:**
- Modify: `web/shell.html` (the chip's text)
- Modify: `web/tools/portrait-boot-gate.steps`, `web/tools/menu-gate.steps`
- Evidence: `docs/evidence/m7-gameboy/task4-unchanged/`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: the chip reads the same in both directions and names the cost; a committed landscape DOM reference the gate compares against.

- [ ] **Step 1: The chip's words**

Change `#reloadchip`'s span text to: `Rotated — the game is still laid out for the shape it loaded in. Reload to lay it out for this one (the round restarts).` Keep both buttons.

- [ ] **Step 2: Portrait → landscape after load**

Append to `web/tools/portrait-boot-gate.steps`:

```
mark:ROTATE-TO-LANDSCAPE-AFTER-PORTRAIT-BOOT
metrics:915:412:3
wait:1500
eval:(()=>{const chip=document.getElementById('reloadchip');const r={chip_visible:!!chip&&!chip.hidden,still_gameboy:document.documentElement.classList.contains('aa-gameboy'),canvas_w:document.getElementById('canvas').width,canvas_h:document.getElementById('canvas').height};r.PASS=r.chip_visible&&r.still_gameboy&&r.canvas_w===r.canvas_h;console.log('[M7GATE] PB6 rotate-after-portrait-boot '+JSON.stringify(r));return 'PB6 '+r.PASS})()
shot:pb-05-landscape-after-portrait-boot-chip
```

(The layout stays Game Boy until a reload — that is the design; the chip is the offer.)

- [ ] **Step 3: Landscape unchanged — a DOM reference**

In `web/tools/touch-gate.steps`, right after `mark:GAME-STARTED`, add:

```
eval:(()=>{const t=document.getElementById('touch');const vis=[...t.querySelectorAll('*')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.id||e.className).join(',');const r={layout:document.documentElement.classList.contains('aa-gameboy')?'gameboy':'full',visible:vis,pad_display:getComputedStyle(document.getElementById('pad')).display};r.PASS=r.layout==='full'&&r.pad_display==='none';console.log('[M7GATE] L1 landscape-unchanged '+JSON.stringify(r));return 'L1 '+r.PASS})()
```

Run the touch gate at `--mobile 915,412,3` into `docs/evidence/m7-gameboy/task4-unchanged/`; copy the `visible:` string from the L1 line into `docs/evidence/m7-gameboy/landscape-visible-reference.txt` and add to the README that it is the reference future runs compare against. Every pre-existing PASS must still be present.

- [ ] **Step 4: Desktop unchanged**

In `web/tools/menu-gate.steps`, after the D1 check, add:

```
eval:(()=>{const r={layout:document.documentElement.classList.contains('aa-gameboy')?'gameboy':'full',pad_display:getComputedStyle(document.getElementById('pad')).display,touch_hidden:document.getElementById('touch').hidden};r.PASS=r.layout==='full'&&r.pad_display==='none'&&r.touch_hidden;console.log('[M7GATE] D2 desktop-unchanged '+JSON.stringify(r));return 'D2 '+r.PASS})()
```

Run the desktop gate (no `--mobile`) into the same directory. Expected: `[M7GATE] D2 … "PASS":true` and every pre-existing PASS.

- [ ] **Step 5: Commit**

Subject: `Rotation is an offered reload in both directions, and landscape and desktop are proven unmoved`.

---

### Task 5: Docs, the plan's close, the evidence index, the PR

**Files:**
- Modify: `README.md`, `web/README.md`, `PLAN.md`
- Create: `docs/evidence/m7-gameboy/README.md`
- Delete nothing under `docs/evidence/portrait-choice/` (history); add one line to its README saying M7 replaced the flow.

- [ ] **Step 1: README.md**

In the "On a phone it plays…" bullet, replace the portrait sentences with: `In portrait the game is a square at the top of the screen with a Game Boy pad below it — a cross for the arrows, A for Enter, B for Escape — and it looks better than landscape does (the square is the aspect the game's projection was designed near). Rotating after load offers a reload; it never forces one.`

- [ ] **Step 2: web/README.md**

Delete the `?portrait=ask` table row. Rewrite the "portrait holds the boot" bullet as "portrait is the Game Boy layout": what `html.aa-gameboy` is, that the decision is touch AND portrait at load, the 60 % cap, the pad's keys, that the chip is the only rotation handling, and that `localStorage aa.portrait` is no longer read.

- [ ] **Step 3: PLAN.md**

After the last M6 paragraph in the Phase 3 section (before `### Phase 2`), add an `**M7 — portrait as a Game Boy (2026-09-05): shipped.**` block-quote paragraph: the layout, why the square (the FOV numbers), what was deleted, the gates (PB1–PB6, T4, L1, D2), what stays open (live re-layout; a brake button; HUD legibility if Task 2 recorded it; iOS untested).

- [ ] **Step 4: The evidence index**

`docs/evidence/m7-gameboy/README.md`: one section per task with the gate lines quoted and the screenshots named; the landscape reference file explained; the "measured on Chrome device emulation, not a device" caveat once.

- [ ] **Step 5: Commit, push, PR**

Subject: `M7 — portrait as a Game Boy: documented, indexed, and the plan closed`. Push. `gh pr create --base main --head m7-gameboy --title "M7 — portrait as a Game Boy: a square picture above, a pad below"` with a body of the README sentence, the deletions, the gates and their results, the open items, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)` and no other link. The three required checks must pass.

---

## Self-review

- **Spec coverage:** square at the top / 60 % cap → Task 2; pad with cross + A/B ≥ 56 px, both states, tap-on-picture = Enter in menus only → Task 3 (the `#tapzone` clip and the `.aa-driving` interplay); boot without hold/prompt/choice/`?portrait=ask` → Task 1; reload-on-rotate both directions with the cost named → Task 4 + recon 5; landscape and desktop unchanged, asserted → Task 4 (L1, D2); HUD legibility as a recorded check → Task 2 Step 4; docs and PLAN → Task 5; no C++ → Global Constraints.
- **Placeholders:** none; every step carries its code or its exact command. The one delegated read is Task 3's PB4 counter eval, which copies an existing eval by name from T3.
- **Consistency:** `window.AA_GAMEBOY`, `html.aa-gameboy`, `--aa-square`, `#pad`, `.pad-btn`, `.pad-a/.pad-b`, the six `data-aakey` values, `[M7GATE]` tags PB1–PB6 / T4 / L1 / D2, and `web/tools/portrait-boot-gate.steps` are named identically in every task that uses them.
