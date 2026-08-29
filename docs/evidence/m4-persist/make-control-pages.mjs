#!/usr/bin/env node
// Build the three ORDERING control pages for the M4 persistence gate.
//
//   node docs/evidence/m4-persist/make-control-pages.mjs
//   # writes web/dist-m1/armagetronad-ungated.html
//   #        web/dist-m1/armagetronad-slowgate.html
//   #        web/dist-m1/armagetronad-slowungated.html
//
//   node web/tools/drive-browser.mjs --headed --out /tmp/slowgate \
//        --url http://localhost:8000/armagetronad-slowgate.html \
//        --script-file web/tools/persist-gate.steps
//   node web/tools/drive-browser.mjs --headed --out /tmp/slowungated \
//        --url http://localhost:8000/armagetronad-slowungated.html \
//        --script-file web/tools/persist-gate.steps
//   node docs/evidence/m4-persist/check-persist-transcript.mjs /tmp/slowgate/console.log
//   # expected: PASS, with the populate taking ~3 s and the runtime waiting for it
//   node docs/evidence/m4-persist/check-persist-transcript.mjs /tmp/slowungated/console.log
//   # expected: exit status 1, with P3 and P4 FAIL
//
//   node web/tools/drive-browser.mjs --headed --out /tmp/ungated \
//        --url http://localhost:8000/armagetronad-ungated.html \
//        --script-file web/tools/persist-gate.steps
//   node docs/evidence/m4-persist/check-persist-transcript.mjs /tmp/ungated/console.log
//   # expected: PASS -- and that is the point, see below
//
// WHY THESE EXIST, AND WHY THE OBVIOUS CONTROL IS NOT ENOUGH
// ----------------------------------------------------------
// P3/P4 in the checker assert that "[PERSIST] populate ok" precedes
// "[PERSIST] runtime initialized" -- that the IndexedDB -> MEMFS copy
// finished before the Play button could start main(). That is the most
// important claim in M4 task 1, because the bug it excludes is silent: a game
// that starts before the populate reads an empty /persist, then saves over
// it, and looks exactly like a working one from the inside.
//
// The obvious control -- delete the run dependency and re-run -- DOES NOT
// WORK, which is worth recording because it looks like it should. That is
// what armagetronad-ungated.html below is for: it is the control that fails
// to control, kept and re-runnable so the claim is checkable. Measured:
//
//     [   108ms] [PERSIST] populate ok in 34ms
//     [   379ms] [PERSIST] runtime initialized, Play enabled
//
// (docs/evidence/m4-persist/ungated-chrome-console.log, which the checker
// scores PASS 18/18.) i.e. P3/P4 still passed. The reason is that Emscripten's run() does
// `await new Promise(resolve => setTimeout(resolve, 1))` between preRun() and
// initRuntime() (it is the yield that lets the browser paint "Running..."),
// and initRuntime() itself then takes ~280 ms of synchronous wasm work here.
// So without the dependency the ordering is a RACE between a 1 ms timer plus
// a ~280 ms constructor run on one side and a ~34 ms IndexedDB round trip on
// the other -- and on this machine, on that day, IndexedDB won. That is
// precisely the "intermittent, and the failure looks like success" hazard the
// run dependency exists to remove, and it is why a control has to widen the
// window instead of relying on the default one.
//
// WHAT THE OTHER TWO PAGES DO. Both delay the FS.syncfs(true) CALLBACK by 3000 ms
// -- the real populate still happens, its completion is simply reported and
// acted on three seconds later, which is what "a slow populate" means from
// run()'s point of view. Then:
//
//   armagetronad-slowgate.html     keeps the run dependency. The runtime must
//                                  wait: "Ready" and the Play button appear
//                                  ~3 s late, right after the populate line.
//                                  This is the POSITIVE demonstration -- no
//                                  accident of timing can delay
//                                  onRuntimeInitialized by three seconds.
//   armagetronad-slowungated.html  deletes it. The runtime initialises
//                                  immediately and the populate lands ~3 s
//                                  later, so P3/P4 FAIL. This is the control
//                                  that proves those two checks can fail.
//
// Everything else in both runs is unchanged, and in particular the round-trip
// checks P10-P13 still PASS in both -- the gate script waits for the populate
// line before it clicks Play, so the harness never actually enters the race.
// That isolation is the point: exactly two checks move.
//
// THESE ONLY EDIT THE GENERATED HTML, never web/shell.html and never the
// wasm. The .html em++ emits is a plain text file that loads armagetronad.js
// from beside it, so copies in the same directory share the loader, the wasm
// and the .data archive with the real page -- the only differences are the
// lines edited here. Rebuilding the client overwrites armagetronad.html but
// NOT these copies, so re-run this tool after any relink or the controls are
// measuring a stale page.

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'web/dist-m1/armagetronad.html';

// Matched as literal text, exactly as web/shell.html writes it. A regex would
// keep working after a rename and silently produce a page identical to the
// real one -- which would make the control PASS and be read as "the ordering
// check is bogus". A literal match breaks loudly instead.
const SYNCFS = `        FS.syncfs(true, (err) => {\n`;
const ADD = `        Module.addRunDependency('persist-populate');\n`;
const REMOVE = `          Module.removeRunDependency('persist-populate');\n`;

// Delays the CALLBACK, not the request: syncfs still runs immediately and
// still really reads IndexedDB. IDBFS's own autoPersist path calls
// IDBFS.syncfs, not FS.syncfs, so the game's saves are not slowed by this.
const SLOW = `        { const _real = FS.syncfs.bind(FS); FS.syncfs = (p, cb) => _real(p, (e) => setTimeout(() => cb(e), 3000)); } // [control] populate callback delayed 3000ms by make-control-pages.mjs\n`;

function edit(html, text, replacement, name) {
  const n = html.split(text).length - 1;
  if (n !== 1) {
    console.error(`make-control-pages.mjs: expected exactly 1 occurrence of ${name} in ${SRC}, found ${n}.`);
    console.error('The shell page has changed shape; update this tool rather than loosening the match.');
    process.exit(2);
  }
  return html.replace(text, replacement);
}

const original = readFileSync(SRC, 'utf8');

// 1. The control that does NOT discriminate, kept so that fact stays checkable.
let ungated = original;
ungated = edit(ungated, ADD,
  `        // [control] addRunDependency call deleted by make-control-pages.mjs\n`, 'the addRunDependency call');
ungated = edit(ungated, REMOVE,
  `          // [control] removeRunDependency call deleted by make-control-pages.mjs\n`, 'the removeRunDependency call');
writeFileSync('web/dist-m1/armagetronad-ungated.html', ungated);
console.log('wrote web/dist-m1/armagetronad-ungated.html     (populate unchanged, run dependency DELETED -- expected to PASS anyway)');

// 2 and 3. The controls that do.
const slowGate = edit(original, SYNCFS, SLOW + SYNCFS, 'the FS.syncfs(true) call');
writeFileSync('web/dist-m1/armagetronad-slowgate.html', slowGate);
console.log('wrote web/dist-m1/armagetronad-slowgate.html   (populate callback +3000ms, run dependency KEPT)');

let slowUngated = slowGate;
slowUngated = edit(slowUngated, ADD,
  `        // [control] addRunDependency call deleted by make-control-pages.mjs\n`, 'the addRunDependency call');
slowUngated = edit(slowUngated, REMOVE,
  `          // [control] removeRunDependency call deleted by make-control-pages.mjs\n`, 'the removeRunDependency call');
writeFileSync('web/dist-m1/armagetronad-slowungated.html', slowUngated);
console.log('wrote web/dist-m1/armagetronad-slowungated.html (populate callback +3000ms, run dependency DELETED)');
