#!/usr/bin/env node
// Build the two backstop-disabled control pages for the M4 Task 2 gate.
//
//   source deps/emsdk/emsdk_env.sh
//   make -f web/Makefile client client-control -j8
//   node docs/evidence/m4-persist-settings/make-settings-control-pages.mjs
//   # writes web/dist-m1/armagetronad-nobackstop.html
//   #        web/dist-m1/armagetronad-nomenusave-nobackstop.html
//
// THE CONTROL MATRIX. Two independent mechanisms, so four pages. Each is
// driven with the ordinary gate script and scored with the ordinary checker;
// only the --url changes:
//
//   node web/tools/drive-browser.mjs --headed --out /tmp/<name> \
//        --url http://localhost:8000/armagetronad-<name>.html \
//        --script-file web/tools/persist-settings-gate.steps
//   node docs/evidence/m4-persist-settings/check-settings-transcript.mjs \
//        /tmp/<name>/console.log
//
// MEASURED, not predicted -- every row below was run and the transcript is
// committed beside this file:
//
//   PAGE                        menu-leave save   JS backstop   RESULT
//   armagetronad (Chrome)       yes               yes           PASS 18/18
//   armagetronad (Firefox)      yes               yes           PASS 18/18
//   armagetronad-nobackstop     yes               no            PASS 18/18
//   armagetronad-nomenusave     no                yes           FAIL  S6 S7 S8
//                                                                     S12 S16
//   armagetronad-nomenusave-
//     nobackstop                no                no            FAIL  the same
//                                                                     plus S10
//                                                                     and S13
//
// ROW 2 IS THE POINT OF THIS FILE, and it is the row that proves a NEGATIVE:
// the gate must pass with both unload handlers disabled. That is what "the
// backstop is not load-bearing" means as a fact rather than an intention.
// Check S9 covers the pre-reload half of that claim from a single transcript;
// only this control covers the post-reload half.
//
// ROWS 3 AND 4 NEED A SECOND LINK, NOT A PAGE EDIT, and cannot be produced
// here: the mechanism they remove lives in the wasm. web/Makefile's
// client-control target builds armagetronad-nomenusave.{html,js,wasm,data}
// with src/emscripten/eWebPersist.cpp's uCallbackMenuLeave registration
// compiled out. This file only adds the backstop removal on top of it.
//
// WHAT ROWS 3 AND 4 SHOWED, and the difference between them is itself the
// measurement:
//
//   nomenusave              S6 S7 S8 S12 S16 fail: nothing in the game saves
//                           the player's change, and IndexedDB still holds the
//                           default name when the gate reads it before the
//                           reload. But S10 PASSES, and that is not a weakness
//                           -- it is the backstop doing its job in a real
//                           browser with nothing synthetic about it. With no
//                           in-game save at all, the name still survives the
//                           reload because beforeunload caught it.
//
//                           S13 ALSO PASSES HERE, and the reason is worth
//                           writing down because it was NOT predicted. Because
//                           the backstop persisted FIRST_USE 0, boot 2 opens
//                           on the MAIN menu, and gArmagetron.cpp calls
//                           st_SaveConfig() unconditionally after MainMenu()
//                           returns -- so the gate's Escape rewrites the
//                           clobbered file through a pre-existing path even
//                           with this task's callback compiled out. S13's
//                           claim ("the value is in the running program's
//                           memory") is still true and still worth checking;
//                           it is simply not evidence FOR the menu-leave save.
//                           S12 is the check that is.
//   nomenusave-nobackstop   the same failures plus S10 and S13. Boot 2 opens
//                           on the language menu instead (FIRST_USE was never
//                           persisted as 0), so nothing rewrites the clobbered
//                           file and nothing survives the reload.
//
//   Both are SLOW: four of the gate's `until:` steps can never be satisfied,
//   so budget ~2 minutes of deliberate timeout per run. Those timeouts are
//   themselves check S16.
//
// THESE ONLY EDIT THE GENERATED HTML, never web/shell.html. The .html em++
// emits is a plain text file that loads its .js from beside it, so a copy in
// the same directory shares the loader, the wasm and the .data archive with
// the page it was copied from -- EXCEPT that the copy must keep loading the
// RIGHT one. armagetronad-nomenusave.html already names armagetronad-
// nomenusave.js, so copying it preserves that; nothing here rewrites script
// src attributes and nothing should.
//
// Rebuilding the client overwrites armagetronad.html but NOT these copies, so
// re-run this tool after any relink or the controls are measuring a stale page.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Matched as literal text, exactly as web/shell.html writes it. A regex would
// keep working after a rename and silently produce a page identical to the
// real one -- which would make the control PASS and be read as "the check is
// bogus". A literal match breaks loudly instead.
//
// DISABLING THE BODY RATHER THAN REMOVING THE LISTENERS is deliberate. The
// listeners staying registered means the control differs from the real page in
// exactly one thing: whether the save is issued. Removing addEventListener
// calls would also change how many handlers run during unload, which is not
// the variable under test.
const GUARD = `      if (!gameStarted) return;\n`;
const OFF = `      if (true) return; // [control] backstop disabled by make-settings-control-pages.mjs\n`;

function disableBackstop(html, src) {
  const n = html.split(GUARD).length - 1;
  if (n !== 1) {
    console.error(`make-settings-control-pages.mjs: expected exactly 1 occurrence of the backstop guard in ${src}, found ${n}.`);
    console.error('The shell page has changed shape; update this tool rather than loosening the match.');
    process.exit(2);
  }
  return html.replace(GUARD, OFF);
}

const out = (name, html, note) => {
  writeFileSync(`web/dist-m1/armagetronad-${name}.html`, html);
  console.log(`wrote web/dist-m1/armagetronad-${name}.html`.padEnd(58) + note);
};

const REAL = 'web/dist-m1/armagetronad.html';
const CONTROL = 'web/dist-m1/armagetronad-nomenusave.html';
for (const p of [REAL, CONTROL]) {
  if (!existsSync(p)) {
    console.error(`make-settings-control-pages.mjs: ${p} is missing.`);
    console.error('Run: make -f web/Makefile client client-control -j8');
    process.exit(2);
  }
}

out('nobackstop', disableBackstop(readFileSync(REAL, 'utf8'), REAL),
  '(menu-leave save KEPT, backstop OFF -- expected PASS 18/18)');
out('nomenusave-nobackstop', disableBackstop(readFileSync(CONTROL, 'utf8'), CONTROL),
  '(menu-leave save GONE, backstop OFF -- expected FAIL incl. S10)');
