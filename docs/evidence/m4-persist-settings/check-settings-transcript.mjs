#!/usr/bin/env node
// Re-check an M4 Task 2 transcript without trusting the report that quotes it.
//
//   node docs/evidence/m4-persist-settings/check-settings-transcript.mjs \
//        docs/evidence/m4-persist-settings/chrome-console.log
//
// Exit status is 0 if every check passes and 1 otherwise, so it can be used as
// a gate rather than read as prose. Everything it prints is derived from the
// transcript file alone -- it never touches the build, the browser or the page.
//
// THE CLAIM IT ARBITRATES, EXACTLY
// --------------------------------
// A setting the PLAYER changed in a menu is durable: leaving the menu writes
// it, the write reaches IndexedDB before any unload event fires, it is still
// there after a real location.reload(), and the reloaded game has the value in
// memory and not merely on disk.
//
// It is deliberately narrower than that sentence sounds in two ways.
//
//   * ONE SETTING, PLAYER_1, changed one way, by typing into the "Name:" field
//     of the First Setup menu. The generalisation to other menus rests on the
//     fact that every configuration-editing uMenuItem in this tree holds a raw
//     pointer to the same variable its tConfItem wraps, not on this
//     transcript. web/tools/persist-settings-gate.steps says why that
//     particular setting, including the one menu in the tree where the
//     generalisation does NOT hold.
//   * NOTHING ABOUT THE BACKSTOP. S9 asserts the beforeunload/visibilitychange
//     path did not fire before the reload, so nothing measured up to that
//     point can be attributed to it. That the checks AFTER the reload do not
//     depend on it either is not knowable from one transcript: it is
//     established by running this same script against
//     armagetronad-nobackstop.html, and the resulting PASS is committed as
//     nobackstop-chrome-console.log.
//
// THE TWO CHECKS THAT CARRY THE MOST WEIGHT are S5 and S8, and neither is the
// obvious one.
//
//   S5 is the NEGATIVE half of the claim: after the name has been typed and
//   before the menu is left, the file on disk is byte-identical to what it was
//   before. Without it, "the file has the new name after Escape" would not
//   distinguish leaving the menu from typing, from a timer, or from anything
//   else that happened in those four seconds.
//
//   S8 reads the bytes out of IndexedDB over a connection the gate script
//   opened itself, WHILE THE PAGE IS STILL ALIVE. That timing is what makes
//   durability attributable to the in-game save rather than to an unload
//   handler -- and it is a different witness from MEMFS, which would look
//   populated for the rest of the page load even if nothing were ever
//   persisted.
//
// HOW EACH CHECK IS SHOWN TO BE ABLE TO FAIL. An assertion never seen to fail
// is not evidence. Two mechanisms cover the seventeen:
//
//   * REAL CONTROL RUNS, committed beside this file. armagetronad-nomenusave
//     .html is a second complete link of the client with the uCallbackMenuLeave
//     registration compiled out (web/Makefile, client-control) -- a real
//     browser running a real game without this task's mechanism. It flips
//     S6 S7 S8 S12 S16. Adding the page-level backstop removal on top
//     (armagetronad-nomenusave-nobackstop.html) also flips S10 and S13.
//   * TRANSCRIPT MUTATION, docs/evidence/m4-persist-settings/
//     prove-settings-checks-can-fail.mjs, for the checks no control can reach
//     (a payload being present and well formed, the fresh-profile baseline,
//     the error-visibility control).
//
// Every one of S1..S17 is covered by one or the other; the prover prints which.
//
// S13 IS NOT A CHECK ON THIS TASK'S MECHANISM, and it would be easy to read it
// as one. It says the value is in the running program's memory -- that
// st_LoadConfig parsed it back -- and any save at all will demonstrate that
// once the file has been clobbered. On the nomenusave control it passes,
// because gArmagetron.cpp calls st_SaveConfig() unconditionally after
// MainMenu() returns and boot 2 there happens to open on the main menu. S12,
// which counts menu-leave saves between two marks, is the check that is about
// the mechanism.
//
// SZ IS NOT A TRANSCRIPT CHECK. It is a guard on THIS FILE: it compares the
// ids that produced a verdict against the declared list, so a check that
// VANISHES in a future edit reads as what it is rather than as a pass. As this
// file stands all seventeen check() calls are unconditional top-level
// statements, so SZ cannot fail on any input.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: check-settings-transcript.mjs <console.log>');
  process.exit(2);
}
const lines = readFileSync(path, 'utf8').split('\n');

// The value the gate types, and the default it replaces. Spelled here as
// constants so a change to web/tools/persist-settings-gate.steps that this
// file has not followed fails loudly instead of quietly matching nothing.
const DEFAULT_NAME = 'web_user';
const TYPED_NAME = 'web_userqzxjv';
const CLOBBER = 'CLOBBERED-BY-THE-GATE';

// Lines the harness itself wrote are never page output. Excluding them is not
// tidiness: an `eval:` step is echoed in full, and the gate's helper-installer
// and IndexedDB probe both contain the literal strings "[SETFS] " and
// "[SETIDB] ". Counting those would let the script satisfy its own assertions.
const isHarness = (l) => l.includes('] [harness] ');

// ---------------------------------------------------------------- partitions
const controlAt = lines.findIndex((l) => l.includes('positive-control-deliberate'));
const runEnd = controlAt < 0 ? lines.length : controlAt;
const markAt = (name) => lines.findIndex((l, i) => i < runEnd && l.includes(`=== ${name} ===`));

const reloadAt = markAt('RELOAD-REQUESTED');
const escapeAt = markAt('ESCAPE-LEAVES-THE-SETTINGS-MENU');
const menuLeftAt = markAt('MENU-LEFT');
const clobberAt = markAt('USER-CFG-CLOBBERED-FROM-JS');
const rewroteAt = markAt('BOOT-2-REWROTE-IT-FROM-MEMORY');

const inRun = (i) => i >= 0 && i < runEnd;
const inBoot1 = (i) => inRun(i) && (reloadAt < 0 || i < reloadAt);

// --------------------------------------------------------------- extraction
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
const saves = tagged('[PERSISTSAVE] ');
const menuLeaveSaves = saves.filter(([, s]) => s.startsWith('menu-leave'));
const backstopSaves = tagged('[PERSISTBACKSTOP] ');
const fsDumps = taggedJson('[SETFS] ');
const idbDumps = taggedJson('[SETIDB] ');

// Phase names are written by the page into each payload, so no check ever has
// to infer which boot a line belongs to by counting.
const byPhase = (dumps) => Object.fromEntries(dumps.map(([i, o]) => [o.phase, { i, o }]));
const FS = byPhase(fsDumps);
const IDB = byPhase(idbDumps);

const EXPECTED_PHASES = [
  'boot1-before-play', 'boot1-first-setup-open', 'boot1-typed-not-yet-left',
  'boot1-after-menu-leave', 'boot2-before-play', 'boot2-after-boot',
  'boot2-clobbered', 'boot2-after-menu-leave',
];

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
const okPopulates = populate.filter(([, s]) => s.startsWith('ok'));
check(reloadAt >= 0 && okPopulates.length === 2
      && okPopulates[0][0] < reloadAt && okPopulates[1][0] > reloadAt, 'S1',
  'two real page loads, partitioned by the RELOAD-REQUESTED mark'
  + ` (populates at ${okPopulates.map(([i]) => i).join(',')}, reload mark at ${reloadAt})`);

const missingPhases = EXPECTED_PHASES.filter((p) => !FS[p]);
const dupPhases = EXPECTED_PHASES.filter((p) => fsDumps.filter(([, o]) => o.phase === p).length !== 1);
check(missingPhases.length === 0 && dupPhases.length === 0 && !!IDB['boot1-idb'], 'S2',
  'all eight [SETFS] phases and the one [SETIDB] phase are present exactly once'
  + (missingPhases.length ? ` (missing: ${missingPhases.join(' ')})` : '')
  + (dupPhases.length ? ` (not exactly once: ${dupPhases.join(' ')})` : '')
  + (IDB['boot1-idb'] ? '' : ' (boot1-idb missing)'));

// -------------------------------------------------------- boot 1: the setup
const pre = FS['boot1-before-play'];
check(!!pre && pre.o.present === false, 'S3',
  'fresh browser profile: /persist/var/user.cfg does not exist before the game runs'
  + (pre ? ` (present=${pre.o.present})` : ' (payload missing)'));

const base = FS['boot1-first-setup-open'];
check(!!base && base.o.present === true && base.o.player_1 === DEFAULT_NAME, 'S4',
  `baseline: the file exists and PLAYER_1 is still the default ${JSON.stringify(DEFAULT_NAME)}`
  + (base ? ` (${JSON.stringify(base.o.player_1)}, ${base.o.bytes} bytes)` : ' (payload missing)'));

// THE NEGATIVE HALF OF THE CLAIM. Screenshot 04 shows the new name on screen
// at this moment; the file is byte-identical to the baseline. Typing does not
// save, so whatever saves next is attributable to leaving the menu.
const typed = FS['boot1-typed-not-yet-left'];
check(!!typed && !!base && typed.o.player_1 === DEFAULT_NAME
      && typed.o.hash === base.o.hash && typed.o.bytes === base.o.bytes, 'S5',
  'after typing and BEFORE leaving the menu, the file is unchanged -- the edit is memory-only'
  + (typed && base ? ` (hash ${base.o.hash} -> ${typed.o.hash}, PLAYER_1 ${JSON.stringify(typed.o.player_1)})` : ''));

// ------------------------------------------------ boot 1: the save, observed
const betweenEscape = menuLeaveSaves.filter(([i]) => escapeAt >= 0 && menuLeftAt >= 0
                                                 && i > escapeAt && i < menuLeftAt);
check(escapeAt >= 0 && menuLeftAt >= 0 && betweenEscape.length === 1, 'S6',
  'exactly one menu-leave save fired between the Escape mark and the MENU-LEFT mark'
  + ` (saw ${betweenEscape.length}; marks at ${escapeAt}/${menuLeftAt})`);
for (const [i, s] of menuLeaveSaves) note(`menu-leave save at line ${i}: ${s}`);

const after = FS['boot1-after-menu-leave'];
check(!!after && after.o.player_1 === TYPED_NAME && !!typed && after.o.hash !== typed.o.hash, 'S7',
  `leaving the menu wrote the player's change: PLAYER_1 is ${JSON.stringify(TYPED_NAME)}`
  + (after ? ` (${JSON.stringify(after.o.player_1)}, ${after.o.bytes} bytes, hash ${after.o.hash})` : ' (payload missing)'));

// THE DURABILITY WITNESS, and its position in the transcript is half the
// claim: strictly before the RELOAD-REQUESTED mark, i.e. before any unload
// event of any kind has fired.
const idb = IDB['boot1-idb'];
check(!!idb && idb.o.absent === false && idb.o.user_cfg_present === true
      && idb.o.player_1 === TYPED_NAME && !!after && idb.o.bytes === after.o.bytes
      && idb.i < reloadAt, 'S8',
  'IndexedDB itself holds the changed value, read directly and BEFORE any unload event'
  + (idb ? ` (${JSON.stringify(idb.o.player_1)}, ${idb.o.bytes} bytes, ${idb.o.key_count} keys, line ${idb.i} < ${reloadAt})` : ' (payload missing)'));

// The backstop must not be able to explain anything measured above.
const backstopBefore = backstopSaves.filter(([i]) => inBoot1(i));
check(backstopBefore.length === 0, 'S9',
  'no [PERSISTBACKSTOP] line before the reload: nothing above came from beforeunload/visibilitychange'
  + ` (saw ${backstopBefore.length})`);
for (const [i, s] of backstopSaves) note(`backstop line ${i}: ${s}`);

// ------------------------------------------------------------- the round trip
//
// player_1 ONLY. Byte count and hash are deliberately not compared across the
// reload: the file boot 2 reads may have been written by the menu-leave save
// or by boot 1's beforeunload backstop, and those differ in FIRST_USE and in
// whether the keyboard template is present. The player's name is in both,
// which is the whole reason it is what this gate follows.
const b2pre = FS['boot2-before-play'];
check(!!b2pre && b2pre.o.present === true && b2pre.o.player_1 === TYPED_NAME, 'S10',
  'after a real reload, a page that has written nothing reads the changed value back'
  + (b2pre ? ` (${JSON.stringify(b2pre.o.player_1)}, ${b2pre.o.bytes} bytes)` : ' (payload missing)'));

const b2boot = FS['boot2-after-boot'];
const clob = FS['boot2-clobbered'];
check(!!clob && clob.o.clobbered === true && clob.o.player_1 === null
      && !!b2boot && b2boot.o.clobbered === false, 'S11',
  'the clobber really happened: user.cfg is replaced by non-config text with no PLAYER_1 line'
  + (clob ? ` (${clob.o.bytes} bytes, clobbered=${clob.o.clobbered})` : ' (payload missing)'));

const betweenClobber = menuLeaveSaves.filter(([i]) => clobberAt >= 0 && rewroteAt >= 0
                                                   && i > clobberAt && i < rewroteAt);
check(clobberAt >= 0 && rewroteAt >= 0 && betweenClobber.length === 1, 'S12',
  'exactly one menu-leave save fired in boot 2, between the clobber and the mark after it'
  + ` (saw ${betweenClobber.length}; marks at ${clobberAt}/${rewroteAt})`);

// THE STRONGEST CHECK HERE. Bytes surviving on disk cannot produce this: the
// bytes were destroyed, and the game put the value back from its own memory.
const b2after = FS['boot2-after-menu-leave'];
check(!!b2after && b2after.o.clobbered === false && b2after.o.player_1 === TYPED_NAME
      && b2after.o.bytes > 1000, 'S13',
  'boot 2 rewrote the clobbered file FROM ITS OWN MEMORY with the restored value intact'
  + (b2after ? ` (${JSON.stringify(b2after.o.player_1)}, ${b2after.o.bytes} bytes)` : ' (payload missing)'));

// ------------------------------------------------------------ run hygiene
const BAD = ['[EXCEPTION]', 'Stack overflow detected', 'SDL event queue full',
             'Aborted(', 'RuntimeError', 'MEMORY_GROWTH'];
const badLines = lines.map((l, i) => [i, l])
  .filter(([i, l]) => inRun(i) && !isHarness(l) && BAD.some((b) => l.includes(b)));
check(badLines.length === 0, 'S14',
  `no exception, abort, stack overflow or SDL queue overflow in the run (saw ${badLines.length})`);
for (const [i, l] of badLines.slice(0, 5)) note(`line ${i}: ${l.slice(0, 160)}`);

// The positive control: without it, S14's silence is not an observation.
const sawControl = lines.some((l, i) => i > controlAt && controlAt >= 0
  && (l.includes('[EXCEPTION]') || l.includes('thisIsADeliberateUncaughtError')
      || l.includes('Failed to load: ')));
check(controlAt >= 0 && sawControl, 'S15',
  'the deliberate uncaught error at the end WAS seen, so S14 is an observation and not a silence'
  + ` (control mark at ${controlAt})`);

const timeouts = lines.map((l, i) => [i, l]).filter(([i, l]) => inRun(i) && l.includes('until TIMED OUT'));
check(timeouts.length === 0, 'S16',
  `every until: step was satisfied rather than timing out (saw ${timeouts.length} timeouts)`);
for (const [i, l] of timeouts) note(`line ${i}: ${l.slice(l.indexOf('[harness]'), l.indexOf('[harness]') + 140)}`);

const loadFails = lines.map((l, i) => [i, l])
  .filter(([, l]) => l.includes('Failed to load resource') && !l.includes('/favicon.ico'));
check(loadFails.length === 0, 'S17',
  `every failed resource load is the browser's own /favicon.ico probe (other failures: ${loadFails.length})`);
for (const [i, l] of loadFails.slice(0, 5)) note(`line ${i}: ${l.slice(0, 160)}`);

// ---------------------------------------------------------------- self-guard
const DECLARED = Array.from({ length: 17 }, (_, n) => `S${n + 1}`);
const missing = DECLARED.filter((id) => !emitted.includes(id));
const extra = emitted.filter((id) => !DECLARED.includes(id));
check(missing.length === 0 && extra.length === 0, 'SZ',
  `all ${DECLARED.length} declared checks produced a verdict`
  + (missing.length ? ` (missing ${missing.join(' ')})` : '')
  + (extra.length ? ` (undeclared ${extra.join(' ')})` : ''));

console.log('');
console.log(failures === 0 ? `PASS  ${emitted.length}/${emitted.length} checks`
                           : `FAIL  ${failures} of ${emitted.length} checks failed`);
process.exit(failures === 0 ? 0 : 1);
