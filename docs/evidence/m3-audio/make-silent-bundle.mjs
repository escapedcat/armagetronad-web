#!/usr/bin/env node
// Build the PIPELINE-LEVEL negative control for the M3 gate: a copy of
// web/dist-m1 in which no WAV can be decoded, so nothing can ever write a
// sample into the audio buffer.
//
//   node docs/evidence/m3-audio/make-silent-bundle.mjs web/dist-m1 /tmp/dist-silent
//   python3 -m http.server 8001 --directory /tmp/dist-silent &
//   node web/tools/drive-browser.mjs --headed --url http://localhost:8001/armagetronad.html \
//        --out /tmp/silent-chrome --script-file web/tools/audio-gate.steps
//   node docs/evidence/m3-audio/check-audio-transcript.mjs /tmp/silent-chrome/console.log
//        -> exits 1
//
// WHAT IT CHANGES AND WHY THAT IS THE RIGHT LESION
// -----------------------------------------------
// It sets each `fmt ` chunk's audioFormat field from 1 (uncompressed PCM) to
// 0x11 (IMA ADPCM) inside the preloaded armagetronad.data. The file stays
// structurally valid RIFF of exactly the same length -- so no rebuild, no
// relink, and the wasm and the JS loader are byte-identical to the ones under
// test. The ONLY difference between the control run and the real run is the
// content of two sound files.
//
// That matters more than it might look. A negative control that also changed
// the build would be answering "does a different program behave differently";
// this one answers "does THIS program, with the same audio plumbing running at
// the same rate, still report sound when there is none to report". The
// measured answer is that pushAudio is still called the same number of times
// at the same 278 ms lead, and every buffer reads exactly zero.
//
// The rejection comes from the WAV parser M3 task 1 added to eSound.cpp, which
// refuses anything whose fmt tag is not 1. So this exercises a real refusal
// path rather than corrupting bytes until something crashes.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error('usage: make-silent-bundle.mjs <dist dir> <output dir>'); process.exit(2); }

// Recursive, because a flat copyFileSync loop throws EISDIR the day the dist
// grows a subdirectory -- and a control that dies while being built is one
// nobody re-runs.
const copyTree = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(join(from, e.name), join(to, e.name));
    else copyFileSync(join(from, e.name), join(to, e.name));
  }
};
copyTree(src, dst);

const dataPath = join(dst, 'armagetronad.data');
const buf = readFileSync(dataPath);
const before = buf.length;

// Walk every "WAVEfmt " header in the packed data file. Layout after the tag:
// 4 bytes of chunk size, then the 2-byte audioFormat this rewrites.
//
// EVERY HEADER MUST READ 1 BEFORE IT IS TOUCHED, and that is the difference
// between a control and a ritual. This lesion only means something if the file
// it starts from is decodable: run against a dist whose WAVs were already
// non-PCM, an unconditional write would produce a bundle that is silent for a
// reason that predates the patch, and a checker failing on it would be
// "proving" nothing. Refuse instead of assuming.
let patched = 0;
for (let i = 0; i + 12 < buf.length; i++) {
  if (buf.toString('latin1', i, i + 8) !== 'WAVEfmt ') continue;
  const at = i + 12;
  const was = buf.readUInt16LE(at);
  if (was !== 1) {
    console.error(`fmt tag at offset ${at} is ${was}, not 1 (uncompressed PCM). This dist's `
                + `WAVs are not decodable to begin with, so silencing them would prove nothing.`);
    process.exit(1);
  }
  buf.writeUInt16LE(0x11, at);
  console.log(`  patched fmt tag at offset ${at}: ${was} -> 0x11 (IMA ADPCM)`);
  patched++;
}

if (patched === 0) { console.error('no WAVE fmt headers found -- nothing was patched'); process.exit(1); }
writeFileSync(dataPath, buf);
if (readFileSync(dataPath).length !== before) { console.error('length changed; the loader will reject it'); process.exit(1); }
console.log(`${patched} WAV(s) made undecodable in ${dataPath}, length unchanged at ${before} bytes`);
