#!/usr/bin/env node
// Arbitrate the wire facts of the PUBLIC deployment from a wire-facts.json
// recorded by web/tools/wire-facts.sh.
//
//   sh web/tools/wire-facts.sh > /tmp/wf.json
//   node docs/evidence/m5-launch/check-wire-facts.mjs /tmp/wf.json
//
// Exit 0 if every check passes, 1 otherwise. Everything it prints is derived
// from the JSON alone; it opens no socket and reads no other file, which is
// what lets prove-live-checks-can-fail.mjs flip any single check by editing
// one field.
//
// WHY A CHECKER AND NOT A TABLE. M5's own review found three durable
// references carrying three different wire totals for the same deployment,
// because every one of them was a number typed into prose. A number that is
// re-derived from a recorded observation by a program that exits non-zero when
// it is wrong is a different kind of claim.
//
// THE NEGATIVE CONTROL ASSERTS ON CONTENT-TYPE, NOT ON STATUS (W9). GitHub
// Pages answers a name that does not exist with 404 AND an HTML error page. So
// "the bogus name was not 200" would also be true of a server that had never
// heard of wasm, and "the bogus name returned HTML" is true of a healthy Pages
// too. The separating fact is that the bogus name's content-type is NOT the
// content-type the real wasm gets -- which is exactly the check that would
// break if the edge started answering everything with application/wasm.
//
// WHAT THESE CHECKS DO NOT COVER. They describe one deployment at one moment
// from one machine's network path. `age`/`x-cache` in the raw headers show
// Fastly in front; a different POP could in principle answer differently.
// Nothing here is a claim about Pages in general.

import { readFileSync } from 'node:fs';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: check-wire-facts.mjs <wire-facts.json>');
  process.exit(2);
}
const o = JSON.parse(readFileSync(SRC, 'utf8'));

// The four files the client itself fetches. index.html is the site-root
// redirect: a visitor who pastes the bare Pages URL pays for it too, a visitor
// handed the deep link does not, so it is reported and checked separately
// rather than folded into "what the game costs".
const GAME = ['armagetronad.html', 'armagetronad.js', 'armagetronad.wasm', 'armagetronad.data'];
const ALL = [...GAME, 'index.html'];

let failures = 0;
const ran = [];
function check(id, cond, msg) {
  ran.push(id);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${id.padEnd(4)} ${msg}`);
  if (!cond) failures++;
}
const f = (n) => o.files[n] || {};
const num = (x) => (typeof x === 'number' ? x.toLocaleString('en-US') : String(x));

console.log(`source      : ${SRC}`);
console.log(`url         : ${o.url}`);
console.log(`measured    : ${o.measured_utc}`);
console.log(`dist        : ${o.dist}`);
console.log('');

// ----------------------------------------------------------- 1. the wasm MIME
// The single header that decides whether the browser can stream-compile. If
// Pages served application/octet-stream the page still works -- Emscripten
// falls back to ArrayBuffer instantiation -- so this is not detectable from
// "does it run", which is why it is asserted here rather than assumed from the
// gameplay gate passing.
const w = f('armagetronad.wasm');
check('W1', w.content_type === 'application/wasm',
      `the wasm's content-type is exactly "application/wasm" (got "${w.content_type}")`);

// ------------------------------------------------------- 2. it is compressed
check('W2', w.content_encoding === 'gzip',
      `the wasm arrives gzip-encoded (content-encoding: "${w.content_encoding}")`);

// --------------------------------------- 3. and the compression is lossless
// The pair of fetches is what makes the wire number mean anything: a byte
// count for a body that did not decode to the artefact would be worthless.
check('W3', w.gunzip_ok === true && w.decoded_sha256 === w.identity_sha256
            && w.decoded_bytes === w.identity_bytes,
      `the gzip body decodes to exactly the identity body `
      + `(${num(w.decoded_bytes)} B, sha256 ${String(w.decoded_sha256).slice(0, 16)}…)`);

// ------------------------------------- 4. the size question recon could not settle
// M5 recon could not find a compressible file larger than 2.2 MB on any
// *.github.io host, so whether the edge gives up above some threshold was open.
// 35% is the bar; the measurement is ~29%.
// Stated as the ratio ALONE, not as `wire < identity && ratio < 0.35`: for
// positive sizes the ratio bar already implies the inequality, and a conjunct
// that no mutation can isolate is a conjunct that never gets proven -- which
// is the exact defect M4 task 3's review found in a prover.
{
  const ratio = w.wire_bytes / w.identity_bytes;
  check('W4', w.wire_bytes > 0 && ratio < 0.35,
        `the edge really does compress a ${num(w.identity_bytes)} B file: `
        + `${num(w.wire_bytes)} B on the wire, ${(ratio * 100).toFixed(1)}% (bar: under 35%)`);
}

// ------------------------------------------- 5. and it compresses all of them
{
  const bad = ALL.filter((n) => f(n).content_encoding !== 'gzip');
  check('W5', bad.length === 0,
        `all ${ALL.length} deployed files arrive gzip-encoded`
        + (bad.length ? ` -- not: ${bad.join(', ')}` : ''));
}

// ------------------------------------------------------------- 6. cacheability
// Without `vary: Accept-Encoding` a shared cache can hand a gzip body to a
// client that did not ask for one. Recorded from the same response as the
// content-encoding it qualifies.
{
  const bad = ALL.filter((n) => !/accept-encoding/i.test(f(n).vary || ''));
  check('W6', bad.length === 0,
        `all ${ALL.length} carry "vary: Accept-Encoding"`
        + (bad.length ? ` -- not: ${bad.join(', ')}` : ''));
}

// -------------------------------- 7. the deployed bytes ARE this tree's build
// Identity by sha256 against web/dist-m1, per file. This is the check that
// makes every other number here a statement about THIS repository rather than
// about whatever happens to be published. It fails loudly, not silently, when
// there is no local build to compare against.
{
  const missing = ALL.filter((n) => f(n).local_sha256 == null);
  const differ = ALL.filter((n) => f(n).local_sha256 != null
                                && f(n).local_sha256 !== f(n).identity_sha256);
  check('W7', missing.length === 0 && differ.length === 0,
        missing.length
          ? `no local build to compare against for: ${missing.join(', ')} `
            + `(build first: make -f web/Makefile client)`
          : differ.length
            ? `the deployed bytes DIFFER from the local build: ${differ.join(', ')}`
            : `all ${ALL.length} deployed files are byte-identical to ${o.dist} (sha256)`);
}

// ------------------------------------------------- 8. what a first visit costs
// PLAN.md's Demo budget is 15 MB. The figure is stated here as the sum of the
// four rows above, not typed in from a report.
{
  const wire = GAME.reduce((a, n) => a + f(n).wire_bytes, 0);
  const ident = GAME.reduce((a, n) => a + f(n).identity_bytes, 0);
  const allWire = ALL.reduce((a, n) => a + f(n).wire_bytes, 0);
  const BUDGET = 15_000_000;
  check('W8', wire > 0 && wire < BUDGET,
        `a first visit transfers ${num(wire)} B = ${(wire / 1048576).toFixed(3)} MiB `
        + `for the ${GAME.length} game files (${num(ident)} B unpacked), `
        + `against PLAN.md's ${num(BUDGET)} B budget -- ${(BUDGET / wire).toFixed(1)}x under`);
  console.log(`       via the bare Pages URL, i.e. including index.html: ${num(allWire)} B`);
  for (const n of ALL) {
    const r = f(n);
    console.log(`       ${n.padEnd(20)} ${num(r.identity_bytes).padStart(9)} -> `
      + `${num(r.wire_bytes).padStart(9)}  ${((r.wire_bytes / r.identity_bytes) * 100).toFixed(1)}%`
      + `  ${r.content_type}`);
  }
}

// --------------------------------------------------- 9. THE NEGATIVE CONTROL
// See the header. Asserted on content-type in BOTH directions: it must not be
// the wasm type, and it must be the html type Pages uses for its error page.
// Status is printed, deliberately not asserted.
{
  const m = o.controls.missing_file;
  const ct = m.content_type || '';
  check('W9', ct !== w.content_type && /^text\/html\b/.test(ct),
        `a name that does not exist ("${m.name}") answers with content-type "${ct}", `
        + `not "${w.content_type}" -- so W1 is a fact about the file, not about the host`);
  console.log(`       its status is ${m.status} and its body is ${num(m.bytes)} B; `
    + `neither is asserted, because a 404 HTML error page is what a HEALTHY Pages sends too.`);
}

// -------------------------------------------------- 10. brotli, still gzip-only
// Recon measured this on other *.github.io hosts at ~2 MB. Re-measured here at
// 4.3 MB rather than carried forward: a 22% saving would have been worth a
// custom domain if it had appeared.
{
  const br = o.controls.brotli_only_encoding || '';
  check('W10', br === '',
        `"Accept-Encoding: br" alone still returns identity at this size `
        + `(content-encoding: ${br === '' ? '(absent)' : `"${br}"`}) -- Pages is gzip-only`);
}

// ------------------------------------ 11. and what a real browser header gets
// The gzip rows above were taken with a hand-written header. This is the one
// that says a browser gets the same thing.
check('W11', o.controls.browser_accept_encoding_result === 'gzip',
      `a browser's own "Accept-Encoding: gzip, deflate, br, zstd" gets gzip `
      + `(got "${o.controls.browser_accept_encoding_result}")`);

// -------------------------------------------- 12. the entry point still exists
// M5 task 4's first deploy published the wasm, the js and the data and NEITHER
// html file, so the bare Pages URL -- the one a visitor is handed -- was
// GitHub's 404 page. gh-pages printed "Published" and exited 0. This check is
// that defect's tripwire, and it is why the root is fetched at all.
{
  const r = o.controls.site_root;
  check('W12', r.status === 200 && /^text\/html\b/.test(r.content_type || ''),
        `the bare site root answers ${r.status} "${r.content_type}" -- a visitor who pastes `
        + `the Pages URL gets a page, not GitHub's 404`);
}

// -------------------------------------------- 13. nothing 404ed on the way in
{
  const bad = ALL.filter((n) => f(n).identity_status !== 200 || f(n).gzip_status !== 200);
  check('W13', bad.length === 0,
        `all ${ALL.length} files answered 200 on both the identity and the gzip fetch`
        + (bad.length ? ` -- not: ${bad.join(', ')}` : ''));
}

// ----------------------------------------------------------- WZ: coverage guard
// Same role as M4's MZ: a regression guard on THIS FILE, not a check on the
// input. Every check() above is an unconditional top-level statement, so no
// input can stop one running; if one is deleted or made conditional, this
// notices. It is therefore not coverable by mutating the JSON, and the prover
// says so rather than omitting it.
{
  const DECLARED = ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12','W13'];
  const same = ran.length === DECLARED.length && DECLARED.every((d) => ran.includes(d));
  console.log('');
  check('WZ', same,
        `every declared check ran: ${DECLARED.length} declared, ${ran.length} executed`);
}

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
