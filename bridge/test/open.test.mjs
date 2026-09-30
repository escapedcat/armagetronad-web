// M-C: the relay open to every visitor of the published page, with no token.
//
// What makes that safe is pinned here, end to end through a real WebSocket:
// the Origin allowlist decides who may connect without a token, and the limits
// hold every connection -- tokened or not -- to a player's worth of traffic.
//
// UDP 4590-4592 are this file's; the other test files use 4533-4549.
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { WebSocket } from 'ws';
import { encode, decode, TYPE } from '../frame.mjs';
import { startRelay } from '../relay.mjs';

const TOKEN = 'test-token-0123456789';
const PAGE = 'https://escapedcat.github.io';

function attempt(url, headers = {}) {
  return new Promise((res) => {
    const ws = new WebSocket(url, { headers });
    ws.binaryType = 'nodebuffer';
    ws.once('open', () => res({ ok: true, ws }));
    ws.once('unexpected-response', (_req, r) => res({ ok: false, status: r.statusCode }));
    ws.once('error', () => res({ ok: false, status: 0 }));
  });
}
// Bounded, so a frame that never comes fails the test instead of hanging it.
const next = (ws, ms = 2000) => new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error('no frame within ' + ms + ' ms')), ms);
  ws.once('message', (d) => { clearTimeout(timer); res(decode(Buffer.from(d))); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function counter(port) {
  const sock = dgram.createSocket('udp4');
  sock.received = 0;
  sock.on('message', () => { sock.received++; });
  await new Promise((res) => sock.bind(port, '127.0.0.1', res));
  return sock;
}

async function openRelay(t, opts) {
  const relay = startRelay({ port: 0, ...opts });
  t.after(() => relay.close());
  await relay.ready;
  return relay;
}

async function bound(t, relay, headers = { origin: PAGE }) {
  const r = await attempt('ws://127.0.0.1:' + relay.port + '/', headers);
  assert.equal(r.ok, true, 'setup: the connection must open');
  t.after(() => r.ws.close());
  r.ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(r.ws)).type, TYPE.BOUND);
  return r.ws;
}

test('a public relay with an origin allowlist and no token is allowed to start', (t) => {
  const relay = startRelay({ port: 0, host: '0.0.0.0', origins: [PAGE] });
  t.after(() => relay.close());
});

test('an empty origin list does not count as a rule', () => {
  assert.throws(() => startRelay({ port: 0, host: '0.0.0.0', origins: [] }), /allowlist/);
});

test('with an allowlist, the listed page connects without a token', async (t) => {
  const relay = await openRelay(t, { origins: [PAGE] });
  const r = await attempt('ws://127.0.0.1:' + relay.port + '/', { origin: PAGE });
  assert.equal(r.ok, true);
  r.ws.close();
});

test('any other page, or no Origin at all, is refused with 403', async (t) => {
  const relay = await openRelay(t, { origins: [PAGE] });
  for (const origin of ['https://evil.test', 'http://escapedcat.github.io', 'null', undefined]) {
    const r = await attempt('ws://127.0.0.1:' + relay.port + '/', origin === undefined ? {} : { origin });
    assert.equal(r.ok, false, 'origin ' + origin + ' must not open a socket');
    assert.equal(r.status, 403, 'origin ' + origin + ' must be refused with 403');
  }
});

test('with both, the token still works from anywhere and a wrong token path is still 401', async (t) => {
  const relay = await openRelay(t, { origins: [PAGE], token: TOKEN });
  const good = await attempt('ws://127.0.0.1:' + relay.port + '/' + TOKEN, { origin: 'https://evil.test' });
  assert.equal(good.ok, true, 'a token holder is not bound to the allowlist');
  good.ws.close();
  const bad = await attempt('ws://127.0.0.1:' + relay.port + '/wrong-token', { origin: PAGE });
  assert.equal(bad.status, 401, 'the allowlist admits the bare path only, not any path');
});

test('one client IP gets perIp connections; the next is refused with 429, and closing one frees a slot', async (t) => {
  const relay = await openRelay(t, { origins: [PAGE], limits: { perIp: 2 } });
  const url = 'ws://127.0.0.1:' + relay.port + '/';
  const a = await attempt(url, { origin: PAGE });
  const b = await attempt(url, { origin: PAGE });
  assert.equal(a.ok && b.ok, true);
  const c = await attempt(url, { origin: PAGE });
  assert.equal(c.status, 429);
  a.ws.close();
  await sleep(100);
  const d = await attempt(url, { origin: PAGE });
  assert.equal(d.ok, true, 'a closed connection must give its slot back');
  b.ws.close(); d.ws.close();
});

test('behind a proxy, the per-IP limit counts the address in the client-IP header', async (t) => {
  const relay = await openRelay(t, { origins: [PAGE], limits: { perIp: 1 }, clientIpHeader: 'Fly-Client-IP' });
  const url = 'ws://127.0.0.1:' + relay.port + '/';
  const a = await attempt(url, { origin: PAGE, 'fly-client-ip': '203.0.113.1' });
  const b = await attempt(url, { origin: PAGE, 'fly-client-ip': '203.0.113.2' });
  assert.equal(a.ok && b.ok, true, 'two players behind the same proxy are two addresses');
  const c = await attempt(url, { origin: PAGE, 'fly-client-ip': '203.0.113.1' });
  assert.equal(c.status, 429);
  a.ws.close(); b.ws.close();
});

test('past the total, every further connection is refused with 503', async (t) => {
  const relay = await openRelay(t, { origins: [PAGE], limits: { total: 2, perIp: 10 } });
  const url = 'ws://127.0.0.1:' + relay.port + '/';
  const a = await attempt(url, { origin: PAGE });
  const b = await attempt(url, { origin: PAGE });
  const c = await attempt(url, { origin: PAGE });
  assert.equal(c.status, 503);
  a.ws.close(); b.ws.close();
});

test('one connection may hold socketsPerConnection sockets and no more', async (t) => {
  const relay = await openRelay(t, { origins: [PAGE], limits: { socketsPerConnection: 2 } });
  const ws = await bound(t, relay); // handle 1
  ws.send(encode({ type: TYPE.BIND, handle: 2, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);
  ws.send(encode({ type: TYPE.BIND, handle: 3, port: 0, addr: '' }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.ERROR);
  assert.match(f.payload.toString(), /too many sockets/);
  ws.send(encode({ type: TYPE.CLOSE, handle: 2, port: 0, addr: '' }));
  ws.send(encode({ type: TYPE.BIND, handle: 3, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND, 'closing one frees its place');
});

test('datagrams past the packet burst are dropped, not sent, and counted', async (t) => {
  const server = await counter(4590);
  t.after(() => server.close());
  const relay = await openRelay(t, { origins: [PAGE], allowPrivate: true,
    limits: { packetsPerSecond: 0.001, packetBurst: 5 } });
  const ws = await bound(t, relay);
  for (let i = 0; i < 20; i++) {
    ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4590, addr: '127.0.0.1', payload: Buffer.from('x') }));
  }
  await sleep(300);
  assert.equal(server.received, 5, 'exactly the burst reaches the server');
  assert.equal(relay.limitedCount(), 15);
});

test('datagrams past the byte burst are dropped too', async (t) => {
  const server = await counter(4591);
  t.after(() => server.close());
  const relay = await openRelay(t, { origins: [PAGE], allowPrivate: true,
    limits: { bytesPerSecond: 0.001, byteBurst: 1000 } });
  const ws = await bound(t, relay);
  for (let i = 0; i < 5; i++) {
    ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4591, addr: '127.0.0.1', payload: Buffer.alloc(400) }));
  }
  await sleep(300);
  assert.equal(server.received, 2, 'two 400-byte datagrams fit in 1000 bytes, the third does not');
  assert.equal(relay.limitedCount(), 3);
});

test('a new destination past the per-minute cap is refused with an ERROR; known ones keep working', async (t) => {
  const server = await counter(4592);
  t.after(() => server.close());
  const lookups = [];
  const relay = await openRelay(t, { origins: [PAGE], allowPrivate: true,
    limits: { destinationsPerMinute: 2 },
    lookup: async (h) => { lookups.push(h); return '127.0.0.1'; } });
  const ws = await bound(t, relay);
  const send = (addr) => ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4592, addr, payload: Buffer.from('x') }));
  send('one.test'); send('two.test');
  await sleep(150);
  send('three.test');
  const f = await next(ws);
  assert.equal(f.type, TYPE.ERROR);
  assert.match(f.payload.toString(), /too many new destinations/);
  send('one.test');
  await sleep(150);
  assert.equal(server.received, 3, 'one.test twice and two.test once; three.test never sent');
  assert.deepEqual(lookups, ['one.test', 'two.test'], 'the refused name was never even resolved');
});
