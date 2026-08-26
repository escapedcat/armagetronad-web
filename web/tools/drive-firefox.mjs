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
// steps wait/shot/click/key/eval/mark). Unlike Chrome, key events work in
// headless mode here, so --headed is only needed to watch it happen.

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
  const record = (line) => {
    const stamped = `[${String(Date.now() - startedAt).padStart(7)}ms] ${line}`;
    process.stdout.write(stamped + '\n');
    appendFileSync(logPath, stamped + '\n');
  };

  try {
    bidi = await BiDi.connect(`ws://127.0.0.1:${opt.port}/session`);
    const session = await bidi.send('session.new', { capabilities: {} });
    const tree = await bidi.send('browsingContext.getTree', {});
    const context = tree.contexts[0].context;

    // log.entryAdded carries console.* calls AND uncaught JS errors, which in
    // CDP are two separate domains.
    await bidi.send('session.subscribe', { events: ['log.entryAdded', 'browsingContext.load'] });
    bidi.on((msg) => {
      if (msg.method === 'log.entryAdded') {
        const e = msg.params;
        if (e.type === 'javascript') {
          record(`[EXCEPTION] ${e.text}\n${(e.stackTrace?.callFrames ?? [])
            .map((f) => `    ${f.functionName || '<anonymous>'} @ ${f.url}:${f.lineNumber}`).join('\n')}`);
        } else {
          const args = (e.args ?? []).map(remoteToString).join(' ');
          record(`[console.${e.method ?? e.level}] ${args || e.text}`);
        }
      } else if (msg.method === 'browsingContext.load') {
        record('[page] load event fired');
      }
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
