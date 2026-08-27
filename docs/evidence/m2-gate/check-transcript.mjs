#!/usr/bin/env node
// Re-check an M2 gate transcript without trusting the report that quotes it.
//
//   node docs/evidence/m2-gate/check-transcript.mjs docs/evidence/m2-gate/chrome-console.log
//   node docs/evidence/m2-gate/check-transcript.mjs docs/evidence/m2-gate/firefox-console.log
//
// Everything it prints is derived from the transcript file alone. It exists
// because two of this milestone's earlier claims were arithmetic mistakes over
// a log that was sitting right there -- "seven rounds" counted from seven
// NEW_ROUND lines when six had finished, and "three AIs" inferred from three
// names appearing across six rounds. Both were checkable; neither was checked.
//
// THE TRANSCRIPT HAS TWO HALVES, split at the harness mark
// "positive-control-deliberate-...". Before it is the run, and the run must be
// clean. After it are deliberate faults, and those must SHOW UP -- a
// transcript that stays silent when the page is made to misbehave is not
// evidence of anything, which is precisely how M1's Firefox transcript was
// misread (docs/porting/browser-runtime-notes.md section 9).
//
// WHAT IT CHECKS
//
// 1. ROUNDS COMPLETED = the number of "[L] ROUND_WINNER" lines. Rounds STARTED
//    is counted separately and both are printed, because they are different
//    numbers and the gate is about the second one.
//
// 2. THE OPPONENT COUNT, by replaying team membership rather than collecting
//    names. eTeam's ladder-log writers (src/engine/eTeam.cpp:220-224, all
//    enabled by default) report every membership change:
//      TEAM_CREATED <team> / TEAM_DESTROYED <team>
//      TEAM_PLAYER_ADDED <team> <player> / TEAM_PLAYER_REMOVED <team> <player>
//    Replaying those gives the roster of every team at every instant, so the
//    AI-team size during each round is a fact rather than an inference.
//    This matters: only the DELTA is logged, so a round that begins with three
//    AIs already in place logs no TEAM_PLAYER_ADDED at all, and counting
//    "added" lines per round would report that round as having zero opponents.
//
//    Cross-checked against a second, independent signal in the same file:
//    ROUND_WINNER lists the winning team's full membership
//    (gGame.cpp:3944-3946 -> eTeam::WritePlayers, eTeam.cpp:889), so when the
//    AI team wins, that line is its own census of the AI roster at round end.
//
// 3. THE HAZARDS the gate forbids, over the run only, plus the 404 rule: every
//    404 in a passing transcript must be /favicon.ico (the browser asks for it
//    once per navigation and python3 -m http.server has none).
//
// 4. GL ERRORS read back from the game's own context by the sampler in
//    web/tools/gameplay-gate.steps. This is the cross-engine channel, and the
//    only one that works in Firefox.
//
// Exit status is 0 if every check passes and 1 otherwise, so it can be used as
// a gate rather than read as prose.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: check-transcript.mjs <console.log>'); process.exit(2); }
const lines = readFileSync(path, 'utf8').split('\n');

const splitAt = lines.findIndex((l) => l.includes('positive-control-deliberate'));
const runLines = splitAt < 0 ? lines : lines.slice(0, splitAt);
const controlLines = splitAt < 0 ? [] : lines.slice(splitAt);

// Lines the harness itself wrote are never game output. Excluding them stops an
// `eval:` result or a `mark:` that quotes a ladder-log string from being
// counted as one -- the same reason the drivers' `until:` excludes them.
const isHarness = (l) => l.includes('] [harness] ');
const game = runLines.filter((l) => !isHarness(l));
const ladder = game
  .map((l) => { const i = l.indexOf('[L] '); return i < 0 ? null : l.slice(i + 4).trim(); })
  .filter(Boolean);

let failures = 0;
const check = (ok, text) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${text}`); };
const note  = (text) => console.log(`note  ${text}`);

console.log(`== ${path}`);
console.log(`   ${runLines.length} run lines, ${controlLines.length} positive-control lines`);
console.log('');

// ---------------------------------------------------------------- 1. rounds
const started = ladder.filter((l) => l.startsWith('NEW_ROUND')).length;
const won     = ladder.filter((l) => l.startsWith('ROUND_WINNER')).length;
const match   = ladder.filter((l) => l.startsWith('MATCH_WINNER')).length;
console.log(`rounds started   (NEW_ROUND):    ${started}`);
console.log(`rounds COMPLETED (ROUND_WINNER): ${won}`);
console.log(`matches finished (MATCH_WINNER): ${match}`);
check(won >= 3, `three rounds completed (${won} ROUND_WINNER lines)`);
// SP_LIMIT_ROUNDS 3 against a shipped default of 10: a match that ends at
// three rounds is the setting having been read.
check(match >= 1 && won === 3,
      `the match ended after exactly 3 rounds, i.e. SP_LIMIT_ROUNDS 3 was applied `
      + `(default is 10)`);

// ---------------------------------------------------- 2. team membership
// Replay the membership events; snapshot the ai_team roster at each
// ROUND_WINNER, which is the end of a round that has just been played with it.
const rounds = [];
{
  const t = new Map();
  for (const l of ladder) {
    const w = l.split(/\s+/);
    if      (w[0] === 'TEAM_CREATED')        t.set(w[1], new Set());
    else if (w[0] === 'TEAM_DESTROYED')      t.delete(w[1]);
    else if (w[0] === 'TEAM_PLAYER_ADDED')   { if (!t.has(w[1])) t.set(w[1], new Set()); t.get(w[1]).add(w[2]); }
    else if (w[0] === 'TEAM_PLAYER_REMOVED') t.get(w[1])?.delete(w[2]);
    else if (w[0] === 'ROUND_WINNER')
      rounds.push({ n: rounds.length + 1, roster: [...(t.get('ai_team') ?? [])], winner: w.slice(1) });
  }
}
console.log('');
for (const r of rounds) {
  const [team, ...players] = r.winner;
  console.log(`round ${r.n}: ai_team roster = ${r.roster.length} [${r.roster.join(', ')}]`
            + `   ROUND_WINNER = ${team} [${players.join(', ')}]`);
  check(r.roster.length === 3, `round ${r.n} was played against exactly 3 AIs`);
  if (team === 'ai_team')
    check(players.length === 3, `round ${r.n} ROUND_WINNER independently lists 3 AI players`);
  else
    note(`round ${r.n} was won by ${team}, so ROUND_WINNER is not a census of the AI team`);
}

// -------------------------------------------------------------- 3. hazards
console.log('');
for (const needle of ['Stack overflow', '[EXCEPTION]', 'SDL event queue full',
                      'Assertion', 'targetCrashed', 'renderer crashed', '[GLERR]']) {
  const hits = game.filter((l) => l.includes(needle));
  check(hits.length === 0, `no "${needle}" during the run (${hits.length} hits)`);
  for (const h of hits.slice(0, 3)) console.log(`        ${h.trim().slice(0, 160)}`);
}
const notFound    = game.filter((l) => /\b404\b/.test(l) && l.includes('[browser.'));
const badNotFound = notFound.filter((l) => !l.includes('/favicon.ico'));
check(badNotFound.length === 0,
      `every 404 is /favicon.ico (${notFound.length} total, ${badNotFound.length} other)`);
for (const h of badNotFound.slice(0, 5)) console.log(`        ${h.trim().slice(0, 160)}`);

// ------------------------------------------------------------ 4. GL errors
console.log('');
const tally = lines.find((l) => l.includes('glGetError_nonzero'));
if (!tally) {
  check(false, 'the sampler reported a glGetError tally');
} else {
  const m = /"glGetError_polls":(\d+),"glGetError_nonzero":(\d+)/.exec(tally.replace(/\\"/g, '"'));
  if (!m) check(false, `could not parse the glGetError tally: ${tally.slice(-160)}`);
  else {
    console.log(`glGetError: ${m[1]} polls, ${m[2]} non-zero`);
    check(Number(m[1]) > 0, 'the glGetError poll actually ran');
    check(Number(m[2]) === 0, 'the game produced no GL errors during the run');
  }
}

// ------------------------------------------------- 5. the positive controls
console.log('');
const ctlWebgl = controlLines.filter((l) => !isHarness(l) && /WebGL/i.test(l) && /hint/i.test(l));
if (ctlWebgl.length) {
  console.log('PASS  browser-level WebGL warnings ARE visible in this transcript');
  for (const h of ctlWebgl) console.log(`        ${h.trim().slice(0, 160)}`);
} else {
  // Not a failure: measured, Firefox 154 does not emit these over BiDi at all.
  // The glGetError check above is the substitute, and it is engine-independent.
  note('browser-level WebGL warnings are NOT visible in this transcript.');
  note('  This engine reports nothing for a deliberately invalid glHint, so the');
  note('  absence of WebGL warnings elsewhere in this file proves nothing on its');
  note('  own -- check 4 (glGetError) is what carries that claim here.');
}
const ctlThrow = controlLines.filter((l) => l.includes('[EXCEPTION]'));
check(ctlThrow.length > 0,
      'browser-reported uncaught JS errors ARE visible in this transcript '
      + '(so the "no [EXCEPTION]" result above is a real observation)');
for (const h of ctlThrow.slice(0, 2)) console.log(`        ${h.trim().slice(0, 160)}`);

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
