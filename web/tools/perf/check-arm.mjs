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
//
// --posttut -- THE POST-TUTORIAL MODE, and why it is a different proof.
//
// The checks above prove a measurement of the TUTORIAL match. They cannot tell
// that match apart from any other: welcome() (gArmagetron.cpp:269) starts it by
// itself on a first-use boot and forces speedFactor -2, autoNum 0,
// sizeFactor -= 2, wallsLength 400, rubber 5 and delayCycle 0.05 for its
// duration, and a transcript of it looks exactly like a transcript of a match
// started from the menu. `--posttut` is for web/tools/perf/posttut.steps.tmpl,
// which boots with FIRST_USE 0 so welcome() returns early, walks the main menu
// to Game > Start New Game, and measures the game a returning phone plays.
// docs/evidence/m6-lag/README.md section 5.1 and option B; the arm's own README
// is docs/evidence/m6-lag/task7-posttutorial/README.md.
//
// It keeps every check above -- the two key presses (kept for symmetry; on this
// path they are not tutorial keys and the template says so), the throttle, both
// measured rounds at >= 30 s, >= 30 frames per late window, the draws floor and
// a second-half screenshot per round -- and adds three:
//
//   walk      the harness's own key/tap lines BEFORE the first [L] NEW_ROUND
//             must contain a Down and an Enter (or tap) after it. The tutorial
//             template's pre-round input is three taps and no Down at all, so a
//             tutorial transcript fails this outright.
//   patched   the "autoexec.cfg patched:" eval result -- the driver's record of
//             the exact text appended to /data/webdefaults/autoexec.cfg -- must
//             contain FIRST_USE 0 and the three returning-visitor render
//             settings sr_LoadDefaultConfig would have persisted (SWAP_MODE 2,
//             FLOOR_DETAIL 3, TEXT_OUT 1; rScreen.cpp:1007, and the template
//             header has the symbol for each).
//   settings  the tutorial's forced settings must be ABSENT while a MEASURED
//             round is running. This is the one that needed a mechanism rather
//             than a grep, because nothing the game prints says it. The
//             template's window.__posttut(phase) probe calls
//             Module._aa_web_save_config() (eWebPersist.cpp:205, the
//             non-yielding export web/shell.html's unload backstop already
//             uses), which runs st_SaveConfig() and serialises every live
//             tConfItem to /persist/var/user.cfg, then reads that file back
//             through Module.FS and logs "[POSTTUT] {...}" with the live value
//             beside the value the patched autoexec asked for. SP_WALLS_LENGTH,
//             SP_SPEED_FACTOR and SP_SIZE_FACTOR are tConfItems on
//             singlePlayer.* (gGame.cpp:601, :583, :584) and sg_currentSettings
//             points at singlePlayer in a single-player game, so they ARE the
//             fields welcome() assigns. This check requires the probe taken
//             inside round 2 to report live == asked for all three. On the
//             tutorial path the same probe would read speed -2 against 0,
//             size (asked - 2) against asked, and walls 400 against -1: three
//             independent failures, and at least two of them survive even for
//             the walls400 arm, whose asked value happens to be the tutorial's.
//
// A gate that cannot fail is not a gate: run this mode over any Task 1-4
// console.log -- e.g. docs/evidence/m6-lag/task1-rig/base/console.log -- and it
// reports INVALID on the walk, the patch and the probe, because that run is the
// tutorial match. That is the falsification, and it is one command.
import fs from 'node:fs';
import path from 'node:path';

const EMPTY_ARENA_DRAWS_PER_FRAME = 18.05;   // docs/evidence/m6-lag/task1-rig/base (2026-09-03 20:39), rounds[0].pre_round.draws_per_frame over 91 overlay-only frames; see THE FLOOR above

const argv = process.argv.slice(2);
const posttut = argv.includes('--posttut');
const file = argv.filter((a) => !a.startsWith('--'))[0];
if (!file || argv.some((a) => a.startsWith('--') && a !== '--posttut')) {
  console.log('usage: node check-arm.mjs [--posttut] <console.log>');
  process.exit(2);
}
const MODE = posttut ? 'posttut' : 'default';
// Printed before any verdict, so a reader of a log that scrolled never has to
// guess which set of checks produced the line below it.
console.log(`check-arm.mjs: mode ${MODE} -- ${posttut
  ? 'the POST-TUTORIAL path (FIRST_USE 0, menu walk, live SP_ settings)'
  : 'the tutorial match (the default; it cannot tell that match from any other)'}`);
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
if (!d) { console.log(`INVALID [${MODE}]: ${perfNote}`); process.exit(1); }

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

// ---- the post-tutorial proof ------------------------------------------------
// Three additions, and each one fails on a tutorial transcript. See the header.
let probeNote = '';
if (posttut) {
  const firstRound = nr.length ? nr[0][1] : lines.length;

  // walk: the harness's own input that reached the menu. The tutorial template's
  // pre-round input is three tap:#tapzone lines and no Down at all; this path has
  // to steer a menu, so a Down with an Enter/tap on each side of it is required.
  //
  // THE WINDOW IS NOT "BEFORE THE FIRST NEW_ROUND", and that is measured, not
  // cautious. The driver records a key: step AFTER dispatching keyUp and sleeping
  // 30 ms, while the game acts on the keyDown -- so the Enter that starts the
  // match is recorded AFTER the [L] NEW_ROUND it caused. In the smoke run the gap
  // is 34 ms (NEW_ROUND at 23187 ms, "key Enter" at 23221 ms). The window
  // therefore ends at the template's ROUND-1-SETUP-NOT-MEASURED mark, which is
  // the first thing after the walk and comes before round 1's own two presses;
  // if that mark is absent it ends 2 s after the first NEW_ROUND. The Down itself
  // must still be strictly before the first NEW_ROUND.
  const setupMark = lines.findIndex((l) => l.includes('[harness] === ROUND-1-SETUP-NOT-MEASURED ==='));
  const nrStamp = nr.length ? stamp(nr[0][0]) : null;
  const walkEnd = setupMark >= 0 ? setupMark
    : (nrStamp == null ? lines.length : lines.findIndex((l, i) => i > firstRound && stamp(l) > nrStamp + 2000));
  const walk = lines.slice(0, walkEnd < 0 ? lines.length : walkEnd)
    .map((l, i) => [/\[harness\] (key (\w+)|tap )/.exec(l), i]).filter(([m]) => m)
    .map(([m, i]) => [m[2] || 'tap', i]);
  const down = walk.findIndex(([k, i]) => k === 'Down' && i < firstRound);
  const enterBefore = walk.slice(0, down < 0 ? 0 : down).filter(([k]) => k === 'Enter' || k === 'tap').length;
  const enterAfter = down < 0 ? 0 : walk.slice(down + 1).filter(([k]) => k === 'Enter' || k === 'tap').length;
  if (down < 0)
    problems.push(`no menu walk before the first NEW_ROUND: ${walk.length} harness input(s), none of them Down `
      + `(the tutorial path reaches its match with no Down at all)`);
  else if (!enterBefore || !enterAfter)
    problems.push(`the menu walk before the first NEW_ROUND is not Enter/Down/Enter `
      + `(${enterBefore} Enter-or-tap before the Down, ${enterAfter} after)`);

  // patched: what the arm actually appended to /data/webdefaults/autoexec.cfg,
  // as the driver recorded the patch step's own return value.
  const patch = lines.slice(0, firstRound).filter((l) => l.includes('] [harness] eval ')
    && l.includes(' => "autoexec.cfg patched: '));
  if (!patch.length) problems.push('no "autoexec.cfg patched:" eval before the first NEW_ROUND (the patch step did not run)');
  else {
    const p0 = patch[patch.length - 1];
    // The result is JSON-quoted twice, but these needles contain no backslash
    // or quote, so they survive both encodings literally.
    for (const need of ['FIRST_USE 0', 'SWAP_MODE 2', 'FLOOR_DETAIL 3', 'TEXT_OUT 1']) {
      if (!p0.includes(need)) problems.push(`the patched autoexec.cfg does not contain "${need}"`);
    }
  }

  // settings: the probe taken INSIDE measured round 2. live must equal asked
  // for the three fields welcome() forces; on the tutorial path it cannot.
  const probes = lines.map((l, i) => [l, i]).filter(([l]) => l.includes('[console.log] [POSTTUT] '))
    .map(([l, i]) => { try { return [JSON.parse(l.slice(l.indexOf('[POSTTUT] ') + 10)), i]; } catch { return null; } })
    .filter(Boolean);
  const r2at = nr.length >= 2 ? nr[1][1] : Infinity;
  const inRound2 = probes.filter(([p, i]) => i > r2at && String(p.phase || '').startsWith('round2'));
  if (!probes.length) problems.push('no [POSTTUT] probe line at all (window.__posttut never ran)');
  else if (!inRound2.length) problems.push(`no [POSTTUT] probe from inside measured round 2 (phases seen: ${probes.map(([p]) => p.phase).join(',')})`);
  else {
    const [p] = inRound2[inRound2.length - 1];
    if (p.save !== 'saved') problems.push(`the probe could not force a config save: ${p.save}`);
    const num = (x) => (x === null || x === undefined || x === '' ? NaN : Number(x));
    const TUTORIAL = { SP_SPEED_FACTOR: -2, SP_WALLS_LENGTH: 400 };
    for (const k of ['SP_WALLS_LENGTH', 'SP_SPEED_FACTOR', 'SP_SIZE_FACTOR']) {
      const live = num(p.live[k]), want = num(p.expect[k]);
      if (Number.isNaN(live) || Number.isNaN(want)) { problems.push(`${k}: probe read live=${p.live[k]} expected=${p.expect[k]}`); continue; }
      if (Math.abs(live - want) > 1e-6) {
        const why = (TUTORIAL[k] !== undefined && Math.abs(live - TUTORIAL[k]) < 1e-6)
          ? ` -- that is welcome()'s tutorial value; this is the TUTORIAL match, not the post-tutorial one`
          : (k === 'SP_SIZE_FACTOR' && Math.abs(live - (want - 2)) < 1e-6)
            ? ` -- exactly asked-minus-2, which is welcome()'s "sizeFactor -= 2"; this is the TUTORIAL match`
            : '';
        problems.push(`${k} is ${p.live[k]} in the running game but the config asked for ${p.expect[k]}${why}`);
      }
    }
    probeNote = `; live in round 2: SP_WALLS_LENGTH ${p.live.SP_WALLS_LENGTH}, SP_SPEED_FACTOR ${p.live.SP_SPEED_FACTOR}, `
      + `SP_SIZE_FACTOR ${p.live.SP_SIZE_FACTOR}, SP_NUM_AIS ${p.live.SP_NUM_AIS} (all as asked); `
      + `turn binds L${JSON.stringify(p.turn_left_bound)} R${JSON.stringify(p.turn_right_bound)}`;
  }
}

if (problems.length) { console.log(`INVALID [${MODE}]: ` + problems.join('; ')); process.exit(1); }
const swaps = d.swaps ? `; swaps finish ${d.swaps.finish} / flush ${d.swaps.flush}` : '';
console.log(`VALID [${MODE}]: ${measured.length} rounds at cpu ${d.cpu_rate}x; late ms p50 ${measured.map((r) => r.late_5s.ms_p50).join('/')}; `
  + `late draws/frame ${measured.map((r) => r.late_5s.draws_per_frame).join('/')} (floor ${EMPTY_ARENA_DRAWS_PER_FRAME}); `
  + `spans ${measured.map((r) => `${r.measured_from_s != null ? r.measured_from_s : 0}-${spanOf(r)} s`).join('/')}; `
  + `late shots ${lateShots.join(' / ')}${swaps}${probeNote}`);
