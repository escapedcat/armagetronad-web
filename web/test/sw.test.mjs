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
  assert.ok(w.net.includes(SCOPE + 'armagetronad.wasm'), 'answered by the network (the refill is tested below)');
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

test('a copy that went missing is saved again by the next visit, tab or app', async () => {
  const w = await installed();
  await w.caches.delete(CACHE);
  const tab = w.get(SCOPE + 'armagetronad.wasm');
  assert.equal(await (await tab.response).text(), 'wasm v2', 'the tab is answered by the network as usual');
  await tab.waited;
  assert.deepEqual([...w.store.get(CACHE).keys()].sort(), [...PRECACHED].sort());
});

test('a complete copy is not downloaded again, and a missing one only once at a time', async () => {
  const w = await installed();
  await w.get(SCOPE + 'armagetronad.wasm').waited;
  assert.deepEqual(w.net, [SCOPE + 'armagetronad.wasm'], 'only the tab\'s own request');
  w.net.length = 0;
  await w.caches.delete(CACHE);
  const a = w.get(SCOPE + 'armagetronad.js');
  const b = w.get(SCOPE + 'armagetronad.data');
  await Promise.all([a.waited, b.waited]);
  assert.equal(w.net.length, 2 + PRECACHED.length, 'two own requests and one refill');
});
