#!/usr/bin/env node
// node web/tools/perf/check-arm.mjs <console.log>
//
// Exit 0 only if this arm's console.log PROVES the condition it measured held.
// A [PERF] line alone is not proof: the first sweep had six of them from an
// empty arena and reported 6.4-8.2 ms flat in every arm. Each check below is
// one way that sweep, or a run since, produced a number that was not one.
//
//   keys      two key presses (Right, Left) dispatched after the first
//             NEW_ROUND. The plan makes them a global constraint; the rig's
//             own negative control (docs/evidence/m6-lag/task1-rig/
//             negative-no-keys) showed a match that ran the same WITHOUT them
//             -- rounds 2 and 3 of 60.9 s, the same draws/frame, the same
//             screenshot -- so this check proves the input was sent, not that
//             the human drove. README.md, "Drive", has the numbers.
//   throttle  the driver's own "[harness] CPU throttling rate Nx" line, BEFORE
//             the second NEW_ROUND, at the rate the [PERF] line claims.
//   rounds    rounds 2 and 3 exist and each ran >= 30 s. (Round 1 is setup.)
//   frames    >= 30 frames in each late window; fewer means the window
//             straddled a hang or the sampler was not armed.
//   geometry  draws/frame in the late window is above the no-geometry floor
//             by a quarter. Draw calls are the direct measure of wall geometry
//             pushed through the GL emulation; a scene with no arena has few.
//   shot      a screenshot taken in the second half of each measured round
//             exists on disk, so a reader can SEE the trails the draws count.
//
// THE FLOOR. Two figures, and the check uses the larger:
//   1. This round's own overlay-only frames. For the first half second of
//      game time after NEW_ROUND, gGame.cpp's GameLoop clears and swaps
//      without calling Render (the gtime <= -PREPARE_TIME + .5 branch):
//      HUD and centre text only, no arena. report.js finds them by their
//      draw count and reports them as pre_round.draws_per_frame. They are the
//      genuine no-geometry scene, measured in every run under that run's
//      own HUD.
//   2. EMPTY_ARENA_DRAWS_PER_FRAME, the constant below: the base run's
//      round-1 pre_round.draws_per_frame, 18.05 over 91 frames (docs/
//      evidence/m6-lag/task1-rig/base, 2026-09-03, unthrottled; rounds 2 and
//      3 of the same run read 16.18 and 11.06 -- the HUD text differs per
//      round). It is the fallback for a round whose overlay frames were not
//      found, and it pins the bar so a HUD that draws LESS one day does not
//      lower it. x1.25 = 22.6; a live late window draws about 114.
// What else a no-game scene draws was measured, not inferred
// (docs/evidence/m6-lag/task1-rig/no-game-scenes): a held boot has no GL
// context and no frames; the Language Settings menu draws exactly 6 calls
// per frame, the First Setup menu 13-14. All are below the floor, so the
// x1.25 margin rejects every no-game scene this rig has seen. What the
// margin does NOT reject is an AI-only round with an idle human: the
// negative control's late windows draw over a hundred calls per frame with
// no key pressed. That is what the key count and the screenshot are for.
// Earlier versions of this file used round 1's FIRST-SECOND mean (36.99),
// which mixed overlay frames with world frames and was not a bound on
// anything: throttled rounds 2 and 3 read 25-29 in their first second.
// Re-measure the constant if the HUD, the centre text or the spawn layout
// changes; it carries its provenance in the comment beside it.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY_ARENA_DRAWS_PER_FRAME = 18.05;   // docs/evidence/m6-lag/task1-rig/base (2026-09-03 20:39), rounds[0].pre_round.draws_per_frame over 91 overlay-only frames; see THE FLOOR above

const file = process.argv[2];
if (!file) { console.log('usage: node check-arm.mjs <console.log>'); process.exit(2); }
const dir = path.dirname(file);
const lines = fs.readFileSync(file, 'utf8').split('\n');
const stamp = (l) => { const m = /^\[\s*(\d+)ms\]/.exec(l); return m ? Number(m[1]) : null; };
const isHarness = (l) => l.includes('] [harness] ');
const problems = [];

// ---- the [PERF] result: the LAST eval whose returned string starts "[PERF] "
// The driver logs `[harness] eval <source> => "<JSON-quoted result>"`; the
// source itself contains "[PERF] " and arrow functions, so the result is taken
// from the quoted string that ends the line, never by searching for "[PERF]".
let d = null, perfNote = 'no [PERF] eval line at all (report never ran)';
for (const l of lines) {
  if (!l.includes('[harness] eval ') || !l.includes('[PERF] ')) continue;
  const m = / => ("(?:[^"\\]|\\.)*")\s*$/.exec(l);
  if (!m) { perfNote = 'the report eval returned nothing quotable (it threw?)'; continue; }
  let s; try { s = JSON.parse(m[1]); } catch { perfNote = 'the report eval result is not a JSON string'; continue; }
  if (typeof s !== 'string' || !s.startsWith('[PERF] ')) { perfNote = `the report eval returned: ${String(s).slice(0, 160)}`; continue; }
  try { d = JSON.parse(s.slice(s.indexOf('{'))); } catch (e) { perfNote = `[PERF] JSON does not parse: ${e.message}`; d = null; }
}
if (!d) { console.log(`INVALID: ${perfNote}`); process.exit(1); }

// ---- keys
const keys = lines.filter((l) => /\[harness\] key (Right|Left) /.test(l)).length;
if (keys < 2) problems.push(`only ${keys} tutorial key presses logged (need Right and Left)`);

// ---- game events on the driver's clock (harness echoes excluded: an until:
// step quotes the string it waits for)
const game = (needle) => lines.map((l, i) => [l, i]).filter(([l]) => !isHarness(l) && l.includes(needle));
const nr = game('[L] NEW_ROUND'), rw = game('[L] ROUND_WINNER');

// ---- throttle: switched on, at the claimed rate, before round 2 began
const thr = lines.map((l, i) => [/\[harness\] CPU throttling rate ([\d.]+)x/.exec(l), i]).filter(([m]) => m);
if (!(d.cpu_rate >= 1)) problems.push('no cpu_rate in the [PERF] line');
if (!thr.length) problems.push('the driver never logged "CPU throttling rate" (cpu: step missing)');
else {
  const [m, i] = thr[thr.length - 1];
  if (Number(m[1]) !== Number(d.cpu_rate)) problems.push(`throttle logged at ${m[1]}x but [PERF] claims ${d.cpu_rate}`);
  if (nr.length >= 2 && i > nr[1][1]) problems.push('throttle was switched on AFTER round 2 started');
}

// ---- measured rounds
// The measured span is NEW_ROUND's first world frame to the human's death
// (measured_to_s; report.js), or the whole round for a [PERF] line from before
// that field existed. Thirty seconds of it is the minimum for an early-vs-late
// comparison to mean anything.
const spanOf = (r) => (r.measured_to_s != null ? r.measured_to_s : r.length_s);
const measured = d.rounds.filter((r) => r.round >= 2 && spanOf(r) >= 30);
if (measured.length < 2) problems.push(`${measured.length} measured round(s) with a span >= 30 s (need rounds 2 and 3)`);
const lateShots = [];
for (const r of measured) {
  if (!(r.late_5s.frames >= 30)) problems.push(`round ${r.round}: ${r.late_5s.frames} frames in the late window`);
  // The floor is the larger of the calibrated constant and this round's OWN
  // overlay-only frames (pre_round.draws_per_frame), so a HUD that grows
  // moves the bar with it.
  const own = (r.pre_round && r.pre_round.draws_per_frame) || 0;
  const floor = Math.max(EMPTY_ARENA_DRAWS_PER_FRAME, own);
  if (!(r.late_5s.draws_per_frame > floor * 1.25))
    problems.push(`round ${r.round}: ${r.late_5s.draws_per_frame} draws/frame late is not above the no-geometry floor (${floor}) by a quarter`);
  // a screenshot in the second half of this round, present on disk
  const a = nr[r.round - 1], b = rw[r.round - 1];
  if (!a || !b) { problems.push(`round ${r.round}: cannot locate NEW_ROUND/ROUND_WINNER in the transcript`); continue; }
  const t0 = stamp(a[0]), t1 = stamp(b[0]);
  const shots = lines.slice(a[1], b[1]).map((l) => /\[harness\] screenshot -> (.*\.png)\s*$/.exec(l)).filter(Boolean)
    .map((m) => m[1]).filter((f) => { const i = lines.findIndex((l) => l.endsWith(f)); return stamp(lines[i]) >= t0 + (t1 - t0) / 2; });
  const present = shots.filter((f) => fs.existsSync(path.join(dir, path.basename(f))));
  if (!present.length) problems.push(`round ${r.round}: no screenshot from its second half on disk`);
  else lateShots.push(present.map((f) => path.basename(f, '.png')).join(','));
}

if (problems.length) { console.log('INVALID: ' + problems.join('; ')); process.exit(1); }
const swaps = d.swaps ? `; swaps finish ${d.swaps.finish} / flush ${d.swaps.flush}` : '';
console.log(`VALID: ${measured.length} rounds at cpu ${d.cpu_rate}x; late ms p50 ${measured.map((r) => r.late_5s.ms_p50).join('/')}; `
  + `late draws/frame ${measured.map((r) => r.late_5s.draws_per_frame).join('/')} (floor ${EMPTY_ARENA_DRAWS_PER_FRAME}); `
  + `spans ${measured.map((r) => `${r.measured_from_s != null ? r.measured_from_s : 0}-${spanOf(r)} s`).join('/')}; `
  + `late shots ${lateShots.join(' / ')}${swaps}`);
