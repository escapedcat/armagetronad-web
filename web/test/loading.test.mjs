// web/page/loading.js: the loading bar counts the game's two big downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule } from './load-page-module.mjs';

const Loading = loadPageModule('web/page/loading.js', 'AALoading');
const SIZES = { 'armagetronad.wasm': 6, 'armagetronad.data': 4 };

// A window whose fetch serves `bodies` (name -> array of chunks), one chunk per
// pull, so a test can read a response part-way and look at the progress.
function page(bodies, { headers = { 'content-type': 'application/wasm', 'content-encoding': 'gzip' } } = {}) {
  const reports = [], requested = [];
  const win = {
    Response, ReadableStream,
    fetch: async (input, init) => {
      requested.push([String(input), init]);
      const name = String(input).split('/').pop().split('?')[0];
      if (!(name in bodies)) return new Response('other', { status: 200 });
      if (bodies[name] === 404) return new Response('nope', { status: 404, statusText: 'Not Found' });
      const chunks = bodies[name].map((n) => new Uint8Array(n));
      return new Response(new ReadableStream({
        pull(c) { if (chunks.length) c.enqueue(chunks.shift()); else c.close(); },
      }), { status: 200, headers });
    },
  };
  const report = (loaded, total, done) => reports.push({ loaded, total, done });
  return { win, reports, requested, report, last: () => reports[reports.length - 1] };
}

test('the bar counts both files against their real sizes, and is done only when both are in', async () => {
  const p = page({ 'armagetronad.wasm': [2, 4], 'armagetronad.data': [1, 3] });
  Loading.watch({ win: p.win, sizes: SIZES, onProgress: p.report });
  assert.deepEqual(p.last(), { loaded: 0, total: 10, done: false });

  const wasm = await p.win.fetch('armagetronad.wasm', { credentials: 'same-origin' });
  const data = await p.win.fetch('https://x.test/game/armagetronad.data');
  const r1 = wasm.body.getReader();
  await r1.read();                                   // 2 of 6
  assert.deepEqual(p.last(), { loaded: 2, total: 10, done: false });
  await data.arrayBuffer();                          // all 4
  assert.deepEqual(p.last(), { loaded: 6, total: 10, done: false });
  while (!(await r1.read()).done) { /* the rest */ }
  assert.deepEqual(p.last(), { loaded: 10, total: 10, done: true });
});

test('the wrapped response is the same response: status, headers, bytes', async () => {
  const p = page({ 'armagetronad.wasm': [3, 3], 'armagetronad.data': [4] });
  Loading.watch({ win: p.win, sizes: SIZES, onProgress: p.report });
  const res = await p.win.fetch('armagetronad.wasm', { credentials: 'same-origin' });
  assert.equal(res.status, 200);
  assert.equal(res.ok, true);
  assert.equal(res.headers.get('content-type'), 'application/wasm');   // instantiateStreaming needs it
  assert.equal((await res.arrayBuffer()).byteLength, 6);
  assert.deepEqual(p.requested[0], ['armagetronad.wasm', { credentials: 'same-origin' }]);
});

test('other requests pass through untouched and are not counted', async () => {
  const p = page({ 'armagetronad.wasm': [6], 'armagetronad.data': [4] });
  Loading.watch({ win: p.win, sizes: SIZES, onProgress: p.report });
  const n = p.reports.length;
  assert.equal(await (await p.win.fetch('sw.js')).text(), 'other');
  assert.equal(p.reports.length, n);
});

test('a file that ends up a different size than stamped still ends the bar at done', async () => {
  // Wrong stamp, or a cached copy from another build: never stall below 100 %.
  const p = page({ 'armagetronad.wasm': [5], 'armagetronad.data': [7] });
  Loading.watch({ win: p.win, sizes: SIZES, onProgress: p.report });
  await (await p.win.fetch('armagetronad.data')).arrayBuffer();
  assert.ok(p.last().loaded <= p.last().total, 'never past the end');
  await (await p.win.fetch('armagetronad.wasm')).arrayBuffer();
  assert.deepEqual(p.last(), { loaded: 10, total: 10, done: true });
});

test('a failed response is handed back as it is, for the loader to report', async () => {
  const p = page({ 'armagetronad.wasm': 404, 'armagetronad.data': [4] });
  Loading.watch({ win: p.win, sizes: SIZES, onProgress: p.report });
  const res = await p.win.fetch('armagetronad.wasm');
  assert.equal(res.status, 404);
  assert.equal(res.statusText, 'Not Found');
  assert.equal(p.last().done, false);
});

test('no stamped sizes (an unstamped build): no numbers, but done still arrives', async () => {
  const p = page({ 'armagetronad.wasm': [6], 'armagetronad.data': [4] });
  Loading.watch({ win: p.win, sizes: null, onProgress: p.report });
  await (await p.win.fetch('armagetronad.wasm')).arrayBuffer();
  assert.equal(p.last().total, 0);
  assert.equal(p.last().done, false);
  await (await p.win.fetch('armagetronad.data')).arrayBuffer();
  assert.deepEqual(p.last(), { loaded: 0, total: 0, done: true });
});

test('no fetch or no streams (an old browser): the page loads as before, bar left alone', () => {
  const reports = [];
  const win = { fetch: undefined };
  Loading.watch({ win, sizes: SIZES, onProgress: (...a) => reports.push(a) });
  assert.equal(win.fetch, undefined);
  assert.deepEqual(reports, []);
});

test('the unstamped placeholder string counts as no sizes', async () => {
  const p = page({ 'armagetronad.wasm': [6], 'armagetronad.data': [4] });
  Loading.watch({ win: p.win, sizes: '@AA_SIZES@', onProgress: p.report });
  assert.deepEqual(p.last(), { loaded: 0, total: 0, done: false });
});
