// web/page/offline.js: the page registers the installed app's offline copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule, readRepoFile } from './load-page-module.mjs';
import { PREFIX } from '../tools/stamp-sw.mjs';

const Offline = loadPageModule('web/page/offline.js', 'AAOffline');
const settle = () => new Promise((r) => setTimeout(r, 0));

// A fake worker: records postMessage, fires statechange when told.
const worker = (state) => {
  const w = { state, posted: [], on: {} };
  w.addEventListener = (t, fn) => { (w.on[t] = w.on[t] || []).push(fn); };
  w.postMessage = (m) => w.posted.push(m);
  w.become = (s) => { w.state = s; (w.on.statechange || []).forEach((fn) => fn()); };
  return w;
};

function page({ sw = true, loaded = true, register, controller = null, app = true, waiting = null,
                keys = ['aa-offline-abc123abc123', 'someone-else'], installing = null } = {}) {
  const logs = [], calls = [], listeners = {}, swOn = {}, regOn = {}, updates = [];
  let reloads = 0;
  const reg = { installing, waiting, addEventListener: (t, fn) => { regOn[t] = fn; } };
  const nav = sw ? { serviceWorker: {
    controller, ready: Promise.resolve(reg),
    register: register || ((url, opts) => { calls.push([url, { ...opts }]); return Promise.resolve(reg); }),
    addEventListener: (t, fn) => { swOn[t] = fn; },
  } } : {};
  const env = {
    nav, app, doc: { readyState: loaded ? 'complete' : 'interactive' },
    win: { addEventListener: (t, fn, o) => { listeners[t] = { fn, o: { ...o } }; },
           location: { reload: () => { reloads++; } } },
    caches: { keys: async () => keys }, log: (l) => logs.push(l),
    onUpdateReady: (apply) => updates.push(apply),
  };
  // A new build arriving after the page registered: updatefound, then installed.
  const arrive = () => { const w = worker('installing'); reg.installing = w; regOn.updatefound(); return w; };
  return { env, logs, calls, listeners, updates, reg, swOn, arrive, reloads: () => reloads };
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
  const w = worker('installing');
  const p = page({ installing: w, keys: [] });
  Offline.start(p.env);
  await settle(); await settle();
  w.become('redundant');
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

test('a new build that finished downloading in the background is offered, once', async () => {
  const p = page({ controller: {} });
  Offline.start(p.env);
  await settle(); await settle();
  assert.equal(p.updates.length, 0);
  const w = p.arrive();
  p.reg.waiting = w;            // the spec sets registration.waiting before the 'installed' statechange
  w.become('installed');
  assert.equal(p.updates.length, 1);
  w.become('installed');
  assert.equal(p.updates.length, 1, 'offered once');
});

test('a build already waiting when the app opens is offered straight away', async () => {
  const p = page({ controller: {}, waiting: worker('installed') });
  Offline.start(p.env);
  await settle(); await settle();
  assert.equal(p.updates.length, 1);
});

test('the first install is not an update, and a browser tab is never offered one', async () => {
  const first = page({ controller: null, waiting: worker('installed') });
  Offline.start(first.env);
  await settle(); await settle();
  first.arrive().become('installed');
  assert.equal(first.updates.length, 0, 'no controller yet: this is the first copy, nothing to restart into');
  const tab = page({ controller: {}, app: false, waiting: worker('installed') });
  Offline.start(tab.env);
  await settle(); await settle();
  assert.equal(tab.updates.length, 0, 'a tab is served by the network: it already runs the newest deploy');
});

test('the tap tells the waiting build to take over, and reloads once it has', async () => {
  const waiting = worker('installed');
  const p = page({ controller: {}, waiting });
  Offline.start(p.env);
  await settle(); await settle();
  assert.equal(p.updates[0](), true);
  assert.deepEqual(waiting.posted, ['aa-update']);
  assert.equal(p.reloads(), 0, 'not before the new worker controls the page');
  p.swOn.controllerchange();
  assert.equal(p.reloads(), 1);
});

test('the chip is for menus only: never while a cycle is alive, even behind the in-game menu', () => {
  const ctx = (menu, cycle) => ({ menu, cycle });
  assert.equal(Offline.offerUpdateNow(ctx(true, false)), true);
  assert.equal(Offline.offerUpdateNow(ctx(true, true)), false, 'Escape mid-round: the round is still on');
  assert.equal(Offline.offerUpdateNow(ctx(false, true)), false);
  assert.equal(Offline.offerUpdateNow(ctx(false, false)), false, 'loading, or between screens');
});

test('the page wires the chip: app flag, the handler, and the button', () => {
  const s = readRepoFile('web/shell.html');
  const order = s.slice(s.indexOf('---- THE START ORDER'));
  assert.match(order, /AAOffline\.start\(\{[^}]*app: /);
  assert.match(order, /onUpdateReady: AAOffline\.chip\(\{ el: document\.getElementById\('updatechip'\)/);
  assert.match(s, /<button type="button" id="updatechip"[^>]* hidden/);
});

test('the chip follows the game, and the tap switches over once', () => {
  let ctx = { menu: false, cycle: true }, tick = null, applied = 0;
  const el = { hidden: true, disabled: false, textContent: 'Update ready', on: {},
               addEventListener: (t, fn) => { el.on[t] = fn; } };
  const onReady = Offline.chip({ el, context: () => ctx, win: { setInterval: (fn) => { tick = fn; } } });
  onReady(() => { applied++; return applied === 1; });
  assert.equal(el.hidden, true, 'mid-round: hidden');
  ctx = { menu: true, cycle: false };
  tick();
  assert.equal(el.hidden, false, 'back in the menu: shown');
  el.on.click();
  assert.equal(applied, 1);
  assert.equal(el.disabled, true);
  ctx = { menu: false, cycle: true };
  tick();
  assert.equal(el.hidden, false, 'once tapped it stays, saying it is updating');
});
