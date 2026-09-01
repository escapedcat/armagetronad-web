#!/usr/bin/env node
// Show that every assertion M5 task 5 added can fail.
//
//   node docs/evidence/m5-launch/prove-live-checks-can-fail.mjs
//
// Exit 0 if every declared mutation flipped EXACTLY the checks it declared,
// 1 otherwise.
//
// WHY THIS EXISTS. An assertion that has never been seen to fail is not
// evidence -- it is a line of code that has only ever been observed agreeing.
// Every milestone since M2 has held this standard and it has caught real
// defects: M4 task 3's review found a check whose only mutation tripped a
// NEIGHBOURING conjunct, so the named predicate was never exercised at all.
//
// SET EQUALITY, NOT SUBSET. A mutation declares the ids it expects to break
// (`expect`), and the run is green only when the observed failure set EQUALS
// that list. The weaker "at least the named check failed" form would pass a
// mutation that knocked out every check in the file, and would hide exactly
// the coupling this is meant to expose. Where a mutation genuinely must take
// another check with it, the second id is listed and `why` says why.
//
// AIMED AT PREDICATES, NOT AT CHECK NAMES. Where a check asserts two
// independent things there is one mutation per conjunct, and the case name
// says which conjunct it is for.
//
// WHAT A MUTATION PROVES AND WHAT IT DOES NOT. It proves the check is WIRED
// UP: that it reads the field it claims to read and reports FAIL when that
// field says the wrong thing. It does NOT prove the field means what the
// check's prose says it means. Only the real thing misbehaving shows that,
// which is why the LIVE controls listed at the end matter more than anything
// below -- W9's bogus filename and W10's brotli-only request are both real
// requests to the real deployment, recorded in the same run as the facts they
// control for.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------ json surgery
// Every mutation is a function over the PARSED observation, re-serialised.
// Editing the JSON text would risk a mutation that changes the file's shape
// rather than its content, and a checker that crashed on malformed input would
// "fail" for a reason that has nothing to do with the assertion under test.
const jsonSuite = {
  name: 'wire facts of the public deployment',
  checker: join(HERE, 'check-wire-facts.mjs'),
  source: join(HERE, 'wire-facts.json'),
  idRe: /^(PASS|FAIL)  (W\w+)/gm,
  load: (p) => JSON.parse(readFileSync(p, 'utf8')),
  save: (o, p) => writeFileSync(p, JSON.stringify(o, null, 2)),
  ext: '.json',
  notCoverable: [[
    'WZ',
    'WZ compares the ids that produced a verdict against the declared list. Every\n'
    + '        check() in check-wire-facts.mjs is an unconditional top-level statement, so\n'
    + '        no input can stop one running: it is a regression guard on the checker\n'
    + '        source, not a check on the observation.',
  ]],
  cases: [
    { name: 'W1  the wasm is served as a generic byte stream',
      expect: ['W1'],
      why: 'this is the failure mode that is INVISIBLE from "does the game run" -- '
         + 'Emscripten falls back to ArrayBuffer instantiation and the page still works.',
      apply: (o) => { o.files['armagetronad.wasm'].content_type = 'application/octet-stream'; } },

    { name: 'W2  the wasm arrives uncompressed',
      expect: ['W2', 'W5'],
      why: 'W5 asserts ALL five files are gzipped and the wasm is one of the five, so a '
         + 'mutation that un-gzips the wasm cannot leave W5 standing. Declared, not tolerated.',
      apply: (o) => { o.files['armagetronad.wasm'].content_encoding = ''; } },

    { name: 'W3a the gzip body decodes to different bytes than the identity body',
      expect: ['W3'],
      apply: (o) => { o.files['armagetronad.wasm'].decoded_sha256 = '0'.repeat(64); } },

    { name: 'W3b the gzip body decodes to a different LENGTH',
      expect: ['W3'],
      apply: (o) => { o.files['armagetronad.wasm'].decoded_bytes -= 1; } },

    { name: 'W3c the gzip body did not decode at all',
      expect: ['W3'],
      apply: (o) => { o.files['armagetronad.wasm'].gunzip_ok = false; } },

    { name: 'W4  the edge gives up on a 4.3 MB file (92% of identity on the wire)',
      expect: ['W4'],
      why: 'this is the exact fact M5 recon could not settle -- the largest compressible '
         + 'asset it could find on any *.github.io host was 2.2 MB.',
      apply: (o) => { o.files['armagetronad.wasm'].wire_bytes = 4_000_000; } },

    { name: 'W5  one NON-wasm file arrives uncompressed',
      expect: ['W5'],
      why: 'aimed away from the wasm on purpose, so W5 is exercised without W2.',
      apply: (o) => { o.files['index.html'].content_encoding = ''; } },

    { name: 'W6  a file is missing "vary: Accept-Encoding"',
      expect: ['W6'],
      apply: (o) => { o.files['armagetronad.data'].vary = ''; } },

    { name: 'W7a a deployed file differs from the local build',
      expect: ['W7'],
      apply: (o) => { o.files['armagetronad.js'].local_sha256 = 'f'.repeat(64); } },

    { name: 'W7b there is no local build to compare against',
      expect: ['W7'],
      why: 'the second conjunct. This is the case a fresh clone hits, and it must FAIL '
         + 'rather than pass quietly -- an unrun comparison is not a passed comparison.',
      apply: (o) => { o.files['armagetronad.js'].local_sha256 = null; } },

    { name: 'W8  the first visit costs 20 MB, over PLAN.md’s 15 MB budget',
      expect: ['W8'],
      why: 'inflated on the .data rather than the wasm, so the ratio bar W4 owns is untouched.',
      apply: (o) => { o.files['armagetronad.data'].wire_bytes = 20_000_000; } },

    { name: 'W9a THE TRAP: the bogus name answers with the wasm content-type',
      expect: ['W9'],
      why: 'status stays 404. A control asserting on status would still call this a pass, '
         + 'which is the whole reason W9 asserts on content-type.',
      apply: (o) => { o.controls.missing_file.content_type = 'application/wasm'; } },

    { name: 'W9b the bogus name answers with neither the wasm type nor html',
      expect: ['W9'],
      why: 'the other conjunct: W9 asserts BOTH that it is not the wasm type and that it '
         + 'is the html error page, so that a host answering everything with a third '
         + 'type cannot slip through.',
      apply: (o) => { o.controls.missing_file.content_type = 'application/json'; } },

    { name: 'W10 Pages starts serving brotli',
      expect: ['W10'],
      why: 'not a defect if it happened -- it would be a 22% saving -- but it would '
         + 'falsify recon’s "gzip only", so the gate must notice rather than assume.',
      apply: (o) => { o.controls.brotli_only_encoding = 'br'; } },

    { name: 'W11 a real browser Accept-Encoding gets identity',
      expect: ['W11'],
      apply: (o) => { o.controls.browser_accept_encoding_result = ''; } },

    { name: 'W12a the bare site root is a 404 (task 4’s first deploy, exactly)',
      expect: ['W12'],
      why: 'that deploy published the wasm, the js and the data and NEITHER html file, '
         + 'while gh-pages printed "Published" and exited 0.',
      apply: (o) => { o.controls.site_root.status = 404; } },

    { name: 'W12b the site root answers 200 with something that is not a page',
      expect: ['W12'],
      apply: (o) => { o.controls.site_root.content_type = 'application/wasm'; } },

    { name: 'W13a a file 404s on the gzip fetch',
      expect: ['W13'],
      apply: (o) => { o.files['armagetronad.data'].gzip_status = 404; } },

    { name: 'W13b a file 404s on the identity fetch',
      expect: ['W13'],
      apply: (o) => { o.files['armagetronad.data'].identity_status = 404; } },
  ],
};


// ============================================================ the live gate
// The multiplayer transcript is TEXT, so its mutations are line surgery rather
// than field edits. Everything below is aimed at one predicate; where two
// checks read the same line they read DIFFERENT substrings of it, which is why
// none of these cases needs to declare collateral.
const stamped = (t) => `[  12345ms] ${t}`;

function mapLine(L, needle, fn) {
  const i = L.findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`prover: no line containing ${needle}`);
  L[i] = fn(L[i]);
  return L;
}
function mapAll(L, needle, fn) {
  let hit = 0;
  const out = L.map((l) => (l.includes(needle) ? (hit++, fn(l)) : l));
  if (!hit) throw new Error(`prover: no line containing ${needle}`);
  return out;
}
function dropLines(L, needle, n) {
  let left = n;
  const out = L.filter((l) => !(left > 0 && l.includes(needle) && !l.includes('] [harness] ')
                                && left--));
  if (left > 0) throw new Error(`prover: wanted ${n} lines containing ${needle}, short by ${left}`);
  return out;
}
const insert = (L, text) => { L.splice(3, 0, stamped(text)); return L; };
// The summary eval's JSON arrives escaped in Chrome and raw in Firefox, so
// every field edit tolerates the backslash.
const setField = (L, field, val) =>
  mapLine(L, 'firstMs', (l) => l.replace(
    new RegExp('(\\\\?"' + field + '\\\\?":\\s*)\\d+'), `$1${val}`));

function mpSuite(source, engine) {
  // Chrome and Firefox describe the same event with different sentences. X3
  // counts the clause that says the endpoint was refused; X9 counts the phrase
  // "Mixed Content" alone, which is the phrase a naive gate would grep for and
  // which Firefox never prints.
  const CLAUSE = engine === 'firefox'
    ? 'establish a connection to the server at ws://'
    : 'this endpoint must be available over WSS';

  const cases = [
    { name: 'X1a the run was against the local rig, not the deployment',
      expect: ['X1'],
      why: 'this is precisely what task 3 could NOT rule out about its own numbers, and it '
         + 'is why X1 exists: every figure in that task came from https://localhost:8443 '
         + 'behind a self-signed certificate.',
      apply: (L) => mapLine(L, '[harness] navigating to',
        (l) => l.replace(/navigating to \S+/, 'navigating to https://localhost:8443/armagetronad.html')) },

    { name: 'X1b the page reported itself as http:',
      expect: ['X1'],
      why: 'the second conjunct, and the independent one: the driver says what it was '
         + 'TOLD to open, the page says what it actually IS.',
      apply: (L) => mapLine(L, 'page origin is https:',
        (l) => l.replace('page origin is https:', 'page origin is http:')) },

    { name: 'X2  a consistent 19-attempt world, i.e. the http: figure',
      expect: ['X2'],
      why: 'mutated CONSISTENTLY -- summary, running total and browser lines all moved to '
         + '19 -- so X3 and X6 still agree with each other and only the band check fires. '
         + 'A lazier mutation of the one number would have knocked out three checks and '
         + 'proven none of them.',
      apply: (L) => {
        const n = L.filter((l) => l.includes(CLAUSE) && !l.includes('] [harness] ')).length;
        let out = dropLines(L, CLAUSE, n - 19);
        out = setField(out, 'attempts', 19);
        return mapLine(out, 'ws attempts total',
          (l) => l.replace(/(=> "?ws attempts total: )\d+/, '$119'));
      } },

    { name: 'X3  the browser recorded five fewer events than the module made attempts',
      expect: ['X3'],
      apply: (L) => dropLines(L, CLAUSE, 5) },

    { name: 'X4a one attempt went somewhere that is not a master server',
      expect: ['X4'],
      apply: (L) => mapLine(L, 'for(const e of window.__wsLog)',
        (l) => l.replace('master1.armagetronad.org', 'evil.example.com')) },

    { name: 'X4b the page saw three distinct endpoints, not four',
      expect: ['X4'],
      why: 'the other conjunct: the per-URL map and the distinct count are two different '
         + 'in-page derivations and X4 asserts both.',
      apply: (L) => setField(L, 'distinctUrls', 3) },

    { name: 'X5  the attempts spanned 40 s, not the 4x5 s master timeout',
      expect: ['X5'],
      apply: (L) => setField(L, 'spanMs', 40000) },

    { name: 'X6a five sockets were opened before the master query was ever started',
      expect: ['X6'],
      why: 'if the page opened ws:// sockets on its own the count would not be attributable '
         + 'to the menu route at all.',
      apply: (L) => mapLine(L, 'ws attempts before the master query',
        (l) => l.replace(/(=> "?ws attempts before the master query: )\d+/, '$15')) },

    { name: 'X6b seven more sockets were opened after the query finished',
      expect: ['X6'],
      why: 'the other conjunct, and the one that matters for the decision task 3 took: the '
         + 'noise is acceptable BECAUSE it is bounded and stops.',
      apply: (L) => mapLine(L, 'ws attempts total',
        (l) => l.replace(/(=> "?ws attempts total: )(\d+)/, (_, p, d) => p + (Number(d) + 7))) },

    { name: 'X7  the GL context came back with an error after the master query',
      expect: ['X7'],
      apply: (L) => mapLine(L, 'alive, gl err=0x0',
        (l) => l.replace(/gl err=0x0/g, 'gl err=0x502')) },

    { name: 'X8a a THIRD exception text appears',
      expect: ['X8'],
      why: 'this is the case that shows the rule was not loosened. Firefox logs 192-194 '
         + '[EXCEPTION] lines on this route and every gate in this project forbids the tag; '
         + 'X8 permits two texts by name and nothing else.',
      apply: (L) => insert(L, '[EXCEPTION] TypeError: synthetic, injected by the prover') },

    { name: 'X8b a PERMITTED text on a line that names no ws:// endpoint',
      expect: ['X8'],
      why: 'the second conjunct of the allowance. "was interrupted while the page was '
         + 'loading" is an ordinary Firefox message about any request; it is waved through '
         + 'only when the line is about a ws:// endpoint.',
      apply: (L) => insert(L, '[EXCEPTION] The connection to https://example.com/x '
                            + 'was interrupted while the page was loading.') },

    { name: 'X8c an ordinary hazard text appears in the run',
      expect: ['X8'],
      apply: (L) => insert(L, '[console.error] Stack overflow (synthetic, injected by the prover)') },

    engine === 'firefox'
      ? { name: 'X9  Firefox starts printing "Mixed Content" after all',
          expect: ['X9'],
          why: 'X9 asserts the ABSENCE of the phrase, which is the whole trap: with no such '
             + 'line and ~96 attempts blocked, a grep-based gate reads Firefox as not '
             + 'blocking. Note this case flips X9 ALONE -- X3 counts a different substring '
             + 'on purpose, so the two are independently provable.',
          apply: (L) => insert(L, '[browser.error/security] Mixed Content: synthetic line '
                                + 'injected by the prover') }
      : { name: 'X9  Chrome stops naming mixed content, keeping the rest of the sentence',
          expect: ['X9'],
          why: 'the same substring separation seen from the other side: the per-attempt '
             + 'clause X3 counts is untouched, so X3 still passes and only X9 fires.',
          apply: (L) => mapAll(L, 'Mixed Content',
            (l) => l.replace(/Mixed Content/g, 'Insecure content')) },

    { name: 'X10 a wait expired instead of being satisfied',
      expect: ['X10'],
      apply: (L) => insert(L, '[harness] until TIMED OUT after 30000ms: saw 0x <<synthetic>>, wanted 1') },

    { name: 'X11 something other than the favicon 404s',
      expect: ['X11'],
      apply: (L) => insert(L, '[browser.error/network] Failed to load resource: the server '
                            + 'responded with a status of 404 (Not Found)   <- '
                            + 'https://escapedcat.github.io/armagetronad-web/armagetronad.data') },
  ];

  return {
    name: `the live multiplayer route, ${engine}, against the public URL`,
    checker: join(HERE, 'check-live-multiplayer.mjs'),
    source,
    idRe: /^(PASS|FAIL)  (X\w+)/gm,
    load: (p) => readFileSync(p, 'utf8').split('\n'),
    save: (d, p) => writeFileSync(p, d.join('\n')),
    ext: '.log',
    // NOT a mutation: a real transcript from a real run, recorded by M5 task 3
    // against the self-signed local rig at https://localhost:8443. It is the
    // world X1 exists to exclude, and it exists on disk, so X1 gets a witness
    // stronger than any line surgery.
    realControls: engine === 'firefox'
      ? [{ file: join(HERE, '..', 'm5-https', 'mp-https-ff', 'console.log'),
           what: "task 3's Firefox run against the LOCAL RIG, not the deployment",
           expect: ['X1'] }]
      : [{ file: join(HERE, '..', 'm5-https', 'mp-https', 'console.log'),
           what: "task 3's Chrome run against the LOCAL RIG, not the deployment",
           expect: ['X1'] }],
    notCoverable: [[
      'XZ',
      'XZ compares the ids that produced a verdict against the declared list. Every\n'
      + '        check() in check-live-multiplayer.mjs is an unconditional top-level\n'
      + '        statement, so no transcript can stop one running: it is a regression guard\n'
      + '        on the checker source, not a check on the transcript.',
    ]],
    cases,
  };
}

// ---------------------------------------------------------------- harness
const SUITES = [
  jsonSuite,
  mpSuite(join(HERE, 'live-mp-chrome', 'console.log'), 'chrome'),
  mpSuite(join(HERE, 'live-mp-firefox', 'console.log'), 'firefox'),
];

let bad = 0;
let total = 0;
const tmp = mkdtempSync(join(tmpdir(), 'm5-prove-'));

function runChecker(checker, file, idRe) {
  const r = spawnSync(process.execPath, [checker, file], { encoding: 'utf8' });
  if (r.error) throw r.error;
  const failed = [];
  const passed = [];
  for (const m of r.stdout.matchAll(idRe)) (m[1] === 'FAIL' ? failed : passed).push(m[2]);
  return { status: r.status, failed, passed, stdout: r.stdout, stderr: r.stderr };
}

const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
                                            && b.every((x) => a.includes(x));

try {
  for (const s of SUITES) {
    console.log(`==== ${s.name}`);
    console.log(`checker : ${s.checker}`);
    console.log(`source  : ${s.source}`);
    console.log('');

    // A check on the PROVER, not on the checker: mutating an input that was
    // already failing would prove nothing at all.
    const base = runChecker(s.checker, s.source, s.idRe);
    const baseOk = base.status === 0 && base.failed.length === 0;
    console.log(`${baseOk ? 'ok  ' : 'BAD '} baseline: the unmutated input passes `
      + `(exit ${base.status}, ${base.passed.length} checks, ${base.failed.length} failures)`);
    if (!baseOk) {
      console.log('      cannot prove anything by mutating an input that already fails.');
      console.log(base.stdout);
      process.exit(2);
    }
    console.log('');

    let n = 0;
    for (const c of s.cases) {
      total++;
      const doc = s.load(s.source);
      const out = c.apply(doc) || doc;
      const file = join(tmp, `case-${n++}${s.ext}`);
      s.save(out, file);
      const r = runChecker(s.checker, file, s.idRe);
      const ok = r.status === 1 && same(r.failed, c.expect);
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'BAD '} ${c.name}`);
      console.log(`       expected FAIL: ${c.expect.join(' ')}`
        + `   observed: ${r.failed.join(' ') || '(none)'}   exit ${r.status}`);
      if (c.why) console.log(`       ${c.why}`);
    }

    for (const rc of s.realControls || []) {
      total++;
      const r = runChecker(s.checker, rc.file, s.idRe);
      const ok = r.status === 1 && same(r.failed, rc.expect);
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'BAD '} REAL CONTROL (not a mutation): ${rc.what}`);
      console.log(`       ${rc.file}`);
      console.log(`       expected FAIL: ${rc.expect.join(' ')}`
        + `   observed: ${r.failed.join(' ') || '(none)'}   exit ${r.status}`);
    }

    console.log('');
    for (const [id, why] of s.notCoverable || []) {
      console.log(`--   ${id}   NOT COVERABLE, by design.`);
      console.log(`        ${why}`);
    }
    const withCollateral = s.cases.filter((c) => c.expect.length > 1).length;
    console.log('');
    console.log(`Cases declaring collateral (expect > 1 id): ${withCollateral} of ${s.cases.length}.`);
    console.log('');
  }

  console.log('THE LIVE CONTROLS, which are stronger than any mutation above, and which are');
  console.log('recorded in wire-facts.json in the same run as the facts they control for:');
  console.log('  W9    a filename that does not exist, fetched from the real deployment.');
  console.log('        It answers 404 text/html -- so W1 is a fact about the file and not');
  console.log('        a fact about the host, and the status-vs-content-type trap is not');
  console.log('        hypothetical: the status is 404 in BOTH the healthy and the broken');
  console.log('        world, which is what W9a demonstrates.');
  console.log('  W10   a real "Accept-Encoding: br" request to the real 4.3 MB wasm.');
  console.log('  W11   a real browser Accept-Encoding to the same file, in the same run.');
  console.log('');
  console.log(bad === 0
    ? `RESULT: PASS -- all ${total} cases flipped exactly the checks they declared`
    : `RESULT: FAIL -- ${bad} of ${total} case(s) did not behave as declared`);
  process.exit(bad === 0 ? 0 : 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
