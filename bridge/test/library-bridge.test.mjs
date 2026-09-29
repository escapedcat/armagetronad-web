// The BROWSER end of the wire, tested from Node.
//
// web/library_bridge.js is an Emscripten JS library: it is handed to emcc with
// --js-library and never imported. But it is one half of a two-ended protocol
// whose other half is tested here, and the two halves have to agree byte for
// byte, so it is loaded the way emcc's jsifier does -- a `mergeInto` that
// copies the object into a library table -- and driven directly.
//
// The globals below stand in for the ones emcc's generated JS puts in scope:
// UTF8ToString, stringToUTF8, HEAPU8 and HEAP32 (verified present at top level
// in the linked armagetronad.js), plus a WebSocket that records what it sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encode, decode, TYPE } from '../frame.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const librarySource = readFileSync(join(here, '..', '..', 'web', 'library_bridge.js'), 'utf8');

// A fresh bridge per test: the library keeps module-lifetime state, and a test
// that inherited another's queues would be testing the order they ran in.
//
// `var AABridge` is declared inside the same function scope as the library
// body, because that is how emcc's output has it -- a top-level var the entry
// points close over. So the entry points must be CALLED from that scope too,
// which is what the returned `call` does.
function loadBridge({ open = true } = {}) {
  const sent = [];
  const logged = [];
  const heap = new Uint8Array(1024);
  // aa_bridge_send reads its address through UTF8ToString; the tests choose
  // what that returns, which is what `callWithAddr` below sets.
  let addrText = '0.0.0.0';
  const sandbox = {
    mergeInto: (target, obj) => Object.assign(target, obj),
    LibraryManager: { library: {} },
    console: { log: (...a) => logged.push(a.join(' ')) },
    location: { search: '?bridge=ws://127.0.0.1:8010' },
    URLSearchParams,
    HEAPU8: heap,
    HEAP32: new Int32Array(heap.buffer),
    UTF8ToString: () => addrText,
    stringToUTF8: () => 0,
  };
  const names = Object.keys(sandbox);
  const built = new Function(...names, librarySource + `
    var AABridge = LibraryManager.library.$AABridge;
    return {
      AB: AABridge,
      call: (name, args) => LibraryManager.library[name].apply(null, args),
    };
  `)(...names.map((n) => sandbox[n]));

  built.AB.ws = { readyState: 1, send: (b) => sent.push(Buffer.from(b)) };
  built.AB.state = open ? 1 : 2;
  const call = (n, ...a) => built.call(n, a);
  return {
    AB: built.AB,
    call,
    // aa_bridge_send( handle, addrPtr, port, bufPtr, len ) with the address
    // supplied as text rather than as a heap pointer
    callWithAddr: (n, handle, addr, port, len) => { addrText = addr; return call(n, handle, 0, port, 0, len); },
    sent,
    logged,
  };
}

test('the frame builder is byte-identical to the relay codec', () => {
  const { AB } = loadBridge();
  const cases = [
    { type: TYPE.BIND, handle: 1, port: 0, addr: '', payload: null },
    { type: TYPE.CLOSE, handle: 65535, port: 0, addr: '', payload: null },
    { type: TYPE.DATA, handle: 7, port: 4534, addr: '127.0.0.1', payload: Buffer.from([0, 1, 2, 255, 128]) },
    { type: TYPE.DATA, handle: 300, port: 65535, addr: 'tron.example.org', payload: Buffer.from('hello') },
    { type: TYPE.DATA, handle: 0, port: 4599, addr: 'a'.repeat(253), payload: Buffer.alloc(1400, 0xab) },
  ];
  for (const c of cases) {
    const mine = Buffer.from(AB.frame(c.type, c.handle, c.port, c.addr, c.payload ? new Uint8Array(c.payload) : null));
    assert.deepEqual([...mine], [...encode(c)], 'type ' + c.type + ' handle ' + c.handle);
  }
});

test('a BOUND frame resolves the outstanding bind', () => {
  const ctx = loadBridge();
  ctx.call('aa_bridge_bind', 3);
  assert.equal(decode(ctx.sent[0]).type, TYPE.BIND);
  assert.equal(ctx.call('aa_bridge_bound', 3), 0, 'pending until answered');
  ctx.AB.onmessage({ data: encode({ type: TYPE.BOUND, handle: 3, port: 51234, addr: '' }) });
  assert.equal(ctx.call('aa_bridge_bound', 3), 1);
  assert.equal(ctx.AB.binding[3], undefined, 'no longer outstanding');
});

// THE REGRESSION THIS FILE EXISTS FOR. relay.mjs answers a DATA frame it cannot
// deliver with ERROR, and the frame carries no request id. The first version of
// the library wrote bound[handle] = -1 for any ERROR whose bound entry was
// undefined -- which is precisely the state a BIND in flight is in.
test('an ERROR provoked by a datagram cannot fail a bind that is still in flight', () => {
  const ctx = loadBridge();
  ctx.call('aa_bridge_bind', 4);
  // the game got a socket earlier, sent on it, and is now re-binding: a DATA
  // error for this handle can still be in flight
  ctx.call('aa_bridge_send', 4, 0, 0, 0, 0);
  ctx.AB.onmessage({ data: encode({ type: TYPE.ERROR, handle: 4, port: 0, addr: '', payload: Buffer.from('port 0 is outside the allowed range 4533-4599') }) });

  assert.equal(ctx.call('aa_bridge_bound', 4), 0, 'the bind is still pending, not refused');
  assert.equal(ctx.AB.binding[4], 1, 'still outstanding');
  assert.equal(ctx.AB.dataErrors, 1, 'recorded separately');
  assert.match(ctx.AB.lastDataError, /outside the allowed range/);

  // and the real answer still lands
  ctx.AB.onmessage({ data: encode({ type: TYPE.BOUND, handle: 4, port: 40404, addr: '' }) });
  assert.equal(ctx.call('aa_bridge_bound', 4), 1);
});

test('an ERROR that can only be the bind\'s own answer does refuse it', () => {
  const ctx = loadBridge();
  ctx.call('aa_bridge_bind', 5);
  // relay.mjs's only BIND failure: 'handle N is already bound'. Nothing has
  // been sent on this handle since the BIND, so this ERROR must be its answer.
  ctx.AB.onmessage({ data: encode({ type: TYPE.ERROR, handle: 5, port: 0, addr: '', payload: Buffer.from('handle 5 is already bound') }) });
  assert.equal(ctx.call('aa_bridge_bound', 5), -1);
  assert.equal(ctx.AB.dataErrors, 0);
  assert.ok(ctx.logged.some((l) => l.includes('bind refused on handle 5')));
});

test('an ERROR arriving after a close does not resurrect the handle', () => {
  const ctx = loadBridge();
  ctx.call('aa_bridge_bind', 6);
  ctx.AB.onmessage({ data: encode({ type: TYPE.BOUND, handle: 6, port: 1234, addr: '' }) });
  ctx.call('aa_bridge_close', 6);
  ctx.AB.onmessage({ data: encode({ type: TYPE.ERROR, handle: 6, port: 0, addr: '', payload: Buffer.from('handle 6 is not bound') }) });
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.AB.bound, 6), false);
  assert.equal(ctx.AB.dataErrors, 1);
});

test('a bind with no socket to send it on fails at once rather than hanging', () => {
  const ctx = loadBridge({ open: false });
  ctx.call('aa_bridge_bind', 7);
  assert.equal(ctx.call('aa_bridge_bound', 7), -1);
  assert.equal(ctx.sent.length, 0, 'nothing was sent');
});

test('a DATA frame lands in the handle\'s queue with the address text intact', () => {
  const ctx = loadBridge();
  ctx.call('aa_bridge_bind', 9);
  ctx.AB.onmessage({ data: encode({ type: TYPE.BOUND, handle: 9, port: 5555, addr: '' }) });
  ctx.AB.onmessage({ data: encode({ type: TYPE.DATA, handle: 9, port: 4534, addr: 'server.example.org', payload: Buffer.from([9, 8, 7]) }) });
  const q = ctx.AB.queues[9];
  assert.equal(q.length, 1);
  assert.equal(q[0].addr, 'server.example.org');
  assert.equal(q[0].port, 4534);
  assert.deepEqual([...q[0].bytes], [9, 8, 7]);
});

test('a frame that is short, truncated or from another version is ignored', () => {
  const ctx = loadBridge();
  const good = encode({ type: TYPE.DATA, handle: 9, port: 4534, addr: 'abcd', payload: Buffer.from([1]) });
  ctx.AB.onmessage({ data: good.subarray(0, 4) });          // too short
  ctx.AB.onmessage({ data: good.subarray(0, 8) });          // address truncated
  const wrongVersion = Buffer.from(good); wrongVersion[0] = 2;
  ctx.AB.onmessage({ data: wrongVersion });
  assert.equal(ctx.AB.queues[9], undefined, 'nothing was queued');
});

// A handle the client closed has no queue. Re-creating one here would leave a
// queue nothing drains, and aa_bridge_pending() sums every queue -- so
// eWebNet::Poll would stop yielding and the game loop would hot-spin for ever.
test('a datagram for a handle with no live queue is dropped, not queued', () => {
  const ctx = loadBridge();
  ctx.call('aa_bridge_bind', 2);
  ctx.AB.onmessage({ data: encode({ type: TYPE.BOUND, handle: 2, port: 5555, addr: '' }) });
  ctx.call('aa_bridge_close', 2);

  ctx.AB.onmessage({ data: encode({ type: TYPE.DATA, handle: 2, port: 4534, addr: '127.0.0.1', payload: Buffer.from([1, 2, 3]) }) });
  ctx.AB.onmessage({ data: encode({ type: TYPE.DATA, handle: 77, port: 4534, addr: '127.0.0.1', payload: Buffer.from([4]) }) });

  assert.equal(Object.prototype.hasOwnProperty.call(ctx.AB.queues, 2), false, 'no queue recreated for the closed handle');
  assert.equal(Object.prototype.hasOwnProperty.call(ctx.AB.queues, 77), false, 'none for a handle never bound either');
  assert.equal(ctx.AB.dropped, 2);
  assert.equal(ctx.call('aa_bridge_pending'), 0, 'pending stays zero, so eWebNet::Poll keeps yielding');
});

// ws.send throws InvalidStateError on a CLOSING socket, and AABridge.state is
// still 1 until onclose fires. A throw out of a JS library function lands in
// wasm mid-Asyncify.
test('a WebSocket that throws on send does not throw at C++', () => {
  const ctx = loadBridge();
  ctx.AB.ws.send = () => { throw new DOMException('still in CLOSING state', 'InvalidStateError'); };

  assert.doesNotThrow(() => ctx.call('aa_bridge_bind', 11));
  assert.equal(ctx.call('aa_bridge_bound', 11), -1, 'the bind failed rather than hanging');
  assert.equal(ctx.AB.state, 2, 'the socket is marked dead');
  assert.equal(ctx.AB.sendFailures, 1);

  assert.doesNotThrow(() => ctx.call('aa_bridge_close', 11));
  assert.doesNotThrow(() => ctx.call('aa_bridge_send', 11, 0, 4534, 0, 0));
});

test('an address too long for the one-byte length field is refused, not truncated', () => {
  const ctx = loadBridge();
  ctx.call('aa_bridge_bind', 12);
  ctx.AB.onmessage({ data: encode({ type: TYPE.BOUND, handle: 12, port: 5555, addr: '' }) });
  const sentBefore = ctx.sent.length;

  // 256 characters: out[6] would wrap to 0 and the relay would read the
  // payload as part of the address. frame.mjs throws RangeError on the same
  // input; this side cannot throw at wasm, so it returns -1.
  assert.throws(() => encode({ type: TYPE.DATA, handle: 12, port: 4534, addr: 'x'.repeat(256), payload: Buffer.alloc(0) }), /too long/);
  assert.equal(ctx.callWithAddr('aa_bridge_send', 12, 'x'.repeat(256), 4534, 0), -1);
  assert.equal(ctx.sent.length, sentBefore, 'nothing went on the wire');

  // 255 is still fine, and matches the relay byte for byte
  assert.equal(ctx.callWithAddr('aa_bridge_send', 12, 'y'.repeat(255), 4534, 0), 0);
  assert.deepEqual([...ctx.sent[ctx.sent.length - 1]],
                   [...encode({ type: TYPE.DATA, handle: 12, port: 4534, addr: 'y'.repeat(255), payload: Buffer.alloc(0) })]);
});

// The masks used to disagree: this side wrote charCodeAt & 0x7f, frame.mjs
// writes Buffer.from(addr, 'ascii'), and Node's 'ascii' does not touch the
// high bit.
test('a high-bit character in an address is encoded the same way at both ends', () => {
  const { AB } = loadBridge();
  const addr = 'caf\u00e9.example.org';
  assert.deepEqual([...Buffer.from(AB.frame(TYPE.DATA, 1, 4534, addr, null))],
                   [...encode({ type: TYPE.DATA, handle: 1, port: 4534, addr, payload: Buffer.alloc(0) })]);
  assert.ok([...Buffer.from(AB.frame(TYPE.DATA, 1, 4534, addr, null))].includes(0xe9), 'not masked down to 0x69');
});
