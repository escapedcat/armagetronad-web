import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { WebSocket } from 'ws';
import { encode, decode, TYPE } from '../frame.mjs';
import { startRelay } from '../relay.mjs';

// A stand-in for a game server: echoes every datagram back with "pong:" in
// front, from the same port it was addressed on.
async function echoServer(port) {
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => {
    sock.send(Buffer.concat([Buffer.from('pong:'), msg]), rinfo.port, rinfo.address);
  });
  await new Promise((res) => sock.bind(port, '127.0.0.1', res));
  return sock;
}

function open(url) {
  const ws = new WebSocket(url);
  ws.binaryType = 'nodebuffer';
  return new Promise((res, rej) => { ws.once('open', () => res(ws)); ws.once('error', rej); });
}

function next(ws) {
  return new Promise((res) => ws.once('message', (d) => res(decode(Buffer.from(d)))));
}

test('BIND is answered with BOUND for the same handle', async (t) => {
  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.BIND, handle: 3, port: 0, addr: '' }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.BOUND);
  assert.equal(f.handle, 3);
});

// THIS TEST NEEDS UDP 4534 AND THE aa-dedicated CONTAINER PUBLISHES IT. With
// `aa-server` running, this bind fails with EADDRINUSE inside the test's setup,
// and node --test reports that as NINE CANCELLED TESTS with "Promise resolution
// is still pending but the event loop has already resolved" -- a message that
// points nowhere near the cause. `docker stop aa-server` before `npm test`.
test('a datagram reaches the server and the reply comes back with the address echoed', async (t) => {
  const server = await echoServer(4534);
  t.after(() => server.close());
  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());

  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);

  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4534, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.DATA);
  assert.equal(f.handle, 1);
  assert.equal(f.port, 4534);
  assert.equal(f.addr, '127.0.0.1', 'the address must be echoed as the client wrote it');
  assert.equal(f.payload.toString(), 'pong:ping');
});

test('a hostname is resolved to send but echoed back exactly as the client wrote it', async (t) => {
  const server = await echoServer(4536);
  t.after(() => server.close());
  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());

  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);

  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4536, addr: 'localhost', payload: Buffer.from('ping') }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.DATA);
  assert.equal(f.payload.toString(), 'pong:ping');
  assert.equal(f.addr, 'localhost', 'the browser client cannot resolve names, so the text it sent is the only thing it can match a reply against');
});

test('two handles get two different source ports, as two native clients would', async (t) => {
  const seen = new Set();
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => { seen.add(rinfo.port); sock.send('ok', rinfo.port, rinfo.address); });
  await new Promise((res) => sock.bind(4535, '127.0.0.1', res));
  t.after(() => sock.close());

  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());

  for (const handle of [1, 2]) {
    ws.send(encode({ type: TYPE.BIND, handle, port: 0, addr: '' }));
    assert.equal((await next(ws)).type, TYPE.BOUND);
    ws.send(encode({ type: TYPE.DATA, handle, port: 4535, addr: '127.0.0.1', payload: Buffer.from('x') }));
    await next(ws);
  }
  assert.equal(seen.size, 2, 'each handle must have its own UDP source port');
});

// --------------------------------------------------------------------------
// THE ECHO TOKEN AND THE DNS CACHE. Two defects found in the final review of
// this branch, both latent in M-A (one server at a time) and both live at M-B,
// where the server browser pings twenty servers through one socket.
//
// PORTS 4540/4541: 4534-4539 are all spoken for above, and two tests racing
// for one UDP port makes this file order-dependent.
// --------------------------------------------------------------------------

test('two host names on one IP do not get each other\'s replies', async (t) => {
  const server = await echoServer(4540);
  t.after(() => server.close());
  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);

  // 'localhost' first, so that it is the older entry: the reverse scan this
  // replaced walked insertion order and would answer BOTH with 'localhost'.
  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4540, addr: 'localhost', payload: Buffer.from('a') }));
  assert.equal((await next(ws)).addr, 'localhost');

  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4540, addr: '127.0.0.1', payload: Buffer.from('b') }));
  const f = await next(ws);
  assert.equal(f.payload.toString(), 'pong:b');
  assert.equal(f.addr, '127.0.0.1',
    'the echo must name the destination this datagram was sent to, not some other name that happens to share its IP');
});

test('a destination the policy refuses is not left behind in the DNS cache', async (t) => {
  let lookups = 0;
  const relay = startRelay({
    port: 0, allowPrivate: false,
    lookup: async (host) => { ++lookups; return '127.0.0.1'; },
  });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);

  for (const n of [1, 2]) {
    ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4541, addr: 'tron.example.org', payload: Buffer.from('x') }));
    const f = await next(ws);
    assert.equal(f.type, TYPE.ERROR, 'attempt ' + n + ' must be refused');
  }
  assert.equal(lookups, 2,
    'a name the policy refused must not be cached: caching before the check filled the cache with destinations the relay will never send to');
});

test('a destination the policy refuses produces ERROR and sends nothing', async (t) => {
  const relay = startRelay({ port: 0, allowPrivate: false });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);
  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4534, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.ERROR);
  assert.match(f.payload.toString(), /not allowed/);
});

test('DATA on a handle that was never bound produces ERROR, not a crash', async (t) => {
  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.DATA, handle: 42, port: 4534, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.ERROR);
  assert.match(f.payload.toString(), /handle/);
});

test('closing the WebSocket releases every UDP socket it held', async (t) => {
  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);
  assert.equal(relay.socketCount(), 1);
  ws.close();
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(relay.socketCount(), 0);
});

test('a garbled frame is dropped without killing the connection', async (t) => {
  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(Buffer.from([0xff, 0xff, 0xff]));
  ws.send(encode({ type: TYPE.BIND, handle: 5, port: 0, addr: '' }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.BOUND, 'the connection must survive a bad frame');
  assert.equal(f.handle, 5);
});

// --------------------------------------------------------------------------
// THE LOSS OPTION. A testing aid and nothing else: it exists so a gate can
// ask what the game does when datagrams go missing, which is the question
// WebSocket-over-TCP makes interesting -- a lost segment stalls everything
// queued behind it, so the game's own resend layer is what has to cope.
//
// PORTS 4538/4539 AND NOT 4536/4537. 4536 is already the echo server in
// "a hostname is resolved to send but echoed back exactly as the client
// wrote it" above; reusing it here makes the file order-dependent, because
// two tests would race for the same UDP port.
// --------------------------------------------------------------------------

test('--drop 1 discards every datagram in both directions', async (t) => {
  const server = await echoServer(4538);
  t.after(() => server.close());
  const relay = startRelay({ port: 0, allowPrivate: true, drop: 1 });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  // BIND/BOUND is control traffic and must NOT be dropped: the option models
  // a lossy network path, not a broken relay, and a client that cannot bind
  // is not the situation being measured.
  assert.equal((await next(ws)).type, TYPE.BOUND);
  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4538, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  const timeout = new Promise((res) => setTimeout(() => res('nothing'), 300));
  assert.equal(await Promise.race([next(ws).then(() => 'reply'), timeout]), 'nothing');
  assert.ok(relay.droppedCount() > 0, 'the relay must own up to having discarded something');
});

test('drop 0 is the default and passes everything', async (t) => {
  const server = await echoServer(4539);
  t.after(() => server.close());
  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);
  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4539, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  assert.equal((await next(ws)).payload.toString(), 'pong:ping');
  assert.equal(relay.droppedCount(), 0, 'nothing may be discarded when the option is not asked for');
});
