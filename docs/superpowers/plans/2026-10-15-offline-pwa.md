# Offline Play (Installable App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The game can be installed to a phone's home screen. Once installed and launched online once, it starts and plays a local game (against AI) with no network.

**Architecture:**
- **Build:** produces four extra published files:
  - `sw.js`, the service worker, stamped with the SHA-256 of the four game files it saves;
  - `manifest.json`;
  - two icons.
- **Page:** a new page module (`web/page/offline.js`) registers the worker after the page has loaded.
- **The worker:**
  - **Saving:** saves the four game files in a versioned cache. It checks each file against its stamped hash, so a half-deployed mix is never saved.
  - **Serving:** answers from that cache only for the installed app, whose `start_url` carries `?app=1`. A normal browser tab still gets everything from the network, exactly as today.
- **Testing:**
  - Node tests cover the worker, the stamp tool and the page module.
  - A new headless gate (`run-offline-gate.sh`) proves the result end to end: install, switch the server off, launch, drive a cycle.

**Tech Stack:** Service Worker + Cache API, Web App Manifest, Node 22 (`node --test`, `node:vm`), GNU make, the existing CDP driver `web/tools/drive-browser.mjs`.

**Spec:** the Design section below. It was agreed in chat on 2026-10-15; there is no separate spec file.

## Amendments after review

The tasks below are as built, including these changes made after the
reviews (each its own commit):
- Gate check O6: the newer copy takes over once no window is open.
- `sw.js` saves the copy again when it has gone missing (before, only an
  install saved it, so a copy cleared alone stayed empty until the next deploy).
- The cache prefix is stamped into `sw.js` by `stamp-sw.mjs` (one source).
- The Makefile runs the stamp with emsdk's node (`$(NODE)`, from
  `EMSDK_NODE`); CI failed with "make: node: Permission denied" on a bare
  `node`. Task 2's Makefile block below still shows the first version.
- The gate's repeated snippets are helpers in `web/tools/gate-probe.js`.

## Design

### What it does

1. **Who gets offline play: the installed app only.**
   - The manifest's `start_url` is `armagetronad.html?app=1`.
   - The worker serves from its cache only when the page was opened with `app=1`:
     - for the page itself, the navigation URL carries it;
     - for the `.js`/`.wasm`/`.data`, the requesting client's URL carries it.
   - In a normal browser tab the worker passes every request to the network. Website visitors therefore always get the newest deploy, with no "one visit behind" lag. That includes the maintainer checking a deploy on their phone.
2. **Every visit fills the cache, tab or app.**
   - The worker's `install` step saves the four files (`armagetronad.html/.js/.wasm/.data`, about 5.4 MB), so the app is ready offline as soon as it is installed.
   - The download is a revalidation (`cache: 'no-cache'`), so right after the page itself loaded them it costs a 304 per file, not 5 MB again.
3. **A saved copy is always one build.**
   - `sw.js` is generated per build with every file's SHA-256.
   - The install step hashes what it downloaded and fails if any file differs, for example when Pages has published half a deploy. A failed install deletes its partial cache. The browser retries on the next visit, and the previous copy stays in use.
4. **Updates arrive on the next launch.**
   - A new deploy changes `sw.js`. Registration uses `updateViaCache: 'none'`, so the browser sees the change on the next launch and saves the new copy in the background.
   - The new copy takes over once every window of the game has been closed. The previous version's cache is deleted when the new one takes over.
   - There is no prompt and no `skipWaiting`. The running game never has its files swapped under it.
5. **The game is untouched.** No C++ changes, so the byte-pinned dedicated wasm is unaffected. Multiplayer offline fails the way it does today (the relay is unreachable), which is outside this plan.

### Not in scope

- Offline in a plain browser tab.
- An "update available" prompt.
- Offline multiplayer or server browsing.
- New icon artwork: the icons are the upstream 128 px icon scaled up, and better art can replace the two PNGs later.

## Global Constraints

- No change to any file under `src/`. The dedicated server wasm is byte-pinned (2,514,094 bytes, md5 bdda8209331b2f01b0f4e8fcfc06756b).
- Page modules are plain scripts that define one global (`var AAOffline = (function () { ... })();`). They are inlined by the awk rule in `web/Makefile`. **No line in a page module or in `web/shell.html`'s body may start with `#`**, because emcc's shell preprocessor treats it as a directive.
- `web/shell.html` only defines things; everything runs from "THE START ORDER" at its bottom. The page never reads `window.AA_*`.
- A `.catch` must handle every promise the page creates. `window.onunhandledrejection` shows the red "Failed to load" banner.
- Gates run headless (no `--headed`), as the other gates do.
- Commits are authored as `escapedcat <github@htmlcss.de>`. Never put a claude.ai session URL in a commit or PR. Before every push, check the PR is open: `[ "$(gh pr view N --json state --jq .state)" = OPEN ] && git push`.
- Work happens in the worktree `.worktrees/offline-pwa` on branch `offline-pwa` off `main`.
- Leave the untracked `docs/security-audit-2026-09-03.md` in the main checkout alone.
- Test command: `node --test 'web/test/*.test.mjs'` from the repository root (quote the glob).

## Review Focus

1. **Half-deployed site:** a phone that visits while Pages has published the new `armagetronad.js` but still serves the old `.wasm` must never save that mix. Covered by `sw.test.mjs` "install refuses a file from another build".
2. **Plain tab:** a browser-tab visitor must see a new deploy on the first visit after it. Covered by gate O2 (a tab reload reaches the server for every file).
3. **Offline launch:** the update check fails, and that must not raise the red "Failed to load" banner. Covered by `offline.test.mjs` "a failed registration is reported, never thrown", and by gate O4's `banner` field.
4. **Cache partly gone:** if the browser evicted the cache or the user cleared some site data, the app must fall back to the network instead of failing. Covered by `sw.test.mjs` "the app falls back to the network when the copy is missing".
5. **No service worker:** a page served over plain http on the LAN (a phone test rig) has no `navigator.serviceWorker`. It must boot as today and only log that offline play is unavailable. Covered by `offline.test.mjs` "no service worker".

---

### Task 1: The service worker and its build stamp

**Files:**
- Create: `web/sw.js`
- Create: `web/tools/stamp-sw.mjs`
- Test: `web/test/sw.test.mjs`

**Interfaces:**
- Produces:
  - **`web/tools/stamp-sw.mjs`** (ES module):
    - `export const PRECACHED: string[]`, set to `['armagetronad.html', 'armagetronad.js', 'armagetronad.wasm', 'armagetronad.data']`.
    - `export function precacheFor(dir: string): { version: string /* 12 hex */, files: { [file]: string /* sha256 hex */ } }`.
    - `export function stamp(template: string, precache): string`. It throws unless the template contains `/* @precache */ null` exactly once.
    - CLI: `node web/tools/stamp-sw.mjs <dist-dir>` writes `<dist-dir>/sw.js`.
  - **`web/sw.js`** (the template):
    - Its cache names are `'aa-offline-' + version`.
    - It treats a page as the app when `new URL(url).searchParams.get('app') === '1'`.

- [ ] **Step 1: Write the failing tests**

Create `web/test/sw.test.mjs`:

```js
// web/sw.js (the installed app's offline copy) and web/tools/stamp-sw.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRepoFile } from './load-page-module.mjs';
import { PRECACHED, precacheFor, stamp } from '../tools/stamp-sw.mjs';

const SCOPE = 'https://aa.test/game/';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BUILD = { 'armagetronad.html': 'html v2', 'armagetronad.js': 'js v2',
                'armagetronad.wasm': 'wasm v2', 'armagetronad.data': 'data v2' };
const VERSION = 'abc123abc123';
const CACHE = 'aa-offline-' + VERSION;

// The worker in a vm with fake caches/fetch/clients. `served` is what the
// network answers (file -> body); `clientUrls` maps a clientId to its page URL.
function worker({ served = BUILD, clientUrls = {} } = {}) {
  const files = Object.fromEntries(Object.entries(BUILD).map(([f, b]) => [f, sha(b)]));
  const handlers = {};
  const store = new Map();
  const net = [];
  const cacheOf = (m) => ({
    put: async (k, r) => { m.set(String(k), r); },
    match: async (k) => { const r = m.get(String(k)); return r ? r.clone() : undefined; },
    keys: async () => [...m.keys()],
  });
  const caches = {
    open: async (n) => { if (!store.has(n)) store.set(n, new Map()); return cacheOf(store.get(n)); },
    keys: async () => [...store.keys()],
    delete: async (n) => store.delete(n),
  };
  const fetch = async (req) => {
    const url = typeof req === 'string' ? new URL(req, SCOPE).href : req.url;
    net.push(url);
    const f = new URL(url).pathname.slice(new URL(SCOPE).pathname.length);
    return f in served ? new Response(served[f]) : new Response('nope', { status: 404 });
  };
  const self = { registration: { scope: SCOPE }, addEventListener: (t, h) => { handlers[t] = h; } };
  const context = vm.createContext({
    self, caches, fetch, URL, Response, console, crypto: globalThis.crypto,
    clients: { get: async (id) => (id in clientUrls ? { url: clientUrls[id] } : undefined) },
  });
  vm.runInContext(stamp(readRepoFile('web/sw.js'), { version: VERSION, files }), context,
                  { filename: 'web/sw.js' });
  // Dispatches one event; returns what the worker handed to waitUntil/respondWith.
  const dispatch = (type, fields = {}) => {
    const out = { waited: null, response: null };
    handlers[type]({ ...fields, waitUntil: (p) => { out.waited = p; },
                     respondWith: (p) => { out.response = p; } });
    return out;
  };
  const get = (url, more = {}) => dispatch('fetch', { request: { url, method: 'GET', mode: 'cors', ...more.request }, clientId: more.clientId || '' });
  return { store, net, caches, dispatch, get };
}

async function installed(opts) {
  const w = worker(opts);
  await w.dispatch('install').waited;
  w.net.length = 0;
  return w;
}

test('stamp: per-file sha256, a 12-hex version, and exactly one placeholder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aa-stamp-'));
  for (const [f, b] of Object.entries(BUILD)) writeFileSync(join(dir, f), b);
  const p = precacheFor(dir);
  assert.deepEqual(Object.keys(p.files), PRECACHED);
  assert.equal(p.files['armagetronad.wasm'], sha('wasm v2'));
  assert.equal(p.version, sha(PRECACHED.map((f) => sha(BUILD[f])).join('\n')).slice(0, 12));
  assert.equal(stamp('a /* @precache */ null b', p), 'a ' + JSON.stringify(p) + ' b');
  assert.throws(() => stamp('no placeholder', p), /exactly one/);
  assert.throws(() => stamp('/* @precache */ null /* @precache */ null', p), /exactly one/);
  writeFileSync(join(dir, 'armagetronad.data'), 'other');
  assert.notEqual(precacheFor(dir).version, p.version, 'any file changing changes the version');
});

test('install saves every precached file under the build\'s cache name', async () => {
  const w = await installed();
  assert.deepEqual(await w.caches.keys(), [CACHE]);
  assert.deepEqual([...w.store.get(CACHE).keys()].sort(), [...PRECACHED].sort());
});

test('install refuses a file from another build, and leaves no partial copy', async () => {
  const w = worker({ served: { ...BUILD, 'armagetronad.wasm': 'wasm v1' } });
  await assert.rejects(w.dispatch('install').waited, /armagetronad\.wasm is not this build/);
  assert.deepEqual(await w.caches.keys(), []);
});

test('install fails on a missing file', async () => {
  const { 'armagetronad.data': _, ...rest } = BUILD;
  const w = worker({ served: rest });
  await assert.rejects(w.dispatch('install').waited, /armagetronad\.data: HTTP 404/);
  assert.deepEqual(await w.caches.keys(), []);
});

test('activate deletes older offline copies and nothing else', async () => {
  const w = await installed();
  await w.caches.open('aa-offline-000000000000');
  await w.caches.open('someone-else');
  await w.dispatch('activate').waited;
  assert.deepEqual((await w.caches.keys()).sort(), [CACHE, 'someone-else']);
});

test('the app is served from the copy: the page by its URL, the rest by its client', async () => {
  const w = await installed({ clientUrls: { c1: SCOPE + 'armagetronad.html?app=1&autostart=0' } });
  const page = w.get(SCOPE + 'armagetronad.html?app=1', { request: { mode: 'navigate' } });
  assert.equal(await (await page.response).text(), 'html v2');
  const wasm = w.get(SCOPE + 'armagetronad.wasm', { clientId: 'c1' });
  assert.equal(await (await wasm.response).text(), 'wasm v2');
  assert.deepEqual(w.net, [], 'nothing went to the network');
});

test('a browser tab always goes to the network', async () => {
  const w = await installed({ clientUrls: { c2: SCOPE + 'armagetronad.html?autostart=0' } });
  await w.get(SCOPE + 'armagetronad.html', { request: { mode: 'navigate' } }).response;
  await w.get(SCOPE + 'armagetronad.wasm', { clientId: 'c2' }).response;
  await w.get(SCOPE + 'armagetronad.data').response;   // no client at all
  assert.deepEqual(w.net, [SCOPE + 'armagetronad.html', SCOPE + 'armagetronad.wasm', SCOPE + 'armagetronad.data']);
});

test('the app falls back to the network when the copy is missing', async () => {
  const w = await installed({ clientUrls: { c1: SCOPE + 'armagetronad.html?app=1' } });
  await w.caches.delete(CACHE);
  const wasm = w.get(SCOPE + 'armagetronad.wasm', { clientId: 'c1' });
  assert.equal(await (await wasm.response).text(), 'wasm v2');
  assert.deepEqual(w.net, [SCOPE + 'armagetronad.wasm']);
});

test('requests it does not own are left alone', async () => {
  const w = await installed();
  const untouched = [
    w.get(SCOPE + 'armagetronad.wasm', { request: { method: 'POST' } }),
    w.get('https://other.test/game/armagetronad.wasm'),
    w.get(SCOPE + 'index.html'),
    w.get(SCOPE + 'sw.js'),
    w.get(SCOPE + 'toString'),
    w.get('https://aa.test/elsewhere/armagetronad.wasm'),
  ];
  for (const u of untouched) assert.equal(u.response, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test web/test/sw.test.mjs`
Expected: FAIL, `Cannot find module '.../web/tools/stamp-sw.mjs'`.

- [ ] **Step 3: Write `web/tools/stamp-sw.mjs`**

```js
#!/usr/bin/env node
// web/tools/stamp-sw.mjs <dist-dir> -- writes <dist-dir>/sw.js from web/sw.js.
//
// The worker saves the game for offline play, and it must never save half of
// one build and half of another (Pages publishes a deploy file by file). So
// each build's sw.js carries the SHA-256 of every file it saves; the worker
// hashes what it downloaded and refuses a mismatch. The version -- the cache
// name's suffix -- is a hash of those hashes, so it changes exactly when a
// saved file changes, and a changed sw.js is what tells the browser that a new
// build is out. web/Makefile runs this after the link step.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRECACHED = ['armagetronad.html', 'armagetronad.js', 'armagetronad.wasm', 'armagetronad.data'];
const PLACEHOLDER = '/* @precache */ null';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function precacheFor(dir) {
  const files = {};
  for (const f of PRECACHED) files[f] = sha256(readFileSync(join(dir, f)));
  return { version: sha256(PRECACHED.map((f) => files[f]).join('\n')).slice(0, 12), files };
}

export function stamp(template, precache) {
  if (template.split(PLACEHOLDER).length !== 2) {
    throw new Error('sw.js template: want exactly one ' + PLACEHOLDER);
  }
  return template.replace(PLACEHOLDER, () => JSON.stringify(precache));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node web/tools/stamp-sw.mjs <dist-dir>'); process.exit(2); }
  const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'sw.js'), 'utf8');
  const precache = precacheFor(dir);
  writeFileSync(join(dir, 'sw.js'), stamp(template, precache));
  console.log('sw.js: offline copy aa-offline-' + precache.version);
}
```

- [ ] **Step 4: Write `web/sw.js`**

```js
// web/sw.js -- THE INSTALLED APP'S OFFLINE COPY (a service worker).
//
// Built into web/dist-m1/sw.js by web/tools/stamp-sw.mjs, which replaces the
// placeholder below with this build's file hashes. Registered by
// web/page/offline.js. docs/development.md "Offline play" has the why.
//
// WHO IS SERVED FROM THE COPY: the installed app only. Its manifest start_url
// is armagetronad.html?app=1; a page opened with app=1 gets the four game
// files from this cache, the page itself by its URL and the .js/.wasm/.data
// by the URL of the page that asked. Everything else -- a plain browser tab,
// any other file -- goes to the network as if this worker did not exist, so
// a website visitor always gets the newest deploy.
//
// EVERY VISIT FILLS THE COPY, tab or app, so an installed app is ready
// offline from its first launch. A copy is one build or nothing: install
// hashes each download against the stamped hash and fails on a mismatch.
//
// UPDATES: a new deploy changes this file; the browser installs the new
// worker in the background and lets it take over once no window of the game
// is open, and activate deletes the older copy. No skipWaiting: a running
// game never has its files swapped under it.
'use strict';

const AA_PRECACHE = /* @precache */ null;

const PREFIX = 'aa-offline-';
const CACHE = PREFIX + AA_PRECACHE.version;
const owns = (file) => Object.prototype.hasOwnProperty.call(AA_PRECACHE.files, file);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const isApp = (url) => new URL(url).searchParams.get('app') === '1';

// A same-origin URL's path relative to this worker's scope, or null.
const fileOf = (url) => {
  const u = new URL(url);
  const scope = new URL(self.registration.scope);
  if (u.origin !== scope.origin || !u.pathname.startsWith(scope.pathname)) return null;
  return u.pathname.slice(scope.pathname.length);
};

async function saveCopy() {
  const cache = await caches.open(CACHE);
  try {
    for (const [file, want] of Object.entries(AA_PRECACHE.files)) {
      // no-cache: revalidate, so a file the page has just loaded costs a 304,
      // and an HTTP-cached file from an older deploy is never taken unchecked.
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(file + ': HTTP ' + res.status);
      const got = hex(await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer()));
      if (got !== want) throw new Error(file + ' is not this build');
      await cache.put(file, res);
    }
  } catch (e) {
    await caches.delete(CACHE);
    throw e;
  }
}

async function dropOlderCopies() {
  for (const name of await caches.keys()) {
    if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
  }
}

async function answer(event, file) {
  let app;
  if (event.request.mode === 'navigate') {
    app = isApp(event.request.url);
  } else {
    const client = event.clientId ? await clients.get(event.clientId) : undefined;
    app = !!client && isApp(client.url);
  }
  if (app) {
    const hit = await (await caches.open(CACHE)).match(file, { ignoreVary: true });
    if (hit) return hit;
  }
  return fetch(event.request);
}

self.addEventListener('install', (event) => event.waitUntil(saveCopy()));
self.addEventListener('activate', (event) => event.waitUntil(dropOlderCopies()));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const file = fileOf(event.request.url);
  if (file === null || !owns(file)) return;
  event.respondWith(answer(event, file));
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test web/test/sw.test.mjs`
Expected: PASS, 9 tests, 0 failures.

- [ ] **Step 6: Run the whole suite**

Run: `node --test 'web/test/*.test.mjs'`
Expected: all pass (53 existing + 9 new = 62).

- [ ] **Step 7: Commit**

```bash
git add web/sw.js web/tools/stamp-sw.mjs web/test/sw.test.mjs
git commit -m "Offline: a service worker that saves one build for the installed app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Manifest, icons, build rule and publish set

**Files:**
- Create: `web/pwa/manifest.json`, `web/pwa/icon-192.png`, `web/pwa/icon-512.png`
- Modify: `web/Makefile`:
  - add the offline rules after the `client:` rule, around line 538;
  - extend `client:`.
- Modify: `web/shell.html`: the `<head>`, after `<title>` (line 51).
- Modify: `web/tools/check-publish-set.mjs`: `EXPECTED`.
- Modify: `.github/workflows/deploy-pages.yml`: the `FILES=` line in "Wait for Pages to serve the new build" (line 237).
- Test: `web/test/pwa-files.test.mjs`

**Interfaces:**
- Consumes:
  - `PRECACHED` from `web/tools/stamp-sw.mjs`;
  - the `isApp` rule in `web/sw.js` (`searchParams.get('app') === '1'`).
- Produces: `web/dist-m1/{sw.js, manifest.json, icon-192.png, icon-512.png}` after `make -f web/Makefile client`.

- [ ] **Step 1: Write the failing tests**

Create `web/test/pwa-files.test.mjs`:

```js
// The installable app's files: manifest, icons, publish set, page links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readRepoFile, repoPath } from './load-page-module.mjs';
import { PRECACHED } from '../tools/stamp-sw.mjs';

const OFFLINE_FILES = ['sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const manifest = () => JSON.parse(readRepoFile('web/pwa/manifest.json'));
const pngSize = (rel) => {
  const b = readFileSync(repoPath(rel));
  assert.equal(b.toString('ascii', 1, 4), 'PNG', rel + ' is a PNG');
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
};

test('the manifest starts the app in app mode, the mode web/sw.js serves offline', () => {
  const m = manifest();
  const start = new URL(m.start_url, 'https://aa.test/game/');
  assert.equal(start.pathname, '/game/armagetronad.html');
  assert.equal(start.searchParams.get('app'), '1');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'fullscreen');
  assert.match(readRepoFile('web/sw.js'), /searchParams\.get\('app'\) === '1'/);
});

test('every manifest icon is in web/pwa at the size it claims', () => {
  const icons = manifest().icons;
  assert.deepEqual(icons.map((i) => i.sizes).sort(), ['192x192', '512x512']);
  for (const i of icons) assert.equal(pngSize('web/pwa/' + i.src), i.sizes, i.src);
});

test('the publish set has the offline files and every file the worker saves', () => {
  const list = execFileSync(process.execPath, [repoPath('web/tools/check-publish-set.mjs'), '--list'],
                            { encoding: 'utf8' }).trim().split('\n');
  for (const f of [...OFFLINE_FILES, ...PRECACHED]) assert.ok(list.includes(f), f);
});

test('the deploy waits for the offline files too', () => {
  const files = /FILES="([^"]+)"/.exec(readRepoFile('.github/workflows/deploy-pages.yml'))[1].split(' ');
  for (const f of OFFLINE_FILES) assert.ok(files.includes(f), f);
});

test('the page links the manifest and the home-screen icon', () => {
  const head = readRepoFile('web/shell.html').split('</head>')[0];
  assert.match(head, /<link rel="manifest" href="manifest.json">/);
  assert.match(head, /<link rel="apple-touch-icon" href="icon-192.png">/);
  assert.match(head, /<meta name="theme-color" content="#111111">/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test web/test/pwa-files.test.mjs`
Expected: FAIL. The first test fails with `ENOENT ... web/pwa/manifest.json`; the others fail on missing files or list entries.

- [ ] **Step 3: Create the icons and the manifest**

```bash
mkdir -p web/pwa
sips -z 192 192 desktop/icons/128x128/armagetronad.png --out web/pwa/icon-192.png
sips -z 512 512 desktop/icons/128x128/armagetronad.png --out web/pwa/icon-512.png
file web/pwa/icon-192.png web/pwa/icon-512.png
```
Expected: `PNG image data, 192 x 192` and `PNG image data, 512 x 512`.

Create `web/pwa/manifest.json`:

```json
{
  "name": "Armagetron Advanced",
  "short_name": "Armagetron",
  "start_url": "armagetronad.html?app=1",
  "scope": "./",
  "display": "fullscreen",
  "background_color": "#111111",
  "theme_color": "#111111",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 4: Link them from the page**

In `web/shell.html`, directly after `  <title>Armagetron Advanced</title>` (line 51), insert:

```html
  <!-- Installable as an app that plays offline once launched online:
       web/pwa/manifest.json, web/sw.js, web/page/offline.js. -->
  <link rel="manifest" href="manifest.json">
  <link rel="apple-touch-icon" href="icon-192.png">
  <meta name="theme-color" content="#111111">
```

- [ ] **Step 5: Add them to the publish set and the deploy wait**

In `web/tools/check-publish-set.mjs`, replace the `EXPECTED` array with:

```js
const EXPECTED = [
  'armagetronad.data',   // preloaded MEMFS image
  'armagetronad.html',   // emcc's page -- the entry point the gates name
  'armagetronad.js',     // emcc's glue
  'armagetronad.wasm',   // the engine
  'icon-192.png',        // the installed app's icon (web/pwa)
  'icon-512.png',        // the installed app's icon (web/pwa)
  'index.html',          // the site-root redirect; copied in by `npm run deploy`
  'manifest.json',       // makes the page installable (web/pwa)
  'sw.js',               // the offline copy, stamped per build (web/sw.js)
];
```

In `.github/workflows/deploy-pages.yml`, change line 237 to:

```yaml
          FILES="armagetronad.html armagetronad.js armagetronad.wasm armagetronad.data index.html sw.js manifest.json icon-192.png icon-512.png"
```

`web/tools/wire-facts.sh` stays unchanged. It measures the transport of the four game files, and the new files are not part of that question.

- [ ] **Step 6: Add the build rules**

In `web/Makefile`, replace

```make
.PHONY: client
client: data web/dist-m1/armagetronad.html
```

with

```make
# ---- Offline play (docs/development.md "Offline play") -------------------
# sw.js is web/sw.js stamped with the hashes of the four files it saves, so it
# is rebuilt whenever the link step rewrites them (they are written together
# with armagetronad.html). The manifest and icons are copied as they are.
PWA_FILES := web/dist-m1/manifest.json web/dist-m1/icon-192.png web/dist-m1/icon-512.png

web/dist-m1/sw.js: web/dist-m1/armagetronad.html web/sw.js web/tools/stamp-sw.mjs
	node web/tools/stamp-sw.mjs web/dist-m1

$(PWA_FILES): web/dist-m1/%: web/pwa/%
	@mkdir -p web/dist-m1
	cp $< $@

.PHONY: client
client: data web/dist-m1/armagetronad.html web/dist-m1/sw.js $(PWA_FILES)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test web/test/pwa-files.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 8: Build and run the publish-set gate as CI does**

```bash
source deps/emsdk/emsdk_env.sh >/dev/null 2>&1
make -f web/Makefile client -j8 > /tmp/offline-build.log 2>&1; echo "make exit $?"; tail -3 /tmp/offline-build.log
ls web/dist-m1
cd web && cp index.html dist-m1/index.html && node tools/check-publish-set.mjs dist-m1; echo "check exit $?"; cd ..
bash web/tools/prove-publish-set-check-can-fail.sh
```
Expected:
- `make exit 0`, and the log ends with `sw.js: offline copy aa-offline-<12 hex>`.
- `web/dist-m1` lists exactly the nine files of `EXPECTED`. If an earlier build left stray files, delete them and record the names in the ledger.
- `check exit 0`.
- The prove script reports every case `ok`.

A worktree has no build yet. The first `make` compiles the whole client, which takes several minutes, so run it in the background.

- [ ] **Step 9: Run the whole suite**

Run: `node --test 'web/test/*.test.mjs'`
Expected: all pass (67).

- [ ] **Step 10: Commit**

```bash
git add web/pwa web/Makefile web/shell.html web/tools/check-publish-set.mjs .github/workflows/deploy-pages.yml web/test/pwa-files.test.mjs
git commit -m "Offline: manifest, icons, the stamped sw.js in the build and the publish set

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The page registers the worker

**Files:**
- Create: `web/page/offline.js`
- Modify: `web/shell.html`:
  - add a `<!-- @page-module web/page/offline.js -->` line after the `diag.js` marker (line 700);
  - add one call at the end of THE START ORDER (after the `?diag=1` block, before `</script>`).
- Modify: `docs/development.md`: add a module bullet in "Repo layout" after the `audio.js`/`diag.js` bullet (line 158).
- Test: `web/test/offline.test.mjs`

**Interfaces:**
- Consumes: `sw.js` next to the page (Task 2), and the cache prefix `aa-offline-` (Task 1).
- Produces:
  - `AAOffline.start(env)`, where `env = { nav, win, doc, caches, log }`.
  - Log lines the gate waits for:
    - `[PWA] ready <cache names>`, or `[PWA] ready (no offline copy yet)`;
    - `[PWA] registration failed: <e>`;
    - `[PWA] offline copy in use; the update check failed: <e>`;
    - `[PWA] the offline copy could not be saved (it will retry on the next visit)`;
    - `[PWA] no service worker here (an insecure page or an old browser): no offline copy`.

- [ ] **Step 1: Write the failing tests**

Create `web/test/offline.test.mjs`:

```js
// web/page/offline.js: the page registers the installed app's offline copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule, readRepoFile } from './load-page-module.mjs';

const Offline = loadPageModule('web/page/offline.js', 'AAOffline');
const settle = () => new Promise((r) => setTimeout(r, 0));

function page({ sw = true, loaded = true, register, controller = null,
                keys = ['aa-offline-abc123abc123', 'someone-else'], installing = null } = {}) {
  const logs = [], calls = [], listeners = {};
  const reg = { installing };
  const nav = sw ? { serviceWorker: {
    controller, ready: Promise.resolve(reg),
    register: register || ((url, opts) => { calls.push([url, { ...opts }]); return Promise.resolve(reg); }),
  } } : {};
  const env = {
    nav, doc: { readyState: loaded ? 'complete' : 'interactive' },
    win: { addEventListener: (t, fn, o) => { listeners[t] = { fn, o: { ...o } }; } },
    caches: { keys: async () => keys }, log: (l) => logs.push(l),
  };
  return { env, logs, calls, listeners };
}

test('no service worker: one log line, nothing else', async () => {
  const p = page({ sw: false });
  Offline.start(p.env);
  await settle();
  assert.deepEqual(p.logs, ['[PWA] no service worker here (an insecure page or an old browser): no offline copy']);
});

test('a loaded page registers sw.js, never from the HTTP cache, and reports its copy', async () => {
  const p = page();
  Offline.start(p.env);
  await settle(); await settle();
  assert.deepEqual(p.calls, [['sw.js', { updateViaCache: 'none' }]]);
  assert.deepEqual(p.logs, ['[PWA] ready aa-offline-abc123abc123']);
});

test('a page still loading waits for its load event (the game\'s download comes first)', async () => {
  const p = page({ loaded: false, keys: [] });
  Offline.start(p.env);
  await settle();
  assert.deepEqual(p.calls, []);
  assert.deepEqual(p.listeners.load.o, { once: true });
  p.listeners.load.fn();
  await settle(); await settle();
  assert.equal(p.calls.length, 1);
  assert.deepEqual(p.logs, ['[PWA] ready (no offline copy yet)']);
});

test('a failed registration is reported, never thrown', async () => {
  const fail = () => Promise.reject(new Error('Failed to fetch'));
  const first = page({ register: fail });
  Offline.start(first.env);
  await settle(); await settle();
  assert.deepEqual(first.logs, ['[PWA] registration failed: Error: Failed to fetch']);
  const offline = page({ register: fail, controller: {} });
  Offline.start(offline.env);
  await settle(); await settle();
  assert.deepEqual(offline.logs, ['[PWA] offline copy in use; the update check failed: Error: Failed to fetch']);
});

test('an install that fails is reported', async () => {
  let onChange = null;
  const worker = { state: 'installing', addEventListener: (t, fn) => { if (t === 'statechange') onChange = fn; } };
  const p = page({ installing: worker, keys: [] });
  Offline.start(p.env);
  await settle(); await settle();
  worker.state = 'redundant';
  onChange();
  assert.ok(p.logs.includes('[PWA] the offline copy could not be saved (it will retry on the next visit)'));
});

test('the page inlines the module and starts it in THE START ORDER', () => {
  const s = readRepoFile('web/shell.html');
  assert.ok(s.includes('<!-- @page-module web/page/offline.js -->'));
  const order = s.slice(s.indexOf('---- THE START ORDER'));
  assert.match(order, /AAOffline\.start\(\{ nav: navigator, win: window, doc: document,/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test web/test/offline.test.mjs`
Expected: FAIL. `ENOENT ... web/page/offline.js` is thrown by `loadPageModule`.

- [ ] **Step 3: Write `web/page/offline.js`**

```js
// web/page/offline.js -- THE INSTALLED APP'S OFFLINE COPY, the page's half.
//
// Registers sw.js (web/sw.js, stamped by web/tools/stamp-sw.mjs), which saves
// the game's four files on every visit and serves them to the installed app
// (opened as armagetronad.html?app=1) when there is no network. A plain tab is
// still served by the network; see web/sw.js for who gets what.
//
// AFTER THE LOAD EVENT: the worker's first install downloads the same 5 MB the
// page is loading; waiting for `load` keeps it from competing with the game's
// own download and turns it into four cheap revalidations.
//
// NOTHING HERE MAY THROW OR REJECT UNHANDLED: window.onunhandledrejection
// paints the red "Failed to load" banner. Offline, the browser's update check
// for sw.js fails on every launch -- that is the expected case, logged, not
// shown.
//
// No line in this file may start with '#' (emcc's shell preprocessor).
var AAOffline = (function () {
  'use strict';

  var PREFIX = 'aa-offline-';

  // env: { nav (navigator), win (window), doc (document), caches (window.caches),
  // log }. Logs one [PWA] line per outcome; the offline gate waits on "ready".
  var start = function (env) {
    var sw = env.nav.serviceWorker;
    if (!sw) {
      env.log('[PWA] no service worker here (an insecure page or an old browser): no offline copy');
      return;
    }
    var watchInstall = function (reg) {
      var w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', function () {
        if (w.state === 'redundant') {
          env.log('[PWA] the offline copy could not be saved (it will retry on the next visit)');
        }
      });
    };
    var go = function () {
      sw.register('sw.js', { updateViaCache: 'none' })
        .then(function (reg) { watchInstall(reg); return sw.ready; })
        .then(function () { return env.caches.keys(); })
        .then(function (keys) {
          var mine = keys.filter(function (k) { return k.indexOf(PREFIX) === 0; });
          env.log('[PWA] ready ' + (mine.length ? mine.join(' ') : '(no offline copy yet)'));
        })
        .catch(function (e) {
          env.log(sw.controller ? '[PWA] offline copy in use; the update check failed: ' + e
                                : '[PWA] registration failed: ' + e);
        });
    };
    if (env.doc.readyState === 'complete') go();
    else env.win.addEventListener('load', go, { once: true });
  };

  return { start: start };
})();
```

- [ ] **Step 4: Wire it into the page**

In `web/shell.html`, after the line `  <!-- @page-module web/page/diag.js -->`, add:

```html
  <!-- @page-module web/page/offline.js -->
```

In THE START ORDER, after the closing `}` of the `if (AAParams.flag(location.search, 'diag')) { ... }` block and before `  </script>`, add:

```js
    AAOffline.start({ nav: navigator, win: window, doc: document,   // the installed app's offline copy (web/page/offline.js)
                      caches: window.caches, log: (line) => console.log(line) });
```

In `docs/development.md`, after the bullet that begins `  - \`web/page/audio.js\` resumes sound on a phone`, add:

```markdown
  - `web/page/offline.js` registers the offline copy (`web/sw.js`), see "Offline play".
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test web/test/offline.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole suite, including the existing seam tests**

Run: `node --test 'web/test/*.test.mjs'`
Expected: all pass (73). Several existing tests read `web/shell.html`: the start order, the script-tag balance, and the forbidden reads of `window.AA_*`. They must stay green.

- [ ] **Step 7: Rebuild and boot once**

```bash
source deps/emsdk/emsdk_env.sh >/dev/null 2>&1
make -f web/Makefile client -j8 > /tmp/offline-build.log 2>&1; echo "make exit $?"
python3 -m http.server 8008 --bind 127.0.0.1 --directory web/dist-m1 >/dev/null 2>&1 & SRV=$!
node web/tools/drive-browser.mjs --out /tmp/offline-boot --port 9222 \
  --url 'http://127.0.0.1:8008/armagetronad.html?autostart=0' --script 'until:1:60000:[PWA] ready'
kill $SRV
grep -E '\[PWA\]|Failed to load' /tmp/offline-boot/console.log
```
Expected: one line `[PWA] ready aa-offline-<12 hex>`, and no `Failed to load`.

- [ ] **Step 8: Commit**

```bash
git add web/page/offline.js web/shell.html web/test/offline.test.mjs docs/development.md
git commit -m "Offline: the page registers the offline copy after it has loaded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The offline gate

**Files:**
- Create: `web/tools/serve-switchable.mjs`
- Create: `web/tools/offline-gate.steps`
- Create: `web/tools/run-offline-gate.sh`
- Modify: `docs/development.md`: a new section `## Offline play` directly before `## Deploying to GitHub Pages`.
- Modify: `README.md`: a short `### Play offline` subsection at the end of `## Play it`, before `### Controls`.

**Interfaces:**
- Consumes:
  - `[PWA] ready` (Task 3);
  - cache name `aa-offline-<version>`, and the `"version":"<12 hex>"` text in `sw.js` (Task 1);
  - `node web/tools/stamp-sw.mjs <dir>` (Task 1);
  - the `gate-env.sh` helpers `wait_for`, `drive_page`, `check`, `check_no_abort`, `gate_finish` and `GATE_HTTP_PORT`;
  - `window.AA_GAME.context().driving`.
- Produces:
  - `bash web/tools/run-offline-gate.sh <out-dir> [--no-sw]`, which ends with `--- offline-gate: ALL PASSED ---`.
  - The control server listens on `GATE_HTTP_PORT + 1` and answers `/down`, `/up` and `/hits`.

The gate is a single browser run, because `drive-browser.mjs` uses a fresh profile per run. It is a phone (`--mobile 412,915,3`) and goes through six checks:

- **O1:** a tab visit saves the copy.
- **O2:** a tab reload still reaches the server for the game files.
- **O3:** the app (`?app=1`) online does not reach the server for them.
- **O4:** with the site server switched off, the app boots, the menu works, and a local game starts with the cycle driving, with no red banner.
- **O5:** with the server back up serving a newer build, the app notices it, saves the new copy as a waiting update, and keeps the old one in use.
- **O6:** once no window of the game is open (the page leaves for `about:blank` and comes back), the newer copy takes over and the older one is deleted. Added after the final review.

Its negative control is `--no-sw`: the same run, with `sw.js` removed from what is served. O1, O3, O4, O5 and O6 must then FAIL, and O2 must still PASS.

- [ ] **Step 1: Write `web/tools/serve-switchable.mjs`**

```js
#!/usr/bin/env node
// web/tools/serve-switchable.mjs --dir D --next D2 --port P --control C
//
// The offline gate's web server: a static server for D on 127.0.0.1:P that
// the page itself can switch off and on, through a second, always-on server
// on C. A real outage is a refused connection, so /down closes the listener
// AND destroys every open socket; /up?next=1 brings it back serving D2 (the
// "newer build"). /hits counts requests per path, so a gate can tell a file
// that came from the network from one that came from the offline copy.
// Every response is Cache-Control: no-store, so the browser's HTTP cache can
// never stand in for either.
//
//   GET C/down          -> "down"
//   GET C/up[?next=1]   -> "up <dir>"
//   GET C/hits          -> {"armagetronad.wasm": 3, ...}
//
// Prints "listening <P> control <C>" once both are up.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const port = Number(arg('port'));
const controlPort = Number(arg('control'));
let dir = arg('dir');
const next = arg('next');
if (!dir || !port || !controlPort) {
  console.error('usage: serve-switchable.mjs --dir D [--next D2] --port P --control C');
  process.exit(2);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm',
                '.data': 'application/octet-stream', '.json': 'application/json', '.png': 'image/png' };
const hits = {};
const sockets = new Set();

const site = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (path.split('/').includes('..')) { res.writeHead(400).end(); return; }
  hits[path] = (hits[path] || 0) + 1;
  try {
    const body = await readFile(join(dir, path || 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
                         'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
  }
});
site.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
const up = () => new Promise((r) => site.listen(port, '127.0.0.1', r));
const down = () => new Promise((r) => { site.close(() => r()); for (const s of sockets) s.destroy(); });

const control = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body;
  if (u.pathname === '/down') { await down(); body = 'down'; }
  else if (u.pathname === '/up') { if (u.searchParams.get('next') === '1' && next) dir = next; await up(); body = 'up ' + dir; }
  else if (u.pathname === '/hits') body = JSON.stringify(hits);
  else { res.writeHead(404).end(); return; }
  console.log('control ' + u.pathname + ' -> ' + body.slice(0, 80));
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
  res.end(body);
});

await up();
await new Promise((r) => control.listen(controlPort, '127.0.0.1', r));
console.log('listening ' + port + ' control ' + controlPort);
```

- [ ] **Step 2: Check the server by hand**

```bash
mkdir -p /tmp/ss && echo hi > /tmp/ss/a.txt
node web/tools/serve-switchable.mjs --dir /tmp/ss --port 8308 --control 8309 & S=$!; sleep 1
curl -s http://127.0.0.1:8308/a.txt; curl -s http://127.0.0.1:8309/down; echo
curl -s -m 2 http://127.0.0.1:8308/a.txt; echo "exit $?"
curl -s http://127.0.0.1:8309/up; echo; curl -s http://127.0.0.1:8308/a.txt; curl -s http://127.0.0.1:8309/hits; echo
kill $S
```
Expected, in this order:
1. `hi`
2. `down`
3. `exit 7` (connection refused)
4. `up /tmp/ss`
5. `hi`
6. `{"a.txt":2}`

- [ ] **Step 3: Write `web/tools/offline-gate.steps`**

```
# The offline gate: install the app's offline copy, switch the server off,
# launch the app, play. Run by web/tools/run-offline-gate.sh, which starts
# web/tools/serve-switchable.mjs (site on P, its switch on P+1) and opens
# armagetronad.html?autostart=0 -- a plain browser tab -- as a phone.
#
# One browser run on purpose: drive-browser.mjs gives every run a fresh
# profile, and the offline copy lives in the profile. Navigations are
# location.href in an eval; the console transcript carries on across them, so
# every `until:N` below counts [PWA] ready lines across all pages so far.
# Hit counts and the first copy's name survive the navigations in
# sessionStorage; `probe:` (web/tools/gate-probe.js, the __aa helpers) is
# installed again after each one.
# The [PWA] ready counts include the offline launch's: Chrome's register()
# resolves offline too (its update check fails quietly).
#
# O1 a tab visit saves the copy      O2 a tab reload still uses the network
# O3 the app online uses the copy    O4 the app offline boots and plays
# O5 a newer build is saved as a waiting update; the running copy is kept
# O6 once no window of the game is open, the newer copy takes over and the
#    older one is deleted (the page leaves for about:blank, then comes back)

until:1:60000:[PWA] ready
probe:
eval:(async()=>{const name=await __aa.copyName();sessionStorage.setItem('first',name||'');const keys=await caches.keys();const n=name?(await (await caches.open(name)).keys()).length:0;console.log('[OFFGATE] O1 tab-visit-saves-the-offline-copy '+JSON.stringify({copy:name,keys,entries:n,PASS:!!name&&keys.includes(name)&&n===4}));return 'O1'})()
eval:(async()=>{sessionStorage.setItem('h0',JSON.stringify(await __aa.hits()));location.href='armagetronad.html?autostart=0';return 'tab reload'})()
until:2:60000:[PWA] ready
probe:
eval:(async()=>{const h1=await __aa.hits();sessionStorage.setItem('h1',JSON.stringify(h1));const more=__aa.fromNetwork(JSON.parse(sessionStorage.getItem('h0')),h1);console.log('[OFFGATE] O2 tab-reload-uses-the-network '+JSON.stringify({fromNetwork:more,PASS:more.length===4}));return 'O2'})()
eval:(()=>{location.href='armagetronad.html?app=1&autostart=0';return 'app, online'})()
until:3:60000:[PWA] ready
probe:
eval:(async()=>{const more=__aa.fromNetwork(JSON.parse(sessionStorage.getItem('h1')),await __aa.hits());const c=!!navigator.serviceWorker.controller;console.log('[OFFGATE] O3 app-online-uses-the-copy '+JSON.stringify({fromNetwork:more,controlled:c,PASS:more.length===0&&c}));return 'O3'})()
eval:(async()=>{console.log('[OFFGATE-CTL] '+await __aa.serverSwitch('/down'));location.href='armagetronad.html?app=1';return 'app, offline'})()
until:1:120000:[BOOT] autostart
probe:
eval:(()=>{for(const t of ['keydown','keyup','keypress'])window.addEventListener(t,e=>{if(e.key==='Unidentified'){e.stopImmediatePropagation();e.preventDefault();}},true);return 'headless key flood filtered'})()
wait:9000
key:Enter
wait:2500
key:Escape
wait:2500
key:Space
eval:__aa.logWhen(async()=>window.AA_GAME&&AA_GAME.context().driving,'[OFFGATE-READY] driving')
until:1:60000:[OFFGATE-READY] driving
eval:(async()=>{const down=await fetch('offline-probe.txt').then(()=>false,()=>true);const banner=document.body.innerText.includes('Failed to load');const driving=!!(window.AA_GAME&&AA_GAME.context().driving);console.log('[OFFGATE] O4 app-offline-boots-and-plays '+JSON.stringify({serverDown:down,driving,banner,PASS:down&&driving&&!banner}));return 'O4'})()
shot:offline-driving
eval:(async()=>{console.log('[OFFGATE-CTL] '+await __aa.serverSwitch('/up?next=1'));location.href='armagetronad.html?app=1&autostart=0';return 'app, newer build out'})()
until:5:60000:[PWA] ready
probe:
eval:__aa.logWhen(async()=>{const r=await navigator.serviceWorker.getRegistration();return r&&r.waiting&&r.waiting.state==='installed'},'[OFFGATE-READY] update waiting')
until:1:60000:[OFFGATE-READY] update waiting
eval:(async()=>{const old=sessionStorage.getItem('first');const nv=await __aa.copyName();const keys=await caches.keys();const r=await navigator.serviceWorker.getRegistration();const activeIsOld=!!r.active&&!!r.waiting&&r.active!==r.waiting;console.log('[OFFGATE] O5 newer-build-waits-old-copy-kept '+JSON.stringify({old,new:nv,keys,activeIsOld,PASS:!!nv&&nv!==old&&keys.includes(old)&&keys.includes(nv)&&activeIsOld}));return 'O5'})()
eval:(()=>{sessionStorage.setItem('back',location.href);location.href='about:blank';return 'leaving: no window of the game open'})()
wait:3000
eval:(()=>{location.href=sessionStorage.getItem('back');return 'relaunch'})()
until:6:60000:[PWA] ready
probe:
eval:__aa.logWhen(async()=>navigator.serviceWorker.controller&&!(await caches.keys()).includes(sessionStorage.getItem('first')),'[OFFGATE-READY] newer copy in use')
until:1:60000:[OFFGATE-READY] newer copy in use
eval:(async()=>{const old=sessionStorage.getItem('first');const nv=await __aa.copyName();const copies=(await caches.keys()).filter(k=>k.startsWith(old.slice(0,-12)));const page=await (await fetch('armagetronad.html')).text();const servedNext=page.includes('the next build');console.log('[OFFGATE] O6 newer-copy-takes-over-older-deleted '+JSON.stringify({old,copies,servedNext,PASS:!!old&&copies.length===1&&copies[0]===nv&&servedNext}));return 'O6'})()
```

- [ ] **Step 4: Write `web/tools/run-offline-gate.sh`**

```bash
#!/bin/bash
# bash web/tools/run-offline-gate.sh <out-dir> [--no-sw]
#
# The installed app plays with no network (web/tools/offline-gate.steps says
# what each check proves). Headless, a phone, against a COPY of web/dist-m1
# served by web/tools/serve-switchable.mjs on GATE_HTTP_PORT (8008) with its
# switch on GATE_HTTP_PORT+1. A second copy, with a changed page and its own
# stamped sw.js, is the "newer build" O5 switches to.
#
# --no-sw is the negative control: the same run with sw.js not served. O1, O3,
# O4, O5 and O6 must FAIL and O2 must PASS -- the proof the gate can fail.
set -u
OUT=${1:-}
[ -n "$OUT" ] || { echo "usage: $0 <out-dir> [--no-sw]" >&2; exit 2; }
MODE=${2:-}
[ -f web/tools/drive-browser.mjs ] || { echo "run me from the repository root" >&2; exit 2; }
[ -f web/dist-m1/sw.js ] || { echo "no offline build in web/dist-m1 (make -f web/Makefile client)" >&2; exit 2; }
# shellcheck source=web/tools/gate-env.sh
. web/tools/gate-env.sh
HTTP=$GATE_HTTP_PORT
CTL=$((HTTP + 1))
curl -s -o /dev/null "http://127.0.0.1:$HTTP/" && { echo "something already answers on $HTTP; set GATE_HTTP_PORT" >&2; exit 2; }

rm -rf "$OUT"; mkdir -p "$OUT"
cp -R web/dist-m1 "$OUT/site"
cp -R web/dist-m1 "$OUT/next"
printf '\n<!-- the next build -->\n' >> "$OUT/next/armagetronad.html"
node web/tools/stamp-sw.mjs "$OUT/next" > /dev/null
if [ "$MODE" = --no-sw ]; then rm "$OUT/site/sw.js" "$OUT/next/sw.js"; fi

node web/tools/serve-switchable.mjs --dir "$OUT/site" --next "$OUT/next" --port "$HTTP" --control "$CTL" \
  > "$OUT/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
wait_for 10 grep -q '^listening' "$OUT/server.log" ||
  { echo "the gate server did not come up" >&2; cat "$OUT/server.log" >&2; exit 1; }

drive_page "$OUT" "http://127.0.0.1:$HTTP/armagetronad.html?autostart=0" web/tools/offline-gate.steps \
  --mobile 412,915,3 || echo "(driver exited non-zero, see $OUT/driver.txt)"

C="$OUT/console.log"
FAILS=0
passed() { grep -F "[OFFGATE] $1 " "$C" | grep -q '"PASS":true'; }
check "O1 a tab visit saves the offline copy"            passed O1
check "O2 a tab reload still uses the network"           passed O2
check "O3 the app online uses the copy"                  passed O3
check "O4 the app offline boots and drives"              passed O4
check "O5 a newer build waits; the running copy is kept" passed O5
check "O6 the newer copy takes over; the older is deleted" passed O6
check_no_abort
gate_finish "offline-gate${MODE:+ $MODE}"
```

Then make it executable and lint it:

```bash
chmod +x web/tools/run-offline-gate.sh
shellcheck web/tools/run-offline-gate.sh; echo "shellcheck exit $?"
node --check web/tools/serve-switchable.mjs && echo syntax ok
```
Expected: `shellcheck exit 0`, `syntax ok`.

- [ ] **Step 5: Run the gate**

Run: `bash web/tools/run-offline-gate.sh /tmp/offline-gate`
Expected: six `PASS O…` lines, `PASS no Emscripten abort`, and `--- offline-gate: ALL PASSED ---`. `/tmp/offline-gate/offline-driving.png` shows the arena from the cycle.

If a check fails, read `/tmp/offline-gate/console.log` around its `[OFFGATE]` line before changing anything, and use superpowers:systematic-debugging. The likeliest causes:

- **O4 never reaches `driving`:** the key sequence copied from `drive-pad-gate.steps` was not enough on this boot. Compare with that gate's own transcript, and fix the steps rather than the page.
- **O5 times out:** the browser did not re-check `sw.js` on the navigation. Confirm `server.log` shows `control /up` and a `sw.js` hit after it.

- [ ] **Step 6: Run the negative control**

Run: `bash web/tools/run-offline-gate.sh /tmp/offline-gate-nosw --no-sw`
Expected:
- `PASS O2`, `FAIL` for O1, O3, O4, O5 and O6, and `PASS no Emscripten abort`;
- the run ends `--- offline-gate --no-sw: 5 FAILED ---`;
- exit status 1.

Why O5 and O6 fail: with no worker there is no registration and no copy, so O5's eval throws before it logs anything and O6 finds no copy.

This proves each check can fail. It is slow, because the `until` steps time out.

- [ ] **Step 7: Confirm the other browser gates are unchanged**

Use the branch's build in `web/dist-m1` (from Task 3 Step 7):

```bash
bash web/tools/run-browser-gates.sh /tmp/gates-offline
```

Then do the same on main's build. In the main checkout (`~/data/src/armagetronad-web`, on `main`), build with `make -f web/Makefile client -j8`. Run `GATE_HTTP_PORT=8208 GATE_DEVTOOLS_PORT=9422 bash web/tools/run-browser-gates.sh /tmp/gates-main`, then `diff /tmp/gates-main/summary.txt /tmp/gates-offline/summary.txt`.
Expected: no differences, apart from the known flake persist P11 (see docs/development.md). Record the diff in the ledger.

- [ ] **Step 8: Document it**

In `docs/development.md`, directly before `## Deploying to GitHub Pages`, add:

````markdown
## Offline play

The page can be installed to a home screen ("Install app" / "Add to Home
Screen"), and the installed app plays local games with no network once it
has been launched online once.

- **Who gets offline:** only the installed app. Its manifest
  (`web/pwa/manifest.json`) starts it as `armagetronad.html?app=1`, and the
  service worker (`web/sw.js`) serves the four game files from its copy only
  to a page opened with `app=1`. A plain browser tab always uses the network,
  so a deploy reaches website visitors immediately.
- **The copy is one build or nothing:** `web/tools/stamp-sw.mjs` writes each
  build's `sw.js` with the SHA-256 of the four files; the worker refuses a
  download that does not match (Pages publishes a deploy file by file) and
  tries again on the next visit.
- **Updates:** a deploy changes `sw.js`; the app saves the new copy in the
  background and switches to it once every window of the game is closed. No
  prompt, and a running game never has its files swapped.
- **The page's half:** `web/page/offline.js` registers the worker after the
  load event and logs `[PWA] ...` lines.
- **iOS:** an app added to the home screen has its own storage, separate from
  Safari: its name and settings start fresh.
- **Verify:** `bash web/tools/run-offline-gate.sh /tmp/offline-gate` (headless,
  a phone; needs a `make -f web/Makefile client` build). Its negative control
  is `--no-sw`, which must fail O1, O3, O4, O5 and O6.
- **Reset in a desktop browser:** DevTools → Application → Storage → Clear site
  data.
````

In `README.md`, at the end of `## Play it` (directly before `### Controls`), add:

```markdown
### Play offline

On a phone, install the page as an app: in Chrome, the menu's "Install app"
(or "Add to Home screen"); in Safari, Share → "Add to Home Screen". Open the
app once while online; after that it plays local games against the AI with
no network. Online play still needs a connection.
```

- [ ] **Step 9: Run the whole suite and commit**

Run: `node --test 'web/test/*.test.mjs'`
Expected: all pass (73).

```bash
git add web/tools/serve-switchable.mjs web/tools/offline-gate.steps web/tools/run-offline-gate.sh docs/development.md README.md
git commit -m "Offline: a gate that switches the server off and plays (with its negative control)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: On a real phone, after the merge (the maintainer)

Emulation is not a device, and installing an app cannot be done headless. After the PR is merged and the deploy has run:

- [ ] **Android, Chrome:**
  1. Open the site and use the menu's "Install app".
  2. Launch the app once online, wait for the menu, then close it.
  3. Switch to airplane mode and launch it again. Expected: it boots, and Single Player starts a game.
- [ ] **iOS, Safari:**
  1. Use Share → "Add to Home Screen".
  2. Launch the app once online, then do the same airplane-mode launch.
- [ ] **Fullscreen layout:** in the launched app (no browser bar), check that the layout fills the screen in portrait and landscape, and that the `?diag=1` readout still says `MATCH`. Diag needs a URL parameter, so open `armagetronad.html?app=1&diag=1` in the browser for this one check.
- [ ] **The next deploy, whatever it is:** launch the app online, close it, and launch it again. It should now run the new build. A browser tab has it immediately.

Anything that fails here becomes a new issue with the device, the OS version and what was seen.
