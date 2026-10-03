// ABUSE CONTROLS. Every web player reaches game servers from the relay's one
// address, so a server can't tell web players apart and an IP ban there hits
// all of them. The relay can: it sees each player's real address. These tests
// pin the three tools that use that:
//   - blockedClients: a player's real address the relay refuses outright;
//   - blockedServers: game servers whose owners asked not to receive web
//     players, which the relay will not send to;
//   - the "is playing on" log line, which ties a player's real address to a
//     server so an abuse report ("X at time T on my server") can be traced.
// Ports 4571-4574 are used only here (node --test runs files in parallel).
import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { WebSocket } from 'ws';
import { encode, decode, TYPE } from '../frame.mjs';
import { startRelay } from '../relay.mjs';

async function echoServer(port) {
  const sock = dgram.createSocket('udp4');
  sock.received = 0;
  sock.on('message', (msg, rinfo) => {
    sock.received++;
    sock.send(Buffer.concat([Buffer.from('pong:'), msg]), rinfo.port, rinfo.address);
  });
  await new Promise((res) => sock.bind(port, '127.0.0.1', res));
  return sock;
}

function attempt(url) {
  return new Promise((res) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'nodebuffer';
    ws.once('open', () => res({ ok: true, ws }));
    ws.once('unexpected-response', (_req, r) => res({ ok: false, status: r.statusCode }));
    ws.once('error', () => res({ ok: false, status: 0 }));
  });
}

function next(ws) {
  return new Promise((res) => ws.once('message', (d) => res(decode(Buffer.from(d)))));
}

async function bound(relay) {
  const r = await attempt('ws://127.0.0.1:' + relay.port);
  assert.ok(r.ok, 'the connection should open');
  r.ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(r.ws)).type, TYPE.BOUND);
  return r.ws;
}

test('a blocked player address is refused before any WebSocket exists', async (t) => {
  const lines = [];
  const relay = startRelay({ port: 0, allowPrivate: true, blockedClients: ['127.0.0.1'], log: (m) => lines.push(m) });
  t.after(() => relay.close());
  await relay.ready;
  const r = await attempt('ws://127.0.0.1:' + relay.port);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.ok(lines.some((l) => l.includes('refused a blocked player') && l.includes('127.0.0.1')), lines.join('\n'));
});

test('a player whose address is not on the list connects as before', async (t) => {
  const relay = startRelay({ port: 0, allowPrivate: true, blockedClients: ['203.0.113.7'] });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await bound(relay);
  t.after(() => ws.close());
});

test('a server that opted out gets nothing, and the client is told why', async (t) => {
  const server = await echoServer(4571);
  t.after(() => server.close());
  const relay = startRelay({ port: 0, allowPrivate: true, blockedServers: ['127.0.0.1:4571'] });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await bound(relay);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4571, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.ERROR);
  assert.match(f.payload.toString(), /does not take web players/);
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(server.received, 0, 'not one datagram may reach a server that opted out');
});

test('an entry without a port covers every port of that server; others still work', async (t) => {
  const blocked = await echoServer(4572);
  t.after(() => blocked.close());
  const relay = startRelay({ port: 0, allowPrivate: true, blockedServers: ['192.0.2.9', '127.0.0.1:4572'] });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await bound(relay);
  t.after(() => ws.close());
  // 192.0.2.9 (documentation range) with no port: any port is refused.
  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4573, addr: '192.0.2.9', payload: Buffer.from('ping') }));
  assert.equal((await next(ws)).type, TYPE.ERROR);
  // A server that is not listed is reached as before.
  const open = await echoServer(4573);
  t.after(() => open.close());
  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4573, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.DATA);
  assert.equal(f.payload.toString(), 'pong:ping');
});

test('a player who keeps sending to one server is logged once as playing there', async (t) => {
  const server = await echoServer(4574);
  t.after(() => server.close());
  const lines = [];
  const relay = startRelay({ port: 0, allowPrivate: true, log: (m) => lines.push(m) });
  t.after(() => relay.close());
  await relay.ready;
  const ws = await bound(relay);
  t.after(() => ws.close());
  const send = () => ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4574, addr: '127.0.0.1', payload: Buffer.from('x') }));
  for (let i = 0; i < 99; i++) send();
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(lines.filter((l) => l.includes('is playing on')).length, 0, 'a few datagrams (a server-browser ping) are not logged');
  for (let i = 0; i < 101; i++) send();
  await new Promise((res) => setTimeout(res, 300));
  const playing = lines.filter((l) => l.includes('is playing on'));
  assert.equal(playing.length, 1, playing.join('\n'));
  assert.match(playing[0], /127\.0\.0\.1 is playing on 127\.0\.0\.1:4574/);
});
