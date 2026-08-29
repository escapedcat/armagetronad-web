#!/usr/bin/env node
// Build the ORDERING negative control: the same client page with the run
// dependency around the IndexedDB populate deleted.
//
//   node docs/evidence/m4-persist/make-ungated-page.mjs
//   # writes web/dist-m1/armagetronad-ungated.html
//   node web/tools/drive-browser.mjs --headed --out /tmp/persist-ungated \
//        --url http://localhost:8000/armagetronad-ungated.html \
//        --script-file web/tools/persist-gate.steps
//   node docs/evidence/m4-persist/check-persist-transcript.mjs /tmp/persist-ungated/console.log
//   # expected: exit status 1, with P3 and P4 FAIL
//
// WHY THIS EXISTS. P3/P4 in the checker assert that "[PERSIST] populate ok"
// precedes "[PERSIST] runtime initialized" -- i.e. that the IndexedDB ->
// MEMFS copy finished before the Play button could start main(). That is the
// single most important claim in M4 task 1, because the bug it excludes is
// silent: a game that starts before the populate reads an empty /persist,
// then saves over it, and looks exactly like a working one from the inside.
//
// An assertion that has never been seen to fail is not evidence. This tool
// produces the page on which it fails, deterministically: without the run
// dependency, Emscripten's run() walks straight from preRun() (which merely
// STARTS the async FS.syncfs) into initRuntime() and onRuntimeInitialized(),
// so the two lines come out in the opposite order every time.
//
// IT ONLY EDITS THE GENERATED HTML, never web/shell.html and never the wasm.
// The .html emitted by em++ is a plain text file that loads armagetronad.js
// beside it, so a copy in the same directory shares the wasm, the .data
// archive and the loader with the real page -- the ONLY difference between
// the two runs is the four lines removed here. Rebuilding the client
// overwrites armagetronad.html but not this copy, so re-run this tool after
// any relink or the control is measuring a stale page.
//
// WHAT IT DOES *NOT* DEMONSTRATE, and must not be quoted as demonstrating:
// that the race actually bites this harness. It does not, and cannot: the
// gate script clicks Play more than a second after the runtime is ready,
// while the measured populate takes 6-50 ms. The ungated page still passes
// every round-trip check (P10-P13) -- go and look, that is exactly what the
// committed transcript shows. What this proves is narrower and is the honest
// claim: the ordering P3/P4 assert is REAL, it is produced by the run
// dependency, and removing that dependency inverts it. The race window is
// closed structurally rather than because it was hard to hit.

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'web/dist-m1/armagetronad.html';
const DST = 'web/dist-m1/armagetronad-ungated.html';

let html = readFileSync(SRC, 'utf8');

// Both calls, exactly as web/shell.html writes them. Matching the literal text
// rather than a regex means a rename in shell.html breaks this tool loudly
// instead of silently producing a page identical to the real one -- which
// would make the control PASS and be read as "the ordering check is bogus".
const ADD = `        Module.addRunDependency('persist-populate');\n`;
const REMOVE = `          Module.removeRunDependency('persist-populate');\n`;

for (const [name, text] of [['addRunDependency', ADD], ['removeRunDependency', REMOVE]]) {
  const n = html.split(text).length - 1;
  if (n !== 1) {
    console.error(`make-ungated-page.mjs: expected exactly 1 occurrence of the ${name} call in ${SRC}, found ${n}.`);
    console.error('The shell page has changed shape; update this tool rather than loosening the match.');
    process.exit(2);
  }
  html = html.replace(text, `        // [ungated control] ${name} call deleted by make-ungated-page.mjs\n`);
}

writeFileSync(DST, html);
console.log(`wrote ${DST}`);
console.log('  both persist-populate run-dependency calls removed;');
console.log('  everything else (loader, wasm, .data) is shared with the real page.');
