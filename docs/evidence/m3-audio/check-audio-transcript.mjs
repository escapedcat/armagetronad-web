#!/usr/bin/env node
// Re-check an M3 audio-gate transcript without trusting the report that quotes it.
//
//   node docs/evidence/m3-audio/check-audio-transcript.mjs docs/evidence/m3-audio/chrome-console.log
//   node docs/evidence/m3-audio/check-audio-transcript.mjs docs/evidence/m3-audio/firefox-console.log
//
// Exit status is 0 if every check passes and 1 otherwise, so it can be used as
// a gate rather than read as prose. Everything it prints is derived from the
// transcript file alone.
//
// THE CLAIM IT ARBITRATES, EXACTLY
// --------------------------------
// Non-zero, structured PCM reaches SDL.audio.pushAudio -- the last point at
// which the mix is bytes the game produced -- continuously, in every round of a
// real three-round match.
//
// It does NOT establish that those buffers were rendered to a device.
// pushAudio is UPSTREAM of the Web Audio graph; it is the function that builds
// an AudioBufferSourceNode and calls start() on it, and everything downstream
// of that is outside this instrument. It also does not establish that the mix
// is CORRECT: nobody has heard it. A gate that over-claims is worse than no
// gate, so neither of those sentences is negotiable when quoting this file.
//
// WHY IT PARSES A JSON PAYLOAD RATHER THAN COUNTING LOG LINES
// ----------------------------------------------------------
// eSound.cpp budgets its diagnostics: se_wavFailureBudget, se_wavSuccessBudget,
// se_wavRetireBudget, se_peakBudget and se_limiterBudget are 16 lines EACH and
// then the class falls silent for the rest of the run. A checker that measured
// anything by counting "[WAV]" lines could therefore pass because a line
// stopped printing. So the measurement itself is a single payload from an
// in-page probe that no budget can reach, and the log-line checks below are
// all of the form "must appear" or "must not appear at all" -- both of which
// fail safe, because the budget prints the FIRST 16 of a class, so a class with
// zero lines really did have zero events. Check A14 then fails outright if any
// class reaches 16, because past that point the log is a lower bound and
// nothing counted off it means what it says.
//
// THE TRANSCRIPT HAS TWO HALVES, split at the harness mark
// "positive-control-deliberate-...". Before it is the run, and the run must be
// clean. After it is a deliberate fault, which must SHOW UP -- a transcript
// that stays silent when the page is made to misbehave is not evidence of
// anything, which is how M1's Firefox transcript was misread
// (docs/porting/browser-runtime-notes.md section 9).
//
// EVERY CHECK IS ID'd (A1..A19) so that
// docs/evidence/m3-audio/prove-checks-can-fail.mjs can mutate a transcript,
// re-run this file, and demonstrate that each one individually flips to FAIL.
// An assertion never shown to fail is not evidence; that rule is M2's and it
// applies to its own checker too.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) { console.error('usage: check-audio-transcript.mjs <console.log>'); process.exit(2); }
const lines = readFileSync(path, 'utf8').split('\n');

const splitAt = lines.findIndex((l) => l.includes('positive-control-deliberate'));
const runLines = splitAt < 0 ? lines : lines.slice(0, splitAt);
const controlLines = splitAt < 0 ? [] : lines.slice(splitAt);

// Lines the harness itself wrote are never game output. Excluding them stops an
// `eval:` echo -- which contains the WHOLE probe expression, including the
// literal strings "[AUDIODUMP] " and "[L] " -- from being read as one.
const isHarness = (l) => l.includes('] [harness] ');
const game = runLines.filter((l) => !isHarness(l));
const ladder = game
  .map((l) => { const i = l.indexOf('[L] '); return i < 0 ? null : l.slice(i + 4).trim(); })
  .filter(Boolean);

let failures = 0;
const check = (ok, id, text) => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${text}`); };
const note  = (text) => console.log(`note      ${text}`);

// The driver stamps every line with its own wall clock as it receives it,
// entirely outside the page: "[   8237ms] [console.log] ...". That is a second
// instrument, and it is what the page-side performance.now() figures get
// checked against below.
const stamp = (l) => { const m = /^\s*\[\s*(\d+)ms\]/.exec(l); return m ? Number(m[1]) : null; };

console.log(`== ${path}`);
console.log(`   ${runLines.length} run lines, ${controlLines.length} positive-control lines`);
console.log('');

// ------------------------------------------------------- the probe's payload
// One console.log line, "[AUDIODUMP] {json}", written by the dump step in
// web/tools/audio-gate.steps. A console line rather than an `eval:` result
// because the two drivers record eval results differently (Chrome
// JSON.stringify()s the value, Firefox records it raw) and because an eval
// line also contains the entire expression that produced it.
const dumpLine = game.find((l) => l.includes('[AUDIODUMP] '));
let D = null;
if (dumpLine) {
  try { D = JSON.parse(dumpLine.slice(dumpLine.indexOf('[AUDIODUMP] ') + 12)); }
  catch (e) { console.log(`        [AUDIODUMP] line is not parseable JSON: ${e.message}`); }
}

// ------------------------------------------------- A1: the probe ran at all
if (!D) {
  check(false, 'A1', 'the transcript carries a parseable [AUDIODUMP] payload');
  console.log('');
  console.log('1 CHECK(S) FAILED — without the payload nothing else can be checked');
  process.exit(1);
}
console.log(`probe: installed at ${D.installed_at_ms}ms after ${D.install_polls} polls; `
          + `spec ${JSON.stringify(D.spec)}`);
check(D.probe_error === null, 'A1',
      `the probe wrapped SDL.audio.pushAudio and reported no error `
      + `(probe_error: ${JSON.stringify(D.probe_error)})`);

// ------------------------------------- A2: two instruments describe one device
// The C++ side prints the spec SDL_OpenAudio actually handed back
// (se_SoundInit's "[SND] device opened" line, which is deliberately unbudgeted
// because it runs once); the probe reads the same fields off SDL.audio from
// JavaScript. They are independent readings of one device, so requiring them to
// agree catches a probe that attached to something other than the live audio
// object -- which is the one way the whole payload below could be measuring
// nothing while looking healthy.
console.log('');
const devLines = game.filter((l) => l.includes('[SND] device opened:'));
const dev = devLines.length ? /(\d+) Hz, (\d+) ch, (\S+?), (\d+) frames\/callback.*SOUND_BUFFER_SHIFT (\d+)/
  .exec(devLines[0]) : null;
if (!dev) {
  check(false, 'A2', 'se_SoundInit printed a parseable "[SND] device opened" line');
} else {
  const [, hz, ch, depth, frames, shift] = dev;
  console.log(`device: C++ says ${hz} Hz, ${ch} ch, ${depth}, ${frames} frames/callback, `
            + `SOUND_BUFFER_SHIFT ${shift}; JS says ${D.spec.freq} Hz, ${D.spec.channels} ch, `
            + `${D.spec.bytesPerSample * 8}-bit, ${D.spec.samples} frames`);
  check(devLines.length === 1
        && Number(hz) === D.spec.freq
        && Number(ch) === D.spec.channels
        && Number(frames) === D.spec.samples
        && depth === '16-bit'
        && D.spec.bytesPerSample === 2,
        'A2',
        `the C++ device line and the JS probe describe the same 16-bit device `
        + `(${devLines.length} device line(s))`);
  note(`the AudioContext runs at ${D.spec.ctxSampleRate} Hz while the device is `
     + `${D.spec.freq} Hz, so Web Audio resamples every buffer. Nothing here depends on it.`);
}

// -------------------------------- A3: the window starts at a real user gesture
// This is the landmine M3 task 2 measured and the reason the gate is windowed
// at all. `click:#start` goes through Runtime.evaluate / script.evaluate, which
// is NOT a user gesture, so the AudioContext stays suspended after the device
// opens. In Firefox that produced a 6064 ms gap in pushAudio (8491 -> 14555 ms)
// with no starvation warning, because a suspended context's clock does not
// advance; Chrome instead emits "AudioContext was not allowed to start".
//
// So the window may only start at a keydown the BROWSER considers trusted --
// the same event Emscripten's autoResumeAudioContext() resumes on. The page
// watches for it (event.isTrusted) and reports its own performance.now(); this
// check confirms that instant is when the DRIVER pressed a key, using the
// driver's clock on both sides so no clock-origin offset enters the comparison.
console.log('');
const keyLine = game.find((l) => l.includes('[AUDIOPROBE] first TRUSTED keydown at '));
const keyStep = lines.find((l) => l.includes('] [harness] key '));
if (D.first_trusted_key_ms === null || !keyLine || !keyStep) {
  check(false, 'A3',
        `the page observed a trusted keydown and the driver recorded pressing a key `
        + `(dump ${D.first_trusted_key_ms}, probe line ${!!keyLine}, key step ${!!keyStep})`);
} else {
  const inLine = Number(/keydown at (\d+)ms/.exec(keyLine)?.[1]);
  const drift = Math.abs(stamp(keyLine) - stamp(keyStep));
  console.log(`window start: page saw a TRUSTED keydown at ${D.first_trusted_key_ms}ms (page clock); `
            + `the driver stamped that line ${stamp(keyLine)}ms and its own first key: step `
            + `${stamp(keyStep)}ms, drift ${drift}ms`);
  note(keyLine.trim().slice(keyLine.indexOf('[AUDIOPROBE]')));
  check(inLine === D.first_trusted_key_ms && drift <= 1000, 'A3',
        `the measurement window starts at a REAL user gesture: the dump's window start `
        + `is the trusted keydown the page saw (${inLine} == ${D.first_trusted_key_ms}), and that `
        + `is the driver's own key press to within ${drift}ms (bar: 1000ms)`);
}

// --------------------------- A4: the window is the match, on two clocks
console.log('');
const W = D.window;
const R = D.per_round ?? [];
if (!W || R.length < 3) {
  check(false, 'A4', `the payload carries a window and three per-round windows `
                   + `(window ${!!W}, rounds ${R.length})`);
} else {
  console.log(`window: ${W.from_ms}..${W.to_ms}ms = ${W.span_s}s, `
            + `covering rounds ${R[0].from_ms ?? '?'}..${R[R.length - 1].to_ms ?? '?'}`);
  check(W.span_s >= 20 && W.from_ms <= D.per_round[0].from_ms
        && W.to_ms >= D.per_round[R.length - 1].to_ms,
        'A4',
        `the window spans the whole match: ${W.span_s}s (bar: 20s), starting no later than `
        + `round 1 and ending no earlier than round ${R.length}`);
  // ...and the page-side clock those numbers come from, checked against the
  // driver's, which is recorded outside the page. Compared as a SPAN so the
  // difference in clock origins cancels; console delivery latency is then the
  // only term left, and it measures at about a millisecond.
  const stampsFor = (e) => game.filter((l) => l.includes(`[L] ${e}`)).map(stamp).filter((t) => t !== null);
  const nrAt = stampsFor('NEW_ROUND'), rwAt = stampsFor('ROUND_WINNER');
  const n = Math.min(nrAt.length, rwAt.length, R.length);
  if (n < 3) {
    check(false, 'A4b', `the transcript carries driver stamps for 3 round boundaries `
                      + `(${nrAt.length} NEW_ROUND, ${rwAt.length} ROUND_WINNER)`);
  } else {
    const pageSpan = (R[n - 1].to_ms - R[0].from_ms) / 1000;
    const wallSpan = (rwAt[n - 1] - nrAt[0]) / 1000;
    const drift = Math.abs(pageSpan - wallSpan);
    console.log(`rounds span: page clock ${pageSpan.toFixed(2)}s vs driver wall clock `
              + `${wallSpan.toFixed(2)}s, drift ${drift.toFixed(3)}s`);
    check(drift <= 0.5, 'A4b',
          `the page-side clock the windows are cut with agrees with the driver's independent `
          + `wall clock to ${drift.toFixed(3)}s (bar: 0.5s)`);
  }
}

// ------------------------------------------------- A5, A6: THE CLAIM ITSELF
console.log('');
if (W) {
  console.log(`PCM in the window: ${W.buffers_with_nonzero_pcm}/${W.calls_unpaused} unpaused `
            + `pushAudio calls carried a non-zero sample (${W.nonzero_fraction}), peak `
            + `${W.peak_abs_sample}/32768 = ${(100 * W.peak_abs_sample / 32768).toFixed(1)}% of `
            + `full scale; per-buffer peak p10/p50/p90 = ${W.maxabs.p10}/${W.maxabs.p50}/${W.maxabs.p90}`);
  // 0.5 and 1000 are deliberately far below both measured engines (0.86-0.9 and
  // 4500-5400) and far above the pipeline negative control, which reads exactly
  // 0 and 0. The bar is set to separate "sound" from "silence", not to pin down
  // a level nobody has judged.
  check(W.nonzero_fraction >= 0.5, 'A5',
        `most buffers carry sound: non-zero fraction ${W.nonzero_fraction} (bar: 0.5)`);
  check(W.peak_abs_sample >= 1000, 'A6',
        `the peak is well clear of dither: ${W.peak_abs_sample}/32768 (bar: 1000)`);
}

// ------------------------------------------------- A7: every round, not just one
// The overall figures would pass on a run where sound happened once and then
// stopped. Per-round windows are what make "continuously, through the match" a
// checked statement instead of a hopeful one.
console.log('');
for (const r of R) {
  console.log(`round ${r.round}: ${r.span_s}s, ${r.buffers_with_nonzero_pcm}/${r.calls_unpaused} `
            + `buffers non-zero (${r.nonzero_fraction}), peak ${r.peak_abs_sample}, `
            + `worst push gap ${r.push_gap_max_ms}ms`);
}
// The per-round bar is higher than the overall one, not lower, and that is not
// a mistake: the window includes the menus between the first key press and the
// first round, where silence is CORRECT and drags the overall fraction to
// ~0.83. Inside a round the engine sound loops continuously, and both engines
// measure a per-round fraction of exactly 1.000 -- every single buffer.
check(R.length >= 3
      && R.every((r) => r.nonzero_fraction >= 0.8 && r.peak_abs_sample >= 500),
      'A7',
      `EVERY round carried near-continuous non-zero PCM: fractions `
      + `${R.map((r) => r.nonzero_fraction).join(', ')} (bar: 0.8 each), peaks `
      + `${R.map((r) => r.peak_abs_sample).join(', ')} (bar: 500 each)`);

// ------------------------------------------------- A8: continuity, and the artifact
// The bar is 1000 ms: about six times the worst gap either engine has produced
// with the window applied (~165-190 ms), and about a sixth of the 6064 ms
// suspended-context gap the window exists to exclude. So it is loose enough not
// to flake on a scheduling hiccup and tight enough that removing the windowing
// makes it FAIL in Firefox -- which is the point, and is why whole_run's gap is
// printed next to it rather than dropped.
console.log('');
if (W) {
  console.log(`push gaps in the window: p50 ${W.push_gap_ms.p50}ms, p99 ${W.push_gap_ms.p99}ms, `
            + `max ${W.push_gap_ms.max}ms   |   over the WHOLE run, including the `
            + `pre-gesture region: max ${D.whole_run.push_gap_max_ms}ms`);
  note(`scheduling lead: p50 ${W.latency_ms.p50}ms, max ${W.latency_ms.max}ms. Emscripten keeps `
     + `bufferingDelay + queued x bufferDuration = `
     + `${Math.round(1000 * (D.spec.bufferingDelay + D.spec.queued * D.spec.bufferDurationSecs))}ms `
     + `of audio ahead of the clock, which is both the latency and the stall the device can survive.`);
  check(W.push_gap_ms.max !== null && W.push_gap_ms.max <= 1000, 'A8',
        `buffers arrive continuously through the match: worst gap between consecutive `
        + `unpaused pushAudio calls ${W.push_gap_ms.max}ms (bar: 1000ms)`);
  if (D.whole_run.push_gap_max_ms > 1000)
    note(`the UNWINDOWED worst gap is ${D.whole_run.push_gap_max_ms}ms. That is the suspended `
       + `AudioContext before the first trusted key press, not a defect, and it is exactly why `
       + `A8 is measured over the window. This same check applied to the whole run would fail here.`);
}

// ------------------------------- A9: handed to a RUNNING context, not a parked one
// Still not proof that anything was rendered -- see the header. But it removes
// the one alternative explanation the transcript can rule out: that the buffers
// were pushed into a context whose clock was not moving.
console.log('');
if (W) {
  const st = W.ctx_states ?? {};
  console.log(`AudioContext state at each in-window push: ${JSON.stringify(st)}`);
  check(Object.keys(st).length > 0 && Object.keys(st).every((k) => k === 'running'),
        'A9',
        `every buffer in the window was handed to a RUNNING AudioContext `
        + `(states seen: ${Object.keys(st).join(', ') || 'none'})`);
  note(`whole run, including before the gesture: ${JSON.stringify(D.whole_run.ctx_states)}`);
  if (D.pre_gesture)
    note(`BEFORE the gesture: ${D.pre_gesture.calls} calls, `
       + `${D.pre_gesture.buffers_with_nonzero_pcm} non-zero, peak `
       + `${D.pre_gesture.peak_abs_sample}, worst gap ${D.pre_gesture.push_gap_max_ms}ms, states `
       + `${JSON.stringify(D.pre_gesture.ctx_states)}. Reported, never asserted on: this region is `
       + `the harness's own synthetic click, not the game.`);
  if (W.calls_paused) note(`${W.calls_paused} in-window calls arrived with SDL.audio.paused set; `
                         + `pushAudio returns immediately on those, so they are excluded above.`);
}

// ------------------------------------------- A10, A11: what Emscripten itself says
// Emscripten's own ASSERTIONS-gated warning is the independent second opinion
// on continuity: pushAudio compares currentTime against nextPlayTime on every
// call and warns when the device ran dry. It arrives on console.error, so it is
// in the transcript, and it is not budgeted by anything of ours.
console.log('');
for (const [id, needle, what] of [
  ['A10', 'Audio callback had starved', 'the Web Audio queue never ran dry'],
  ['A11', 'Web Audio API error playing back audio', 'pushAudio never threw internally'],
]) {
  const hits = lines.filter((l) => !isHarness(l) && l.includes(needle));
  check(hits.length === 0, id, `${what} (no "${needle}", ${hits.length} hits)`);
  for (const h of hits.slice(0, 3)) console.log(`        ${h.trim().slice(0, 160)}`);
}

// --------------------------------- A12: the audio was measured during a real match
// Rounds COMPLETED, from ROUND_WINNER -- not NEW_ROUND, which counts rounds
// started. M2's checker is the reference; this one repeats the count only
// because every audio figure above is attributed to "a real three-round match"
// and that attribution has to be checked in the same file.
console.log('');
const started = ladder.filter((l) => l.startsWith('NEW_ROUND')).length;
const won     = ladder.filter((l) => l.startsWith('ROUND_WINNER')).length;
console.log(`rounds started ${started}, rounds COMPLETED ${won}, `
          + `payload says started ${D.rounds_started} / won ${D.rounds_won}`);
check(won >= 3 && D.rounds_won >= 3, 'A12',
      `three rounds completed, agreed by the transcript (${won}) and the payload (${D.rounds_won})`);

// ------------------------------------------- A13: the WAVs the mix is made of
// Presence checks, which are budget-safe: se_wavSuccessBudget prints the FIRST
// 16 successes, so the two shipped files appear if they were ever loaded, and
// se_wavFailureBudget prints the first 16 failures, so zero failure lines means
// zero failures rather than a spent allowance. A14 guards the case where either
// budget is actually spent.
console.log('');
const wavLoaded = game.filter((l) => l.includes('[WAV] loaded '));
const wavReject = game.filter((l) => l.includes('[WAV] rejected '));
const wavFailed = game.filter((l) => l.includes('[WAV] load failed'));
const haveRun = (f) => wavLoaded.some((l) => l.includes(f));
console.log(`[WAV] lines: ${wavLoaded.length} loaded, ${wavReject.length} rejected, `
          + `${wavFailed.length} load failed`);
for (const h of wavLoaded.slice(0, 2)) console.log(`        ${h.trim().slice(h.trim().indexOf('[WAV]'), 160)}`);
check(haveRun('sound/cyclrun.wav') && haveRun('sound/expl.wav')
      && wavReject.length === 0 && wavFailed.length === 0,
      'A13',
      `both shipped WAVs decoded and nothing failed to load `
      + `(cyclrun ${haveRun('sound/cyclrun.wav')}, expl ${haveRun('sound/expl.wav')}, `
      + `${wavReject.length} rejected, ${wavFailed.length} failed)`);

// ------------------------------------------- A14: the instrument is not saturated
// eSound.cpp gives each diagnostic class 16 lines and then falls silent for the
// rest of the run. Every count printed above is therefore only meaningful while
// its class is under that cap. This check is what stops a passing result from
// resting on a line that stopped printing.
console.log('');
{
  const BUDGET = 16;
  const classes = [
    ['[WAV] loaded ', 'se_wavSuccessBudget'],
    ['[WAV] rejected ', 'se_wavFailureBudget'],
    ['[WAV] load failed', 'se_wavFailureBudget'],
    ['[WAV] retiring a voice', 'se_wavRetireBudget'],
    ['[SND] live voices peaked', 'se_peakBudget'],
    ['[SND] voice limiter', 'se_limiterBudget'],
  ];
  // The two failure needles share one allowance, so they are summed against it.
  const count = (n) => game.filter((l) => l.includes(n)).length;
  const failureTotal = count('[WAV] rejected ') + count('[WAV] load failed');
  let saturated = [];
  for (const [needle, budget] of classes) {
    const n = budget === 'se_wavFailureBudget' ? failureTotal : count(needle);
    console.log(`  ${needle.padEnd(26)} ${String(count(needle)).padStart(3)} lines `
              + `(${budget}${budget === 'se_wavFailureBudget' ? `, shared total ${failureTotal}` : ''})`);
    if (n >= BUDGET && !saturated.includes(budget)) saturated.push(budget);
  }
  check(saturated.length === 0, 'A14',
        `no diagnostic budget is spent, so the [WAV]/[SND] counts above are complete `
        + `rather than a lower bound (${saturated.length ? 'SPENT: ' + saturated.join(', ') : 'all under 16'})`);
}

// ------------------------------------------------------------- A15-A17: hazards
console.log('');
{
  const HAZARDS = ['Stack overflow', '[EXCEPTION]', 'SDL event queue full',
                   'Assertion', 'targetCrashed', 'renderer crashed'];
  const hits = [];
  for (const needle of HAZARDS) for (const l of game) if (l.includes(needle)) hits.push([needle, l]);
  check(hits.length === 0, 'A15',
        `the run half of the transcript is free of crash/exception hazards `
        + `(${HAZARDS.map((h) => `"${h}"`).join(', ')}; ${hits.length} hits)`);
  for (const [n, h] of hits.slice(0, 5)) console.log(`        ${n}: ${h.trim().slice(0, 150)}`);
}

const notFound    = game.filter((l) => /\b404\b/.test(l) && l.includes('[browser.'));
const badNotFound = notFound.filter((l) => !l.includes('/favicon.ico'));
check(badNotFound.length === 0, 'A16',
      `every 404 is /favicon.ico (${notFound.length} total, ${badNotFound.length} other)`);
for (const h of badNotFound.slice(0, 5)) console.log(`        ${h.trim().slice(0, 160)}`);

// A driver records an expired `until:` and keeps going -- deliberately, so a
// partial run still produces its evidence. That makes this line the only thing
// separating "three rounds happened" from "I stopped waiting", and it is
// checked over the WHOLE file rather than the run half.
{
  const hits = lines.filter((l) => l.includes('until TIMED OUT'));
  check(hits.length === 0, 'A17', `no "until TIMED OUT" anywhere in the file (${hits.length} hits)`);
  for (const h of hits.slice(0, 5)) console.log(`        ${h.trim().slice(0, 160)}`);
}

// ------------------------------------------- A18: the classifier, on known input
// The same S.scan the probe calls per buffer, run over two hand-made arrays
// whose answers are fixed before the run starts. It proves the function that
// reported the non-zero counts answers 0 for silence -- and nothing else. It
// says nothing about the audio pipeline: a build whose mix never wrote a sample
// would print this line unchanged. The pipeline-level control is a separate
// run against a bundle with both WAVs made unloadable; see README.md.
console.log('');
const ctl = game.find((l) => l.includes('[AUDIOCONTROL] '));
const want = 'all-zero=>[0,0] three-non-zero=>[32767,3]';
if (ctl) console.log(`        ${ctl.trim().slice(ctl.trim().indexOf('[AUDIOCONTROL]'))}`);
check(!!ctl && ctl.includes(want), 'A18',
      `the probe's own classifier answers correctly on known input (expected "${want}")`);

// ----------------------------------------- A19: the transcript can show a fault
console.log('');
const ctlThrow = controlLines.filter((l) => l.includes('[EXCEPTION]'));
check(ctlThrow.length > 0, 'A19',
      'browser-reported uncaught JS errors ARE visible in this transcript, so A15\'s '
      + '"no [EXCEPTION]" is an observation rather than a silence');
for (const h of ctlThrow.slice(0, 2)) console.log(`        ${h.trim().slice(0, 160)}`);

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
console.log('Passing means: non-zero PCM reached SDL.audio.pushAudio. It does NOT mean the');
console.log('buffers were rendered to a device (pushAudio is upstream of the Web Audio graph),');
console.log('and it does NOT mean the mix is correct. Nobody has heard this.');
process.exit(failures === 0 ? 0 : 1);
