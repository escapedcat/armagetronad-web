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
// "STRUCTURED" IS ASSERTED, NOT JUST ASSERTED-ABOUT. Both halves of it:
// A7b requires every whole second inside every round to clear an amplitude
// floor, and A7c requires every whole second BEFORE round 1 to be exactly zero.
// A7c is the only check in this file that fails when there is too MUCH signal,
// and it is the only one that could see the regression M3 newly made possible
// -- task 2 turned fill_audio's memset runtime-conditional, and uninitialised
// heap played as S16 would satisfy every other assertion here more emphatically
// than the real mix does.
//
// EVERY CHECK IS ID'd (A1..A19, plus A4b/A5b/A7b/A7c/A11b, plus AZ) so that
// docs/evidence/m3-audio/prove-checks-can-fail.mjs can mutate a transcript,
// re-run this file, and demonstrate that each one individually flips to FAIL.
// An assertion never shown to fail is not evidence; that rule is M2's and it
// applies to its own checker too. One route, AE, is not covered by that tool
// and cannot be -- see the prover's header for why, and for the by-hand test.

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
// Every id that actually got a verdict. Several checks live inside `if (W)` or
// `if (dev)` guards, and a guard that is not taken makes a check VANISH from
// the output rather than fail -- which reads, to anyone scanning for the word
// FAIL, exactly like a check that passed. AZ at the bottom compares this list
// against the declared one, so a silently skipped check is itself a failure.
const emitted = [];
const check = (ok, id, text) => {
  emitted.push(id);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${text}`);
};
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
// All three clauses, because the label claims all three. `probe_error` alone is
// not enough: if the 50 ms poll never found SDL.audio, the wrapper was never
// installed, nothing ever threw, and `S.err` stays null -- so a payload from a
// probe that did nothing at all would satisfy a probe_error-only test. A2 would
// still catch it downstream, but a check whose sentence is wider than its test
// is how a gate ends up meaning less than it says.
check(D.probe_error === null && D.installed_at_ms !== null && D.spec !== null, 'A1',
      `the probe wrapped SDL.audio.pushAudio (installed at ${D.installed_at_ms}ms, `
      + `spec ${D.spec ? 'read' : 'MISSING'}) and reported no error `
      + `(probe_error: ${JSON.stringify(D.probe_error)})`);

// A malformed payload must produce FAIL lines rather than a stack trace: a
// checker that dies on the first missing field stops reporting the dozen checks
// after it, and the operator learns less than if it had printed nothing at all.
// Fix round 1 guarded `D.spec` at A2 and the crash simply MOVED to the next
// dereference (the A8 scheduling-lead note) -- the site was patched and the
// class was not. Aliasing to {} makes a missing field read as `undefined`,
// which formats as "undefined" and arithmetics to NaN: both honest, neither
// fatal.
//
// THE FILE USES TWO MECHANISMS, NOT ONE, AND THE COMMENT HERE USED TO CLAIM
// OTHERWISE. It said "every optional sub-object of the payload is read through
// one of these aliases", and the file does not do that -- a stated rule the
// code does not follow is exactly the defect class this milestone kept hitting,
// so it is corrected rather than quietly widened. What is actually true:
//
//   * aliased here, so a missing field degrades to undefined/NaN:
//     `D.spec` -> SP, `D.whole_run` -> WR, `D.pre_gesture` -> PG,
//     and `D.per_round` -> R (`?? []`, further down, next to W).
//   * NOT aliased, and relying on a guard instead: `D.spec` is also
//     dereferenced directly in A2 (`D.spec.freq` and friends), which is safe
//     only because A2 sits behind an explicit `if (!dev || !D.spec)`.
//   * NOT aliased and NOT guarded at the read: `D.window` -> W is a plain
//     assignment. A null `window` is handled by the `if (!W || ...)` at A4 and
//     by `if (W)` at the checks below, so it is safe in practice; anything it
//     misses lands in the top-level catch as `FAIL AE`, with AZ naming every
//     check that never ran.
//
// The backstop is what makes the difference between the three tolerable. It is
// not an accident that it is there, and it is load-bearing: a review's fuzz of
// 221 malformed transcripts produced zero raw stack traces and only exit codes
// 0 and 1.
const SP = D.spec ?? {};
const WR = D.whole_run ?? {};
const PG = D.pre_gesture ?? null;

try {

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
// D.spec is guarded alongside dev: without it every comparison below is a
// dereference of null, and the operator gets a stack trace where they should
// get a FAIL line. A checker that crashes still exits non-zero, but it stops
// telling you which claim broke, which is the only reason to run it.
if (!dev || !D.spec) {
  check(false, 'A2', `se_SoundInit printed a parseable "[SND] device opened" line `
                   + `(${devLines.length} found) and the probe read a device spec `
                   + `(${D.spec ? 'yes' : 'MISSING'})`);
} else {
  const [, hz, ch, depth, frames, shift] = dev;
  console.log(`device: C++ says ${hz} Hz, ${ch} ch, ${depth}, ${frames} frames/callback, `
            + `SOUND_BUFFER_SHIFT ${shift}; JS says ${SP.freq} Hz, ${SP.channels} ch, `
            + `${SP.bytesPerSample * 8}-bit, ${SP.samples} frames`);
  check(devLines.length === 1
        && Number(hz) === D.spec.freq
        && Number(ch) === D.spec.channels
        && Number(frames) === D.spec.samples
        && depth === '16-bit'
        && D.spec.bytesPerSample === 2,
        'A2',
        `the C++ device line and the JS probe describe the same 16-bit device `
        + `(${devLines.length} device line(s))`);
  note(`the AudioContext runs at ${SP.ctxSampleRate} Hz while the device is `
     + `${SP.freq} Hz, so Web Audio resamples every buffer. Nothing here depends on it.`);
}

// -------------------------------- A3: the window starts at a real user gesture
// This is the landmine M3 task 2 measured and the reason the gate is windowed
// at all. The old `click:#start` step went through Runtime.evaluate / script.evaluate, which
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

// -------------------------------------------- A5, A5b, A6: THE CLAIM ITSELF
console.log('');
if (W) {
  console.log(`PCM in the window: ${W.buffers_with_nonzero_pcm}/${W.calls_unpaused} unpaused `
            + `pushAudio calls carried a non-zero sample (${W.nonzero_fraction}), peak `
            + `${W.peak_abs_sample}/32768 = ${(100 * W.peak_abs_sample / 32768).toFixed(1)}% of `
            + `full scale; per-buffer peak p10/p50/p90 = ${W.maxabs.p10}/${W.maxabs.p50}/${W.maxabs.p90}`);
  // The unwindowed pair, printed rather than asserted on, because it is what a
  // reader comparing against M3 task 2's figures (1028/1193 Chrome,
  // 1022/1191 Firefox) actually wants: those were measured over the whole run,
  // these over the gesture-to-match-end window, and the two are not the same
  // span. Without both numbers side by side the comparison looks like a change.
  console.log(`  over the WHOLE run, for comparison with task 2's unwindowed figures: `
            + `${WR.buffers_with_nonzero_pcm}/${WR.calls_unpaused} non-zero, `
            + `peak ${WR.peak_abs_sample}`);
  // 0.5 and 1000 are deliberately far below both measured engines (0.835-0.838
  // and 5145-5467) and far above the pipeline negative control, which reads
  // exactly 0 and 0. The bar separates "sound" from "silence"; it does not pin
  // down a level, because nobody has judged the level.
  check(W.nonzero_fraction >= 0.5, 'A5',
        `most buffers carry sound: non-zero fraction ${W.nonzero_fraction} (bar: 0.5)`);
  // A5 and A6 together are still satisfiable by dither plus one loud buffer:
  // A5 counts buffers containing ANY non-zero sample, and A6 reads the single
  // loudest sample in the window. Neither says anything about the TYPICAL
  // buffer. The median per-buffer peak does, and it is the cheapest statistic
  // that a stream of ones cannot fake -- 967 (Chrome) and 990 (Firefox) here,
  // 0 in the negative control.
  check(W.maxabs.p50 !== null && W.maxabs.p50 >= 300, 'A5b',
        `the TYPICAL buffer carries real amplitude, not dither: median per-buffer peak `
        + `${W.maxabs.p50} (bar: 300)`);
  check(W.peak_abs_sample >= 1000, 'A6',
        `the loudest buffer is well clear of dither: ${W.peak_abs_sample}/32768 (bar: 1000)`);
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
// ~0.83. Inside a round the engine sound loops continuously.
//
// THE BAR IS EXACTLY 1, NOT 0.8, AND THAT IS A DELIBERATE TIGHTENING. "Every
// buffer of every round" is the strongest sentence this milestone makes, and at
// 0.8 it was a READING of a number rather than a checked claim -- a regression
// to 0.85 would have passed this check while the README went on printing the
// sentence. Measured 1.000 in every per-round window of every run ever taken on
// this build: two gate runs here, two more at M3 exit, both engines each time.
//
// If this ever fails, the right response is to find out WHY a round contained a
// callback with no live voice -- not to lower the bar back to 0.8. A single
// short buffer is a real change in behaviour and worth stopping on; if it turns
// out to be legitimate, the sentence in the README has to change with the bar,
// because the two are now the same statement. The peaks are reported alongside
// so a near-miss (0.995) is legible as a near-miss rather than as a collapse.
check(R.length >= 3
      && R.every((r) => r.nonzero_fraction === 1 && r.peak_abs_sample >= 500),
      'A7',
      `EVERY round carried non-zero PCM in EVERY buffer: fractions `
      + `${R.map((r) => r.nonzero_fraction).join(', ')} (bar: exactly 1 each), peaks `
      + `${R.map((r) => r.peak_abs_sample).join(', ')} (bar: 500 each)`);

// A7 has the same blind spot A5/A6 had, one level down: a round of dither with
// one loud buffer in it satisfies both a fraction of 1.0 and a peak of 4000.
// The per-round payload carries no median, but the amplitude series does carry
// the loudest sample of every whole second of the window -- so requiring the
// QUIETEST whole second of each round to clear a floor is an amplitude
// statement about the round rather than about its best moment. Whole seconds
// fully inside the round only; the partial seconds at either end are dropped
// rather than counted as a dip.
if (W && R.length >= 3) {
  const serLine = game.find((l) => l.includes('[AUDIOSERIES] '));
  let series = null;
  if (serLine) {
    try { series = JSON.parse(serLine.slice(serLine.indexOf('[AUDIOSERIES] ') + 14)); }
    catch { /* reported as a failure below */ }
  }
  if (!Array.isArray(series)) {
    check(false, 'A7b', 'the transcript carries a parseable [AUDIOSERIES] amplitude series');
  } else {
    const FLOOR = 300;
    const mins = R.map((r) => {
      const k0 = Math.ceil((r.from_ms - W.from_ms) / 1000);
      const k1 = Math.floor((r.to_ms - W.from_ms) / 1000) - 1;
      const secs = [];
      for (let k = k0; k <= k1; k++) secs.push(series[k] ?? 0);
      return { round: r.round, n: secs.length, min: secs.length ? Math.min(...secs) : null };
    });
    console.log(`quietest whole second of each round: `
              + mins.map((m) => `r${m.round} ${m.min} (${m.n}s)`).join(', '));
    check(mins.every((m) => m.n >= 5 && m.min !== null && m.min >= FLOOR), 'A7b',
          `no round has a quiet second in it: quietest whole-second peak per round `
          + `${mins.map((m) => m.min).join(', ')} (bar: ${FLOOR} each, over `
          + `${mins.map((m) => m.n).join('/')} whole seconds)`);

    // ------------------- A7c: SILENCE WHERE SILENCE IS CORRECT
    //
    // THE ONLY CHECK HERE THAT CAN FAIL BECAUSE THERE IS TOO MUCH SOUND, and
    // the gate was blind without it. Every other assertion in this file gets
    // MORE satisfied as the buffer gets louder -- A5, A5b, A6, A7, A7b, A8, A9
    // and A13 would all pass harder on a buffer full of noise than they do on
    // the real mix.
    //
    // That matters specifically because of what M3 changed. Task 2 turned
    // fill_audio's `memset` from unconditional into runtime-conditional (on
    // `uses_sdl_mixer`). If that condition is ever wrong, the callback hands
    // over uninitialised heap reinterpreted as S16 -- which is exactly the loud
    // noise M2 produced, and which this gate would have reported as a healthier
    // result than success. M3 created the first route back to that regression;
    // this is the check that can see it.
    //
    // WHAT IT ASSERTS: the whole seconds of the window BEFORE round 1 begins --
    // the language menu, First Setup and the welcome message -- are EXACTLY
    // zero. Not "quiet": zero. Nothing in this configuration plays a sound
    // before the match starts (the one menu-era voice, moviesounds/intro.wav,
    // is the len = 0 stand-in that produces no samples), so any non-zero sample
    // there is something in the buffer that the game did not put there.
    //
    // This is also the half of the steps file's "structured" claim that nothing
    // else checked: "silent through the menus and then peaks once per round".
    // A7b asserts the peaks; this asserts the silence.
    //
    // Measured: exactly 7 zero seconds in Chrome and in Firefox, and 7 in the
    // negative control too -- silence is the one thing a silent build gets
    // right, which is why this check passing there is correct and not a
    // weakness. `n >= 3` stops it going vacuous if a future script shortens the
    // menu phase; today n is 7.
    const preN = Math.floor((R[0].from_ms - W.from_ms) / 1000);
    const pre = [];
    for (let k = 0; k < preN; k++) pre.push(series[k] ?? 0);
    const loud = pre.filter((v) => v !== 0);
    console.log(`before round 1: ${pre.length} whole seconds of window, peaks `
              + `[${pre.join(',')}]`);
    check(pre.length >= 3 && loud.length === 0, 'A7c',
          `the menus are EXACTLY silent -- the same instrument that reports the sound `
          + `reads 0 in all ${pre.length} whole seconds before round 1 `
          + `(${loud.length} non-zero). This is the only check here that fails when there `
          + `is too MUCH signal, and the only one that can see uninitialised heap being `
          + `played`);
  }
}

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
            + `pre-gesture region: max ${WR.push_gap_max_ms}ms`);
  note(`scheduling lead: p50 ${W.latency_ms.p50}ms, max ${W.latency_ms.max}ms. Emscripten keeps `
     + `bufferingDelay + queued x bufferDuration = `
     + `${Math.round(1000 * (SP.bufferingDelay + SP.queued * SP.bufferDurationSecs))}ms `
     + `of audio ahead of the clock, which is both the latency and the stall the device can survive.`);
  check(W.push_gap_ms.max !== null && W.push_gap_ms.max <= 1000, 'A8',
        `buffers arrive continuously through the match: worst gap between consecutive `
        + `unpaused pushAudio calls ${W.push_gap_ms.max}ms (bar: 1000ms)`);
  if (WR.push_gap_max_ms > 1000)
    note(`the UNWINDOWED worst gap is ${WR.push_gap_max_ms}ms. That is the suspended `
       + `AudioContext before the first trusted key press, not a defect, and it is exactly why `
       + `A8 is measured over the window. This same check applied to the whole run would fail here.`);
}

// ------------------------------- A9: handed to a RUNNING context, not a parked one
// Still not proof that anything was rendered -- see the header.
//
// AND IT IS ONLY LOAD-BEARING WHERE THE PARKED REGION CONTAINS PUSHES. A9 rules
// out "the buffers went into a context whose clock was not moving" exactly to
// the extent that this transcript ever recorded a push while the context was
// parked. Measured: Firefox does (5 pre-gesture pushes, all reported
// `suspended`, all zero PCM), so there A9 is a real discrimination. Chrome
// makes ZERO pre-gesture pushes -- a suspended context stops Emscripten asking
// for buffers at all -- so every Chrome reading is from after the gesture and
// could not have been anything but `running`. The pre_gesture note printed
// below is what tells the two cases apart, so read it before quoting A9.
console.log('');
if (W) {
  const st = W.ctx_states ?? {};
  console.log(`AudioContext state at each in-window push: ${JSON.stringify(st)}`);
  const parked = PG ? PG.calls : 0;
  check(Object.keys(st).length > 0 && Object.keys(st).every((k) => k === 'running'),
        'A9',
        `every buffer in the window was handed to a RUNNING AudioContext `
        + `(states seen: ${Object.keys(st).join(', ') || 'none'}). `
        + (parked > 0
           ? `This transcript recorded ${parked} push(es) while the context was parked, so `
             + `the check discriminates here.`
           : `This transcript recorded NO push while the context was parked, so the check `
             + `had nothing to discriminate against -- see the note below.`));
  note(`whole run, including before the gesture: ${JSON.stringify(WR.ctx_states)}`);
  if (PG)
    note(`BEFORE the gesture: ${PG.calls} calls, `
       + `${PG.buffers_with_nonzero_pcm} non-zero, peak `
       + `${PG.peak_abs_sample}, worst gap ${PG.push_gap_max_ms}ms, states `
       + `${JSON.stringify(PG.ctx_states)}. Reported, never asserted on: this region is `
       + `the harness's own synthetic click, not the game.`);
  if (W.calls_paused) note(`${W.calls_paused} in-window calls arrived with SDL.audio.paused set; `
                         + `pushAudio returns immediately on those, so they are excluded above.`);
}

// -------------------------------------- A10, A11, A11b: what Emscripten itself says
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
// A10 and A11 are absence claims over ONE channel, and an absence claim over a
// dead channel is worth nothing. A19's control does not cover this one: an
// uncaught exception reaches the driver through a different route entirely
// (Runtime.exceptionThrown on CDP, an error-level log entry on BiDi), so a
// driver change that stopped capturing console API calls would leave A19
// passing while A10 and A11 went quiet for the wrong reason.
//
// Both strings above are emitted by Emscripten's err(), which is console.error.
// So are the GL-emulation warnings and the tDirectories relocation message the
// game prints at boot -- the SAME function on the SAME channel, unprompted,
// every run. Requiring at least one of them present is therefore an on-channel
// liveness control, not a proxy for one.
{
  const errs = game.filter((l) => l.includes('[console.error]'));
  check(errs.length > 0, 'A11b',
        `the console.error channel that A10 and A11 are absence claims over is LIVE in `
        + `this transcript (${errs.length} [console.error] lines in the run half), so their `
        + `silence is an observation rather than a dead subscription`);
  for (const h of errs.slice(0, 2)) console.log(`        ${h.trim().slice(0, 140)}`);
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

// Scoped to browser-reported network lines on purpose -- both drivers prefix
// them "[browser." -- so the label says that rather than "every 404". A "404"
// in game output or in an eval payload is not a failed fetch and should not be
// read as one; the price is that this cannot see a 404 the browser did not
// report, which is why drive-firefox.mjs subscribes to network.responseCompleted.
const notFound    = game.filter((l) => /\b404\b/.test(l) && l.includes('[browser.'));
const badNotFound = notFound.filter((l) => !l.includes('/favicon.ico'));
check(badNotFound.length === 0, 'A16',
      `every BROWSER-REPORTED 404 is /favicon.ico (${notFound.length} total, `
      + `${badNotFound.length} other)`);
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

// ----------------------------------------------------- the backstop, closed
} catch (e) {
  // The aliases above cover every optional sub-object of the payload that is
  // read today. This catches the one the NEXT edit forgets. It is not a
  // substitute for them: reaching here means the checks after the throw did not
  // run, and AZ below turns that into a failure with their ids named. What it
  // buys is that the operator gets a report ending in a verdict instead of a
  // stack trace ending in nothing.
  console.log('');
  console.log(`FAIL  AE  the checker hit an internal error and stopped early: `
            + `${e && e.message ? e.message : e}`);
  console.log(`        ${(e && e.stack ? e.stack.split('\n')[1] : '').trim()}`);
  console.log(`        This is a defect in check-audio-transcript.mjs, not a verdict on the `
            + `transcript. The checks listed as NOT REACHED below were not evaluated.`);
  failures++;
}

// ------------------------------- AZ: every check declared above actually ran
// A1 exits early and loudly when the payload is missing. The guards further
// down do not: A5/A5b/A6/A8/A9 sit inside `if (W)`, A7b inside `if (W && R)`,
// A2's comparisons inside `if (dev && D.spec)`. A payload with a null `window`
// makes four of them disappear from the output entirely, and a reader scanning
// for FAIL sees a shorter list of passes. That is the difference between "this
// was checked and held" and "this was not checked", and only one of them is
// evidence -- so the declared list is checked against the emitted one. It is
// also what makes the catch above safe to have: an early exit cannot be
// mistaken for a pass, because every unevaluated id is named here.
console.log('');
{
  const EXPECTED = ['A1', 'A2', 'A3', 'A4', 'A4b', 'A5', 'A5b', 'A6', 'A7', 'A7b',
                    'A7c', 'A8', 'A9', 'A10', 'A11', 'A11b', 'A12', 'A13', 'A14',
                    'A15', 'A16', 'A17', 'A18', 'A19'];
  // Snapshot before calling check(), which appends AZ itself.
  const seen    = emitted.slice();
  const missing = EXPECTED.filter((id) => !seen.includes(id));
  const extra   = seen.filter((id) => !EXPECTED.includes(id));
  check(missing.length === 0 && extra.length === 0, 'AZ',
        `all ${EXPECTED.length} declared checks were reached `
        + `(${seen.length} emitted before this one`
        + `${missing.length ? `; NOT REACHED: ${missing.join(', ')}` : ''}`
        + `${extra.length ? `; undeclared: ${extra.join(', ')}` : ''})`);
}

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
console.log(`${failures === 0 ? 'Passing means' : 'A pass would mean'}: non-zero PCM reached `
          + `SDL.audio.pushAudio. It does NOT mean the`);
console.log('buffers were rendered to a device (pushAudio is upstream of the Web Audio graph),');
console.log('and it does NOT mean the mix is correct. Nobody has heard this.');
process.exit(failures === 0 ? 0 : 1);
