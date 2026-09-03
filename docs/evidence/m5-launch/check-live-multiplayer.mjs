#!/usr/bin/env node
// Arbitrate a run of web/tools/https-multiplayer.steps AGAINST THE PUBLIC
// DEPLOYMENT. This is the piece M5 task 3 could not do and explicitly handed
// forward: every number in that task came from a self-signed local rig, and it
// asked task 5 to re-run the same script against real Pages and confirm the
// attempt count lands in the 97-100 band it measured.
//
//   node docs/evidence/m5-launch/check-live-multiplayer.mjs <console.log>
//
// Exit 0 if every check passes, 1 otherwise. Derived from the transcript file
// alone -- no network, no other file -- which is what lets the prover flip any
// single check by editing one line.
//
// TWO EXISTING PASS CRITERIA WOULD MISFIRE ON THIS ROUTE, AND BOTH ARE HANDLED
// BY NAME RATHER THAN BY LOOSENING THE RULE. Task 3 measured both:
//
//   1. FIREFOX RECORDS EVERY BLOCKED ATTEMPT AS `[EXCEPTION]` -- 194 lines over
//      https, two distinct texts per attempt -- and every gate this project has
//      written forbids `[EXCEPTION]` outright. X8 does NOT drop that rule. It
//      keeps it and permits exactly two texts, quoted verbatim below, and only
//      on lines that also name a `ws://` endpoint. Any third text still fails.
//
//   2. FIREFOX PRINTS NO MIXED-CONTENT MESSAGE AT ALL. It says "Firefox can't
//      establish a connection to the server at ws://...", which is the same
//      sentence it uses for an ordinary network failure. So a gate that
//      grepped for "Mixed Content" would read Firefox as NOT BLOCKING when it
//      is. X9 asserts that engine-specific shape instead of grepping, and says
//      so in its own output.
//
// WHAT THIS CHECKER DOES NOT RE-DERIVE. That the https attempts are BLOCKED
// rather than merely failing is task 3's finding, established there by the
// scheme differential on one build and one script -- 19 attempts in Chrome and
// 27 in Firefox over http:, against 97-100 over https: -- plus a hostname
// control (https://demo.example, 100) and a certificate control (deliberate
// cert-error state, 100). A single https transcript cannot show a differential,
// and nothing here pretends to.

import { readFileSync } from 'node:fs';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: check-live-multiplayer.mjs <console.log>');
  process.exit(2);
}
const text = readFileSync(SRC, 'utf8');
const lines = text.split('\n');

// Harness echoes of an `eval:` step contain the payload verbatim, so any
// pattern search over the transcript has to exclude them or it finds its own
// probe. Same rule check-transcript.mjs uses.
const isHarness = (l) => l.includes('] [harness] ');
const pageLines = lines.filter((l) => !isHarness(l));

// The two texts Firefox emits, one pair per blocked attempt. Quoted as
// substrings, deliberately avoiding Firefox's typographic apostrophe in
// "can't" so the match does not hinge on a U+2019.
const ALLOWED_EXCEPTIONS = [
  'establish a connection to the server at ws://',
  'was interrupted while the page was loading.',
];

// ---------------------------------------------------------------- parsing
// A harness eval line ends in ` => <result>`. Chrome's results arrive
// JSON-encoded (so a JSON payload comes back double-escaped) and Firefox's
// arrive raw; both shapes are accepted.
function evalResult(needle) {
  const l = lines.find((x) => isHarness(x) && x.includes(needle) && x.includes(' => '));
  if (!l) return null;
  let r = l.slice(l.lastIndexOf(' => ') + 4).trim();
  if (r.startsWith('"') && r.endsWith('"')) {
    try { r = JSON.parse(r); } catch { r = r.slice(1, -1).replace(/\\"/g, '"'); }
  }
  return r;
}
function evalJson(needle) {
  const r = evalResult(needle);
  if (r == null) return null;
  try { return JSON.parse(r); } catch { return null; }
}
const first = (re) => { for (const l of lines) { const m = l.match(re); if (m) return m; } return null; };

const engineLine = first(/\[harness\] (chrome|firefox): (.+)$/);
const engine = engineLine ? engineLine[1] : null;
const engineVer = engineLine ? engineLine[2].trim() : null;
const navUrl = (first(/\[harness\] navigating to (\S+)/) || [])[1] || null;
const originMsg = evalResult('WebSocket counter installed');
const summary = evalJson('"spanMs"') || evalJson('spanMs');
const perUrl = evalJson('for(const e of window.__wsLog)') || null;
const beforeStr = evalResult('ws attempts before the master query');
const totalStr = evalResult('ws attempts total');
const aliveStr = evalResult("alive, gl err=0x") || (first(/alive, gl err=0x([0-9a-f]+)/) || [])[0];

const nBefore = beforeStr ? Number(String(beforeStr).replace(/\D+/g, '')) : null;
const nTotal = totalStr ? Number(String(totalStr).replace(/\D+/g, '')) : null;

// X3 and X9 read DIFFERENT substrings of what is, in Chrome, the same line,
// and that separation is deliberate. X3 wants "the browser recorded one event
// per attempt" and counts the clause that states the endpoint was refused; X9
// wants "did the phrase a naive gate would grep for actually appear", and
// counts that phrase alone. Reading both off /mixed content/i would have
// welded the two checks together so that no mutation could exercise either on
// its own -- which is the defect M4 task 3's review found and this milestone
// is not repeating.
const BLOCKED_CLAUSE = {
  chrome: 'this endpoint must be available over WSS',
  firefox: 'establish a connection to the server at ws://',
};
const mixedLines = pageLines.filter((l) => /mixed content/i.test(l));
const exceptionLines = pageLines.filter((l) => l.includes('[EXCEPTION]'));

let failures = 0;
const ran = [];
function check(id, cond, msg) {
  ran.push(id);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${id.padEnd(4)} ${msg}`);
  if (!cond) failures++;
}
function note(msg) { console.log(`note  ${msg}`); }

console.log(`== ${SRC}`);
console.log(`   engine ${engine} ${engineVer}`);
console.log(`   url    ${navUrl}`);
console.log(`   ${lines.length} lines, ${pageLines.length} of them not harness echoes`);
console.log('');

// ------------------------------------- X1. this ran against the real thing
// Two independent statements of the same fact: the URL the driver was told to
// open, and the scheme the PAGE reported about itself from inside the wasm's
// own document. Task 3's whole open question was that its numbers came from
// localhost over a self-signed certificate.
check('X1', navUrl != null && /^https:\/\/escapedcat\.github\.io\//.test(navUrl)
            && typeof originMsg === 'string' && originMsg.endsWith('page origin is https:'),
      `the transcript is a run against the public https deployment `
      + `(driver: ${navUrl}; page: "${originMsg}")`);

// ------------------------------------------- X2. TASK 3'S HANDOVER, settled
// THE BAND IS 96-100 AND THAT WIDENS TASK 3'S BY ONE, ON A MEASURED BASIS.
// Task 3 said 97-100 and asked task 5 to confirm the live count lands there.
// It very nearly does -- four of this task's five live runs are inside it --
// but one Firefox run against the real deployment returned 96, and 96 is not
// an anomaly: it is the floor of the mechanism.
//
// Every https run this project has recorded queries FOUR masters
// (config/master.srv) and makes 24 or 25 attempts to EACH. That holds in all
// nine: task 3's four on the local rig ({25,24,24,25}=98, {25,24,24,24}=97,
// {25,25,25,25}=100 twice) and this task's five against Pages
// ({25,25,25,25}=100, {25,24,25,24}=98 twice, {25,25,24,25}=99,
// {24,24,24,24}=96). So the reachable totals are 4x24=96 through 4x25=100,
// and task 3's 97 was the minimum of four samples rather than the minimum of
// the mechanism. Widening the floor by one is not loosening the check: what it
// asserts -- ~25 blocked retries per master, four masters, and nothing else --
// is unchanged, and 19 (the http: figure) or 0 still fail it.
{
  const a = summary ? summary.attempts : null;
  check('X2', a != null && a >= 96 && a <= 100,
        `the module made ${a} ws:// connection attempts, inside the 96-100 band `
        + `(4 masters x 24-25 attempts each) -- reproduced against the real deployment, `
        + `which is what completes task 3`);
}

// ------------------------- X3. counted twice, by things that cannot both slip
// In-page: the steps file wraps window.WebSocket before callMain, so this is
// the count of attempts the wasm MADE, whatever the browser then logged.
// Browser: Chrome emits one "Mixed Content ... blocked" line per attempt;
// Firefox emits one "can't establish a connection" line per attempt (its second
// text is counted separately -- see X9).
{
  const a = summary ? summary.attempts : null;
  const clause = BLOCKED_CLAUSE[engine] || BLOCKED_CLAUSE.chrome;
  const browserCount = pageLines.filter((l) => l.includes(clause)).length;
  const what = `browser lines saying "...${clause}..."`;
  check('X3', a != null && browserCount === a,
        `two independent counts agree: ${a} from the in-page WebSocket wrapper, `
        + `${browserCount} ${what} from the browser`);
  console.log(`       and the totals bracket the query: ${nBefore} attempts BEFORE the master `
    + `query was started, ${nTotal} after the menu was dismissed twice`);
}

// -------------------------- X4. every attempt went to a master, and only four
// `addPeer` keys sock.peers by addr+':'+port, so the re-created peers replace
// each other and the map holds at most four -- which is why ~100 attempts do
// not accumulate into ~100 live sockets.
{
  const urls = perUrl ? Object.keys(perUrl) : [];
  const allMaster = urls.length > 0
    && urls.every((u) => /^ws:\/\/master\d\.armagetronad\.(org|net):4533\/$/.test(u));
  check('X4', urls.length === 4 && allMaster && summary && summary.distinctUrls === 4,
        `all attempts went to exactly 4 distinct ws:// master endpoints`
        + (urls.length ? '' : ' -- none found'));
  for (const u of urls.sort()) console.log(`       ${String(perUrl[u]).padStart(3)}  ${u}`);
}

// --------------------------------- X5. the wall clock is the master timeout
// Task 3 pinned this: sn_Connect's tSysTimeFloat()+5 (nNetwork.cpp), once per
// master, four masters in config/master.srv = 20 s. It is 20 s and not the 26 s
// the plan carried. The band is deliberately wide; the point is that the
// duration is set by the timeout and not by how the socket fails.
{
  const s = summary ? summary.spanMs / 1000 : null;
  check('X5', s != null && s >= 18 && s <= 22,
        `first attempt to last spans ${s?.toFixed(2)}s (band 18-22s) -- 4 masters x `
        + `sn_Connect's 5s timeout, not the 26s the plan states`);
}

// -------------------------------------- X6. the noise is bounded, not endless
check('X6', nBefore === 0 && nTotal != null && summary != null && nTotal === summary.attempts,
      `nothing was attempted before the master query (${nBefore}) and nothing more was `
      + `attempted after it (${nTotal} total vs ${summary?.attempts} at the end of the query) `
      + `-- the ~100 lines are bounded and stop when the fourth master times out`);

// ---------------------------------------- X7. the client is alive afterwards
// The point of the whole route: the Demo's multiplayer menu must FAIL
// GRACEFULLY, not take the tab with it.
check('X7', aliveStr != null && /alive, gl err=0x0$/.test(String(aliveStr)),
      `after both dismissals the canvas still has a live GL context with no error `
      + `("${aliveStr}")`);

// ------------------ X8. console cleanliness, with the two texts allowed BY TEXT
{
  const HAZARDS = ['Stack overflow', 'SDL event queue full', 'Assertion',
                   'targetCrashed', 'renderer crashed', '[GLERR]'];
  const hits = [];
  for (const h of HAZARDS) {
    const n = pageLines.filter((l) => l.includes(h)).length;
    if (n) hits.push(`${h} x${n}`);
  }
  const stray = exceptionLines.filter(
    (l) => !(l.includes('ws://') && ALLOWED_EXCEPTIONS.some((t) => l.includes(t))));
  check('X8', hits.length === 0 && stray.length === 0,
        `no forbidden text in the run, and all ${exceptionLines.length} [EXCEPTION] lines are `
        + `one of the TWO permitted mixed-content texts on a ws:// endpoint`
        + (hits.length ? ` -- found: ${hits.join(', ')}` : '')
        + (stray.length ? ` -- ${stray.length} stray exception(s)` : ''));
  for (const s of stray.slice(0, 3)) console.log(`        ${s.trim().slice(0, 160)}`);
  console.log('       permitted, verbatim:');
  for (const t of ALLOWED_EXCEPTIONS) console.log(`         "...${t}..."`);
  console.log('       The rule is NOT loosened: a third text, or either text on a line that');
  console.log('       does not name a ws:// endpoint, still fails.');
  if (exceptionLines.length === 0) {
    note('this engine emitted no [EXCEPTION] at all. https-multiplayer.steps has no');
    note('  deliberate-error control, so that zero is not by itself proof the channel');
    note('  works -- the same driver\'s gameplay-gate run in this session does carry');
    note('  that control, and the other engine\'s transcript here is full of them.');
  }
}

// ---------------------------- X9. THE GREP TRAP, asserted rather than grepped
// This check owns ONE number and nothing else: how many lines contain the
// phrase "Mixed Content". X3 above owns the per-attempt equality. Keeping them
// apart is what lets each be exercised on its own.
{
  const a = summary ? summary.attempts : null;
  if (engine === 'firefox') {
    check('X9', mixedLines.length === 0,
          `Firefox produced ${mixedLines.length} lines matching /mixed content/i while `
          + `${a} attempts were stopped -- so a gate that grepped for "Mixed Content" `
          + `would conclude Firefox is NOT blocking. It is: task 3's scheme differential `
          + `is 27 attempts over http: against 97 over https:, same build, same script`);
    note('this is a POSITIVE assertion that the message is absent, not an oversight.');
    note('  Firefox\'s text for a blocked mixed-content WebSocket is the same sentence it');
    note('  uses for an ordinary connection failure, so the phrase never appears.');
  } else {
    check('X9', mixedLines.length > 0,
          `Chrome names the cause in so many words: ${mixedLines.length} lines matching `
          + `/mixed content/i. This is the engine where the grep WOULD work, which is `
          + `exactly why the Firefox half of this gate must not rely on it`);
  }
}

// --------------------------------------------- X10. nothing silently expired
{
  const to = lines.filter((l) => l.includes('until TIMED OUT'));
  check('X10', to.length === 0,
        `no "until TIMED OUT" anywhere in the file (${to.length} hits) -- the driver `
        + `records this and keeps going, so it is the only sign of a wait that never came`);
  for (const h of to.slice(0, 3)) console.log(`        ${h.trim().slice(0, 160)}`);
}

// --------------------------------------------------- X11. no unexpected 404s
{
  const notFound = pageLines.filter((l) => /\b404\b/.test(l));
  const bad = notFound.filter((l) => !l.includes('favicon.ico'));
  check('X11', bad.length === 0,
        `every 404 is /favicon.ico (${notFound.length} total, ${bad.length} other) -- the `
        + `browser asks for it once per navigation and the deployment has none`);
  for (const h of bad.slice(0, 3)) console.log(`        ${h.trim().slice(0, 160)}`);
}

// ---------------------------------------------------------- XZ coverage guard
{
  const DECLARED = ['X1','X2','X3','X4','X5','X6','X7','X8','X9','X10','X11'];
  console.log('');
  check('XZ', ran.length === DECLARED.length && DECLARED.every((d) => ran.includes(d)),
        `every declared check ran: ${DECLARED.length} declared, ${ran.length} executed`);
}

console.log('');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
