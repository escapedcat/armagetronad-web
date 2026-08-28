#!/usr/bin/env node
// The Firefox half of web/tools/drive-browser.mjs: same idea, same step
// vocabulary, different wire protocol.
//
// WHY THIS IS A SEPARATE FILE
// ---------------------------
// Firefox removed its CDP implementation in Firefox 129, so drive-browser.mjs
// cannot talk to it at all. What Firefox 154 speaks instead is WebDriver BiDi,
// on the same --remote-debugging-port but at ws://host:port/session, and BiDi
// is a different protocol rather than a dialect: commands are named
// module.method, every command needs an explicit browsing context, and input
// is a WebDriver action sequence rather than a synthesised DOM event. Sharing
// one file would have meant an abstraction layer over two protocols that agree
// on almost nothing; two ~200-line files that each do one thing plainly are
// easier to read and to fix.
//
// No dependencies: Node 22's global WebSocket, same as the Chrome driver. No
// geckodriver, no selenium -- BiDi is served by Firefox itself.
//
// USAGE
//   python3 -m http.server 8000 --directory web/dist-m1 &
//   node web/tools/drive-firefox.mjs --out /tmp/shots \
//        --script 'wait:2000,click:#start,wait:20000,shot:booted'
//
// Options and steps are the same as drive-browser.mjs (--url, --out, --script,
// --script-file, --headed, --port, --width, --height, --firefox, --keep-open;
// steps wait/shot/click/key/eval/mark/until). Unlike Chrome, key events work in
// headless mode here, so --headed is only needed to watch it happen.
//
// WEBGL WARNINGS: WHAT WAS MISSING AND WHAT FIXED IT
// --------------------------------------------------
// M1's Firefox transcript contained no WebGL diagnostics at all and was read
// as a clean run; docs/porting/browser-runtime-notes.md section 9 records that
// this was a harness artifact rather than evidence. Two separate causes, both
// fixed here, and there is a positive control in
// web/tools/gameplay-gate.steps that proves the fix rather than asserting it:
//
//  1. THE LABELLING. Firefox does deliver its WebGL warnings over BiDi -- they
//     reach the console service as nsIScriptError and come out of
//     log.entryAdded with type "javascript". But this file used to print EVERY
//     type:"javascript" entry as "[EXCEPTION]" and ignore entry.level, so a
//     warning would have been reported as an exception (and a run with a
//     WebGL warning would have "failed" for the wrong reason). Now the level
//     decides, and non-error entries are printed in Chrome's
//     "[browser.LEVEL/SOURCE]" shape so the two transcripts read alike.
//
//  2. THE CAP. Firefox stops reporting after webgl.max-warnings-per-context
//     warnings per context (32 by default) and then goes quiet forever. On a
//     page that runs for minutes that silence is indistinguishable from a
//     clean run, which is exactly the mistake M1 made. The profile written
//     below raises the cap, so silence means silence.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function parseArgs(argv) {
  const opt = {
    url: 'http://localhost:8000/armagetronad.html',
    out: 'web-evidence-firefox',
    steps: 'wait:2000,shot:00-loading,click:#start,wait:20000,shot:01-booted'.split(','),
    headed: false,
    port: 9333,
    width: 1024,
    height: 768,
    firefox: '/Applications/Firefox.app/Contents/MacOS/firefox',
    keepOpen: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') opt.url = next();
    else if (a === '--out') opt.out = next();
    else if (a === '--script') opt.steps = next().split(',');
    else if (a === '--script-file') opt.steps = readFileSync(next(), 'utf8').split('\n');
    else if (a === '--headed') opt.headed = true;
    else if (a === '--keep-open') opt.keepOpen = true;
    else if (a === '--port') opt.port = Number(next());
    else if (a === '--width') opt.width = Number(next());
    else if (a === '--height') opt.height = Number(next());
    else if (a === '--firefox') opt.firefox = next();
    else throw new Error(`unknown option: ${a}`);
  }
  return opt;
}

// WebDriver's key values live in a private-use Unicode block; a raw 'ArrowDown'
// string would be typed as ten literal characters.
const KEYS = {
  Up: '', Down: '', Left: '', Right: '',
  Enter: '', Escape: '', Tab: '', Space: ' ',
};
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') KEYS[c] = c.toLowerCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BiDi {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.type === 'error') p.reject(new Error(`${p.method}: ${msg.error}: ${msg.message}`));
        else p.resolve(msg.result);
      } else if (msg.type === 'event') {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  static async connect(url, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const ws = new WebSocket(url);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', () => rej(new Error('not up yet')), { once: true });
        });
        return new BiDi(ws);
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`Firefox BiDi never came up at ${url}`);
        await sleep(200);
      }
    }
  }
  on(fn) { this.handlers.push(fn); }
  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

// BiDi hands back RemoteValues: primitives have .value, objects only .type.
function remoteToString(v) {
  if (!v) return String(v);
  if (v.type === 'string' || v.type === 'number' || v.type === 'boolean') return String(v.value);
  if (v.type === 'undefined' || v.type === 'null') return v.type;
  if (v.value !== undefined) return JSON.stringify(v.value);
  return v.type;
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  mkdirSync(opt.out, { recursive: true });
  const logPath = join(opt.out, 'console.log');
  writeFileSync(logPath, '');

  const profileDir = mkdtempSync(join(tmpdir(), 'aa-firefox-'));
  // user.js is read on every profile start and its values win over prefs.js,
  // so this needs no profile to exist yet -- Firefox creates the rest around
  // it. See the WEBGL WARNINGS note in this file's header for why the cap
  // matters: left at its default of 32 the browser falls silent partway
  // through a run and the transcript stops being evidence.
  writeFileSync(join(profileDir, 'user.js'),
    'user_pref("webgl.max-warnings-per-context", 100000);\n');
  const args = [
    '--remote-debugging-port', String(opt.port),
    '--profile', profileDir,
    '--no-remote',            // do not hand the URL to an already-running Firefox
    '--width', String(opt.width),
    '--height', String(opt.height),
    'about:blank',
  ];
  if (!opt.headed) args.unshift('--headless');

  const firefox = spawn(opt.firefox, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const ffOutput = [];
  firefox.stderr.on('data', (d) => ffOutput.push(d.toString()));
  firefox.stdout.on('data', (d) => ffOutput.push(d.toString()));

  let exitCode = 0;
  let bidi;
  let startedAt = Date.now();
  // Kept in memory so `until:` can count matches against exactly the
  // transcript that gets committed. See drive-browser.mjs for the rationale.
  const transcript = [];
  const record = (line) => {
    const stamped = `[${String(Date.now() - startedAt).padStart(7)}ms] ${line}`;
    transcript.push(stamped);
    process.stdout.write(stamped + '\n');
    appendFileSync(logPath, stamped + '\n');
  };
  // Harness-written lines are excluded so an `until:`/`mark:`/`eval:` echo of
  // the needle cannot satisfy the wait it is part of.
  const countMatches = (needle) =>
    transcript.reduce((n, l) => n + (!l.includes('] [harness] ') && l.includes(needle) ? 1 : 0), 0);

  try {
    bidi = await BiDi.connect(`ws://127.0.0.1:${opt.port}/session`);
    const session = await bidi.send('session.new', { capabilities: {} });
    const tree = await bidi.send('browsingContext.getTree', {});
    const context = tree.contexts[0].context;

    // log.entryAdded carries console.* calls AND uncaught JS errors, which in
    // CDP are two separate domains.
    //
    // network.responseCompleted / network.fetchError have no CDP-side
    // counterpart here: Chrome surfaces failed loads through Log.entryAdded
    // for free, Firefox does not surface them at all unless you subscribe.
    // Without this the gate's "every 404 in a passing transcript is
    // /favicon.ico" rule was silently unenforceable on Firefox, because the
    // transcript contained no network lines whatsoever to check it against.
    await bidi.send('session.subscribe', {
      events: [
        'log.entryAdded',
        'browsingContext.load',
        'network.responseCompleted',
        'network.fetchError',
      ],
    });
    bidi.on((msg) => {
      if (msg.method === 'log.entryAdded') {
        const e = msg.params;
        if (e.type === 'javascript') {
          // Everything the browser itself reports about the page arrives here,
          // not only uncaught exceptions: WebGL warnings, CSS complaints,
          // deprecation notices. Only level "error" is an exception; calling
          // the rest "[EXCEPTION]" (as this did through M1) both hides what
          // they are and breaks the gate's "no [EXCEPTION] in the transcript"
          // criterion for something that is not one.
          if (e.level === 'error') {
            record(`[EXCEPTION] ${e.text}\n${(e.stackTrace?.callFrames ?? [])
              .map((f) => `    ${f.functionName || '<anonymous>'} @ ${f.url}:${f.lineNumber}`).join('\n')}`);
          } else {
            // Chrome's shape, so the two engines' transcripts can be diffed.
            const where = e.stackTrace?.callFrames?.[0]?.url ?? e.source?.realm;
            record(`[browser.${e.level}/javascript] ${e.text}`
                   + (where ? `   <- ${where}` : ''));
          }
        } else {
          const args = (e.args ?? []).map(remoteToString).join(' ');
          record(`[console.${e.method ?? e.level}] ${args || e.text}`);
        }
      } else if (msg.method === 'browsingContext.load') {
        record('[page] load event fired');
      } else if (msg.method === 'network.responseCompleted') {
        // Only the failures. Logging every 200 would bury the transcript in
        // the game's own asset fetches, and a 200 proves nothing the gate asks.
        const { request, response } = msg.params;
        if (response && response.status >= 400) {
          record(`[browser.error/network] ${response.status} ${response.statusText || ''} `
                 + `<- ${request?.url ?? response.url}`);
        }
      } else if (msg.method === 'network.fetchError') {
        const { request, errorText } = msg.params;
        record(`[browser.error/network] fetch failed (${errorText}) <- ${request?.url}`);
      }
    });

    // --width/--height size the WINDOW, so the content viewport comes out
    // shorter by the height of the browser chrome -- 1024x683 against Chrome's
    // 1024x768, which crops the bottom of every screenshot and makes the two
    // engines' evidence not comparable side by side. setViewport sets the
    // content box directly, which is what Emulation.setDeviceMetricsOverride
    // does on the CDP side.
    await bidi.send('browsingContext.setViewport', {
      context, viewport: { width: opt.width, height: opt.height }, devicePixelRatio: 1,
    });

    record(`[harness] firefox: ${session.capabilities.browserVersion} (headless=${!opt.headed})`);
    record(`[harness] navigating to ${opt.url}`);
    startedAt = Date.now();
    await bidi.send('browsingContext.navigate', { context, url: opt.url, wait: 'complete' });

    const evaluate = (expression) => bidi.send('script.evaluate', {
      expression, target: { context }, awaitPromise: true, resultOwnership: 'none',
    });

    const steps = opt.steps.map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    for (const rawStep of steps) {
      const [verb, ...rest] = rawStep.split(':');
      const arg = rest.join(':');
      switch (verb) {
        case 'wait':
          await sleep(Number(arg));
          break;
        case 'mark':
          record(`[harness] === ${arg} ===`);
          break;
        case 'shot': {
          const { data } = await bidi.send('browsingContext.captureScreenshot', { context });
          const file = join(opt.out, `${arg}.png`);
          writeFileSync(file, Buffer.from(data, 'base64'));
          record(`[harness] screenshot -> ${file}`);
          break;
        }
        case 'click': {
          const r = await evaluate(
            `(() => { const e = document.querySelector(${JSON.stringify(arg)});
                      if (!e) return 'NOT FOUND';
                      if (e.disabled) return 'DISABLED';
                      e.click(); return 'clicked'; })()`);
          record(`[harness] click ${arg}: ${remoteToString(r.result)}`);
          break;
        }
        case 'key': {
          const [name, countStr] = arg.split(':');
          const value = KEYS[name];
          if (!value) throw new Error(`unknown key: ${name}`);
          const count = Number(countStr || 1);
          for (let i = 0; i < count; i++) {
            await bidi.send('input.performActions', {
              context,
              actions: [{
                type: 'key', id: 'keyboard',
                actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }],
              }],
            });
            record(`[harness] key ${name} (${i + 1}/${count})`);
            await sleep(300);
          }
          break;
        }
        case 'eval': {
          const r = await evaluate(arg);
          record(`[harness] eval ${arg} => ${remoteToString(r.result)}`);
          break;
        }
        case 'until': {
          // until:N:MS:TEXT. Identical semantics to drive-browser.mjs, which
          // carries the explanation of why this directive exists at all.
          const m = /^(\d+):(\d+):([\s\S]+)$/.exec(arg);
          if (!m) throw new Error(`until needs N:MS:TEXT, got: ${arg}`);
          const [, wantStr, msStr, needle] = m;
          const want = Number(wantStr), deadline = Date.now() + Number(msStr);
          record(`[harness] until ${want}x <<${needle}>> (timeout ${msStr}ms, have ${countMatches(needle)})`);
          let got = countMatches(needle);
          while (got < want && Date.now() < deadline) {
            await sleep(100);
            got = countMatches(needle);
          }
          if (got >= want) record(`[harness] until SATISFIED: saw ${got}x <<${needle}>>`);
          else record(`[harness] until TIMED OUT after ${msStr}ms: saw ${got}x <<${needle}>>, wanted ${want}`);
          break;
        }
        default:
          throw new Error(`unknown step: ${rawStep}`);
      }
    }

    if (opt.keepOpen) {
      record('[harness] --keep-open: leaving Firefox up, ctrl-c to stop');
      await new Promise(() => {});
    }
  } catch (err) {
    record(`[harness] FAILED: ${err.stack || err}`);
    if (ffOutput.length) record(`[harness] firefox said:\n${ffOutput.join('')}`);
    exitCode = 1;
  } finally {
    try { bidi?.close(); } catch { /* ignore */ }
    firefox.kill('SIGTERM');
    await sleep(500);
    firefox.kill('SIGKILL');
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    console.log(`\nTranscript: ${logPath}`);
  }
  process.exit(exitCode);
}

main();
