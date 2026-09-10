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
