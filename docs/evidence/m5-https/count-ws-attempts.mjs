#!/usr/bin/env node
// Re-derive M5 task 3's numbers from the committed transcripts.
//
//   node docs/evidence/m5-https/count-ws-attempts.mjs
//
// Exits 0 if every transcript's two independent counts agree, 1 otherwise.
//
// WHY TWO COUNTS. This milestone's review found three durable references
// carrying three different wire totals, so a number stated once in prose is
// not evidence. Each run is counted twice, by things that cannot both be wrong
// in the same direction:
//
//   in-page   the number of times the page's WebSocket constructor was
//             invoked. The steps file wraps `window.WebSocket` before
//             callMain, so this is the count of connection attempts the wasm
//             module MADE, whatever the browser then decided to do about them.
//   browser   the number of browser-log lines naming a ws:// or wss:// URL. In Chrome
//             that is one `Mixed Content ... has been blocked` line per
//             attempt over https and one `WebSocket connection to ... failed`
//             line per attempt over http. In Firefox it is one or two
//             exception lines per attempt, so Firefox's browser count is
//             reported but NOT asserted equal -- see the note below.
//
// FIREFOX IS COUNTED DIFFERENTLY ON PURPOSE. It emits two distinct texts,
// "can't establish a connection" and "was interrupted while the page was
// loading", and the second appears once per attempt over https but only once
// per PEER over http. Equality there would be a false invariant; what the
// checker asserts instead is that the "can't establish a connection" lines
// match the in-page count exactly, which held in both Firefox runs.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// The final `__wsLog` eval in https-multiplayer.steps prints this JSON. The
// harness JSON-encodes Chrome's string results and prints Firefox's raw, so
// both shapes have to be accepted.
const SUMMARY = /\{\\?"attempts\\?":\s*(\d+).*?\\?"spanMs\\?":\s*(\d+).*?\\?"distinctUrls\\?":\s*(\d+)/;

const skipped = [];

let bad = 0;
const rows = [];
for (const dir of readdirSync(here).sort()) {
  const log = join(here, dir, 'console.log');
  if (!existsSync(log)) continue;
  const text = readFileSync(log, 'utf8');
  const lines = text.split('\n');

  const m = text.match(SUMMARY);
  // A transcript with no __wsLog summary is not a failure -- it is a run that
  // never opened a socket. `regress-viewport-gate` is exactly that: task 3's
  // control, proving the patched drivers still pass an UNRELATED gate. Counting
  // it as a disagreement made this tool exit 1 on a tree where every real
  // multiplayer run agrees, which is a false red.
  //
  // Worth recording how it got here, because the shape recurs in this project:
  // the tool was verified green at 3876982d, and d4951771 then added the
  // control transcript. A check verified BEFORE a later commit changed its
  // subject is stale -- the same defect M4's P11 gate has, one milestone up.
  if (!m) { skipped.push(dir); continue; }
  const [, attempts, spanMs, distinct] = m.map(Number);

  const isFirefox = text.includes('[harness] firefox:');
  // Harness-written lines quote the whole step text back, including the eval
  // expression, so they have to be excluded from any count of browser output.
  const browserLines = lines.filter((l) => !l.includes('] [harness] '));
  const mixed   = browserLines.filter((l) => l.includes('Mixed Content')).length;
  // `wss?:` and not `ws:` -- mp-wss is the probe that rewrites the scheme, and
  // an anchored `ws:` would score it 0 and report a disagreement that is the
  // checker's own.
  const wsFail  = browserLines.filter((l) => /WebSocket connection to 'wss?:/.test(l)).length;
  const ffFail  = browserLines.filter((l) => /can.t establish a connection to the server at wss?:/.test(l)).length;

  const browser = isFirefox ? ffFail : (mixed || wsFail);
  const ok = browser === attempts;
  if (!ok) bad++;
  rows.push({ dir, attempts, spanMs, distinct, browser, ok });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('run', 22), pad('in-page', 9), pad('browser', 9), pad('span ms', 9), pad('urls', 6), 'agree');
for (const r of rows) {
  console.log(pad(r.dir, 22), pad(r.attempts, 9), pad(r.browser, 9), pad(r.spanMs, 9), pad(r.distinct, 6), r.ok ? 'yes' : 'NO');
}
for (const d of skipped)
  console.log(`skipped  ${d} -- no socket opened; not a multiplayer run`);
console.log(bad ? `\n${bad} transcript(s) disagree` : '\nall multiplayer transcripts agree');
process.exit(bad ? 1 : 0);
