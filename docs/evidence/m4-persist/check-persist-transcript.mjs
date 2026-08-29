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
// THE ORDERING CHECKS (P2/P3) ARE THE ONES THAT MATTER MOST, because the bug
// they exclude is silent. FS.syncfs(true, cb) is asynchronous; if main() is
// allowed to start before that callback fires, st_LoadConfig reads an empty
// /persist and the next save writes a fresh file over the top. Saving keeps
// working, nothing is ever read back, and from inside the game that is
// indistinguishable from success. web/shell.html holds an Emscripten run
// dependency across the populate, which is why "[PERSIST] populate ok" must
// precede "[PERSIST] runtime initialized" -- the latter being the exact moment
// the Play button becomes clickable, i.e. the earliest moment main() can run.
//
// HOW EACH CHECK IS SHOWN TO BE ABLE TO FAIL. An assertion never seen to fail
// is not evidence. Two committed control runs cover the load-bearing ones:
//   docs/evidence/m4-persist/negative-*-console.log  (IndexedDB wiped between
//       the boots, web/tools/persist-negative.steps) flips P10 P11 P12 P13.
//   docs/evidence/m4-persist/ungated-*-console.log   (the same page with the
//       run dependency deleted, make-ungated-page.mjs) flips P2 P3.
// The remaining checks are structural (a payload is present and well formed,
// the control error was seen) and are NOT individually proven-failable; that
// is stated here rather than glossed over.
//
// EVERY CHECK IS ID'd (P1..P17, plus PZ) and PZ fails if any declared id did
// not get a verdict -- a check that VANISHES inside a guard reads, to anyone
// scanning for the word FAIL, exactly like a check that passed.

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
const p1 = populate.find(([i]) => inBoot1(i));
const r1 = runtimeInit.find(([i]) => inBoot1(i));
check(!!p1 && !!r1 && p1[0] < r1[0], 'P3',
  `boot 1: populate finished BEFORE the runtime reported ready / Play became clickable`
  + (p1 && r1 ? ` (lines ${p1[0]} < ${r1[0]})` : ' (a line is missing)'));

const p2 = populate.find(([i]) => inBoot2(i));
const r2 = runtimeInit.find(([i]) => inBoot2(i));
check(!!p2 && !!r2 && p2[0] < r2[0], 'P4',
  `boot 2: populate finished BEFORE the runtime reported ready / Play became clickable`
  + (p2 && r2 ? ` (lines ${p2[0]} < ${r2[0]})` : ' (a line is missing)'));

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

check(!!b2 && !!b1post && b2.o.user_cfg?.hash !== null
      && b2.o.user_cfg?.hash === b1post.o.user_cfg?.hash, 'P11',
  'boot 2 read user.cfg back with the SAME content hash'
  + (b2 && b1post ? ` (${b1post.o.user_cfg?.hash} -> ${b2.o.user_cfg?.hash})` : ''));

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

// Boot 2 must have READ before it could have WRITTEN. The gate clicks Play in
// boot 2 only after the two payloads above, so if that ordering were ever
// reversed the round-trip checks could be satisfied by boot 2's own save.
const clicks = lines.map((l, i) => [i, l]).filter(([, l]) => l.includes('[harness] click #start'));
const boot2Click = clicks.find(([i]) => inBoot2(i));
check(!!b2 && !!b2idb && (!boot2Click || (b2.i < boot2Click[0] && b2idb.i < boot2Click[0])), 'P14',
  'boot 2 was measured BEFORE it clicked Play, so its own save cannot explain the result'
  + (boot2Click ? ` (payloads at ${b2?.i}/${b2idb?.i}, click at ${boot2Click[0]})` : ' (boot 2 never clicked Play)'));

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
