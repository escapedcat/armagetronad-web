// web/page/offline.js: the page registers the installed app's offline copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule, readRepoFile } from './load-page-module.mjs';
import { PREFIX } from '../tools/stamp-sw.mjs';

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

test('the page names the offline copy by the prefix the worker is stamped with', () => {
  assert.equal(Offline.PREFIX, PREFIX);
});
