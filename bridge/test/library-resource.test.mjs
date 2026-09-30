import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, '..', '..', 'web', f), 'utf8');
const bridgeSource = src('library_bridge.js');
const resourceSource = src('library_resource.js');

function load({ search = '?bridge=ws://127.0.0.1:8010', hostname = '127.0.0.1', fetchImpl } = {}) {
  const heap = new Uint8Array(4096);
  let next = 1024;
  const freed = [];
  const logged = [];
  const sandbox = {
    mergeInto: (target, obj) => Object.assign(target, obj),
    LibraryManager: { library: {} },
    console: { log: (...a) => logged.push(a.join(' ')) },
    location: { search, hostname },
    URLSearchParams, URL, AbortController, setTimeout, clearTimeout,
    fetch: fetchImpl,
    HEAPU8: heap,
    HEAP32: new Int32Array(heap.buffer),
    UTF8ToString: (p) => sandbox._strings[p],
    _malloc: (n) => { const p = next; next += n; return p; },
    // Asyncify as it really behaves: the import is CALLED TWICE. The first
    // call starts the async work and unwinds (handleAsync returns nothing);
    // when the work is done the stack rewinds and the import body runs AGAIN,
    // and only this second handleAsync returns the result. Anything the body
    // does outside the async function therefore happens twice -- the first
    // gate run of this feature saved an empty map because of exactly that.
    Asyncify: {
      pending: null, done: false, value: undefined,
      handleAsync(f) {
        if (this.done) { this.done = false; return this.value; }
        this.pending = f().then((v) => { this.value = v; this.done = true; });
        return undefined;
      },
    },
    _strings: {},
  };
  const names = Object.keys(sandbox);
  // Emscripten turns each $-dep into a top-level var the entry points close
  // over, so the vars are declared in the SAME scope that evaluates the
  // library sources -- the pattern library-bridge.test.mjs documents.
  const built = new Function(...names, bridgeSource + resourceSource + `
    var AABridge = LibraryManager.library.$AABridge;
    var AAResource = LibraryManager.library.$AAResource;
    return {
      lib: LibraryManager.library,
      call: (name, args) => LibraryManager.library[name].apply(null, args),
    };
  `)(...names.map((n) => sandbox[n]));
  const lib = built.lib;
  return {
    lib, heap, logged, freed,
    fetch: async (uri) => {
      sandbox._strings[1] = uri;
      const A = sandbox.Asyncify;
      const first = built.call('aa_resource_fetch', [1, 0, 4]);   // unwind
      assert.equal(first, undefined, 'the first call must only start the work');
      await A.pending;
      const status = built.call('aa_resource_fetch', [1, 0, 4]);  // rewind: the body runs again
      const i32 = new Int32Array(heap.buffer);
      const ptr = i32[0], len = i32[1];
      return { status, text: ptr ? Buffer.from(heap.subarray(ptr, ptr + len)).toString() : null, ptr, len };
    },
  };
}

test('the route is derived from the bridge URL: scheme, token path and all', () => {
  const { lib } = load();
  const ep = lib.$AAResource.endpoint;
  assert.equal(ep('wss://armagetronad-bridge.fly.dev/'), 'https://armagetronad-bridge.fly.dev/resource');
  assert.equal(ep('ws://127.0.0.1:8010'), 'http://127.0.0.1:8010/resource');
  assert.equal(ep('wss://relay.test/sometoken'), 'https://relay.test/sometoken/resource');
  assert.equal(ep(null), null);
  assert.equal(ep('junk'), null);
});

test('a 200 lands in a malloc\'d buffer with its length', async () => {
  let asked;
  const b = load({ fetchImpl: async (u) => { asked = u; return new Response('<Map/>', { status: 200 }); } });
  const r = await b.fetch('http://resource.armagetronad.net/resource/a/b/c-1.aamap.xml');
  assert.equal(r.status, 200);
  assert.equal(r.text, '<Map/>');
  assert.equal(asked, 'http://127.0.0.1:8010/resource?url=' +
    encodeURIComponent('http://resource.armagetronad.net/resource/a/b/c-1.aamap.xml'));
  assert.ok(b.logged.some((l) => l === '[RESOURCE] 200 http://resource.armagetronad.net/resource/a/b/c-1.aamap.xml'));
});

test('a refusal passes its status through and hands back no buffer', async () => {
  const b = load({ fetchImpl: async () => new Response('host not allowed', { status: 403 }) });
  const r = await b.fetch('http://evil.test/x.xml');
  assert.equal(r.status, 403);
  assert.equal(r.ptr, 0);
  assert.equal(r.len, 0);
  assert.ok(b.logged.includes('[RESOURCE] 403 http://evil.test/x.xml (host not allowed)'), b.logged.join('\n'));
});

test('a network failure resolves to 0, not a throw', async () => {
  const b = load({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal((await b.fetch('http://resource.armagetronad.net/resource/x-1.aamap.xml')).status, 0);
});

test('a fetch that exceeds the client timeout resolves to 0', async () => {
  const b = load({ fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  b.lib.$AAResource.TIMEOUT_MS = 50;
  assert.equal((await b.fetch('http://resource.armagetronad.net/resource/x-1.aamap.xml')).status, 0);
});

test('an offline page does not fetch at all', async () => {
  let called = false;
  const b = load({ search: '', hostname: 'localhost', fetchImpl: async () => { called = true; } });
  assert.equal((await b.fetch('http://resource.armagetronad.net/resource/x-1.aamap.xml')).status, 0);
  assert.equal(called, false);
});
