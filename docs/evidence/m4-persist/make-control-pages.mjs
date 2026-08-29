#!/usr/bin/env node
// Build the four control pages for the M4 persistence gate.
//
//   node docs/evidence/m4-persist/make-control-pages.mjs
//   # writes web/dist-m1/armagetronad-ungated.html
//   #        web/dist-m1/armagetronad-slowgate.html
//   #        web/dist-m1/armagetronad-slowungated.html
//   #        web/dist-m1/armagetronad-noautopersist.html
//
// Each is driven with the ordinary gate script and scored with the ordinary
// checker; only the --url changes:
//
//   node web/tools/drive-browser.mjs --headed --out /tmp/<name> \
//        --url http://localhost:8000/armagetronad-<name>.html \
//        --script-file web/tools/persist-gate.steps
//   node docs/evidence/m4-persist/check-persist-transcript.mjs /tmp/<name>/console.log
//
//   ungated         expected PASS  -- and that is the point, see below
//   slowgate        expected PASS  -- the populate takes 3 s and the runtime waits
//   slowungated     expected FAIL  -- P3 P4
//   noautopersist   expected FAIL  -- P7 P9 P10 P11 P12 P13 (SLOW: ~2.5 min of
//                                     deliberate `until:` timeouts, see below)
//
// ============================ THE ORDERING CONTROLS =========================
//
// P3/P4 in the checker assert that "[PERSIST] populate ok" precedes
// "[PERSIST] runtime initialized" -- that the IndexedDB -> MEMFS copy finished
// before the Play button could start main(). That is the most important claim
// in M4 task 1, because the bug it excludes is silent: a game that starts
// before the populate reads an empty /persist, then saves over it, and looks
// exactly like a working one from the inside.
//
// The obvious control -- delete the run dependency and re-run -- DOES NOT
// WORK, which is worth recording because it looks like it should. That is
// what armagetronad-ungated.html is for: it is the control that fails to
// control, kept and re-runnable so the claim is checkable. Measured:
//
//     [   152ms] [PERSIST] populate ok in 38ms
//     [   485ms] [PERSIST] runtime initialized, Play enabled
//
// (docs/evidence/m4-persist/ungated-chrome-console.log, which the checker
// scores PASS 18/18.) i.e. P3/P4 still passed. The reason is that Emscripten's
// run() does `await new Promise(resolve => setTimeout(resolve, 1))` between
// preRun() and initRuntime() (it is the yield that lets the browser paint
// "Running..."), and initRuntime() itself then takes ~300 ms of synchronous
// wasm work here. So without the dependency the ordering is a RACE between a
// 1 ms timer plus a ~300 ms constructor run on one side and a ~38 ms
// IndexedDB round trip on the other -- and on this machine, on that day,
// IndexedDB won. That is precisely the "intermittent, and the failure looks
// like success" hazard the run dependency exists to remove, and it is why a
// control has to widen the window instead of relying on the default one.
//
// So armagetronad-slowgate.html and armagetronad-slowungated.html both delay
// the FS.syncfs(true) CALLBACK by 3000 ms -- the real populate still happens,
// its completion is simply reported and acted on three seconds later, which is
// what "a slow populate" means from run()'s point of view. Then:
//
//   slowgate      keeps the run dependency. The runtime must wait: "Ready"
//                 and the Play button appear ~3 s late, right after the
//                 populate line. This is the POSITIVE demonstration -- no
//                 accident of timing can delay onRuntimeInitialized by three
//                 seconds.
//   slowungated   deletes it. The runtime initialises immediately and the
//                 populate lands ~3 s later, so P3/P4 FAIL. This is the
//                 control that proves those two checks can fail.
//
// ======================= THE INSTRUMENTATION CONTROL ========================
//
// armagetronad-noautopersist.html mounts with `{}` instead of
// `{ autoPersist: true }`. Everything else is untouched: the populate still
// runs, the run dependency is still held, the game still writes user.cfg.
// What is gone is the write-BACK -- libidbfs.js only wraps the mount's
// node_ops.mknod when autoPersist is set, so nothing ever queues a
// MEMFS -> IndexedDB sync.
//
// It is the strongest control here because it is not a mutation of a
// transcript and not a timing trick: it is a real browser running a real game
// against a mount that genuinely does not persist. It flips P7 (no persist is
// ever triggered), P9 (IndexedDB is created by the populate but stays empty)
// and P10-P13 (nothing survives the reload).
//
// IT DOES NOT FLIP P6, and the review that requested this page predicted it
// would. P6 asserts that booting the game WROTE /persist/var/user.cfg, and it
// reads the MEMFS payload -- which is still true with no autoPersist, because
// the game's write lands in memory exactly as before. That is P6 being
// correctly scoped rather than P6 being weak: "the file reached IndexedDB" is
// P9's claim and P9 does flip. P6's own falsifier is a transcript mutation in
// prove-checks-can-fail.mjs.
//
// IT IS SLOW ON PURPOSE. The gate script waits on
// `until:1:90000:[PERSISTSYNC] start 1` and `until:1:60000:PROBE-PERSISTED`,
// and with no autoPersist neither event can ever happen, so both time out in
// full: budget ~2.5 minutes more than the other runs. The timeouts are
// recorded in the transcript as harness lines, which is the intended
// behaviour -- an `until:` that expires is a visible failure, not a silently
// passed `wait:`.
//
// ============================================================================
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
// real one -- which would make the control PASS and be read as "the check is
// bogus". A literal match breaks loudly instead.
const SYNCFS = `          FS.syncfs(true, (err) => {\n`;
const ADD = `          Module.addRunDependency('persist-populate');\n`;
const HELD = `          held = true;\n`;
const MOUNT = `          FS.mount(IDBFS, { autoPersist: true }, '/persist');\n`;

// Delays the CALLBACK, not the request: syncfs still runs immediately and
// still really reads IndexedDB. IDBFS's own autoPersist path calls
// IDBFS.syncfs, not FS.syncfs, so the game's saves are not slowed by this.
const SLOW = `          { const _real = FS.syncfs.bind(FS); FS.syncfs = (p, cb) => _real(p, (e) => setTimeout(() => cb(e), 3000)); } // [control] populate callback delayed 3000ms by make-control-pages.mjs\n`;

function edit(html, text, replacement, name) {
  const n = html.split(text).length - 1;
  if (n !== 1) {
    console.error(`make-control-pages.mjs: expected exactly 1 occurrence of ${name} in ${SRC}, found ${n}.`);
    console.error('The shell page has changed shape; update this tool rather than loosening the match.');
    process.exit(2);
  }
  return html.replace(text, replacement);
}

// Deleting the addRunDependency call is only half of it: shell.html releases
// the dependency through a `release()` helper guarded by `held`, and calling
// removeRunDependency without a matching add aborts the runtime (it asserts
// the id is still tracked). Forcing `held` false instead of deleting the
// release sites leaves both of them as no-ops, which is both safer and a
// smaller diff.
function deleteGate(html) {
  html = edit(html, ADD,
    `          // [control] addRunDependency call deleted by make-control-pages.mjs\n`,
    'the addRunDependency call');
  html = edit(html, HELD,
    `          held = false; // [control] forced false by make-control-pages.mjs, so release() is a no-op\n`,
    'the `held = true` assignment');
  return html;
}

const original = readFileSync(SRC, 'utf8');
const out = (name, html, note) => {
  writeFileSync(`web/dist-m1/armagetronad-${name}.html`, html);
  console.log(`wrote web/dist-m1/armagetronad-${name}.html`.padEnd(52) + note);
};

// 1. The ordering control that does NOT discriminate, kept so that fact stays
//    checkable rather than being a story in a README.
out('ungated', deleteGate(original),
  '(populate unchanged, gate DELETED -- expected PASS anyway)');

// 2 and 3. The ordering controls that do.
const slowGate = edit(original, SYNCFS, SLOW + SYNCFS, 'the FS.syncfs(true) call');
out('slowgate', slowGate, '(populate +3000ms, gate KEPT -- expected PASS)');
out('slowungated', deleteGate(slowGate), '(populate +3000ms, gate DELETED -- expected FAIL P3 P4)');

// 4. The instrumentation control: a mount that genuinely does not persist.
out('noautopersist',
  edit(original, MOUNT,
    `          FS.mount(IDBFS, {}, '/persist'); // [control] autoPersist removed by make-control-pages.mjs\n`,
    'the FS.mount call'),
  '(no autoPersist -- expected FAIL P7 P9 P10-P13; SLOW, ~2.5 min extra)');
