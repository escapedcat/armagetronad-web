# M-A — Multiplayer Bridge (local only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser player joins a real Armagetron server and completes a round, by relaying the game's UDP through a WebSocket to a Node process on the maintainer's own machine.

**Architecture:** The game's socket layer is intercepted at its four syscall sites (`socket`, `recvfrom`, `sendto`, `select`) inside `src/network/nSocket.cpp`, behind `#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)`. A new client-only translation unit owns the address map; an Emscripten JS library owns the WebSocket and the receive queues; a ~200-line Node relay turns frames back into UDP datagrams. Nothing above the socket layer changes — `nNetwork.cpp`, `nServerInfo.cpp` and `gServerBrowser.cpp` are untouched, and any edit to them means the design went wrong.

**Tech Stack:** C++03-era game source, Emscripten 6.0.8 with `-sASYNCIFY=1`, Node 22 with `ws` and built-in `dgram`, `node --test` for the relay's tests, the repo's existing `web/tools/drive-browser.mjs` for browser gates.

**Spec:** `docs/superpowers/specs/2026-09-10-m-a-multiplayer-bridge-design.md`

## Global Constraints

- **Guard everything client-only with `#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)`.** Never bare `__EMSCRIPTEN__` — the dedicated server is an Emscripten build too.
- **The dedicated wasm must stay byte-identical: 2,488,298 bytes, md5 `9718a2a64978cb6e9b95ea2f0454cca5`** (Linux CI: 2,488,282 / `ecb69e50…`). CI enforces it on every push.
- **New C++ files go in `src/emscripten/`, never `src/network/`.** `$(SRCS)` in `web/Makefile` wildcards `src/network/*.cpp` into BOTH targets, and the Makefile's own comment states the trap: "an empty translation unit is not a non-existent one" — a guarded file there would still change the server's size. This corrects the spec's `src/network/nSocketWeb.{cpp,h}`; Task 6 fixes the spec text.
- **The WebSocket `onmessage` handler may only ENQUEUE.** It must never call into C++. The client runs under Asyncify; re-entering C++ from a JS event during an unwind corrupts the rewind, and the symptom is a random crash, not a network error.
- **No body line in `web/shell.html` may start with `#`** outside a `<style>` block — Emscripten's shell preprocessor reads it as a directive and the link fails.
- **Commits:** author `escapedcat <github@htmlcss.de>`; end the message with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`; never include a `claude.ai/code/session_…` URL. Messages containing backticks go through `git commit -F <file>`. Stage named paths only — never `git add -A` or `git add .`.
- **Do not change the desktop experience** to make the browser work (standing maintainer rule).
- **Do not connect to any third-party server** until Task 6, which stops for the maintainer's explicit go.

## Wire protocol (both ends implement this; it is the contract between Tasks 1 and 2)

Binary, big-endian, framed on the WebSocket in both directions:

```
byte 0      version  = 1
byte 1      type     = 1 BIND | 2 BOUND | 3 DATA | 4 CLOSE | 5 ERROR
bytes 2-3   handle   u16   client-allocated socket id
bytes 4-5   port     u16   destination port (client→bridge) / source port (bridge→client)
byte 6      addrLen  u8    length of the address field, 0-255
bytes 7..   addr     ASCII hostname or dotted quad, addrLen bytes
rest        payload  one UDP datagram (DATA frames only)
```

- `BIND` (client→bridge): claims `handle`. `addr` empty, `port` ignored. Bridge answers `BOUND` with the same handle, or `ERROR` whose payload is an ASCII reason.
- `DATA` client→bridge: send `payload` to `addr:port`. Bridge→client: `payload` arrived from `addr:port`, where `addr` is **the same text the client used**, echoed back — never a resolved IP.
- `CLOSE` (client→bridge): release `handle` and its UDP socket.

## File structure

| File | Responsibility |
|---|---|
| `bridge/frame.mjs` | encode/decode of the frame above. Pure, no I/O. |
| `bridge/policy.mjs` | destination rules: which resolved IP and port the relay will send to. Pure. |
| `bridge/relay.mjs` | the WebSocket server, one `dgram` socket per handle, DNS resolution, CLI. |
| `bridge/test/*.test.mjs` | `node --test` suites for the three above. |
| `bridge/package.json`, `bridge/README.md` | dependency on `ws`, how to run it. |
| `web/library_bridge.js` | Emscripten JS library: owns the `WebSocket`, the per-handle receive queues, and the enqueue-only handler. |
| `src/emscripten/eWebNet.{h,cpp}` | client-only C++: handle bookkeeping and the synthetic-address map. |
| `src/network/nSocket.cpp` | guarded interception at four syscall sites. |
| `web/Makefile` | `eWebNet.o` into `CLIENT_OBJS`, `--js-library` into `CLIENT_LDFLAGS`. |
| `web/tools/bridge-gate.steps` | the browser gate. |
| `docs/evidence/m-a-bridge/` | logs, screenshots, README. |

---

### Task 1: The relay, and its tests

The whole of this task is JavaScript. It touches no C++ and needs no browser, so it is tested directly with `node --test`.

**Files:**
- Create: `bridge/frame.mjs`, `bridge/policy.mjs`, `bridge/relay.mjs`, `bridge/package.json`, `bridge/README.md`
- Test: `bridge/test/frame.test.mjs`, `bridge/test/policy.test.mjs`, `bridge/test/relay.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the running relay `node bridge/relay.mjs --port 8010 [--allow-private]`, speaking the wire protocol above. Task 2's JS library is the other end of it. Exports used by tests: `encode({type,handle,port,addr,payload}) -> Buffer`, `decode(Buffer) -> {type,handle,port,addr,payload}`, `TYPE` (`{BIND:1,BOUND:2,DATA:3,CLOSE:4,ERROR:5}`), `checkDestination(ip, port, {allowPrivate}) -> string|null` (null means allowed), `startRelay({port, allowPrivate}) -> {close()}`.

- [ ] **Step 1: Create the package manifest**

`bridge/package.json`:

```json
{
  "name": "armagetronad-web-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "WebSocket-to-UDP relay that lets the browser client talk to stock Armagetron servers",
  "scripts": {
    "test": "node --test test/",
    "start": "node relay.mjs"
  },
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

Then run `cd bridge && npm install`. Expected: `ws` installed, `bridge/package-lock.json` created. Add `bridge/node_modules/` to the repo's `.gitignore` if it is not already covered; commit `bridge/package-lock.json`.

- [ ] **Step 2: Write the failing frame test**

`bridge/test/frame.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, TYPE, VERSION } from '../frame.mjs';

test('a DATA frame survives a round trip', () => {
  const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const f = decode(encode({ type: TYPE.DATA, handle: 7, port: 4534, addr: 'tron.example.org', payload }));
  assert.equal(f.type, TYPE.DATA);
  assert.equal(f.handle, 7);
  assert.equal(f.port, 4534);
  assert.equal(f.addr, 'tron.example.org');
  assert.deepEqual([...f.payload], [...payload]);
});

test('a BIND frame carries no address and no payload', () => {
  const f = decode(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal(f.type, TYPE.BIND);
  assert.equal(f.handle, 1);
  assert.equal(f.addr, '');
  assert.equal(f.payload.length, 0);
});

test('the header is exactly seven bytes before the address', () => {
  const buf = encode({ type: TYPE.DATA, handle: 0x0102, port: 0x0304, addr: 'ab', payload: Buffer.from([9]) });
  assert.deepEqual([...buf], [VERSION, TYPE.DATA, 0x01, 0x02, 0x03, 0x04, 2, 0x61, 0x62, 9]);
});

test('a truncated frame is rejected rather than half-decoded', () => {
  const buf = encode({ type: TYPE.DATA, handle: 1, port: 4534, addr: 'abcd', payload: Buffer.alloc(0) });
  assert.throws(() => decode(buf.subarray(0, 8)), /truncated/);
  assert.throws(() => decode(buf.subarray(0, 3)), /too short/);
});

test('a frame from a future protocol version is rejected', () => {
  const buf = encode({ type: TYPE.DATA, handle: 1, port: 4534, addr: 'a', payload: Buffer.alloc(0) });
  buf[0] = 2;
  assert.throws(() => decode(buf), /version/);
});

test('an address longer than 255 bytes is refused at encode time', () => {
  assert.throws(() => encode({ type: TYPE.DATA, handle: 1, port: 4534, addr: 'x'.repeat(256) }), /too long/);
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd bridge && node --test test/frame.test.mjs`
Expected: FAIL — `Cannot find module '.../bridge/frame.mjs'`.

- [ ] **Step 4: Write the frame codec**

`bridge/frame.mjs`:

```js
// The wire format between the browser client and this relay. Both ends
// implement it; web/library_bridge.js is the other one. Keep them in step.
export const VERSION = 1;
export const TYPE = { BIND: 1, BOUND: 2, DATA: 3, CLOSE: 4, ERROR: 5 };

export function encode({ type, handle, port, addr, payload }) {
  const a = Buffer.from(addr ?? '', 'ascii');
  if (a.length > 255) throw new RangeError('address too long: ' + a.length + ' bytes');
  const p = payload ?? Buffer.alloc(0);
  const buf = Buffer.allocUnsafe(7 + a.length + p.length);
  buf[0] = VERSION;
  buf[1] = type;
  buf.writeUInt16BE(handle & 0xffff, 2);
  buf.writeUInt16BE(port & 0xffff, 4);
  buf[6] = a.length;
  a.copy(buf, 7);
  Buffer.from(p).copy(buf, 7 + a.length);
  return buf;
}

export function decode(buf) {
  if (buf.length < 7) throw new RangeError('frame too short: ' + buf.length + ' bytes');
  if (buf[0] !== VERSION) throw new RangeError('unsupported frame version ' + buf[0]);
  const addrLen = buf[6];
  if (buf.length < 7 + addrLen) throw new RangeError('frame truncated: address needs ' + addrLen + ' bytes');
  return {
    type: buf[1],
    handle: buf.readUInt16BE(2),
    port: buf.readUInt16BE(4),
    addr: buf.toString('ascii', 7, 7 + addrLen),
    payload: buf.subarray(7 + addrLen),
  };
}
```

- [ ] **Step 5: Run the frame test to confirm it passes**

Run: `cd bridge && node --test test/frame.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the failing policy test**

`bridge/test/policy.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDestination } from '../policy.mjs';

test('a public address on the game port range is allowed', () => {
  assert.equal(checkDestination('167.114.115.128', 4534), null);
  assert.equal(checkDestination('167.114.115.128', 4533), null);
  assert.equal(checkDestination('167.114.115.128', 4599), null);
});

test('ports outside 4533-4599 are refused', () => {
  assert.match(checkDestination('167.114.115.128', 22), /port/);
  assert.match(checkDestination('167.114.115.128', 4600), /port/);
  assert.match(checkDestination('167.114.115.128', 4532), /port/);
});

test('private, loopback, link-local and multicast ranges are refused by default', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '172.31.255.254', '169.254.1.1', '0.0.0.0', '224.0.0.1', '239.1.2.3']) {
    assert.match(checkDestination(ip, 4534), /not allowed/, ip + ' should be refused');
  }
});

test('172.32.0.1 is public and must not be caught by the 172.16/12 rule', () => {
  assert.equal(checkDestination('172.32.0.1', 4534), null);
});

test('allowPrivate lifts the address rule but never the port rule', () => {
  assert.equal(checkDestination('127.0.0.1', 4534, { allowPrivate: true }), null);
  assert.match(checkDestination('127.0.0.1', 22, { allowPrivate: true }), /port/);
});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `cd bridge && node --test test/policy.test.mjs`
Expected: FAIL — `Cannot find module '.../bridge/policy.mjs'`.

- [ ] **Step 8: Write the policy**

`bridge/policy.mjs`:

```js
// What this relay is willing to send UDP to. The relay resolves a hostname
// FIRST and checks the resolved IP here, so a public name pointing at a
// private address is refused like the address itself.
const MIN_PORT = 4533;
const MAX_PORT = 4599;

function octets(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

function isReserved(ip) {
  const o = octets(ip);
  if (!o) return true; // not a dotted quad we understand: refuse
  const [a, b] = o;
  if (a === 0 || a === 127) return true;                 // this-network, loopback
  if (a === 10) return true;                             // private
  if (a === 172 && b >= 16 && b <= 31) return true;      // private
  if (a === 192 && b === 168) return true;               // private
  if (a === 169 && b === 254) return true;               // link-local
  if (a === 100 && b >= 64 && b <= 127) return true;     // carrier-grade NAT
  if (a >= 224) return true;                             // multicast and above
  return false;
}

export function checkDestination(ip, port, { allowPrivate = false } = {}) {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    return 'port ' + port + ' is outside the allowed range ' + MIN_PORT + '-' + MAX_PORT;
  }
  if (!allowPrivate && isReserved(ip)) {
    return 'destination ' + ip + ' is not allowed (private, loopback, link-local or multicast)';
  }
  return null;
}
```

- [ ] **Step 9: Run the policy test to confirm it passes**

Run: `cd bridge && node --test test/policy.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 10: Write the failing relay test**

`bridge/test/relay.test.mjs`:

```js
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

test('two handles get two different source ports, as two native clients would', async (t) => {
  const seen = new Set();
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => { seen.add(rinfo.port); sock.send('ok', rinfo.port, rinfo.address); });
  await new Promise((res) => sock.bind(4535, '127.0.0.1', res));
  t.after(() => sock.close());

  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
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
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(Buffer.from([0xff, 0xff, 0xff]));
  ws.send(encode({ type: TYPE.BIND, handle: 5, port: 0, addr: '' }));
  const f = await next(ws);
  assert.equal(f.type, TYPE.BOUND, 'the connection must survive a bad frame');
  assert.equal(f.handle, 5);
});
```

- [ ] **Step 11: Run it to confirm it fails**

Run: `cd bridge && node --test test/relay.test.mjs`
Expected: FAIL — `Cannot find module '.../bridge/relay.mjs'`.

- [ ] **Step 12: Write the relay**

`bridge/relay.mjs`:

```js
// A WebSocket-to-UDP relay for the browser build of Armagetron Advanced.
//
// WHY THIS EXISTS. The game speaks UDP and nothing else; a browser page can
// never open a UDP socket. Every browser transport requires the far end to
// perform a handshake it understands, and a 2003 game server understands
// none of them. So the datagrams have to be carried by something outside the
// page. That is this.
//
// M-A SCOPE: local only. No TLS, no authentication, no rate limits, nothing
// meant to be reachable from the internet. Those belong to M-C.
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { WebSocketServer } from 'ws';
import { encode, decode, TYPE } from './frame.mjs';
import { checkDestination } from './policy.mjs';

export function startRelay({ port = 8010, allowPrivate = false, log = () => {} } = {}) {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  const all = new Set();

  wss.on('connection', (ws) => {
    ws.binaryType = 'nodebuffer';
    const sockets = new Map(); // handle -> dgram socket
    all.add(sockets);
    const resolved = new Map(); // host text -> ip

    const send = (frame) => { if (ws.readyState === ws.OPEN) ws.send(encode(frame)); };
    const fail = (handle, reason) => send({ type: TYPE.ERROR, handle, port: 0, addr: '', payload: Buffer.from(reason, 'ascii') });

    ws.on('message', async (raw) => {
      let f;
      try {
        f = decode(Buffer.from(raw));
      } catch (e) {
        log('dropped a bad frame: ' + e.message);
        return;
      }

      if (f.type === TYPE.BIND) {
        if (sockets.has(f.handle)) return fail(f.handle, 'handle ' + f.handle + ' is already bound');
        const sock = dgram.createSocket('udp4');
        sock.on('message', (msg, rinfo) => {
          // Echo back the text the client used for this peer, not rinfo.address:
          // the client cannot resolve names and matches replies by that text.
          let addr = rinfo.address;
          for (const [host, ip] of resolved) if (ip === rinfo.address) { addr = host; break; }
          send({ type: TYPE.DATA, handle: f.handle, port: rinfo.port, addr, payload: msg });
        });
        sock.on('error', (e) => { log('udp error on handle ' + f.handle + ': ' + e.message); });
        sock.bind(0, () => {
          sockets.set(f.handle, sock);
          log('handle ' + f.handle + ' bound to udp port ' + sock.address().port);
          send({ type: TYPE.BOUND, handle: f.handle, port: sock.address().port, addr: '' });
        });
        return;
      }

      if (f.type === TYPE.CLOSE) {
        const sock = sockets.get(f.handle);
        if (sock) { sock.close(); sockets.delete(f.handle); }
        return;
      }

      if (f.type === TYPE.DATA) {
        const sock = sockets.get(f.handle);
        if (!sock) return fail(f.handle, 'handle ' + f.handle + ' is not bound');
        let ip = resolved.get(f.addr);
        if (!ip) {
          try {
            ip = (await dns.lookup(f.addr, { family: 4 })).address;
          } catch (e) {
            return fail(f.handle, 'cannot resolve ' + f.addr);
          }
          resolved.set(f.addr, ip);
        }
        const refusal = checkDestination(ip, f.port, { allowPrivate });
        if (refusal) return fail(f.handle, refusal);
        sock.send(f.payload, f.port, ip);
        return;
      }
    });

    const teardown = () => {
      for (const sock of sockets.values()) sock.close();
      sockets.clear();
      all.delete(sockets);
    };
    ws.on('close', teardown);
    ws.on('error', teardown);
  });

  return {
    get port() { return wss.address().port; },
    socketCount() { let n = 0; for (const s of all) n += s.size; return n; },
    close() { for (const s of all) for (const sock of s.values()) sock.close(); wss.close(); },
  };
}

// CLI: node relay.mjs --port 8010 [--allow-private]
if (import.meta.url === 'file://' + process.argv[1]) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const relay = startRelay({
    port: Number(arg('port', 8010)),
    allowPrivate: process.argv.includes('--allow-private'),
    log: (m) => console.log('[bridge] ' + m),
  });
  console.log('[bridge] listening on ws://127.0.0.1:' + relay.port +
              (process.argv.includes('--allow-private') ? ' (private destinations ALLOWED - local testing only)' : ''));
}
```

- [ ] **Step 13: Run the relay test to confirm it passes**

Run: `cd bridge && node --test test/relay.test.mjs`
Expected: PASS, 7 tests. If port 4534 or 4535 is busy on this machine the second and third tests will fail to bind — stop anything using them rather than changing the test.

- [ ] **Step 14: Run every relay test together**

Run: `cd bridge && npm test`
Expected: PASS, 18 tests across three files, 0 failures.

- [ ] **Step 15: Write the bridge README**

`bridge/README.md`:

```markdown
# The bridge

A WebSocket-to-UDP relay. The browser build of the game speaks to this; this
speaks UDP to a stock Armagetron server.

The game speaks UDP and nothing else, and a browser page can never open a UDP
socket — every browser transport needs the far end to perform a handshake it
understands, and a 2003 game server understands none of them. So something
outside the page has to carry the datagrams.

## Running it

    npm install
    node relay.mjs --port 8010

Then open the client with `?bridge=ws://localhost:8010`.

For a server on your own machine (a Docker container, say), add
`--allow-private` — without it the relay refuses to send to loopback and
private ranges, which is what stops it being pointed at things it shouldn't be.

## Scope

This is the M-A relay: local only. No TLS, no authentication, no rate limits,
no metrics. It binds to 127.0.0.1 and is not meant to be reachable from
anywhere else. Making it safe to expose is M-C.

## Layout

- `frame.mjs` — the wire format, shared with `web/library_bridge.js`
- `policy.mjs` — which destinations are allowed
- `relay.mjs` — the server itself
- `test/` — `node --test test/`
```

- [ ] **Step 16: Check the shell and JS lint gates the repo already runs**

Run: `node --check bridge/relay.mjs && node --check bridge/frame.mjs && node --check bridge/policy.mjs`
Expected: no output, exit 0. (The repo's `shellcheck + node --check` CI job runs the same kind of check.)

- [ ] **Step 17: Commit**

```bash
git add bridge/ .gitignore
git commit -F /tmp/task1-msg.txt
```

with `/tmp/task1-msg.txt`:

```
feat(bridge): a WebSocket-to-UDP relay, with tests

The game speaks UDP and a browser page cannot, so the datagrams have to
be carried by something outside the page. This is that something: a
WebSocket server that holds one UDP socket per handle the client opens,
so a browser player looks to a server exactly like a native one.

Local only. It binds to 127.0.0.1, refuses private destinations unless
told otherwise, and restricts ports to the game's range. TLS, rate
limits and anything reachable from the internet belong to M-C.

18 tests: the frame codec round-trips and rejects truncation, bad
versions and oversized addresses; the policy admits public game ports
and refuses reserved ranges; the relay binds handles, echoes the
client's own address text back, gives each handle its own source port,
refuses unbound handles and bad destinations, survives a garbled frame
and releases its sockets when the connection drops.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 2: The client end — JS library, C++ shim, and the four interception points

This task makes the browser build capable of opening a socket through the relay. It does not yet talk to a game server; Task 3 does that. The deliverable is: the client builds, boots, plays single-player exactly as before, keeps the dedicated wasm byte-identical, and — when given `?bridge=` — opens the WebSocket and completes one BIND/BOUND round trip that the relay's log and the browser console both show.

**Files:**
- Create: `web/library_bridge.js`, `src/emscripten/eWebNet.h`, `src/emscripten/eWebNet.cpp`
- Modify: `src/network/nSocket.cpp` (four syscall sites, all guarded), `web/Makefile` (`CLIENT_OBJS`, `CLIENT_LDFLAGS`)
- Test: `web/tools/bridge-gate.steps` (created here, extended in Tasks 3–4)

**Interfaces:**
- Consumes: the relay from Task 1, run as `node bridge/relay.mjs --port 8010 --allow-private`, and the wire protocol in this plan's header.
- Produces, for Tasks 3–5, the C++ namespace `eWebNet` declared in `src/emscripten/eWebNet.h`:
  - `bool eWebNet::Enabled()` — true when the page was given `?bridge=`
  - `int eWebNet::Create()` — a handle ≥ 0, or -1
  - `int eWebNet::Bind( int handle, int & boundPort )` — 0 on success, -1 on failure; writes the relay's UDP port
  - `void eWebNet::Close( int handle )`
  - `int eWebNet::Send( int handle, const void * buf, int len, const sockaddr * addr )` — bytes sent, or -1
  - `int eWebNet::Recv( int handle, void * buf, int len, nAddress & from )` — bytes read, or -1 with `errno = EWOULDBLOCK` when nothing is queued
  - `bool eWebNet::Poll( double seconds )` — yields to the browser; true if anything is queued
  - `unsigned int eWebNet::FakeAddressFor( const char * host )` — a stable address in 10.42.0.0/16
- Also produces the URL parameter **`?bridge=ws://host:port`**, read by `web/library_bridge.js`. Absent, networking is disabled and nothing is attempted.

- [ ] **Step 1: Write the JS library**

`web/library_bridge.js` — this is an Emscripten JS library, merged into the module at link time by `--js-library`. Note it is NOT the page: it may not touch the DOM beyond `location`, and every function here is called from C++.

```js
// The browser end of the bridge. C++ calls these; they never call C++ back.
//
// THE RULE THIS FILE EXISTS TO KEEP: onmessage only ENQUEUES. The client runs
// under Asyncify, which suspends and resumes the C++ stack; calling into C++
// from a WebSocket event during an unwind corrupts the rewind, and the symptom
// is a random crash rather than a network error. So messages land in a queue
// and C++ drains it from its own stack, in eWebNet::Recv.
mergeInto(LibraryManager.library, {
  $AABridge: {
    ws: null,
    state: 0,            // 0 connecting, 1 open, 2 closed or failed
    queues: {},          // handle -> array of {addr, port, bytes}
    bound: {},           // handle -> 1 bound, -1 refused, undefined pending
    url: null,
    urlChecked: false,
    VERSION: 1,
    TYPE: { BIND: 1, BOUND: 2, DATA: 3, CLOSE: 4, ERROR: 5 },

    getUrl: function () {
      if (!AABridge.urlChecked) {
        AABridge.urlChecked = true;
        try {
          var v = new URLSearchParams(location.search).get('bridge');
          AABridge.url = (v && /^wss?:\/\//.test(v)) ? v : null;
        } catch (e) { AABridge.url = null; }
      }
      return AABridge.url;
    },

    frame: function (type, handle, port, addr, payload) {
      var a = [];
      for (var i = 0; i < addr.length; i++) a.push(addr.charCodeAt(i) & 0x7f);
      var out = new Uint8Array(7 + a.length + (payload ? payload.length : 0));
      out[0] = AABridge.VERSION;
      out[1] = type;
      out[2] = (handle >> 8) & 0xff; out[3] = handle & 0xff;
      out[4] = (port >> 8) & 0xff;   out[5] = port & 0xff;
      out[6] = a.length;
      out.set(a, 7);
      if (payload) out.set(payload, 7 + a.length);
      return out;
    },

    onmessage: function (ev) {
      var b = new Uint8Array(ev.data);
      if (b.length < 7 || b[0] !== AABridge.VERSION) return;
      var type = b[1];
      var handle = (b[2] << 8) | b[3];
      var port = (b[4] << 8) | b[5];
      var addrLen = b[6];
      if (b.length < 7 + addrLen) return;
      var addr = '';
      for (var i = 0; i < addrLen; i++) addr += String.fromCharCode(b[7 + i]);
      if (type === AABridge.TYPE.BOUND) {
        AABridge.bound[handle] = 1;
        console.log('[BRIDGE] handle ' + handle + ' bound to udp port ' + port);
        return;
      }
      if (type === AABridge.TYPE.ERROR) {
        var reason = '';
        for (var j = 7 + addrLen; j < b.length; j++) reason += String.fromCharCode(b[j]);
        if (AABridge.bound[handle] === undefined) AABridge.bound[handle] = -1;
        console.log('[BRIDGE] error on handle ' + handle + ': ' + reason);
        return;
      }
      if (type === AABridge.TYPE.DATA) {
        if (!AABridge.queues[handle]) AABridge.queues[handle] = [];
        AABridge.queues[handle].push({ addr: addr, port: port, bytes: b.subarray(7 + addrLen) });
      }
    },
  },

  aa_bridge_enabled: function () {
    return AABridge.getUrl() ? 1 : 0;
  },
  aa_bridge_enabled__deps: ['$AABridge'],

  // 0 connecting, 1 open, 2 closed or failed, -1 not configured
  aa_bridge_state: function () {
    var url = AABridge.getUrl();
    if (!url) return -1;
    if (!AABridge.ws) {
      try {
        AABridge.ws = new WebSocket(url);
        AABridge.ws.binaryType = 'arraybuffer';
        AABridge.state = 0;
        AABridge.ws.onopen = function () { AABridge.state = 1; console.log('[BRIDGE] open ' + url); };
        AABridge.ws.onclose = function () { AABridge.state = 2; console.log('[BRIDGE] closed'); };
        AABridge.ws.onerror = function () { AABridge.state = 2; console.log('[BRIDGE] error'); };
        AABridge.ws.onmessage = AABridge.onmessage;
      } catch (e) {
        AABridge.state = 2;
        console.log('[BRIDGE] cannot open ' + url + ': ' + e);
      }
    }
    return AABridge.state;
  },
  aa_bridge_state__deps: ['$AABridge'],

  aa_bridge_bind: function (handle) {
    if (AABridge.state !== 1) return;
    delete AABridge.bound[handle];
    AABridge.queues[handle] = [];
    AABridge.ws.send(AABridge.frame(AABridge.TYPE.BIND, handle, 0, '', null));
  },
  aa_bridge_bind__deps: ['$AABridge'],

  // 1 bound, -1 refused, 0 still waiting
  aa_bridge_bound: function (handle) {
    var v = AABridge.bound[handle];
    return v === undefined ? 0 : v;
  },
  aa_bridge_bound__deps: ['$AABridge'],

  aa_bridge_close: function (handle) {
    if (AABridge.state === 1) AABridge.ws.send(AABridge.frame(AABridge.TYPE.CLOSE, handle, 0, '', null));
    delete AABridge.queues[handle];
    delete AABridge.bound[handle];
  },
  aa_bridge_close__deps: ['$AABridge'],

  aa_bridge_send: function (handle, addrPtr, port, bufPtr, len) {
    if (AABridge.state !== 1) return -1;
    var addr = UTF8ToString(addrPtr);
    var payload = HEAPU8.subarray(bufPtr, bufPtr + len);
    AABridge.ws.send(AABridge.frame(AABridge.TYPE.DATA, handle, port, addr, payload));
    return len;
  },
  aa_bridge_send__deps: ['$AABridge'],

  // Returns bytes written, or -1 when the queue is empty.
  aa_bridge_recv: function (handle, bufPtr, maxLen, addrPtr, addrMax, portPtr) {
    var q = AABridge.queues[handle];
    if (!q || q.length === 0) return -1;
    var m = q.shift();
    var n = Math.min(m.bytes.length, maxLen);
    HEAPU8.set(m.bytes.subarray(0, n), bufPtr);
    stringToUTF8(m.addr, addrPtr, addrMax);
    HEAP32[portPtr >> 2] = m.port;
    return n;
  },
  aa_bridge_recv__deps: ['$AABridge'],

  aa_bridge_pending: function () {
    var n = 0;
    for (var h in AABridge.queues) n += AABridge.queues[h].length;
    return n;
  },
  aa_bridge_pending__deps: ['$AABridge'],
});
```

- [ ] **Step 2: Write the C++ header**

`src/emscripten/eWebNet.h`:

```cpp
/*
Armagetron Advanced -- M-A: the browser end of the multiplayer bridge.

The game speaks UDP and a browser page cannot. This translation unit is the
seam: nSocket.cpp calls in here at its four syscall sites, and the functions
below hand the work to web/library_bridge.js, which owns the WebSocket.

WHY THIS FILE LIVES IN src/emscripten/ AND NOT src/network/. web/Makefile's
$(SRCS) wildcards src/network/*.cpp into BOTH the client and the dedicated
server, and the dedicated wasm is byte-pinned. A file there would change the
server's size even if its whole body were guarded away -- the Makefile's own
comment puts it exactly: an empty translation unit is not a non-existent one.
Files named only in $(CLIENT_OBJS) cannot reach the server at all.
*/

#ifndef ArmageTron_eWebNet_H
#define ArmageTron_eWebNet_H

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

struct sockaddr;
class nAddress;

namespace eWebNet
{
    //! true when the page was loaded with ?bridge=ws://...
    bool Enabled();

    //! allocate a handle and make sure the WebSocket is open. -1 on failure.
    int Create();

    //! BIND the handle and wait for BOUND. 0 on success, -1 on failure.
    //! boundPort receives the UDP port the relay is sending from.
    int Bind( int handle, int & boundPort );

    //! release the handle
    void Close( int handle );

    //! send one datagram. Returns len, or -1.
    int Send( int handle, const void * buf, int len, const sockaddr * addr );

    //! read one datagram. Returns bytes, or -1 with errno = EWOULDBLOCK when
    //! nothing is queued.
    int Recv( int handle, void * buf, int len, nAddress & from );

    //! yield to the browser for up to this many seconds, returning early as
    //! soon as a datagram is queued. Returns true if anything is queued.
    bool Poll( double seconds );

    //! a stable synthetic address in 10.42.0.0/16 for a host string, so that
    //! nAddress comparisons keep working without DNS in the page.
    unsigned int FakeAddressFor( const char * host );
}

#endif // __EMSCRIPTEN__ && !DEDICATED
#endif // ArmageTron_eWebNet_H
```

- [ ] **Step 3: Write the C++ implementation**

`src/emscripten/eWebNet.cpp`:

```cpp
/*
Armagetron Advanced -- M-A: the browser end of the multiplayer bridge.
See eWebNet.h for why this file is in src/emscripten/ rather than src/network/.

THE ADDRESS MAP. nAddress stores a 32-bit IP and the game compares addresses
by value; a page cannot resolve a hostname to one. So every distinct host
string gets a stable synthetic address out of 10.42.0.0/16. Datagrams go out
carrying the ORIGINAL text, the relay resolves it and echoes the same text
back, and Recv maps that text to the same synthetic address -- so every
comparison inside the game holds, and no DNS ever happens in the page.
*/

#include "config.h"

#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "eWebNet.h"
#include "nSocket.h"

#include <emscripten/emscripten.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <errno.h>
#include <string.h>
#include <string>
#include <map>
#include <vector>

extern "C" {
    int  aa_bridge_enabled( void );
    int  aa_bridge_state( void );
    void aa_bridge_bind( int handle );
    int  aa_bridge_bound( int handle );
    void aa_bridge_close( int handle );
    int  aa_bridge_send( int handle, const char * addr, int port, const void * buf, int len );
    int  aa_bridge_recv( int handle, void * buf, int maxLen, char * addr, int addrMax, int * port );
    int  aa_bridge_pending( void );
}

namespace
{
// how long to wait for the WebSocket and for a BOUND, in 5 ms steps
const int sg_stepMs   = 5;
const int sg_timeoutMs = 5000;

int sg_nextHandle = 1;

// synthetic address <-> host text
std::map< std::string, unsigned int > & HostToFake()
{
    static std::map< std::string, unsigned int > m;
    return m;
}
std::map< unsigned int, std::string > & FakeToHost()
{
    static std::map< unsigned int, std::string > m;
    return m;
}
}

namespace eWebNet
{

bool Enabled()
{
    return aa_bridge_enabled() != 0;
}

unsigned int FakeAddressFor( const char * host )
{
    std::string key( host ? host : "" );
    std::map< std::string, unsigned int >::iterator it = HostToFake().find( key );
    if ( it != HostToFake().end() )
        return it->second;

    // 10.42.<n>.<n>, starting at 10.42.0.1
    unsigned int index = static_cast< unsigned int >( HostToFake().size() ) + 1;
    unsigned int ip = htonl( ( 10u << 24 ) | ( 42u << 16 ) | ( index & 0xffffu ) );
    HostToFake()[ key ] = ip;
    FakeToHost()[ ip ] = key;
    return ip;
}

int Create()
{
    if ( !Enabled() )
        return -1;

    // aa_bridge_state() opens the socket on first call
    int waited = 0;
    int state = aa_bridge_state();
    while ( state == 0 && waited < sg_timeoutMs )
    {
        emscripten_sleep( sg_stepMs );
        waited += sg_stepMs;
        state = aa_bridge_state();
    }
    if ( state != 1 )
        return -1;

    return sg_nextHandle++;
}

int Bind( int handle, int & boundPort )
{
    boundPort = 0;
    aa_bridge_bind( handle );

    int waited = 0;
    int bound = aa_bridge_bound( handle );
    while ( bound == 0 && waited < sg_timeoutMs )
    {
        emscripten_sleep( sg_stepMs );
        waited += sg_stepMs;
        bound = aa_bridge_bound( handle );
    }
    return bound == 1 ? 0 : -1;
}

void Close( int handle )
{
    aa_bridge_close( handle );
}

int Send( int handle, const void * buf, int len, const sockaddr * addr )
{
    const sockaddr_in * in = reinterpret_cast< const sockaddr_in * >( addr );
    unsigned int ip = in->sin_addr.s_addr;
    int port = ntohs( in->sin_port );

    std::map< unsigned int, std::string >::iterator it = FakeToHost().find( ip );
    std::string host;
    if ( it != FakeToHost().end() )
    {
        host = it->second;
    }
    else
    {
        // a literal address the game built itself: send it as dotted quad
        char buffer[ INET_ADDRSTRLEN ];
        struct in_addr a;
        a.s_addr = ip;
        host = inet_ntop( AF_INET, &a, buffer, sizeof( buffer ) ) ? buffer : "";
    }
    if ( host.empty() )
        return -1;

    return aa_bridge_send( handle, host.c_str(), port, buf, len );
}

int Recv( int handle, void * buf, int len, nAddress & from )
{
    char host[ 256 ];
    int port = 0;
    int ret = aa_bridge_recv( handle, buf, len, host, sizeof( host ), &port );
    if ( ret < 0 )
    {
        errno = EWOULDBLOCK;
        return -1;
    }

    sockaddr_in * in = reinterpret_cast< sockaddr_in * >( static_cast< sockaddr * >( from ) );
    memset( in, 0, sizeof( sockaddr_in ) );
    in->sin_family = AF_INET;
    in->sin_port = htons( static_cast< unsigned short >( port ) );
    in->sin_addr.s_addr = FakeAddressFor( host );
    return ret;
}

bool Poll( double seconds )
{
    int budget = static_cast< int >( seconds * 1000 );
    int waited = 0;
    while ( aa_bridge_pending() == 0 && waited < budget )
    {
        emscripten_sleep( sg_stepMs );
        waited += sg_stepMs;
    }
    return aa_bridge_pending() > 0;
}

}

#endif // __EMSCRIPTEN__ && !DEDICATED
```

- [ ] **Step 4: Intercept `nSocket::Create`**

In `src/network/nSocket.cpp`, immediately after `sn_InitOSNetworking();` inside `nSocket::Create`, insert:

```cpp
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
    // The browser cannot open a UDP socket. socket_ holds a bridge handle
    // instead of a file descriptor from here on; every syscall site in this
    // file is guarded to match. See src/emscripten/eWebNet.h.
    socket_ = eWebNet::Create();
    return socket_ < 0 ? -1 : 0;
#endif
```

and add near the other includes at the top of the file:

```cpp
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
#include "eWebNet.h"
#endif
```

- [ ] **Step 5: Intercept `nSocket::Bind`, `Read`, `Write`, `Close`, `Broadcast` and `nAddress::SetHostname`**

In `nSocket::Bind`, replace the two lines inside the `if ( !BindArchiver< tPlaybackBlock >::Archive( ret, trueAddress_ ) )` block:

```cpp
        // just delegate
        ret = bind( socket_, addr, addr.GetAddressLength() );

        // read true address
        if ( 0 == ret )
            ANET_GetSocketAddr( socket_, trueAddress_ );
```

with:

```cpp
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
        {
            int boundPort = 0;
            ret = eWebNet::Bind( socket_, boundPort );
            if ( 0 == ret )
                trueAddress_.SetPort( boundPort );
        }
#else
        // just delegate
        ret = bind( socket_, addr, addr.GetAddressLength() );

        // read true address
        if ( 0 == ret )
            ANET_GetSocketAddr( socket_, trueAddress_ );
#endif
```

In `nSocket::Read`, replace:

```cpp
        // really receive
        NET_SIZE addrlen = addr.GetAddressLength();
        ret = recvfrom (socket_, buf, len, 0, addr, &addrlen );
        tASSERT( addrlen <= static_cast< NET_SIZE >( addr.GetAddressLength() ) );
```

with:

```cpp
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
        ret = eWebNet::Recv( socket_, buf, len, addr );
#else
        // really receive
        NET_SIZE addrlen = addr.GetAddressLength();
        ret = recvfrom (socket_, buf, len, 0, addr, &addrlen );
        tASSERT( addrlen <= static_cast< NET_SIZE >( addr.GetAddressLength() ) );
#endif
```

In `nSocket::Write( const int8 *, int, const sockaddr *, int )`, replace:

```cpp
            // don't send if a playback is running
            if ( !tRecorder::IsPlayingBack() )
                ret = sendto (socket_, buf, len, 0, addr, addrlen );
```

with:

```cpp
            // don't send if a playback is running
            if ( !tRecorder::IsPlayingBack() )
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
                ret = eWebNet::Send( socket_, buf, len, addr );
#else
                ret = sendto (socket_, buf, len, 0, addr, addrlen );
#endif
```

In `nSocket::Close`, guard the `ANET_CloseSocket( socket_ )` call so it becomes `eWebNet::Close( socket_ )` under the same `#if`.

In `nSocket::Broadcast`, insert at the top of the function body:

```cpp
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
    // LAN discovery cannot work from a page: there is no broadcast transport.
    // Fail immediately rather than letting the caller wait for answers that
    // can never arrive.
    return -1;
#endif
```

In `nAddress::SetHostname`, replace the `gethostbyname` block inside
`if ( !tRecorder::PlaybackStrict( section, *this ) )`:

```cpp
        // look up hostname ( TODO: error handling )
        struct hostent *hostentry;
        hostentry = gethostbyname (hostname);
        if (hostentry)
        {
            // store values
            addr_.addr   .sa_family = AF_INET;
            addr_.addr_in.sin_addr.s_addr = *reinterpret_cast<int*>( hostentry->h_addr_list[0] );
        }
        else
        {
            // invalidate
            *this = nAddress();
        }
```

with:

```cpp
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
        // A page cannot resolve a name, so give each host a stable synthetic
        // address and let the relay do the resolving. The datagram carries the
        // original text; see src/emscripten/eWebNet.h.
        addr_.addr   .sa_family = AF_INET;
        addr_.addr_in.sin_addr.s_addr = eWebNet::FakeAddressFor( hostname );
#else
        // look up hostname ( TODO: error handling )
        struct hostent *hostentry;
        hostentry = gethostbyname (hostname);
        if (hostentry)
        {
            // store values
            addr_.addr   .sa_family = AF_INET;
            addr_.addr_in.sin_addr.s_addr = *reinterpret_cast<int*>( hostentry->h_addr_list[0] );
        }
        else
        {
            // invalidate
            *this = nAddress();
        }
#endif
```

Leave the numeric-address branch above it alone: `PartialIPAddress` needs no DNS,
and `eWebNet::Send` already falls back to `inet_ntop` for an address the map does
not know, so a dotted quad typed by the player reaches the relay as a dotted quad.

- [ ] **Step 6: Intercept `nBasicNetworkSystem::Select`**

Replace the whole body of the `else` branch (the `fd_set`/`select` block) with a guarded alternative:

```cpp
        else
        {
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
            // There is no select() over bridge handles. Yield to the browser
            // until a datagram is queued or the budget runs out; this is the
            // one place in the client where the JS side gets to run, which is
            // why library_bridge.js may only enqueue and never call back in.
            retval = eWebNet::Poll( dt ) ? 1 : 0;
#else
            fd_set rfds; // set of sockets to watch
            ... unchanged ...
            retval = select(max+1, &rfds, NULL, NULL, &tv);
#endif
        }
```

Keep the `if ( controlSocket_.GetSocket() < 0 )` branch unchanged — a negative handle still means "nothing to watch".

- [ ] **Step 7: Wire the build**

In `web/Makefile`, add `eWebNet.o` to `CLIENT_OBJS`:

```make
CLIENT_OBJS   := $(SRCS:src/%.cpp=$(CLIENT_OBJDIR)/%.o) \
                 $(CLIENT_OBJDIR)/emscripten/eCompat.o \
                 $(CLIENT_OBJDIR)/emscripten/eWebPersist.o \
                 $(CLIENT_OBJDIR)/emscripten/eWebInput.o \
                 $(CLIENT_OBJDIR)/emscripten/eWebNet.o
```

and extend the comment block above it with a line for the new file, in the style of the three already there:

```
#   src/emscripten/eWebNet.cpp     M-A: the browser end of the multiplayer
#                                  bridge. Named here, not added to $(SRCS),
#                                  for exactly the reason the paragraph below
#                                  gives -- the dedicated wasm is byte-pinned.
```

Add the JS library to `CLIENT_LDFLAGS`, next to `--shell-file`:

```make
                  --js-library web/library_bridge.js \
                  --shell-file web/shell.html
```

Add `web/library_bridge.js` to the client target's prerequisites so a change to it forces a relink — find the `web/dist-m1/armagetronad.html:` rule and add the file to its dependency list, alongside `web/shell.html`.

- [ ] **Step 8: Build both targets**

Run, from the repo root: `make -f web/Makefile client -j8`
Expected: links without error. A failure mentioning `aa_bridge_*` undefined means the `--js-library` flag did not reach the link line. A failure naming `UTF8ToString` or `stringToUTF8` means this Emscripten version wants them declared: add `aa_bridge_send__deps: ['$AABridge', '$UTF8ToString']` and `aa_bridge_recv__deps: ['$AABridge', '$stringToUTF8']` and relink.

Then build the dedicated target and check the pin.
Expected: **2,488,298 bytes, md5 `9718a2a64978cb6e9b95ea2f0454cca5`**. If either differs, the guards are wrong — most likely a `#if` that says `__EMSCRIPTEN__` without `!defined(DEDICATED)`.

- [ ] **Step 9: Write the first gate steps**

`web/tools/bridge-gate.steps` — the header explains the rig, following the style of `web/tools/touch-gate.steps`:

```
# M-A: the multiplayer bridge. Requires TWO helpers running:
#
#   node bridge/relay.mjs --port 8010 --allow-private > /tmp/relay.log 2>&1 &
#   python3 -m http.server 8008 --directory web/dist-m1 &
#   node web/tools/drive-browser.mjs --headed --out /tmp/bridge-gate \
#        --url 'http://localhost:8008/armagetronad.html?bridge=ws://localhost:8010' \
#        --script-file web/tools/bridge-gate.steps
#
# The URL must carry ?bridge= and nothing else. ?autostart=0 holds main() and
# the boot never completes -- that trap has cost two milestones already.

mark:B0 the page boots with a bridge URL and opens the socket
until:1:60000:[BRIDGE] open
eval:console.log('[BRIDGEGATE] B0 ' + JSON.stringify({PASS: true}))
```

- [ ] **Step 10: Run the gate to confirm the socket opens**

Start the relay and the static server as the header shows, then run the driver.
Expected: `[BRIDGE] open ws://localhost:8010` in the console log, and `[bridge] ` lines in `/tmp/relay.log`. Read the verdict with:

`grep -c '\[console.log\].*BRIDGEGATE. B0' /tmp/bridge-gate/console.log`

Expected: 1. Note the repo's counting rule — grep the `[console.log]` lines only; a raw grep counts the driver's own echo lines roughly three times.

- [ ] **Step 11: Confirm single-player is untouched**

Run the existing gates with no `?bridge=` parameter at all: `web/tools/touch-gate.steps`, `web/tools/portrait-boot-gate.steps`, `web/tools/layout-boot-gate.steps` and the desktop menu gate, exactly as the M9 evidence README documents them.
Expected: the same tallies M9 recorded — portrait 10 pass, landscape 8, layout-boot 3, desktop 2, none false. Additionally, grep the console logs for `ws://` and `[BRIDGE]`.
Expected: **0 occurrences of each** — with no `?bridge=`, nothing may be attempted.

- [ ] **Step 12: Commit**

```bash
git add web/library_bridge.js src/emscripten/eWebNet.h src/emscripten/eWebNet.cpp \
        src/network/nSocket.cpp web/Makefile web/tools/bridge-gate.steps
git commit -F /tmp/task2-msg.txt
```

with `/tmp/task2-msg.txt`:

```
feat(net): route the client's UDP through the bridge

nSocket.cpp is intercepted at its four syscall sites -- socket, bind,
recvfrom, sendto -- plus close, broadcast and the select loop, all
behind __EMSCRIPTEN__ && !DEDICATED. socket_ holds a bridge handle
instead of a file descriptor; everything above the socket layer is
untouched, which is the design's actual claim.

The new translation unit lives in src/emscripten/ rather than
src/network/ because web/Makefile wildcards the latter into the
dedicated server too, and an empty translation unit is not a
non-existent one -- the byte pin would move. It is named in
CLIENT_OBJS, where the server cannot reach it.

Addresses travel as text. nAddress needs a 32-bit IP the page cannot
compute, so each host string gets a stable synthetic address in
10.42.0.0/16; the datagram carries the original text, the relay echoes
it back, and every comparison inside the game still holds.

The WebSocket's onmessage only enqueues. Under Asyncify, calling into
C++ from a socket event during an unwind corrupts the rewind, and the
symptom is a random crash rather than a network error, so the queue is
drained from the C++ stack in the select loop instead.

Without ?bridge= nothing is attempted: single-player opens no socket,
and the existing gates show zero occurrences of ws:// as before.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 3: A real server on this machine, and a round played against it (gates B1, B2)

**Files:**
- Create: `bridge/test-server/Dockerfile`, `bridge/test-server/README.md`
- Modify: `web/tools/bridge-gate.steps`, `web/webdefaults/autoexec.cfg`

**Interfaces:**
- Consumes: the relay (Task 1) and the client shim (Task 2).
- Produces: `docker run --rm -p 4534:4534/udp aa-dedicated` as the opponent for Tasks 4 and 6, and the recorded menu key sequence that reaches a bookmarked server, written into `web/tools/bridge-gate.steps` as a comment so later tasks do not rediscover it.

- [ ] **Step 1: Write the test server's Dockerfile**

The server is built from **this tree**, so the thing under test talks to the same codebase rather than to a packaged version whose behaviour we would have to reason about separately.

`bridge/test-server/Dockerfile`:

```dockerfile
# A stock Armagetron dedicated server built from this very source tree, so the
# browser client is tested against the same codebase it was compiled from.
# Build from the REPO ROOT:  docker build -f bridge/test-server/Dockerfile -t aa-dedicated .
FROM debian:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential automake autoconf libtool pkg-config \
        libxml2-dev zlib1g-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . /src

RUN ./bootstrap.sh
RUN ./configure --enable-dedicated --disable-glout --disable-sysinstall --prefix=/opt/aa
RUN make -j"$(nproc)" && make install

RUN mkdir -p /data
EXPOSE 4534/udp
CMD ["/opt/aa/bin/armagetronad-dedicated", "--userdatadir", "/data"]
```

- [ ] **Step 2: Build and start it**

Run, from the repo root:

```bash
docker build -f bridge/test-server/Dockerfile -t aa-dedicated .
docker run --rm -d --name aa-server -p 4534:4534/udp aa-dedicated
docker logs aa-server | tail -20
```

Expected: the log ends with the server announcing it is up and waiting (a "Server: " banner and the round starting with no players). If `bootstrap.sh` fails for a missing tool, add that tool to the `apt-get` line rather than working around the build.

- [ ] **Step 3: Point the client at it**

Append to `web/webdefaults/autoexec.cfg`:

```
# M-A: the address the bridge gate connects to. sg_TransferCustomServer() in
# src/tron/gServerFavorites.cpp turns CUSTOM_SERVER_NAME into the first
# bookmark when the favorites menu opens, which is how the gate reaches a
# chosen server with keypresses instead of typed text. Harmless when the page
# is loaded without ?bridge= -- nothing ever opens a socket then.
CUSTOM_SERVER_NAME 127.0.0.1
CLIENT_PORT 4534
```

- [ ] **Step 4: Discover the menu path, and write it down**

The gate has to reach the bookmarked server through the menus, and the exact key sequence is a fact about this build, not something to guess. Drive the client by hand with the existing driver, taking a screenshot at each level:

```
mark:menu discovery
key:Escape:1
shot:
key:Down:1
shot:
key:Return:1
shot:
```

Repeat until a screenshot shows the bookmark list with `127.0.0.1` in it. Record the working sequence as a comment block at the top of `web/tools/bridge-gate.steps`, naming each screen it passes through, so Tasks 4 and 6 reuse it rather than rediscovering it.

- [ ] **Step 5: Add gate B1 — it connects**

Append to `web/tools/bridge-gate.steps`, using the sequence found in Step 4 in place of the `key:` lines shown:

```
mark:B1 the client reaches the bookmarked server through the bridge
key:Return:1
<the key sequence discovered in Step 4>
until:1:30000:[BRIDGE] handle
until:1:60000:[L] NEW_ROUND
eval:console.log('[BRIDGEGATE] B1 ' + JSON.stringify({PASS: true}))
```

- [ ] **Step 6: Run B1, and confirm it from the server's side too**

Run the driver with the relay and the container up. Then:

```bash
docker logs aa-server | grep -i "joined\|player\|entered"
```

Expected: the server's log names one player joining. **This is the assertion that matters** — the client's own screen saying "connected" only proves the client believes it; the server's log proves a datagram made the trip. Save both logs to `docs/evidence/m-a-bridge/b1/`.

- [ ] **Step 7: Add gate B2 — it plays**

```
mark:B2 a full round completes with the browser player on the grid
key:Left:1
wait:500
key:Right:1
until:1:120000:[L] ROUND_WINNER
eval:console.log('[BRIDGEGATE] B2 ' + JSON.stringify({PASS: true}))
shot:
```

If `[L] ROUND_WINNER` is not the string this build logs at the end of a round, find the real one by grepping a captured console log for the round-end line and use that; do not weaken the assertion to something that also matches a round that never started.

- [ ] **Step 8: Run B2 and capture the evidence**

Expected: the round completes; the screenshot shows the browser player's cycle on the grid; `docker logs aa-server` shows the player's turns being received. Save the console log, the server log and the screenshot to `docs/evidence/m-a-bridge/b2/`.

Count verdicts with the repo's rule — grep the `[console.log]` lines only:

```bash
grep -c '\[console.log\].*BRIDGEGATE. B[12].*PASS.:true' /tmp/bridge-gate/console.log
```

Expected: 2.

- [ ] **Step 9: Commit**

```bash
git add bridge/test-server/ web/tools/bridge-gate.steps web/webdefaults/autoexec.cfg docs/evidence/m-a-bridge/
git commit -F /tmp/task3-msg.txt
```

with `/tmp/task3-msg.txt`:

```
test(bridge): a browser player joins a real server and finishes a round

The opponent is a stock dedicated server built from this same tree in
Docker, so the client is tested against the codebase it was compiled
from rather than against a package whose differences we would have to
reason about separately.

B1 asserts the join from the SERVER's log, not only the client's
screen: the client believing it is connected proves nothing about
whether a datagram made the trip. B2 plays a round to its end.

The menu path to a bookmarked server is recorded as a comment in the
steps file, because it is a fact about this build and rediscovering it
by trial and error is how gates rot.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 4: Loss, and a broken connection (gates B3, B4)

The point of this task is measurement, not reassurance. WebSocket is TCP, so a lost packet stalls everything behind it; the game's own resend layer will make that correct but not instant. **Write down whatever the numbers say.** A bad result here is the single most valuable thing M-A can produce, because it is the argument for WebTransport in M-D.

**Files:**
- Modify: `web/tools/bridge-gate.steps`, `bridge/relay.mjs` (a test-only loss option)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `node bridge/relay.mjs --drop 0.05` — drops that fraction of datagrams in both directions — and the measured numbers in `docs/evidence/m-a-bridge/README.md`.

- [ ] **Step 1: Write the failing test for the loss option**

Append to `bridge/test/relay.test.mjs`:

```js
test('--drop 1 discards every datagram in both directions', async (t) => {
  const server = await echoServer(4536);
  t.after(() => server.close());
  const relay = startRelay({ port: 0, allowPrivate: true, drop: 1 });
  t.after(() => relay.close());
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);
  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4536, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  const timeout = new Promise((res) => setTimeout(() => res('nothing'), 300));
  assert.equal(await Promise.race([next(ws).then(() => 'reply'), timeout]), 'nothing');
});

test('drop 0 is the default and passes everything', async (t) => {
  const server = await echoServer(4537);
  t.after(() => server.close());
  const relay = startRelay({ port: 0, allowPrivate: true });
  t.after(() => relay.close());
  const ws = await open('ws://127.0.0.1:' + relay.port);
  t.after(() => ws.close());
  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal((await next(ws)).type, TYPE.BOUND);
  ws.send(encode({ type: TYPE.DATA, handle: 1, port: 4537, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  assert.equal((await next(ws)).payload.toString(), 'pong:ping');
});
```

- [ ] **Step 2: Run to confirm the first fails**

Run: `cd bridge && node --test test/relay.test.mjs`
Expected: FAIL on `--drop 1` (a reply arrives, because the option does not exist yet); the `drop 0` test passes already.

- [ ] **Step 3: Add the option**

In `bridge/relay.mjs`, take `drop = 0` in `startRelay`'s options, and guard both directions:

```js
const lose = () => drop > 0 && Math.random() < drop;
```

Call it before `sock.send(...)` in the DATA branch and before the `send({type: TYPE.DATA, ...})` inside the socket's `message` handler, returning early when it is true. Add `--drop <fraction>` to the CLI argument parsing, and say in `bridge/README.md` that it is a testing aid and nothing else.

- [ ] **Step 4: Run the tests**

Run: `cd bridge && npm test`
Expected: PASS, 20 tests, 0 failures.

- [ ] **Step 5: Add gate B3 — a round under 5 % loss**

Restart the relay as `node bridge/relay.mjs --port 8010 --allow-private --drop 0.05`, then append to the steps file:

```
mark:B3 a round completes with one datagram in twenty discarded
until:1:180000:[L] ROUND_WINNER
eval:console.log('[BRIDGEGATE] B3 ' + JSON.stringify({PASS: true}))
```

- [ ] **Step 6: Measure what loss costs**

Capture, for a clean run and a 5 % run: the wall-clock time from connect to `[L] ROUND_WINNER`, and the frame-time summary the driver already prints. Write both into `docs/evidence/m-a-bridge/README.md` as a two-row table with the numbers as measured. If the 5 % run is visibly worse, say so plainly and name WebTransport as the known fix rather than softening the result.

- [ ] **Step 7: Add gate B4 — the connection dies mid-round**

```
mark:B4 killing the WebSocket mid-round disconnects cleanly
eval:AABridge.ws.close()
until:1:30000:[BRIDGE] closed
wait:3000
eval:console.log('[BRIDGEGATE] B4 ' + JSON.stringify({PASS: document.querySelector('canvas') !== null}))
shot:
```

Expected: the client returns to a menu or shows a disconnect message; it does **not** hang, and it does **not** crash the wasm module. A crash shows as an Emscripten abort in the console — if one appears, suspect the Asyncify rule first: something re-entered C++ from a socket event.

- [ ] **Step 8: Commit**

```bash
git add bridge/relay.mjs bridge/README.md bridge/test/relay.test.mjs \
        web/tools/bridge-gate.steps docs/evidence/m-a-bridge/
git commit -F /tmp/task4-msg.txt
```

with `/tmp/task4-msg.txt`:

```
test(bridge): measure what packet loss and a dropped socket cost

WebSocket is TCP, so a lost datagram stalls everything queued behind
it and the game's resend layer makes that correct rather than fast.
This is the milestone's most valuable measurement, so the numbers go
in as measured -- a bad result is the argument for WebTransport in
M-D, and softening it would throw that argument away.

B3 completes a round with one datagram in twenty discarded. B4 kills
the socket mid-round and asserts a clean disconnect: no hang, and no
Emscripten abort, which would have meant something re-entered C++
from a socket event.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

---

### Task 5: Nothing else moved (gate B5), and the documentation

**Files:**
- Modify: `PLAN.md`, `web/README.md`, `docs/superpowers/specs/2026-09-10-m-a-multiplayer-bridge-design.md`
- Create: `docs/evidence/m-a-bridge/README.md`

**Interfaces:**
- Consumes: the evidence gathered in Tasks 3 and 4.
- Produces: the M-A block in `PLAN.md` that M-B will be written against.

- [ ] **Step 1: Run every existing gate with no bridge**

Run `web/tools/touch-gate.steps`, `web/tools/portrait-boot-gate.steps`, `web/tools/layout-boot-gate.steps` and the desktop menu gate, all on a plain URL with no `?bridge=`.
Expected: portrait 10 pass, landscape 8, layout-boot 3, desktop 2, none false — the M9 tallies, unchanged.

- [ ] **Step 2: Confirm no socket is attempted in single-player**

```bash
grep -c 'ws://\|\[BRIDGE\]' /tmp/<each gate>/console.log
```

Expected: 0 in every one. This is the same form of evidence PLAN.md already records for Phase 1 — an absence, and it only means something if the grep is stated.

- [ ] **Step 3: Confirm the byte pin**

Build the dedicated target and compare.
Expected: 2,488,298 bytes, md5 `9718a2a64978cb6e9b95ea2f0454cca5`. Record both in the evidence README.

- [ ] **Step 4: Write the evidence README**

`docs/evidence/m-a-bridge/README.md` covering: what was run and how (the exact three commands), the B1–B4 verdicts with the grep that produced each count, the loss table from Task 4, the byte pin, and the no-bridge greps. State the counting rule in the file, as the other evidence READMEs do.

- [ ] **Step 5: Correct the spec's file path**

In `docs/superpowers/specs/2026-09-10-m-a-multiplayer-bridge-design.md`, the Files section names `src/network/nSocketWeb.{cpp,h}`. Replace it with `src/emscripten/eWebNet.{h,cpp}` and add one sentence saying why, in the repo's habit of showing what changed rather than quietly editing: `$(SRCS)` wildcards `src/network/` into both builds, and an empty translation unit is not a non-existent one.

- [ ] **Step 6: Update `web/README.md`**

Add `?bridge=ws://host:port` to the parameter table, one line, in the table's existing style: what it does, what happens when it is absent (nothing — no socket is attempted), and a pointer to `bridge/README.md`.

- [ ] **Step 7: Write the M-A block in `PLAN.md`**

Under Phase 2, add an M-A block recording: what shipped, the four gate verdicts, the loss measurement, the two facts a later milestone must not rediscover (the `src/emscripten/` rule and the enqueue-only rule), and what M-B inherits.

- [ ] **Step 8: Commit**

```bash
git add PLAN.md web/README.md docs/evidence/m-a-bridge/ \
        docs/superpowers/specs/2026-09-10-m-a-multiplayer-bridge-design.md
git commit -F /tmp/task5-msg.txt
```

---

### Task 6: One real community server (gate B6)

**This task stops before it acts.** Every step before Step 3 is preparation inside this machine. Step 3 sends packets to a stranger's server, which is an outward-facing action, and the maintainer decides when it happens.

**Files:**
- Modify: `web/tools/bridge-gate.steps`, `docs/evidence/m-a-bridge/README.md`, `PLAN.md`

- [ ] **Step 1: Pick a target and check it is up**

Fetch the live list and choose a server that is **empty**, so a first attempt cannot spoil anyone's round:

```bash
curl -sSL "https://corsapi.armanelgtron.tk/servers_link/serverlist.php" -o /tmp/aa.xml
python3 - <<'EOF'
import re
x = open('/tmp/aa.xml', encoding='utf-8', errors='replace').read()
for b in re.findall(r'<Server\b(.*?)(?:/>|</Server>)', x, re.S):
    g = lambda k: (re.search(k + r'="([^"]*)"', b) or [None, ''])[1]
    if g('numplayers') == '0':
        print(g('host'), g('port'), re.sub(r'0x[0-9a-fA-F]{6}', '', g('name'))[:40])
EOF
```

Prefer one whose `version_min`–`version_max` range includes 17 (they all did on 2026-09-10, but check rather than assume).

- [ ] **Step 2: Point the gate at it without running it**

Set `CUSTOM_SERVER_NAME` to the chosen host and `CLIENT_PORT` to its port in a local override — **not** in the committed `web/webdefaults/autoexec.cfg`, which stays pointed at `127.0.0.1`. Start the relay **without** `--allow-private`, so the run also proves the destination policy admits a real server.

- [ ] **Step 3: STOP. Ask the maintainer.**

Report: the chosen server, its address, that it is empty, and that the next action sends UDP to a machine belonging to someone else. Ask whether to proceed. **Do not connect until they say so.** If they would rather do it themselves on their phone, that is a complete outcome for this gate — their report of one round played is the evidence.

- [ ] **Step 4: Run B6**

With the maintainer's go, run the same key sequence as B1/B2 against the real address:

```
mark:B6 one round on an unmodified community server
until:1:60000:[L] NEW_ROUND
until:1:180000:[L] ROUND_WINNER
eval:console.log('[BRIDGEGATE] B6 ' + JSON.stringify({PASS: true}))
shot:
```

Expected: a round completes. Capture the console log and a screenshot into `docs/evidence/m-a-bridge/b6/`, and note the measured round-trip latency alongside the local numbers from Task 4 — the difference between them is the real cost of the bridge on a real network, and it is the number M-B's go/no-go rests on.

- [ ] **Step 5: Record the outcome and hand back**

Update the evidence README and the `PLAN.md` M-A block with the B6 result. Then report to the maintainer, plainly: whether it worked, what the latency was, and the one thing no gate can decide — whether it is fun on the phone. That verdict is what M-B waits on.

- [ ] **Step 6: Commit**

```bash
git add web/tools/bridge-gate.steps docs/evidence/m-a-bridge/ PLAN.md
git commit -F /tmp/task6-msg.txt
```
