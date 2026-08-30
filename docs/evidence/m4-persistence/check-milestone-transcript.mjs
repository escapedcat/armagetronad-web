#!/usr/bin/env node
// Re-check an M4 MILESTONE transcript without trusting the report that quotes it.
//
//   node docs/evidence/m4-persistence/check-milestone-transcript.mjs \
//        docs/evidence/m4-persistence/chrome-console.log
//
// Exit status is 0 if every check passes and 1 otherwise, so it can be used as
// a gate rather than read as prose. Everything it prints is derived from the
// transcript file alone -- it never touches the build, the browser or the page.
//
// THE CLAIM IT ARBITRATES, EXACTLY
// ---------------------------------------------------------------------------
// A player who sets the game up, closes the tab and comes back gets their game
// back: the resolution they picked, a program that does not make them do first
// setup again, and controls that still steer. Three assertions, and the point
// of this file rather than the three task gates already in docs/evidence/ is
// that none of those asserts any of them -- each proves one MECHANISM
// (an IDBFS mount, a menu-leave save, a config precedence order) and stops.
//
//   A1  M9 M10 M11 M13 M14   the resolution round trip, measured on the CANVAS
//   A2  M6 M8 M15 M16        the first-use path is skipped on later boots
//   A3  M4 M5 M7 M12 M17     the keycode round trip, and the cycle turning on it
//
// The remaining checks are structure (M1 M2 M3) and run hygiene
// (M18 M19 M20 M21), plus MZ, which is a guard on this file rather than on the
// transcript.
//
// THE THREE CHECKS THAT CARRY THE MOST WEIGHT, and none is the obvious one.
//
//   M14 is A1's payoff and it is measured OUTSIDE THE WASM: the width and
//   height of the <canvas> element. web/shell.html hard-codes width="1024"
//   height="768" on that element, so every boot starts there; the only thing
//   that can make it 320x200 is the game calling SDL_SetVideoMode with a
//   resolution it read back. M13 records the 1024x768 in the same page load,
//   moments earlier, which is what turns M14 from a number into a change.
//
//   M12 is A3, and it is an integer comparison rather than a judgement about a
//   screenshot. uActionTooltip (src/ui/uInput.h) is a tConfItemBase holding an
//   activations-left count per player; uBindPlayer::DoActivate decrements it
//   only when ePlayer::Act returned true; uActionTooltip::WriteVal writes it
//   into user.cfg. So a counter that has gone from the shipped 2 down to 0 says
//   a real key press reached keymap[], resolved to CYCLE_TURN_LEFT for player 1,
//   and was accepted and executed by the player's cycle object. With no bind on
//   the arrow's keysym there is no activation, no decrement, and the counter is
//   still 2. THAT is the keycode round trip, end to end.
//
//   STATED PRECISELY, BECAUSE THE OBVIOUS PHRASING IS WRONG. A decrement does
//   NOT prove the cycle was ALIVE, and this file used to say it did. gCycle::Act
//   has no aliveness guard on its turn arms: its only Alive() reference is
//   `if (!Alive() && sn_GetNetState()==nSERVER) RequestSync(false);`, which is
//   server-only and does not return, and the very next statement turns and
//   returns true. The cycle object also outlives the death -- gCycle::Kill opens
//   with "keep this cycle alive" and never clears ePlayerNetID::object -- so a
//   press landing after the player died still counts. What IS established, and
//   it is what A3 was commissioned for:
//     * the press was delivered and resolved through keymap[] to the right
//       action for the right player;
//     * it was not the camera that took it -- eCamera::Act sends the two turn
//       actions to its trailing `else return false;`, so the `ret` that
//       DoActivate tests can only have come from the object arm of ePlayer::Act;
//     * the player HAD a cycle object, a round was running (se_GameTime()>=0),
//       and gCycle::Act cleared its premature-input guard and called Turn().
//   A press during the countdown returns false at that guard, so a mistimed run
//   FAILS M12 rather than passing it weakly.
//
//   M16 is A2 in its strongest form. Everything else about "first use was
//   skipped" is read out of a file, and a file can say FIRST_USE 0 to a program
//   that ignored it. M16 reads a file that BOOT 3 ITSELF WROTE, from boot 3's
//   own memory, and finds the tooltip counters still spent.
//
//   WHAT MAKES IT AIRTIGHT IS THE LOAD ORDER, not merely the fact that
//   config/default.cfg carries the unspent "0 2 1 1 1". st_LoadConfig
//   (src/tools/tConfiguration.cpp) loads var/user.cfg FIRST and only then
//   reaches `if (st_FirstUse) Load( config, "default.cfg" )`. So a boot that had
//   re-run first use would have default.cfg OVERWRITE the spent values it had
//   just read -- 2 in memory, and 2 in the file its own save then wrote. The
//   check cannot be satisfied by a first-use boot that happened to leave the
//   bytes alone.
//
//   (default.cfg is not the ONLY source of a "2": uActionTooltip's constructor
//   takes a numHelp argument. It is inert here -- the body assigns 0 to every
//   slot, with `numHelp` commented out beside it -- but "the only source" is the
//   kind of sentence this milestone keeps having to correct, so it is not made.)
//
// WHAT IS NOT CLAIMED, AND IT MATTERS
// ---------------------------------------------------------------------------
// This gate does NOT separate the menu-leave save from the beforeunload
// backstop, and no check here may be read as doing so. FIRST_USE 0 in
// particular reaches the file through the backstop: gArmagetron.cpp flips
// st_FirstUse after sg_StartupPlayerMenu returns and the next thing that runs
// is a uMenu::Message, which fires no uCallbackMenuLeave. That separation is
// docs/evidence/m4-persist-settings/'s job, and it does it with a control
// BUILD, which is stronger than anything this file could do. This gate is
// about the milestone's outcome, and both mechanisms are part of that outcome.
//
// Nor does it say anything about a SECOND player's bindings, about menus other
// than the ones walked, or about what happens when IndexedDB is full.
//
// HOW EACH CHECK IS SHOWN TO BE ABLE TO FAIL. An assertion never seen to fail
// is not evidence. Two mechanisms cover the twenty-one:
//
//   * A REAL NEGATIVE CONTROL, committed beside this file.
//     web/tools/persistence-milestone-negative.steps is this same script with
//     one executable line changed: IndexedDB is destroyed between boot 2 and
//     boot 3. A real browser, the real page, no persistence.
//   * TRANSCRIPT MUTATION, prove-milestone-checks-can-fail.mjs, for the
//     eighteen checks the control cannot reach and for the three it does --
//     a control that flips three checks at once does not show that any ONE of
//     them is wired to the field it names.
//
// Every one of M1..M21 is covered by the prover; it prints which, and which of
// those ALSO have the control behind them.
//
// MZ IS NOT A TRANSCRIPT CHECK. It compares the ids that produced a verdict
// against the declared list, so a check that VANISHES in a future edit reads as
// what it is rather than as a pass. As this file stands all twenty-one check()
// calls are unconditional top-level statements, so MZ cannot fail on any input.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: check-milestone-transcript.mjs <console.log>');
  process.exit(2);
}
const lines = readFileSync(path, 'utf8').split('\n');

// The values web/tools/persistence-milestone-gate.steps produces. Spelled here
// as constants so a change to that file which this one has not followed fails
// loudly instead of quietly matching nothing.
const CANVAS_W = 1024, CANVAS_H = 768;   // web/shell.html's <canvas> attributes
const CHOSEN_W = 320,  CHOSEN_H = 200;   // the row the twenty Lefts clamp onto
const CHOSEN_ROW = '14';                 // ...which is ArmageTron_Custom; see
                                         // the steps file for why it is not 1
const LEFT_KEYSYM = '1104';              // SDLK_LEFT as this build's SDL spells it
const RIGHT_KEYSYM = '1103';             // SDLK_RIGHT
const TIP_LEFT_FRESH  = '0 2 1 1 1';     // config/default.cfg's shipped values
const TIP_RIGHT_FRESH = '0 3 1 1 1';
const TIP_SPENT       = '0 0 1 1 1';
const KEYS_NO_TEMPLATE = 59;             // default.cfg's KEYBOARD lines alone
// ...plus keys_cursor.cfg's 21, less the ONE keysym the two files share: 102
// ('f') is TOGGLE_FULLSCREEN in default.cfg and CYCLE_TURN_RIGHT for player 2
// in keys_cursor.cfg, so it is rebound rather than added. 59 + 21 - 1 = 79.
const KEYS_WITH_TEMPLATE = 79;

// Lines the harness itself wrote are never page output. Excluding them is not
// tidiness: an `eval:` step is echoed in full, and the gate's probe installer
// contains the literal string "[MILE] ". Counting those would let the script
// satisfy its own assertions.
const isHarness = (l) => l.includes('] [harness] ');

// ---------------------------------------------------------------- partitions
const controlAt = lines.findIndex((l) => l.includes('positive-control-deliberate'));
const runEnd = controlAt < 0 ? lines.length : controlAt;
const markAt = (name) => lines.findIndex((l, i) => i < runEnd && l.includes(`=== ${name} ===`));

const reload1At = markAt('RELOAD-1-REQUESTED');
const reload2At = markAt('RELOAD-2-REQUESTED');
const chooseAt = markAt('THE-PLAYER-PICKS-320x200');
const escScreenModeAt = markAt('ESCAPE-LEAVES-SCREEN-MODE');
const startGameAt = markAt('START-NEW-GAME');
const escSubmenuAt = markAt('ESCAPE-LEAVES-PLAY-GAME-SUBMENU');
const boot3SavedAt = markAt('BOOT-3-SAVED-FROM-MEMORY');

const inRun = (i) => i >= 0 && i < runEnd;

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
const newRounds = tagged('[L] NEW_ROUND');
const dumps = taggedJson('[MILE] ');
const wipes = tagged('[MILEWIPE] ');

// Phase names are written by the page into each payload, so no check ever has
// to infer which boot a line belongs to by counting.
const P = Object.fromEntries(dumps.map(([i, o]) => [o.phase, { i, o }]));

const EXPECTED_PHASES = [
  'boot1-before-play', 'boot1-after-first-setup',
  'boot2-before-play', 'boot2-after-boot', 'boot2-chosen-menu-still-open',
  'boot2-after-menu-leave', 'boot2-after-steering',
  'boot3-before-play', 'boot3-after-boot', 'boot3-after-save',
];
const BOOT2_PHASES = EXPECTED_PHASES.filter((p) => p.startsWith('boot2-'));

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
console.log(`lines: ${lines.length}   run region: 0..${runEnd}`);
console.log(`reload marks at lines ${reload1At} and ${reload2At}`);

// ----------------------------------------- provenance, BEFORE the verdicts
//
// Printed before the checks and not after them, because the transcript that
// needs this most is the one that ends in a screen of red -- a note underneath
// those has already scrolled past. Two things a reader has to know first:
//
//   * WHICH PAGE. Every transcript in this directory navigates to
//     armagetronad.html, because unlike M4 tasks 2 and 3 this gate needs no
//     control BUILD -- its control is a wipe of IndexedDB, which is a change to
//     the script and not to the client. If a page other than armagetronad.html
//     ever appears here, nothing below is a statement about the shipped client.
//   * WHICH SCRIPT. The negative control is the same script with the wipe in
//     it, and it is SUPPOSED to fail. It announces itself with a [MILEWIPE]
//     line, which is quoted below, so a wall of red from it is never mistaken
//     for a regression in the product.
const nav = lines.find((l) => l.includes('[harness] navigating to '));
const url = nav ? nav.slice(nav.indexOf('navigating to ') + 'navigating to '.length).trim() : null;
const page = url ? url.split('/').pop() : null;
console.log(`page: ${page || '(no "[harness] navigating to" line -- page unidentifiable)'}`);
console.log('');

if (page && page !== 'armagetronad.html') {
  console.log(`NOTE  this transcript is NOT the product page: it navigated to ${page}.`);
  console.log('      No control page in this milestone belongs to THIS gate -- the ones in');
  console.log('      web/dist-m1 belong to M4 tasks 1-3. Whatever this is, a verdict below is');
  console.log('      not a statement about the shipped client.');
  console.log('');
} else if (!page) {
  console.log('NOTE  the page under test cannot be identified from this transcript, so it may');
  console.log('      or may not be the product page. Treat any verdict below as unattributed.');
  console.log('');
}

if (wipes.length > 0) {
  console.log('NOTE  THIS IS THE NEGATIVE CONTROL, not the gate. The transcript contains');
  console.log(`      [MILEWIPE] ${wipes[0][1]}`);
  console.log('      i.e. web/tools/persistence-milestone-negative.steps destroyed the');
  console.log('      IndexedDB database between boot 2 and boot 3. It is SUPPOSED to fail, and');
  console.log('      a run of it that PASSED would mean the wipe did not work -- check the');
  console.log('      "delete" field above for BLOCKED before reading anything else.');
  console.log('');
}

// The gate always emits [MILE] payloads. Keying on their absence rather than on
// the presence of some other tag also catches a gate run that died before its
// first probe, which is the other way this tool can be handed something it
// cannot score.
if (dumps.length === 0) {
  const other = ['[SETFS] ', '[PERSISTFS] ', '[MAXFPS] '].find((t) => tagged(t).length > 0);
  console.log('NOTE  no [MILE] payload anywhere in this transcript.');
  if (other) {
    console.log(`      It carries ${other.trim()} lines instead, so it is a run of a DIFFERENT`);
    console.log('      M4 gate (m4-persist, m4-persist-settings or m4-config-precedence). Score');
    console.log('      it with that directory\'s own checker. Every FAIL below is an artefact of');
    console.log('      scoring the wrong script.');
  } else {
    console.log('      This is either not a run of web/tools/persistence-milestone-gate.steps,');
    console.log('      or a run that failed before its first probe. Either way the verdicts');
    console.log('      below describe a missing transcript, not a failing client.');
  }
  console.log('');
}

// ---------------------------------------------------------------- structure
const okPopulates = populate.filter(([, s]) => s.startsWith('ok'));
check(reload1At >= 0 && reload2At >= 0 && okPopulates.length === 3
      && okPopulates[0][0] < reload1At
      && okPopulates[1][0] > reload1At && okPopulates[1][0] < reload2At
      && okPopulates[2][0] > reload2At, 'M1',
  'three real page loads, partitioned by the two reload marks'
  + ` (populates at ${okPopulates.map(([i]) => i).join(',')}, marks at ${reload1At}/${reload2At})`);

const missingPhases = EXPECTED_PHASES.filter((p) => !P[p]);
const dupPhases = EXPECTED_PHASES.filter((p) => dumps.filter(([, o]) => o.phase === p).length > 1);
check(missingPhases.length === 0 && dupPhases.length === 0, 'M2',
  `all ${EXPECTED_PHASES.length} [MILE] phases are present exactly once`
  + (missingPhases.length ? ` (missing: ${missingPhases.join(' ')})` : '')
  + (dupPhases.length ? ` (not exactly once: ${dupPhases.join(' ')})` : ''));

const pre = P['boot1-before-play'];
check(!!pre && pre.o.present === false, 'M3',
  'fresh browser profile: /persist/var/user.cfg does not exist before the game first runs'
  + (pre ? ` (present=${pre.o.present})` : ' (payload missing)'));

// -------------------------------------------- boot 1: the first-use baseline
//
// EVERYTHING LATER IS ATTRIBUTED AGAINST THESE TWO. M4 says the arrow keys are
// not bound yet at the end of boot 1's first setup, so their presence on boot 2
// is not something that was always there; M5 says the tooltip counters are at
// config/default.cfg's shipped values, so their being 0 later is a change this
// run caused rather than a state it started in.
const b1 = P['boot1-after-first-setup'];
check(!!b1 && b1.o.first_use === '1' && b1.o.n_keyboard === KEYS_NO_TEMPLATE
      && b1.o.left_binds.length === 0 && b1.o.right_binds.length === 0, 'M4',
  'boot 1 is a first-use boot, and at this point NO turn key is bound yet'
  + (b1 ? ` (FIRST_USE ${b1.o.first_use}, ${b1.o.n_keyboard} KEYBOARD lines,`
        + ` left ${JSON.stringify(b1.o.left_binds)}, right ${JSON.stringify(b1.o.right_binds)})` : ' (payload missing)'));

check(!!b1 && b1.o.tip_left === TIP_LEFT_FRESH && b1.o.tip_right === TIP_RIGHT_FRESH, 'M5',
  `the tooltip counters start at config/default.cfg's shipped values`
  + (b1 ? ` (left ${JSON.stringify(b1.o.tip_left)}, right ${JSON.stringify(b1.o.tip_right)})` : ' (payload missing)'));

// ------------------------------------------------- boot 2: A2, and A3's setup
const b2pre = P['boot2-before-play'];
check(!!b2pre && b2pre.o.present === true && b2pre.o.first_use === '0'
      && b2pre.i > reload1At && b2pre.i < reload2At, 'M6',
  'after a real reload, a page that has written nothing reads FIRST_USE 0 back'
  + (b2pre ? ` (FIRST_USE ${b2pre.o.first_use}, ${b2pre.o.bytes} bytes, line ${b2pre.i})` : ' (payload missing)'));

// THE KEYCODE ROUND TRIP. 1104 is SDLK_LEFT in the numbering Emscripten's SDL
// shim delivers; config/keys_cursor.cfg spells the same key 276, and
// su_TranslateSDL12Keysym re-encoded it on the way in. What is asserted here is
// that the RE-ENCODED value came back out of user.cfg -- which is the claim
// uInput.cpp makes in prose ("survives M4's user.cfg round trip") and which
// nothing else in this project tests.
check(!!b2pre && b2pre.o.left_binds.includes(LEFT_KEYSYM)
      && b2pre.o.right_binds.includes(RIGHT_KEYSYM)
      && b2pre.o.n_keyboard === KEYS_WITH_TEMPLATE, 'M7',
  `the keyboard template survived, in the SDL-2 encoding: ${LEFT_KEYSYM} turns left, ${RIGHT_KEYSYM} turns right`
  + (b2pre ? ` (left ${JSON.stringify(b2pre.o.left_binds)}, right ${JSON.stringify(b2pre.o.right_binds)},`
           + ` ${b2pre.o.n_keyboard} KEYBOARD lines, was ${KEYS_NO_TEMPLATE})` : ' (payload missing)'));

// A2 ON BEHAVIOUR RATHER THAN ON A FILE. The keys pressed between the main menu
// and here are Enter, Down, Enter. On a first-use boot that sequence is the
// language menu and then First Setup and reaches no game at all, so a round
// starting is a statement about which screen boot 2 came up on.
const roundsInBoot2 = newRounds.filter(([i]) => startGameAt >= 0 && i > startGameAt
                                            && (reload2At < 0 || i < reload2At));
check(startGameAt >= 0 && roundsInBoot2.length >= 1, 'M8',
  'the main-menu key sequence reached a real game: [L] NEW_ROUND after the START-NEW-GAME mark'
  + ` (saw ${roundsInBoot2.length}; mark at ${startGameAt})`);
for (const [i, s] of roundsInBoot2) note(`NEW_ROUND at line ${i}: ${s}`);

// ------------------------------------------------------ boot 2: A1's negative
// The screenshot at this moment shows "320 x 200" selected on screen. The file
// still holds the desktop row. So what boot 3 reads was written by the menu
// EXIT, and the canvas measured on boot 3 cannot be attributed to the
// keystrokes or to anything that happened before this line.
const chosen = P['boot2-chosen-menu-still-open'];
check(!!chosen && chosen.o.screenmode === '0'
      && chosen.o.screenmode_w === '0' && chosen.o.screenmode_h === '0', 'M9',
  'with the choice made and the menu still open, the FILE still holds the old row -- the edit is memory-only'
  + (chosen ? ` (ARMAGETRON_SCREENMODE ${chosen.o.screenmode}, ${chosen.o.screenmode_w}x${chosen.o.screenmode_h})` : ' (payload missing)'));

const afterLeave = P['boot2-after-menu-leave'];
const leavesAtScreenMode = menuLeaveSaves.filter(([i]) => escScreenModeAt >= 0 && afterLeave
                                                      && i > escScreenModeAt && i < afterLeave.i);
check(!!afterLeave && afterLeave.o.screenmode === CHOSEN_ROW
      && afterLeave.o.screenmode_w === String(CHOSEN_W)
      && afterLeave.o.screenmode_h === String(CHOSEN_H)
      && leavesAtScreenMode.length === 1, 'M10',
  `leaving Screen Mode wrote the player's choice: row ${CHOSEN_ROW} at ${CHOSEN_W}x${CHOSEN_H}`
  + (afterLeave ? ` (ARMAGETRON_SCREENMODE ${afterLeave.o.screenmode}, ${afterLeave.o.screenmode_w}x${afterLeave.o.screenmode_h},`
                + ` ${leavesAtScreenMode.length} menu-leave save between the marks)` : ' (payload missing)'));

// NOTHING PRESSED "APPLY CHANGES", so sr_ReinitDisplay never ran and boot 2's
// canvas never changed. Without this, boot 3's 320x200 could be read as a size
// boot 2 had already applied and boot 3 merely inherited -- it could not
// actually be, since a reload rebuilds the element from web/shell.html, but the
// measurement is cheap and the argument is then unnecessary.
const b2wrong = BOOT2_PHASES.filter((p) => !P[p] || P[p].o.canvas_w !== CANVAS_W || P[p].o.canvas_h !== CANVAS_H);
check(b2wrong.length === 0, 'M11',
  `boot 2 never resized the canvas: all ${BOOT2_PHASES.length} of its phases still read ${CANVAS_W}x${CANVAS_H}`
  + (b2wrong.length ? ` (not so at: ${b2wrong.join(' ')})` : ''));

// -------------------------------------------------------------- boot 2: A3
// THE STRONGEST CHECK IN THIS FILE FOR A3. The counters are decremented by
// uBindPlayer::DoActivate, and only when the press was taken by the player's
// CYCLE OBJECT in a running round -- see the precise statement in the header,
// including what this does NOT establish (that the cycle was alive). So it is
// not "a key was pressed": it is "the bind resolved and the cycle turned".
//
// TWO THINGS KEEP THE FORWARD DIRECTION HONEST, and only the first is in the
// transcript. (1) The only keys this script sends in game are the two arrows
// and Escape, and neither arrow is bound to anything else in this
// configuration. (2) uActionTooltip::Disable ALSO zeroes these counters, for
// every bound action at once and with no activation involved, and it is called
// from s_InputConfigGeneric -- i.e. on opening any input-configuration menu.
// Nothing on this gate's route goes near one. A future edit that walked through
// Player Setup's bindings screen would satisfy M12 and M16 with no steering at
// all, so that route must stay off the script.
const steered = P['boot2-after-steering'];
check(!!steered && steered.o.tip_left === TIP_SPENT && steered.o.tip_right === TIP_SPENT
      && !!b1 && b1.o.tip_left === TIP_LEFT_FRESH && b1.o.tip_right === TIP_RIGHT_FRESH, 'M12',
  'the arrow keys reached the cycle and turned it: both CYCLE_TURN tooltip counters spent to zero'
  + (steered ? ` (left ${JSON.stringify(b1 ? b1.o.tip_left : '?')} -> ${JSON.stringify(steered.o.tip_left)},`
             + ` right ${JSON.stringify(b1 ? b1.o.tip_right : '?')} -> ${JSON.stringify(steered.o.tip_right)})` : ' (payload missing)'));

// -------------------------------------------------------------- boot 3: A1
const b3pre = P['boot3-before-play'];
check(!!b3pre && b3pre.o.canvas_w === CANVAS_W && b3pre.o.canvas_h === CANVAS_H
      && b3pre.i > reload2At, 'M13',
  `boot 3 starts at web/shell.html's own ${CANVAS_W}x${CANVAS_H}, before main() has run`
  + (b3pre ? ` (${b3pre.o.canvas_w}x${b3pre.o.canvas_h}, line ${b3pre.i} > ${reload2At})` : ' (payload missing)'));

// THE MILESTONE'S CLAIM, in one line, measured on the DOM.
const b3post = P['boot3-after-boot'];
check(!!b3post && b3post.o.canvas_w === CHOSEN_W && b3post.o.canvas_h === CHOSEN_H, 'M14',
  `THE GAME CAME BACK AT THE RESOLUTION THE PLAYER PICKED: the canvas is ${CHOSEN_W}x${CHOSEN_H}`
  + (b3post ? ` (${b3post.o.canvas_w}x${b3post.o.canvas_h}, was ${CANVAS_W}x${CANVAS_H} moments earlier)` : ' (payload missing)'));

// -------------------------------------------------------------- boot 3: A2
const b3save = P['boot3-after-save'];
const leavesAtSubmenu = menuLeaveSaves.filter(([i]) => escSubmenuAt >= 0 && boot3SavedAt >= 0
                                                    && i > escSubmenuAt && i < boot3SavedAt);
check(escSubmenuAt >= 0 && boot3SavedAt >= 0 && leavesAtSubmenu.length === 1, 'M15',
  'boot 3 rewrote user.cfg from its own memory: exactly one menu-leave save between the two boot-3 marks'
  + ` (saw ${leavesAtSubmenu.length}; marks at ${escSubmenuAt}/${boot3SavedAt})`);

// AND WHAT IT WROTE STILL SAYS SPENT. config/default.cfg is the only source of
// the unspent "0 2 1 1 1", and st_LoadConfig loads it only under st_FirstUse.
// A boot that had re-run first use would have refilled these and saved them
// back. This is therefore a statement about boot 3's MEMORY, not about bytes
// that merely went untouched.
check(!!b3save && b3save.o.tip_left === TIP_SPENT && b3save.o.tip_right === TIP_SPENT, 'M16',
  'the file boot 3 wrote still has the counters spent, so config/default.cfg was NOT re-read'
  + ' -- the first-use path was skipped'
  + (b3save ? ` (left ${JSON.stringify(b3save.o.tip_left)}, right ${JSON.stringify(b3save.o.tip_right)})` : ' (payload missing)'));

check(!!b3save && b3save.o.left_binds.includes(LEFT_KEYSYM)
      && b3save.o.right_binds.includes(RIGHT_KEYSYM), 'M17',
  'the bindings are still there two reloads later'
  + (b3save ? ` (left ${JSON.stringify(b3save.o.left_binds)}, right ${JSON.stringify(b3save.o.right_binds)})` : ' (payload missing)'));

// ------------------------------------------------------------ run hygiene
const BAD = ['[EXCEPTION]', 'Stack overflow detected', 'SDL event queue full',
             'Aborted(', 'RuntimeError', 'MEMORY_GROWTH'];
const badLines = lines.map((l, i) => [i, l])
  .filter(([i, l]) => inRun(i) && !isHarness(l) && BAD.some((b) => l.includes(b)));
check(badLines.length === 0, 'M18',
  `no exception, abort, stack overflow or SDL queue overflow in the run (saw ${badLines.length})`);
for (const [i, l] of badLines.slice(0, 5)) note(`line ${i}: ${l.slice(0, 160)}`);

// The positive control: without it, M18's silence is not an observation.
const sawControl = lines.some((l, i) => controlAt >= 0 && i > controlAt
  && (l.includes('[EXCEPTION]') || l.includes('thisIsADeliberateUncaughtError')
      || l.includes('Failed to load: ')));
check(controlAt >= 0 && sawControl, 'M19',
  'the deliberate uncaught error at the end WAS seen, so M18 is an observation and not a silence'
  + ` (control mark at ${controlAt})`);

const timeouts = lines.map((l, i) => [i, l]).filter(([i, l]) => inRun(i) && l.includes('until TIMED OUT'));
check(timeouts.length === 0, 'M20',
  `every until: step was satisfied rather than timing out (saw ${timeouts.length} timeouts)`);
for (const [i, l] of timeouts) note(`line ${i}: ${l.slice(l.indexOf('[harness]'), l.indexOf('[harness]') + 140)}`);

// Scoped to the run region, like M18 and M20 -- the three are one set and an
// unexplained asymmetry between them is a bug waiting to be argued about. All
// three favicon probes (one per page load) are inside the run region and are
// excluded by name, so nothing real is lost.
const loadFails = lines.map((l, i) => [i, l])
  .filter(([i, l]) => inRun(i) && l.includes('Failed to load resource') && !l.includes('/favicon.ico'));
check(loadFails.length === 0, 'M21',
  `every failed resource load in the run is the browser's own /favicon.ico probe (other failures: ${loadFails.length})`);
for (const [i, l] of loadFails.slice(0, 5)) note(`line ${i}: ${l.slice(0, 160)}`);

// ---------------------------------------------------------------- self-guard
const DECLARED = Array.from({ length: 21 }, (_, n) => `M${n + 1}`);
const missing = DECLARED.filter((id) => !emitted.includes(id));
const extra = emitted.filter((id) => !DECLARED.includes(id));
check(missing.length === 0 && extra.length === 0, 'MZ',
  `all ${DECLARED.length} declared checks produced a verdict`
  + (missing.length ? ` (missing ${missing.join(' ')})` : '')
  + (extra.length ? ` (undeclared ${extra.join(' ')})` : ''));

console.log('');
console.log(failures === 0 ? `PASS  ${emitted.length}/${emitted.length} checks`
                           : `FAIL  ${failures} of ${emitted.length} checks failed`);
process.exit(failures === 0 ? 0 : 1);
