#!/usr/bin/env node
// Re-check an M4 persistence transcript without trusting the report that quotes it.
//
//   node docs/evidence/m4-persist/check-persist-transcript.mjs docs/evidence/m4-persist/chrome-console.log
//   node docs/evidence/m4-persist/check-persist-transcript.mjs docs/evidence/m4-persist/firefox-console.log
//
// Exit status is 0 if every check passes and 1 otherwise, so it can be used as
// a gate rather than read as prose. Everything it prints is derived from the
// transcript file alone -- it never touches the build, the browser or the page.
//
// THE CLAIM IT ARBITRATES, EXACTLY
// --------------------------------
// /persist is an IndexedDB-backed mount whose populate completes BEFORE the
// game can start, and bytes written into it during one page load are readable
// after a real location.reload().
//
// It does NOT establish that the game USES what it read. user.cfg surviving is
// a filesystem fact; whether st_LoadConfig's values take effect, and whether
// key bindings in particular do, is a later task's claim and no check here
// speaks to it. A gate that over-claims is worse than no gate.
//
// TWO INDEPENDENT WITNESSES, AND WHY BOTH ARE NEEDED
// --------------------------------------------------
//   * the MEMFS view  ([PERSISTFS])  -- what the program sees at each phase.
//   * IndexedDB itself ([PERSISTIDB]) -- read over a connection the gate script
//     opens for itself, so it is not IDBFS reporting on IDBFS.
// A mount that persisted nothing at all would still show a populated /persist
// in FS.readdir for the rest of the page load; only the second witness, and
// the reload, can tell that apart from real persistence.
//
// THE ORDERING CHECKS (P3/P4) ARE THE ONES THAT MATTER MOST, because the bug
// they exclude is silent. FS.syncfs(true, cb) is asynchronous; if main() is
// allowed to start before that callback fires, st_LoadConfig reads an empty
// /persist and the next save writes a fresh file over the top. Saving keeps
// working, nothing is ever read back, and from inside the game that is
// indistinguishable from success. web/shell.html holds an Emscripten run
// dependency across the populate, which is why "[PERSIST] populate ok" must
// precede "[PERSIST] runtime initialized" -- the latter being the exact moment
// main() is called, i.e. the earliest moment main() can run.
//
// HOW EACH CHECK IS SHOWN TO BE ABLE TO FAIL. An assertion never seen to fail
// is not evidence. Three committed control runs cover the load-bearing ones:
//   negative-chrome-console.log     IndexedDB wiped between the boots
//                                   (web/tools/persist-negative.steps).
//                                   Flips P10 P11 P12 P13.
//   slowungated-chrome-console.log  the run dependency deleted AND the
//                                   populate slowed to 3 s
//                                   (make-control-pages.mjs). Flips P3 P4.
//   slowgate-chrome-console.log     the populate slowed to 3 s with the
//                                   dependency KEPT. Passes, and passing is
//                                   the finding: the runtime waited three
//                                   seconds for the filesystem.
// Deleting the run dependency WITHOUT slowing the populate does NOT flip
// P3/P4 on this machine -- measured (ungated-chrome-console.log, which this
// checker scores PASS), and explained at length in make-control-pages.mjs. That is not a weakness in the checks; it is the
// intermittency that makes the bug they exclude dangerous.
//
// The remaining checks are structural (a payload is present and well formed,
// the control error was seen) and are NOT individually proven-failable; that
// is stated here rather than glossed over.
//
// EVERY CHECK IS ID'd (P1..P17, plus PZ), and P1..P17 are the checks ON THE
// TRANSCRIPT. PZ IS NOT ONE OF THEM: it is a guard on THIS FILE.
//
// It compares the ids that produced a verdict against the declared list, so a
// check that VANISHES reads as what it is rather than as a pass -- because a
// check that never printed looks, to anyone scanning for the word FAIL,
// exactly like one that passed. As this file stands today all seventeen
// check() calls are unconditional top-level statements, so PZ cannot fail on
// ANY input: no transcript, however mutilated, can make one of them not run.
// It is therefore a regression guard against a future edit that puts a check
// behind an `if` (M3's AZ was the same idea, and was genuinely reachable
// because its checks sat inside guards), and it is deliberately NOT listed
// among the transcript checks whose failure has been demonstrated -- there is
// nothing to demonstrate. prove-checks-can-fail.mjs reports it as
// NOT-COVERABLE with this reason rather than skipping it silently.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: check-persist-transcript.mjs <console.log>');
  process.exit(2);
}
const lines = readFileSync(path, 'utf8').split('\n');

// Lines the harness itself wrote are never page output. Excluding them is not
// tidiness: an `eval:` step is echoed in full, and every probe expression in
// web/tools/persist-gate.steps contains the literal strings "[PERSISTFS] ",
// "[PERSISTIDB] " and "[PERSIST] populate ok". Counting those would let the
// script satisfy its own assertions.
const isHarness = (l) => l.includes('] [harness] ');

// ---------------------------------------------------------------- partitions
//
// The transcript is CUMULATIVE across two page loads and one deliberate fault.
// Three regions, split at harness marks:
//   [0, control)      the run
//     [0, reload)       boot 1
//     [reload, control) boot 2
//   [control, end)    the deliberate uncaught error, which must be VISIBLE.
const controlAt = lines.findIndex((l) => l.includes('positive-control-deliberate'));
const runEnd = controlAt < 0 ? lines.length : controlAt;
const reloadAt = lines.findIndex((l, i) => i < runEnd && l.includes('=== RELOAD-REQUESTED ==='));

const inRun = (i) => i >= 0 && i < runEnd;
const inBoot1 = (i) => inRun(i) && (reloadAt < 0 || i < reloadAt);
const inBoot2 = (i) => inRun(i) && reloadAt >= 0 && i > reloadAt;

// --------------------------------------------------------------- extraction

// Every page-emitted line carrying `tag`, as [index, textAfterTag].
function tagged(tag) {
  const out = [];
  lines.forEach((l, i) => {
    if (isHarness(l)) return;
    const at = l.indexOf(tag);
    if (at >= 0) out.push([i, l.slice(at + tag.length).trim()]);
  });
  return out;
}

function taggedJson(tag) {
  return tagged(tag).map(([i, s]) => {
    try { return [i, JSON.parse(s)]; } catch { return [i, { __parse_error: s.slice(0, 200) }]; }
  });
}

const populate = tagged('[PERSIST] populate ');
const runtimeInit = tagged('[PERSIST] runtime initialized');
const syncLines = tagged('[PERSISTSYNC] ');
const nonces = tagged('[PERSISTNONCE] ');
const fsDumps = taggedJson('[PERSISTFS] ');
const idbDumps = taggedJson('[PERSISTIDB] ');
const wipes = taggedJson('[PERSISTWIPE] ');

// Phase names are written by the page into each payload, so no check ever has
// to infer which boot a line belongs to by counting.
const byPhase = (dumps) => Object.fromEntries(dumps.map(([i, o]) => [o.phase, { i, o }]));
const FS = byPhase(fsDumps);
const IDB = byPhase(idbDumps);

// ------------------------------------------------------------------ verdicts

let failures = 0;
const emitted = [];
const check = (ok, id, text) => {
  emitted.push(id);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${text}`);
};
const note = (text) => console.log(`      ..    ${text}`);

console.log(`transcript: ${path}`);
console.log(`lines: ${lines.length}   run region: 0..${runEnd}   reload mark at line ${reloadAt}`);
console.log('');

// ---------------------------------------------------------------- structure
check(reloadAt >= 0, 'P1',
  `the RELOAD-REQUESTED mark that partitions the two boots is present (line ${reloadAt})`);

const okPopulates = populate.filter(([, s]) => s.startsWith('ok'));
check(populate.length === 2 && okPopulates.length === 2, 'P2',
  `exactly two "[PERSIST] populate" lines, both ok (saw ${populate.length}, ok ${okPopulates.length})`);
for (const [i, s] of populate) note(`populate line ${i}: ${s}`);

// ---------------------------------------------------- the ordering, per boot
//
// One populate and one runtime-initialized line per page load; the populate
// must come first in BOTH. See the header for why this is the check that
// excludes the silent failure.
// The parenthetical states WHERE the two lines are, never that one is before
// the other: on a failing transcript "(lines 8 < 7)" reads as an observation
// and is a falsehood printed by the tool that just caught it.
const where = (p, r) => (p && r)
  ? ` (populate at line ${p[0]}, runtime ready at line ${r[0]})`
  : ' (a line is missing)';

const p1 = populate.find(([i]) => inBoot1(i));
const r1 = runtimeInit.find(([i]) => inBoot1(i));
check(!!p1 && !!r1 && p1[0] < r1[0], 'P3',
  `boot 1: populate finished BEFORE the runtime reported ready / Play became clickable`
  + where(p1, r1));

const p2 = populate.find(([i]) => inBoot2(i));
const r2 = runtimeInit.find(([i]) => inBoot2(i));
check(!!p2 && !!r2 && p2[0] < r2[0], 'P4',
  `boot 2: populate finished BEFORE the runtime reported ready / Play became clickable`
  + where(p2, r2));

// --------------------------------------------------------------- boot 1 FS
const b1pre = FS['boot1-before-play'];
check(!!b1pre && b1pre.o.error === null && b1pre.o.entry_count === 0
      && b1pre.o.user_cfg?.present === false && b1pre.o.probe_text === null, 'P5',
  '/persist is EMPTY before the game runs, on a fresh browser profile'
  + (b1pre ? ` (${b1pre.o.entry_count} entries)` : ' (payload missing)'));

const b1post = FS['boot1-after-play'];
check(!!b1post && b1post.o.user_cfg?.present === true && b1post.o.user_cfg.bytes > 0, 'P6',
  'booting the game WROTE /persist/var/user.cfg'
  + (b1post?.o.user_cfg?.present ? ` (${b1post.o.user_cfg.bytes} bytes, hash ${b1post.o.user_cfg.hash})` : ' (absent)'));
if (b1post) note(`boot 1 /persist contents: ${(b1post.o.entries || []).map((e) => e.path).join(' ')}`);

// The write happened with no player input: the first persist starts between
// the Play click and the sentinel step, and this script presses no keys at
// all. `[harness] key ` would be the only way one could have been pressed.
const firstSync = syncLines.find(([i, s]) => inBoot1(i) && s.startsWith('start 1'));
const nonce1 = nonces.find(([i]) => inBoot1(i));
const anyKey = lines.findIndex((l) => l.includes('[harness] key '));
check(!!firstSync && !!nonce1 && firstSync[0] < nonce1[0] && anyKey < 0, 'P7',
  'the FIRST IndexedDB persist was triggered by the game itself, before this script wrote anything'
  + (firstSync && nonce1 ? ` (persist at line ${firstSync[0]}, sentinel at ${nonce1[0]}, key presses: ${anyKey < 0 ? 0 : 1}+)` : ''));

check(nonces.length === 1 && !!nonce1, 'P8',
  `exactly one sentinel nonce, minted in boot 1 (${nonce1 ? nonce1[1] : 'none'})`);

// -------------------------------------------------------------- boot 1 IDB
const b1idb = IDB['boot1-idb'];
const keysOf = (d) => (d?.o.keys || []);
const hasKey = (d, k) => keysOf(d).includes(k);
check(!!b1idb && b1idb.o.absent === false && (b1idb.o.stores || []).includes('FILE_DATA')
      && hasKey(b1idb, '/persist/var/user.cfg') && hasKey(b1idb, '/persist/m4-probe.txt'), 'P9',
  'IndexedDB itself holds user.cfg and the sentinel after boot 1'
  + (b1idb ? ` (${b1idb.o.count} keys in ${JSON.stringify(b1idb.o.databases)})` : ' (payload missing)'));
if (b1idb) note(`boot 1 IndexedDB keys: ${keysOf(b1idb).join(' ')}`);

// ------------------------------------------------------ the round trip
const b2 = FS['boot2-before-play'];
check(!!b2 && b2.o.user_cfg?.present === true && !!b1post
      && b2.o.user_cfg.bytes === b1post.o.user_cfg.bytes, 'P10',
  'boot 2 read user.cfg back at the SAME byte count'
  + (b2 && b1post ? ` (${b1post.o.user_cfg.bytes} -> ${b2.o.user_cfg.bytes})` : ''));

// P11 IS KNOWN TO FAIL AGAINST ANY BUILD SINCE M4 TASK 2, AND THAT IS NOT A
// PERSISTENCE FAILURE. It compares the hash sampled in boot 1 against what boot
// 2 reads back. Between those two moments boot 1 unloads, and M4 task 2's
// unload backstop (web/shell.html, `persistBackstop`) calls
// _aa_web_save_config() -- so what boot 2 reads is boot 1's user.cfg written
// LATER than the sample, same 21950 bytes, different content.
//
// The committed docs/evidence/m4-persist/chrome-console.log passes P11 because
// it was recorded during M4 task 1, BEFORE task 2 added that backstop: it
// contains zero [PERSISTBACKSTOP] and zero [PERSISTSAVE] lines, while every
// re-recording since contains "[PERSISTSAVE] js-backstop n=1" and
// "[PERSISTBACKSTOP] beforeunload". So this is a gate that has certified a page
// that stopped existing inside its own milestone -- the same defect class M5
// task 2 found in M4's other gate -- and M5 task 5 is reporting it rather than
// silently rewriting the check to pass, because deciding what P11 should mean
// now is a judgement about the claim, not about the code.
//
// THE MILESTONE CLAIM DOES NOT REST ON P11. P10 (same byte count), P12 (the
// sentinel nonce, which the game cannot regenerate) and P13 (IndexedDB holds
// both files) carry it, and all three are unaffected by a later write.
const backstopped = lines.some((l) => l.includes('[PERSISTBACKSTOP] beforeunload'));
check(!!b2 && !!b1post && b2.o.user_cfg?.hash !== null
      && b2.o.user_cfg?.hash === b1post.o.user_cfg?.hash, 'P11',
  'boot 2 read user.cfg back with the SAME content hash'
  + (b2 && b1post ? ` (${b1post.o.user_cfg?.hash} -> ${b2.o.user_cfg?.hash})` : ''));
if (backstopped) {
  note('P11 above: this transcript contains "[PERSISTBACKSTOP] beforeunload", so boot 1 '
     + 'rewrote user.cfg during unload, AFTER the hash was sampled. A P11 failure here is '
     + 'that write, not a persistence failure -- see the comment above this check. A '
     + 'transcript without that line (M4 task 1 vintage) is the only kind P11 can pass.');
}

// The nonce is the check that cannot be satisfied by a coincidence: it did not
// exist anywhere until boot 1 minted it.
check(!!b2 && !!nonce1 && typeof b2.o.probe_text === 'string'
      && b2.o.probe_text.includes(nonce1[1]), 'P12',
  'boot 2 read back the sentinel nonce boot 1 minted'
  + (nonce1 ? ` (${nonce1[1]} -> ${JSON.stringify(b2?.o.probe_text)})` : ''));

const b2idb = IDB['boot2-idb'];
check(!!b2idb && b2idb.o.absent === false
      && hasKey(b2idb, '/persist/var/user.cfg') && hasKey(b2idb, '/persist/m4-probe.txt'), 'P13',
  'IndexedDB still holds both files when boot 2 reads it directly'
  + (b2idb ? ` (${b2idb.o.count} keys)` : ' (payload missing)'));

// Boot 2 must have READ before it could have WRITTEN. The gate reads the two
// payloads above before boot 2's main() runs, so if that ordering were ever
// reversed the round-trip checks could be satisfied by boot 2's own save.
//
// THE MARKER IS THE PAGE'S, NOT THE HARNESS'S, and that is an improvement M5
// task 5 made rather than a rename it was forced into. This used to look for
// "[harness] click #start", the driver's record of having asked; it now looks
// for "[BOOT] autostart", which web/shell.html prints on the line before it
// calls main(). The old marker said when the DRIVER acted, this one says when
// the GAME started -- which is the event P14 is actually about.
const starts = lines.map((l, i) => [i, l]).filter(([, l]) => l.includes('[BOOT] autostart'));
const boot2Start = starts.find(([i]) => inBoot2(i));
check(!!b2 && !!b2idb && (!boot2Start || (b2.i < boot2Start[0] && b2idb.i < boot2Start[0])), 'P14',
  'boot 2 was measured BEFORE its main() started, so its own save cannot explain the result'
  + (boot2Start ? ` (payloads at ${b2?.i}/${b2idb?.i}, start at ${boot2Start[0]})` : ' (boot 2 never started)'));

// ------------------------------------------------------------ hygiene
const bad = [];
for (let i = 0; i < runEnd; i++) {
  const l = lines[i];
  if (isHarness(l)) continue;
  if (l.includes('[EXCEPTION]') || l.includes('[FATAL]') || l.includes('Stack overflow detected')
      || l.includes('SDL event queue full')) bad.push(`${i}: ${l.trim().slice(0, 160)}`);
}
check(bad.length === 0, 'P15', `no exception, crash, stack overflow or SDL queue overflow during the run (${bad.length})`);
for (const b of bad.slice(0, 8)) note(b);

// Every 404 in a passing transcript is /favicon.ico -- the browser asks for it
// once per navigation and python3 -m http.server has none. Any other missing
// resource is a real failure, and both drivers now log the URL so this rule is
// checkable rather than decorative.
const notFound = [];
for (let i = 0; i < runEnd; i++) {
  const l = lines[i];
  if (isHarness(l)) continue;
  if (/\b404\b/.test(l) && !l.includes('favicon.ico')) notFound.push(`${i}: ${l.trim().slice(0, 160)}`);
}
check(notFound.length === 0, 'P16', `every 404 during the run is /favicon.ico (${notFound.length} others)`);
for (const n of notFound.slice(0, 8)) note(n);

// The transcript must be able to SEE a failure. Without this, "no [EXCEPTION]
// during the run" is a silence, not an observation -- M1's Firefox transcript
// was read as clean when it was merely deaf.
const controlSaw = controlAt >= 0
  && lines.slice(controlAt).some((l) => l.includes('thisIsADeliberateUncaughtError')
                                     || l.includes('[EXCEPTION]'));
check(controlSaw, 'P17',
  'the deliberate uncaught error at the end of the script WAS recorded, so this transcript can see failures');

// ------------------------------------------------------ observations, not checks
//
// PROVENANCE. Four of the six committed transcripts are PASSes and only one of
// them is the product; the rest are control pages that happen to pass. The
// driver records the page it navigated to on its second line, so which green
// is which need not be looked up in the README.
const nav = lines.find((l) => l.includes('[harness] navigating to '));
const url = nav ? nav.slice(nav.indexOf('navigating to ') + 'navigating to '.length).trim() : null;
const page = url ? url.split('/').pop() : null;
if (page && page !== 'armagetronad.html') {
  console.log('');
  console.log(`NOTE  this transcript is NOT the product page: it navigated to ${page}.`);
  console.log('      It is one of the control pages built by make-control-pages.mjs, so a');
  console.log('      PASS here says the control behaved as designed, not that the client is good.');
} else if (!page) {
  console.log('');
  console.log('NOTE  no "[harness] navigating to" line: the page under test cannot be identified');
  console.log('      from this transcript, so it may or may not be the product page.');
}

if (wipes.length) {
  console.log('');
  console.log('NOTE  this transcript contains a [PERSISTWIPE] step, so it is the negative');
  console.log('      control (web/tools/persist-negative.steps) and is EXPECTED to fail:');
  for (const [i, o] of wipes) note(`${i}: ${JSON.stringify(o)}`);
}

// ------------------------------------------------------------------ PZ
const declared = ['P1','P2','P3','P4','P5','P6','P7','P8','P9','P10',
                  'P11','P12','P13','P14','P15','P16','P17'];
const missing = declared.filter((d) => !emitted.includes(d));
const extra = emitted.filter((e) => !declared.includes(e));
console.log('');
check(missing.length === 0 && extra.length === 0, 'PZ',
  `every declared check produced a verdict (missing: ${missing.join(',') || 'none'}; unexpected: ${extra.join(',') || 'none'})`);

console.log('');
console.log(failures === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures} check${failures === 1 ? '' : 's'})`);
process.exit(failures === 0 ? 0 : 1);
