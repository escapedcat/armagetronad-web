// M-C: what changes when the relay is reachable from the internet.
//
// Locally the relay binds 127.0.0.1 and trusts whoever can reach it, because
// only this machine can. Deployed, it is an open door into UDP 4533-4599 --
// a reflector anyone could aim at community game servers -- unless it checks
// who is asking. These tests pin the three rules that prevent that.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';
import { encode, decode, TYPE } from '../frame.mjs';
import { startRelay } from '../relay.mjs';

const TOKEN = 'test-token-0123456789';

function attempt(url) {
  return new Promise((res) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'nodebuffer';
    ws.once('open', () => res({ ok: true, ws }));
    ws.once('unexpected-response', (_req, r) => res({ ok: false, status: r.statusCode }));
    ws.once('error', () => res({ ok: false, status: 0 }));
  });
}

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => res({ status: r.statusCode, body }));
    }).on('error', rej);
  });
}

test('with a token set, a connection without it is refused before any WebSocket exists', async (t) => {
  const relay = startRelay({ port: 0, token: TOKEN });
  t.after(() => relay.close());
  await relay.ready;
  for (const path of ['/', '/wrong-token', '/' + TOKEN + 'x', '/' + TOKEN.slice(1)]) {
    const r = await attempt('ws://127.0.0.1:' + relay.port + path);
    assert.equal(r.ok, false, 'path ' + path + ' must not open a socket');
    assert.equal(r.status, 401, 'path ' + path + ' must be refused with 401');
  }
});

test('with the right token in the path, the relay works exactly as before', async (t) => {
  const relay = startRelay({ port: 0, token: TOKEN });
  t.after(() => relay.close());
  await relay.ready;
  const r = await attempt('ws://127.0.0.1:' + relay.port + '/' + TOKEN);
  assert.equal(r.ok, true, 'the right token must open a socket');
  t.after(() => r.ws.close());
  r.ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  const f = await new Promise((res) => r.ws.once('message', (d) => res(decode(Buffer.from(d)))));
  assert.equal(f.type, TYPE.BOUND);
  assert.equal(f.handle, 1);
});

test('the health endpoint answers without a token and opens no socket', async (t) => {
  const relay = startRelay({ port: 0, token: TOKEN });
  t.after(() => relay.close());
  await relay.ready;
  const r = await get('http://127.0.0.1:' + relay.port + '/health');
  assert.equal(r.status, 200);
  assert.equal(r.body, 'ok');
  assert.equal(relay.socketCount(), 0);
});

test('any other plain HTTP request gets 404, and never reveals whether a path is the token', async (t) => {
  const relay = startRelay({ port: 0, token: TOKEN });
  t.after(() => relay.close());
  await relay.ready;
  assert.equal((await get('http://127.0.0.1:' + relay.port + '/')).status, 404);
  assert.equal((await get('http://127.0.0.1:' + relay.port + '/' + TOKEN)).status, 404,
    'a plain GET on the token path must look like any other path');
});

test('the relay refuses to START on a public address without a token', () => {
  for (const host of ['0.0.0.0', '::', '10.1.2.3']) {
    assert.throws(() => startRelay({ port: 0, host }), /token/,
      host + ' without a token must refuse to start');
  }
});

test('a token too short to be a secret is refused', () => {
  assert.throws(() => startRelay({ port: 0, host: '0.0.0.0', token: 'short' }), /token/);
});

test('without a token on loopback, behaviour is unchanged: any path connects', async (t) => {
  const relay = startRelay({ port: 0 });
  t.after(() => relay.close());
  await relay.ready;
  const r = await attempt('ws://127.0.0.1:' + relay.port + '/anything');
  assert.equal(r.ok, true);
  r.ws.close();
});
