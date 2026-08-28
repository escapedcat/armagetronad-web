#!/usr/bin/env node
// Prove that every check in check-audio-transcript.mjs can FAIL.
//
//   node docs/evidence/m3-audio/prove-checks-can-fail.mjs \
//        docs/evidence/m3-audio/chrome-console.log
//
// Exits 0 only if the transcript passes unmutated AND every mutation below
// flips its target check from PASS to FAIL.
//
// WHY THIS FILE EXISTS
// --------------------
// M2 established the rule: an assertion never shown to fail is not evidence.
// A checker is a program, and a program that prints PASS unconditionally looks
// exactly like a program that verified something. The only way to tell them
// apart is to break the input on purpose, one claim at a time, and watch the
// right claim -- and, where it can be arranged, ONLY the right claim -- go red.
//
// So this takes a transcript that passes, applies one targeted mutation per
// check, re-runs the real checker (no mock, no copy of its logic), and requires
// the targeted check to flip. Collateral flips are reported rather than hidden:
// some claims genuinely cannot be broken in isolation, because two checks read
// the same line, and pretending otherwise would be the same kind of tidy-
// looking dishonesty this file exists to prevent.
//
// THE MUTATIONS ARE NOT A SIMULATION OF A BROKEN GAME. They are edits to a
// text file, and they prove a property of the CHECKER. The separate, stronger
// control is a real run of web/tools/audio-gate.steps against a bundle with
// both WAVs made unloadable -- a genuinely silent build, whose transcript this
// same checker rejects. See README.md; both are needed, and neither replaces
// the other.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(here, 'check-audio-transcript.mjs');

const src = process.argv[2];
if (!src) { console.error('usage: prove-checks-can-fail.mjs <passing console.log>'); process.exit(2); }
const original = readFileSync(src, 'utf8').split('\n');
const work = mkdtempSync(join(tmpdir(), 'm3-prove-'));

// ------------------------------------------------------------------- helpers
const isHarness = (l) => l.includes('] [harness] ');
const dumpIndex = (ls) => ls.findIndex((l) => !isHarness(l) && l.includes('[AUDIODUMP] '));

// Rewrite the probe's JSON payload in place, keeping the driver's stamp and the
// "[console.log] [AUDIODUMP] " prefix exactly as they were.
const editDump = (fn) => (ls) => {
  const i = dumpIndex(ls);
  const at = ls[i].indexOf('[AUDIODUMP] ') + 12;
  const D = JSON.parse(ls[i].slice(at));
  fn(D);
  const out = ls.slice();
  out[i] = ls[i].slice(0, at) + JSON.stringify(D);
  return out;
};

// Splice fabricated lines into the RUN half, just after round 1 starts, in the
// shape a driver would have written them.
const insertAfterFirstRound = (...texts) => (ls) => {
  const i = ls.findIndex((l) => !isHarness(l) && l.includes('[L] NEW_ROUND'));
  const out = ls.slice();
  out.splice(i + 1, 0, ...texts.map((t) => `[  30000ms] ${t}`));
  return out;
};

const editFirstLineMatching = (needle, fn) => (ls) => {
  const i = ls.findIndex((l) => !isHarness(l) && l.includes(needle));
  if (i < 0) throw new Error(`no line matching ${needle}`);
  const out = ls.slice();
  out[i] = fn(ls[i]);
  return out;
};

// ----------------------------------------------------------------- mutations
const MUTATIONS = [
  ['A1', 'the probe reports an error instead of null',
   editDump((D) => { D.probe_error = 'deliberate mutation'; })],

  ['A2', "se_SoundInit's device line disagrees with the probe about the sample rate",
   editFirstLineMatching('[SND] device opened:', (l) => l.replace('22050 Hz', '44100 Hz'))],

  ['A3', 'the trusted keydown is back-dated to the harness\'s synthetic click, '
       + 'i.e. the window no longer starts at a user gesture',
   editFirstLineMatching('[AUDIOPROBE] first TRUSTED keydown at',
     (l) => l.replace(/^\s*\[\s*\d+ms\]/, '[   8400ms]'))],

  ['A4', 'the measured window shrinks to a slice of the match',
   editDump((D) => { D.window.span_s = 5; })],

  ['A4b', 'the page-side round boundaries drift 5 s from the driver\'s wall clock',
   editDump((D) => { D.per_round[D.per_round.length - 1].to_ms -= 5000; })],

  ['A5', 'most buffers are silent',
   editDump((D) => { D.window.nonzero_fraction = 0.1; })],

  ['A6', 'the peak amplitude collapses to dither',
   editDump((D) => { D.window.peak_abs_sample = 12; })],

  ['A7', 'one round of three carries no sound, while the overall figures stay healthy',
   editDump((D) => { D.per_round[1].buffers_with_nonzero_pcm = 0; D.per_round[1].nonzero_fraction = 0; })],

  ['A8', 'a 6 s hole opens in the buffer stream -- the size of the real '
       + 'suspended-context gap this windowing exists to exclude',
   editDump((D) => { D.window.push_gap_ms.max = 6064; })],

  ['A9', 'three in-window buffers went to a suspended AudioContext',
   editDump((D) => {
     const n = D.window.ctx_states.running;
     D.window.ctx_states = { running: n - 3, suspended: 3 };
   })],

  ['A10', "Emscripten's own starvation warning appears",
   insertAfterFirstRound('[console.error] warning: Audio callback had starved sending audio by 0.13 seconds')],

  ['A11', 'pushAudio throws internally',
   insertAfterFirstRound('[console.error] Web Audio API error playing back audio: TypeError: deliberate')],

  ['A12', 'the payload reports two completed rounds',
   editDump((D) => { D.rounds_won = 2; })],

  ['A13', 'the engine WAV never loaded',
   editFirstLineMatching('[WAV] loaded /data/sound/cyclrun.wav',
     (l) => l.replace('sound/cyclrun.wav', 'sound/somethingelse.wav'))],

  ['A14', 'the WAV success budget is spent, so every [WAV] count becomes a lower bound',
   insertAfterFirstRound(...Array.from({ length: 16 }, (_, i) =>
     `[console.log] [WAV] loaded /data/sound/expl.wav: 11937 bytes, 8-bit mono @ 11025 Hz (fopen misses so far: ${i})`))],

  ['A15', 'an uncaught exception happens during the run',
   insertAfterFirstRound('[EXCEPTION] TypeError: deliberate mutation')],

  ['A16', 'something other than the favicon 404s',
   insertAfterFirstRound('[browser.error/network] Failed to load resource: the server responded '
                       + 'with a status of 404 (File not found)   <- http://localhost:8000/armagetronad.data')],

  ['A17', 'an until: wait expired, so a round was never observed to end',
   insertAfterFirstRound('[harness] until TIMED OUT after 150000ms: saw 0x <<[L] ROUND_WINNER>>, wanted 3')],

  ['A18', "the probe's classifier calls an all-zero buffer non-zero",
   editFirstLineMatching('[AUDIOCONTROL] ', (l) => l.replace('all-zero=>[0,0]', 'all-zero=>[1,1]'))],

  ['A19', 'the deliberate uncaught error at the end is not reported, '
        + 'i.e. the transcript is deaf to browser errors',
   (ls) => {
     const s = ls.findIndex((l) => l.includes('positive-control-deliberate'));
     return ls.filter((l, i) => !(i > s && l.includes('[EXCEPTION]')));
   }],
];

// --------------------------------------------------------------------- drive
// Every verdict below comes from running the REAL checker as a child process
// and reading its stdout, so nothing here can pass by re-implementing it.
const run = (file) => {
  const r = spawnSync(process.execPath, [CHECKER, file], { encoding: 'utf8' });
  const verdict = new Map();
  for (const l of (r.stdout || '').split('\n')) {
    const m = /^(PASS|FAIL)\s+(\S+)\s/.exec(l);
    if (m) verdict.set(m[2], m[1]);
  }
  return { code: r.status, verdict, stdout: r.stdout || '', stderr: r.stderr || '' };
};

console.log(`baseline: ${src}`);
const base = run(src);
const baseFails = [...base.verdict].filter(([, v]) => v === 'FAIL').map(([k]) => k);
console.log(`  exit ${base.code}, ${base.verdict.size} checks, `
          + `${baseFails.length ? 'FAILING: ' + baseFails.join(', ') : 'all passing'}`);
if (base.code !== 0) {
  console.log('\nThe baseline transcript does not pass, so nothing below would mean anything.');
  process.exit(1);
}

console.log('');
let bad = 0;
const untested = new Set([...base.verdict.keys()]);
for (const [id, what, mutate] of MUTATIONS) {
  untested.delete(id);
  let out;
  try { out = mutate(original); }
  catch (e) { console.log(`ERROR ${id}  mutation could not be applied: ${e.message}`); bad++; continue; }
  const file = join(work, `${id}.log`);
  writeFileSync(file, out.join('\n'));
  const r = run(file);
  const got = r.verdict.get(id);
  const collateral = [...r.verdict]
    .filter(([k, v]) => v === 'FAIL' && k !== id).map(([k]) => k);
  const ok = got === 'FAIL' && r.code !== 0;
  if (!ok) bad++;
  console.log(`${ok ? 'flips' : 'DID NOT FLIP'}  ${id.padEnd(4)} when ${what}`);
  console.log(`             checker exit ${r.code}, ${id} = ${got ?? '(check not reached)'}`
            + (collateral.length ? `, also failed: ${collateral.join(', ')}` : ''));
}

// A check with no mutation aimed at it has not been shown to be able to fail,
// which is the whole thing this file is against. Listing them is the point.
if (untested.size) {
  console.log('');
  console.log(`UNTESTED CHECKS (no mutation targets these): ${[...untested].join(', ')}`);
  bad += untested.size;
}

console.log('');
console.log(bad === 0
  ? `EVERY CHECK CAN FAIL: ${MUTATIONS.length} mutations, ${MUTATIONS.length} flips.`
  : `${bad} PROBLEM(S): a check that cannot be made to fail is not evidence.`);
console.log(`mutated transcripts kept in ${work}`);
process.exit(bad === 0 ? 0 : 1);
