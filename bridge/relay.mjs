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
  // wss binds asynchronously; wss.address() is null until 'listening' fires.
  const ready = new Promise((res) => wss.on('listening', res));
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
    ready,
    get port() { return wss.address().port; },
    socketCount() { let n = 0; for (const s of all) n += s.size; return n; },
    close() {
      // Clear each connection's socket map as we close it: a WebSocket close
      // handshake finishes asynchronously, and the per-connection teardown()
      // below runs later and would otherwise try to close these same
      // sockets again, which throws ERR_SOCKET_DGRAM_NOT_RUNNING.
      for (const s of all) { for (const sock of s.values()) sock.close(); s.clear(); }
      all.clear();
      wss.close();
    },
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
  relay.ready.then(() => {
    console.log('[bridge] listening on ws://127.0.0.1:' + relay.port +
                (process.argv.includes('--allow-private') ? ' (private destinations ALLOWED - local testing only)' : ''));
  });
}
