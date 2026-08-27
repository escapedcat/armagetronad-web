#!/usr/bin/env node
// Drive the wasm client in a real browser and record what it does.
//
// WHY THIS EXISTS
// ---------------
// The page cannot be verified with a plain screenshot: web/shell.html only
// calls Module.callMain() from the Play button, so nothing runs until
// something clicks it. And a headless browser has no GPU, so a WebGL context
// is only obtainable if Chrome is told to rasterise in software. Both of
// those are one-line flags, but neither is discoverable from the page itself,
// which is why this harness is committed rather than retyped each time.
//
// It speaks the Chrome DevTools Protocol over a WebSocket. Node 22 has a
// global WebSocket, so this file has NO dependencies -- no Playwright, no
// Puppeteer, no `npm install`. Run it with plain `node`.
//
// USAGE
//   python3 -m http.server 8000 --directory web/dist-m1 &
//   node web/tools/drive-browser.mjs --out /tmp/shots \
//        --script 'wait:2000,shot:loaded,click:#start,wait:20000,shot:booted'
//
// OPTIONS
//   --url URL          page to open (default http://localhost:8000/armagetronad.html)
//   --out DIR          where screenshots and console.log land (default ./web-evidence)
//   --script STEPS     comma-separated step list, see below (default: load + click + shot)
//   --script-file F    same steps, one per line (# comments allowed). Use this
//                      whenever a step contains a comma, e.g. any eval: step.
//   --headed           run with a visible window instead of --headless=new.
//                      REQUIRED for the key: steps -- see the warning below.
//   --port N           devtools port (default 9222)
//   --width/--height N canvas/window size (default 1024x768)
//   --chrome PATH      Chrome binary (default: macOS Google Chrome)
//   --keep-open        leave the browser running after the script (for poking at it)
//
// STEPS (executed in order)
//   wait:MS               sleep
//   shot:NAME             screenshot to OUT/NAME.png
//   click:SELECTOR        element.click() in page context
//   key:NAME              dispatch a real key press (see KEYS below), e.g. key:Down
//   key:NAME:N            press it N times, 150ms apart
//   eval:EXPR             Runtime.evaluate an expression, print the result
//   mark:TEXT             write a marker line into the console transcript
//   until:N:MS:TEXT       block until TEXT has appeared in N transcript lines,
//                         or MS milliseconds elapse. Records which happened.
//
// WHY `until` EXISTS (the only directive M2 added). A gameplay script cannot
// be written in `wait:` alone the way a menu script can. A menu keystroke has
// a fixed, tiny latency; a ROUND of Armagetron ends when a cycle hits a wall,
// which is a different duration every run and depends on how the AIs play. The
// M1 vocabulary could only express that as a `wait:` long enough for the worst
// case, which makes the script both slow and -- much worse -- unable to tell
// "the round ended" from "the round hung and I waited long enough anyway".
// `until:` turns the transcript the harness is already collecting into a
// synchronisation source, so the script says what it is waiting FOR, and a
// timeout is a visible failure rather than a silently-passed `wait:`.
//
// The N is a COUNT of matching lines, not a flag, because the events this
// waits on repeat: "the third [L] ROUND_WINNER" is the statement M2's gate
// needs, and it is not the same statement as "a [L] ROUND_WINNER".
//
// Everything the page logs (console.*, uncaught exceptions, and browser-level
// Log entries such as WebGL warnings) is streamed to stdout AND written to
// OUT/console.log with millisecond timestamps relative to navigation.
//
// KEY EVENTS NEED --headed ON CHROME 152 HEADLESS
// -----------------------------------------------
// Measured, not guessed: in --headless=new, a single Input.dispatchKeyEvent is
// followed by *thousands* of extra trusted keydown events with key
// "Unidentified" and an arbitrary keyCode (75, 87, ... -- it varies per run).
// They arrive whether or not the wasm module is running (reproduced on the
// bare page with the Play button never clicked), so they are a browser
// artifact, not something this application does. They swamp Emscripten's SDL
// event queue -- it caps at 10000 and then logs "SDL event queue full,
// dropping events" forever -- and the real keystroke is lost in the flood, so
// the game appears to ignore all input. The same script under --headed
// delivers exactly one keydown and one keyup.
//
// Not caused by anything this harness sets: also reproduced with
// Emulation.setDeviceMetricsOverride removed.
//
// So: --headless is fine for booting the page, capturing console output and
// screenshotting. Anything that presses a key must run --headed.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opt = {
    url: 'http://localhost:8000/armagetronad.html',
    out: 'web-evidence',
    steps: 'wait:2000,shot:00-loading,click:#start,wait:20000,shot:01-booted'.split(','),
    headed: false,
    port: 9222,
    width: 1024,
    height: 768,
    chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    keepOpen: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') opt.url = next();
    else if (a === '--out') opt.out = next();
    else if (a === '--script') opt.steps = next().split(',');
    // A script FILE is one step per line, so a step may contain commas --
    // which `eval:` steps invariably do, and which --script cannot express.
    else if (a === '--script-file') opt.steps = readFileSync(next(), 'utf8').split('\n');
    else if (a === '--headed') opt.headed = true;
    else if (a === '--keep-open') opt.keepOpen = true;
    else if (a === '--port') opt.port = Number(next());
    else if (a === '--width') opt.width = Number(next());
    else if (a === '--height') opt.height = Number(next());
    else if (a === '--chrome') opt.chrome = next();
    else throw new Error(`unknown option: ${a}`);
  }
  return opt;
}

// ------------------------------------------------------------------- keymap
// windowsVirtualKeyCode is what Chrome turns into a DOM keyCode, which is
// what Emscripten's SDL1 shim reads (it maps event.keyCode to an SDLKey).
// `code` is the physical-key string; `key` is the logical value. All three
// have to be plausible together or the event is silently ignored somewhere.
const KEYS = {
  Up:     { keyCode: 38, code: 'ArrowUp',    key: 'ArrowUp' },
  Down:   { keyCode: 40, code: 'ArrowDown',  key: 'ArrowDown' },
  Left:   { keyCode: 37, code: 'ArrowLeft',  key: 'ArrowLeft' },
  Right:  { keyCode: 39, code: 'ArrowRight', key: 'ArrowRight' },
  Enter:  { keyCode: 13, code: 'Enter',      key: 'Enter',  text: '\r' },
  Escape: { keyCode: 27, code: 'Escape',     key: 'Escape' },
  Space:  { keyCode: 32, code: 'Space',      key: ' ',      text: ' ' },
  Tab:    { keyCode:  9, code: 'Tab',        key: 'Tab' },
};
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  KEYS[c] = { keyCode: c.charCodeAt(0), code: `Key${c}`, key: c.toLowerCase(), text: c.toLowerCase() };
}

// --------------------------------------------------------------- CDP client

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
      } else {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error(`cannot connect to ${url}`)), { once: true });
    });
    return new CDP(ws);
  }
  on(fn) { this.handlers.push(fn); }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) { lastErr = e; }
    await sleep(150);
  }
  throw new Error(`devtools never came up on port ${port}: ${lastErr}`);
}

// -------------------------------------------------------------- value dump

// Runtime.consoleAPICalled hands back RemoteObjects, not strings. Strings and
// numbers arrive as `value`; everything else only has a `description`.
function argToString(a) {
  if (a === undefined || a === null) return String(a);
  if ('value' in a) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  if (a.description !== undefined) return a.description;
  if (a.unserializableValue !== undefined) return a.unserializableValue;
  return a.type;
}

// ------------------------------------------------------------------- main

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  mkdirSync(opt.out, { recursive: true });
  const logPath = join(opt.out, 'console.log');
  writeFileSync(logPath, '');

  const profileDir = mkdtempSync(join(tmpdir(), 'aa-chrome-'));
  const args = [
    `--remote-debugging-port=${opt.port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${opt.width},${opt.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--mute-audio',
    '--hide-scrollbars',
    'about:blank',
  ];
  if (!opt.headed) {
    // WebGL in a headless browser has no GPU to talk to. ANGLE's SwiftShader
    // backend rasterises in software; without --enable-unsafe-swiftshader
    // Chrome refuses to hand a WebGL context to a page when the only
    // available renderer is software. Headed Chrome has the real GPU, so these
    // are deliberately NOT passed there -- forcing them would make every run
    // report SwiftShader and hide what a real user's driver actually does.
    args.unshift('--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
                 '--enable-unsafe-swiftshader');
  }

  const chrome = spawn(opt.chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const chromeStderr = [];
  chrome.stderr.on('data', (d) => chromeStderr.push(d.toString()));
  chrome.stdout.on('data', (d) => chromeStderr.push(d.toString()));

  let exitCode = 0;
  let browser, session;
  const t0 = () => Date.now() - startedAt;
  let startedAt = Date.now();

  // Every recorded line, kept in memory so `until:` can count matches. A gate
  // run is a few thousand lines; holding them costs nothing and means `until:`
  // sees exactly the transcript that gets committed as evidence, rather than a
  // second, separately-filtered stream that could disagree with it.
  const transcript = [];
  const record = (line) => {
    const stamped = `[${String(t0()).padStart(7)}ms] ${line}`;
    transcript.push(stamped);
    process.stdout.write(stamped + '\n');
    appendFileSync(logPath, stamped + '\n');
  };
  // Lines the harness itself wrote are excluded, and that is not tidiness: an
  // `until:` step echoes the string it is waiting for, a `mark:` may name it
  // and an `eval:` result may quote it back. Counting those would let the
  // harness satisfy its own wait condition.
  const countMatches = (needle) =>
    transcript.reduce((n, l) => n + (!l.includes('] [harness] ') && l.includes(needle) ? 1 : 0), 0);

  try {
    const version = await waitForDevTools(opt.port);
    browser = await CDP.connect(version.webSocketDebuggerUrl);

    // No width/height here: CDP rejects those unless newWindow is set, and
    // --window-size on the command line already sized the one window we have.
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    session = sessionId;
    const send = (m, p) => browser.send(m, p, session);

    browser.on((msg) => {
      if (msg.sessionId !== session) return;
      const p = msg.params;
      switch (msg.method) {
        case 'Runtime.consoleAPICalled':
          record(`[console.${p.type}] ${p.args.map(argToString).join(' ')}`);
          break;
        case 'Runtime.exceptionThrown': {
          const d = p.exceptionDetails;
          const text = d.exception?.description || d.text;
          record(`[EXCEPTION] ${text}`);
          // description is truncated to Error.stackTraceLimit frames; the
          // structured stackTrace CDP sends alongside it is not, and for a
          // stack-overflow diagnosis the depth is the whole question.
          const frames = d.stackTrace?.callFrames ?? [];
          if (frames.length) {
            record(`[EXCEPTION] structured stack, ${frames.length} frames:`);
            for (const f of frames) {
              record(`    ${f.functionName || '<anonymous>'} @ ${f.url}:${f.lineNumber}:${f.columnNumber}`);
            }
          }
          break;
        }
        case 'Log.entryAdded':
          // entry.url is the whole point for network entries. "Failed to load
          // resource: 404" without it names no resource, which makes the
          // "every 404 in a passing transcript is /favicon.ico" pass criterion
          // unverifiable from the transcript it is supposed to be checked against.
          record(`[browser.${p.entry.level}/${p.entry.source}] ${p.entry.text}`
                 + (p.entry.url ? `   <- ${p.entry.url}` : ''));
          break;
        case 'Page.loadEventFired':
          record('[page] load event fired');
          break;
        case 'Inspector.targetCrashed':
          record('[FATAL] renderer crashed');
          break;
      }
    });

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Runtime.setAsyncCallStackDepth', { maxDepth: 8 });
    // Pin the viewport so screenshots are the requested size regardless of
    // what the OS window manager did with --window-size.
    await send('Emulation.setDeviceMetricsOverride', {
      width: opt.width, height: opt.height, deviceScaleFactor: 1, mobile: false,
    });

    // V8 truncates Error.stack to 10 frames by default, which is useless for
    // telling a runaway recursion apart from one oversized stack frame.
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'Error.stackTraceLimit = 500;',
    });

    record(`[harness] chrome: ${version.Browser}`);
    record(`[harness] navigating to ${opt.url}`);
    startedAt = Date.now();
    await send('Page.navigate', { url: opt.url });

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
          // fromSurface:true captures the compositor surface, which is the
          // only way to get canvas pixels out of a headless window.
          const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
          const file = join(opt.out, `${arg}.png`);
          writeFileSync(file, Buffer.from(data, 'base64'));
          record(`[harness] screenshot -> ${file}`);
          break;
        }
        case 'click': {
          const r = await send('Runtime.evaluate', {
            expression: `(() => { const e = document.querySelector(${JSON.stringify(arg)});
                                  if (!e) return 'NOT FOUND';
                                  if (e.disabled) return 'DISABLED';
                                  e.click(); return 'clicked'; })()`,
            returnByValue: true,
          });
          record(`[harness] click ${arg}: ${r.result.value}`);
          break;
        }
        case 'key': {
          const [name, countStr] = arg.split(':');
          const k = KEYS[name];
          if (!k) throw new Error(`unknown key: ${name}`);
          const count = Number(countStr || 1);
          for (let i = 0; i < count; i++) {
            const base = {
              windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode,
              code: k.code, key: k.key,
            };
            await send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, text: k.text });
            await sleep(30);
            await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
            record(`[harness] key ${name} (${i + 1}/${count})`);
            // The game only sees a key when its event loop next runs, and
            // that loop yields on ~4ms setTimeout boundaries; give it room.
            await sleep(300);
          }
          break;
        }
        case 'eval': {
          const r = await send('Runtime.evaluate', { expression: arg, returnByValue: true, awaitPromise: true });
          record(`[harness] eval ${arg} => ${JSON.stringify(r.result?.value ?? r.result?.description)}`);
          break;
        }
        case 'until': {
          // until:N:MS:TEXT -- TEXT may itself contain colons (every ladder-log
          // needle this is used with does not, but a timestamped one would), so
          // only the first two fields are split off.
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
          // Not thrown: a gate that gets two rounds out of three has produced a
          // real result and the rest of the script (screenshots, the frame-rate
          // dump) is exactly what is needed to report it honestly. Aborting
          // here would throw that evidence away.
          else record(`[harness] until TIMED OUT after ${msStr}ms: saw ${got}x <<${needle}>>, wanted ${want}`);
          break;
        }
        default:
          throw new Error(`unknown step: ${rawStep}`);
      }
    }

    if (opt.keepOpen) {
      record('[harness] --keep-open: leaving browser up, ctrl-c to stop');
      await new Promise(() => {});
    }
  } catch (err) {
    record(`[harness] FAILED: ${err.stack || err}`);
    if (chromeStderr.length) record(`[harness] chrome said:\n${chromeStderr.join('')}`);
    exitCode = 1;
  } finally {
    try { if (browser) { await browser.send('Browser.close').catch(() => {}); browser.close(); } } catch { /* ignore */ }
    chrome.kill('SIGTERM');
    await sleep(300);
    chrome.kill('SIGKILL');
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
    console.log(`\nTranscript: ${logPath}`);
  }
  process.exit(exitCode);
}

main();
