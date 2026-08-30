#!/usr/bin/env node
// Show that every transcript check in check-milestone-transcript.mjs can fail.
//
//   node docs/evidence/m4-persistence/prove-milestone-checks-can-fail.mjs
//   node docs/evidence/m4-persistence/prove-milestone-checks-can-fail.mjs \
//        docs/evidence/m4-persistence/firefox-console.log
//
// Exit status 0 if every declared mutation flipped exactly the checks it was
// supposed to flip, 1 otherwise.
//
// WHY THIS EXISTS. An assertion that has never been seen to fail is not
// evidence. Three of the checker's checks have a real-browser control beside
// them in this directory -- the same script against the same page with
// IndexedDB destroyed between boot 2 and boot 3 -- and that is the stronger
// witness for those three. The other eighteen would otherwise have nothing, on
// the grounds that they are "structural", which is not a reason:
// check-milestone-transcript.mjs reads one text file and touches nothing else,
// so it is a pure function of that file and flipping a check costs one line of
// string surgery.
//
// WHAT A MUTATION PROVES, AND WHAT IT DOES NOT. A mutation proves the check is
// WIRED UP: that the assertion reads the field it claims to read and reports
// FAIL when that field says the wrong thing. It does NOT prove the field means
// what the check's prose says it means -- only a real browser doing the wrong
// thing can show that, which is why the negative control exists.
//
// EVERY MUTATION IS AIMED AT THE PREDICATE, NOT AT THE CHECK NAME. That
// distinction is not pedantry: M4 task 3's review found a check whose only
// mutation tripped a NEIGHBOURING conjunct, so the named predicate was never
// exercised and the check was, in the end, unproven. So where a check asserts
// two independent things -- M4, M6, M7 and M10 each do -- there are two
// entries, one per conjunct, and they say which conjunct they are for.
//
// COLLATERAL IS DECLARED, NOT TOLERATED. Each case may declare `also: [...]`,
// the other ids it expects to knock out, and the run is green only if the
// observed failure set matches the declared one EXACTLY -- so a mutation that
// quietly took out four unrelated checks cannot look like a success. This is
// the stronger of the two forms used in this milestone; M4 task 3's prover
// matches on "at least the named check failed", which would pass a mutation
// that flipped everything.
//
// ONE MUTATION HERE DOES DECLARE COLLATERAL, and it is worth reading rather
// than skipping. M12 ("the arrow keys steered") compares boot 2's spent
// counters against BOOT 1's unspent ones, because "0 0 1 1 1" is only evidence
// of a change if the run is also shown to have started somewhere else. So the
// mutation that falsifies M5 -- boot 1's counters were not at config/default
// .cfg's shipped values -- necessarily takes M12 with it. That is a real
// dependency between two checks and not a defect in either; the alternative,
// M12 asserting a bare "0 0 1 1 1", would pass on a build where the counters
// had never been anything else.
//
// MZ IS NOT COVERED AND CANNOT BE. It is not a check on the transcript; it is
// a guard on the checker's own source. All twenty-one check() calls there are
// unconditional top-level statements, so no input can make one not run. It is
// reported below as NOT-COVERABLE with that reason rather than omitted.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-milestone-transcript.mjs');
const SRC = process.argv[2] || join(HERE, 'chrome-console.log');

const TAG = '[MILE] ';
const isHarness = (l) => l.includes('] [harness] ');

// ------------------------------------------------------------- line surgery
//
// Harness echoes of an `eval:` step contain the payload tag verbatim -- the
// probe installer is one long eval whose text includes "[MILE] " -- which is
// exactly the confusion the checker itself has to avoid.
function findTag(lines, tag, from = 0) {
  for (let i = from; i < lines.length; i++) {
    if (!isHarness(lines[i]) && lines[i].includes(tag)) return i;
  }
  return -1;
}
function findNthTag(lines, tag, n) {
  let at = -1;
  for (let k = 0; k <= n; k++) {
    at = findTag(lines, tag, at + 1);
    if (at < 0) return -1;
  }
  return at;
}
function findPhase(lines, phase) {
  for (let i = 0; i < lines.length; i++) {
    if (isHarness(lines[i])) continue;
    const at = lines[i].indexOf(TAG);
    if (at < 0) continue;
    try {
      if (JSON.parse(lines[i].slice(at + TAG.length)).phase === phase) return i;
    } catch { /* not the payload we want */ }
  }
  return -1;
}
// Rewrite one payload through `fn`, keeping the driver's timestamp prefix
// intact so the mutated file still looks like a transcript rather than like
// something a tool obviously made up.
function editPayload(lines, phase, fn) {
  const i = findPhase(lines, phase);
  if (i < 0) throw new Error(`no [MILE] payload for phase ${phase}`);
  const at = lines[i].indexOf(TAG);
  const obj = JSON.parse(lines[i].slice(at + TAG.length));
  fn(obj);
  lines[i] = lines[i].slice(0, at + TAG.length) + JSON.stringify(obj);
  return lines;
}
const stamped = (body) => `[   9999ms] ${body}`;
const markIndex = (lines, name) => lines.findIndex((l) => l.includes(`=== ${name} ===`));

// Index of the Nth page-emitted menu-leave save line (0-based).
function findMenuLeave(lines, n) {
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isHarness(lines[i])) continue;
    if (lines[i].includes('[PERSISTSAVE] menu-leave')) { if (seen++ === n) return i; }
  }
  return -1;
}

// ------------------------------------------------------------- the mutations
const MUTATIONS = [
  {
    id: 'M1',
    what: "delete boot 3's [PERSIST] populate ok line, so there are only two page loads",
    apply: (L) => { const i = findNthTag(L, '[PERSIST] populate ok', 2); return L.filter((_, j) => j !== i); },
  },
  {
    id: 'M2',
    what: 'duplicate one [MILE] payload, so a phase appears twice',
    apply: (L) => { const i = findPhase(L, 'boot1-before-play'); L.splice(i, 0, L[i]); return L; },
  },
  {
    id: 'M3',
    what: 'claim user.cfg already existed before the game first ran (a stale profile)',
    apply: (L) => editPayload(L, 'boot1-before-play', (o) => { o.present = true; }),
  },
  {
    id: 'M4',
    what: 'claim boot 1 was NOT a first-use boot (FIRST_USE 0 at the end of first setup)',
    note: 'the first of M4\'s two conjuncts.',
    apply: (L) => editPayload(L, 'boot1-after-first-setup', (o) => { o.first_use = '0'; }),
  },
  {
    id: 'M4',
    what: 'claim the left arrow was ALREADY bound on boot 1, before any keys_cursor.cfg',
    note: 'the second conjunct, and the one that matters: if the bind pre-existed, its '
        + 'presence on boot 2 would say nothing about persistence.',
    apply: (L) => editPayload(L, 'boot1-after-first-setup', (o) => { o.left_binds = ['1104']; }),
  },
  {
    id: 'M5',
    also: ['M12'],
    why_also: 'M12 compares boot 2\'s spent counters against BOOT 1\'s unspent ones, so a '
            + 'transcript in which boot 1 was already spent cannot support either check. See '
            + 'the header.',
    what: "claim boot 1's turn-left counter was already spent",
    apply: (L) => editPayload(L, 'boot1-after-first-setup', (o) => { o.tip_left = '0 0 1 1 1'; }),
  },
  {
    id: 'M6',
    what: 'claim the reloaded page read FIRST_USE 1 back',
    note: "M6's first conjunct: the value.",
    apply: (L) => editPayload(L, 'boot2-before-play', (o) => { o.first_use = '1'; }),
  },
  {
    id: 'M6',
    what: 'move the boot-2 read to AFTER the second reload mark',
    note: "M6's second conjunct: the read has to happen in boot 2. The value would be "
        + 'identical; only the moment it was taken changes, and that moment is what makes it '
        + 'a statement about a page that had written nothing.',
    apply: (L) => {
      const i = findPhase(L, 'boot2-before-play');
      const line = L[i];
      L.splice(i, 1);
      L.splice(markIndex(L, 'RELOAD-2-REQUESTED') + 1, 0, line);
      return L;
    },
  },
  {
    id: 'M7',
    what: 'claim the left-turn bind came back in SDL 1.2\'s numbering (276) instead of 1104',
    note: 'this is the real failure mode uInput.cpp\'s comment is about -- a re-encoding that '
        + 'is NOT idempotent would put the shipped 276 back into the file, where no keystroke '
        + 'can ever reach it. The key would be dead and the file would look fine.',
    apply: (L) => editPayload(L, 'boot2-before-play', (o) => { o.left_binds = ['276', '117']; }),
  },
  {
    id: 'M7',
    what: 'claim the keyboard template was never in the file (59 KEYBOARD lines, not 79)',
    note: "M7's other conjunct.",
    apply: (L) => editPayload(L, 'boot2-before-play', (o) => { o.n_keyboard = 59; }),
  },
  {
    id: 'M8',
    what: 'delete every [L] NEW_ROUND line, i.e. no game ever started',
    apply: (L) => L.filter((l) => isHarness(l) || !l.includes('[L] NEW_ROUND')),
  },
  {
    id: 'M9',
    what: 'claim the file already held the chosen row while the menu was still open',
    note: 'without M9, "the file holds 320x200 after the Escape" would not distinguish '
        + 'leaving the menu from pressing Left.',
    apply: (L) => editPayload(L, 'boot2-chosen-menu-still-open', (o) => { o.screenmode = '14'; o.screenmode_w = '320'; o.screenmode_h = '200'; }),
  },
  {
    id: 'M10',
    what: 'claim the menu exit wrote a different resolution (320x480)',
    note: "M10's first conjunct: the value written.",
    apply: (L) => editPayload(L, 'boot2-after-menu-leave', (o) => { o.screenmode_h = '480'; }),
  },
  {
    id: 'M10',
    what: "delete the menu-leave save that fired on leaving Screen Mode",
    note: "M10's second conjunct: that a save happened between the mark and the read, which "
        + 'is what attributes the new value to the menu exit.',
    apply: (L) => { const i = findMenuLeave(L, 2); return L.filter((_, j) => j !== i); },
  },
  {
    id: 'M11',
    what: 'claim boot 2 resized its own canvas to 320x200',
    note: 'if boot 2 had applied the change, boot 3 coming up at 320x200 would be a weaker '
        + 'statement. It could not actually happen -- a reload rebuilds the element from '
        + 'web/shell.html -- but the check is cheap and removes the argument.',
    apply: (L) => editPayload(L, 'boot2-after-menu-leave', (o) => { o.canvas_w = 320; o.canvas_h = 200; }),
  },
  {
    id: 'M12',
    what: 'claim the turn-left counter was never spent, i.e. no left turn ever registered',
    apply: (L) => editPayload(L, 'boot2-after-steering', (o) => { o.tip_left = '0 2 1 1 1'; }),
  },
  {
    id: 'M13',
    what: 'claim boot 3 started at 320x200 before main() ran',
    note: 'this is the mutation that matters most for A1 after M14 itself: if the canvas were '
        + 'already 320x200 before the click, M14 would be measuring the page rather than the '
        + 'game.',
    apply: (L) => editPayload(L, 'boot3-before-play', (o) => { o.canvas_w = 320; o.canvas_h = 200; }),
  },
  {
    id: 'M14',
    what: 'claim the game came back at 1024x768 -- the resolution the player chose is gone',
    apply: (L) => editPayload(L, 'boot3-after-boot', (o) => { o.canvas_w = 1024; o.canvas_h = 768; }),
  },
  {
    id: 'M15',
    what: "delete boot 3's menu-leave save, so nothing it read was written by boot 3",
    apply: (L) => { const i = findMenuLeave(L, 6); return L.filter((_, j) => j !== i); },
  },
  {
    id: 'M16',
    what: 'claim the file boot 3 wrote has the counters refilled, i.e. default.cfg was re-read',
    apply: (L) => editPayload(L, 'boot3-after-save', (o) => { o.tip_left = '0 2 1 1 1'; }),
  },
  {
    id: 'M17',
    what: 'claim the bindings were gone by boot 3',
    apply: (L) => editPayload(L, 'boot3-after-save', (o) => { o.left_binds = []; }),
  },
  {
    id: 'M18',
    what: 'inject an [EXCEPTION] line into the run region',
    apply: (L) => { L.splice(2, 0, stamped('[EXCEPTION] TypeError: synthetic, injected by prove-milestone-checks-can-fail.mjs')); return L; },
  },
  {
    id: 'M19',
    what: 'truncate the transcript at the deliberate-error mark, so the control never fires',
    apply: (L) => L.slice(0, L.findIndex((l) => l.includes('positive-control-deliberate')) + 1),
  },
  {
    id: 'M20',
    what: 'inject an "until TIMED OUT" harness line into the run region',
    apply: (L) => { L.splice(2, 0, stamped('[harness] until TIMED OUT after 30000ms: saw 0x <<synthetic>>, wanted 1')); return L; },
  },
  {
    id: 'M21',
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
  const failed = [...r.stdout.matchAll(/^FAIL {2}(M\w+)/gm)].map((m) => m[1]);
  const passed = [...r.stdout.matchAll(/^PASS {2}(M\w+)/gm)].map((m) => m[1]);
  return { status: r.status, failed, passed, stdout: r.stdout };
}

const tmp = mkdtempSync(join(tmpdir(), 'm4mile-prove-'));
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
  console.log('--   MZ   NOT COVERABLE, by design. MZ compares the ids that produced a verdict');
  console.log('          against the declared list; all twenty-one check() calls in the checker');
  console.log('          are unconditional top-level statements, so no transcript can stop one');
  console.log('          running. It is a regression guard on the checker source, not a check on');
  console.log('          the input.');
  console.log('');
  console.log('The real-browser negative control, which is stronger than any mutation above,');
  console.log('covers one check per assertion:');
  console.log('  M14   A1   the canvas comes back 1024x768 instead of 320x200');
  console.log('  M16   A2   default.cfg is re-read, so the tooltip counters are refilled');
  console.log('  M17   A3   the key bindings are gone');
  console.log('It is web/tools/persistence-milestone-negative.steps -- this same script with');
  console.log("IndexedDB destroyed between boot 2 and boot 3 -- and its transcript is committed");
  console.log('here as negative-chrome-console.log.');
  console.log('');
  const withCollateral = MUTATIONS.filter((m) => (m.also || []).length > 0).length;
  console.log(`Mutations declaring collateral ("also"): ${withCollateral} of ${MUTATIONS.length}.`);
  console.log('');
  console.log(bad === 0
    ? `RESULT: PASS -- all ${MUTATIONS.length} mutations flipped exactly the checks they declared`
    : `RESULT: FAIL -- ${bad} mutation(s) did not behave as declared`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

process.exit(bad === 0 ? 0 : 1);
