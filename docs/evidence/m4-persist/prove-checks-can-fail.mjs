#!/usr/bin/env node
// Show that every transcript check in check-persist-transcript.mjs can fail.
//
//   node docs/evidence/m4-persist/prove-checks-can-fail.mjs
//   node docs/evidence/m4-persist/prove-checks-can-fail.mjs docs/evidence/m4-persist/firefox-console.log
//
// Exit status 0 if every declared mutation flipped exactly the checks it was
// supposed to flip, 1 otherwise.
//
// WHY THIS EXISTS
// ---------------
// An assertion that has never been seen to fail is not evidence. Four of the
// checker's checks (P3, P4, and P10-P13) have real-browser controls next to
// them in this directory -- a page with the run dependency deleted, a page
// mounted without autoPersist, a run with IndexedDB wiped between the boots.
// The rest had nothing, on the grounds that they are "structural". That is
// not a reason: check-persist-transcript.mjs reads one text file and touches
// nothing else, so it is a pure function of that file, and flipping a check
// costs one line of string surgery.
//
// So this tool takes a PASSING transcript, applies one targeted mutation per
// check, runs the REAL checker on the result as a child process, and reports
// which ids flipped. It never imports the checker or re-implements it: if the
// checker changes, this measures the change.
//
// WHAT A MUTATION PROVES, AND WHAT IT DOES NOT
// --------------------------------------------
// A mutation proves the check is WIRED UP: that the assertion reads the field
// it claims to read, and reports FAIL when that field says the wrong thing. It
// does NOT prove the field means what the check's prose says it means -- only
// a real browser doing the wrong thing can show that, which is why the four
// control pages exist and why the strongest of them (noautopersist) is a real
// game running against a mount that genuinely does not persist. Where a check
// has both, both are listed in the table this prints.
//
// COLLATERAL IS DECLARED, NOT TOLERATED
// -------------------------------------
// Some mutations necessarily disturb more than one check -- deleting a
// populate line breaks both "there are two of them" and "the second boot has
// one". Each case below declares the FULL set of ids it expects to fail, and
// the run is only green if the observed set matches exactly. A mutation that
// quietly knocked out four unrelated checks would otherwise look like a
// success.
//
// PZ IS NOT COVERED AND CANNOT BE. It is not a check on the transcript; it is
// a guard on the checker's own source that compares the ids which produced a
// verdict against the declared list. All seventeen check() calls there are
// unconditional top-level statements, so no input can make one of them not
// run. It is reported below as NOT-COVERABLE with that reason rather than
// omitted, because a check missing from this table for an unstated reason is
// exactly the silence this file exists to remove.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-persist-transcript.mjs');
const SRC = process.argv[2] || join(HERE, 'chrome-console.log');

const isHarness = (l) => l.includes('] [harness] ');

// ------------------------------------------------------------- line surgery

// Index of the first PAGE-emitted line carrying `tag` (harness echoes of an
// eval: step contain every one of these tags verbatim, which is exactly the
// confusion the checker itself has to avoid).
function findTag(lines, tag, from = 0) {
  for (let i = from; i < lines.length; i++) {
    if (!isHarness(lines[i]) && lines[i].includes(tag)) return i;
  }
  return -1;
}

// Index of the page-emitted `tag` line whose JSON payload has this phase.
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

// Rewrite the JSON payload of one tagged line through `fn`, keeping the
// driver's timestamp prefix intact so the mutated file still looks like a
// transcript rather than like something a tool obviously made up.
function editPayload(lines, tag, phase, fn) {
  const i = findPhase(lines, tag, phase);
  if (i < 0) throw new Error(`no ${tag} payload for phase ${phase}`);
  const at = lines[i].indexOf(tag);
  const obj = JSON.parse(lines[i].slice(at + tag.length));
  fn(obj);
  lines[i] = lines[i].slice(0, at + tag.length) + JSON.stringify(obj);
  return lines;
}

const swap = (lines, a, b) => { const t = lines[a]; lines[a] = lines[b]; lines[b] = t; return lines; };

// A synthetic line that carries the driver's own prefix shape.
const stamped = (body) => `[   9999ms] ${body}`;

// ------------------------------------------------------------- the mutations

const FS_TAG = '[PERSISTFS] ';
const IDB_TAG = '[PERSISTIDB] ';

const MUTATIONS = [
  {
    id: 'P1', also: ['P4'],
    what: 'delete the RELOAD-REQUESTED mark that partitions the two boots',
    why_also: 'without the partition nothing is "in boot 2", so P4 has no populate line to order',
    apply: (L) => L.filter((l) => !l.includes('=== RELOAD-REQUESTED ===')),
  },
  {
    id: 'P2', also: ['P4'],
    what: "delete boot 2's [PERSIST] populate line",
    why_also: 'it is the same line P4 orders against',
    apply: (L) => {
      const first = findTag(L, '[PERSIST] populate ');
      const second = findTag(L, '[PERSIST] populate ', first + 1);
      return L.filter((_, i) => i !== second);
    },
  },
  {
    id: 'P3',
    what: "swap boot 1's populate and runtime-initialized lines",
    apply: (L) => swap(L, findTag(L, '[PERSIST] populate '), findTag(L, '[PERSIST] runtime initialized')),
  },
  {
    id: 'P4',
    what: "swap boot 2's populate and runtime-initialized lines",
    apply: (L) => {
      const p = findTag(L, '[PERSIST] populate ', findTag(L, '[PERSIST] populate ') + 1);
      const r = findTag(L, '[PERSIST] runtime initialized', findTag(L, '[PERSIST] runtime initialized') + 1);
      return swap(L, p, r);
    },
  },
  {
    id: 'P5',
    what: 'claim /persist already had an entry before the game ran',
    apply: (L) => editPayload(L, FS_TAG, 'boot1-before-play', (o) => { o.entry_count = 1; }),
  },
  {
    id: 'P6',
    what: 'claim booting the game did NOT create user.cfg',
    note: 'the noautopersist control page does not flip this one, and should not: '
        + 'P6 reads the MEMFS view, where the write really does still happen. '
        + 'See make-control-pages.mjs.',
    apply: (L) => editPayload(L, FS_TAG, 'boot1-after-play', (o) => { o.user_cfg.present = false; }),
  },
  {
    id: 'P7',
    what: 'insert a harness key press, so a keystroke could explain the save',
    apply: (L) => { L.splice(1, 0, stamped('[harness] key Enter (1/1)')); return L; },
  },
  {
    id: 'P8',
    what: 'duplicate the [PERSISTNONCE] line, so the sentinel is not unique',
    apply: (L) => { const i = findTag(L, '[PERSISTNONCE] '); L.splice(i, 0, L[i]); return L; },
  },
  {
    id: 'P9',
    what: 'drop user.cfg from the keys IndexedDB reported after boot 1',
    apply: (L) => editPayload(L, IDB_TAG, 'boot1-idb',
      (o) => { o.keys = o.keys.filter((k) => k !== '/persist/var/user.cfg'); o.count = o.keys.length; }),
  },
  {
    id: 'P10',
    what: "change boot 2's user.cfg byte count",
    apply: (L) => editPayload(L, FS_TAG, 'boot2-before-play', (o) => { o.user_cfg.bytes += 1; }),
  },
  {
    id: 'P11',
    what: "change boot 2's user.cfg content hash",
    apply: (L) => editPayload(L, FS_TAG, 'boot2-before-play', (o) => { o.user_cfg.hash = 'deadbeef'; }),
  },
  {
    id: 'P12',
    what: "replace boot 2's sentinel text with a different nonce",
    apply: (L) => editPayload(L, FS_TAG, 'boot2-before-play', (o) => { o.probe_text = 'nonce=m4-not-the-one\n'; }),
  },
  {
    id: 'P13',
    what: 'drop the sentinel from the keys IndexedDB reported in boot 2',
    apply: (L) => editPayload(L, IDB_TAG, 'boot2-idb',
      (o) => { o.keys = o.keys.filter((k) => k !== '/persist/m4-probe.txt'); o.count = o.keys.length; }),
  },
  {
    id: 'P14',
    what: "move boot 2's Play click ABOVE the payloads it is supposed to follow",
    apply: (L) => {
      const reload = L.findIndex((l) => l.includes('=== RELOAD-REQUESTED ==='));
      const click = L.findIndex((l, i) => i > reload && l.includes('[harness] click #start'));
      const line = L[click];
      L.splice(click, 1);
      L.splice(findPhase(L, FS_TAG, 'boot2-before-play'), 0, line);
      return L;
    },
  },
  {
    id: 'P15',
    what: 'inject an [EXCEPTION] line into the run region',
    apply: (L) => { L.splice(2, 0, stamped('[EXCEPTION] TypeError: synthetic, injected by prove-checks-can-fail.mjs')); return L; },
  },
  {
    id: 'P16',
    what: 'inject a 404 for something that is not favicon.ico',
    apply: (L) => {
      L.splice(2, 0, stamped('[browser.error/network] Failed to load resource: the server responded with a status of 404 (File not found)   <- http://localhost:8000/armagetronad.data'));
      return L;
    },
  },
  {
    id: 'P17',
    what: 'truncate the transcript at the deliberate-error mark, so the control never fires',
    apply: (L) => L.slice(0, L.findIndex((l) => l.includes('positive-control-deliberate')) + 1),
  },
];

// ------------------------------------------------------------------ harness

function runChecker(file) {
  const r = spawnSync(process.execPath, [CHECKER, file], { encoding: 'utf8' });
  if (r.error) throw r.error;
  const failed = [...r.stdout.matchAll(/^FAIL {2}(P\w+)/gm)].map((m) => m[1]);
  const passed = [...r.stdout.matchAll(/^PASS {2}(P\w+)/gm)].map((m) => m[1]);
  return { status: r.status, failed, passed, stdout: r.stdout };
}

const tmp = mkdtempSync(join(tmpdir(), 'm4-prove-'));
let bad = 0;

try {
  const original = readFileSync(SRC, 'utf8').split('\n');

  console.log(`prover      : ${SRC}`);
  console.log(`checker     : ${CHECKER}`);
  console.log('');

  // The baseline is a check on the prover, not on the checker: mutating a
  // transcript that was already failing would prove nothing at all.
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

  for (const m of MUTATIONS) {
    const want = [m.id, ...(m.also || [])];
    const file = join(tmp, `${m.id}.log`);
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
  console.log('--   PZ   NOT COVERABLE, by design. PZ compares the ids that produced a verdict');
  console.log('          against the declared list; all seventeen check() calls in the checker are');
  console.log('          unconditional top-level statements, so no transcript can stop one running.');
  console.log('          It is a regression guard on the checker source, not a check on the input.');
  console.log('');
  console.log('Real-browser controls, which are stronger than any mutation above, cover:');
  console.log('  P3 P4              armagetronad-slowungated.html   (run dependency deleted, populate slowed)');
  console.log('  P7 P9 P10-P13      armagetronad-noautopersist.html (mounted without autoPersist)');
  console.log('  P10 P11 P12 P13    web/tools/persist-negative.steps (IndexedDB wiped between the boots)');
  console.log('');
  console.log(bad === 0
    ? `RESULT: PASS -- all ${MUTATIONS.length} mutations flipped exactly the checks they declared`
    : `RESULT: FAIL -- ${bad} mutation(s) did not behave as declared`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(bad === 0 ? 0 : 1);
