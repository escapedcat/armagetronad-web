#!/usr/bin/env node
// Show that every transcript check in check-settings-transcript.mjs can fail.
//
//   node docs/evidence/m4-persist-settings/prove-settings-checks-can-fail.mjs
//   node docs/evidence/m4-persist-settings/prove-settings-checks-can-fail.mjs \
//        docs/evidence/m4-persist-settings/firefox-console.log
//
// Exit status 0 if every declared mutation flipped exactly the checks it was
// supposed to flip, 1 otherwise.
//
// WHY THIS EXISTS. An assertion that has never been seen to fail is not
// evidence. Six of the checker's checks have real-browser controls beside them
// in this directory -- a second link of the client with the menu-leave save
// compiled out, with and without the JS backstop -- and those are the stronger
// witnesses. The rest would otherwise have nothing, on the grounds that they
// are "structural", which is not a reason: check-settings-transcript.mjs reads
// one text file and touches nothing else, so it is a pure function of that
// file and flipping a check costs one line of string surgery.
//
// WHAT A MUTATION PROVES, AND WHAT IT DOES NOT. A mutation proves the check is
// WIRED UP: that the assertion reads the field it claims to read and reports
// FAIL when that field says the wrong thing. It does NOT prove the field means
// what the check's prose says it means -- only a real browser doing the wrong
// thing can show that, which is why the control BUILD exists.
//
// COLLATERAL IS DECLARED, NOT TOLERATED. Each case declares the FULL set of
// ids it expects to fail and the run is green only if the observed set matches
// exactly, so a mutation that quietly knocked out four unrelated checks cannot
// look like a success.
//
// TWO ENTRIES SHARE THE ID S8 on purpose. S8 makes two claims at once -- that
// IndexedDB holds the changed value, and that it was read BEFORE any unload
// event -- and one mutation can only exercise one of them. Both are listed.
//
// SZ IS NOT COVERED AND CANNOT BE. It is not a check on the transcript; it is
// a guard on the checker's own source. All seventeen check() calls there are
// unconditional top-level statements, so no input can make one not run. It is
// reported below as NOT-COVERABLE with that reason rather than omitted.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-settings-transcript.mjs');
const SRC = process.argv[2] || join(HERE, 'chrome-console.log');

const FS_TAG = '[SETFS] ';
const IDB_TAG = '[SETIDB] ';
const isHarness = (l) => l.includes('] [harness] ');

// ------------------------------------------------------------- line surgery
//
// Harness echoes of an `eval:` step contain every one of these tags verbatim,
// which is exactly the confusion the checker itself has to avoid.
function findTag(lines, tag, from = 0) {
  for (let i = from; i < lines.length; i++) {
    if (!isHarness(lines[i]) && lines[i].includes(tag)) return i;
  }
  return -1;
}
function findPhase(lines, tag, phase) {
  for (let i = 0; i < lines.length; i++) {
    if (isHarness(lines[i])) continue;
    const at = lines[i].indexOf(tag);
    if (at < 0) continue;
    try {
      if (JSON.parse(lines[i].slice(at + tag.length)).phase === phase) return i;
    } catch { /* not the payload we want */ }
  }
  return -1;
}
// Rewrite one payload through `fn`, keeping the driver's timestamp prefix
// intact so the mutated file still looks like a transcript rather than like
// something a tool obviously made up.
function editPayload(lines, tag, phase, fn) {
  const i = findPhase(lines, tag, phase);
  if (i < 0) throw new Error(`no ${tag} payload for phase ${phase}`);
  const at = lines[i].indexOf(tag);
  const obj = JSON.parse(lines[i].slice(at + tag.length));
  fn(obj);
  lines[i] = lines[i].slice(0, at + tag.length) + JSON.stringify(obj);
  return lines;
}
const stamped = (body) => `[   9999ms] ${body}`;

// Index of the Nth page-emitted menu-leave save line (0-based).
function findMenuLeave(lines, n) {
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isHarness(lines[i])) continue;
    if (lines[i].includes('[PERSISTSAVE] menu-leave')) { if (seen++ === n) return i; }
  }
  return -1;
}
const markIndex = (lines, name) => lines.findIndex((l) => l.includes(`=== ${name} ===`));

// ------------------------------------------------------------- the mutations
const MUTATIONS = [
  {
    id: 'S1',
    what: "delete boot 2's [PERSIST] populate ok line",
    apply: (L) => {
      const first = findTag(L, '[PERSIST] populate ok');
      const second = findTag(L, '[PERSIST] populate ok', first + 1);
      return L.filter((_, i) => i !== second);
    },
  },
  {
    id: 'S2',
    what: 'duplicate one [SETFS] payload, so a phase appears twice',
    apply: (L) => { const i = findPhase(L, FS_TAG, 'boot1-before-play'); L.splice(i, 0, L[i]); return L; },
  },
  {
    id: 'S3',
    what: 'claim user.cfg already existed before the game ran (a stale profile)',
    apply: (L) => editPayload(L, FS_TAG, 'boot1-before-play', (o) => { o.present = true; }),
  },
  {
    id: 'S4',
    what: 'claim the baseline file ALREADY held the name the gate is about to type',
    apply: (L) => editPayload(L, FS_TAG, 'boot1-first-setup-open', (o) => { o.player_1 = 'web_userqzxjv'; }),
  },
  {
    id: 'S5',
    what: 'change the pre-Escape hash, i.e. claim typing alone rewrote the file',
    apply: (L) => editPayload(L, FS_TAG, 'boot1-typed-not-yet-left', (o) => { o.hash = 'deadbeef'; }),
  },
  {
    id: 'S6',
    what: "delete boot 1's menu-leave save line, so the Escape produced no save",
    apply: (L) => { const i = findMenuLeave(L, 1); return L.filter((_, j) => j !== i); },
  },
  {
    id: 'S7',
    what: 'claim the file after the menu exit still held the OLD name',
    apply: (L) => editPayload(L, FS_TAG, 'boot1-after-menu-leave', (o) => { o.player_1 = 'web_user'; }),
  },
  {
    id: 'S8',
    what: "claim IndexedDB's own copy held the old name",
    apply: (L) => editPayload(L, IDB_TAG, 'boot1-idb', (o) => { o.player_1 = 'web_user'; }),
  },
  {
    id: 'S8',
    what: 'move the IndexedDB read to AFTER the reload mark (the timing half of S8)',
    note: 'the value would be identical; only the moment it was read changes, and that '
        + 'moment is what makes durability attributable to the in-game save rather than '
        + 'to the beforeunload handler.',
    apply: (L) => {
      const i = findPhase(L, IDB_TAG, 'boot1-idb');
      const line = L[i];
      L.splice(i, 1);
      L.splice(markIndex(L, 'RELOAD-REQUESTED') + 1, 0, line);
      return L;
    },
  },
  {
    id: 'S9',
    what: 'inject a backstop save into boot 1, so the unload path could explain the result',
    apply: (L) => { L.splice(findMenuLeave(L, 0), 0, stamped('[console.log] [PERSISTBACKSTOP] visibilitychange-hidden')); return L; },
  },
  {
    id: 'S10',
    what: 'claim boot 2 read back the DEFAULT name, i.e. the change did not survive',
    apply: (L) => editPayload(L, FS_TAG, 'boot2-before-play', (o) => { o.player_1 = 'web_user'; }),
  },
  {
    id: 'S11',
    what: 'claim the clobber never landed, so boot 2 never had to rewrite anything',
    apply: (L) => editPayload(L, FS_TAG, 'boot2-clobbered', (o) => { o.clobbered = false; }),
  },
  {
    id: 'S12',
    what: "delete boot 2's menu-leave save line",
    apply: (L) => { const i = findMenuLeave(L, 2); return L.filter((_, j) => j !== i); },
  },
  {
    id: 'S13',
    what: 'claim what boot 2 rewrote from memory held the DEFAULT name',
    apply: (L) => editPayload(L, FS_TAG, 'boot2-after-menu-leave', (o) => { o.player_1 = 'web_user'; }),
  },
  {
    id: 'S14',
    what: 'inject an [EXCEPTION] line into the run region',
    apply: (L) => { L.splice(2, 0, stamped('[EXCEPTION] TypeError: synthetic, injected by prove-settings-checks-can-fail.mjs')); return L; },
  },
  {
    id: 'S15',
    what: 'truncate the transcript at the deliberate-error mark, so the control never fires',
    apply: (L) => L.slice(0, L.findIndex((l) => l.includes('positive-control-deliberate')) + 1),
  },
  {
    id: 'S16',
    what: 'inject an "until TIMED OUT" harness line into the run region',
    apply: (L) => { L.splice(2, 0, stamped('[harness] until TIMED OUT after 30000ms: saw 0x <<synthetic>>, wanted 1')); return L; },
  },
  {
    id: 'S17',
    what: 'inject a 404 for something that is not favicon.ico',
    apply: (L) => {
      L.splice(2, 0, stamped('[browser.error/network] Failed to load resource: the server responded with a status of 404 (File not found)   <- http://localhost:8000/armagetronad.data'));
      return L;
    },
  },
];

// ------------------------------------------------------------------ harness
function runChecker(file) {
  const r = spawnSync(process.execPath, [CHECKER, file], { encoding: 'utf8' });
  if (r.error) throw r.error;
  const failed = [...r.stdout.matchAll(/^FAIL {2}(S\w+)/gm)].map((m) => m[1]);
  const passed = [...r.stdout.matchAll(/^PASS {2}(S\w+)/gm)].map((m) => m[1]);
  return { status: r.status, failed, passed, stdout: r.stdout };
}

const tmp = mkdtempSync(join(tmpdir(), 'm4set-prove-'));
let bad = 0;

try {
  const original = readFileSync(SRC, 'utf8').split('\n');

  console.log(`prover      : ${SRC}`);
  console.log(`checker     : ${CHECKER}`);
  console.log('');

  // A check on the PROVER, not on the checker: mutating a transcript that was
  // already failing would prove nothing at all.
  const base = runChecker(SRC);
  const baseOk = base.status === 0 && base.failed.length === 0;
  console.log(`${baseOk ? 'ok  ' : 'BAD '} baseline: the unmutated transcript passes `
    + `(exit ${base.status}, ${base.passed.length} checks, ${base.failed.length} failures)`);
  if (!baseOk) {
    console.log('      cannot prove anything by mutating a transcript that already fails.');
    process.exit(2);
  }
  console.log('');

  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  let n = 0;
  for (const m of MUTATIONS) {
    const want = [m.id, ...(m.also || [])];
    const file = join(tmp, `${m.id}-${n++}.log`);
    writeFileSync(file, m.apply(original.slice()).join('\n'));
    const r = runChecker(file);
    const ok = r.status === 1 && same(r.failed, want);
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'BAD '} ${m.id.padEnd(4)} ${m.what}`);
    console.log(`       expected FAIL: ${want.join(' ')}   observed: ${r.failed.join(' ') || '(none)'}   exit ${r.status}`);
    if (m.why_also) console.log(`       collateral is expected: ${m.why_also}`);
    if (m.note) console.log(`       note: ${m.note}`);
  }

  console.log('');
  console.log('--   SZ   NOT COVERABLE, by design. SZ compares the ids that produced a verdict');
  console.log('          against the declared list; all seventeen check() calls in the checker are');
  console.log('          unconditional top-level statements, so no transcript can stop one running.');
  console.log('          It is a regression guard on the checker source, not a check on the input.');
  console.log('');
  console.log('Real-browser controls, which are stronger than any mutation above, cover:');
  console.log('  S6 S7 S8 S12 S16       armagetronad-nomenusave.html');
  console.log('                         (a second link with the uCallbackMenuLeave registration');
  console.log('                          compiled out -- a real game without this task\'s mechanism)');
  console.log('  + S10 S13              armagetronad-nomenusave-nobackstop.html');
  console.log('                         (the same, with the unload handlers disabled too)');
  console.log('  S13 does NOT flip on nomenusave alone, and that was measured rather than');
  console.log('  predicted: gArmagetron.cpp saves unconditionally after MainMenu() returns,');
  console.log('  which rewrites the clobbered file by a pre-existing path. See');
  console.log('  make-settings-control-pages.mjs.');
  console.log('And the control that must PASS:');
  console.log('  armagetronad-nobackstop.html -- the real client with both unload handlers');
  console.log('  disabled. 18/18. That is what "the backstop is not load-bearing" means.');
  console.log('');
  console.log(bad === 0
    ? `RESULT: PASS -- all ${MUTATIONS.length} mutations flipped exactly the checks they declared`
    : `RESULT: FAIL -- ${bad} mutation(s) did not behave as declared`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(bad === 0 ? 0 : 1);
